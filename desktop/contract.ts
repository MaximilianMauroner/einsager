export type DockEdge = 'bottom' | 'top' | 'left' | 'right';
export type DesktopAction = 'toggle' | 'cancel' | 'retry' | 'copy';
export type TranscriptResult = { text: string; copied?: boolean } | { error: string } | { cancelled: true };

export interface DesktopInfo {
  edge: DockEdge;
  shortcut: string;
  shortcutAvailable: boolean;
  pasteKey: string;
}

export interface DesktopBridge {
  info(): Promise<DesktopInfo>;
  transcribe(wav: ArrayBuffer): Promise<TranscriptResult>;
  retry(): Promise<TranscriptResult>;
  cancel(): Promise<void>;
  copyLast(): Promise<boolean>;
  resize(width: number, height: number): void;
  drag(dx: number, dy: number, finished: boolean): void;
  menu(): void;
  active(value: boolean): void;
  onAction(callback: (action: DesktopAction) => void): () => void;
  onEdge(callback: (edge: DockEdge) => void): () => void;
}
