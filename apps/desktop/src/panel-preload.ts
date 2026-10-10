import { contextBridge, ipcRenderer } from 'electron';
import type { PanelBridge, PanelState } from './shared/contract';

const bridge: PanelBridge = {
  state: () => ipcRenderer.invoke('panel:state'),
  onState(callback) {
    const handler = (_event: Electron.IpcRendererEvent, state: PanelState) => callback(state);
    ipcRenderer.on('panel:state', handler);
    return () => ipcRenderer.removeListener('panel:state', handler);
  },
  onSpace(callback) {
    const handler = (_event: Electron.IpcRendererEvent, height: number) => callback(height);
    ipcRenderer.on('panel:space', handler);
    return () => ipcRenderer.removeListener('panel:space', handler);
  },
  act: action => ipcRenderer.send('panel:act', action),
  copy: id => ipcRenderer.invoke('panel:copy', id),
  remove: id => ipcRenderer.invoke('panel:remove', id),
  clear: () => ipcRenderer.invoke('panel:clear'),
  update: settings => ipcRenderer.invoke('panel:update', settings),
  chooseCodexHome: () => ipcRenderer.invoke('panel:codex'),
  resize: height => ipcRenderer.send('panel:resize', height),
  hide: () => ipcRenderer.send('panel:hide'),
  quit: () => ipcRenderer.send('panel:quit'),
};
contextBridge.exposeInMainWorld('einsagerPanel', bridge);
