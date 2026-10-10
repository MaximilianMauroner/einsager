/** The macOS helper's names: modifier glyphs, then Fn with the "+" that separates it from a key, then the key. */
const helperName = /^([⌃⌥⇧⌘]*)(?:(Fn)\+?)?(.*)$/;

/**
 * Splits a shortcut name into one key cap per key. The helper writes "⌃⌥K", "Fn+Space", or "Fn++" for the
 * + key; Electron accelerators such as "Ctrl+Alt+Space" put "+" between all keys.
 */
export function keyCaps(shortcut: string) {
  const [, glyphs = '', fn, key = ''] = helperName.exec(shortcut) ?? [];
  if (!glyphs && !fn) return shortcut.split('+');
  return [...glyphs, ...(fn ? [fn] : []), ...(key ? [key] : [])];
}
