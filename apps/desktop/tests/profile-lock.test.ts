import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ProfileLock } from '../src/main/profile-lock.ts';

async function fixture(source: string) {
  const directory = await mkdtemp(join(tmpdir(), 'einsager-profile-lock-'));
  const file = join(directory, 'helper');
  await writeFile(file, `#!${process.execPath}\n${source}\n`, { mode: 0o755 });
  return { directory, file };
}

test('profile ownership fails closed when the helper is missing', { timeout: 5000 }, async () => {
  const lock = new ProfileLock(join(tmpdir(), 'missing-einsager-lock-helper'), () => assert.fail('Never acquired'));
  try { await assert.rejects(lock.acquire(tmpdir()), /helper stopped/); }
  finally { await lock.release(); }
});

test('busy, failed, invalid and early-exit helpers never grant ownership',
  { skip: process.platform === 'win32', timeout: 5000 }, async () => {
    for (const output of ['{"profile":"busy"}', '{"profile":"failed"}', 'invalid', '']) {
      const { directory, file } = await fixture(`process.stdout.write(${JSON.stringify(output + (output ? '\n' : ''))});`);
      const lock = new ProfileLock(file, () => assert.fail('Never acquired'));
      try { await assert.rejects(lock.acquire(directory)); }
      finally { await lock.release(); await rm(directory, { recursive: true, force: true }); }
    }
  });

test('normal release closes stdin and waits for the helper to exit without reporting a lost lock',
  { skip: process.platform === 'win32', timeout: 5000 }, async () => {
    const { directory, file } = await fixture(`
console.log('{"profile":"locked"}');
process.stdin.resume();
process.stdin.on('end', () => require('node:fs').writeFileSync(process.argv[3] + '/released', 'closed'));
`);
    const lock = new ProfileLock(file, () => assert.fail('Normal close is not a loss'));
    try {
      await lock.acquire(directory);
      await lock.release();
      assert.equal(await readFile(join(directory, 'released'), 'utf8'), 'closed');
      await assert.rejects(lock.acquire(directory), /already started or closed/);
    } finally { await lock.release(); await rm(directory, { recursive: true, force: true }); }
  });

test('loss after acquisition reports a fatal ownership error exactly once',
  { skip: process.platform === 'win32', timeout: 5000 }, async () => {
    const { directory, file } = await fixture(`console.log('{"profile":"locked"}'); setTimeout(() => process.exit(0), 50);`);
    let count = 0;
    let report: (error: Error) => void = () => {};
    const lost = new Promise<Error>(resolve => { report = resolve; });
    const lock = new ProfileLock(file, error => { count++; report(error); });
    try {
      await lock.acquire(directory);
      assert.match((await lost).message, /helper stopped/);
      await lock.release();
      assert.equal(count, 1);
    } finally { await lock.release(); await rm(directory, { recursive: true, force: true }); }
  });

test('a silent helper times out, and release cancels a pending acquisition',
  { skip: process.platform === 'win32', timeout: 5000 }, async () => {
    const { directory, file } = await fixture('process.stdin.resume();');
    const timed = new ProfileLock(file, () => assert.fail('Never acquired'), 100);
    const cancelled = new ProfileLock(file, () => assert.fail('Never acquired'));
    try {
      await assert.rejects(timed.acquire(directory), /timed out/);
      const acquisition = assert.rejects(cancelled.acquire(directory), /cancelled/);
      await cancelled.release();
      await acquisition;
    } finally {
      await timed.release(); await cancelled.release();
      await rm(directory, { recursive: true, force: true });
    }
  });
