// Run on Linux under Xvfb. Exercise the production adapter against a separate blank editor.
import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import electronExecutable from 'electron';
import { TranscriptDelivery } from '../src/main/delivery.ts';
import { LinuxDesktop } from '../src/main/linux/desktop.ts';

assert.equal(process.platform, 'linux', 'Run this integration test on Linux.');
const execute = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), 'einsager-x11-test-'));
let editor;
try {
  // Match Playwright's Electron test launches on hosts without a SUID sandbox helper.
  await execute(electronExecutable, ['--no-sandbox', resolve('apps/desktop/tests/fixtures/quit-before-start.cjs'), `--user-data-dir=${join(directory, 'early-quit')}`], { timeout: 10_000 });
  console.log('Desktop startup: quitting before readiness terminates the production app.');
  editor = await electron.launch({ args: [resolve('apps/desktop/tests/fixtures/linux-editor.cjs'), `--user-data-dir=${directory}`] });
  const page = await editor.firstWindow();
  const field = page.getByRole('textbox', { name: 'Test editor' });
  await field.waitFor();
  const id = await editor.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readUInt32LE());
  await execute('xdotool', ['windowfocus', '--sync', String(id)], { timeout: 1500 });
  await field.focus();
  const desktop = new LinuxDesktop({ ...process.env, XDG_SESSION_TYPE: 'x11', WAYLAND_DISPLAY: '' });
  await desktop.initialize();
  const delivery = new TranscriptDelivery({
    writeText: text => editor.evaluate(({ clipboard }, value) => clipboard.writeText(value), text),
    readText: () => editor.evaluate(({ clipboard }) => clipboard.readText()),
    // 'always' keeps the transcript copied, so delivery never saves the earlier contents.
    save: () => () => {},
  }, signal => desktop.captureTarget(signal));

  await delivery.begin();
  const text = 'Grüße from Linux\nSecond line';
  assert.deepEqual(await delivery.deliver({ text }, delivery.revision, 'always'), { text, delivery: 'pasted-and-copied' });
  await expect(field).toHaveValue(text);
  assert.equal(await page.evaluate(() => window.enterKeys), 0, 'Paste must never submit by sending Enter.');

  // A second window must not receive a transcript started in the first window.
  await delivery.begin();
  const other = await editor.evaluate(async ({ BrowserWindow }) => {
    const window = new BrowserWindow({ width: 320, height: 160 });
    await window.loadURL('data:text/html,<textarea autofocus></textarea>');
    return window.getNativeWindowHandle().readUInt32LE();
  });
  await execute('xdotool', ['windowfocus', '--sync', String(other)], { timeout: 1500 });
  const shifted = await delivery.deliver({ text: 'manual recovery' }, delivery.revision, 'always');
  assert.deepEqual(shifted, { text: 'manual recovery', delivery: 'copied' });
  assert.equal(await editor.evaluate(({ clipboard }) => clipboard.readText()), 'manual recovery');
  assert.equal(await editor.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows()
    .find(window => window.getNativeWindowHandle().readUInt32LE() === id)
    .webContents.executeJavaScript('document.querySelector("textarea").value'), other), '');
  await expect(field).toHaveValue(text);

  await execute('xdotool', ['windowfocus', '--sync', String(id)], { timeout: 1500 });
  await delivery.begin();
  const cancelled = delivery.revision;
  delivery.cancel();
  assert.deepEqual(await delivery.deliver({ text: 'stale transcript' }, cancelled, 'always'), { cancelled: true });
  await expect(field).toHaveValue(text);
  console.log('Linux X11: real window-targeted paste, Unicode, no Enter, focus-change recovery, and cancelled delivery passed. No microphone, login, or network request used.');
} finally {
  await editor?.close();
  await rm(directory, { recursive: true, force: true });
}
