import type { ClipboardBookmark } from 'electron';
import type { Clipboard } from './delivery.ts';

/** One type's data, as Electron's clipboard items return and accept it. */
type Data = Blob | ClipboardBookmark;
interface ReadableItem { readonly types: string[]; getType(type: string): Promise<Data> }
/** The parts of Electron's clipboard module that delivery uses. */
interface ItemClipboard<Item extends ReadableItem> {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
  read(): Promise<Item[]>;
  write(items: Item[]): Promise<void>;
  clear(): void;
}
/** macOS reports its separate Find pasteboard as a type. A transcript write never changes it, so it needs no restore. */
const FIND_PASTEBOARD = 'electron application/findtext';

/**
 * Adapts Electron's clipboard and ClipboardItem, passed in so tests can use fakes.
 * Saving reads every other type now, before the transcript replaces the contents.
 */
export function systemClipboard<Item extends ReadableItem>(
  clipboard: ItemClipboard<Item>,
  ClipboardItem: new (data: Record<string, Data>) => Item,
): Clipboard {
  return {
    writeText: text => clipboard.writeText(text),
    readText: () => clipboard.readText(),
    async save() {
      const read = async (item: Item) => Object.fromEntries(await Promise.all(item.types
        .filter(type => type !== FIND_PASTEBOARD)
        .map(async type => [type, await item.getType(type)] as const)));
      const items = (await Promise.all((await clipboard.read()).map(read))).filter(item => Object.keys(item).length);
      return async () => {
        if (items.length) await clipboard.write(items.map(item => new ClipboardItem(item)));
        else clipboard.clear();
      };
    },
  };
}
