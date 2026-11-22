// VELOX Mod-Studio backend: works only inside a user-chosen workspace folder.
// Mods from anywhere (incl. the live FiveM mods folder) are COPIED in; originals are only read.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const rpf = require('./rpf');
const zip = require('./zip');

let ctx = { settings: null, save: null, progress: () => { } };
function init(o) { Object.assign(ctx, o); }
const S = () => ctx.settings();
const ws = () => S().msWorkspace || '';
const modsDir = () => path.join(ws(), 'Mods');
const exportDir = () => path.join(ws(), 'Export');
const packsDir = () => path.join(ws(), 'Packs');
const ownDir = () => path.join(ws(), 'Eigene Dateien');
const projFile = () => path.join(ws(), 'velox-modstudio.json');
const cacheFile = () => path.join(ws(), '.velox-cache.json');
const liveModsDir = () => path.join(process.env.LOCALAPPDATA || '', 'FiveM', 'FiveM.app', 'mods');

function needWs() { if (!ws() || !fs.existsSync(ws())) throw new Error('Kein Arbeitsordner gewählt'); }
function inside(p, root) { const a = path.resolve(p).toLowerCase(), b = path.resolve(root).toLowerCase(); return a === b || a.startsWith(b + path.sep); }
const clean = (s) => String(s || '').replace(/[<>:"/\\|?*]/g, '').trim();

// ------------------------------------------------------------ project
function loadProject() {
  let p = { name: path.basename(ws()), mods: [], overrides: [], pack: { name: path.basename(ws()), version: '1.0', author: '', description: '' } };
  try { p = { ...p, ...JSON.parse(fs.readFileSync(projFile(), 'utf8').replace(/^\uFEFF/, '')) }; } catch { }
  // sync with files on disk
  const files = fs.existsSync(modsDir()) ? fs.readdirSync(modsDir()).filter((f) => /\.rpf$/i.test(f)) : [];
  p.mods = p.mods.filter((m) => files.includes(m.file));
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
  const p = path.join(modsDir(), file);
  const st = fs.statSync(p);
  const key = file + '|' + st.size + '|' + st.mtimeMs;
  const c = loadCache();
  if (c[file] && c[file].key === key) return c[file].info;
  const info = { file, size: st.size, enc: 'unknown', readable: false, oiv: false, entries: 0, files: 0, meta: {}, ops: [] };
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

// ------------------------------------------------------------ tree / export
function tree(file) {
  needWs();
  const p = path.join(modsDir(), path.basename(file));
  const l = rpf.list(p);
  return { enc: l.enc, readable: l.readable, entries: l.entries.map((e) => ({ path: e.path, type: e.type, size: e.size, nested: e.nested })) };
}
function exportEntries(file, paths, target) {
  needWs();
  const p = path.join(modsDir(), path.basename(file));
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
  const p = path.join(modsDir(), modFile);
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
async function buildPack(opt = {}) {
  needWs();
  const p = loadProject();
  const packName = clean(opt.name || p.pack.name || 'Mein Pack') || 'Mein Pack';
  p.pack = { ...p.pack, ...opt, name: packName }; saveProject(p);
  const dropLosers = opt.dropLosers !== false;
  const conf = conflicts(p);
  const losers = new Map(); // key -> winning mod file
  for (const c of conf) losers.set(c.key, c.winner);
  const enabled = p.mods.filter((m) => m.enabled);
  const blocked = enabled.filter((m) => { const i = modInfo(m.file); return !i.readable || !i.oiv; });
  const usable = enabled.filter((m) => !blocked.includes(m));
  if (!usable.length && !(p.overrides || []).length) throw new Error('Keine verwendbaren Mods im Pack (geschützte oder unbekannte Mods können nicht zusammengeführt werden)');
  const files = []; const blocks = []; let idx = 0; let skipped = 0;
  for (const m of usable) {
    idx++;
    const prefix = `m${String(idx).padStart(2, '0')}_${clean(path.basename(m.file, '.rpf')).replace(/\s+/g, '_').slice(0, 40)}`;
    const src = path.join(modsDir(), m.file);
    const l = rpf.list(src);
    const asmE = l.entries.find((e) => e.path.toLowerCase() === 'assembly.xml');
    const a = parseAssembly(rpf.extract(src, asmE).toString('utf8').replace(/^\uFEFF/, ''));
    // remove excluded ops and (optionally) ops that lose a conflict
    const drop = a.ops.filter((o) => (o.kind === 'add' || o.kind === 'replace') && ((m.excluded || []).includes(opKey(o)) || (dropLosers && losers.has(opKey(o)) && losers.get(opKey(o)) !== m.file)));
    skipped += drop.length;
    let content = a.content;
    for (const o of [...drop].sort((x, y) => y.start - x.start)) content = content.slice(0, o.start) + content.slice(o.end);
    // rewrite source paths with the mod prefix
    content = content.replace(/(<(?:add|replace)\b[^>]*\bsource\s*=\s*")([^"]*)(")/gi, (_, a1, s, a3) => a1 + esc(prefix + '\\' + decode(s).replace(/\//g, '\\')) + a3);
    blocks.push(`<!-- ${esc(m.file)} -->\n` + content.trim());
    // which content files are still referenced?
    const used = new Set(a.ops.filter((o) => !drop.includes(o) && o.source).map((o) => decode(o.source).replace(/\\/g, '/').toLowerCase()));
    const contentFiles = l.entries.filter((e) => e.type !== 'dir' && /^content\//i.test(e.path) && !l.entries.some((x) => x.nested && e.path.startsWith(x.path + '/')));
    for (const e of contentFiles) {
      const rel = e.path.slice(8);
      if (!used.has(rel.toLowerCase())) continue;
      files.push({ path: `content/${prefix}/${rel}`, lazy: { src, entry: e } });
    }
  }
  // own files
  const ownBlocks = [];
  (p.overrides || []).forEach((o, i) => {
    const srcName = `velox_eigene/${String(i + 1).padStart(2, '0')}_${o.file}`;
    files.push({ path: 'content/' + srcName, file: path.join(ownDir(), o.file) });
    ownBlocks.push(wrapChain(o.chain || [], `<add source="${esc(srcName.replace(/\//g, '\\'))}">${esc(String(o.target).replace(/\//g, '\\'))}</add>`));
  });
  const desc = `Erstellt mit VELOX Mod-Studio.\nEnthält:\n${usable.map((m) => '- ' + m.file).join('\n')}${(p.overrides || []).length ? `\n- ${p.overrides.length} eigene Dateien` : ''}${p.pack.description ? '\n\n' + p.pack.description : ''}`;
  const [maj, min] = String(p.pack.version || '1.0').split('.');
  const asmXml = `<?xml version="1.0" encoding="UTF-8"?>
<package version="2.2" id="{${cryptoId()}}" target="Five">
<metadata>
<name>${esc(packName)}</name>
<version><major>${+maj || 1}</major><minor>${+min || 0}</minor></version>
<author><displayName>${esc(p.pack.author || 'VELOX Mod-Studio')}</displayName></author>
<description><![CDATA[${desc.replace(/]]>/g, '')}]]></description>
</metadata>
<content>
${blocks.join('\n')}
${ownBlocks.join('\n')}
</content>
</package>
`;
  files.unshift({ path: 'assembly.xml', data: Buffer.from(asmXml, 'utf8') });
  // materialise lazily-read files during build (keeps memory low)
  const out = path.join(packsDir(), freeName(packsDir(), packName + '.rpf'));
  const resolved = files.map((f) => (f.lazy ? { path: f.path, get data() { return rpf.extract(f.lazy.src, f.lazy.entry); } } : f));
  const r = rpf.build(out, resolved, (d, t) => { if (d % 20 === 0 || d === t) ctx.progress({ label: 'Baue Pack', done: d, total: t }); });
  return { ok: true, file: out, name: path.basename(out), size: r.size, files: files.length, mods: usable.length, skippedConflicts: skipped, blocked: blocked.map((m) => m.file) };
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

// ------------------------------------------------------------ API
async function api(route, q = {}, b = {}) {
  switch (route) {
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
    case 'ms/ops': { needWs(); const i = modInfo(path.basename(b.file || q.file)); return { info: i, ops: i.ops.map((o) => ({ ...o, key: opKey(o) })) }; }
    case 'ms/export': return exportEntries(b.file, b.paths || [], b.target);
    case 'ms/conflicts': needWs(); return conflicts();
    case 'ms/override': return addOverride({ ...b, chain: b.chain || (b.fromMod ? chainFor(b.fromMod, b.archive) : []) });
    case 'ms/removeoverride': { needWs(); const p = loadProject(); const o = (p.overrides || [])[b.index]; p.overrides.splice(b.index, 1); saveProject(p); if (o) { try { fs.unlinkSync(path.join(ownDir(), o.file)); } catch { } } return { ok: true }; }
    case 'ms/removemod': { // removes the COPY from the workspace only
      needWs(); const f = path.join(modsDir(), path.basename(b.file));
      if (!inside(f, modsDir())) throw new Error('Nicht erlaubt');
      fs.unlinkSync(f); const p = loadProject(); saveProject(p); return { ok: true };
    }
    case 'ms/build': return buildPack(b || {});
    case 'ms/install': return installToFiveM(b.file);
    case 'ms/folder': { needWs(); return { path: { ws: ws(), mods: modsDir(), export: exportDir(), packs: packsDir(), own: ownDir(), live: liveModsDir() }[b.what] || ws() }; }
  }
  throw new Error('Unbekannte Mod-Studio-Aktion: ' + route);
}

module.exports = { init, api, parseAssembly };
