import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, session, Tray } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DesktopAction, DockEdge, TranscriptResult } from './contract';
import { clampFrame, dockFrame, nearestEdge } from './placement';
import { TranscriptionSession } from './transcription';

app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal');
const shortcut = 'Control+Alt+Space';
const edges: DockEdge[] = ['bottom', 'top', 'left', 'right'];
let window: BrowserWindow;
let tray: Tray;
let edge: DockEdge = 'bottom';
let codexHome: string | undefined;
let shortcutAvailable = false;
let lastText = '';
let transcription: TranscriptionSession;
let dragOrigin: Electron.Rectangle | undefined;
let pillHeight = 8;
let quitting = false;

const rendererFile = join(__dirname, 'renderer', 'index.html');
const rendererURL = pathToFileURL(rendererFile).href;
const settingsFile = () => join(app.getPath('userData'), 'settings.json');

function send(action: DesktopAction) { window.webContents.send('action', action); }
function reposition() {
  const display = screen.getDisplayMatching(window.getBounds());
  window.setBounds(dockFrame(window.getBounds(), display.workArea, edge, pillHeight));
}

async function saveSettings() {
  await writeFile(settingsFile(), JSON.stringify({ edge, codexHome }), { mode: 0o600 });
}

async function chooseCodexHome() {
  const selection = await dialog.showOpenDialog({ title: 'Select your Codex folder', properties: ['openDirectory', 'showHiddenFiles'] });
  if (selection.canceled) return;
  await transcription.cancel();
  send('cancel');
  codexHome = selection.filePaths[0];
  createTranscription();
  await saveSettings();
}

function createTranscription() {
  const name = 'einsager-transcribe' + (process.platform === 'win32' ? '.exe' : '');
  const file = app.isPackaged ? join(process.resourcesPath, name) : resolve('target/release', name);
  // Keep credentials inside the helper. The renderer never reads the login or receives tokens.
  transcription = new TranscriptionSession({ file }, { ...process.env, ...(codexHome ? { CODEX_HOME: codexHome } : {}) });
}

function contextMenu() {
  return Menu.buildFromTemplate([
    { label: 'Start / finish dictation', accelerator: shortcut, click: () => send('toggle') },
    { label: 'Cancel dictation', click: () => send('cancel') },
    { label: 'Retry transcription', click: () => send('retry') },
    { label: 'Copy last transcript', enabled: !!lastText, click: () => send('copy') },
    { type: 'separator' },
    ...edges.map(value => ({ label: `Dock at ${value}`, type: 'radio' as const, checked: value === edge,
      click: () => { edge = value; reposition(); window.webContents.send('edge', edge); void saveSettings(); } })),
    { type: 'separator' },
    { label: 'Select Codex folder…', click: () => { void chooseCodexHome(); } },
    { label: 'Quit einsager', click: () => app.quit() },
  ]);
}

async function deliver(result: TranscriptResult) {
  if ('text' in result && result.text.trim()) {
    lastText = result.text;
    tray.setContextMenu(contextMenu());
    try { clipboard.writeText(lastText); }
    catch { return { ...result, copied: false }; }
  }
  return result;
}

function installIPC() {
  // Only the bundled local top-level document may call privileged operations.
  const trusted = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => {
    if (event.sender !== window.webContents || event.senderFrame?.url !== rendererURL) throw new Error('Unknown renderer');
  };
  ipcMain.handle('info', event => {
    trusted(event);
    return { edge, shortcut: 'Ctrl+Alt+Space', shortcutAvailable, pasteKey: process.platform === 'darwin' ? '⌘V' : 'Ctrl+V' };
  });
  ipcMain.handle('transcribe', async (event, audio: unknown) => {
    trusted(event);
    if (!(audio instanceof ArrayBuffer)) return { error: 'Invalid recording.', retryable: false };
    return deliver(await transcription.transcribe(audio));
  });
  ipcMain.handle('retry', async event => { trusted(event); return deliver(await transcription.retry()); });
  ipcMain.handle('cancel', async event => { trusted(event); await transcription.cancel(); });
  ipcMain.handle('copy-last', event => {
    trusted(event);
    if (!lastText) return false;
    try { clipboard.writeText(lastText); return true; } catch { return false; }
  });
  ipcMain.on('menu', event => { trusted(event); contextMenu().popup({ window }); });
  ipcMain.on('active', (event, value: unknown) => {
    trusted(event);
    globalShortcut.unregister('Escape');
    if (value === true) globalShortcut.register('Escape', () => send('cancel'));
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
    const display = screen.getDisplayMatching(window.getBounds());
    // Apply size and position together; Linux may still report the previous size after setSize.
    window.setBounds(dockFrame(size, display.workArea, edge, pillHeight));
  });
  ipcMain.on('drag', (event, dx: unknown, dy: unknown, finished: unknown) => {
    trusted(event);
    if (typeof dx !== 'number' || typeof dy !== 'number' || !Number.isFinite(dx + dy)) return;
    dragOrigin ??= window.getBounds();
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const bounds = clampFrame({ ...dragOrigin, x: dragOrigin.x + dx, y: dragOrigin.y + dy }, display.workArea);
    window.setBounds(bounds);
    if (finished === true) {
      dragOrigin = undefined;
      edge = nearestEdge({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, display.workArea);
      window.webContents.send('edge', edge);
      reposition();
      void saveSettings();
    }
  });
}

async function start() {
  try {
    const value: unknown = JSON.parse(await readFile(settingsFile(), 'utf8'));
    if (typeof value === 'object' && value !== null) {
      if ('edge' in value && edges.some(edge => edge === value.edge)) edge = value.edge as DockEdge;
      if ('codexHome' in value && typeof value.codexHome === 'string') codexHome = value.codexHome;
    }
  } catch { /* First launch or invalid settings uses defaults. */ }
  createTranscription();
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
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('close', event => { if (!quitting) event.preventDefault(); });
  const icon = nativeImage.createFromPath(join(__dirname, 'tray.png'));
  icon.setTemplateImage(process.platform === 'darwin');
  tray = new Tray(icon);
  tray.setToolTip('einsager');
  tray.setContextMenu(contextMenu());
  tray.on('click', () => send('toggle'));
  shortcutAvailable = globalShortcut.register(shortcut, () => send('toggle'));
  installIPC();
  await window.loadFile(rendererFile);
  reposition();
  window.showInactive();
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
    globalShortcut.unregisterAll();
    void transcription?.cancel().finally(() => app.quit());
  });
  void app.whenReady().then(start).catch(error => { console.error(error); app.exit(1); });
}
