import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { KeyboardCommand, KeyboardState } from '../shared/contract.ts';

type KeyboardAction = 'holdPressed' | 'holdReleased' | 'toggle' | 'interrupted';
type Message = { event: 'state'; state: KeyboardState } | { event: 'action'; action: KeyboardAction };

const actions: readonly KeyboardAction[] = ['holdPressed', 'holdReleased', 'toggle', 'interrupted'];

/** Reads one line from the macOS keyboard helper. Anything unexpected is ignored. */
export function parseHelperLine(line: string): Message | undefined {
  let value: unknown;
  try { value = JSON.parse(line); } catch { return; }
  if (typeof value !== 'object' || value === null || !('event' in value)) return;
  if (value.event === 'action' && 'action' in value) {
    const action = actions.find(item => item === value.action);
    return action && { event: 'action', action };
  }
  if (value.event !== 'state' || !('trusted' in value) || !('hold' in value) || !('handsFree' in value)) return;
  const { trusted, hold, handsFree } = value;
  if (typeof trusted !== 'boolean' || typeof hold !== 'string' || typeof handsFree !== 'string') return;
  const capturing = 'capturing' in value && (value.capturing === 'hold' || value.capturing === 'handsFree') ? value.capturing : null;
  const error = 'error' in value && typeof value.error === 'string' ? value.error : null;
  return { event: 'state', state: { trusted, hold, handsFree, capturing, error } };
}

/** Owns the macOS keyboard helper, which provides Fn hold-to-talk and custom shortcuts. */
export class MacKeyboard {
  private child?: ChildProcess;
  private file: string;
  private onState: (state: KeyboardState | undefined) => void;
  private onAction: (action: KeyboardAction) => void;

  constructor(file: string, onState: (state: KeyboardState | undefined) => void, onAction: (action: KeyboardAction) => void) {
    this.file = file;
    this.onState = onState;
    this.onAction = onAction;
  }

  start() {
    const child = spawn(this.file, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.child = child;
    // A missing or crashed helper leaves the Electron fallback shortcut in charge.
    child.on('error', () => this.stopped(child));
    child.on('exit', () => this.stopped(child));
    // A write after the helper dies fails with EPIPE; 'exit' already reports the fallback.
    child.stdin.on('error', () => {});
    createInterface({ input: child.stdout }).on('line', line => {
      const message = parseHelperLine(line);
      if (message?.event === 'state') this.onState(message.state);
      if (message?.event === 'action') this.onAction(message.action);
    });
  }

  send(command: KeyboardCommand) {
    this.child?.stdin?.write(JSON.stringify(command) + '\n');
  }

  stop() {
    const child = this.child;
    this.child = undefined;
    child?.kill();
  }

  private stopped(child: ChildProcess) {
    if (this.child !== child) return;
    this.child = undefined;
    this.onState(undefined);
  }
}
