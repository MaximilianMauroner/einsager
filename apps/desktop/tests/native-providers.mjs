import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { compileNative } from '../scripts/native-macos.mjs';

assert.equal(process.platform, 'darwin');
await mkdir('target/tests', { recursive: true });
compileNative('target/tests/einsager-native-provider-tests', { tests: true,
  extraSources: ['apps/desktop/native/macos/tests/NativeTests.swift'] });
execFileSync('swiftc', ['-j', '1', '-Osize', 'apps/desktop/native/macos/tests/FixtureTranscribe.swift',
  '-parse-as-library', '-o', 'target/tests/provider-fixture-transcribe'], { stdio: 'inherit' });
const directory = await mkdtemp(join(tmpdir(), 'einsager-native-provider-tests-'));
const profile = join(directory, 'profile');
const helper = join(directory, 'helper');
await copyFile('target/tests/provider-fixture-transcribe', helper);
await writeFile(join(directory, 'response.json'), JSON.stringify({ reply: { text: 'API key via stdin verified' } }));
const child = spawn(resolve('target/tests/einsager-native-provider-tests'), [profile, helper], { stdio: ['pipe', 'pipe', 'pipe'] });
const closed = new Promise(resolve => child.once('close', resolve));
const pending = new Map();
let serial = 0;
let state;
let errors = '';
child.stderr.on('data', data => { errors += data; });
createInterface({ input: child.stdout }).on('line', line => {
  const value = JSON.parse(line);
  if (value.state) state = value.state;
  if (value.id) pending.get(value.id)?.(value);
});
const send = (command, fields = {}) => new Promise((resolve, reject) => {
  const id = ++serial;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Native ${command} timed out. ${errors}`)); }, 15_000);
  pending.set(id, value => { clearTimeout(timer); pending.delete(id); value.error ? reject(new Error(value.error)) : resolve(value); });
  child.stdin.write(JSON.stringify({ command, id, ...fields }) + '\n');
});
try {
  await send('units');
  assert.equal(state.settings.provider, 'api-key');
  await send('start');
  await send('append', { seconds: 0.6 });
  await send('finish');
  const deadline = Date.now() + 10_000;
  while (state.phase === 'processing' && Date.now() < deadline) await delay(20);
  assert.equal(state.phase, 'message', state.message);
  assert.equal(state.history.at(-1).text, 'API key via stdin verified');
  assert.equal(JSON.stringify(state).includes('sk-fixture-only-key'), false);
  await send('cancel');
  await send('settings', { values: { provider: 'codex-login', codexLoginAcknowledged: false } });
  await send('providerConsent', { accept: false });
  await send('start');
  assert.equal(state.phase, 'idle');
  assert.equal(state.recordingFolder, '');
  assert.equal(state.settings.codexLoginAcknowledged, false);
  await send('providerConsent', { accept: true });
  await send('start');
  assert.equal(state.phase, 'recording');
  assert.equal(state.settings.codexLoginAcknowledged, true);
  await send('cancel');
  const stored = await readFile(join(profile, 'settings.json'), 'utf8');
  assert.equal(stored.includes('sk-fixture-only-key'), false);
  await send('keychain');
  console.log('Passed native provider migration, cancelled and accepted consent, helper stdin boundary, secret isolation, and isolated Keychain save/read/remove.');
} finally {
  child.stdin.end();
  child.kill();
  await closed;
  await rm(directory, { recursive: true, force: true });
}
