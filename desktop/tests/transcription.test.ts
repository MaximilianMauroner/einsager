import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { TranscriptionSession } from '../transcription.ts';

async function fixture(source: string) {
  const directory = await mkdtemp(join(tmpdir(), 'einsager test '));
  const helper = join(directory, 'helper.cjs');
  await writeFile(helper, source);
  const marker = join(directory, 'audio-path');
  return { directory, marker, session: new TranscriptionSession({ file: process.execPath, args: [helper] }, { ...process.env, EINSAGER_TEST_PATH: marker }) };
}

test('helper arguments preserve spaces; successful audio is deleted', async () => {
  const { directory, marker, session } = await fixture(`const fs = require('fs'); const file = process.argv[2];
    fs.writeFileSync(process.env.EINSAGER_TEST_PATH, file);
    console.log(JSON.stringify({ text: fs.readFileSync(file).toString() }));`);
  try {
    assert.deepEqual(await session.transcribe(new TextEncoder().encode('Grüße from desktop').buffer), { text: 'Grüße from desktop' });
    await assert.rejects(readFile(await readFile(marker, 'utf8')), { code: 'ENOENT' });
    assert.ok('error' in await session.retry());
  } finally { await session.cancel(); await rm(directory, { recursive: true, force: true }); }
});

test('failure retains audio for Retry and cancellation removes it', async () => {
  const { directory, marker, session } = await fixture(`const fs = require('fs'); const file = process.argv[2];
    fs.writeFileSync(process.env.EINSAGER_TEST_PATH, file);
    if (!fs.existsSync(file + '.attempt')) { fs.writeFileSync(file + '.attempt', ''); console.log('{"error":"retry me"}'); process.exitCode = 1; }
    else console.log('{"text":"recovered"}');`);
  try {
    assert.deepEqual(await session.transcribe(new Uint8Array([1]).buffer), { error: 'retry me', retryable: true });
    const audioPath = await readFile(marker, 'utf8');
    assert.equal((await readFile(audioPath)).length, 1);
    assert.deepEqual(await session.retry(), { text: 'recovered' });
    await assert.rejects(readFile(audioPath), { code: 'ENOENT' });
    assert.ok('error' in await session.retry());
  } finally { await session.cancel(); await rm(directory, { recursive: true, force: true }); }
});

test('a newer recording replaces a running helper without delivering its text', async () => {
  const { directory, session } = await fixture(`const fs = require('fs'); const text = fs.readFileSync(process.argv[2]).toString();
    setTimeout(() => console.log(JSON.stringify({ text })), text === 'old' ? 1000 : 0);`);
  try {
    const old = session.transcribe(new TextEncoder().encode('old').buffer);
    await setTimeout(100);
    assert.deepEqual(await session.transcribe(new TextEncoder().encode('new').buffer), { text: 'new' });
    assert.deepEqual(await old, { cancelled: true });
  } finally { await session.cancel(); await rm(directory, { recursive: true, force: true }); }
});

test('a cancelled helper cannot return a stale transcript', async () => {
  const { directory, session } = await fixture(`setTimeout(() => console.log('{"text":"stale"}'), 1000);`);
  try {
    const pending = session.transcribe(new Uint8Array([1]).buffer);
    await setTimeout(100);
    await session.cancel();
    assert.deepEqual(await pending, { cancelled: true });
  } finally { await session.cancel(); await rm(directory, { recursive: true, force: true }); }
});

test('saving failure removes partial audio and disables Retry without launching the helper', async () => {
  const { directory, marker, session } = await fixture(`require('fs').writeFileSync(process.env.EINSAGER_TEST_PATH, 'started');`);
  const originalWrite = fs.writeFile;
  let audioPath: string | undefined;
  const failure = mock.method(fs, 'writeFile', async (...args: Parameters<typeof fs.writeFile>) => {
    if (typeof args[0] === 'string' && args[0].endsWith('recording.wav')) {
      audioPath = args[0];
      await originalWrite(audioPath, new Uint8Array([1]), { mode: 0o600 });
      throw Object.assign(new Error('Disk full'), { code: 'ENOSPC' });
    }
    return originalWrite(...args);
  });
  syncBuiltinESMExports();
  try {
    const result = await session.transcribe(new Uint8Array([1, 2, 3]).buffer);
    assert.ok(audioPath);
    await assert.rejects(fs.stat(dirname(audioPath)), { code: 'ENOENT' });
    assert.deepEqual(result, { error: 'Cannot save recording. Check available disk space.', retryable: false });
    assert.deepEqual(await session.retry(), { error: 'No recording to retry. Start a new dictation.', retryable: false });
    await assert.rejects(readFile(marker), { code: 'ENOENT' });
  } finally {
    failure.mock.restore();
    syncBuiltinESMExports();
    await session.cancel();
    await rm(directory, { recursive: true, force: true });
  }
});

test('temporary directory failure returns a nonretryable recovery error', async () => {
  const { directory, marker, session } = await fixture(`require('fs').writeFileSync(process.env.EINSAGER_TEST_PATH, 'started');`);
  const failure = mock.method(fs, 'mkdtemp', async () => { throw Object.assign(new Error('Disk full'), { code: 'ENOSPC' }); });
  syncBuiltinESMExports();
  try {
    assert.deepEqual(await session.transcribe(new Uint8Array([1]).buffer),
      { error: 'Cannot save recording. Check available disk space.', retryable: false });
    assert.deepEqual(await session.retry(), { error: 'No recording to retry. Start a new dictation.', retryable: false });
    await assert.rejects(readFile(marker), { code: 'ENOENT' });
  } finally {
    failure.mock.restore();
    syncBuiltinESMExports();
    await session.cancel();
    await rm(directory, { recursive: true, force: true });
  }
});
