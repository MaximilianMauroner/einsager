import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describeRecording, HISTORY_LIMIT, TranscriptHistory } from '../src/main/history.ts';
import { defaultSettings, mergeSettings, parseStoredSettings } from '../src/main/settings.ts';
import { encodeWav } from '../src/renderer/audio.ts';

async function withFile(run: (file: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'einsager-history-'));
  try { await run(join(directory, 'history.json')); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test('history survives a restart in a private file, oldest first', () => withFile(async file => {
  const history = new TranscriptHistory(file);
  await history.load();
  await history.add('first', { seconds: 2, voiceprint: [0, 1] }, 1000);
  const second = await history.add('second', { seconds: 3, voiceprint: [] }, 2000);
  const restarted = new TranscriptHistory(file);
  await restarted.load();
  assert.deepEqual(restarted.entries.map(entry => entry.text), ['first', 'second']);
  assert.deepEqual(restarted.entries[1], second);
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
}));

test('delete and clear also survive a restart', () => withFile(async file => {
  const history = new TranscriptHistory(file);
  const [first] = await Promise.all([
    history.add('delete me', { seconds: 1, voiceprint: [] }),
    history.add('keep me', { seconds: 1, voiceprint: [] }),
  ]);
  await history.remove(first.id);
  const reloaded = new TranscriptHistory(file);
  await reloaded.load();
  assert.deepEqual(reloaded.entries.map(entry => entry.text), ['keep me']);
  await reloaded.clear();
  const cleared = new TranscriptHistory(file);
  await cleared.load();
  assert.equal(cleared.entries.length, 0);
}));

test('a failed write keeps delete and clear in memory', { skip: process.platform === 'win32' }, t => withFile(async file => {
  t.mock.method(console, 'error', () => {});
  const history = new TranscriptHistory(file);
  const first = await history.add('first', { seconds: 1, voiceprint: [] });
  await history.add('second', { seconds: 1, voiceprint: [] });
  // A read-only folder rejects the temporary file, as a full or read-only volume would.
  await chmod(dirname(file), 0o500);
  try {
    await history.remove(first.id);
    assert.deepEqual(history.entries.map(entry => entry.text), ['second']);
    await history.clear();
    assert.equal(history.entries.length, 0);
    await history.settled();
  } finally { await chmod(dirname(file), 0o700); }
}));

test('settled waits until queued writes are on disk', () => withFile(async file => {
  const history = new TranscriptHistory(file);
  void history.add('first', { seconds: 1, voiceprint: [] });
  void history.add('second', { seconds: 1, voiceprint: [] });
  await history.settled();
  const reloaded = new TranscriptHistory(file);
  await reloaded.load();
  assert.deepEqual(reloaded.entries.map(entry => entry.text), ['first', 'second']);
}));

test('history keeps the newest entries and skips damaged ones', () => withFile(async file => {
  const stored = Array.from({ length: HISTORY_LIMIT + 2 }, (_, index) => ({ id: String(index), text: `entry ${index}`, at: index, seconds: 1, voiceprint: [0.5] }));
  const outOfRange = { id: 'out of range', text: 'bad date', at: 9e15, seconds: 1, voiceprint: [] };
  await writeFile(file, JSON.stringify([{ id: 'damaged', text: 7 }, ...stored, outOfRange]));
  const history = new TranscriptHistory(file);
  await history.load();
  assert.equal(history.entries.length, HISTORY_LIMIT);
  assert.equal(history.entries[0].text, 'entry 2');
  assert.ok(history.entries.every(entry => entry.id !== outOfRange.id), 'A time outside the Date range is damaged');
  await history.add('newest', { seconds: 1, voiceprint: [] });
  assert.equal(history.entries.length, HISTORY_LIMIT);
  assert.equal(history.entries.at(-1)?.text, 'newest');
  await writeFile(file, '{ not json');
  const unreadable = new TranscriptHistory(file);
  await unreadable.load();
  assert.equal(unreadable.entries.length, 0);
}));

test('a recording yields its length and a loudness shape, never its audio', () => {
  const rate = 16000;
  const samples = new Float32Array(rate * 2);
  for (let index = 0; index < samples.length; index++) {
    samples[index] = index < rate ? (index % 7) * 1e-4 : Math.sin(index / 5) * 0.5;
  }
  const { seconds, voiceprint } = describeRecording(encodeWav(samples, rate));
  assert.equal(seconds, 2);
  assert.equal(voiceprint.length, 24);
  assert.ok(voiceprint.slice(0, 12).every(level => level < 0.2), 'The quiet first second stays low');
  assert.ok(voiceprint.slice(12).every(level => level > 0.8), 'Speech-level audio fills the shape');
  assert.deepEqual(describeRecording(new Uint8Array([1, 2, 3]).buffer), { seconds: 0, voiceprint: [] });
});

test('stored settings keep valid fields; the panel cannot change the Codex folder', () => {
  assert.deepEqual(parseStoredSettings({ edge: 'left', codexHome: '/codex' }), { ...defaultSettings, edge: 'left', codexHome: '/codex' });
  assert.deepEqual(parseStoredSettings({ edge: 'middle', clipboard: 'sometimes', keepHistory: 'yes' }), defaultSettings);
  assert.deepEqual(parseStoredSettings(null), defaultSettings);
  const current = { ...defaultSettings, codexHome: '/mine' };
  assert.deepEqual(mergeSettings(current, { clipboard: 'never', keepHistory: false, codexHome: '/elsewhere' }),
    { ...current, clipboard: 'never', keepHistory: false });
});
