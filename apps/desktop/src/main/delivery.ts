import type { ClipboardMode, TranscriptResult } from '../shared/contract.ts';

type MaybePromise<T> = T | Promise<T>;
export type PasteTarget = (ready: () => Promise<boolean>, signal: AbortSignal) => Promise<boolean>;
export interface Clipboard {
  writeText(text: string): MaybePromise<void>;
  readText(): MaybePromise<string>;
  /** Captures the current contents and returns a function that puts them back. */
  save(): MaybePromise<() => MaybePromise<void>>;
}

/** Target apps read the clipboard after they receive the paste keys, so restoring waits this long. */
const RESTORE_DELAY_MS = 1000;

/** Owns the recording's paste target, clipboard recovery, and stale-delivery guard. */
export class TranscriptDelivery {
  private generation = 0;
  private controller = new AbortController();
  private target?: PasteTarget;
  private text = '';
  private clipboard: Clipboard;
  private captureTarget?: (signal: AbortSignal) => Promise<PasteTarget | undefined>;
  private restoreDelay: number;
  private pendingRestore?: { timer: ReturnType<typeof setTimeout>; run: () => Promise<void> };
  /** Counts explicit copies, so a restore that is already reading the clipboard cannot undo one. */
  private copies = 0;
  /** The restore in progress, from its clipboard read through its write. Delivery and quit wait for it. */
  private running?: Promise<void>;
  /** The restore write in progress. An explicit copy waits only for this, so the copy lands last. */
  private restoring?: Promise<void>;

  constructor(
    clipboard: Clipboard,
    captureTarget?: (signal: AbortSignal) => Promise<PasteTarget | undefined>,
    restoreDelay = RESTORE_DELAY_MS,
  ) {
    this.clipboard = clipboard;
    this.captureTarget = captureTarget;
    this.restoreDelay = restoreDelay;
  }

  get revision() { return this.generation; }
  get hasTranscript() { return !!this.text; }

  cancel() {
    this.generation++;
    this.controller.abort();
    this.controller = new AbortController();
    this.target = undefined;
  }

  async begin() {
    this.cancel();
    const revision = this.generation;
    const target = await this.captureTarget?.(this.controller.signal).catch(() => undefined);
    if (revision === this.generation) this.target = target;
  }

  /** Copies on the user's request. Their copy wins over a pending restore. */
  async copy(text: string) {
    this.copies++;
    this.dropRestore();
    await this.restoring;
    return this.write(text);
  }

  async copyLast() { return this.text ? this.copy(this.text) : false; }

  /** Runs a pending restore now and waits for one already running, for example before quit. */
  async restoreNow() {
    await this.pendingRestore?.run();
    await this.running;
  }

  /** Forgets the last transcript after history deletes it, so Copy last cannot bring it back. */
  forget(text?: string) {
    if (text === undefined || text === this.text) this.text = '';
  }

  async deliver(result: TranscriptResult, revision: number, mode: ClipboardMode): Promise<TranscriptResult> {
    if (revision !== this.generation) return { cancelled: true };
    if (!('text' in result) || !result.text.trim()) return result;
    this.text = result.text;
    const target = this.target;
    // An earlier paste has had a whole recording's time to read its text, so its restore can run now.
    await this.restoreNow();
    // Only a paste can give the clipboard back. Without a saved copy, Never leaves the clipboard alone
    // and If paste fails keeps the transcript copied for manual paste.
    const restore = mode !== 'always' && target ? await this.save() : undefined;
    if (revision !== this.generation) return { cancelled: true };
    if (mode === 'never' && !restore) return { ...result, delivery: 'not-copied' };
    if (!await this.write(result.text)) return { ...result, delivery: 'clipboard-failed' };
    // A paste can still land after cancellation, so a cancelled delivery gives the clipboard back later too.
    const cancelled = (): TranscriptResult => {
      if (restore) this.scheduleRestore(result.text, restore);
      return { cancelled: true };
    };
    if (revision !== this.generation) return cancelled();
    const ready = async () => {
      if (revision !== this.generation) return false;
      try { return await this.clipboard.readText() === result.text && revision === this.generation; }
      catch { return false; }
    };
    const pasteSent = await target?.(ready, this.controller.signal).catch(() => false) ?? false;
    if (revision !== this.generation) return cancelled();
    if (pasteSent) {
      if (!restore) return { ...result, delivery: 'pasted-and-copied' };
      this.scheduleRestore(result.text, restore);
      return { ...result, delivery: 'pasted' };
    }
    if (mode === 'never' && restore) {
      await this.restoreIfUnchanged(result.text, restore);
      return { ...result, delivery: 'not-copied' };
    }
    return { ...result, delivery: 'copied' };
  }

  private async write(text: string) {
    try { await this.clipboard.writeText(text); return true; }
    catch { return false; }
  }

  private async save() {
    try { return await this.clipboard.save(); }
    catch { return undefined; }
  }

  private scheduleRestore(text: string, restore: () => MaybePromise<void>) {
    this.dropRestore();
    const run = () => {
      this.dropRestore();
      return this.restoreIfUnchanged(text, restore);
    };
    this.pendingRestore = { timer: setTimeout(() => { void run(); }, this.restoreDelay), run };
  }

  private dropRestore() {
    clearTimeout(this.pendingRestore?.timer);
    this.pendingRestore = undefined;
  }

  /** Puts the earlier contents back unless something else replaced the transcript meanwhile. Never rejects. */
  private restoreIfUnchanged(text: string, restore: () => MaybePromise<void>) {
    const copies = this.copies;
    const run = async () => {
      try {
        if (await this.clipboard.readText() !== text || copies !== this.copies) return;
        this.restoring = Promise.resolve(restore()).catch(() => {});
        await this.restoring;
      } catch { /* The transcript stays copied, which is still recoverable. */ }
    };
    this.running = run();
    return this.running;
  }
}
