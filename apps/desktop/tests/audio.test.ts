import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, RECORDING_SECONDS } from '../src/renderer/audio.ts';
import { MAX_AUDIO_BYTES } from '../src/main/transcription.ts';

test('WAV header and PCM encode match the helper format, including clipping', () => {
  const buffer = encodeWav(new Float32Array([-2, 0, 2]), 16000);
  const view = new DataView(buffer);
  assert.equal(Buffer.from(buffer).subarray(0, 4).toString(), 'RIFF');
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(40, true), 6);
  assert.equal(view.getInt16(44, true), -32768);
  assert.equal(view.getInt16(46, true), 0);
  assert.equal(view.getInt16(48, true), 32767);
});

test('48 kHz input is resampled to 16 kHz and the recording cap fits 25 MiB', () => {
  const buffer = encodeWav(new Float32Array(48000).fill(0.5), 48000);
  assert.equal(buffer.byteLength, 44 + 16000 * 2);
  assert.equal(new DataView(buffer).getInt16(44, true), 16384);
  assert.ok(RECORDING_SECONDS * 16000 * 2 + 44 < MAX_AUDIO_BYTES);
});
