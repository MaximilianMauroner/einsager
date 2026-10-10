import { BrowserWindow, screen } from 'electron';
import { panelFrame, type Rectangle } from './placement';

const WIDTH = 340;
/** A tray click that follows the blur it caused closes the panel instead of reopening it. */
const REOPEN_GUARD_MS = 250;

/** The tray panel: created hidden at startup so it opens at once, and hidden when it loses focus. */
export class TrayPanel {
  readonly window: BrowserWindow;
  private height = 420;
  private anchor?: Rectangle;
  private hiddenAt = 0;
  private holding = 0;
  private canPosition: boolean;

  /** `canPosition` is false where the compositor places windows, such as Wayland. */
  constructor(preload: string, canPosition: boolean, quitting: () => boolean) {
    this.canPosition = canPosition;
    this.window = new BrowserWindow({
      width: WIDTH, height: this.height, show: false, frame: false, transparent: true, hasShadow: true,
      resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
      skipTaskbar: true, alwaysOnTop: true,
      // A nonactivating macOS panel takes typing without activating the app, so focus returns to the editor on hide.
      ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
      webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.window.webContents.on('will-navigate', event => event.preventDefault());
    this.window.on('blur', () => { if (this.holding === 0) this.hide(); });
    this.window.on('close', event => {
      if (quitting()) return;
      event.preventDefault();
      this.hide();
    });
  }

  toggle(tray: Rectangle) {
    if (this.window.isVisible()) this.hide();
    else if (Date.now() - this.hiddenAt > REOPEN_GUARD_MS) this.show(tray);
  }

  show(tray: Rectangle) {
    this.anchor = tray;
    this.place();
    this.window.show();
    this.window.focus();
  }

  hide() {
    if (!this.window.isVisible()) return;
    this.hiddenAt = Date.now();
    this.window.hide();
  }

  /** Follows the renderer's content height; the panel grows away from the tray icon. */
  resize(height: number) {
    this.height = Math.round(Math.min(640, Math.max(120, height)));
    if (this.window.isVisible()) this.place();
  }

  /** Keeps the panel open while a dialog it opened has focus. */
  async holdOpen<T>(task: () => Promise<T>) {
    this.holding++;
    try { return await task(); }
    finally { this.holding--; }
  }

  private place() {
    // setSize clamps a non-resizable Linux window to its earlier minimum, as for the pill.
    if (!this.canPosition) { this.window.setContentSize(WIDTH, this.height); return; }
    const tray = this.anchor ?? { x: 0, y: 0, width: 0, height: 0 };
    const display = tray.width ? screen.getDisplayMatching(tray) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    this.window.setBounds(panelFrame({ width: WIDTH, height: this.height }, tray, display.workArea));
  }
}
