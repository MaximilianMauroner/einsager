import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TranscriptDelivery } from '../src/main/delivery.ts';
import { LinuxDesktop, linuxSession } from '../src/main/linux/desktop.ts';

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
  const delivery = new TranscriptDelivery({ writeText(value) { text = value; }, readText() { return text; } }, signal => desktop.captureTarget(signal));
  return { delivery, desktop, keys, clipboard: () => text,
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
  assert.deepEqual(await app.delivery.deliver({ text }, app.delivery.revision), { text, pasteSent: true });
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
  assert.deepEqual(await app.delivery.deliver({ text: 'kept' }, app.delivery.revision), { text: 'kept', pasteSent: false });
  assert.equal(app.clipboard(), 'kept');
  assert.deepEqual(app.keys, []);
});

test('own windows and unknown window owners do not receive automatic paste', async () => {
  for (const owner of [String(process.pid), '', 'unknown']) {
    const app = await fixture();
    app.owner(owner);
    await app.delivery.begin();
    assert.equal('text' in await app.delivery.deliver({ text: 'manual' }, app.delivery.revision), true);
    assert.equal(app.clipboard(), 'manual');
    assert.deepEqual(app.keys, []);
  }
});

test('a reused window ID with a different owner does not receive automatic paste', async () => {
  const app = await fixture();
  await app.delivery.begin();
  app.owner(String(process.pid + 2));
  assert.deepEqual(await app.delivery.deliver({ text: 'manual' }, app.delivery.revision), { text: 'manual', pasteSent: false });
  assert.deepEqual(app.keys, []);
});

test('Wayland disables placement and never runs X11 commands', async () => {
  let commands = 0;
  const desktop = new LinuxDesktop({ DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' }, async () => { commands++; return ''; });
  await desktop.initialize();
  const delivery = new TranscriptDelivery({ writeText() {}, readText() { return 'manual'; } }, signal => desktop.captureTarget(signal));
  await delivery.begin();
  assert.deepEqual(await delivery.deliver({ text: 'manual' }, delivery.revision), { text: 'manual', pasteSent: false });
  assert.equal(desktop.canPositionWindow, false);
  assert.equal(commands, 0);
});

test('missing xdotool keeps recording startup and clipboard delivery usable', async () => {
  const desktop = new LinuxDesktop({ DISPLAY: ':0' }, async () => { throw new Error('ENOENT'); });
  await desktop.initialize();
  let text = '';
  const delivery = new TranscriptDelivery({ writeText(value) { text = value; }, readText() { return text; } }, signal => desktop.captureTarget(signal));
  await delivery.begin();
  assert.deepEqual(await delivery.deliver({ text: 'manual' }, delivery.revision), { text: 'manual', pasteSent: false });
  assert.equal(text, 'manual');
  assert.match(desktop.notice, /Install xdotool/);
});

test('cancellation and a newer recording reject old clipboard and paste delivery', async () => {
  const app = await fixture();
  await app.delivery.begin();
  const cancelled = app.delivery.revision;
  app.delivery.cancel();
  assert.deepEqual(await app.delivery.deliver({ text: 'cancelled' }, cancelled), { cancelled: true });
  await app.delivery.begin();
  const replaced = app.delivery.revision;
  await app.delivery.begin();
  assert.deepEqual(await app.delivery.deliver({ text: 'old' }, replaced), { cancelled: true });
  assert.equal(app.clipboard(), '');
  assert.deepEqual(app.keys, []);
});

test('a delayed target capture cannot overwrite a newer recording target', async () => {
  let complete: (target: () => Promise<boolean>) => void = () => {};
  let captures = 0;
  const sent: string[] = [];
  let text = '';
  const delivery = new TranscriptDelivery({ writeText(value) { text = value; }, readText() { return text; } }, async () => {
    if (++captures === 1) return new Promise(resolve => { complete = resolve; });
    return async () => { sent.push('new'); return true; };
  });
  const old = delivery.begin();
  await delivery.begin();
  complete(async () => { sent.push('old'); return true; });
  await old;
  assert.deepEqual(await delivery.deliver({ text: 'current transcript' }, delivery.revision), { text: 'current transcript', pasteSent: true });
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
  const delivery = new TranscriptDelivery({ writeText(value) { text = value; }, readText() { return text; } }, signal => desktop.captureTarget(signal));
  await delivery.begin();
  captured = true;
  const pending = delivery.deliver({ text: 'copied before cancellation' }, delivery.revision);
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
  const delivery = new TranscriptDelivery({ writeText(value) { text = value; }, readText() { return text; } }, signal => desktop.captureTarget(signal));
  await delivery.begin();
  readingForPaste = true;
  assert.deepEqual(await delivery.deliver({ text: 'transcript' }, delivery.revision), { text: 'transcript', pasteSent: false });
  assert.equal(text, 'user copied something else');
  assert.equal(keys, 0);
  assert.equal(await delivery.copyLast(), true);
  assert.equal(text, 'transcript');
});

test('clipboard and input-command failures retain transcript recovery', async () => {
  const delivery = new TranscriptDelivery({ async writeText() { throw new Error('clipboard unavailable'); }, async readText() { return ''; } });
  await delivery.begin();
  assert.deepEqual(await delivery.deliver({ text: 'recover me' }, delivery.revision), { text: 'recover me', copied: false });
  assert.equal(delivery.hasTranscript, true);
  const pasteFailure = new TranscriptDelivery({ writeText() {}, readText() { return 'copied'; } }, async () => async () => { throw new Error('input failed'); });
  await pasteFailure.begin();
  assert.deepEqual(await pasteFailure.deliver({ text: 'copied' }, pasteFailure.revision), { text: 'copied', pasteSent: false });
  assert.equal(await pasteFailure.copyLast(), true);
});

test('cancellation during asynchronous clipboard reads prevents key delivery', async () => {
  let release: (text: string) => void = () => {};
  let entered: () => void = () => {};
  const reading = new Promise<void>(resolve => { entered = resolve; });
  let keys = 0;
  const delivery = new TranscriptDelivery({
    async writeText() {},
    readText() { entered(); return new Promise<string>(resolve => { release = resolve; }); },
  }, async () => async ready => { if (await ready()) { keys++; return true; } return false; });
  await delivery.begin();
  const pending = delivery.deliver({ text: 'transcript' }, delivery.revision);
  await reading;
  delivery.cancel();
  release('transcript');
  assert.deepEqual(await pending, { cancelled: true });
  assert.equal(keys, 0);
});
