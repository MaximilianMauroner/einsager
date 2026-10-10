import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { KeyboardCommand, KeyboardState } from '../shared/contract.ts';
import type { PasteTarget } from './delivery.ts';

type KeyboardAction = 'holdPressed' | 'holdReleased' | 'toggle' | 'interrupted';
type Message = { event: 'state'; state: KeyboardState } | { event: 'action'; action: KeyboardAction }
  | { event: 'reply'; id: string; ok: boolean };

const actions: readonly KeyboardAction[] = ['holdPressed', 'holdReleased', 'toggle', 'interrupted'];
/** The helper answers at once; a missing answer means it is stuck, so the paste falls back to manual. */
const REPLY_TIMEOUT_MS = 1500;

/** Reads one line from the macOS keyboard helper. Anything unexpected is ignored. */
export function parseHelperLine(line: string): Message | undefined {
  let value: unknown;
  try { value = JSON.parse(line); } catch { return; }
  if (typeof value !== 'object' || value === null || !('event' in value)) return;
  if (value.event === 'action' && 'action' in value) {
    const action = actions.find(item => item === value.action);
    return action && { event: 'action', action };
  }
  if (value.event === 'reply' && 'id' in value && typeof value.id === 'string' && 'ok' in value) {
    return { event: 'reply', id: value.id, ok: value.ok === true };
  }
  if (value.event !== 'state' || !('trusted' in value) || !('hold' in value) || !('handsFree' in value)) return;
  const { trusted, hold, handsFree } = value;
  if (typeof trusted !== 'boolean' || typeof hold !== 'string' || typeof handsFree !== 'string') return;
  const capturing = 'capturing' in value && (value.capturing === 'hold' || value.capturing === 'handsFree') ? value.capturing : null;
  const error = 'error' in value && typeof value.error === 'string' ? value.error : null;
  return { event: 'state', state: { trusted, hold, handsFree, capturing, error } };
}

/** Owns the macOS keyboard helper, which provides Fn hold-to-talk, custom shortcuts, and paste. */
export class MacKeyboard {
  private child?: ChildProcess;
  private lastRequest = 0;
  private replies = new Map<string, (ok: boolean) => void>();
  private file: string;
  private onState: (state: KeyboardState | undefined) => void;
  private onAction: (action: KeyboardAction) => void;

  constructor(file: string, onState: (state: KeyboardState | undefined) => void, onAction: (action: KeyboardAction) => void) {
    this.file = file;
    this.onState = onState;
    this.onAction = onAction;
  }

  /** Resolves once the helper reports its first state, or stops before it does. */
  start() {
    const child = spawn(this.file, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.child = child;
    return new Promise<void>(resolve => {
      // A missing or crashed helper leaves the Electron fallback shortcut in charge.
      // 'close' follows the helper's last output line, so no action arrives after it stops.
      child.on('error', () => { this.stopped(child); resolve(); });
      child.on('close', () => { this.stopped(child); resolve(); });
      // A write after the helper dies fails with EPIPE; 'close' already reports the fallback.
      child.stdin.on('error', () => {});
      createInterface({ input: child.stdout }).on('line', line => {
        const message = parseHelperLine(line);
        if (message?.event === 'state') { this.onState(message.state); resolve(); }
        if (message?.event === 'action') this.onAction(message.action);
        if (message?.event === 'reply') this.replies.get(message.id)?.(message.ok);
      });
    });
  }

  send(command: KeyboardCommand) {
    this.child?.stdin?.write(JSON.stringify(command) + '\n');
  }

  /**
   * Remembers the app and text field that have focus as a recording begins. The returned paste sends
   * Command+V only while both still have focus. Without Accessibility access there is no target.
   */
  async captureTarget(signal: AbortSignal): Promise<PasteTarget | undefined> {
    const id = String(++this.lastRequest);
    if (!await this.request({ command: 'target', id }, signal)) return;
    return async (ready, signal) => await ready() && this.request({ command: 'paste', id }, signal);
  }

  stop() {
    const child = this.child;
    this.child = undefined;
    child?.kill();
  }

  /** Resolves with the helper's answer, or false when it stops, does not answer in time, or the signal aborts. */
  private request(message: { command: 'target' | 'paste'; id: string }, signal: AbortSignal) {
    const child = this.child;
    if (!child || signal.aborted) return Promise.resolve(false);
    return new Promise<boolean>(resolve => {
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        this.replies.delete(message.id);
        resolve(ok);
      };
      const abort = () => finish(false);
      const timer = setTimeout(abort, REPLY_TIMEOUT_MS);
      signal.addEventListener('abort', abort, { once: true });
      this.replies.set(message.id, finish);
      child.stdin?.write(JSON.stringify(message) + '\n');
    });
  }

  private stopped(child: ChildProcess) {
    if (this.child !== child) return;
    this.child = undefined;
    for (const finish of [...this.replies.values()]) finish(false);
    // No release can arrive now, so the pill cancels a hold-mode recording. stop() clears the child first, so quitting sends nothing.
    this.onAction('interrupted');
    this.onState(undefined);
  }
}
