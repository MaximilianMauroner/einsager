import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

/** Holds the native host's profile flock in a helper that has no keyboard or permission duties. */
export class ProfileLock {
  private child?: ChildProcess;
  private closed?: Promise<void>;
  private cancelAcquire?: () => void;
  private releasing = false;
  private file: string;
  private onLost: (error: Error) => void;
  private timeoutMs: number;

  constructor(file: string, onLost: (error: Error) => void, timeoutMs = 5000) {
    this.file = file;
    this.onLost = onLost;
    this.timeoutMs = timeoutMs;
  }

  acquire(directory: string) {
    if (this.child || this.releasing) return Promise.reject(new Error('Profile lock is already started or closed.'));
    const child = spawn(this.file, ['--profile-lock', directory], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.child = child;
    this.closed = new Promise(resolve => child.once('close', () => resolve()));
    child.stdin.on('error', () => {});
    return new Promise<void>((resolve, reject) => {
      let answered = false;
      let locked = false;
      const finish = (error?: Error) => {
        if (answered) return;
        answered = true;
        clearTimeout(timer);
        this.cancelAcquire = undefined;
        if (error) { child.kill(); reject(error); }
        else { locked = true; resolve(); }
      };
      const stopped = () => {
        if (this.releasing) return;
        const error = new Error('The profile lock helper stopped.');
        if (locked) { locked = false; this.onLost(error); }
        else finish(error);
      };
      const timer = setTimeout(() => finish(new Error('The profile lock helper timed out.')), this.timeoutMs);
      this.cancelAcquire = () => finish(new Error('Profile lock acquisition was cancelled.'));
      child.once('error', stopped);
      child.once('close', stopped);
      createInterface({ input: child.stdout }).once('line', line => {
        let value: unknown;
        try { value = JSON.parse(line); } catch { /* Invalid output fails closed below. */ }
        if (typeof value !== 'object' || value === null || !('profile' in value)) {
          finish(new Error('Invalid profile lock helper response.'));
        } else if (value.profile === 'locked') finish();
        else finish(new Error(value.profile === 'busy' ? 'einsager is already using this profile.' : 'Cannot lock the einsager profile.'));
      });
    });
  }

  /** Release only after the host has stopped work and settled every profile write. */
  async release() {
    this.releasing = true;
    this.cancelAcquire?.();
    const child = this.child;
    if (!child) return;
    child.stdin?.end();
    const timer = setTimeout(() => child.kill('SIGKILL'), 1000);
    try { await this.closed; }
    finally { clearTimeout(timer); }
  }
}
