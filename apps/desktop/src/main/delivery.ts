import type { TranscriptResult } from '../shared/contract.ts';

export type PasteTarget = (ready: () => Promise<boolean>, signal: AbortSignal) => Promise<boolean>;
type Clipboard = { writeText(text: string): void | Promise<void>; readText(): string | Promise<string> };

/** Owns the recording's paste target, clipboard recovery, and stale-delivery guard. */
export class TranscriptDelivery {
  private generation = 0;
  private controller = new AbortController();
  private target?: PasteTarget;
  private text = '';
  private clipboard: Clipboard;
  private captureTarget?: (signal: AbortSignal) => Promise<PasteTarget | undefined>;

  constructor(
    clipboard: Clipboard,
    captureTarget?: (signal: AbortSignal) => Promise<PasteTarget | undefined>,
  ) {
    this.clipboard = clipboard;
    this.captureTarget = captureTarget;
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

  async copyLast() {
    if (!this.text) return false;
    try { await this.clipboard.writeText(this.text); return true; }
    catch { return false; }
  }

  async deliver(result: TranscriptResult, revision: number): Promise<TranscriptResult> {
    if (revision !== this.generation) return { cancelled: true };
    if (!('text' in result) || !result.text.trim()) return result;
    this.text = result.text;
    const copied = await this.copyLast();
    if (revision !== this.generation) return { cancelled: true };
    if (!copied) return { ...result, copied: false };
    const ready = async () => {
      if (revision !== this.generation) return false;
      try { return await this.clipboard.readText() === result.text && revision === this.generation; }
      catch { return false; }
    };
    const pasteSent = await this.target?.(ready, this.controller.signal).catch(() => false) ?? false;
    if (revision !== this.generation) return { cancelled: true };
    return { ...result, pasteSent };
  }
}
