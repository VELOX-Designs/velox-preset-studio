// VELOX Mod-Studio backend: works only inside a user-chosen workspace folder.
// Mods from anywhere (incl. the live FiveM mods folder) are COPIED in; originals are only read.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const rpf = require('./rpf');
const zip = require('./zip');

let ctx = { settings: null, save: null, progress: () => { }, nativeImage: null };
const modviz = require('./modviz');
function init(o) { Object.assign(ctx, o); modviz.init({ modPath: (id) => modPath(id), modInfo: (f) => modInfo(f), loadProject: () => loadProject(), categoryOf: (t, s2) => categoryOf(t, s2), get nativeImage() { return ctx.nativeImage; } }); }
const S = () => ctx.settings();
const ws = () => S().msWorkspace || '';
const modsDir = () => path.join(ws(), 'Mods');
const exportDir = () => path.join(ws(), 'Export');
const packsDir = () => path.join(ws(), 'Packs');
const ownDir = () => path.join(ws(), 'Eigene Dateien');
const projFile = () => path.join(ws(), 'velox-modstudio.json');
const cacheFile = () => path.join(ws(), '.velox-cache.json');
const liveModsDir = () => path.join(process.env.LOCALAPPDATA || '', 'FiveM', 'FiveM.app', 'mods');
// A mod id is either a file name in Mods/ (a copy) or a path relative to the workspace (used in place, read only).
const isInPlace = (id) => /[\\/]/.test(String(id || ''));
const modName = (id) => path.basename(String(id || ''));
const relKey = (id) => String(id || '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
function modPath(id) {
  const p = isInPlace(id) ? path.join(ws(), String(id)) : path.join(modsDir(), path.basename(String(id)));
  if (!inside(p, ws())) throw new Error('Pfad außerhalb des Arbeitsordners');
  return p;
}
const OWN_DIRS = ['mods', 'export', 'packs', 'eigene dateien'];

function needWs() { if (!ws() || !fs.existsSync(ws())) throw new Error('Kein Arbeitsordner gewählt'); }
function inside(p, root) { const a = path.resolve(p).toLowerCase(), b = path.resolve(root).toLowerCase(); return a === b || a.startsWith(b + path.sep); }
const clean = (s) => String(s || '').replace(/[<>:"/\\|?*]/g, '').trim();

// ------------------------------------------------------------ project
function loadProject() {
  let p = { name: path.basename(ws()), mods: [], overrides: [], pack: { name: path.basename(ws()), version: '1.0', author: '', description: '' } };
  try { p = { ...p, ...JSON.parse(fs.readFileSync(projFile(), 'utf8').replace(/^\uFEFF/, '')) }; } catch { }
  // sync with files on disk
  const files = fs.existsSync(modsDir()) ? fs.readdirSync(modsDir()).filter((f) => /\.rpf$/i.test(f)) : [];
  p.mods = p.mods.filter((m) => (isInPlace(m.file) ? fs.existsSync(path.join(ws(), m.file)) : files.includes(m.file)));
  for (const f of files) if (!p.mods.some((m) => m.file === f)) p.mods.push({ file: f, enabled: true, excluded: [] });
  return p;
}
function saveProject(p) { fs.writeFileSync(projFile(), JSON.stringify(p, null, 2)); return p; }

function openWorkspace(dir, create) {
  dir = path.normalize(dir);
  if (create) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(dir)) throw new Error('Ordner gibt es nicht');
  if (inside(dir, liveModsDir()) || inside(liveModsDir(), dir)) throw new Error('Der FiveM-mods-Ordner darf kein Arbeitsordner sein – bitte einen eigenen Ordner wählen.');
  for (const d of ['Mods', 'Export', 'Packs', 'Eigene Dateien']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  const st = S(); st.msWorkspace = dir;
  st.msRecent = [dir, ...(st.msRecent || []).filter((x) => x.toLowerCase() !== dir.toLowerCase())].slice(0, 8);
  ctx.save();
  if (!fs.existsSync(projFile())) saveProject(loadProject());
  return { ok: true, dir };
}

// ------------------------------------------------------------ assembly.xml (OIV) parsing
function decode(s) { return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); }
function attr(a, n) { const m = new RegExp('\\b' + n + '\\s*=\\s*"([^"]*)"', 'i').exec(a); return m ? decode(m[1]) : null; }
const normT = (t) => decode(String(t || '')).trim().replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
function parseAssembly(xml) {
  const meta = {};
  const mm = /<metadata>([\s\S]*?)<\/metadata>/i.exec(xml);
  if (mm) {
    const g = (t) => { const m = new RegExp('<' + t + '>([\\s\\S]*?)</' + t + '>', 'i').exec(mm[1]); return m ? decode(m[1].replace(/<!\[CDATA\[|\]\]>/g, '')).trim() : ''; };
    meta.name = g('name'); meta.author = g('displayName'); meta.description = g('description').slice(0, 2000);
    const v = /<version>([\s\S]*?)<\/version>/i.exec(mm[1]);
    if (v) meta.version = [/<major>(\d+)/.exec(v[1]), /<minor>(\d+)/.exec(v[1])].map((x) => (x ? x[1] : '0')).join('.');
  }
  const cm = /<content>([\s\S]*)<\/content>/i.exec(xml);
  const content = cm ? cm[1] : '';
  const contentStart = cm ? cm.index + xml.slice(cm.index).indexOf('>') + 1 : 0;
  const ops = []; const stack = [];
  const re = /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<(\/?)(archive|add|replace|delete|xml|text|defaultDlcText)\b([^>]*?)(\/?)>/gi;
  let m;
  while ((m = re.exec(content))) {
    if (!m[2]) continue;
    const close = m[1] === '/', tag = m[2].toLowerCase(), at = m[3], selfClose = m[4] === '/';
    if (tag === 'archive') {
      if (close) stack.pop();
      else if (!selfClose) stack.push({ path: attr(at, 'path') || '', create: attr(at, 'createIfNotExist') || 'False', type: attr(at, 'type') || 'RPF7' });
      continue;
    }
    if (close || selfClose) continue;
    const endRe = new RegExp('</' + m[2] + '\\s*>', 'ig'); endRe.lastIndex = re.lastIndex;
    const em = endRe.exec(content);
    if (!em) continue;
    const inner = content.slice(re.lastIndex, em.index);
    const raw = content.slice(m.index, em.index + em[0].length);
    const chain = stack.map((s) => ({ ...s }));
    const archive = chain.map((c) => normT(c.path)).join(' › ');
    if (tag === 'add' || tag === 'replace' || tag === 'delete') {
      ops.push({ kind: tag, source: attr(at, 'source') || '', target: normT(inner), targetRaw: decode(inner).trim(), archive, chain, raw, start: m.index, end: em.index + em[0].length });
    } else {
      ops.push({ kind: tag, source: '', target: normT(attr(at, 'path') || ''), targetRaw: attr(at, 'path') || '', archive, chain, raw, start: m.index, end: em.index + em[0].length });
    }
    re.lastIndex = em.index + em[0].length;
  }
  return { meta, ops, content, contentStart };
}

// ------------------------------------------------------------ mod info (cached)
let cache = null;
function loadCache() { if (!cache) { try { cache = JSON.parse(fs.readFileSync(cacheFile(), 'utf8')); } catch { cache = {}; } } return cache; }
function saveCache() { try { fs.writeFileSync(cacheFile(), JSON.stringify(cache)); } catch { } }
function modInfo(file) {
  const p = modPath(file);
  const st = fs.statSync(p);
  const key = file + '|' + st.size + '|' + st.mtimeMs;
  const c = loadCache();
  if (c[file] && c[file].key === key) return c[file].info;
  const info = { file, name: modName(file), inPlace: isInPlace(file), size: st.size, enc: 'unknown', readable: false, oiv: false, entries: 0, files: 0, meta: {}, ops: [] };
  try {
    const l = rpf.list(p);
    info.enc = l.enc; info.readable = l.readable;
    if (l.readable) {
      info.entries = l.entries.length; info.files = l.entries.filter((e) => e.type !== 'dir').length;
      const asm = l.entries.find((e) => e.path.toLowerCase() === 'assembly.xml');
      if (asm) {
        const a = parseAssembly(rpf.extract(p, asm).toString('utf8').replace(/^\uFEFF/, ''));
        info.oiv = true; info.meta = a.meta;
        info.ops = a.ops.map((o) => ({ kind: o.kind, source: o.source, target: o.target, targetRaw: o.targetRaw, archive: o.archive }));
      }
    }
  } catch (e) { info.error = e.message; }
  c[file] = { key, info }; saveCache();
  return info;
}
const opKey = (o) => o.archive + ' » ' + o.target;

// ------------------------------------------------------------ conflicts
function conflicts(p) {
  p = p || loadProject();
  const map = new Map();
  p.mods.forEach((m, order) => {
    if (!m.enabled) return;
    const info = modInfo(m.file);
    for (const o of info.ops) {
      if (o.kind !== 'add' && o.kind !== 'replace') continue;
      const k = opKey(o);
      if ((m.excluded || []).includes(k)) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push({ mod: m.file, order, kind: o.kind });
    }
  });
  for (const ov of p.overrides || []) {
    const k = ov.archive + ' » ' + normT(ov.target);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push({ mod: 'Eigene Datei: ' + path.basename(ov.file), order: 9999, own: true });
  }
  const out = [];
  for (const [k, list] of map) if (list.length > 1) { const [archive, target] = k.split(' » '); out.push({ key: k, archive, target, mods: list, winner: list[list.length - 1].mod }); }
  return out.sort((a, b) => a.target.localeCompare(b.target));
}

// ------------------------------------------------------------ copy helpers with progress
function copyWithProgress(src, dst, label) {
  return new Promise((resolve, reject) => {
    const total = fs.statSync(src).size; let done = 0, last = 0;
    const rs = fs.createReadStream(src, { highWaterMark: 4 << 20 }), wsS = fs.createWriteStream(dst + '.part');
    rs.on('data', (c) => { done += c.length; if (Date.now() - last > 250) { last = Date.now(); ctx.progress({ label, done, total }); } });
    rs.on('error', reject); wsS.on('error', reject);
    wsS.on('finish', () => { fs.renameSync(dst + '.part', dst); ctx.progress({ label, done: total, total }); resolve(); });
    rs.pipe(wsS);
  });
}
function freeName(dir, name) {
  let n = name, i = 2; const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
  while (fs.existsSync(path.join(dir, n))) n = `${base} (${i++})${ext}`;
  return n;
}

// ------------------------------------------------------------ import
async function importFiles(files) {
  needWs();
  const res = [];
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (inside(f, modsDir())) continue;
    let isDir = false; try { isDir = fs.statSync(f).isDirectory(); } catch { res.push({ file: null, from: f, error: 'Nicht gefunden' }); continue; }
    if (isDir) { res.push(...(await importFolder(f))); continue; }
    if (ext === '.rpf' && inside(f, ws())) { res.push(...useInPlace([path.relative(ws(), f)])); continue; }
    if (ext === '.rpf') {
      const name = freeName(modsDir(), path.basename(f));
      await copyWithProgress(f, path.join(modsDir(), name), 'Kopiere ' + path.basename(f));
      res.push({ file: name, from: f });
    } else if (ext === '.oiv' || ext === '.zip') {
      // OIV package (zip with assembly.xml + content/) -> FiveM-style RPF with the same layout
      const entries = zip.readZip(f).filter((e) => !e.dir);
      const asm = entries.find((e) => /(^|\/)assembly\.xml$/i.test(e.name));
      if (!asm) { res.push({ file: null, from: f, error: 'Kein OIV-Paket (assembly.xml fehlt)' }); continue; }
      const root = asm.name.slice(0, asm.name.length - 'assembly.xml'.length);
      const list = entries.filter((e) => e.name.startsWith(root) && (e.name === asm.name || /^content\//i.test(e.name.slice(root.length))))
        .map((e) => ({ path: e.name.slice(root.length), data: e.read() }));
      const name = freeName(modsDir(), path.basename(f).replace(/\.(oiv|zip)$/i, '') + '.rpf');
      ctx.progress({ label: 'Wandle ' + path.basename(f) + ' um', done: 0, total: 1 });
      rpf.build(path.join(modsDir(), name), list);
      res.push({ file: name, from: f, converted: true });
    } else res.push({ file: null, from: f, error: 'Nur .rpf, .oiv oder .zip' });
  }
  const p = loadProject(); saveProject(p);
  return res;
}
function liveMods() {
  const d = liveModsDir();
  if (!fs.existsSync(d)) return { dir: d, mods: [] };
  return {
    dir: d,
    mods: fs.readdirSync(d).filter((f) => /\.rpf$/i.test(f)).map((f) => {
      const p = path.join(d, f); const st = fs.statSync(p);
      let enc = 'unknown';
      try { const fd = fs.openSync(p, 'r'); const b = Buffer.alloc(16); fs.readSync(fd, b, 0, 16, 0); fs.closeSync(fd); enc = rpf.encName(b.readUInt32LE(12)); } catch { }
      return { file: f, size: st.size, enc, inWorkspace: ws() && fs.existsSync(path.join(modsDir(), f)) };
    }),
  };
}

// ------------------------------------------------------------ folders: browse, scan, in-place use
const isFolderMod = (dir) => { try { return fs.existsSync(path.join(dir, 'assembly.xml')) && fs.statSync(path.join(dir, 'content')).isDirectory(); } catch { return false; } };
function kindOf(full, isDir) {
  if (isDir) return isFolderMod(full) ? 'foldermod' : 'dir';
  const e = path.extname(full).toLowerCase();
  return { '.rpf': 'rpf', '.oiv': 'oiv', '.ytd': 'ytd', '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.dds': 'image', '.xml': 'text', '.meta': 'text', '.dat': 'text', '.ini': 'text', '.txt': 'text', '.md': 'text', '.zip': 'zip' }[e] || 'other';
}
function browse(rel) {
  needWs();
  const dir = path.join(ws(), rel || '');
  if (!inside(dir, ws())) throw new Error('Nicht erlaubt');
  const p = loadProject();
  const inProj = new Set(p.mods.map((m) => (isInPlace(m.file) ? relKey(m.file) : 'mods/' + m.file.toLowerCase())));
  const items = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !(!rel && /^(velox-modstudio\.json|\.velox-cache\.json)$/i.test(e.name))).map((e) => {
    const full = path.join(dir, e.name); const r = path.relative(ws(), full).replace(/\\/g, '/');
    let size = 0; try { if (!e.isDirectory()) size = fs.statSync(full).size; } catch { }
    return { name: e.name, rel: r, dir: e.isDirectory(), size, kind: kindOf(full, e.isDirectory()), inProject: inProj.has(r.toLowerCase()), own: !rel && OWN_DIRS.includes(e.name.toLowerCase()) };
  }).sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { dir: (rel || '').replace(/\\/g, '/'), items };
}
function scanWorkspace() {
  needWs();
  const p = loadProject();
  const inProj = new Set(p.mods.map((m) => (isInPlace(m.file) ? relKey(m.file) : '')));
  const hidden = new Set((p.hidden || []).map((x) => x.toLowerCase()));
  const found = [];
  const walkDir = (dir, depth) => {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const full = path.join(dir, e.name); const r = path.relative(ws(), full).replace(/\\/g, '/');
      if (e.isDirectory()) {
        if (depth === 0 && OWN_DIRS.includes(e.name.toLowerCase())) continue;
        if (isFolderMod(full)) { found.push({ rel: r, kind: 'foldermod' }); continue; }
        if (depth < 10) walkDir(full, depth + 1);
      } else if (/\.(rpf|oiv)$/i.test(e.name)) found.push({ rel: r, kind: e.name.toLowerCase().endsWith('.rpf') ? 'rpf' : 'oiv', size: fs.statSync(full).size });
    }
  };
  walkDir(ws(), 0);
  // OIV files / folders that were already converted into a mod in Mods/ (same name) are not offered again
  const converted = new Set((fs.existsSync(modsDir()) ? fs.readdirSync(modsDir()) : []).map((f) => f.replace(/\.rpf$/i, '').toLowerCase()));
  const baseNoExt = (r) => path.basename(r).replace(/\.(oiv|zip)$/i, '').toLowerCase();
  return found.filter((f) => !inProj.has(f.rel.toLowerCase()) && !hidden.has(f.rel.toLowerCase()) && !(f.kind !== 'rpf' && converted.has(baseNoExt(f.rel))));
}
function useInPlace(rels) {
  needWs();
  const p = loadProject(); const res = [];
  for (const r0 of rels) {
    let r = String(r0).replace(/\\/g, '/').replace(/^\.\//, '');
    const full = path.join(ws(), r);
    if (!r.includes('/')) r = './' + r; // files directly in the workspace root still count as in-place
    if (!inside(full, ws()) || !fs.existsSync(full)) { res.push({ file: null, from: r, error: 'Nicht gefunden' }); continue; }
    if (inside(full, modsDir())) continue;
    if (!/\.rpf$/i.test(r)) { res.push({ file: null, from: r, error: 'Nur .rpf kann direkt benutzt werden' }); continue; }
    if (!p.mods.some((m) => relKey(m.file) === relKey(r))) p.mods.push({ file: r, enabled: true, excluded: [] });
    res.push({ file: r, from: full, inPlace: true });
  }
  saveProject(p);
  return res;
}
function folderModToRpf(dir) {
  const list = [];
  const walkDir = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const full = path.join(d, e.name); if (e.isDirectory()) walkDir(full); else list.push({ path: path.relative(dir, full).replace(/\\/g, '/'), file: full }); } };
  walkDir(dir);
  const files = list.filter((f) => f.path.toLowerCase() === 'assembly.xml' || /^content\//i.test(f.path));
  const name = freeName(modsDir(), clean(path.basename(dir)) + '.rpf');
  ctx.progress({ label: 'Packe Ordner ' + path.basename(dir), done: 0, total: 1 });
  rpf.build(path.join(modsDir(), name), files);
  ctx.progress({ label: 'Packe Ordner ' + path.basename(dir), done: 1, total: 1 });
  return name;
}
async function importFolder(dir) {
  // unpacked OIV folder -> one mod; otherwise collect every .rpf/.oiv inside
  if (isFolderMod(dir)) return [{ file: folderModToRpf(dir), from: dir, converted: true }];
  const res = []; const inWs = inside(dir, ws());
  const walkDir = async (d, depth) => {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (inside(full, modsDir()) || inside(full, packsDir()) || inside(full, exportDir()) || inside(full, ownDir())) continue;
        if (isFolderMod(full)) res.push({ file: folderModToRpf(full), from: full, converted: true });
        else if (depth < 10) await walkDir(full, depth + 1);
      } else if (/\.rpf$/i.test(e.name)) {
        if (inWs) res.push(...useInPlace([path.relative(ws(), full)]));
        else { const name = freeName(modsDir(), e.name); await copyWithProgress(full, path.join(modsDir(), name), 'Kopiere ' + e.name); res.push({ file: name, from: full }); }
      } else if (/\.oiv$/i.test(e.name)) res.push(...(await importFiles([full])));
    }
  };
  await walkDir(dir, 0);
  if (!res.length) res.push({ file: null, from: dir, error: 'Keine Mods (.rpf / .oiv / OIV-Ordner) im Ordner gefunden' });
  return res;
}

// ------------------------------------------------------------ tree / export
function tree(file) {
  needWs();
  const p = modPath(file);
  const l = rpf.list(p);
  return { enc: l.enc, readable: l.readable, entries: l.entries.map((e) => ({ path: e.path, type: e.type, size: e.size, nested: e.nested })) };
}
function exportEntries(file, paths, target) {
  needWs();
  const p = modPath(file);
  const l = rpf.list(p);
  const want = paths.map((x) => x.toLowerCase());
  const sel = l.entries.filter((e) => e.type !== 'dir' && want.some((w) => e.path.toLowerCase() === w || e.path.toLowerCase().startsWith(w + '/')))
    .filter((e) => !(e.nested && want.some((w) => e.path.toLowerCase().startsWith(w + '/') && e.path.toLowerCase() !== w))); // skip nested containers when exporting their contents
  const outRoot = target || path.join(exportDir(), path.basename(file, '.rpf'));
  let n = 0;
  for (const e of sel) {
    // entries inside nested RPFs are read from the outer file at their absolute offset
    const dst = zip.safeJoin(outRoot, e.path.replace(/\.rpf\//gi, '.rpf_/'));
    if (!dst) continue;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, rpf.extract(p, l.entries.find((x) => x.path === e.path)));
    n++;
    if (n % 25 === 0) ctx.progress({ label: 'Exportiere', done: n, total: sel.length });
  }
  ctx.progress({ label: 'Exportiere', done: sel.length, total: sel.length });
  return { ok: true, files: n, dir: outRoot };
}

// ------------------------------------------------------------ own files (overrides)
function addOverride(o) {
  needWs();
  if (!fs.existsSync(o.file)) throw new Error('Datei nicht gefunden');
  const name = freeName(ownDir(), path.basename(o.file));
  fs.copyFileSync(o.file, path.join(ownDir(), name)); // copy into workspace
  const p = loadProject();
  p.overrides = (p.overrides || []).filter((x) => !(x.archive === o.archive && normT(x.target) === normT(o.target)));
  p.overrides.push({ file: name, archive: o.archive, chain: o.chain || [], target: o.targetRaw || o.target });
  saveProject(p);
  return p.overrides;
}
function chainFor(modFile, archive) {
  const p = modPath(modFile);
  const l = rpf.list(p);
  const asm = l.entries.find((e) => e.path.toLowerCase() === 'assembly.xml');
  const a = parseAssembly(rpf.extract(p, asm).toString('utf8').replace(/^\uFEFF/, ''));
  const op = a.ops.find((o) => o.archive === archive);
  return op ? op.chain : [];
}

// ------------------------------------------------------------ pack building
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function wrapChain(chain, inner) {
  let x = inner;
  for (let i = chain.length - 1; i >= 0; i--) { const c = chain[i]; x = `<archive path="${esc(c.path)}" createIfNotExist="${esc(c.create || 'False')}" type="${esc(c.type || 'RPF7')}">\n${x}\n</archive>`; }
  return x;
}
const isAR = (o) => o.kind === 'add' || o.kind === 'replace';
// Plans a pack: which files from which mod, the merged assembly.xml. Used by build and by validation.
function planPack(opt = {}) {
  needWs();
  const p = loadProject();
  const packName = clean(opt.name || p.pack.name || 'Mein Pack') || 'Mein Pack';
  const sel = opt.selection || null; // fusion: { mods:[files], choose:{key: file|''}, extra:{xkey: bool}, own: bool }
  const dropLosers = opt.dropLosers !== false;
  const losers = new Map();
  if (!sel) for (const c of conflicts(p)) losers.set(c.key, c.winner);
  const list = sel ? sel.mods.map((f) => p.mods.find((m) => m.file === f) || { file: f, excluded: [] }) : p.mods.filter((m) => m.enabled);
  const blocked = list.filter((m) => { const i = modInfo(m.file); return !i.readable || !i.oiv; });
  const usable = list.filter((m) => !blocked.includes(m));
  const useOwn = sel ? sel.own !== false : true;
  const overrides = useOwn ? (p.overrides || []) : [];
  if (!usable.length && !overrides.length) throw new Error('Keine verwendbaren Mods im Pack (geschützte oder unbekannte Mods können nicht zusammengeführt werden)');
  const files = []; const blocks = []; const kept = []; let idx = 0; let skipped = 0;
  for (const m of usable) {
    idx++;
    const prefix = `m${String(idx).padStart(2, '0')}_${clean(path.basename(modName(m.file), '.rpf')).replace(/\s+/g, '_').slice(0, 40)}`;
    const src = modPath(m.file);
    const l = rpf.list(src);
    const asmE = l.entries.find((e) => e.path.toLowerCase() === 'assembly.xml');
    const a = parseAssembly(rpf.extract(src, asmE).toString('utf8').replace(/^\uFEFF/, ''));
    let xi = -1;
    const drop = a.ops.filter((o) => {
      if (!isAR(o)) { xi++; return !!(sel && sel.extra && sel.extra[`x:${m.file}:${xi}`] === false); }
      const k = opKey(o);
      if (sel) return Object.prototype.hasOwnProperty.call(sel.choose || {}, k) && sel.choose[k] !== m.file;
      return (m.excluded || []).includes(k) || (dropLosers && losers.has(k) && losers.get(k) !== m.file);
    });
    skipped += drop.length;
    let content = a.content;
    for (const o of [...drop].sort((x, y) => y.start - x.start)) content = content.slice(0, o.start) + content.slice(o.end);
    content = content.replace(/(<(?:add|replace)\b[^>]*\bsource\s*=\s*")([^"]*)(")/gi, (_, a1, s2, a3) => a1 + esc(prefix + '\\' + decode(s2).replace(/\//g, '\\')) + a3);
    blocks.push(`<!-- ${esc(m.file)} -->\n` + content.trim());
    const keptOps = a.ops.filter((o) => !drop.includes(o) && o.source);
    const used = new Set(keptOps.map((o) => decode(o.source).replace(/\\/g, '/').toLowerCase()));
    const contentFiles = l.entries.filter((e) => e.type !== 'dir' && /^content\//i.test(e.path) && !l.entries.some((x) => x.nested && e.path.startsWith(x.path + '/')));
    const byRel = new Map(contentFiles.map((e) => [e.path.slice(8).toLowerCase(), e]));
    for (const o of keptOps) {
      const rel = decode(o.source).replace(/\\/g, '/').toLowerCase();
      kept.push({ mod: m.file, src, source: o.source, target: o.targetRaw || o.target, entry: byRel.get(rel) || null });
    }
    for (const e of contentFiles) {
      const rel = e.path.slice(8);
      if (!used.has(rel.toLowerCase())) continue;
      files.push({ path: `content/${prefix}/${rel}`, lazy: { src, entry: e }, size: e.csize || e.size || 0 });
    }
  }
  const ownBlocks = [];
  overrides.forEach((o, i) => {
    const srcName = `velox_eigene/${String(i + 1).padStart(2, '0')}_${o.file}`;
    const fp = path.join(ownDir(), o.file);
    files.push({ path: 'content/' + srcName, file: fp, size: fs.existsSync(fp) ? fs.statSync(fp).size : 0 });
    kept.push({ mod: 'Eigene Dateien', own: fp, source: srcName, target: o.target });
    ownBlocks.push(wrapChain(o.chain || [], `<add source="${esc(srcName.replace(/\//g, '\\'))}">${esc(String(o.target).replace(/\//g, '\\'))}</add>`));
  });
  const meta = { ...p.pack, ...opt };
  const desc = `Erstellt mit VELOX Mod-Studio.\nEnthält:\n${usable.map((m) => '- ' + m.file).join('\n')}${overrides.length ? `\n- ${overrides.length} eigene Dateien` : ''}${meta.description ? '\n\n' + meta.description : ''}`;
  const [maj, min] = String(meta.version || '1.0').split('.');
  const asmXml = `<?xml version="1.0" encoding="UTF-8"?>
<package version="2.2" id="{${cryptoId()}}" target="Five">
<metadata>
<name>${esc(packName)}</name>
<version><major>${+maj || 1}</major><minor>${+min || 0}</minor></version>
<author><displayName>${esc(meta.author || 'VELOX Mod-Studio')}</displayName></author>
<description><![CDATA[${desc.replace(/]]>/g, '')}]]></description>
</metadata>
<content>
${blocks.join('\n')}
${ownBlocks.join('\n')}
</content>
</package>
`;
  files.unshift({ path: 'assembly.xml', data: Buffer.from(asmXml, 'utf8'), size: asmXml.length });
  return { p, packName, files, kept, asmXml, usable, blocked, skipped, meta };
}

// ---- simple XML well-formedness check (tag balance)
function xmlProblem(text) {
  const t = text.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[^>]*>/gi, '');
  const stack = []; const re = /<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g; let m;
  while ((m = re.exec(t))) {
    if (m[4] === '/') continue;
    if (m[1] === '/') { const top = stack.pop(); if (top !== m[2]) return `</${m[2]}> passt nicht zu <${top || '—'}>`; }
    else stack.push(m[2]);
  }
  return stack.length ? `<${stack[stack.length - 1]}> wird nicht geschlossen` : null;
}

// Checks a planned pack without writing it.
function validatePlan(plan, deep = true) {
  const errors = [], warnings = [];
  for (const m of plan.blocked) warnings.push(`${m.file}: geschützt oder ohne assembly.xml – kann nicht ins Pack`);
  const asmErr = xmlProblem(plan.asmXml);
  if (asmErr) errors.push('assembly.xml: ' + asmErr);
  let checked = 0;
  const total = plan.kept.length;
  for (const k of plan.kept) {
    checked++;
    if (checked % 25 === 0) ctx.progress({ label: 'Prüfe Dateien', done: checked, total });
    if (k.own) { if (!fs.existsSync(k.own)) errors.push(`Eigene Datei fehlt: ${path.basename(k.own)}`); continue; }
    if (!k.entry) { errors.push(`${k.mod}: Quelle „${k.source}“ fehlt im Archiv`); continue; }
    if (!deep) continue;
    try {
      const data = rpf.extract(k.src, k.entry);
      if (k.entry.type === 'res') {
        const out = require('zlib').inflateRawSync(data.slice(16));
        if (out.length !== k.entry.size) warnings.push(`${k.mod}: ${k.source} – Größe passt nicht zu den Ressourcen-Flags`);
      } else if (/\.(xml|meta)$/i.test(k.source) || (/\.(dat|ymt)$/i.test(k.source) && data.slice(0, 64).toString('latin1').trimStart().startsWith('<'))) {
        const pr = xmlProblem(data.toString('utf8'));
        if (pr) errors.push(`${k.mod}: ${k.source} – kaputtes XML (${pr})`);
      }
    } catch (e) { errors.push(`${k.mod}: ${k.source} – lässt sich nicht lesen (${e.message})`); }
    if (errors.length > 40) { errors.push('… weitere Fehler abgeschnitten'); break; }
  }
  ctx.progress({ label: 'Prüfe Dateien', done: total, total });
  // targets that are still provided by several mods
  const seen = new Map();
  for (const k of plan.kept) { const key = k.target.toLowerCase(); seen.set(key, (seen.get(key) || 0) + 1); }
  const dup = [...seen].filter(([, n]) => n > 1).length;
  if (dup) warnings.push(`${dup} Ziel(e) werden von mehreren Quellen gesetzt – die spätere gewinnt`);
  // RPF limits
  const names = new Set(); for (const f of plan.files) for (const part of f.path.split('/')) names.add(part);
  const nameBytes = [...names].reduce((a, n) => a + Buffer.byteLength(n) + 1, 0);
  if (nameBytes > 0xffff) errors.push(`Zu viele Dateinamen für eine RPF (${Math.round(nameBytes / 1024)} KB von 64 KB) – weniger Mods/Dateien wählen`);
  const bytes = plan.files.reduce((a, f) => a + (f.size || 0), 0);
  if (bytes > 4.0e9) errors.push(`Pack wäre ca. ${(bytes / 1073741824).toFixed(1)} GB – Maximum sind etwa 4 GB`);
  else if (bytes > 3.5e9) warnings.push(`Pack wird sehr groß (${(bytes / 1073741824).toFixed(1)} GB)`);
  return { ok: !errors.length, errors, warnings, stats: { mods: plan.usable.length, files: plan.files.length, bytes, skipped: plan.skipped, own: plan.kept.filter((k) => k.own).length } };
}

function verifyPack(file) {
  const l = rpf.list(file);
  const asm = l.entries.find((e) => e.path === 'assembly.xml');
  if (!asm) return { ok: false, problems: ['assembly.xml fehlt'] };
  const xml = rpf.extract(file, asm).toString('utf8');
  const problems = [];
  const pe = xmlProblem(xml); if (pe) problems.push('assembly.xml: ' + pe);
  const have = new Set(l.entries.map((e) => e.path.toLowerCase()));
  const srcs = [...xml.matchAll(/source="([^"]+)"/g)].map((m) => ('content/' + decode(m[1]).replace(/\\/g, '/')).toLowerCase());
  for (const s2 of srcs) if (!have.has(s2)) problems.push('Quelle fehlt im Pack: ' + s2);
  return { ok: !problems.length, problems: problems.slice(0, 20), sources: srcs.length, entries: l.entries.length };
}

async function buildPack(opt = {}) {
  const plan = planPack(opt);
  if (!opt.selection) { plan.p.pack = { ...plan.p.pack, ...opt, name: plan.packName }; delete plan.p.pack.selection; saveProject(plan.p); }
  if (opt.validate !== false) {
    const v = validatePlan(plan, opt.deep !== false);
    if (!v.ok) { const e = new Error('Prüfung fehlgeschlagen:\n' + v.errors.slice(0, 8).join('\n')); e.report = v; throw e; }
  }
  const out = path.join(packsDir(), freeName(packsDir(), plan.packName + '.rpf'));
  const resolved = plan.files.map((f) => (f.lazy ? { path: f.path, get data() { return rpf.extract(f.lazy.src, f.lazy.entry); } } : f));
  const r = rpf.build(out, resolved, (d, t) => { if (d % 20 === 0 || d === t) ctx.progress({ label: 'Baue Pack', done: d, total: t }); });
  const check = verifyPack(out);
  return { ok: true, file: out, name: path.basename(out), size: r.size, files: plan.files.length, mods: plan.usable.length, skippedConflicts: plan.skipped, blocked: plan.blocked.map((m) => m.file), verified: check };
}

// ---- fusion view data
function categoryOf(target, source) {
  const t = (target + ' ' + (source || '')).toLowerCase();
  if (/timecycle|\/w_[a-z]+\.xml|weather|clouds?\b|cloudkf|skyhat/.test(t)) return 'Wetter & Timecycle';
  if (/visualsettings|graphics\.ytd|postfx/.test(t)) return 'Grafik-Einstellungen';
  if (/lensflare|corona|light/.test(t)) return 'Lichter & Lens Flares';
  if (/water/.test(t)) return 'Wasser';
  if (/\.ypt|ptfx|fx\.dat|decal|blood|explosion|fire/.test(t)) return 'Partikel & Effekte';
  if (/veh|carcols|carvariation|\.yft|wheel/.test(t)) return 'Fahrzeuge';
  if (/\.ymap|\.ytyp|vegetation|grass|dlc\.rpf|dlcpacks/.test(t)) return 'Welt & Vegetation';
  if (/\.ytd/.test(t)) return 'Texturen';
  if (/\.ydr|\.ydd|\.ybn/.test(t)) return 'Modelle';
  return 'Sonstiges';
}
function fusionData(mods) {
  needWs();
  const rows = new Map(); const extras = [];
  for (const f of mods) {
    const info = modInfo(f);
    if (!info.readable || !info.oiv) continue;
    let xi = -1;
    for (const o of info.ops) {
      if (!isAR(o)) { xi++; extras.push({ key: `x:${info.file}:${xi}`, mod: info.file, kind: o.kind, target: o.targetRaw || o.target, archive: o.archive, category: categoryOf(o.target, '') }); continue; }
      const k = opKey(o);
      if (!rows.has(k)) rows.set(k, { key: k, archive: o.archive, target: o.targetRaw || o.target, category: categoryOf(o.target, o.source), have: {} });
      rows.get(k).have[info.file] = { kind: o.kind, source: o.source };
    }
  }
  return {
    mods: mods.map((f) => { const i = modInfo(f); return { file: i.file, readable: i.readable, oiv: i.oiv, enc: i.enc, ops: i.ops.length, size: i.size, name: i.meta?.name || '' }; }),
    rows: [...rows.values()].sort((a, b) => a.category.localeCompare(b.category) || a.target.localeCompare(b.target)),
    extras,
  };
}
function cryptoId() { return require('crypto').randomUUID().toUpperCase(); }

// ------------------------------------------------------------ install (explicit, copy only, never overwrite)
async function installToFiveM(packFile) {
  needWs();
  const src = path.join(packsDir(), path.basename(packFile));
  if (!fs.existsSync(src)) throw new Error('Pack nicht gefunden');
  const d = liveModsDir();
  if (!fs.existsSync(d)) throw new Error('FiveM-mods-Ordner nicht gefunden');
  const name = freeName(d, path.basename(src));
  await copyWithProgress(src, path.join(d, name), 'Kopiere nach FiveM');
  return { ok: true, name, dir: d };
}

// ------------------------------------------------------------ textures (YTD)
const ytd = require('./ytd');
const sessions = new Map(); let sessSeq = 0;
function sourceTarget(modFile, entryPath) {
  const info = modInfo(modFile);
  const rel = entryPath.replace(/^content\//i, '').replace(/\//g, '\\').toLowerCase();
  const op = info.ops.find((o) => (o.kind === 'add' || o.kind === 'replace') && decode(o.source).replace(/\//g, '\\').toLowerCase() === rel);
  return op ? { archive: op.archive, target: op.target, targetRaw: op.targetRaw } : null;
}
function ytdOpen(b) {
  needWs();
  let buf, src;
  if (b.mod) {
    const p = modPath(b.mod);
    const l = rpf.list(p);
    const e = l.entries.find((x) => x.path === b.path);
    if (!e) throw new Error('Datei nicht im Archiv');
    buf = rpf.extract(p, e);
    src = { kind: 'mod', mod: b.mod, path: b.path, name: path.basename(b.path), target: sourceTarget(b.mod, b.path) };
  } else if (b.own) {
    const p = path.join(ownDir(), path.basename(b.own));
    buf = fs.readFileSync(p);
    const p2 = loadProject(); const ov = (p2.overrides || []).find((o) => o.file === path.basename(b.own));
    src = { kind: 'own', own: path.basename(b.own), name: path.basename(b.own), target: ov ? { archive: ov.archive, target: normT(ov.target), targetRaw: ov.target } : null };
  } else if (b.disk) {
    buf = fs.readFileSync(b.disk); // read only
    src = { kind: 'disk', disk: b.disk, name: path.basename(b.disk), target: null };
  } else throw new Error('Keine Quelle');
  const y = ytd.parseYtd(buf);
  const id = String(++sessSeq);
  sessions.set(id, { id, y, src, changed: new Set(), ver: 0 });
  if (sessions.size > 6) sessions.delete(sessions.keys().next().value);
  return ytdState(id);
}
function sess(id) { const s = sessions.get(String(id)); if (!s) throw new Error('Textur-Datei ist nicht mehr offen – bitte neu öffnen'); return s; }
function ytdState(id) {
  const s = sess(id);
  return { id: s.id, src: s.src, changed: [...s.changed], ver: s.ver, textures: s.y.textures.map((t) => ({ index: t.index, name: t.name, width: t.width, height: t.height, format: t.format, levels: t.levels, supported: t.supported, size: t.dataSize })) };
}
function rgbaToBgra(b) { const o = Buffer.from(b); for (let i = 0; i < o.length; i += 4) { const r = o[i]; o[i] = o[i + 2]; o[i + 2] = r; } return o; }
function textureImage(id, index, size) { // -> { data, type } for the vps:// protocol
  const s = sess(id); const t = s.y.textures[index];
  if (!t || !t.supported) return null;
  let level = 0;
  if (size) while (level < t.levels - 1 && Math.max(t.width >> (level + 1), t.height >> (level + 1)) >= size) level++;
  const m = ytd.textureData(s.y, t, level);
  const rgba = ytd.decode(t.format, m.w, m.h, m.data);
  let img = ctx.nativeImage.createFromBitmap(rgbaToBgra(rgba), { width: m.w, height: m.h });
  if (size && Math.max(m.w, m.h) > size) img = img.resize(m.w >= m.h ? { width: size } : { height: size });
  return { data: img.toPNG(), type: 'image/png' };
}
function ytdExport(b) {
  const s = sess(b.id);
  const dir = path.join(exportDir(), 'Texturen', clean(s.src.name.replace(/\.ytd$/i, '')));
  fs.mkdirSync(dir, { recursive: true });
  const list = b.all ? s.y.textures : [s.y.textures[b.index]];
  let n = 0;
  for (const t of list) {
    if (!t || !t.supported) continue;
    if (b.as === 'dds') {
      fs.writeFileSync(path.join(dir, clean(t.name) + '.dds'), ytd.toDDS(t, s.y.res.data.slice(t.dataOffset, t.dataOffset + t.dataSize)));
    } else {
      const m = ytd.textureData(s.y, t, 0);
      const img = ctx.nativeImage.createFromBitmap(rgbaToBgra(ytd.decode(t.format, m.w, m.h, m.data)), { width: m.w, height: m.h });
      fs.writeFileSync(path.join(dir, clean(t.name) + '.png'), img.toPNG());
    }
    n++;
  }
  return { ok: true, files: n, dir };
}
function ytdReplace(b) {
  const s = sess(b.id); const t = s.y.textures[b.index];
  if (!t || !t.supported) throw new Error('Dieses Texturformat wird nicht unterstützt');
  const file = String(b.file || '');
  if (!fs.existsSync(file)) throw new Error('Bild nicht gefunden');
  let rgba;
  if (/\.dds$/i.test(file)) {
    const d = ytd.fromDDS(fs.readFileSync(file));
    if (d.fmt === t.format && d.w === t.width && d.h === t.height && d.levels >= t.levels && d.data.length >= t.dataSize) {
      d.data.copy(s.y.res.data, t.dataOffset, 0, t.dataSize); // exact match: take the DDS data as-is
      s.changed.add(t.index); s.ver++; return ytdState(b.id);
    }
    const top = d.data.slice(0, ytd.mipSize(d.fmt, d.w, d.h));
    rgba = ytd.decode(d.fmt, d.w, d.h, top);
    if (d.w !== t.width || d.h !== t.height) {
      const img = ctx.nativeImage.createFromBitmap(rgbaToBgra(rgba), { width: d.w, height: d.h }).resize({ width: t.width, height: t.height, quality: 'best' });
      rgba = rgbaToBgra(img.toBitmap());
    }
  } else {
    let img = ctx.nativeImage.createFromPath(file);
    if (img.isEmpty()) throw new Error('Bild konnte nicht gelesen werden (PNG, JPG, BMP oder DDS)');
    const sz = img.getSize();
    if (sz.width !== t.width || sz.height !== t.height) img = img.resize({ width: t.width, height: t.height, quality: 'best' });
    rgba = rgbaToBgra(img.toBitmap());
  }
  ytd.replaceTexture(s.y, t, rgba);
  s.changed.add(t.index); s.ver++;
  return ytdState(b.id);
}
function ytdSave(b) {
  needWs();
  const s = sess(b.id);
  if (!s.changed.size) throw new Error('Keine Änderungen');
  const out = ytd.saveResource(s.y.res);
  ytd.parseYtd(out); // sanity: must re-open
  let name;
  if (s.src.kind === 'own') { name = s.src.own; fs.writeFileSync(path.join(ownDir(), name), out); }
  else {
    name = freeName(ownDir(), s.src.name);
    fs.writeFileSync(path.join(ownDir(), name), out);
    if (s.src.target) {
      const p = loadProject();
      p.overrides = (p.overrides || []).filter((x) => !(x.archive === s.src.target.archive && normT(x.target) === s.src.target.target));
      p.overrides.push({ file: name, archive: s.src.target.archive, chain: s.src.kind === 'mod' ? chainFor(s.src.mod, s.src.target.archive) : [], target: s.src.target.targetRaw || s.src.target.target });
      saveProject(p);
    }
    s.src = { kind: 'own', own: name, name, target: s.src.target };
  }
  s.changed.clear();
  return { ok: true, file: name, override: !!s.src.target, size: out.length };
}

// ------------------------------------------------------------ API
async function api(route, q = {}, b = {}) {
  switch (route) {
    case 'ms/ytdopen': return ytdOpen(b);
    case 'ms/ytdstate': return ytdState(b.id);
    case 'ms/ytdexport': return ytdExport(b);
    case 'ms/ytdreplace': return ytdReplace(b);
    case 'ms/ytdsave': return ytdSave(b);
    case 'ms/state': {
      const has = !!ws() && fs.existsSync(ws());
      return { workspace: has ? ws() : '', recent: S().msRecent || [], liveDir: liveModsDir(), liveExists: fs.existsSync(liveModsDir()), docs: path.join(os.homedir(), 'Documents', 'VELOX Mod-Studio') };
    }
    case 'ms/open': return openWorkspace(b.dir, !!b.create);
    case 'ms/project': {
      needWs(); const p = loadProject(); saveProject(p);
      return { ...p, mods: p.mods.map((m) => ({ ...m, info: modInfo(m.file) })), packs: fs.readdirSync(packsDir()).filter((f) => /\.rpf$/i.test(f)).map((f) => ({ file: f, size: fs.statSync(path.join(packsDir(), f)).size, mtime: fs.statSync(path.join(packsDir(), f)).mtimeMs })) };
    }
    case 'ms/setmods': { needWs(); const p = loadProject(); const byFile = new Map(p.mods.map((m) => [m.file, m])); p.mods = b.mods.filter((m) => byFile.has(m.file)).map((m) => ({ ...byFile.get(m.file), enabled: !!m.enabled, excluded: m.excluded || byFile.get(m.file).excluded || [] })); for (const m of byFile.values()) if (!p.mods.some((x) => x.file === m.file)) p.mods.push(m); return saveProject(p); }
    case 'ms/exclude': { needWs(); const p = loadProject(); const m = p.mods.find((x) => x.file === b.file); if (!m) throw new Error('Mod nicht gefunden'); const s = new Set(m.excluded || []); b.on ? s.add(b.key) : s.delete(b.key); m.excluded = [...s]; saveProject(p); return { ok: true, excluded: m.excluded }; }
    case 'ms/import': return importFiles(b.files || []);
    case 'ms/live': return liveMods();
    case 'ms/copylive': { needWs(); const d = liveModsDir(); return importFiles((b.files || []).map((f) => path.join(d, path.basename(f)))); }
    case 'ms/tree': return tree(b.file || q.file);
    case 'ms/ops': { needWs(); const i = modInfo(b.file || q.file); return { info: i, ops: i.ops.map((o) => ({ ...o, key: opKey(o) })) }; }
    case 'ms/export': return exportEntries(b.file, b.paths || [], b.target);
    case 'ms/conflicts': needWs(); return conflicts();
    case 'ms/override': return addOverride({ ...b, chain: b.chain || (b.fromMod ? chainFor(b.fromMod, b.archive) : []) });
    case 'ms/removeoverride': { needWs(); const p = loadProject(); const o = (p.overrides || [])[b.index]; p.overrides.splice(b.index, 1); saveProject(p); if (o) { try { fs.unlinkSync(path.join(ownDir(), o.file)); } catch { } } return { ok: true }; }
    case 'ms/removemod': { // in-place mods are only removed from the list; copies in Mods/ are deleted
      needWs(); const p = loadProject();
      if (isInPlace(b.file)) { p.mods = p.mods.filter((m) => m.file !== b.file); saveProject(p); return { ok: true, inPlace: true }; }
      const f = path.join(modsDir(), path.basename(b.file));
      if (!inside(f, modsDir())) throw new Error('Nicht erlaubt');
      fs.unlinkSync(f); saveProject(loadProject()); return { ok: true };
    }
    case 'ms/browse': return browse(b.dir || '');
    case 'ms/scan': return scanWorkspace();
    case 'ms/useinplace': return useInPlace(b.files || (b.rel ? [b.rel] : []));
    case 'ms/hide': { needWs(); const p = loadProject(); p.hidden = [...new Set([...(p.hidden || []), ...(b.files || [])])]; saveProject(p); return { ok: true }; }
    case 'ms/build': try { return await buildPack(b || {}); } catch (e) { if (e.report) return { ok: false, report: e.report, error: e.message }; throw e; }
    case 'ms/fusion': return fusionData(b.mods || []);
    case 'ms/validate': { const plan = planPack(b || {}); return validatePlan(plan, b.deep !== false); }
    case 'ms/verify': return verifyPack(path.join(packsDir(), path.basename(b.file)));
    case 'ms/install': return installToFiveM(b.file);
    case 'ms/folder': { needWs(); return { path: { ws: ws(), mods: modsDir(), export: exportDir(), packs: packsDir(), own: ownDir(), live: liveModsDir() }[b.what] || ws() }; }
  }
  if (route.startsWith('ms/v/')) { needWs(); const v = await modviz.api(route, b || q); if (v !== undefined) return v; }
  throw new Error('Unbekannte Mod-Studio-Aktion: ' + route);
}

function modTexImage(sp) { needWs(); return modviz.texImage(sp.get('file'), sp.get('path'), +sp.get('i'), +sp.get('size') || 0); }
module.exports = { init, api, parseAssembly, textureImage, modTexImage };
