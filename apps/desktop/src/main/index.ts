import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, session, Tray } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DesktopAction, DockEdge, TranscriptResult } from '../shared/contract';
import { clampFrame, dockFrame, nearestEdge } from './placement';
import { TranscriptionSession } from './transcription';
import { platformFor } from './platform';
import { TranscriptDelivery } from './delivery';
import { LinuxDesktop } from './linux/desktop';

const platform = platformFor(process.platform);
const linux = process.platform === 'linux' ? new LinuxDesktop() : undefined;
const delivery = new TranscriptDelivery(clipboard, linux ? signal => linux.captureTarget(signal) : undefined);
app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal');
const shortcut = 'Control+Alt+Space';
const edges: DockEdge[] = ['bottom', 'top', 'left', 'right'];
let window: BrowserWindow;
let tray: Tray;
let edge: DockEdge = 'bottom';
let codexHome: string | undefined;
let shortcutAvailable = false;
let transcription: TranscriptionSession;
let dragOrigin: Electron.Rectangle | undefined;
let pillHeight = 8;
let quitting = false;

const rendererFile = join(__dirname, 'renderer', 'index.html');
const rendererURL = pathToFileURL(rendererFile).href;
const settingsFile = () => join(app.getPath('userData'), 'settings.json');

function send(action: DesktopAction) { window.webContents.send('action', action); }
function reposition() {
  if (linux?.canPositionWindow === false) return;
  const display = screen.getDisplayMatching(window.getBounds());
  window.setBounds(dockFrame(window.getBounds(), display.workArea, edge, pillHeight));
}

async function saveSettings() {
  await writeFile(settingsFile(), JSON.stringify({ edge, codexHome }), { mode: 0o600 });
}

async function chooseCodexHome() {
  const selection = await dialog.showOpenDialog({ title: 'Select your Codex folder', properties: ['openDirectory', 'showHiddenFiles'] });
  if (selection.canceled) return;
  delivery.cancel();
  await transcription.cancel();
  send('cancel');
  codexHome = selection.filePaths[0];
  createTranscription();
  await saveSettings();
}

function createTranscription() {
  const name = platform.helperExecutable;
  const file = app.isPackaged ? join(process.resourcesPath, name) : resolve('target/release', name);
  // Keep credentials inside the helper. The renderer never reads the login or receives tokens.
  transcription = new TranscriptionSession({ file }, { ...process.env, ...(codexHome ? { CODEX_HOME: codexHome } : {}) });
}

function contextMenu() {
  return Menu.buildFromTemplate([
    { label: 'Start / finish dictation', accelerator: shortcut, click: () => send('toggle') },
    { label: 'Cancel dictation', click: () => send('cancel') },
    { label: 'Retry transcription', click: () => send('retry') },
    { label: 'Copy last transcript', enabled: delivery.hasTranscript, click: () => send('copy') },
    ...(linux ? [{ label: linux.notice, enabled: false }] : []),
    { type: 'separator' },
    ...edges.map(value => ({ label: `Dock at ${value}`, type: 'radio' as const, checked: value === edge, enabled: linux?.canPositionWindow !== false,
      click: () => { edge = value; reposition(); window.webContents.send('edge', edge); void saveSettings(); } })),
    { type: 'separator' },
    { label: 'Select Codex folder…', click: () => { void chooseCodexHome(); } },
    { label: 'Quit einsager', click: () => app.quit() },
  ]);
}

async function deliver(result: TranscriptResult, revision: number) {
  const delivered = await delivery.deliver(result, revision);
  tray.setContextMenu(contextMenu());
  return delivered;
}

function installIPC() {
  // Only the bundled local top-level document may call privileged operations.
  const trusted = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => {
    if (event.sender !== window.webContents || event.senderFrame?.url !== rendererURL) throw new Error('Unknown renderer');
  };
  ipcMain.handle('info', event => {
    trusted(event);
    return { edge, shortcut: 'Ctrl+Alt+Space', shortcutAvailable, pasteKey: platform.pasteKey,
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
    if (linux?.canPositionWindow === false) {
      // setSize clamps to a non-resizable Linux window's previous minimum size.
      window.setContentSize(size.width, size.height);
      return;
    }
    const display = screen.getDisplayMatching(window.getBounds());
    // Apply size and position together; Linux may still report the previous size after setSize.
    window.setBounds(dockFrame(size, display.workArea, edge, pillHeight));
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
  const icon = nativeImage.createFromPath(join(__dirname, 'tray.png'));
  icon.setTemplateImage(platform.templateTrayIcon);
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
    delivery.cancel();
    globalShortcut.unregisterAll();
    void transcription?.cancel().finally(() => app.quit());
  });
  void app.whenReady().then(start).catch(error => { console.error(error); app.exit(1); });
}
