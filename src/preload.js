'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vps', {
  api: (route, q, body) => ipcRenderer.invoke('api', route, q, body),
  info: () => ipcRenderer.invoke('app:info'),
  pickFolder: () => ipcRenderer.invoke('app:pickFolder'),
  openPath: (p) => ipcRenderer.invoke('app:openPath', p),
  openUrl: (u) => ipcRenderer.invoke('app:openUrl', u),
  onCloseRequest: (cb) => ipcRenderer.on('app:close-request', () => cb()),
  confirmClose: () => ipcRenderer.send('app:close-confirmed'),
  onUpdate: (cb) => ipcRenderer.on('update', (_e, s) => cb(s)),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.send('update:install'),
  onRemote: (cb) => ipcRenderer.on('remote', async (_e, m) => {
    try { ipcRenderer.send('remote:reply', m.id, true, await cb(m.command, m.args)); }
    catch (e) { ipcRenderer.send('remote:reply', m.id, false, String(e && e.message || e)); }
  }),
  remoteInfo: () => ipcRenderer.invoke('remote:info'),
  setRemote: (on) => ipcRenderer.invoke('remote:set', on),
});
