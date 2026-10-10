import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SHORTCUT, isShortcut, shortcutFromKey } from '../src/shared/shortcut.ts';

const press = (code: string, held: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}) =>
  ({ code, ctrlKey: !!held.ctrl, altKey: !!held.alt, shiftKey: !!held.shift, metaKey: !!held.meta });

test('a recorded key press becomes an Electron accelerator that reads as key caps', () => {
  assert.equal(shortcutFromKey(press('Space', { ctrl: true, alt: true }), false), DEFAULT_SHORTCUT);
  assert.equal(shortcutFromKey(press('KeyD', { ctrl: true, shift: true }), false), 'Ctrl+Shift+D');
  assert.equal(shortcutFromKey(press('Digit5', { alt: true }), false), 'Alt+5');
  assert.equal(shortcutFromKey(press('Period', { ctrl: true }), false), 'Ctrl+.');
  assert.equal(shortcutFromKey(press('ArrowUp', { alt: true }), false), 'Alt+Up');
  assert.equal(shortcutFromKey(press('KeyK', { meta: true }), true), 'Cmd+K', 'Command on macOS');
  assert.equal(shortcutFromKey(press('KeyK', { meta: true }), false), 'Super+K', 'The Windows or Super key elsewhere');
  assert.equal(shortcutFromKey(press('F13'), false), 'F13', 'A function key may stand alone');
});

test('presses that would take over typing or have no key yet are not recorded', () => {
  assert.equal(shortcutFromKey(press('KeyA'), false), undefined);
  assert.equal(shortcutFromKey(press('KeyA', { shift: true }), false), undefined);
  assert.equal(shortcutFromKey(press('Space'), false), undefined);
  assert.equal(shortcutFromKey(press('ControlLeft', { ctrl: true }), false), undefined, 'Only a modifier is down');
  assert.equal(shortcutFromKey(press('IntlBackslash', { ctrl: true }), false), undefined, 'Not a supported key');
});

test('stored shortcuts must be one supported key after modifiers in order', () => {
  for (const value of [DEFAULT_SHORTCUT, 'Ctrl+Shift+D', 'Cmd+K', 'F13', 'Shift+F2', 'Alt+-']) assert.ok(isShortcut(value), value);
  for (const value of ['', 'Ctrl', 'Ctrl+', 'Alt+Ctrl+Space', 'Ctrl+Ctrl+A', 'Hyper+A', 'Shift+A', 'A', 'Ctrl+Escape', 'Ctrl+A+B', 42, null]) {
    assert.equal(isShortcut(value), false, String(value));
  }
});
