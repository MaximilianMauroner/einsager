import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAction, DesktopBridge, DesktopInfo } from './shared/contract';

const bridge: DesktopBridge = {
  info: () => ipcRenderer.invoke('info'),
  begin: () => ipcRenderer.invoke('begin'),
  transcribe: wav => ipcRenderer.invoke('transcribe', wav),
  retry: () => ipcRenderer.invoke('retry'),
  cancel: () => ipcRenderer.invoke('cancel'),
  copyLast: () => ipcRenderer.invoke('copy-last'),
  resize: (width, height, pillHeight) => ipcRenderer.send('resize', width, height, pillHeight),
  drag: (dx, dy, finished) => ipcRenderer.send('drag', dx, dy, finished),
  menu: () => ipcRenderer.send('menu'),
  status: value => ipcRenderer.send('status', value),
  visible: value => ipcRenderer.send('visible', value),
  microphones: value => ipcRenderer.send('microphones', value),
  onAction(callback) {
    const handler = (_event: Electron.IpcRendererEvent, action: DesktopAction) => callback(action);
    ipcRenderer.on('action', handler);
    return () => ipcRenderer.removeListener('action', handler);
  },
  onInfo(callback) {
    const handler = (_event: Electron.IpcRendererEvent, info: DesktopInfo) => callback(info);
    ipcRenderer.on('info', handler);
    return () => ipcRenderer.removeListener('info', handler);
  },
};
contextBridge.exposeInMainWorld('einsager', bridge);
