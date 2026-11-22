'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, nativeImage, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const backend = require('./backend');

if (process.env.VPS_USERDATA) app.setPath('userData', process.env.VPS_USERDATA);
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

protocol.registerSchemesAsPrivileged([
  { scheme: 'vps', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

let win = null;
let forceClose = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 950, minWidth: 1100, minHeight: 650,
    backgroundColor: '#0d0e11', title: 'VELOX Preset Studio', show: false,
    icon: path.join(__dirname, 'renderer', 'assets', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#14161b', symbolColor: '#c9d1dc', height: 52 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
  });
  Menu.setApplicationMenu(null);
  win.webContents.on('console-message', (e) => {
    const lvl = e.level ?? 0;
    if (lvl === 'error' || lvl === 'warning' || lvl >= 2) {
      try { fs.appendFileSync(path.join(app.getPath('userData'), 'renderer.log'), `[${new Date().toISOString()}] ${e.message} (${e.sourceId}:${e.lineNumber})\n`); } catch { }
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { win.show(); if (process.env.VPS_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' }); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.on('close', (e) => {
    if (forceClose) return;
    e.preventDefault();
    win.webContents.send('app:close-request');
  });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  const dataDir = process.env.VPS_DATADIR || path.join(app.getPath('documents'), 'VELOX Preset Studio');
  backend.init({ settingsFile: path.join(app.getPath('userData'), 'settings.json'), dataDir, nativeImage });
  protocol.handle('vps', (req) => {
    const u = new URL(req.url);
    try {
      const r = backend.imageResponse(u.hostname, u.searchParams);
      if (!r) return new Response('not found', { status: 404 });
      return new Response(r.data, { headers: { 'content-type': r.type, 'cache-control': 'max-age=60' } });
    } catch (e) { return new Response(String(e.message || e), { status: 500 }); }
  });
  createWindow();
  setupUpdater();
  if (backend.settings().remote !== false) startControl();
});

// ------------------------------------------------------------ remote control API (for Claude via MCP)
// 127.0.0.1 only, random token in userData/api.json. Requests are either answered by the backend
// directly or forwarded to the UI, so the open window always shows what happens.
const http = require('http');
const crypto = require('crypto');
let ctlServer = null;
const pending = new Map();
const apiFile = () => path.join(app.getPath('userData'), 'api.json');
function toUi(command, args) {
  return new Promise((resolve, reject) => {
    if (!win || win.isDestroyed()) return reject(new Error('Fenster nicht offen'));
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Zeitüberschreitung')); }, 60000);
    pending.set(id, { resolve, reject, timer });
    win.webContents.send('remote', { id, command, args: args || {} });
  });
}
ipcMain.on('remote:reply', (_e, id, ok, data) => {
  const p = pending.get(id); if (!p) return;
  pending.delete(id); clearTimeout(p.timer);
  ok ? p.resolve(data) : p.reject(new Error(data));
});
async function capture(file) {
  win.webContents.invalidate();
  await new Promise((r) => setTimeout(r, 250));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(file, img.toPNG());
  return file;
}
function startControl() {
  if (ctlServer) return;
  const token = crypto.randomBytes(24).toString('hex');
  ctlServer = http.createServer(async (req, res) => {
    const reply = (code, obj) => { const d = JSON.stringify(obj); res.writeHead(code, { 'content-type': 'application/json' }); res.end(d); };
    if (req.headers['x-vps-token'] !== token) return reply(401, { error: 'unauthorized' });
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 20e6) req.destroy(); });
    req.on('end', async () => {
      try {
        const u = new URL(req.url, 'http://x');
        const b = body ? JSON.parse(body) : {};
        const q = Object.fromEntries(u.searchParams);
        const r = u.pathname.replace(/^\/+/, '');
        let out;
        if (r === 'state') out = { app: { version: app.getVersion() }, ...(await backend.api('state')), ui: await toUi('getCurrent').catch(() => null) };
        else if (r === 'run') out = await toUi(b.command, b.args);
        else if (r === 'batch') { out = []; for (const s of b.steps || []) out.push(await toUi(s.command, s.args)); }
        else if (r === 'view') out = { file: await capture(path.join(app.getPath('temp'), `vps-view-${Date.now()}.png`)) };
        else if (r === 'shotfile') {
          const list = await backend.api('shots');
          const name = b.name || (list[0] && list[0].name);
          if (!name) throw new Error('Keine Screenshots vorhanden');
          out = { file: path.join((await backend.api('state')).shotsDir, path.basename(name)), name };
        } else out = await backend.api(r, q, b);
        reply(200, out ?? { ok: true });
      } catch (e) { reply(400, { error: String(e.message || e) }); }
    });
  });
  ctlServer.listen(0, '127.0.0.1', () => {
    fs.writeFileSync(apiFile(), JSON.stringify({ port: ctlServer.address().port, token, pid: process.pid }));
  });
}
function stopControl() {
  if (ctlServer) { ctlServer.close(); ctlServer = null; }
  try { fs.unlinkSync(apiFile()); } catch { }
}
app.on('will-quit', stopControl);
ipcMain.handle('remote:info', () => ({
  on: !!ctlServer,
  mcp: path.join(app.isPackaged ? process.resourcesPath + '\\app.asar.unpacked' : app.getAppPath(), 'tools', 'vps-mcp.js'),
}));
ipcMain.handle('remote:set', (_e, on) => { backend.setSetting('remote', !!on); on ? startControl() : stopControl(); return { on: !!ctlServer }; });
app.on('window-all-closed', () => app.quit());

// ------------------------------------------------------------ IPC
ipcMain.handle('api', async (_e, route, q, body) => {
  try { return { ok: true, data: await backend.api(route, q || {}, body || null) }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});
ipcMain.handle('app:info', () => ({ version: app.getVersion(), packaged: app.isPackaged }));
ipcMain.handle('app:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'ReShade-Ordner wählen (dort wo ReShade.ini liegt)', properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('app:pickPreset', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Preset importieren', properties: ['openFile', 'multiSelections'], filters: [{ name: 'ReShade-Preset', extensions: ['ini', 'txt'] }] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('app:openPath', (_e, p) => (p ? shell.openPath(p) : ''));
ipcMain.handle('app:openUrl', (_e, u) => { if (/^https:\/\//.test(u)) shell.openExternal(u); });
ipcMain.on('app:close-confirmed', () => { forceClose = true; if (win) win.close(); });

// ------------------------------------------------------------ auto update (GitHub releases)
let updater = null; let readyVersion = null;
const send = (state, data = {}) => { if (win && !win.isDestroyed()) win.webContents.send('update', { state, ...data }); };
function setupUpdater() {
  if (!app.isPackaged) return;
  try {
    updater = require('electron-updater').autoUpdater;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.on('checking-for-update', () => send('checking'));
    updater.on('update-available', (i) => send('available', { version: i.version }));
    updater.on('update-not-available', () => send('none'));
    updater.on('download-progress', (p) => send('progress', { percent: p.percent }));
    updater.on('update-downloaded', (i) => { readyVersion = i.version; send('ready', { version: i.version }); });
    updater.on('error', (e) => send('error', { message: String(e?.message || e).slice(0, 300) }));
    setTimeout(() => updater.checkForUpdates().catch(() => { }), 5000);
    setInterval(() => { if (!readyVersion) updater.checkForUpdates().catch(() => { }); }, 30 * 60 * 1000);
  } catch (e) { console.warn('updater', e); }
}
ipcMain.handle('update:check', async () => {
  if (!updater) return { state: 'dev' };
  if (readyVersion) { send('ready', { version: readyVersion }); return { state: 'ready' }; }
  try { await updater.checkForUpdates(); return { state: 'ok' }; }
  catch (e) { return { state: 'error', message: e.message }; }
});
ipcMain.on('update:install', () => { if (updater && readyVersion) { forceClose = true; setImmediate(() => updater.quitAndInstall(true, true)); } });
