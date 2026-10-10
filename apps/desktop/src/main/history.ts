import { randomUUID } from 'node:crypto';
import type { HistoryEntry } from '../shared/contract.ts';
import { PrivateFile } from './private-file.ts';

/** Keeps the file small enough to load and send to the panel at once. */
export const HISTORY_LIMIT = 500;
const VOICEPRINT_BARS = 24;

/** Transcript text, time, and loudness shape, stored in one private JSON file. Audio is never stored. */
export class TranscriptHistory {
  private file: PrivateFile;
  private items: HistoryEntry[] = [];

  constructor(file: string) {
    this.file = new PrivateFile(file);
  }

  get entries(): readonly HistoryEntry[] { return this.items; }

  async load() {
    try {
      const value: unknown = JSON.parse(await this.file.read());
      if (Array.isArray(value)) this.items = value.filter(isEntry).slice(-HISTORY_LIMIT);
    } catch { /* A missing or unreadable file starts an empty history. */ }
  }

  async add(text: string, recording: Recording, at = Date.now()) {
    const entry: HistoryEntry = { id: randomUUID(), text, at, ...recording };
    this.items = [...this.items, entry].slice(-HISTORY_LIMIT);
    await this.save();
    return entry;
  }

  async remove(id: string) {
    this.items = this.items.filter(entry => entry.id !== id);
    await this.save();
  }

  async clear() {
    this.items = [];
    await this.save();
  }

  private save() { return this.file.write(JSON.stringify(this.items)); }
}

function isEntry(value: unknown): value is HistoryEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry: Partial<Record<keyof HistoryEntry, unknown>> = value;
  return typeof entry.id === 'string' && typeof entry.text === 'string'
    // The panel formats `at` as a date, which throws outside the Date range.
    && typeof entry.at === 'number' && Number.isFinite(new Date(entry.at).getTime()) && Number.isFinite(entry.seconds)
    && Array.isArray(entry.voiceprint) && entry.voiceprint.every(level => typeof level === 'number' && level >= 0 && level <= 1);
}

export interface Recording { seconds: number; voiceprint: number[] }

/** Reads length and a coarse loudness shape from the renderer's 16-bit mono WAV. */
export function describeRecording(wav: ArrayBuffer): Recording {
  const view = new DataView(wav);
  const tag = (offset: number) => String.fromCharCode(...new Uint8Array(wav, offset, 4));
  if (wav.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || view.getUint16(34, true) !== 16) {
    return { seconds: 0, voiceprint: [] };
  }
  const byteRate = view.getUint32(28, true);
  const count = Math.floor(Math.min(view.getUint32(40, true), wav.byteLength - 44) / 2);
  const window = Math.floor(count / VOICEPRINT_BARS);
  if (!byteRate || window === 0) return { seconds: byteRate ? count * 2 / byteRate : 0, voiceprint: [] };
  const decibels = Array.from({ length: VOICEPRINT_BARS }, (_, bar) => {
    let square = 0;
    for (let index = bar * window; index < (bar + 1) * window; index++) {
      const sample = view.getInt16(44 + index * 2, true) / 32768;
      square += sample * sample;
    }
    return Math.max(-80, 20 * Math.log10(Math.sqrt(square / window) || 1e-4));
  });
  // Scale to this recording's range, as the live pill does, so quiet speakers still show a shape.
  const floor = Math.min(...decibels);
  const range = Math.max(18, Math.max(...decibels) - floor);
  return {
    seconds: Math.round(count * 2 / byteRate * 10) / 10,
    voiceprint: decibels.map(value => Math.round((value - floor) / range * 100) / 100),
  };
}
