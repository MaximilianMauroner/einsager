// Run after pnpm build. On Linux: xvfb-run -a pnpm test:desktop.
// This uses Chromium's fake microphone and an empty Codex folder, never a real login.
import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'einsager-smoke-'));
const profile = join(directory, 'profile');
const codex = join(directory, 'empty-codex');
await mkdir(codex);
await mkdir('.agents/artifacts', { recursive: true });
let application;
try {
  application = await electron.launch({
    args: ['.', `--user-data-dir=${profile}`, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    env: { ...process.env, CODEX_HOME: codex },
  });
  const page = await application.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: 'Start hands-free dictation' }).waitFor();
  await page.screenshot({ path: '.agents/artifacts/desktop-idle.png', omitBackground: true });
  await page.getByRole('button', { name: 'Start hands-free dictation' }).click();
  await page.getByRole('button', { name: 'Finish dictation' }).waitFor();
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('action', 'copy');
  });
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole('button', { name: 'Finish dictation' }).count(), 1,
    'A tray Copy action must keep recording controls visible');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: '.agents/artifacts/desktop-recording.png', omitBackground: true });
  await page.getByRole('button', { name: 'Finish dictation' }).click();
  await page.getByText('Cannot read the file-based Codex login.', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByText('Cannot read the file-based Codex login.', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Cancel dictation' }).click();
  await page.getByRole('button', { name: 'Start hands-free dictation' }).waitFor();
  const info = await page.evaluate(() => window.einsager.info());
  assert.equal(info.pasteKey, process.platform === 'darwin' ? '⌘V' : 'Ctrl+V');
  assert.deepEqual(errors, []);
  console.log('Desktop launch, recording, safe Copy action, login error, Retry, and cancellation passed. No request sent.');
} finally {
  await application?.close();
  await rm(directory, { recursive: true, force: true });
}
