export type DockEdge = 'bottom' | 'top' | 'left' | 'right';
export type DesktopAction = 'toggle' | 'cancel' | 'retry' | 'copy';
/** When the transcript may stay on the clipboard. Paste always borrows it briefly. */
export type ClipboardMode = 'always' | 'if-paste-fails' | 'never';
export type Delivery = 'pasted' | 'pasted-and-copied' | 'copied' | 'not-copied' | 'clipboard-failed';
export type TranscriptResult = { text: string; delivery?: Delivery } | { error: string; retryable: boolean } | { cancelled: true };
export type SessionStatus = { state: 'idle' | 'requesting' | 'recording' | 'processing' } | { state: 'failure'; message: string; retryable: boolean };

export interface DesktopInfo {
  edge: DockEdge;
  shortcut: string;
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
  onAction(callback: (action: DesktopAction) => void): () => void;
  onEdge(callback: (edge: DockEdge) => void): () => void;
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
  /** Custom Codex folder; the helper's default lookup applies when absent. */
  codexHome?: string;
}

export type PanelSettings = Omit<Settings, 'codexHome'>;

export interface PanelState {
  status: SessionStatus;
  /** Oldest first, so the newest entry sits above the panel's pill. */
  history: HistoryEntry[];
  settings: PanelSettings;
  /** The Codex folder the helper reads, shortened with ~ for display. */
  codexFolder: string;
  shortcut: string;
  shortcutAvailable: boolean;
  canPaste: boolean;
  canPositionWindow: boolean;
  desktopNotice?: string;
}

export type PanelAction = 'toggle' | 'cancel' | 'retry';

export interface PanelBridge {
  state(): Promise<PanelState>;
  onState(callback: (state: PanelState) => void): () => void;
  act(action: PanelAction): void;
  copy(id: string): Promise<boolean>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  update(settings: Partial<PanelSettings>): Promise<void>;
  chooseCodexHome(): Promise<void>;
  resize(height: number): void;
  hide(): void;
  quit(): void;
}
