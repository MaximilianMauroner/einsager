export type RecordingMode = 'hold' | 'handsFree';
type GestureStep = 'begin-hold' | 'begin-hands-free' | 'lock' | 'finish' | 'cancel' | 'none';

/** Presses closer together than this count as one tap sequence; shorter holds count as taps. */
const TAP_SECONDS = 0.5;

/**
 * Hold-key timing: hold to talk, release to transcribe,
 * double tap to lock hands-free, triple tap to cancel. Times are in seconds.
 */
export class HoldGesture {
  private firstPress = -Infinity;
  private presses = 0;
  private heldSince = 0;

  /** `mode` is the active recording's mode, or undefined when nothing is recording. */
  press(time: number, canStart: boolean, mode: RecordingMode | undefined): GestureStep {
    if (!canStart && !mode) return 'none';
    if (time - this.firstPress <= TAP_SECONDS) this.presses++;
    else { this.firstPress = time; this.presses = 1; }
    this.heldSince = time;
    if (this.presses >= 3) return 'cancel';
    if (this.presses === 2) return mode ? 'lock' : 'begin-hands-free';
    return canStart ? 'begin-hold' : 'none';
  }

  /** A tap, or a release while the microphone is still starting, discards the recording. */
  release(time: number, mode: RecordingMode | undefined, starting: boolean): GestureStep {
    if (mode !== 'hold') return 'none';
    return starting || time - this.heldSince < TAP_SECONDS ? 'cancel' : 'finish';
  }

  /** A hands-free start from a click or shortcut ends any tap sequence. */
  restart() {
    this.firstPress = -Infinity;
    this.presses = 0;
  }
}
