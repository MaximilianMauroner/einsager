import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PasteTarget } from '../delivery.ts';

const execute = promisify(execFile);
type Command = (args: string[], signal?: AbortSignal) => Promise<string>;

export function linuxSession(environment: NodeJS.ProcessEnv) {
  // Xwayland can expose DISPLAY inside Wayland; it cannot control native Wayland apps.
  if (environment.XDG_SESSION_TYPE?.toLowerCase() === 'wayland' || environment.WAYLAND_DISPLAY) return 'wayland';
  return environment.DISPLAY ? 'x11' : 'headless';
}

/** Linux desktop capabilities and X11 window-targeted paste. Never changes focus. */
export class LinuxDesktop {
  readonly session: ReturnType<typeof linuxSession>;
  readonly canPositionWindow: boolean;
  private hasXdotool = false;
  private command: Command;

  constructor(environment = process.env, command: Command = async (args, signal) => {
    const { stdout } = await execute('xdotool', args, { env: environment, timeout: 1500, maxBuffer: 4096, signal });
    return stdout.trim();
  }) {
    this.session = linuxSession(environment);
    this.canPositionWindow = this.session === 'x11';
    this.command = command;
  }

  async initialize() {
    if (this.session !== 'x11') return;
    try { await this.command(['--version']); this.hasXdotool = true; }
    catch { /* Recording and clipboard delivery do not require xdotool. */ }
  }

  get notice() {
    if (this.session === 'wayland') return 'Wayland: paste by hand; your desktop controls pill placement.';
    if (this.session === 'headless') return 'No desktop display. Start einsager in your desktop session.';
    return this.hasXdotool
      ? 'Automatic paste when the same X11 window keeps focus. Text also stays copied.'
      : 'Install xdotool for automatic paste. Text is copied for manual paste.';
  }

  async captureTarget(signal: AbortSignal): Promise<PasteTarget | undefined> {
    if (!this.hasXdotool || signal.aborted) return;
    try {
      const target = await this.command(['getwindowfocus'], signal);
      if (!/^\d+$/.test(target) || Number(target) <= 1) return;
      const pid = await this.command(['getwindowpid', target], signal);
      if (!/^\d+$/.test(pid) || Number(pid) === process.pid) return;
      return async (ready, signal) => {
        if (!await ready() || signal.aborted) return false;
        const focus = await this.command(['getwindowfocus'], signal);
        if (focus !== target) return false;
        const owner = await this.command(['getwindowpid', target], signal);
        if (owner !== pid || !await ready() || signal.aborted) return false;
        // Explicit targeting avoids sending Ctrl+V to a new window during a focus race.
        // Some clients reject these XSendEvent keys; preserve the transcript for manual paste.
        await this.command(['key', '--window', target, '--delay', '0', 'ctrl+v'], signal);
        return true;
      };
    } catch { return; }
  }
}
