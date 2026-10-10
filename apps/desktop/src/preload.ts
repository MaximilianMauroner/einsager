import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAction, DesktopBridge, DockEdge } from './shared/contract';

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
  active: value => ipcRenderer.send('active', value),
  onAction(callback) {
    const handler = (_event: Electron.IpcRendererEvent, action: DesktopAction) => callback(action);
    ipcRenderer.on('action', handler);
    return () => ipcRenderer.removeListener('action', handler);
  },
  onEdge(callback) {
    const handler = (_event: Electron.IpcRendererEvent, edge: DockEdge) => callback(edge);
    ipcRenderer.on('edge', handler);
    return () => ipcRenderer.removeListener('edge', handler);
  },
};
contextBridge.exposeInMainWorld('einsager', bridge);
