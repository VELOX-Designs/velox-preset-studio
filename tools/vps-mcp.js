#!/usr/bin/env node
// VELOX Preset Studio MCP server (stdio). Lets Claude operate the running app.
// Register once:  claude mcp add --scope user velox-preset -- node "<path to this file>"
// Talks to the app's local control API (127.0.0.1, token in %APPDATA%\velox-preset-studio\api.json).
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

const CFG = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'velox-preset-studio', 'api.json');

function api(method, route, body) {
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch { return Promise.reject(new Error('VELOX Preset Studio läuft nicht (api.json fehlt) oder die Fernsteuerung ist aus. Bitte die App starten.')); }
  const data = body ? JSON.stringify(body) : '';
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: cfg.port, path: route, method, headers: { 'x-vps-token': cfg.token, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }, timeout: 120000 }, (res) => {
      let s = ''; res.on('data', (d) => (s += d)); res.on('end', () => { try { const j = JSON.parse(s); res.statusCode >= 400 ? reject(new Error(j.error || s)) : resolve(j); } catch { reject(new Error(s)); } });
    });
    req.on('error', (e) => reject(new Error('VELOX Preset Studio nicht erreichbar: ' + e.message)));
    req.end(data);
  });
}
const obj = (props, req) => ({ type: 'object', properties: props, ...(req ? { required: req } : {}) });
const TOOLS = [
  { name: 'vps_state', description: 'State of VELOX Preset Studio: ReShade folder, preset active in game, game running, open preset (rel, enabled effects, selected), live mode, favorites.', inputSchema: obj({}) },
  { name: 'vps_presets', description: 'List all ReShade presets found in the folder ({rel,name,folder}).', inputSchema: obj({}) },
  { name: 'vps_open', description: 'Open a preset in the editor by name (fuzzy) or rel path.', inputSchema: obj({ name: { type: 'string' }, rel: { type: 'string' } }) },
  { name: 'vps_model', description: 'Full model of the open preset: global keys (Techniques, TechniqueSorting...) and sections [File.fx] with key/value items.', inputSchema: obj({}) },
  { name: 'vps_find_effect', description: 'Search installed shader techniques. Returns keys like "Name@File.fx" plus detected shader pack.', inputSchema: obj({ query: { type: 'string' } }, ['query']) },
  { name: 'vps_effect', description: 'All sliders/options of one shader file (.fx) with type, range, items, default and the value in the open preset, plus its preprocessor options.', inputSchema: obj({ file: { type: 'string' } }, ['file']) },
  { name: 'vps_set', description: 'Set one or more values in the open preset: items [{file:"X.fx", key:"Uniform", value: number | [n,n] | bool | string | null(=default)}]. Writes the file immediately when live mode is on.', inputSchema: obj({ items: { type: 'array', items: obj({ file: { type: 'string' }, key: { type: 'string' }, value: {} }, ['file', 'key']) } }, ['items']) },
  { name: 'vps_enable', description: 'Turn an effect on/off in the open preset. key = "Technique@File.fx" (from vps_find_effect).', inputSchema: obj({ key: { type: 'string' }, on: { type: 'boolean' } }, ['key']) },
  { name: 'vps_save', description: 'Save the open preset (also stores a backup version).', inputSchema: obj({ label: { type: 'string' } }) },
  { name: 'vps_run', description: 'Run any app command: {command, args}. Use command "commands" to list all (open, setParam, setParams, setDefine, enableEffect, order, takeFrom, save, live, undo, redo, newPreset, activate, view, refresh, ...).', inputSchema: obj({ command: { type: 'string' }, args: { type: 'object' } }, ['command']) },
  { name: 'vps_batch', description: 'Run several app commands in order: {steps:[{command,args}]}.', inputSchema: obj({ steps: { type: 'array', items: obj({ command: { type: 'string' }, args: { type: 'object' } }, ['command']) } }, ['steps']) },
  { name: 'vps_catalog', description: 'Raw backend call: textures | shots | versions(rel) | techniques. Returns lists.', inputSchema: obj({ what: { type: 'string', enum: ['textures', 'shots', 'techniques', 'versions'] }, rel: { type: 'string' } }, ['what']) },
  { name: 'vps_screenshot', description: 'Return an in-game ReShade screenshot as image (newest if no name), to judge how a preset looks.', inputSchema: obj({ name: { type: 'string' } }) },
  { name: 'vps_view', description: 'Return a picture of the app window.', inputSchema: obj({}) },
];

const text = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 1) }] });
const image = (file, del) => {
  const b64 = fs.readFileSync(file).toString('base64');
  if (del) { try { fs.unlinkSync(file); } catch { } }
  const ext = path.extname(file).toLowerCase();
  return { content: [{ type: 'image', data: b64, mimeType: ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.bmp' ? 'image/bmp' : 'image/png' }] };
};
const run = (command, args) => api('POST', '/run', { command, args: args || {} });

async function callTool(name, a = {}) {
  switch (name) {
    case 'vps_state': return text(await api('GET', '/state'));
    case 'vps_presets': return text(await run('presets'));
    case 'vps_open': return text(await run('open', a));
    case 'vps_model': return text(await run('model'));
    case 'vps_find_effect': return text(await run('findEffect', a));
    case 'vps_effect': return text(await run('effect', a));
    case 'vps_set': return text(await run('setParams', { items: a.items || [] }));
    case 'vps_enable': return text(await run('enableEffect', { key: a.key, on: a.on !== false }));
    case 'vps_save': return text(await run('save', a));
    case 'vps_run': return text(await run(a.command, a.args));
    case 'vps_batch': return text(await api('POST', '/batch', { steps: a.steps || [] }));
    case 'vps_catalog': return text(await api('GET', '/' + a.what + (a.rel ? '?rel=' + encodeURIComponent(a.rel) : '')));
    case 'vps_screenshot': { const r = await api('POST', '/shotfile', { name: a.name }); return image(r.file, false); }
    case 'vps_view': { const r = await api('POST', '/view', {}); return image(r.file, true); }
    default: throw new Error('unknown tool ' + name);
  }
}

// ---- minimal JSON-RPC over stdio (newline delimited)
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) handle(line); } });
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
async function handle(line) {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (id === undefined) return;
  try {
    if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'velox-preset-studio', version: '1.0.0' } } });
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    if (method === 'tools/call') {
      try { return send({ jsonrpc: '2.0', id, result: await callTool(params.name, params.arguments) }); }
      catch (e) { return send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: String(e.message || e) }] } }); }
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
  } catch (e) { send({ jsonrpc: '2.0', id, error: { code: -32603, message: String(e.message || e) } }); }
}
