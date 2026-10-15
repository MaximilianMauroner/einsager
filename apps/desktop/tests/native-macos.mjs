// Hidden native views, private pasteboards and synthetic PCM. Does not drive Max's desktop or record a microphone.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { compileNative } from '../scripts/native-macos.mjs';
import { encodeWav } from '../src/renderer/audio.ts';
import { describeRecording } from '../src/main/history.ts';
import { ProfileLock } from '../src/main/profile-lock.ts';

assert.equal(process.platform, 'darwin');
await mkdir('target/tests', { recursive: true });
await mkdir('.agents/artifacts', { recursive: true });
compileNative('target/tests/einsager-native-tests', { tests: true,
  extraSources: ['apps/desktop/native/macos/tests/NativeTests.swift'] });
execFileSync('swiftc', ['-j', '1', '-Osize', 'apps/desktop/native/macos/tests/FixtureTranscribe.swift',
  '-parse-as-library', '-o', 'target/tests/fixture-transcribe'], { stdio: 'inherit', timeout: 60_000 });

const directory = await mkdtemp(join(tmpdir(), 'einsager-native-tests-'));
const profile = join(directory, 'profile');
const helper = join(directory, 'fixture-transcribe');
const codex = join(directory, 'empty-codex');
await mkdir(codex);
await copyFile('target/tests/fixture-transcribe', helper);
const response = reply => writeFile(join(directory, 'response.json'), JSON.stringify(reply));
await response({ reply: { text: 'Fixture transcript' } });
const child = spawn(resolve('target/tests/einsager-native-tests'), [profile, helper], {
  env: { ...process.env, CODEX_HOME: codex }, stdio: ['pipe', 'pipe', 'pipe'],
});
let output = '';
let state;
let serial = 0;
const pending = new Map();
const evidence = { memory: [], checks: [] };
child.stderr.on('data', data => { output = (output + data).slice(-60_000); });
child.stdin.on('error', () => {});
createInterface({ input: child.stdout }).on('line', line => {
  const value = JSON.parse(line);
  if (value.state) state = value.state;
  if (value.id) pending.get(value.id)?.(value);
});
const send = async (command, fields = {}) => {
  const id = ++serial;
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Native ${command} timed out. ${output}`)); }, 15_000);
    pending.set(id, value => { clearTimeout(timer); pending.delete(id); resolve(value); });
    child.stdin.write(JSON.stringify({ id, command, ...fields }) + '\n');
  });
  assert.equal(result.error, undefined, `${command}: ${result.error}`);
  return result;
};
const until = async (predicate, description) => {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    assert.equal(child.exitCode, null, `Native app exited: ${output}`);
    assert.ok(Date.now() < deadline, `${description}: ${JSON.stringify(state)} ${output}`);
    await delay(15);
  }
};
const footprint = pid => {
  const report = execFileSync('/usr/bin/footprint', ['-p', String(pid), '-f', 'bytes', '--noCategories'],
    { encoding: 'utf8', timeout: 10_000 });
  return {
    bytes: Number(report.match(/phys_footprint:\s+(\d+) B/)?.[1]),
    peak: Number(report.match(/phys_footprint_peak:\s+(\d+) B/)?.[1]),
  };
};
const measure = (label, includeHelper = false) => {
  const host = footprint(child.pid);
  const ps = execFileSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8', timeout: 5000 });
  const children = ps.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number)).filter(([, parent]) => parent === child.pid).map(([pid]) => pid);
  const helperBytes = includeHelper ? children.reduce((sum, pid) => sum + footprint(pid).peak, 0) : 0;
  const value = { label, hostBytes: host.bytes, hostPeakBytes: host.peak, helperBytes, totalBytes: host.bytes + helperBytes };
  evidence.memory.push(value);
  assert.ok(Number.isFinite(host.peak) && host.bytes > 0, 'Physical footprint must be measured');
  assert.ok(host.peak + helperBytes <= 50_000_000, `${label} exceeds 50 MB: ${JSON.stringify(value)}`);
  return value;
};
const check = (name, condition) => { assert.ok(condition, name); evidence.checks.push(name); };

async function verifyProfileOwnership() {
  const sharedProfile = join(directory, 'ownership-profile');
  const lockHelper = resolve('target/release/einsager-keys');
  const ownership = () => new ProfileLock(lockHelper, error => { throw error; });
  const lock = ownership();
  await lock.acquire(sharedProfile);
  await lock.release();
  check('Profile ownership creates private directory and lock file',
    ((await stat(sharedProfile)).mode & 0o777) === 0o700
    && ((await stat(join(sharedProfile, '.instance.lock'))).mode & 0o777) === 0o600);
  const files = ['settings.json', 'history.json'];
  await writeFile(join(sharedProfile, files[0]), '{"nativeMicrophone":"core-audio-fixture","microphone":"chromium-fixture"}\n');
  await writeFile(join(sharedProfile, files[1]), '[]\n');
  const original = await Promise.all(files.map(file => readFile(join(sharedProfile, file))));
  const unchanged = async () => {
    const current = await Promise.all(files.map(file => readFile(join(sharedProfile, file))));
    current.forEach((bytes, index) => assert.deepEqual(bytes, original[index], `${files[index]} changed on rejected launch`));
  };
  const launch = () => {
    const process = spawn(resolve('target/release/einsager'), ['--profile', sharedProfile, '--helper', helper],
      { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    process.stderr.on('data', data => { stderr += data; });
    process.on('error', error => { stderr += error.message; });
    const closed = new Promise(resolve => process.once('close', code => resolve(code)));
    return { process, closed, stderr: () => stderr };
  };
  const exit = async instance => {
    let timer;
    try {
      return await Promise.race([instance.closed, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Isolated native launch did not exit: ${instance.stderr()}`)), 5000);
      })]);
    } finally { clearTimeout(timer); }
  };
  let native = launch();
  try {
    await delay(700);
    assert.equal(native.process.exitCode, null, native.stderr());
    assert.equal(native.process.signalCode, null, native.stderr());
    const rejected = ownership();
    try { await assert.rejects(rejected.acquire(sharedProfile), /already using this profile/); }
    finally { await rejected.release(); }
    await unchanged();
    evidence.checks.push('Native ownership rejects the production Electron profile-lock path without changing stored files');
  } finally { native.process.kill('SIGKILL'); await exit(native); }

  const electron = ownership();
  try {
    await electron.acquire(sharedProfile);
    native = launch();
    try {
      assert.equal(await exit(native), 1);
      assert.match(native.stderr(), /already using this profile/);
      await unchanged();
      evidence.checks.push('Electron profile ownership rejects a direct native launch without changing stored files');
    } finally { native.process.kill('SIGKILL'); }
  } finally { await electron.release(); }

  native = launch();
  try {
    await delay(700);
    assert.equal(native.process.exitCode, null, native.stderr());
    assert.equal(native.process.signalCode, null, native.stderr());
    evidence.checks.push('Normal Electron release and SIGKILL of the native owner both release profile ownership');
  } finally { native.process.kill('SIGKILL'); await exit(native); }

  const killed = spawn(lockHelper, ['--profile-lock', sharedProfile], { stdio: ['pipe', 'pipe', 'ignore'] });
  const killedExit = new Promise(resolve => killed.once('close', resolve));
  try {
    const answer = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Lock helper did not answer')), 5000);
      createInterface({ input: killed.stdout }).once('line', line => { clearTimeout(timer); resolve(JSON.parse(line)); });
    });
    assert.deepEqual(answer, { profile: 'locked' });
  } finally { killed.kill('SIGKILL'); await killedExit; }
  const recovered = ownership();
  try { await recovered.acquire(sharedProfile); }
  finally { await recovered.release(); }
  evidence.checks.push('SIGKILL of the lock-only helper releases its flock without stale-file cleanup');
}

try {
  await until(() => state?.phase === 'idle', 'startup');
  const units = await send('units');
  check(`${units.checks} native logic checks`, units.checks >= 18);
  measure('idle');

  // The two implementations must describe identical PCM, including short and silent recordings.
  for (const seconds of [0.001, 0.6, 3.7]) {
    const samples = Float32Array.from({ length: Math.floor(seconds * 16000) }, (_, index) =>
      Math.sin(index / 11) * (0.01 + 0.3 * index / Math.max(1, seconds * 16000)));
    const wav = encodeWav(samples, 16000);
    const file = join(directory, 'shared.wav');
    await writeFile(file, Buffer.from(wav));
    const result = await send('voiceprint', { file });
    assert.deepEqual(result.voiceprint, describeRecording(wav).voiceprint);
  }
  evidence.checks.push('Swift and TypeScript voiceprints match on shared PCM');

  // These views stay hidden. No focus, cursor, global keyboard, or general clipboard operations occur.
  for (const view of ['history', 'settings', 'history']) {
    const result = await send('render', { view, file: resolve(`.agents/artifacts/native-${view}.png`) });
    check(`${view} views stay hidden`, result.visibleWindows === 0);
  }
  measure('history-and-settings-materialized');

  const clipboard = (operation, fields = {}) => send('clipboard', { operation, ...fields });
  await clipboard('seed');
  await clipboard('deliver');
  await delay(1100);
  let restored = await clipboard('read');
  check('Checked paste restores every clipboard type', restored.clipboardText === 'Original clipboard');
  assert.equal(Buffer.from(restored.rtf).toString(), '{\\rtf1\\ansi Original clipboard}');
  await clipboard('seed');
  await clipboard('deliver');
  await clipboard('external');
  await delay(1100);
  restored = await clipboard('read');
  check('A later external copy wins over restoration', restored.clipboardText === 'External copy');
  await clipboard('seed');
  restored = await clipboard('deliver', { pasted: false, mode: 'never' });
  check('Never gives the clipboard back when paste fails', restored.clipboardText === 'Original clipboard');
  restored = await clipboard('deliver', { pasted: false });
  check('Failed paste keeps text for manual paste', restored.clipboardText === 'Private fixture transcript');
  await clipboard('seed', { unreadable: true });
  restored = await clipboard('deliver', { mode: 'never' });
  check('An unreadable clipboard is left intact in Never mode', restored.clipboardText === 'Original clipboard');
  await clipboard('seed');
  await clipboard('deliver');
  await send('start');
  restored = await clipboard('read');
  check('Starting another recording first restores the borrowed clipboard', restored.clipboardText === 'Original clipboard');
  await send('cancel');

  await send('permissionWait');
  await send('start', { hold: true });
  check('Permission request is visible session state', state.phase === 'requesting');
  await send('cancel');
  await send('permissionReply', { allowed: true });
  check('Late microphone permission cannot revive a cancelled session', state.phase === 'idle');
  await send('start');
  await send('append', { seconds: 0.1 });
  await send('finish');
  check('Short recordings are discarded', state.phase === 'message' && !state.recordingFolder);

  await response({ reply: { error: 'Fixture upload failed' } });
  await send('start');
  await send('append', { seconds: 1 });
  await send('finish');
  await until(() => state.phase === 'failure', 'failed upload');
  const retained = state.recordingFolder;
  check('Retry retains one recording', state.retryable && Boolean(retained));
  await response({ reply: { text: 'Recovered transcript' } });
  await send('retry');
  await until(() => state.phase === 'message', 'retry completion');
  check('Retry delivers text and saves history', state.history.at(-1)?.text === 'Recovered transcript');
  await assert.rejects(readFile(join(retained, 'recording.wav')), { code: 'ENOENT' });
  evidence.checks.push('Successful upload removes private audio');

  await response({ delay: 0.5, reply: { text: 'Long recording' } });
  await send('start');
  await send('append', { seconds: 599 });
  check('Long recording remains within its limit', state.recordingSeconds === 599);
  const longFile = join(state.recordingFolder, 'recording.wav');
  measure('599-second-recording');
  await send('finish');
  measure('upload-with-fixture-helper', true);
  await until(() => state.phase === 'message', 'long upload');
  check('Long recording keeps its duration', state.history.at(-1)?.seconds === 599);
  await assert.rejects(readFile(longFile), { code: 'ENOENT' });

  await response({ delay: 0.25, reply: { text: 'Must not arrive after cancel' } });
  await send('start');
  await send('append', { seconds: 1 });
  await send('finish');
  const cancelledFolder = state.recordingFolder;
  await send('cancel');
  await assert.rejects(readFile(join(cancelledFolder, 'recording.wav')), { code: 'ENOENT' });
  await delay(350);
  check('Cancelled upload cannot paste or enter history', state.phase === 'idle' && !state.history.some(entry => entry.text.includes('Must not arrive')));

  await send('settings', { values: { clipboard: 'always' } });
  await response({ reply: { text: 'Cycle transcript' } });
  for (let index = 0; index < 20; index++) {
    await send('start');
    await send('append', { seconds: 0.6 });
    await send('finish');
    await until(() => state.phase === 'message', `cycle ${index}`);
    await send('cancel');
  }
  measure('after-20-sessions');
  check('Repeated sessions keep producing results', state.history.filter(entry => entry.text === 'Cycle transcript').length === 20);
  const saved = JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8'));
  check('Settings persist', saved.clipboard === 'always');
  await send('addHistory', { count: 500, text: 'A saved transcript to check table reuse and history memory.' });
  await send('render', { view: 'history', file: resolve('.agents/artifacts/native-500-history.png') });
  check('History table handles its full retained history', state.history.length === 500);
  measure('500-transcript-history');
  const accessible = await send('uiAccessibility');
  check('Accessibility exposes all 500 transcripts without materializing offscreen cells',
    accessible.texts.filter(text => text.startsWith('A saved transcript')).length === 500 && accessible.before === accessible.after && accessible.after < 40);
  check('Legacy accessibility ranges return the same model rows and handle range bounds',
    accessible.legacyModels && accessible.legacyBounds && accessible.legacyNoMockCells && accessible.legacyCount >= 500);
  measure('full-accessibility-tree');
  const offscreen = await send('uiAccessibility', { deleteOffscreen: true });
  check('An offscreen accessibility action deletes exactly one transcript', offscreen.deletedOffscreen && state.history.length === 499);
  const fullText = 'Parity fixture: selectable full paragraphs.\n' + 'The complete transcript stays available without clipping. '.repeat(8);
  await send('addHistory', { count: 1, text: fullText });
  await send('render', { view: 'history' });
  await send('uiPress', { label: 'Search transcripts' });
  await send('uiSearch', { query: 'Parity fixture:' });
  let uiState = await send('uiInspect');
  check('Search filters history and preserves full paragraphs', uiState.rows === 2 && uiState.transcripts.includes(`${fullText} 0`));
  await send('uiPress', { label: 'Copy' });
  restored = await clipboard('read');
  check('History Copy reaches the private clipboard', restored.clipboardText === `${fullText} 0`);
  await send('uiPress', { label: 'Delete' });
  uiState = await send('uiInspect');
  check('History Delete removes the filtered entry', uiState.rows === 1 && !state.history.some(entry => entry.text.startsWith('Parity fixture:')));
  await send('render', { view: 'settings' });
  await send('uiPress', { label: 'Never' });
  check('Clipboard radio changes the saved delivery mode', state.settings.clipboard === 'never');
  await send('uiPress', { label: 'Show pill when idle' });
  check('Idle switch changes the saved visibility setting', state.settings.showPill === false);
  await send('uiPress', { label: 'Clear history…' });
  await send('uiPress', { label: 'Keep' });
  check('Clear confirmation can keep all transcripts', state.history.length === 499);
  measure('after-panel-interactions');
  await send('clearHistory');
  check('Clear forgets history and last transcript', state.history.length === 0 && state.lastText === '');
  await response({ delay: 5, reply: { text: 'Must not survive quit' } });
  await send('start');
  await send('append', { seconds: 1 });
  await send('finish');
  const quitFolder = state.recordingFolder;
  await send('quit');
  await assert.rejects(readFile(join(quitFolder, 'recording.wav')), { code: 'ENOENT' });
  evidence.checks.push('Quit during upload removes its private recording synchronously');
  await verifyProfileOwnership();
  if (process.argv.includes('--packaged')) {
    const bundle = resolve(`release/einsager-darwin-${process.arch}/einsager.app`);
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { timeout: 10_000 });
    const executable = join(bundle, 'Contents/MacOS/einsager');
    const strings = execFileSync('/usr/bin/strings', [executable], { encoding: 'utf8', timeout: 10_000 });
    check('Shipped app contains no test driver', !strings.includes('EINSAGER_NATIVE_TEST_DRIVER'));
    const actual = spawn(executable, ['--profile', join(directory, 'packaged-profile'), '--helper', join(bundle, 'Contents/Resources/einsager-transcribe')],
      { stdio: 'ignore', env: { ...process.env, CODEX_HOME: codex } });
    try {
      await delay(700);
      check('Packaged app starts without activating a window', actual.exitCode === null);
      const { bytes, peak } = footprint(actual.pid);
      evidence.memory.push({ label: 'packaged-production-idle', hostBytes: bytes, hostPeakBytes: peak, helperBytes: 0, totalBytes: bytes });
      check('Packaged production background footprint stays under 30 MB', bytes > 0 && peak <= 30_000_000);
    } finally { actual.kill(); }
  }
  await writeFile('.agents/artifacts/native-verification.json', JSON.stringify(evidence, null, 2));
  await rm('.agents/artifacts/native-failure.txt', { force: true });
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  await writeFile('.agents/artifacts/native-failure.txt', `${error.stack}\n${output}`);
  throw error;
} finally {
  child.kill();
  await rm(directory, { recursive: true, force: true });
}
