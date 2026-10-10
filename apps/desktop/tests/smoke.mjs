// Run after pnpm build. On Linux: xvfb-run -a pnpm test:desktop.
// This uses Chromium's fake microphone and an empty Codex folder, never a real login.
import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
// A chosen folder that matches CODEX_HOME, so the panel can reset it without changing which login the helper reads.
await mkdir(profile);
await writeFile(join(profile, 'settings.json'), JSON.stringify({ codexHome: codex }));
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
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: 'Start hands-free dictation' }).waitFor();
  await page.screenshot({ path: `.agents/artifacts/${evidence}-idle.png`, omitBackground: true });
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
  await clickInPanel('[role="switch"]');
  await expect.poll(async () => JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8')))
    .toMatchObject({ edge: 'bottom', clipboard: 'always', keepHistory: false, codexHome: codex });
  const resetCodexFolder = `[...document.querySelectorAll('button')].find(button => button.textContent === 'Reset to default')`;
  assert.equal(await inPanel(`${resetCodexFolder}.disabled`), false, 'A chosen Codex folder can be reset');
  await inPanel(`${resetCodexFolder}.click()`);
  await expect.poll(async () => 'codexHome' in JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8'))).toBe(false);
  await expect.poll(() => inPanel(`${resetCodexFolder}.disabled`)).toBe(true);
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

  // Exercise renderer sizing, IPC placement, and side alignment together.
  const pill = page.locator('.pill');
  if (waylandPolicy) {
    // Resizing must keep labels visible even when the compositor owns placement.
    await expect.poll(async () => {
      const surface = await page.locator('.surface').boundingBox();
      const bounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('index.html')).getBounds());
      return Math.max(Math.abs(bounds.width - Math.ceil(surface.width)), Math.abs(bounds.height - Math.ceil(surface.height)));
    }).toBeLessThanOrEqual(1);
    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('index.html'));
      globalThis.testBoundsCalls = 0;
      const original = window.setBounds.bind(window);
      window.setBounds = (...args) => { globalThis.testBoundsCalls++; return original(...args); };
    });
    await page.evaluate(async () => { window.einsager.drag(100, 100, true); await window.einsager.info(); });
    assert.equal(await application.evaluate(() => globalThis.testBoundsCalls), 0);
  }
  for (const edge of waylandPolicy ? [] : ['left', 'right']) {
    await pill.dispatchEvent('mouseout', { relatedTarget: null });
    await page.locator('.pill.handle').waitFor();
    const shift = await application.evaluate(({ BrowserWindow, screen }, edge) => {
      const bounds = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('index.html')).getBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      const x = edge === 'left' ? area.x + 12 : area.x + area.width - bounds.width - 12;
      return { dx: x - bounds.x, dy: area.y + area.height / 2 - bounds.y };
    }, edge);
    await page.evaluate(({ dx, dy }) => window.einsager.drag(dx, dy, true), shift);
    await page.locator(`.surface.${edge}`).waitFor();
    // Wait for the renderer's resize request to reach the native window before sampling it.
    await expect.poll(async () => {
      const surface = await page.locator('.surface').boundingBox();
      assert.ok(surface);
      const bounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('index.html')).getBounds());
      return Math.max(Math.abs(bounds.width - Math.ceil(surface.width)), Math.abs(bounds.height - Math.ceil(surface.height)));
    }).toBeLessThanOrEqual(1);
    const position = async () => {
      const rect = await pill.boundingBox();
      assert.ok(rect);
      const bounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('index.html')).getBounds());
      return {
        y: bounds.y + rect.y + rect.height / 2,
        x: bounds.x + rect.x + (edge === 'right' ? rect.width : 0),
      };
    };
    const idle = await position();
    await pill.dispatchEvent('mouseover', { relatedTarget: null });
    await page.getByRole('status').waitFor();
    // Native bounds round to whole points; CSS label widths can be fractional.
    await expect.poll(async () => Math.abs((await position()).y - idle.y)).toBeLessThanOrEqual(1);
    await expect.poll(async () => Math.abs((await position()).x - idle.x)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `.agents/artifacts/${evidence}-${edge}-hover.png`, omitBackground: true });
  }
  assert.deepEqual(errors, []);
  console.log(`${evidence}: launch, recording, safe Copy/recovery, login error, Retry capability, tray panel state and settings, Codex folder reset, microphone choice and fallback, hidden idle pill, delayed Mac info, cancellation, and ${waylandPolicy ? 'compositor-owned placement with working resize' : 'side docking'} passed. No request sent.`);
} finally {
  await application?.close();
  await rm(directory, { recursive: true, force: true });
}
