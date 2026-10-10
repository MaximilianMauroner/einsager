import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { TranscriptDelivery } from '../src/main/delivery.ts';
import { LinuxDesktop, linuxSession } from '../src/main/linux/desktop.ts';

/** Clipboard fakes for 'always' deliveries, which never save the old contents. */
const unused = () => () => {};

async function fixture(environment: NodeJS.ProcessEnv = { DISPLAY: ':fixture' }) {
  let focus = '42';
  let owner = String(process.pid + 1);
  let text = '';
  const keys: string[][] = [];
  const desktop = new LinuxDesktop(environment, async args => {
    if (args[0] === 'getwindowfocus') return focus;
    if (args[0] === 'getwindowpid') return owner;
    if (args[0] === 'key') keys.push(args);
    return '';
  });
  await desktop.initialize();
  const delivery = new TranscriptDelivery({
    writeText(value) { text = value; }, readText() { return text; },
    save() { const saved = text; return () => { text = saved; }; },
  }, signal => desktop.captureTarget(signal), 0);
  return { delivery, desktop, keys, clipboard: () => text, copy(value: string) { text = value; },
    focus(value: string) { focus = value; }, owner(value: string) { owner = value; } };
}

test('Wayland takes precedence over DISPLAY, including Xwayland sessions', () => {
  assert.equal(linuxSession({ DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' }), 'wayland');
  assert.equal(linuxSession({ DISPLAY: ':0', XDG_SESSION_TYPE: 'wayland' }), 'wayland');
  assert.equal(linuxSession({ DISPLAY: ':0' }), 'x11');
  assert.equal(linuxSession({}), 'headless');
});

test('X11 paste targets the original focused window and keeps Unicode recovery text', async () => {
  const app = await fixture();
  await app.delivery.begin();
  const text = 'Grüße from Linux';
  assert.deepEqual(await app.delivery.deliver({ text }, app.delivery.revision, 'always'), { text, delivery: 'pasted-and-copied' });
  assert.equal(app.clipboard(), text);
  assert.equal(app.keys.length, 1);
  assert.equal(app.keys[0][app.keys[0].indexOf('--window') + 1], '42');
  assert.equal(app.keys[0].at(-1), 'ctrl+v');
  assert.equal(await app.delivery.copyLast(), true);
});

test('a focus change copies the transcript without sending keys or forcing focus', async () => {
  const app = await fixture();
  await app.delivery.begin();
  app.focus('77');
  assert.deepEqual(await app.delivery.deliver({ text: 'kept' }, app.delivery.revision, 'always'), { text: 'kept', delivery: 'copied' });
  assert.equal(app.clipboard(), 'kept');
  assert.deepEqual(app.keys, []);
});

test('own windows and unknown window owners do not receive automatic paste', async () => {
  for (const owner of [String(process.pid), '', 'unknown']) {
    const app = await fixture();
    app.owner(owner);
    await app.delivery.begin();
    assert.equal('text' in await app.delivery.deliver({ text: 'manual' }, app.delivery.revision, 'always'), true);
    assert.equal(app.clipboard(), 'manual');
    assert.deepEqual(app.keys, []);
  }
});

test('a reused window ID with a different owner does not receive automatic paste', async () => {
  const app = await fixture();
  await app.delivery.begin();
  app.owner(String(process.pid + 2));
  assert.deepEqual(await app.delivery.deliver({ text: 'manual' }, app.delivery.revision, 'always'), { text: 'manual', delivery: 'copied' });
  assert.deepEqual(app.keys, []);
});

test('Wayland disables placement and never runs X11 commands', async () => {
  let commands = 0;
  const desktop = new LinuxDesktop({ DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' }, async () => { commands++; return ''; });
  await desktop.initialize();
  const delivery = new TranscriptDelivery({ save: unused, writeText() {}, readText() { return 'manual'; } }, signal => desktop.captureTarget(signal));
  await delivery.begin();
  assert.deepEqual(await delivery.deliver({ text: 'manual' }, delivery.revision, 'always'), { text: 'manual', delivery: 'copied' });
  assert.equal(desktop.canPositionWindow, false);
  assert.equal(commands, 0);
});

test('missing xdotool keeps recording startup and clipboard delivery usable', async () => {
  const desktop = new LinuxDesktop({ DISPLAY: ':0' }, async () => { throw new Error('ENOENT'); });
  await desktop.initialize();
  let text = '';
  const delivery = new TranscriptDelivery({ save: unused, writeText(value) { text = value; }, readText() { return text; } }, signal => desktop.captureTarget(signal));
  await delivery.begin();
  assert.deepEqual(await delivery.deliver({ text: 'manual' }, delivery.revision, 'always'), { text: 'manual', delivery: 'copied' });
  assert.equal(text, 'manual');
  assert.match(desktop.notice, /Install xdotool/);
});

test('cancellation and a newer recording reject old clipboard and paste delivery', async () => {
  const app = await fixture();
  await app.delivery.begin();
  const cancelled = app.delivery.revision;
  app.delivery.cancel();
  assert.deepEqual(await app.delivery.deliver({ text: 'cancelled' }, cancelled, 'always'), { cancelled: true });
  await app.delivery.begin();
  const replaced = app.delivery.revision;
  await app.delivery.begin();
  assert.deepEqual(await app.delivery.deliver({ text: 'old' }, replaced, 'always'), { cancelled: true });
  assert.equal(app.clipboard(), '');
  assert.deepEqual(app.keys, []);
});

test('a delayed target capture cannot overwrite a newer recording target', async () => {
  let complete: (target: () => Promise<boolean>) => void = () => {};
  let captures = 0;
  const sent: string[] = [];
  let text = '';
  const delivery = new TranscriptDelivery({ save: unused, writeText(value) { text = value; }, readText() { return text; } }, async () => {
    if (++captures === 1) return new Promise(resolve => { complete = resolve; });
    return async () => { sent.push('new'); return true; };
  });
  const old = delivery.begin();
  await delivery.begin();
  complete(async () => { sent.push('old'); return true; });
  await old;
  assert.deepEqual(await delivery.deliver({ text: 'current transcript' }, delivery.revision, 'always'), { text: 'current transcript', delivery: 'pasted-and-copied' });
  assert.deepEqual(sent, ['new']);
});

test('cancelling during the focus check aborts paste delivery', async () => {
  let release: () => void = () => {};
  let captured = false;
  let entered: () => void = () => {};
  const checking = new Promise<void>(resolve => { entered = resolve; });
  let keys = 0;
  const desktop = new LinuxDesktop({ DISPLAY: ':fixture' }, async args => {
    if (args[0] === 'getwindowpid') return String(process.pid + 1);
    if (args[0] === 'getwindowfocus') {
      if (captured) {
        entered();
        await new Promise<void>(resolve => { release = resolve; });
      }
      return '42';
    }
    if (args[0] === 'key') keys++;
    return '';
  });
  await desktop.initialize();
  let text = '';
  const delivery = new TranscriptDelivery({ save: unused, writeText(value) { text = value; }, readText() { return text; } }, signal => desktop.captureTarget(signal));
  await delivery.begin();
  captured = true;
  const pending = delivery.deliver({ text: 'copied before cancellation' }, delivery.revision, 'always');
  await checking;
  delivery.cancel();
  release();
  assert.deepEqual(await pending, { cancelled: true });
  assert.equal(keys, 0);
});

test('clipboard replacement during the focus check prevents paste and preserves new contents', async () => {
  let text = '';
  let readingForPaste = false;
  let keys = 0;
  const desktop = new LinuxDesktop({ DISPLAY: ':fixture' }, async args => {
    if (args[0] === 'getwindowpid') return String(process.pid + 1);
    if (args[0] === 'getwindowfocus') {
      if (readingForPaste) text = 'user copied something else';
      return '42';
    }
    if (args[0] === 'key') keys++;
    return '';
  });
  await desktop.initialize();
  const delivery = new TranscriptDelivery({ save: unused, writeText(value) { text = value; }, readText() { return text; } }, signal => desktop.captureTarget(signal));
  await delivery.begin();
  readingForPaste = true;
  assert.deepEqual(await delivery.deliver({ text: 'transcript' }, delivery.revision, 'always'), { text: 'transcript', delivery: 'copied' });
  assert.equal(text, 'user copied something else');
  assert.equal(keys, 0);
  assert.equal(await delivery.copyLast(), true);
  assert.equal(text, 'transcript');
});

test('clipboard and input-command failures retain transcript recovery', async () => {
  const delivery = new TranscriptDelivery({ save: unused, async writeText() { throw new Error('clipboard unavailable'); }, async readText() { return ''; } });
  await delivery.begin();
  assert.deepEqual(await delivery.deliver({ text: 'recover me' }, delivery.revision, 'always'), { text: 'recover me', delivery: 'clipboard-failed' });
  assert.equal(delivery.hasTranscript, true);
  const pasteFailure = new TranscriptDelivery({ save: unused, writeText() {}, readText() { return 'copied'; } }, async () => async () => { throw new Error('input failed'); });
  await pasteFailure.begin();
  assert.deepEqual(await pasteFailure.deliver({ text: 'copied' }, pasteFailure.revision, 'always'), { text: 'copied', delivery: 'copied' });
  assert.equal(await pasteFailure.copyLast(), true);
});

test('cancellation during asynchronous clipboard reads prevents key delivery', async () => {
  let release: (text: string) => void = () => {};
  let entered: () => void = () => {};
  const reading = new Promise<void>(resolve => { entered = resolve; });
  let keys = 0;
  const delivery = new TranscriptDelivery({
    save: unused,
    async writeText() {},
    readText() { entered(); return new Promise<string>(resolve => { release = resolve; }); },
  }, async () => async ready => { if (await ready()) { keys++; return true; } return false; });
  await delivery.begin();
  const pending = delivery.deliver({ text: 'transcript' }, delivery.revision, 'always');
  await reading;
  delivery.cancel();
  release('transcript');
  assert.deepEqual(await pending, { cancelled: true });
  assert.equal(keys, 0);
});

test('if paste fails: a sent paste gives the previous clipboard back after the target reads it', async () => {
  const app = await fixture();
  app.copy('previous clipboard');
  await app.delivery.begin();
  assert.deepEqual(await app.delivery.deliver({ text: 'pasted' }, app.delivery.revision, 'if-paste-fails'), { text: 'pasted', delivery: 'pasted' });
  assert.equal(app.clipboard(), 'pasted', 'The target still reads the transcript right after the keys');
  await wait(5);
  assert.equal(app.clipboard(), 'previous clipboard');
  assert.equal(app.keys.length, 1);
  assert.equal(await app.delivery.copyLast(), true, 'Copy last still recovers the transcript');
  assert.equal(app.clipboard(), 'pasted');
});

test('if paste fails: the transcript stays copied when focus moved', async () => {
  const app = await fixture();
  app.copy('previous clipboard');
  await app.delivery.begin();
  app.focus('77');
  assert.deepEqual(await app.delivery.deliver({ text: 'kept' }, app.delivery.revision, 'if-paste-fails'), { text: 'kept', delivery: 'copied' });
  await wait(5);
  assert.equal(app.clipboard(), 'kept');
  assert.deepEqual(app.keys, []);
});

test('restoring never overwrites something the user copied after the paste', async () => {
  const app = await fixture();
  app.copy('previous clipboard');
  await app.delivery.begin();
  await app.delivery.deliver({ text: 'pasted' }, app.delivery.revision, 'if-paste-fails');
  app.copy('copied after the paste');
  await wait(5);
  assert.equal(app.clipboard(), 'copied after the paste');
});

test('without a paste target, if paste fails copies without reading the old clipboard', async () => {
  let text = 'previous clipboard';
  let saves = 0;
  const delivery = new TranscriptDelivery({
    writeText(value) { text = value; }, readText() { return text; },
    save() { saves++; return () => {}; },
  });
  await delivery.begin();
  assert.deepEqual(await delivery.deliver({ text: 'copied' }, delivery.revision, 'if-paste-fails'), { text: 'copied', delivery: 'copied' });
  assert.equal(text, 'copied');
  assert.equal(saves, 0, 'Saving is wasted work when no paste can follow');
});

test('never: without a paste target the clipboard is untouched and the text stays recoverable', async () => {
  let text = 'previous clipboard';
  const delivery = new TranscriptDelivery({ writeText(value) { text = value; }, readText() { return text; }, save: unused });
  await delivery.begin();
  assert.deepEqual(await delivery.deliver({ text: 'held' }, delivery.revision, 'never'), { text: 'held', delivery: 'not-copied' });
  assert.equal(text, 'previous clipboard');
  assert.equal(await delivery.copyLast(), true);
  assert.equal(text, 'held');
});

test('never: a paste borrows the clipboard, and a failed paste gives it back at once', async () => {
  const pasted = await fixture();
  pasted.copy('previous clipboard');
  await pasted.delivery.begin();
  assert.deepEqual(await pasted.delivery.deliver({ text: 'pasted' }, pasted.delivery.revision, 'never'), { text: 'pasted', delivery: 'pasted' });
  await wait(5);
  assert.equal(pasted.clipboard(), 'previous clipboard');
  const moved = await fixture();
  moved.copy('previous clipboard');
  await moved.delivery.begin();
  moved.focus('77');
  assert.deepEqual(await moved.delivery.deliver({ text: 'held' }, moved.delivery.revision, 'never'), { text: 'held', delivery: 'not-copied' });
  assert.equal(moved.clipboard(), 'previous clipboard');
  assert.deepEqual(moved.keys, []);
});

test('a clipboard that cannot be saved keeps the transcript copied instead of losing it', async () => {
  let text = 'previous clipboard';
  const delivery = new TranscriptDelivery({
    writeText(value) { text = value; }, readText() { return text; },
    save() { throw new Error('unreadable format'); },
  }, async () => async () => true, 0);
  await delivery.begin();
  assert.deepEqual(await delivery.deliver({ text: 'pasted' }, delivery.revision, 'if-paste-fails'), { text: 'pasted', delivery: 'pasted-and-copied' });
  await wait(5);
  assert.equal(text, 'pasted');
});

test('a copy the user asks for during the restore delay is kept', async () => {
  const app = await fixture();
  app.copy('previous clipboard');
  await app.delivery.begin();
  await app.delivery.deliver({ text: 'pasted' }, app.delivery.revision, 'if-paste-fails');
  assert.equal(await app.delivery.copyLast(), true);
  await wait(5);
  assert.equal(app.clipboard(), 'pasted');
});

test('a delivery cancelled after its paste still gives the clipboard back', async () => {
  let text = 'previous clipboard';
  const delivery: TranscriptDelivery = new TranscriptDelivery({
    writeText(value) { text = value; }, readText() { return text; },
    save() { const saved = text; return () => { text = saved; }; },
  }, async () => async () => { delivery.cancel(); return true; }, 0);
  await delivery.begin();
  assert.deepEqual(await delivery.deliver({ text: 'pasted' }, delivery.revision, 'if-paste-fails'), { cancelled: true });
  await wait(5);
  assert.equal(text, 'previous clipboard');
});

test('quitting during the restore delay gives the clipboard back first', async () => {
  let text = 'previous clipboard';
  const delivery = new TranscriptDelivery({
    writeText(value) { text = value; }, readText() { return text; },
    save() { const saved = text; return () => { text = saved; }; },
  }, async () => async () => true);
  await delivery.begin();
  assert.deepEqual(await delivery.deliver({ text: 'pasted' }, delivery.revision, 'if-paste-fails'), { text: 'pasted', delivery: 'pasted' });
  delivery.cancel();
  await delivery.restoreNow();
  assert.equal(text, 'previous clipboard', 'The restore must not wait for its delay');
});

test('never: a clipboard that cannot be saved is left alone even with a paste target', async () => {
  let text = 'previous clipboard';
  let keys = 0;
  const delivery = new TranscriptDelivery({
    writeText(value) { text = value; }, readText() { return text; },
    save() { throw new Error('unreadable format'); },
  }, async () => async () => { keys++; return true; }, 0);
  await delivery.begin();
  assert.deepEqual(await delivery.deliver({ text: 'held' }, delivery.revision, 'never'), { text: 'held', delivery: 'not-copied' });
  assert.equal(text, 'previous clipboard');
  assert.equal(keys, 0);
  assert.equal(await delivery.copyLast(), true);
  assert.equal(text, 'held');
});

test('a copy the user asks for while a restore reads the clipboard is kept', async () => {
  let text = 'previous clipboard';
  let holdReads = false;
  let release: () => void = () => {};
  let entered: () => void = () => {};
  const reading = new Promise<void>(resolve => { entered = resolve; });
  const delivery = new TranscriptDelivery({
    writeText(value) { text = value; },
    readText() {
      if (!holdReads) return text;
      const value = text;
      entered();
      return new Promise<string>(resolve => { release = () => resolve(value); });
    },
    save() { const saved = text; return () => { text = saved; }; },
  }, async () => async () => true, 0);
  await delivery.begin();
  await delivery.deliver({ text: 'pasted' }, delivery.revision, 'if-paste-fails');
  holdReads = true;
  await reading;
  assert.equal(await delivery.copyLast(), true);
  release();
  await wait(5);
  assert.equal(text, 'pasted');
});

test('a copy the user asks for while a restore writes the clipboard is kept', async () => {
  let text = 'previous clipboard';
  let entered: () => void = () => {};
  const writing = new Promise<void>(resolve => { entered = resolve; });
  const delivery = new TranscriptDelivery({
    writeText(value) { text = value; }, readText() { return text; },
    save() {
      const saved = text;
      return async () => { entered(); await wait(20); text = saved; };
    },
  }, async () => async () => true, 0);
  await delivery.begin();
  await delivery.deliver({ text: 'pasted' }, delivery.revision, 'if-paste-fails');
  await writing;
  assert.equal(await delivery.copyLast(), true);
  await wait(30);
  assert.equal(text, 'pasted');
});

test('a new delivery waits for a restore whose clipboard read is slow', async () => {
  let text = 'previous clipboard';
  let holdNextRead = false;
  let release: () => void = () => {};
  let entered: () => void = () => {};
  const reading = new Promise<void>(resolve => { entered = resolve; });
  const pastes: string[] = [];
  const delivery = new TranscriptDelivery({
    writeText(value) { text = value; },
    readText() {
      if (!holdNextRead) return text;
      holdNextRead = false;
      const value = text;
      entered();
      return new Promise<string>(resolve => { release = () => resolve(value); });
    },
    save() { const saved = text; return () => { text = saved; }; },
  }, async () => async ready => {
    await wait(10);
    if (!await ready()) return false;
    pastes.push(text);
    return true;
  }, 0);
  await delivery.begin();
  await delivery.deliver({ text: 'first' }, delivery.revision, 'if-paste-fails');
  holdNextRead = true;
  await reading;
  await delivery.begin();
  const second = delivery.deliver({ text: 'second' }, delivery.revision, 'if-paste-fails');
  await wait(2);
  release();
  assert.deepEqual(await second, { text: 'second', delivery: 'pasted' });
  assert.deepEqual(pastes, ['first', 'second']);
  await wait(5);
  assert.equal(text, 'previous clipboard');
});

/** A clipboard whose restore writes slowly, and a promise that settles when that write starts. */
function slowRestore() {
  const clipboard = { text: 'previous clipboard' };
  let entered: () => void = () => {};
  const writing = new Promise<void>(resolve => { entered = resolve; });
  return {
    clipboard, writing, fake: {
      writeText(value: string) { clipboard.text = value; }, readText() { return clipboard.text; },
      save() { const saved = clipboard.text; return async () => { entered(); await wait(20); clipboard.text = saved; }; },
    },
  };
}

test('quitting during a slow restore write waits until the earlier contents are back', async () => {
  const { clipboard, writing, fake } = slowRestore();
  const delivery = new TranscriptDelivery(fake, async () => async () => true, 0);
  await delivery.begin();
  await delivery.deliver({ text: 'pasted' }, delivery.revision, 'if-paste-fails');
  await writing;
  delivery.cancel();
  await delivery.restoreNow();
  assert.equal(clipboard.text, 'previous clipboard');
});

test('never: quitting during a slow restore waits until the earlier contents are back', async () => {
  const { clipboard, writing, fake } = slowRestore();
  const delivery = new TranscriptDelivery(fake, async () => async () => false, 0);
  await delivery.begin();
  const pending = delivery.deliver({ text: 'held' }, delivery.revision, 'never');
  await writing;
  delivery.cancel();
  await delivery.restoreNow();
  assert.equal(clipboard.text, 'previous clipboard');
  assert.deepEqual(await pending, { text: 'held', delivery: 'not-copied' });
});

test('clearing history also clears Copy last', async () => {
  const delivery = new TranscriptDelivery({ writeText() {}, readText() { return ''; }, save: unused });
  await delivery.begin();
  await delivery.deliver({ text: 'private' }, delivery.revision, 'always');
  delivery.forget('something else');
  assert.equal(delivery.hasTranscript, true, 'Deleting another entry keeps Copy last');
  delivery.forget();
  assert.equal(delivery.hasTranscript, false);
  assert.equal(await delivery.copyLast(), false);
});
