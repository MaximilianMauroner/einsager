import type { ClipboardMode, DockEdge, Settings } from '../shared/contract.ts';
import { DEFAULT_SHORTCUT, isShortcut } from '../shared/shortcut.ts';

const edges: readonly DockEdge[] = ['bottom', 'top', 'left', 'right'];
const clipboardModes: readonly ClipboardMode[] = ['always', 'if-paste-fails', 'never'];
export const defaultSettings: Settings = { edge: 'bottom', clipboard: 'if-paste-fails', keepHistory: true, showPill: true, shortcut: DEFAULT_SHORTCUT, microphone: '' };

const isEdge = (value: unknown): value is DockEdge => edges.some(edge => edge === value);
const isClipboardMode = (value: unknown): value is ClipboardMode => clipboardModes.some(mode => mode === value);

/** Applies the panel's editable fields one by one; invalid values keep the current value. */
export function mergeSettings(current: Settings, value: unknown): Settings {
  if (typeof value !== 'object' || value === null) return current;
  const next = { ...current };
  if ('edge' in value && isEdge(value.edge)) next.edge = value.edge;
  if ('clipboard' in value && isClipboardMode(value.clipboard)) next.clipboard = value.clipboard;
  if ('keepHistory' in value && typeof value.keepHistory === 'boolean') next.keepHistory = value.keepHistory;
  if ('showPill' in value && typeof value.showPill === 'boolean') next.showPill = value.showPill;
  if ('shortcut' in value && isShortcut(value.shortcut)) next.shortcut = value.shortcut;
  if ('microphone' in value && typeof value.microphone === 'string') next.microphone = value.microphone;
  return next;
}

/** Reads settings.json, which also holds the Codex folder chosen in the folder dialog. */
export function parseStoredSettings(value: unknown): Settings {
  const settings = mergeSettings(defaultSettings, value);
  if (typeof value === 'object' && value !== null && 'codexHome' in value && typeof value.codexHome === 'string') {
    settings.codexHome = value.codexHome;
  }
  return settings;
}
