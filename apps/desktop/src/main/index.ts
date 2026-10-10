import { app, BrowserWindow, clipboard, ClipboardItem, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, session, Tray } from 'electron';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DesktopAction, PanelState, SessionStatus, Settings, TranscriptResult } from '../shared/contract';
import { clampFrame, dockFrame, nearestEdge } from './placement';
import { TranscriptionSession } from './transcription';
import { platformFor } from './platform';
import { TranscriptDelivery } from './delivery';
import { systemClipboard } from './system-clipboard';
import { LinuxDesktop } from './linux/desktop';
import { describeRecording, TranscriptHistory, type Recording } from './history';
import { defaultSettings, mergeSettings, parseStoredSettings } from './settings';
import { TrayPanel } from './panel';
import { PrivateFile } from './private-file';

const platform = platformFor(process.platform);
const linux = process.platform === 'linux' ? new LinuxDesktop() : undefined;
const delivery = new TranscriptDelivery(systemClipboard(clipboard, ClipboardItem), linux ? signal => linux.captureTarget(signal) : undefined);
app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal');
const shortcut = 'Control+Alt+Space';
/** Lets focus return to the editor before the pill captures or checks the paste target. */
const PANEL_FOCUS_RETURN_MS = 150;
let window: BrowserWindow;
let panel: TrayPanel;
let tray: Tray;
let settings: Settings = defaultSettings;
let status: SessionStatus = { state: 'idle' };
let history: TranscriptHistory;
let settingsFile: PrivateFile;
let recording: Recording = { seconds: 0, voiceprint: [] };
let shortcutAvailable = false;
let transcription: TranscriptionSession;
let dragOrigin: Electron.Rectangle | undefined;
let pillHeight = 8;
let quitting = false;

const rendererFile = (page: string) => join(__dirname, 'renderer', page);
const rendererURL = pathToFileURL(rendererFile('index.html')).href;
const panelURL = pathToFileURL(rendererFile('panel.html')).href;

function send(action: DesktopAction) { window.webContents.send('action', action); }
function reposition() {
  if (linux?.canPositionWindow === false) return;
  const display = screen.getDisplayMatching(window.getBounds());
  window.setBounds(dockFrame(window.getBounds(), display.workArea, settings.edge, pillHeight));
}

async function saveSettings() {
  await settingsFile.write(JSON.stringify(settings));
}

async function chooseCodexHome() {
  // Escape stays unregistered while the dialog is open, so apply the rule again when it closes.
  const selection = await panel.holdOpen(() => dialog.showOpenDialog(panel.window,
    { title: 'Select your Codex folder', properties: ['openDirectory', 'showHiddenFiles'] })).finally(updateEscape);
  if (selection.canceled) return;
  delivery.cancel();
  await transcription.cancel();
  send('cancel');
  settings = { ...settings, codexHome: selection.filePaths[0] };
  createTranscription();
  await saveSettings();
  publish();
}

function createTranscription() {
  const name = platform.helperExecutable;
  const file = app.isPackaged ? join(process.resourcesPath, name) : resolve('target/release', name);
  // Keep credentials inside the helper. The renderer never reads the login or receives tokens.
  transcription = new TranscriptionSession({ file }, { ...process.env, ...(settings.codexHome ? { CODEX_HOME: settings.codexHome } : {}) });
}

function codexFolder() {
  const home = homedir();
  const folder = settings.codexHome || process.env.CODEX_HOME || join(home, '.codex');
  return folder === home || folder.startsWith(home + sep) ? '~' + folder.slice(home.length) : folder;
}

function panelState(): PanelState {
  const { codexHome: _, ...editable } = settings;
  return {
    status, history: [...history.entries], settings: editable, codexFolder: codexFolder(),
    shortcut: 'Ctrl+Alt+Space', shortcutAvailable, canPaste: linux?.canPaste ?? false,
    canPositionWindow: linux?.canPositionWindow !== false, desktopNotice: linux?.notice,
  };
}

/** Sends the current state to the panel and rebuilds the Linux tray menu, whose items are fixed once shown. */
function publish() {
  panel.window.webContents.send('panel:state', panelState());
  if (linux) tray.setContextMenu(actionMenu());
}

function openPanel() { panel.show(tray.getBounds()); }

/** Escape cancels a session from anywhere, except inside the focused panel or its dialog, which use it to close. */
function updateEscape() {
  globalShortcut.unregister('Escape');
  if (status.state !== 'idle' && !panel.window.isFocused() && !panel.holdingOpen) globalShortcut.register('Escape', () => send('cancel'));
}

function actionMenu() {
  return Menu.buildFromTemplate([
    { label: 'Start / finish dictation', accelerator: shortcut, click: () => send('toggle') },
    { label: 'Cancel dictation', enabled: status.state !== 'idle', click: () => send('cancel') },
    { label: 'Retry transcription', enabled: status.state === 'failure' && status.retryable, click: () => send('retry') },
    { label: 'Copy last transcript', enabled: delivery.hasTranscript, click: () => send('copy') },
    ...(linux ? [{ label: linux.notice, enabled: false }] : []),
    { type: 'separator' },
    { label: 'History and settings…', click: openPanel },
    { label: 'Quit einsager', click: () => app.quit() },
  ]);
}

function setEdge(edge: Settings['edge']) {
  settings = { ...settings, edge };
  reposition();
  window.webContents.send('edge', edge);
}

async function deliver(result: TranscriptResult, revision: number) {
  const delivered = await delivery.deliver(result, revision, settings.clipboard);
  if ('text' in delivered && delivered.text.trim() && settings.keepHistory) {
    await history.add(delivered.text, recording).catch(error => console.error('Could not save history', error));
  }
  publish();
  return delivered;
}

function parseStatus(value: unknown): SessionStatus | undefined {
  if (typeof value !== 'object' || value === null || !('state' in value)) return;
  const { state } = value;
  if (state === 'idle' || state === 'requesting' || state === 'recording' || state === 'processing') return { state };
  if (state === 'failure' && 'message' in value && typeof value.message === 'string'
    && 'retryable' in value && typeof value.retryable === 'boolean') {
    return { state, message: value.message, retryable: value.retryable };
  }
}

function installIPC() {
  // Only the bundled local top-level documents may call privileged operations, each on its own channels.
  const trusted = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => {
    if (event.sender !== window.webContents || event.senderFrame?.url !== rendererURL) throw new Error('Unknown renderer');
  };
  const fromPanel = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => {
    if (event.sender !== panel.window.webContents || event.senderFrame?.url !== panelURL) throw new Error('Unknown renderer');
  };
  ipcMain.handle('info', event => {
    trusted(event);
    return { edge: settings.edge, shortcut: 'Ctrl+Alt+Space', shortcutAvailable, pasteKey: platform.pasteKey,
      canPositionWindow: linux?.canPositionWindow !== false, desktopNotice: linux?.notice };
  });
  ipcMain.handle('begin', async event => {
    trusted(event);
    const preparation = delivery.begin();
    await transcription.cancel();
    await preparation;
  });
  ipcMain.handle('transcribe', async (event, audio: unknown) => {
    trusted(event);
    if (!(audio instanceof ArrayBuffer)) return { error: 'Invalid recording.', retryable: false };
    const revision = delivery.revision;
    recording = describeRecording(audio);
    return deliver(await transcription.transcribe(audio), revision);
  });
  ipcMain.handle('retry', async event => {
    trusted(event);
    const revision = delivery.revision;
    return deliver(await transcription.retry(), revision);
  });
  ipcMain.handle('cancel', async event => { trusted(event); delivery.cancel(); await transcription.cancel(); });
  ipcMain.handle('copy-last', event => {
    trusted(event);
    return delivery.copyLast();
  });
  ipcMain.on('menu', event => { trusted(event); actionMenu().popup({ window }); });
  ipcMain.on('status', (event, value: unknown) => {
    trusted(event);
    const next = parseStatus(value);
    if (!next) return;
    status = next;
    updateEscape();
    publish();
  });
  ipcMain.on('resize', (event, width: unknown, height: unknown, measuredPillHeight: unknown) => {
    trusted(event);
    if (typeof width !== 'number' || typeof height !== 'number' || typeof measuredPillHeight !== 'number'
      || !Number.isFinite(width + height + measuredPillHeight)) return;
    pillHeight = Math.min(28, Math.max(8, measuredPillHeight));
    const size = {
      width: Math.round(Math.min(420, Math.max(40, width))),
      height: Math.round(Math.min(180, Math.max(8, height))),
    };
    if (linux?.canPositionWindow === false) {
      // setSize clamps to a non-resizable Linux window's previous minimum size.
      window.setContentSize(size.width, size.height);
      return;
    }
    const display = screen.getDisplayMatching(window.getBounds());
    // Apply size and position together; Linux may still report the previous size after setSize.
    window.setBounds(dockFrame(size, display.workArea, settings.edge, pillHeight));
  });
  ipcMain.on('drag', (event, dx: unknown, dy: unknown, finished: unknown) => {
    trusted(event);
    if (linux?.canPositionWindow === false) return;
    if (typeof dx !== 'number' || typeof dy !== 'number' || !Number.isFinite(dx + dy)) return;
    dragOrigin ??= window.getBounds();
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const bounds = clampFrame({ ...dragOrigin, x: dragOrigin.x + dx, y: dragOrigin.y + dy }, display.workArea);
    window.setBounds(bounds);
    if (finished === true) {
      dragOrigin = undefined;
      setEdge(nearestEdge({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, display.workArea));
      void saveSettings();
      publish();
    }
  });

  ipcMain.handle('panel:state', event => { fromPanel(event); return panelState(); });
  ipcMain.on('panel:act', (event, action: unknown) => {
    fromPanel(event);
    if (action !== 'toggle' && action !== 'cancel' && action !== 'retry') return;
    panel.hide();
    setTimeout(() => send(action), PANEL_FOCUS_RETURN_MS);
  });
  ipcMain.handle('panel:copy', async (event, id: unknown) => {
    fromPanel(event);
    const entry = history.entries.find(item => item.id === id);
    return entry ? delivery.copy(entry.text) : false;
  });
  ipcMain.handle('panel:remove', async (event, id: unknown) => {
    fromPanel(event);
    const entry = history.entries.find(item => item.id === id);
    if (!entry) return;
    await history.remove(entry.id);
    delivery.forget(entry.text);
    publish();
  });
  ipcMain.handle('panel:clear', async event => {
    fromPanel(event);
    await history.clear();
    delivery.forget();
    publish();
  });
  ipcMain.handle('panel:update', async (event, value: unknown) => {
    fromPanel(event);
    const next = mergeSettings(settings, value);
    const edgeChanged = next.edge !== settings.edge;
    settings = next;
    if (edgeChanged) setEdge(next.edge);
    await saveSettings();
    publish();
  });
  ipcMain.handle('panel:codex', async event => { fromPanel(event); await chooseCodexHome(); });
  ipcMain.on('panel:resize', (event, height: unknown) => {
    fromPanel(event);
    if (typeof height === 'number' && Number.isFinite(height)) panel.resize(height);
  });
  ipcMain.on('panel:hide', event => { fromPanel(event); panel.hide(); });
  ipcMain.on('panel:quit', event => { fromPanel(event); app.quit(); });
}

async function start() {
  settingsFile = new PrivateFile(join(app.getPath('userData'), 'settings.json'));
  try { settings = parseStoredSettings(JSON.parse(await settingsFile.read())); }
  catch { /* First launch or invalid settings uses defaults. */ }
  history = new TranscriptHistory(join(app.getPath('userData'), 'history.json'));
  await history.load();
  createTranscription();
  await linux?.initialize();
  app.dock?.hide();
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(contents === window?.webContents && contents.getURL() === rendererURL && permission === 'media');
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission) => {
    return contents !== null && contents === window?.webContents && contents.getURL() === rendererURL && permission === 'media';
  });
  window = new BrowserWindow({
    width: 80, height: 32, show: false, frame: false, transparent: true,
    hasShadow: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, focusable: false,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required' },
  });
  if (linux?.canPositionWindow !== false) window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('close', event => { if (!quitting) event.preventDefault(); });
  panel = new TrayPanel(join(__dirname, 'panel-preload.cjs'), linux?.canPositionWindow !== false, () => quitting);
  panel.window.on('focus', updateEscape);
  panel.window.on('blur', updateEscape);
  // The 44 px asset is drawn for 2x screens. At 1x it would be twice the menu bar's height.
  const icon = nativeImage.createFromBuffer(await readFile(join(__dirname, 'tray.png')), { scaleFactor: 2 });
  icon.setTemplateImage(platform.templateTrayIcon);
  tray = new Tray(icon);
  tray.setToolTip('einsager');
  // Linux trays often deliver no clicks, so the menu is the reliable way in there.
  if (linux) tray.setContextMenu(actionMenu());
  else {
    tray.on('click', () => panel.toggle(tray.getBounds()));
    tray.on('right-click', () => tray.popUpContextMenu(actionMenu()));
  }
  shortcutAvailable = globalShortcut.register(shortcut, () => send('toggle'));
  installIPC();
  await window.loadFile(rendererFile('index.html'));
  reposition();
  window.showInactive();
  await panel.window.loadFile(rendererFile('panel.html'));
  screen.on('display-removed', reposition);
  screen.on('display-metrics-changed', reposition);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => window?.showInactive());
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    delivery.cancel();
    if (app.isReady()) globalShortcut.unregisterAll();
    // A paste's pending restore runs now, so quitting gives the earlier clipboard back.
    // Quitting before startup completes has no transcription session to cancel.
    void Promise.all([delivery.restoreNow(), transcription?.cancel()]).finally(() => app.quit());
  });
  void app.whenReady().then(start).catch(error => { console.error(error); app.exit(1); });
}
