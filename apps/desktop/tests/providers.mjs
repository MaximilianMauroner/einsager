import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'einsager-provider-tests-'));
const profile = join(directory, 'profile');
const codex = join(directory, 'empty-codex');
await mkdir(profile);
await mkdir(codex);
await writeFile(join(profile, 'settings.json'), '{"clipboard":"never"}');
let application;
try {
  application = await electron.launch({ args: ['.', `--user-data-dir=${profile}`, '--use-fake-ui-for-media-stream'],
    env: { ...process.env, CODEX_HOME: codex } });
  const page = await application.firstWindow();
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .some(window => window.webContents.getURL().endsWith('panel.html')))).toBe(true);
  await application.evaluate(({ clipboard }) => {
    let value = '';
    clipboard.readText = async () => value;
    clipboard.writeText = async text => { value = text; };
    clipboard.clear = () => { value = ''; };
  });
  await page.getByRole('button', { name: 'Start hands-free dictation' }).waitFor();
  const panelCall = (method, value) => application.evaluate(async ({ BrowserWindow }, { method, value }) => {
    const panel = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('panel.html'));
    return panel.webContents.executeJavaScript(`window.einsagerPanel[${JSON.stringify(method)}](${value === undefined ? '' : JSON.stringify(value)})`);
  }, { method, value });
  const panelScript = script => application.evaluate(({ BrowserWindow }, script) => BrowserWindow.getAllWindows()
    .find(window => window.webContents.getURL().endsWith('panel.html')).webContents.executeJavaScript(script), script);
  const mockDialog = response => application.evaluate(({ dialog }, response) => {
    dialog.showMessageBox = async (...args) => {
      const options = args.at(-1);
      globalThis.providerTestDialog = options;
      return { response, checkboxChecked: false };
    };
  }, response);
  let state = await panelCall('state');
  assert.equal(state.settings.provider, 'codex-login');
  assert.equal(state.hasApiKey, false);
  await mockDialog(0);
  assert.deepEqual(await page.evaluate(() => window.einsager.begin()), { cancelled: true });
  const warning = await application.evaluate(() => globalThis.providerTestDialog);
  assert.equal(warning.cancelId, 0);
  assert.equal(warning.defaultId, 0);
  assert.match(warning.detail, /may violate OpenAI's Terms of Service/);
  assert.deepEqual(warning.buttons, ['Cancel', 'Continue with Codex login']);
  let stored = JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8'));
  assert.notEqual(stored.codexLoginAcknowledged, true);
  await mockDialog(1);
  assert.ok('microphone' in await page.evaluate(() => window.einsager.begin()));
  stored = JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8'));
  assert.equal(stored.provider, 'codex-login');
  assert.equal(stored.codexLoginAcknowledged, true);
  await panelCall('selectProvider', 'api-key');
  assert.deepEqual(await page.evaluate(() => window.einsager.begin()), { error: 'Add an OpenAI API key in Settings.' });
  await mockDialog(0);
  await panelCall('selectProvider', 'codex-login');
  assert.equal((await panelCall('state')).settings.provider, 'api-key');
  await panelScript(`document.querySelector('[aria-label="Settings"]').click()`);
  await expect.poll(() => panelScript('document.body.innerText')).toContain('Claim subscription credits');
  await panelScript(`document.querySelectorAll('input[name="provider"]')[1].click()`);
  await expect.poll(() => panelScript(`document.querySelectorAll('input[name="provider"]')[0].checked`)).toBe(true);
  assert.equal((await panelCall('state')).settings.provider, 'api-key');
  await panelCall('update', { provider: 'codex-login', codexLoginAcknowledged: true, apiKey: 'sk-must-not-store' });
  assert.equal((await panelCall('state')).settings.provider, 'api-key');
  await application.evaluate(({ safeStorage }) => {
    safeStorage.isEncryptionAvailable = () => true;
    safeStorage.getSelectedStorageBackend = () => 'test-secure-backend';
    safeStorage.encryptString = value => Buffer.from(value.split('').reverse().join(''));
    safeStorage.decryptString = value => value.toString().split('').reverse().join('');
  });
  await mockDialog(1);
  await application.evaluate(async ({ clipboard }) => { await clipboard.writeText('sk-fixture-only-key'); });
  assert.deepEqual(await panelCall('importApiKey'), {});
  state = await panelCall('state');
  assert.equal(state.hasApiKey, true);
  assert.equal(state.settings.provider, 'api-key');
  assert.equal(JSON.stringify(state).includes('sk-fixture-only-key'), false);
  assert.equal(await application.evaluate(({ clipboard }) => clipboard.readText()), '');
  stored = await readFile(join(profile, 'settings.json'), 'utf8');
  assert.equal(stored.includes('sk-fixture-only-key'), false);
  assert.equal((await readFile(join(profile, 'openai-api-key.enc'), 'utf8')).includes('sk-fixture-only-key'), false);
  await mockDialog(1);
  await panelCall('selectProvider', 'codex-login');
  await application.evaluate(async ({ safeStorage, clipboard }) => {
    safeStorage.getSelectedStorageBackend = () => 'basic_text';
    await clipboard.writeText('sk-rejected-fixture-key');
  });
  assert.match((await panelCall('importApiKey')).error, /Secure key storage is unavailable/);
  assert.equal((await panelCall('state')).settings.provider, 'codex-login');
  assert.equal((await panelCall('state')).hasApiKey, true);
  assert.equal(await application.evaluate(({ clipboard }) => clipboard.readText()), 'sk-rejected-fixture-key');
  await application.evaluate(({ safeStorage, clipboard }) => {
    safeStorage.getSelectedStorageBackend = () => 'test-secure-backend';
    clipboard.clear();
  });
  await panelCall('selectProvider', 'api-key');
  assert.ok('microphone' in await page.evaluate(() => window.einsager.begin()));
  await page.evaluate(() => window.einsager.cancel());
  assert.deepEqual(await panelCall('removeApiKey'), {});
  assert.equal((await panelCall('state')).hasApiKey, false);
  assert.equal((await panelCall('state')).settings.provider, 'api-key');
  await assert.rejects(readFile(join(profile, 'openai-api-key.enc')), { code: 'ENOENT' });
  await mockDialog(0);
  assert.deepEqual(await panelCall('importApiKey'), {});
  assert.equal((await panelCall('state')).hasApiKey, false);
  console.log('Passed provider migration, consent cancellation, explicit selection, main-process key import, secret isolation, and removal.');
} finally {
  await application?.close();
  await rm(directory, { recursive: true, force: true });
}
