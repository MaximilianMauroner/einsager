// Run after pnpm build. On Linux: xvfb-run -a pnpm test:desktop.
// This uses Chromium's fake microphone and an empty Codex folder, never a real login.
import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, mkdir } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const packaged = process.argv.includes('--packaged');
const waylandPolicy = process.argv.includes('--wayland-policy');
if (waylandPolicy) assert.equal(process.platform, 'linux');
const bundle = resolve(`release/einsager-${process.platform}-${process.arch}`);
const executablePath = process.platform === 'darwin'
  ? join(bundle, 'einsager.app/Contents/MacOS/einsager')
  : join(bundle, process.platform === 'win32' ? 'einsager.exe' : 'einsager');
const evidence = waylandPolicy ? 'wayland-policy' : packaged ? 'packaged' : 'desktop';

const directory = await mkdtemp(join(tmpdir(), 'einsager-smoke-'));
const profile = join(directory, 'profile');
const codex = join(directory, 'empty-codex');
await mkdir(codex);
// Inherited CODEX_HOME must also enable Reset, even without a folder chosen in settings.
await mkdir(profile);
await mkdir('.agents/artifacts', { recursive: true });
let application;
try {
  application = await electron.launch({
    ...(packaged ? { executablePath } : {}),
    args: [...(packaged ? [] : ['.']), `--user-data-dir=${profile}`, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', ...(waylandPolicy ? ['--ozone-platform=x11'] : [])],
    // This exercises the conservative Wayland policy on Xvfb, not a real compositor.
    env: { ...process.env, CODEX_HOME: codex, ...(waylandPolicy ? { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'test-policy' } : {}) },
  });
  const page = await application.firstWindow();
  // Settings write failures appear only on the main process console. Keep them as failure evidence for issue #10.
  await application.evaluate(() => {
    const report = console.error.bind(console);
    globalThis.testSettingsErrors = [];
    console.error = (...args) => {
      const [label, error] = args;
      if (label === 'Could not save settings:') {
        globalThis.testSettingsErrors.push({ code: error?.code, syscall: error?.syscall, message: String(error?.message ?? error) });
      }
      report(...args);
    };
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: 'Start hands-free dictation' }).waitFor();
  await page.screenshot({ path: `.agents/artifacts/${evidence}-idle.png`, omitBackground: true });
  // Side docking sizes differed in Windows CI (issue #10). Keep the last 16 pill geometry events in call order, as
  // numbers, without changing them: each native bounds request with the bounds just before and after it and the size
  // limits after it, and each pill size request. This listener runs after the production one, so a size request
  // follows the bounds request that its handler made.
  await application.evaluate(({ BrowserWindow, ipcMain }) => {
    const geometry = globalThis.testGeometry = [];
    const keep = entry => {
      geometry.push(entry);
      if (geometry.length > 16) geometry.shift();
    };
    // Copies only numeric fields. A failed read gives 'unavailable', so it cannot change the native call or its result.
    const read = (get, keys) => {
      try {
        const value = get();
        return Object.fromEntries(keys.map(key => {
          const number = value?.[key];
          return [key, typeof number === 'number' ? number : 'unavailable'];
        }));
      } catch {
        return 'unavailable';
      }
    };
    const rect = ['x', 'y', 'width', 'height'];
    ipcMain.on('resize', (event, width, height, pillHeight) => {
      if ([width, height, pillHeight].every(value => typeof value === 'number')) {
        keep({ phase: 'resize after production handler', width, height, pillHeight });
      }
    });
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('index.html'));
    const setBounds = window.setBounds;
    window.setBounds = function (bounds) {
      const entry = { phase: 'setBounds', request: read(() => bounds, rect), before: read(() => window.getBounds(), rect) };
      try {
        return setBounds.apply(this, arguments);
      } finally {
        entry.after = read(() => window.getBounds(), rect);
        entry.minimumSize = read(() => { const [width, height] = window.getMinimumSize(); return { width, height }; }, ['width', 'height']);
        entry.maximumSize = read(() => { const [width, height] = window.getMaximumSize(); return { width, height }; }, ['width', 'height']);
        keep(entry);
      }
    };
  });
  await page.getByRole('button', { name: 'Start hands-free dictation' }).click();
  await page.getByRole('button', { name: 'Finish dictation' }).waitFor();
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('index.html')).webContents.send('action', 'copy');
  });
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole('button', { name: 'Finish dictation' }).count(), 1,
    'A tray Copy action must keep recording controls visible');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `.agents/artifacts/${evidence}-recording.png`, omitBackground: true });
  await page.getByRole('button', { name: 'Finish dictation' }).click();
  await page.getByText('Cannot read the file-based Codex login.', { exact: false }).waitFor();
  // The tray panel follows the pill's session, so a failed recording can be retried there too.
  // Playwright does not list the packaged app's hidden panel page, so both runs drive it from the main process.
  const inPanel = script => application.evaluate(({ BrowserWindow }, script) => BrowserWindow.getAllWindows()
    .find(window => window.webContents.getURL().endsWith('panel.html')).webContents.executeJavaScript(script), script);
  const panelText = () => inPanel('document.body.innerText');
  const clickInPanel = selector => inPanel(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const panelVisible = () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .find(window => window.webContents.getURL().endsWith('panel.html')).isVisible());
  await expect.poll(panelText).toContain('Cannot read the file-based Codex login.');
  assert.equal(await inPanel('document.querySelectorAll(".pending .action").length'), 2, 'A retryable failure offers Retry and Discard');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByText('Cannot read the file-based Codex login.', { exact: false }).waitFor();
  // Simulate an earlier transcript while retaining the current failed recording.
  await application.evaluate(({ ipcMain, clipboard, BrowserWindow }) => {
    ipcMain.removeHandler('copy-last');
    ipcMain.handle('copy-last', () => { clipboard.writeText('Previous transcript'); return true; });
    BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('index.html')).webContents.send('action', 'copy');
  });
  await expect.poll(() => application.evaluate(({ clipboard }) => clipboard.readText())).toBe('Previous transcript');
  await page.waitForTimeout(100);
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByText('Cannot read the file-based Codex login.', { exact: false }).waitFor();

  // A persistence failure has no complete recording to upload again.
  await application.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('retry');
    ipcMain.handle('retry', () => ({ error: 'Cannot save recording. Check available disk space.', retryable: false }));
  });
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByText('Cannot save recording.', { exact: false }).waitFor();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel dictation' }).click();
  await page.getByRole('button', { name: 'Start hands-free dictation' }).waitFor();

  // Tray panel: empty history, settings that persist, and starting dictation from the panel.
  await expect.poll(panelText).toContain('What you say appears here.');
  await clickInPanel('[aria-label="Settings"]');
  await expect.poll(panelText).toContain('Clipboard after dictation');
  await inPanel(`[...document.querySelectorAll('.choice')].find(choice => choice.textContent.startsWith('Always')).click()`);
  const historySwitch = () => inPanel(`document.querySelector('[role="switch"]').getAttribute('aria-checked')`);
  const historySwitchBefore = await historySwitch();
  // Windows sometimes keeps keepHistory true (issue #10). On failure, report what each side holds, reading only the test profile.
  const historyEvidence = async () => ({
    historySwitchBefore,
    historySwitchAfter: await historySwitch(),
    mainSettings: await inPanel('window.einsagerPanel.state().then(state => state.settings)'),
    profile,
    userData: await application.evaluate(({ app }) => app.getPath('userData')),
    profileFiles: (await readdir(profile)).filter(name => name.startsWith('settings.json')),
    settingsErrors: await application.evaluate(() => globalThis.testSettingsErrors),
  });
  await clickInPanel('[role="switch"]');
  await expect.poll(async () => JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8')))
    .toMatchObject({ edge: 'bottom', clipboard: 'always', keepHistory: false })
    .catch(async error => {
      console.error('History persistence evidence:', await historyEvidence().catch(reason => `unavailable: ${reason}`));
      throw error;
    });
  const resetCodexFolder = `[...document.querySelectorAll('button')].find(button => button.textContent === 'Reset to default')`;
  assert.equal(await inPanel(`${resetCodexFolder}.disabled`), false, 'An inherited Codex folder can be reset');
  await inPanel(`${resetCodexFolder}.click()`);
  await expect.poll(async () => JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8')).codexHome)
    .toBe(join(homedir(), '.codex'));
  // The panel keeps the platform's separator, for example ~\.codex on Windows.
  await expect.poll(() => inPanel('document.querySelector(".path").textContent')).toBe(join('~', '.codex'));
  await expect.poll(() => inPanel(`${resetCodexFolder}.disabled`)).toBe(true);
  // Restore the empty test login through the chooser before further recording checks.
  await application.evaluate(({ dialog }, codex) => {
    const choose = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => {
      dialog.showOpenDialog = choose;
      return { canceled: false, filePaths: [codex] };
    };
  }, codex);
  await clickInPanel('[aria-label^="Change the Codex login folder"]');
  await expect.poll(async () => JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8')).codexHome).toBe(codex);
  await expect.poll(() => inPanel(`${resetCodexFolder}.disabled`)).toBe(false);
  // The pill lists Chromium's fake inputs for Settings. Choose the last one, which is not the default.
  const microphoneSelect = `[...document.querySelectorAll('label.row')].find(row => row.textContent.startsWith('Microphone')).querySelector('select')`;
  await expect.poll(() => inPanel(`${microphoneSelect}.options.length`)).toBeGreaterThan(1);
  const microphone = await inPanel(`(() => {
    const select = ${microphoneSelect};
    const { value } = select.options[select.options.length - 1];
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return value;
  })()`);
  assert.ok(microphone, 'A connected microphone has an id');
  await expect.poll(async () => JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8')).microphone).toBe(microphone);
  await clickInPanel('.back');
  await expect.poll(panelText).toContain('History is off.');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .find(window => window.webContents.getURL().endsWith('panel.html')).show());
  await expect.poll(panelVisible).toBe(true);
  await clickInPanel('[aria-label="Start dictation"]');
  await page.getByRole('button', { name: 'Finish dictation' }).waitFor();
  assert.equal(await panelVisible(), false, 'Starting from the panel hides it, so focus returns to the editor');
  assert.match(await panelText(), /Listening/);
  await page.getByRole('button', { name: 'Cancel dictation' }).click();
  await page.getByRole('button', { name: 'Start hands-free dictation' }).waitFor();

  // With "Show pill when idle" off, the pill appears only for a session.
  const pillVisible = () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .find(window => window.webContents.getURL().endsWith('index.html')).isVisible());
  const toggleShowPill = () => inPanel('document.querySelector(\'[aria-labelledby="show-pill"]\').click()');
  await clickInPanel('[aria-label="Settings"]');
  await expect.poll(panelText).toContain('Show pill when idle');
  await toggleShowPill();
  await expect.poll(pillVisible).toBe(false);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .find(window => window.webContents.getURL().endsWith('index.html')).webContents.send('action', 'toggle'));
  await expect.poll(pillVisible).toBe(true);
  await page.getByRole('button', { name: 'Cancel dictation' }).click();
  await expect.poll(pillVisible).toBe(false);
  await toggleShowPill();
  await expect.poll(pillVisible).toBe(true);
  await clickInPanel('.back');
  const info = await page.evaluate(() => window.einsager.info());
  assert.equal(info.pasteKey, process.platform === 'darwin' ? '⌘V' : 'Ctrl+V');
  if (waylandPolicy) {
    assert.equal(info.canPositionWindow, false);
    assert.match(info.desktopNotice, /Wayland/);
  }

  // Force the Mac startup ordering on every OS, without relying on IPC timing.
  await application.evaluate(({ ipcMain }, info) => {
    ipcMain.removeHandler('info');
    ipcMain.handle('info', () => new Promise(resolve => {
      globalThis.completeTestInfo = () => {
        resolve({ ...info, pasteKey: '⌘V' });
        ipcMain.removeHandler('info');
        ipcMain.handle('info', () => ({ ...info, pasteKey: '⌘V' }));
      };
    }));
  }, info);
  await page.addInitScript(() => {
    window.testAudioCallbacks = 0;
    const createProcessor = AudioContext.prototype.createScriptProcessor;
    AudioContext.prototype.createScriptProcessor = function (...args) {
      const processor = createProcessor.apply(this, args);
      processor.addEventListener('audioprocess', () => { window.testAudioCallbacks++; });
      return processor;
    };
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await getUserMedia(constraints);
      window.testMicrophoneStream = stream;
      return stream;
    };
  });
  await page.reload();
  await page.getByRole('button', { name: 'Start hands-free dictation' }).waitFor();
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('index.html')).webContents.send('action', 'toggle');
  });
  await page.getByRole('button', { name: 'Finish dictation' }).waitFor();
  assert.equal(await page.evaluate(() => window.testMicrophoneStream.getAudioTracks()[0].readyState), 'live');
  const callbacks = await page.evaluate(() => window.testAudioCallbacks);
  await application.evaluate(() => { globalThis.completeTestInfo(); delete globalThis.completeTestInfo; });
  await expect.poll(() => page.evaluate(() => window.testAudioCallbacks)).toBeGreaterThan(callbacks + 2);
  assert.equal(await page.evaluate(() => window.testMicrophoneStream.getAudioTracks()[0].readyState), 'live',
    'A late Mac paste-key response must leave the microphone running');
  await page.getByRole('button', { name: 'Cancel dictation' }).click();
  await expect.poll(() => page.evaluate(() => window.testMicrophoneStream.getAudioTracks()[0].readyState)).toBe('ended');
  // Recording uses the microphone chosen in Settings.
  await page.getByRole('button', { name: 'Start hands-free dictation' }).click();
  await page.getByRole('button', { name: 'Finish dictation' }).waitFor();
  assert.equal(await page.evaluate(() => window.testMicrophoneStream.getAudioTracks()[0].getSettings().deviceId), microphone,
    'Recording must use the microphone chosen in Settings');
  await page.getByRole('button', { name: 'Cancel dictation' }).click();
  await page.getByRole('button', { name: 'Start hands-free dictation' }).waitFor();
  // An unplugged choice records from the system default, and Settings says so.
  await inPanel(`window.einsagerPanel.update({ microphone: 'unplugged' })`);
  await clickInPanel('[aria-label="Settings"]');
  await expect.poll(() => inPanel(`${microphoneSelect}.selectedOptions[0].textContent`)).toBe('Not connected, uses default');
  await clickInPanel('.back');
  await page.getByRole('button', { name: 'Start hands-free dictation' }).click();
  await page.getByRole('button', { name: 'Finish dictation' }).waitFor();
  assert.equal(await page.evaluate(() => window.testMicrophoneStream.getAudioTracks()[0].getSettings().deviceId), 'default');
  await page.getByRole('button', { name: 'Cancel dictation' }).click();
  await page.getByRole('button', { name: 'Start hands-free dictation' }).waitFor();

  // Exercise renderer sizing, IPC placement, and docking together. The system can keep the pill window larger than the
  // pill asks for: Windows kept the 8 point handle's window 39 points high. So these checks find the visible pill on
  // screen, and compare the native size with the pill's own size, or with the collapsed window when that is larger.
  const pill = page.locator('.pill');
  // The native client size of the collapsed pill, taken when it is first docked.
  let collapsed;
  // Samples the rendered pill and its native window. point is the part of the pill that docking holds still: its outer
  // edge, and its center along the docked edge. delta is the largest of these differences, in points:
  // - the renderer viewport against the native client area;
  // - the native client size against the pill's own size, or against the collapsed size when that is larger;
  // - with an edge, point against its target 12 points inside the work area, and any part of the window outside it.
  const pillSize = async edge => {
    const { surface, rect, viewport } = await page.evaluate(() => {
      const box = selector => {
        const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
        return { x, y, width, height };
      };
      return { surface: box('.surface'), rect: box('.pill'), viewport: { width: innerWidth, height: innerHeight } };
    });
    const { bounds, content, area } = await application.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('index.html'));
      const bounds = window.getBounds();
      return { bounds, content: window.getContentBounds(), area: screen.getDisplayMatching(bounds).workArea };
    });
    const point = {
      x: content.x + rect.x + (edge === 'left' ? 0 : edge === 'right' ? rect.width : rect.width / 2),
      y: content.y + rect.y + (edge === 'top' ? 0 : edge === 'bottom' ? rect.height : rect.height / 2),
    };
    const target = {
      x: edge === 'left' ? area.x + 12 : edge === 'right' ? area.x + area.width - 12 : area.x + area.width / 2,
      y: edge === 'top' ? area.y + 12 : edge === 'bottom' ? area.y + area.height - 12 : area.y + area.height / 2,
    };
    const deltas = {
      viewport: Math.max(Math.abs(viewport.width - content.width), Math.abs(viewport.height - content.height)),
      size: Math.max(Math.abs(content.width - Math.max(Math.ceil(surface.width), collapsed?.width ?? 0)),
        Math.abs(content.height - Math.max(Math.ceil(surface.height), collapsed?.height ?? 0))),
      ...(edge && {
        position: Math.max(Math.abs(point.x - target.x), Math.abs(point.y - target.y)),
        outside: Math.max(0, area.x - bounds.x, area.y - bounds.y,
          bounds.x + bounds.width - area.x - area.width, bounds.y + bounds.height - area.y - area.height),
      }),
    };
    return { edge, surface, rect, viewport, bounds, content, area, point, deltas, delta: Math.max(...Object.values(deltas)) };
  };
  const pillSizeEvidence = async sample => ({
    sample,
    main: await application.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('index.html'));
      const display = screen.getDisplayMatching(window.getBounds());
      return {
        contentBounds: window.getContentBounds(), minimumSize: window.getMinimumSize(),
        workArea: display.workArea, scaleFactor: display.scaleFactor,
        // One JSON line per event, because console output hides fields nested this deep.
        geometry: globalThis.testGeometry.map(entry => JSON.stringify(entry)),
      };
    }),
    renderer: await page.evaluate(() => ({ innerWidth, innerHeight, devicePixelRatio })),
  });
  // Waits for the renderer's resize request to reach the native window, then returns the matching sample.
  // The sample is kept when its delta is returned, so the evidence shows the value that was compared last.
  const expectPill = async (state, edge) => {
    let sample;
    await expect.poll(async () => {
      sample = { state, ...await pillSize(edge) };
      return sample.delta;
    }).toBeLessThanOrEqual(1).catch(async error => {
      console.error('Docking size evidence:', await pillSizeEvidence(sample).catch(reason => `unavailable: ${reason}`));
      throw error;
    });
    return sample;
  };
  const sendAction = action => application.evaluate(({ BrowserWindow }, action) => BrowserWindow.getAllWindows()
    .find(window => window.webContents.getURL().endsWith('index.html')).webContents.send('action', action), action);
  if (waylandPolicy) {
    // Resizing must keep labels visible even when the compositor owns placement.
    await expectPill('compositor-owned placement');
    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('index.html'));
      globalThis.testBoundsCalls = 0;
      const original = window.setBounds.bind(window);
      window.setBounds = (...args) => { globalThis.testBoundsCalls++; return original(...args); };
    });
    await page.evaluate(async () => { window.einsager.drag(100, 100, true); await window.einsager.info(); });
    assert.equal(await application.evaluate(() => globalThis.testBoundsCalls), 0);
  }
  for (const edge of waylandPolicy ? [] : ['left', 'right', 'top', 'bottom']) {
    await pill.dispatchEvent('mouseout', { relatedTarget: null });
    await page.locator('.pill.handle').waitFor();
    const shift = await application.evaluate(({ BrowserWindow, screen }, edge) => {
      const bounds = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('index.html')).getBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      // Drag to the middle of the top or bottom edge. The drag keeps the window in the work area.
      if (edge === 'top' || edge === 'bottom') {
        return { dx: area.x + (area.width - bounds.width) / 2 - bounds.x, dy: (edge === 'top' ? area.y : area.y + area.height) - bounds.y };
      }
      const x = edge === 'left' ? area.x + 12 : area.x + area.width - bounds.width - 12;
      return { dx: x - bounds.x, dy: area.y + area.height / 2 - bounds.y };
    }, edge);
    await page.evaluate(({ dx, dy }) => window.einsager.drag(dx, dy, true), shift);
    await page.locator(`.surface.${edge}`).waitFor();
    if (!collapsed) {
      // Main has handled the handle's size request once it answers a later request on the same channel. The size
      // request leaves after layout, so wait two frames first.
      await page.evaluate(async () => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await window.einsager.info();
      });
      collapsed = await application.evaluate(({ BrowserWindow }) => {
        const { width, height } = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('index.html')).getContentBounds();
        return { width, height };
      });
    }
    // Each collapse after a label returns to the first collapsed size.
    const idle = await expectPill('collapsed', edge);
    assert.deepEqual([idle.rect.width, idle.rect.height, idle.surface.width, idle.surface.height], [40, 8, 40, 8],
      'The collapsed pill is only the 40 x 8 handle');
    await pill.dispatchEvent('mouseover', { relatedTarget: null });
    await page.getByRole('status').waitFor();
    // Native bounds round to whole points; CSS label widths can be fractional.
    await expect.poll(async () => Math.abs((await pillSize(edge)).point.y - idle.point.y)).toBeLessThanOrEqual(1);
    await expect.poll(async () => Math.abs((await pillSize(edge)).point.x - idle.point.x)).toBeLessThanOrEqual(1);
    const hover = await expectPill('hover', edge);
    // A label is taller than the collapsed window, so the window must take the label and pill's own size.
    assert.ok(Math.ceil(hover.surface.height) > collapsed.height,
      `A label must make the pill taller than its collapsed window: ${hover.surface.height} against ${collapsed.height}`);
    assert.equal(hover.rect.height, 28);
    // Labels sit on the screen side of the pill: below it at the top edge, above it elsewhere.
    const label = await page.getByRole('status').boundingBox();
    assert.ok(edge === 'top' ? label.y >= hover.rect.y + hover.rect.height : label.y + label.height <= hover.rect.y,
      'Labels sit on the screen side of the pill');
    await page.screenshot({ path: `.agents/artifacts/${evidence}-${edge}-hover.png`, omitBackground: true });
    // Recording shows the 28 point pill with its controls and no label.
    await sendAction('toggle');
    await page.getByRole('button', { name: 'Finish dictation' }).waitFor();
    assert.equal((await expectPill('recording', edge)).rect.height, 28);
    await sendAction('cancel');
    await page.getByRole('button', { name: 'Start hands-free dictation' }).waitFor();
  }
  assert.deepEqual(errors, []);
  console.log(`${evidence}: launch, recording, safe Copy/recovery, login error, Retry capability, tray panel state and settings, Codex folder reset, microphone choice and fallback, hidden idle pill, delayed Mac info, cancellation, and ${waylandPolicy ? 'compositor-owned placement with working resize' : 'docking at all four edges'} passed. No request sent.`);
} finally {
  await application?.close();
  await rm(directory, { recursive: true, force: true });
}
