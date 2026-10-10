import { execFile, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TranscriptResult } from '../shared/contract.ts';

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** Owns one temporary recording and helper process. Old completions cannot deliver text. */
export class TranscriptionSession {
  private generation = 0;
  private directory?: string;
  private child?: ChildProcess;

  private helper: { file: string; args?: string[] };
  private environment: NodeJS.ProcessEnv;

  constructor(helper: { file: string; args?: string[] }, environment = process.env) {
    this.helper = helper;
    this.environment = environment;
  }

  async transcribe(audio: ArrayBuffer): Promise<TranscriptResult> {
    const generation = ++this.generation;
    await this.discardResources();
    if (generation !== this.generation) return { cancelled: true };
    if (audio.byteLength === 0 || audio.byteLength > MAX_AUDIO_BYTES) {
      return { error: 'Recording must be nonempty and no larger than 25 MiB.', retryable: false };
    }
    let directory: string;
    try {
      directory = await mkdtemp(join(tmpdir(), 'einsager-'));
      if (generation !== this.generation) {
        await rm(directory, { recursive: true, force: true });
        return { cancelled: true };
      }
      this.directory = directory;
      await writeFile(join(directory, 'recording.wav'), Buffer.from(audio), { mode: 0o600 });
    } catch {
      if (generation !== this.generation) return { cancelled: true };
      await this.discardResources();
      return generation === this.generation
        ? { error: 'Cannot save recording. Check available disk space.', retryable: false }
        : { cancelled: true };
    }
    return this.run(generation, directory);
  }

  async retry(): Promise<TranscriptResult> {
    if (!this.directory || this.child) return { error: 'No recording to retry. Start a new dictation.', retryable: false };
    return this.run(++this.generation, this.directory);
  }

  async cancel(): Promise<void> {
    this.generation++;
    await this.discardResources();
  }

  private async discardResources() {
    this.child?.kill();
    this.child = undefined;
    const directory = this.directory;
    this.directory = undefined;
    if (directory) await rm(directory, { recursive: true, force: true });
  }

  private async run(generation: number, directory: string): Promise<TranscriptResult> {
    if (generation !== this.generation) return { cancelled: true };
    const result = await new Promise<TranscriptResult>(resolve => {
      this.child = execFile(this.helper.file, [...(this.helper.args ?? []), join(directory, 'recording.wav')], {
        env: this.environment, timeout: 100_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
      }, (error, stdout) => {
        if (generation !== this.generation) { resolve({ cancelled: true }); return; }
        this.child = undefined;
        try {
          const value: unknown = JSON.parse(stdout);
          if (typeof value === 'object' && value !== null) {
            if (!error && 'text' in value && typeof value.text === 'string') {
              resolve({ text: value.text }); return;
            }
            if ('error' in value && typeof value.error === 'string') {
              resolve({ error: value.error, retryable: true }); return;
            }
          }
        } catch { /* A missing or crashed helper has no JSON response. */ }
        resolve({ error: 'Transcription helper failed or timed out. Retry, or rebuild einsager.', retryable: true });
      });
    });
    if ('text' in result && generation === this.generation) {
      await this.discardResources();
    }
    return generation === this.generation ? result : { cancelled: true };
  }
}
