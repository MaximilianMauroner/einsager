import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrivateFile, retryWhileInUse } from '../src/main/private-file.ts';

async function withFile(run: (file: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'einsager-private-file-'));
  try { await run(join(directory, 'settings.json')); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

/** The error Node reports when Windows refuses the replacement, as in issue #10. */
const failure = (code: string) => Object.assign(new Error(`${code}: rename`), { code, syscall: 'rename' });

test('a file in use for a moment still gets each write, in order', () => withFile(async file => {
  await new PrivateFile(file).write('previous');
  const attempts: { replacing: string; onDisk: string }[] = [];
  const refusals = ['EPERM', 'EBUSY'];
  const settings = new PrivateFile(file, retryWhileInUse(async (from, to) => {
    attempts.push({ replacing: await readFile(from, 'utf8'), onDisk: await readFile(to, 'utf8') });
    const refusal = refusals.shift();
    if (refusal) throw failure(refusal);
    await rename(from, to);
  }));
  await Promise.all([settings.write('first'), settings.write('second')]);
  // The second write waits, so it cannot overwrite the temporary file while the first one tries again.
  assert.deepEqual(attempts, [
    { replacing: 'first', onDisk: 'previous' },
    { replacing: 'first', onDisk: 'previous' },
    { replacing: 'first', onDisk: 'previous' },
    { replacing: 'second', onDisk: 'first' },
  ]);
  assert.equal(await readFile(file, 'utf8'), 'second');
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
}));

test('a file that stays in use keeps the previous version, and a later write still lands', () => withFile(async file => {
  await new PrivateFile(file).write('previous');
  let blocked = true;
  let attempts = 0;
  const settings = new PrivateFile(file, retryWhileInUse(async (from, to) => {
    attempts++;
    if (blocked) throw failure('EPERM');
    await rename(from, to);
  }));
  await assert.rejects(settings.write('lost'), { code: 'EPERM' });
  assert.ok(attempts > 1, 'A file in use is tried again before the write fails');
  assert.equal(await readFile(file, 'utf8'), 'previous');
  blocked = false;
  await settings.write('next');
  assert.equal(await readFile(file, 'utf8'), 'next');
}));

test('other replacement errors are reported at once', () => withFile(async file => {
  await new PrivateFile(file).write('previous');
  let attempts = 0;
  const settings = new PrivateFile(file, retryWhileInUse(async () => {
    attempts++;
    throw failure('EROFS');
  }));
  await assert.rejects(settings.write('next'), { code: 'EROFS' });
  assert.equal(attempts, 1);
  assert.equal(await readFile(file, 'utf8'), 'previous');
}));
