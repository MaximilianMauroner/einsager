/**
 * Electron's global shortcut, the only one on Linux and Windows and the macOS fallback until Accessibility
 * is allowed. It is stored as an Electron accelerator whose names also read well as key caps, such as
 * "Ctrl+Alt+Space".
 */
export const DEFAULT_SHORTCUT = 'Ctrl+Alt+Space';

const modifiers = ['Ctrl', 'Alt', 'Shift', 'Cmd', 'Super'];
/** Keys by KeyboardEvent.code, the physical key. On a non-US layout, a letter can show its US name. */
const namedKeys: Record<string, string> = {
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', Backquote: '`',
};
const functionKey = /^F([1-9]|1\d|2[0-4])$/;
const keys = new Set([...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', ...Object.values(namedKeys)]);

function keyName(code: string) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return functionKey.test(code) ? code : namedKeys[code];
}

/**
 * Accepts one key with modifiers in a fixed order. Without Ctrl, Alt, Cmd, or Super, only a function key may
 * stand alone, so a shortcut never takes over ordinary typing.
 */
export function isShortcut(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = value.split('+');
  const key = parts.pop() ?? '';
  const order = parts.map(part => modifiers.indexOf(part));
  if (order.some((index, position) => index < 0 || (position > 0 && index <= order[position - 1]))) return false;
  if (functionKey.test(key)) return true;
  return keys.has(key) && parts.some(part => part !== 'Shift');
}

type KeyPress = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>;

/** The shortcut for a key press, or undefined while only modifiers are down or the press cannot be a shortcut. */
export function shortcutFromKey(event: KeyPress, mac: boolean) {
  const key = keyName(event.code);
  if (!key) return;
  const held = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && (mac ? 'Cmd' : 'Super')];
  const shortcut = [...held.filter(name => typeof name === 'string'), key].join('+');
  return isShortcut(shortcut) ? shortcut : undefined;
}
