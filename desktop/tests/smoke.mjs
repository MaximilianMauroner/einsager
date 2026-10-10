// Run after pnpm build. On Linux: xvfb-run -a pnpm test:desktop.
// This uses Chromium's fake microphone and an empty Codex folder, never a real login.
import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const packaged = process.argv.includes('--packaged');
const bundle = resolve(`release/einsager-${process.platform}-${process.arch}`);
const executablePath = process.platform === 'darwin'
  ? join(bundle, 'einsager.app/Contents/MacOS/einsager')
  : join(bundle, process.platform === 'win32' ? 'einsager.exe' : 'einsager');
const evidence = packaged ? 'packaged' : 'desktop';

const directory = await mkdtemp(join(tmpdir(), 'einsager-smoke-'));
const profile = join(directory, 'profile');
const codex = join(directory, 'empty-codex');
await mkdir(codex);
await mkdir('.agents/artifacts', { recursive: true });
let application;
try {
  application = await electron.launch({
    ...(packaged ? { executablePath } : {}),
    args: [...(packaged ? [] : ['.']), `--user-data-dir=${profile}`, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    env: { ...process.env, CODEX_HOME: codex },
  });
  const page = await application.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: 'Start hands-free dictation' }).waitFor();
  await page.screenshot({ path: `.agents/artifacts/${evidence}-idle.png`, omitBackground: true });
  await page.getByRole('button', { name: 'Start hands-free dictation' }).click();
  await page.getByRole('button', { name: 'Finish dictation' }).waitFor();
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('action', 'copy');
  });
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole('button', { name: 'Finish dictation' }).count(), 1,
    'A tray Copy action must keep recording controls visible');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `.agents/artifacts/${evidence}-recording.png`, omitBackground: true });
  await page.getByRole('button', { name: 'Finish dictation' }).click();
  await page.getByText('Cannot read the file-based Codex login.', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByText('Cannot read the file-based Codex login.', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Cancel dictation' }).click();
  await page.getByRole('button', { name: 'Start hands-free dictation' }).waitFor();
  const info = await page.evaluate(() => window.einsager.info());
  assert.equal(info.pasteKey, process.platform === 'darwin' ? '⌘V' : 'Ctrl+V');

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
    BrowserWindow.getAllWindows()[0].webContents.send('action', 'toggle');
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

  // Exercise renderer sizing, IPC placement, and side alignment together.
  const pill = page.locator('.pill');
  for (const edge of ['left', 'right']) {
    await pill.dispatchEvent('mouseout', { relatedTarget: null });
    await page.locator('.pill.handle').waitFor();
    const shift = await application.evaluate(({ BrowserWindow, screen }, edge) => {
      const bounds = BrowserWindow.getAllWindows()[0].getBounds();
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
      const bounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
      return Math.max(Math.abs(bounds.width - Math.ceil(surface.width)), Math.abs(bounds.height - Math.ceil(surface.height)));
    }).toBeLessThanOrEqual(1);
    const position = async () => {
      const rect = await pill.boundingBox();
      assert.ok(rect);
      const bounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
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
  console.log(`${evidence}: launch, recording, safe Copy action, login error, Retry, delayed Mac info, cancellation, and side docking passed. No request sent.`);
} finally {
  await application?.close();
  await rm(directory, { recursive: true, force: true });
}
