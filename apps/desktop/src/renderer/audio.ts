import type { Microphone } from '../shared/contract';

export const RECORDING_SECONDS = 10 * 60;

/** Capture mono PCM. WAV uses the already-tested helper format on every platform. */
export class MicrophoneRecording {
  private context: AudioContext;
  private processor: ScriptProcessorNode;
  private chunks: Float32Array[] = [];
  private frames = 0;
  private started = performance.now();
  private floor?: number;
  private peak = 0;
  private meter = 0;
  private heard = false;
  private stream: MediaStream;

  private constructor(stream: MediaStream, onLevel: (level: number, seconds: number) => void, onLimit: () => void) {
    this.stream = stream;
    this.context = new AudioContext({ sampleRate: 16000 });
    const source = this.context.createMediaStreamSource(stream);
    this.processor = this.context.createScriptProcessor(1024, 1, 1);
    source.connect(this.processor);
    // The output remains silence. Connecting makes Chromium process the input callbacks.
    this.processor.connect(this.context.destination);
    this.processor.onaudioprocess = event => {
      const samples = event.inputBuffer.getChannelData(0).slice();
      this.chunks.push(samples);
      this.frames += samples.length;
      const seconds = this.frames / this.context.sampleRate;
      let square = 0;
      for (const value of samples) square += value * value;
      const power = Math.max(-80, 20 * Math.log10(Math.sqrt(square / samples.length) || 1e-4));
      if (power > -65) this.heard = true;
      if (performance.now() - this.meter > 65) {
        onLevel(this.level(power), seconds);
        this.meter = performance.now();
      }
      if (seconds >= RECORDING_SECONDS) onLimit();
    };
  }

  static async start(microphone: string, onLevel: (level: number, seconds: number) => void, onLimit: () => void) {
    const stream = await openMicrophone(microphone);
    try {
      const recording = new MicrophoneRecording(stream, onLevel, onLimit);
      await recording.context.resume();
      return recording;
    } catch (error) {
      stream.getTracks().forEach(track => track.stop());
      throw error;
    }
  }

  private level(power: number) {
    if (this.floor === undefined) { this.floor = power; this.peak = power + 18; return 0; }
    this.floor = power < this.floor ? power : this.floor + (power - this.floor) * 0.01;
    this.peak = power > this.peak ? power : this.peak + (power - this.peak) * 0.03;
    return Math.min(1, Math.max(0, (power - this.floor) / Math.max(18, this.peak - this.floor)));
  }

  stop(): ArrayBuffer | undefined {
    this.close();
    if (!this.heard || performance.now() - this.started < 500) return;
    const samples = new Float32Array(this.frames);
    let offset = 0;
    for (const chunk of this.chunks) { samples.set(chunk, offset); offset += chunk.length; }
    this.chunks = [];
    return encodeWav(samples, this.context.sampleRate);
  }

  cancel() { this.close(); this.chunks = []; }

  private close() {
    this.processor.onaudioprocess = null;
    this.processor.disconnect();
    this.stream.getTracks().forEach(track => track.stop());
    void this.context.close();
  }
}

/**
 * An empty or unplugged microphone records from the system default instead of failing.
 * Chromium ignores an ideal deviceId, so the chosen one is exact and its absence falls back.
 */
async function openMicrophone(microphone: string) {
  const audio = { channelCount: 1 };
  if (microphone) {
    try { return await navigator.mediaDevices.getUserMedia({ audio: { ...audio, deviceId: { exact: microphone } }, video: false }); }
    catch (error) { if (!(error instanceof DOMException && error.name === 'OverconstrainedError')) throw error; }
  }
  return navigator.mediaDevices.getUserMedia({ audio, video: false });
}

/** Lists audio inputs. Chromium's "default" entry follows the system choice, which Settings offers separately. */
export async function listMicrophones(): Promise<Microphone[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter(device => device.kind === 'audioinput' && device.deviceId && device.deviceId !== 'default')
    .map((device, index) => ({ id: device.deviceId, label: device.label || `Microphone ${index + 1}` }));
}

export function encodeWav(samples: Float32Array, sourceRate: number): ArrayBuffer {
  const rate = 16000;
  const count = Math.floor(samples.length * rate / sourceRate);
  const buffer = new ArrayBuffer(44 + count * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => [...value].forEach((letter, index) => view.setUint8(offset + index, letter.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, count * 2, true);
  for (let index = 0; index < count; index++) {
    const position = index * sourceRate / rate;
    const left = Math.floor(position);
    const fraction = position - left;
    const sample = samples[left] * (1 - fraction) + (samples[Math.min(left + 1, samples.length - 1)] ?? 0) * fraction;
    view.setInt16(44 + index * 2, Math.round(Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767)), true);
  }
  return buffer;
}
