import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
