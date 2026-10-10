import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MacKeyboard } from '../src/main/keyboard.ts';

test('a helper that stops during a hold interrupts the hold, then leaves the fallback in charge',
  { skip: process.platform === 'win32', timeout: 5000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'einsager keyboard '));
    const file = join(directory, 'helper');
    await writeFile(file, `#!/bin/sh\necho '{"event":"action","action":"holdPressed"}'\n`, { mode: 0o755 });
    try {
      const events: unknown[] = [];
      await new Promise<void>(resolve => {
        new MacKeyboard(file, state => { events.push(state); resolve(); }, action => events.push(action)).start();
      });
      assert.deepEqual(events, ['holdPressed', 'interrupted', undefined]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

/** Writes a fake helper that reports a trusted state, then answers each target or paste command with `answer`. */
async function fakeHelper(directory: string, answer: string) {
  const file = join(directory, 'helper');
  await writeFile(file, `#!/usr/bin/env node
const log = ${JSON.stringify(join(directory, 'commands.log'))};
console.log(JSON.stringify({ event: 'state', trusted: true, hold: 'Fn', handsFree: 'Fn+Space' }));
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  require('node:fs').appendFileSync(log, message.command + ' ' + message.id + '\\n');
  ${answer}
});
`, { mode: 0o755 });
  return file;
}

test('a paste goes only to the captured target, and only while the clipboard holds the transcript',
  { skip: process.platform === 'win32', timeout: 5000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'einsager keyboard '));
    const keyboard = new MacKeyboard(await fakeHelper(directory,
      `console.log(JSON.stringify({ event: 'reply', id: message.id, ok: true }));`), () => {}, () => {});
    try {
      await keyboard.start();
      const signal = new AbortController().signal;
      const paste = await keyboard.captureTarget(signal);
      assert.ok(paste);
      assert.equal(await paste(async () => false, signal), false, 'A changed clipboard must not be pasted');
      assert.equal(await paste(async () => true, signal), true);
      assert.equal(await readFile(join(directory, 'commands.log'), 'utf8'), 'target 1\npaste 1\n');
    } finally {
      keyboard.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });

test('without a target, or when the helper stops, the transcript stays for manual paste',
  { skip: process.platform === 'win32', timeout: 5000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'einsager keyboard '));
    // Declines targets, as without Accessibility access, and exits instead of answering a paste.
    const keyboard = new MacKeyboard(await fakeHelper(directory, `
      if (message.command === 'paste') process.exit(0);
      console.log(JSON.stringify({ event: 'reply', id: message.id, ok: message.id !== '1' }));`), () => {}, () => {});
    try {
      await keyboard.start();
      const signal = new AbortController().signal;
      assert.equal(await keyboard.captureTarget(signal), undefined);
      const paste = await keyboard.captureTarget(signal);
      assert.ok(paste);
      assert.equal(await paste(async () => true, signal), false);
      assert.equal(await keyboard.captureTarget(signal), undefined, 'A stopped helper captures nothing');
    } finally {
      keyboard.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });
