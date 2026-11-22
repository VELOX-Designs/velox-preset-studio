// VELOX Preset Studio - backend (main process).
// Only reads/writes plain text files (ReShade presets, ReShade.ini) and reads
// shader/texture files. Nothing is injected into or hooked into any game.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

let ctx = {
  settingsFile: '',   // userData/settings.json
  dataDir: '',        // Documents/VELOX Preset Studio
  nativeImage: null,
};
let settings = { folder: '', recent: [], favorites: [] };

// ------------------------------------------------------------ settings / paths
function init(opts) {
  Object.assign(ctx, opts);
  try { Object.assign(settings, JSON.parse(fs.readFileSync(ctx.settingsFile, 'utf8').replace(/^﻿/, ''))); } catch { }
  if (process.env.VPS_FOLDER) settings.folder = process.env.VPS_FOLDER; // tests: never auto-detect a real folder
  else if (!settings.folder || !fs.existsSync(path.join(settings.folder, 'ReShade.ini'))) {
    const guess = detectFolder();
    if (guess) settings.folder = guess;
  }
  for (const d of ['Versionen', 'Papierkorb', 'Screenshots']) fs.mkdirSync(path.join(ctx.dataDir, d), { recursive: true });
  saveSettings();
  buildIndex();
}
function saveSettings() {
  fs.mkdirSync(path.dirname(ctx.settingsFile), { recursive: true });
  fs.writeFileSync(ctx.settingsFile, JSON.stringify(settings, null, 2));
}
function detectFolder() {
  const cands = [];
  const la = process.env.LOCALAPPDATA || '';
  if (la) cands.push(path.join(la, 'FiveM', 'FiveM.app', 'plugins'));
  for (const c of cands) if (fs.existsSync(path.join(c, 'ReShade.ini'))) return c;
  return '';
}
const base = () => settings.folder;
const iniPath = () => path.join(base(), 'ReShade.ini');
const versionsDir = () => path.join(ctx.dataDir, 'Versionen');
const trashDir = () => path.join(ctx.dataDir, 'Papierkorb');
const shotsDefault = () => path.join(ctx.dataDir, 'Screenshots');

function readText(p) {
  const buf = fs.readFileSync(p);
  let s = buf.toString('utf8');
  if (s.includes('�')) s = buf.toString('latin1');
  return s.replace(/^﻿/, '');
}
function inside(p, root) {
  const a = path.resolve(p).toLowerCase(), b = path.resolve(root).toLowerCase();
  return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
}
function resolveRel(rel) {
  rel = String(rel || '').trim().replace(/^"|"$/g, '');
  return path.isAbsolute(rel) ? path.normalize(rel) : path.normalize(path.join(base(), rel));
}
function safePath(rel) {
  const p = resolveRel(rel);
  if (!base() || !inside(p, base())) throw new Error('Pfad außerhalb des ReShade-Ordners');
  return p;
}
const toRel = (p) => '.\\' + path.relative(base(), p);

// ------------------------------------------------------------ ini helpers
function parsePreset(text) {
  const glob = [], sections = []; let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith(';') || s.startsWith('#')) continue;
    if (s.startsWith('[') && s.endsWith(']')) { cur = { name: s.slice(1, -1).trim(), items: [] }; sections.push(cur); continue; }
    const i = s.indexOf('='); if (i < 0) continue;
    const item = [s.slice(0, i).trim(), s.slice(i + 1).trim()];
    (cur ? cur.items : glob).push(item);
  }
  return { global: glob, sections };
}
function writePreset(model) {
  const out = [];
  for (const [k, v] of model.global || []) out.push(`${k}=${v}`);
  for (const sec of model.sections || []) {
    if (!sec.items || !sec.items.length) continue;
    out.push('', `[${sec.name}]`);
    for (const [k, v] of sec.items) out.push(`${k}=${v}`);
  }
  return out.join('\r\n') + '\r\n';
}
function iniGet(text, section, key) {
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (s.startsWith('[') && s.endsWith(']')) cur = s.slice(1, -1);
    else if (cur === section && s.includes('=')) { const i = s.indexOf('='); if (s.slice(0, i).trim() === key) return s.slice(i + 1).trim(); }
  }
  return null;
}
function iniSet(text, section, key, value) {
  const lines = text.split(/\r?\n/);
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  let cur = null, secIdx = -1, last = -1;
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (s.startsWith('[') && s.endsWith(']')) { cur = s.slice(1, -1); if (cur === section) { secIdx = i; last = i; } continue; }
    if (cur === section) {
      if (s) last = i;
      if (s.includes('=') && s.slice(0, s.indexOf('=')).trim() === key) { lines[i] = `${key}=${value}`; return lines.join('\r\n') + '\r\n'; }
    }
  }
  if (secIdx < 0) lines.push('', `[${section}]`, `${key}=${value}`);
  else lines.splice(last + 1, 0, `${key}=${value}`);
  return lines.join('\r\n') + '\r\n';
}
function readIni() { try { return readText(iniPath()); } catch { return ''; } }
function backupIniOnce() {
  const dst = path.join(base(), 'ReShade.ini.presetstudio-backup');
  if (fs.existsSync(iniPath()) && !fs.existsSync(dst)) fs.copyFileSync(iniPath(), dst);
}
function searchRoots(key, fallback) {
  const val = iniGet(readIni(), 'GENERAL', key) || '';
  let roots = val.split(',').map((x) => x.trim()).filter(Boolean).map((x) => resolveRel(x.replace(/[*\\/]+$/, '')));
  if (!roots.length) roots = [path.join(base(), fallback)];
  return roots.filter((r) => { try { return fs.statSync(r).isDirectory(); } catch { return false; } });
}
const shaderRoots = () => searchRoots('EffectSearchPaths', 'reshade-shaders\\Shaders');
const textureRoots = () => searchRoots('TextureSearchPaths', 'reshade-shaders\\Textures');

function walk(dir, cb, depth = 0, max = 12) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth < max) walk(p, cb, depth + 1, max); }
    else cb(p, e.name, dir);
  }
}

// ------------------------------------------------------------ game process check
let gameCache = { t: 0, v: false };
function gameRunning() {
  return new Promise((resolve) => {
    if (Date.now() - gameCache.t < 2500) return resolve(gameCache.v);
    const names = new Set();
    try { for (const f of fs.readdirSync(base())) if (/\.exe$/i.test(f)) names.add(f.toLowerCase()); } catch { }
    const fivem = /fivem/i.test(base());
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 8 << 20 }, (err, out) => {
      let v = false;
      if (!err) {
        const lo = out.toLowerCase();
        v = (fivem && lo.includes('gtaprocess')) || [...names].some((n) => lo.includes('"' + n + '"'));
      }
      gameCache = { t: Date.now(), v };
      resolve(v);
    });
  });
}

// ------------------------------------------------------------ FX parsing
function stripComments(src) {
  let out = '', i = 0; const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1); i = j + 1;
    } else if (c === '/' && src[i + 1] === '/') {
      const j = src.indexOf('\n', i); i = j < 0 ? n : j;
    } else if (c === '/' && src[i + 1] === '*') {
      const j = src.indexOf('*/', i + 2); out += ' '; i = j < 0 ? n : j + 2;
    } else { out += c; i++; }
  }
  return out;
}
function scanAnnotation(src, i) {
  let j = i + 1; const n = src.length;
  while (j < n) {
    const c = src[j];
    if (c === '"') { j++; while (j < n && src[j] !== '"') j += src[j] === '\\' ? 2 : 1; }
    else if (c === '>') return [src.slice(i + 1, j), j + 1];
    j++;
  }
  return [src.slice(i + 1), n];
}
function splitOutsideQuotes(s, sep) {
  const parts = []; let buf = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && q) { buf += s.slice(i, i + 2); i++; continue; }
    if (c === '"') q = !q;
    if (c === sep && !q) { parts.push(buf); buf = ''; } else buf += c;
  }
  if (buf.trim()) parts.push(buf);
  return parts;
}
const ESC = { 0: '\x00', n: '\n', t: '\t', '"': '"', '\\': '\\', r: '' };
function parseValue(v) {
  v = v.trim();
  if (v.startsWith('"')) {
    const strs = [...v.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join('');
    return strs.replace(/\\(.)/g, (_, c) => (c in ESC ? ESC[c] : c));
  }
  if (v === 'true' || v === 'false') return v === 'true';
  if (/^[-+]?[\d.]+(e[-+]?\d+)?[fF]?$/.test(v)) { const f = parseFloat(v); if (!isNaN(f)) return f; }
  return v;
}
function parseAnnotations(body) {
  const ann = {};
  for (const stmt of splitOutsideQuotes(body, ';')) {
    const i = stmt.indexOf('='); if (i < 0) continue;
    const k = stmt.slice(0, i).trim().split(/\s+/);
    if (!k[0]) continue;
    ann[k[k.length - 1]] = parseValue(stmt.slice(i + 1));
  }
  return ann;
}
const NUM_RE = /[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?/g;
const TYPE_RE = /^(bool|int|uint|float|half|double)(\d)?(?:x\d)?$/;
function parseDefault(v, dim) {
  if (v == null) return Array(dim).fill(0);
  v = v.trim();
  if (v === 'true' || v === 'false') return Array(dim).fill(v === 'true' ? 1 : 0);
  const nums = (v.replace(/[A-Za-z_]\w*/g, ' ').match(NUM_RE) || []).map(Number);
  if (!nums.length) return Array(dim).fill(0);
  let out = nums.length === 1 && dim > 1 ? Array(dim).fill(nums[0]) : nums.slice(0, dim);
  while (out.length < dim) out.push(0);
  return out;
}
const str = (x) => (typeof x === 'string' ? x : '');
const num = (x) => (typeof x === 'number' ? x : null);
function parseUniforms(src) {
  const res = []; const re = /\buniform\s+(?:static\s+)?(\w+)\s+(\w+)\s*/g; let m;
  while ((m = re.exec(src))) {
    const typ = m[1], name = m[2]; let i = re.lastIndex, ann = {};
    if (src[i] === '<') { const [body, j] = scanAnnotation(src, i); ann = parseAnnotations(body); i = j; }
    while (i < src.length && /\s/.test(src[i])) i++;
    let def = null;
    if (src[i] === '=') { const j = src.indexOf(';', i); def = src.slice(i + 1, j < 0 ? src.length : j); }
    const tm = TYPE_RE.exec(typ);
    if (!tm || 'source' in ann || ann.hidden === true || ann.noedit === true) continue;
    const baseT = tm[1], dim = +(tm[2] || 1);
    const items = str(ann.ui_items);
    res.push({
      name, base: baseT, dim,
      ui_type: str(ann.ui_type) || (baseT === 'bool' ? 'checkbox' : 'drag'),
      label: str(ann.ui_label) || name, tooltip: str(ann.ui_tooltip), category: str(ann.ui_category),
      closed: !!ann.ui_category_closed, text: str(ann.ui_text),
      min: num(ann.ui_min), max: num(ann.ui_max), step: num(ann.ui_step),
      items: items ? items.split('\x00').filter((x) => x !== '') : null,
      default: parseDefault(def, dim),
    });
  }
  return res;
}
function parseTechniques(src) {
  const res = []; const re = /\btechnique\s+(\w+)\s*/g; let m;
  while ((m = re.exec(src))) {
    let i = re.lastIndex, ann = {};
    if (src[i] === '<') { const [body, j] = scanAnnotation(src, i); ann = parseAnnotations(body); i = j; }
    if (!src.slice(i, i + 6).trimStart().startsWith('{')) continue;
    if (ann.hidden === true) continue;
    res.push({ name: m[1], label: str(ann.ui_label) || m[1], tooltip: str(ann.ui_tooltip), enabled: ann.enabled === true });
  }
  return res;
}

const FX = { files: {}, techniques: [], ready: false, count: 0, building: null };
function buildIndex() {
  FX.ready = false;
  FX.building = new Promise((resolve) => setImmediate(() => {
    const files = {}, techs = [];
    const roots = base() ? shaderRoots() : [];
    for (const r of roots) walk(r, (p, fn) => { if (/\.fx$/i.test(fn) && !(fn in files)) files[fn] = p; });
    const root0 = roots[0] || '';
    for (const fn of Object.keys(files).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))) {
      let src; try { src = stripComments(readText(files[fn])); } catch { continue; }
      const seen = new Set();
      const folder = path.relative(root0, path.dirname(files[fn]));
      for (const t of parseTechniques(src)) {
        if (seen.has(t.name)) continue; seen.add(t.name);
        techs.push({ ...t, file: fn, folder: folder === '' ? '' : folder });
      }
    }
    Object.assign(FX, { files, techniques: techs, ready: true, count: Object.keys(files).length });
    resolve();
  }));
  return FX.building;
}
function findInclude(name, dir) {
  const cands = [path.join(dir, name), ...shaderRoots().map((r) => path.join(r, name))];
  for (const c of cands) if (fs.existsSync(c)) return c;
  const b = path.basename(name).toLowerCase(); let hit = null;
  for (const r of shaderRoots()) { walk(r, (p, fn) => { if (!hit && fn.toLowerCase() === b) hit = p; }); if (hit) return hit; }
  return null;
}
const effectCache = new Map();
function effectDetails(fn) {
  const p = FX.files[fn];
  if (!p) return { file: fn, missing: true, uniforms: [], defines: [], techniques: [] };
  const key = p + '|' + fs.statSync(p).mtimeMs;
  if (effectCache.has(key)) return effectCache.get(key);
  const uniforms = [], defines = [], seenU = new Set(), seenD = new Set(), visited = new Set();
  const DEF_RE = /#\s*ifndef\s+(\w+)\s*\r?\n\s*#\s*define\s+\1\b[ \t]*([^\r\n]*)/g;
  const INC_RE = /#\s*include\s+"([^"]+)"/g;
  const go = (file, depth, main) => {
    if (depth > 4 || visited.has(file)) return; visited.add(file);
    const raw = readText(file); let m;
    while ((m = DEF_RE.exec(raw))) {
      const v = m[2].replace(/\s*\/\/.*$/, '').trim();
      if (!seenD.has(m[1])) { seenD.add(m[1]); defines.push({ name: m[1], default: v, own: main }); }
    }
    const src = stripComments(raw);
    while ((m = INC_RE.exec(src))) {
      const ip = findInclude(m[1], path.dirname(file));
      if (ip && !/^reshade(ui)?\.fxh$/i.test(path.basename(ip))) go(ip, depth + 1, false);
    }
    for (const u of parseUniforms(src)) if (!seenU.has(u.name)) { seenU.add(u.name); uniforms.push(u); }
  };
  go(p, 0, true);
  const res = { file: fn, uniforms, defines, techniques: parseTechniques(stripComments(readText(p))) };
  effectCache.set(key, res);
  return res;
}

// ------------------------------------------------------------ presets / versions / shots
function listPresets() {
  const res = [];
  if (!base()) return res;
  const skip = new Set(['reshade-shaders']);
  const scan = (dir, depth) => {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 5 && !skip.has(e.name.toLowerCase())) scan(p, depth + 1); continue; }
      if (!/\.ini$/i.test(e.name) || /^reshade\.ini$/i.test(e.name)) continue;
      let head; try { head = readText(p).slice(0, 4000); } catch { continue; }
      if (!/^\s*Techniques\s*=/m.test(head)) continue;
      let folder = path.relative(base(), dir);
      folder = folder.replace(/^Presets(\\|$)/i, '') || (folder ? 'Presets' : '(Hauptordner)');
      res.push({ rel: toRel(p), name: e.name.slice(0, -4), folder, mtime: fs.statSync(p).mtimeMs / 1000 });
    }
  };
  scan(base(), 0);
  res.sort((a, b) => a.folder.toLowerCase().localeCompare(b.folder.toLowerCase()) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return res;
}
const versionDir = (rel) => path.join(versionsDir(), rel.replace(/^\.\\/, '').replace(/[\\/]/g, '__').replace(/[^\w\-. ]/g, '_'));
const stamp = () => { const d = new Date(), z = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`; };
function makeVersion(p, rel, label = '') {
  if (!fs.existsSync(p)) return;
  const d = versionDir(rel); fs.mkdirSync(d, { recursive: true });
  const lab = String(label).replace(/[^\w\- äöüÄÖÜß]/g, '').slice(0, 40);
  fs.copyFileSync(p, path.join(d, stamp() + (lab ? ' ' + lab : '') + '.ini'));
  const auto = fs.readdirSync(d).filter((f) => f.length === 23).sort();
  for (const f of auto.slice(0, -60)) fs.unlinkSync(path.join(d, f));
}
function shotsDir() {
  const v = iniGet(readIni(), 'SCREENSHOT', 'SavePath') || '.\\';
  return resolveRel(v);
}
function listShots() {
  const d = shotsDir(); const res = [];
  let fns = []; try { fns = fs.readdirSync(d); } catch { return res; }
  for (const fn of fns) {
    if (!/\.(png|jpe?g|bmp)$/i.test(fn)) continue;
    const p = path.join(d, fn);
    res.push({ name: fn, mtime: fs.statSync(p).mtimeMs / 1000, preset: fs.existsSync(p.replace(/\.[^.]+$/, '.ini')) });
  }
  return res.sort((a, b) => b.mtime - a.mtime);
}
const cleanName = (s) => String(s || '').replace(/[<>:"/\\|?*]/g, '').trim();

// ------------------------------------------------------------ images (protocol)
const thumbCache = new Map();
function imageResponse(kind, q) {
  let p = null;
  if (kind === 'texture') {
    for (const r of textureRoots()) { const c = path.normalize(path.join(r, q.get('rel') || '')); if (inside(c, r) && fs.existsSync(c)) { p = c; break; } }
  } else if (kind === 'shot') {
    p = path.join(shotsDir(), path.basename(q.get('name') || ''));
  }
  if (!p || !fs.existsSync(p)) return null;
  const ext = path.extname(p).toLowerCase();
  const size = +q.get('size') || 0;
  if (size && (ext === '.png' || ext === '.jpg' || ext === '.jpeg') && ctx.nativeImage) {
    const key = p + '|' + fs.statSync(p).mtimeMs + '|' + size;
    if (!thumbCache.has(key)) {
      const img = ctx.nativeImage.createFromPath(p);
      const s = img.getSize();
      const r = Math.min(1, size / Math.max(s.width, s.height, 1));
      const out = r < 1 ? img.resize({ width: Math.max(1, Math.round(s.width * r)), height: Math.max(1, Math.round(s.height * r)), quality: 'good' }) : img;
      thumbCache.set(key, out.toPNG());
      if (thumbCache.size > 800) thumbCache.delete(thumbCache.keys().next().value);
    }
    return { data: thumbCache.get(key), type: 'image/png' };
  }
  const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.bmp': 'image/bmp' }[ext];
  if (!type) return null;
  return { data: fs.readFileSync(p), type };
}

// ------------------------------------------------------------ preset check (missing shaders / textures)
const IMG_RE = /"([^"]+\.(?:png|jpe?g|bmp|tga|dds|cube))"/gi;
function textureIndex() {
  const rel = new Set(), names = new Set();
  for (const r of textureRoots()) walk(r, (p, fn) => { rel.add(path.relative(r, p).toLowerCase().replace(/\\/g, '/')); names.add(fn.toLowerCase()); });
  return { rel, names };
}
async function checkModel(model) {
  if (!FX.ready) await FX.building;
  const techKeys = new Set(FX.techniques.map((t) => `${t.name}@${t.file}`.toLowerCase()));
  const filesLower = new Map(Object.keys(FX.files).map((f) => [f.toLowerCase(), f]));
  const g = (k) => ((model.global.find((i) => i[0] === k) || [])[1] || '');
  const enabled = g('Techniques').split(',').map((s) => s.trim()).filter(Boolean);
  const missingFiles = new Map(), missingTech = [];
  for (const key of enabled) {
    const file = (key.split('@')[1] || '').trim();
    if (!file) continue;
    if (!filesLower.has(file.toLowerCase())) { if (!missingFiles.has(file)) missingFiles.set(file, []); missingFiles.get(file).push(key.split('@')[0]); }
    else if (!techKeys.has(key.toLowerCase())) missingTech.push(key);
  }
  // pack hint: installed files sharing the missing file's prefix
  const prefix = (f) => f.replace(/\.fx$/i, '').split(/[_\- .]/)[0].toLowerCase();
  const installedPrefix = new Map();
  for (const [fn, p] of Object.entries(FX.files)) {
    const pre = prefix(fn); if (pre.length < 3) continue;
    const folder = path.relative(shaderRoots()[0] || '', path.dirname(p)).split(/[\\/]/)[0];
    if (!installedPrefix.has(pre)) installedPrefix.set(pre, folder || fn.replace(/\.fx$/i, '').split(/[_\- .]/)[0]);
  }
  const tex = textureIndex(); const missingTex = new Set();
  const texts = [g('PreprocessorDefinitions'), ...model.sections.map((s) => (s.items.find((i) => i[0] === 'PreprocessorDefinitions') || [])[1] || '')];
  for (const t of texts) { let m; IMG_RE.lastIndex = 0; while ((m = IMG_RE.exec(t))) { const v = m[1].replace(/\\/g, '/').toLowerCase(); if (!tex.rel.has(v) && !tex.names.has(path.posix.basename(v))) missingTex.add(m[1]); } }
  return {
    enabled: enabled.length,
    missingShaders: [...missingFiles].map(([file, techs]) => ({ file, techniques: techs, hint: installedPrefix.get(prefix(file)) || '' })),
    missingTechniques: missingTech,
    missingTextures: [...missingTex],
    ok: !missingFiles.size && !missingTech.length && !missingTex.size,
  };
}

// ------------------------------------------------------------ API dispatch
async function api(route, q = {}, b = null) {
  switch (route) {
    case 'state': {
      const ini = readIni();
      const sd = shotsDir();
      return {
        folder: base(), folderOk: !!base() && fs.existsSync(iniPath()), recent: settings.recent,
        active: iniGet(ini, 'GENERAL', 'PresetPath') || '',
        autosave: iniGet(ini, 'OVERLAY', 'AutoSavePreset'),
        reloadKey: iniGet(ini, 'INPUT', 'KeyReload'), overlayKey: iniGet(ini, 'INPUT', 'KeyOverlay'),
        shotsDir: sd, shotsSetup: path.resolve(sd).toLowerCase() === path.resolve(shotsDefault()).toLowerCase(),
        savePresetFile: iniGet(ini, 'SCREENSHOT', 'SavePresetFile'),
        game: base() ? await gameRunning() : false, indexReady: FX.ready, fxCount: FX.count,
        favorites: settings.favorites, dataDir: ctx.dataDir,
      };
    }
    case 'presets': return listPresets();
    case 'preset': { const p = safePath(q.rel); return { rel: q.rel, mtime: fs.statSync(p).mtimeMs / 1000, model: parsePreset(readText(p)) }; }
    case 'mtime': { const p = safePath(q.rel); return { mtime: fs.existsSync(p) ? fs.statSync(p).mtimeMs / 1000 : 0 }; }
    case 'techniques': if (!FX.ready) await FX.building; return { ready: true, techniques: FX.techniques };
    case 'effect': if (!FX.ready) await FX.building; return effectDetails(q.file);
    case 'textures': {
      const res = [];
      for (const r of textureRoots()) walk(r, (p, fn) => {
        const ext = path.extname(fn).toLowerCase();
        if (['.png', '.jpg', '.jpeg', '.bmp', '.tga', '.dds', '.cube'].includes(ext)) res.push({ name: fn, rel: path.relative(r, p), ext });
      });
      return res.sort((a, b) => a.rel.toLowerCase().localeCompare(b.rel.toLowerCase()));
    }
    case 'versions': { const d = versionDir(q.rel); return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.ini')).sort().reverse().map((name) => ({ name })) : []; }
    case 'version': return { model: parsePreset(readText(path.join(versionDir(q.rel), path.basename(q.name)))) };
    case 'shots': return listShots();
    case 'shotpreset': return { model: parsePreset(readText(path.join(shotsDir(), path.basename(q.name)).replace(/\.[^.]+$/, '.ini'))) };

    case 'save': {
      const p = safePath(b.rel);
      if (b.version || !b.live) makeVersion(p, b.rel, b.label || '');
      else if (b.firstLive) makeVersion(p, b.rel, 'vor Live');
      fs.writeFileSync(p + '.tmp', writePreset(b.model), 'utf8');
      fs.renameSync(p + '.tmp', p);
      return { ok: true, mtime: fs.statSync(p).mtimeMs / 1000 };
    }
    case 'new': {
      const name = cleanName(b.name); const folder = cleanName(b.folder) || 'Eigene';
      if (!name) throw new Error('Name fehlt');
      const d = path.join(base(), 'Presets', folder);
      if (!inside(d, base())) throw new Error('Ungültiger Ordner');
      fs.mkdirSync(d, { recursive: true });
      const p = path.join(d, name + '.ini');
      if (fs.existsSync(p)) throw new Error('Preset gibt es schon');
      fs.writeFileSync(p, writePreset(b.model || { global: [['Techniques', ''], ['TechniqueSorting', '']], sections: [] }), 'utf8');
      return { ok: true, rel: toRel(p) };
    }
    case 'rename': {
      const p = safePath(b.rel); const np = path.join(path.dirname(p), cleanName(b.name) + '.ini');
      if (fs.existsSync(np)) throw new Error('Name gibt es schon');
      fs.renameSync(p, np); return { ok: true, rel: toRel(np) };
    }
    case 'trash': {
      const p = safePath(b.rel);
      const dst = path.join(trashDir(), stamp() + ' ' + path.basename(p));
      fs.copyFileSync(p, dst); fs.unlinkSync(p); return { ok: true };
    }
    case 'activate': {
      if (await gameRunning()) throw new Error('Spiel läuft – ReShade überschreibt ReShade.ini beim Beenden. Erst das Spiel schließen.');
      safePath(b.rel); backupIniOnce();
      fs.writeFileSync(iniPath(), iniSet(readIni(), 'GENERAL', 'PresetPath', b.rel), 'utf8');
      return { ok: true };
    }
    case 'inisettings': {
      if (await gameRunning()) throw new Error('Spiel läuft – erst schließen, sonst überschreibt ReShade die Änderung.');
      backupIniOnce();
      let t = readIni();
      for (let [sec, key, val] of b.set) {
        if (!['INPUT', 'SCREENSHOT', 'OVERLAY'].includes(sec) || !/^\w+$/.test(key)) throw new Error('Nicht erlaubt');
        if (val === '__SHOTS__') { fs.mkdirSync(shotsDefault(), { recursive: true }); val = shotsDefault(); }
        t = iniSet(t, sec, key, val);
      }
      fs.writeFileSync(iniPath(), t, 'utf8');
      return { ok: true };
    }
    case 'setfolder': {
      const f = path.normalize(b.folder);
      if (!fs.existsSync(path.join(f, 'ReShade.ini'))) throw new Error('In diesem Ordner liegt keine ReShade.ini');
      settings.folder = f;
      settings.recent = [f, ...settings.recent.filter((x) => x.toLowerCase() !== f.toLowerCase())].slice(0, 8);
      saveSettings(); effectCache.clear(); await buildIndex();
      return { ok: true };
    }
    case 'favorite': {
      const s = new Set(settings.favorites);
      b.on ? s.add(b.key) : s.delete(b.key);
      settings.favorites = [...s]; saveSettings(); return { ok: true, favorites: settings.favorites };
    }
    case 'check': {
      if (b && b.model) return checkModel(b.model);
      return checkModel(parsePreset(readText(safePath(q.rel))));
    }
    case 'readfile': { // external preset file chosen by the user in the import dialog
      const f = String(b.file || '');
      if (!/\.(ini|txt)$/i.test(f) || !fs.existsSync(f) || fs.statSync(f).size > 4e6) throw new Error('Keine gültige Preset-Datei');
      const model = parsePreset(readText(f));
      if (!model.global.some((i) => i[0] === 'Techniques')) throw new Error('Das ist kein ReShade-Preset (keine Techniques-Zeile)');
      return { name: path.basename(f).replace(/\.(ini|txt)$/i, ''), model, check: await checkModel(model) };
    }
    case 'reindex': effectCache.clear(); await buildIndex(); return { ok: true, count: FX.count };
    case 'folderpath': {
      return { path: { presets: path.join(base(), 'Presets'), shots: shotsDir(), versions: versionsDir(), trash: trashDir(), reshade: base() }[b.what] || '' };
    }
  }
  throw new Error('Unbekannte Aktion: ' + route);
}

function setSetting(k, v) { settings[k] = v; saveSettings(); }

module.exports = { init, api, imageResponse, settings: () => settings, setSetting };
