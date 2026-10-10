import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ClipboardBookmark } from 'electron';
import { systemClipboard } from '../src/main/system-clipboard.ts';

type Data = Blob | ClipboardBookmark;

/** Fakes Electron's clipboard module and ClipboardItem, and logs each read, write, and clear. */
function fixture(contents: Record<string, Data>[]) {
  const events: string[] = [];
  class Item {
    readonly data: Record<string, Data>;
    constructor(data: Record<string, Data>) { this.data = data; }
    get types() { return Object.keys(this.data); }
    async getType(type: string) { events.push(`read ${type}`); return this.data[type]; }
  }
  let items = contents.map(data => new Item(data));
  const clipboard = systemClipboard({
    async read() { return items; },
    async write(next) { events.push('write items'); items = next; },
    clear() { events.push('clear'); items = []; },
    async readText() { return ''; },
    async writeText(text) { events.push(`write ${text}`); items = [new Item({ 'text/plain': new Blob([text]) })]; },
  }, Item);
  return { clipboard, events, contents: () => items.map(item => item.data) };
}

test('saving reads every type of every item except Find, and restoring writes that data back', async () => {
  const text = new Blob(['previous'], { type: 'text/plain' });
  const html = new Blob(['<b>previous</b>'], { type: 'text/html' });
  const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
  const bookmark = { title: 'Example', url: 'https://example.com' };
  const previous: Record<string, Data>[] = [{ 'text/plain': text, 'text/html': html }, { 'image/png': png, 'electron application/bookmark': bookmark }];
  // macOS reports the Find pasteboard inside the item with real content.
  const app = fixture([{ ...previous[0], 'electron application/findtext': new Blob(['search']) }, previous[1]]);
  const restore = await app.clipboard.save();
  await app.clipboard.writeText('transcript');
  await restore();
  assert.deepEqual(app.events, [
    'read text/plain', 'read text/html', 'read image/png', 'read electron application/bookmark',
    'write transcript', 'write items',
  ]);
  assert.deepEqual(app.contents(), previous);
});

test('restoring an empty clipboard clears the transcript', async () => {
  const app = fixture([]);
  const restore = await app.clipboard.save();
  await app.clipboard.writeText('transcript');
  await restore();
  assert.deepEqual(app.events, ['write transcript', 'clear']);
  assert.deepEqual(app.contents(), []);
});

test('a clipboard that holds only the macOS Find pasteboard counts as empty', async () => {
  const app = fixture([{ 'electron application/findtext': new Blob(['search']) }]);
  const restore = await app.clipboard.save();
  await app.clipboard.writeText('transcript');
  await restore();
  assert.deepEqual(app.events, ['write transcript', 'clear'], 'The Find pasteboard is never read or written back');
  assert.deepEqual(app.contents(), []);
});
