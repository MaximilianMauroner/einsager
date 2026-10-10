export type DockEdge = 'bottom' | 'top' | 'left' | 'right';
export type DesktopAction = 'toggle' | 'finish' | 'cancel' | 'retry' | 'copy' | 'hold-pressed' | 'hold-released' | 'hold-interrupted';
/** When the transcript may stay on the clipboard. Paste always borrows it briefly. */
export type ClipboardMode = 'always' | 'if-paste-fails' | 'never';
export type Delivery = 'pasted' | 'pasted-and-copied' | 'copied' | 'not-copied' | 'clipboard-failed';
export type TranscriptResult = { text: string; delivery?: Delivery } | { error: string; retryable: boolean } | { cancelled: true };
export type SessionStatus = { state: 'idle' | 'requesting' | 'recording' | 'processing' } | { state: 'failure'; message: string; retryable: boolean };

export interface DesktopInfo {
  edge: DockEdge;
  /** The hands-free shortcut. */
  shortcut: string;
  /** The hold-to-talk key, when the macOS keyboard helper is active. */
  holdKey?: string;
  shortcutAvailable: boolean;
  pasteKey: string;
  canPositionWindow: boolean;
  desktopNotice?: string;
}

export interface DesktopBridge {
  info(): Promise<DesktopInfo>;
  begin(): Promise<void>;
  transcribe(wav: ArrayBuffer): Promise<TranscriptResult>;
  retry(): Promise<TranscriptResult>;
  cancel(): Promise<void>;
  copyLast(): Promise<boolean>;
  resize(width: number, height: number, pillHeight: number): void;
  drag(dx: number, dy: number, finished: boolean): void;
  menu(): void;
  status(value: SessionStatus): void;
  /** Tells the host whether the pill has something to show, so a hidden idle pill can appear. */
  visible(value: boolean): void;
  onAction(callback: (action: DesktopAction) => void): () => void;
  onInfo(callback: (info: DesktopInfo) => void): () => void;
}

export interface HistoryEntry {
  id: string;
  text: string;
  /** Milliseconds since the Unix epoch. */
  at: number;
  seconds: number;
  /** Relative loudness from 0 to 1 across the recording. No audio is kept. */
  voiceprint: number[];
}

export interface Settings {
  edge: DockEdge;
  clipboard: ClipboardMode;
  keepHistory: boolean;
  /** Keeps the idle pill on screen. When false, it appears only for a session or a result. */
  showPill: boolean;
  /** Electron's global shortcut for hands-free dictation, such as "Ctrl+Alt+Space". */
  shortcut: string;
  /** Custom Codex folder; the helper's default lookup applies when absent. */
  codexHome?: string;
}

export type PanelSettings = Omit<Settings, 'codexHome'>;

/** The macOS keyboard helper's shortcuts, shown as key names such as "Fn" or "Fn+Space". */
export interface KeyboardState {
  /** Accessibility access lets the helper see Fn; without it, only the fallback shortcut works. */
  trusted: boolean;
  hold: string;
  handsFree: string;
  capturing: 'hold' | 'handsFree' | null;
  error: string | null;
}
export type KeyboardCommand = { command: 'capture'; target: 'hold' | 'handsFree' } | { command: 'stopCapture' | 'reset' | 'prompt' };

export interface PanelState {
  status: SessionStatus;
  /** Oldest first, so the newest entry sits above the panel's pill. */
  history: HistoryEntry[];
  settings: PanelSettings;
  /** The Codex folder the helper reads, shortened with ~ for display. */
  codexFolder: string;
  /** False when another app holds the Electron shortcut in settings. */
  shortcutAvailable: boolean;
  canPaste: boolean;
  canPositionWindow: boolean;
  desktopNotice?: string;
  /** Present on macOS while the keyboard helper runs. */
  keyboard?: KeyboardState;
}

export type PanelAction = 'toggle' | 'finish' | 'cancel' | 'retry';

export interface PanelBridge {
  state(): Promise<PanelState>;
  onState(callback: (state: PanelState) => void): () => void;
  /** Reports the height of the work area the panel is placed in. */
  onSpace(callback: (height: number) => void): () => void;
  act(action: PanelAction): void;
  copy(id: string): Promise<boolean>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  update(settings: Partial<PanelSettings>): Promise<void>;
  chooseCodexHome(): Promise<void>;
  shortcut(command: KeyboardCommand): void;
  /** Releases the Electron shortcut while the panel records a new one, so its keys reach the panel. */
  recordShortcut(active: boolean): void;
  resize(height: number): void;
  hide(): void;
  quit(): void;
}
