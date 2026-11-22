// VELOX Mod-Studio – visualisation backend: mod profile, texture gallery/compare, timecycle, visualsettings, 3D models.
'use strict';
const path = require('path');
const zlib = require('zlib');
const rpf = require('./rpf');
const ytd = require('./ytd');

let H = null; // helpers from modstudio: { modPath, modInfo, loadProject, nativeImage, categoryOf }
function init(h) { H = h; }

// ------------------------------------------------------------ listing cache per mod
const listCache = new Map();
function listing(file) {
  const p = H.modPath(file);
  const st = require('fs').statSync(p);
  const key = p + '|' + st.size + '|' + st.mtimeMs;
  if (listCache.has(file) && listCache.get(file).key === key) return listCache.get(file);
  const l = rpf.list(p);
  const v = { key, p, l };
  listCache.set(file, v);
  if (listCache.size > 20) listCache.delete(listCache.keys().next().value);
  return v;
}
const ext = (p) => (p.split('.').pop() || '').toLowerCase();

// ------------------------------------------------------------ profile ("Steckbrief")
function summary(file) {
  const info = H.modInfo(file);
  const out = { file, name: info.name, size: info.size, readable: info.readable, oiv: info.oiv, meta: info.meta, enc: info.enc, categories: {}, types: {}, weather: [], visualsettings: false, textures: 0, models: 0 };
  for (const o of info.ops || []) { const c = H.categoryOf(o.target, o.source); out.categories[c] = (out.categories[c] || 0) + 1; }
  if (!info.readable) return out;
  const { l } = listing(file);
  for (const e of l.entries) {
    if (e.type === 'dir' || e.nested) continue;
    const x = ext(e.path);
    const t = out.types[x] || (out.types[x] = { count: 0, bytes: 0 });
    t.count++; t.bytes += e.csize || e.size || 0;
    if (x === 'ytd') out.textures++;
    if (x === 'ydr' || x === 'yft' || x === 'ydd') out.models++;
    if (/(^|\/)w_[a-z_]+\.xml$/i.test(e.path)) out.weather.push({ path: e.path, name: path.basename(e.path, '.xml').slice(2) });
    if (/visualsettings\.dat$/i.test(e.path)) out.visualsettings = e.path;
  }
  return out;
}

// ------------------------------------------------------------ textures
function modTextures(file) {
  const { l } = listing(file);
  return l.entries.filter((e) => e.type === 'res' && ext(e.path) === 'ytd').map((e) => ({ path: e.path, size: e.size }));
}
const ytdCache = new Map();
function openYtd(file, p) {
  const key = file + '|' + p;
  if (ytdCache.has(key)) { const v = ytdCache.get(key); ytdCache.delete(key); ytdCache.set(key, v); return v; }
  const { p: rp, l } = listing(file);
  const e = l.entries.find((x) => x.path === p);
  if (!e) throw new Error('Datei nicht im Archiv');
  const y = ytd.parseYtd(rpf.extract(rp, e));
  ytdCache.set(key, y);
  while (ytdCache.size > 4) ytdCache.delete(ytdCache.keys().next().value);
  return y;
}
function ytdInfo(file, p) {
  const y = openYtd(file, p);
  return y.textures.map((t) => ({ index: t.index, name: t.name, width: t.width, height: t.height, format: t.format, levels: t.levels, supported: t.supported }));
}
function texImage(file, p, index, size) {
  const y = openYtd(file, p); const t = y.textures[index];
  if (!t || !t.supported) return null;
  let level = 0;
  if (size) while (level < t.levels - 1 && Math.max(t.width >> (level + 1), t.height >> (level + 1)) >= size) level++;
  const m = ytd.textureData(y, t, level);
  const rgba = ytd.decode(t.format, m.w, m.h, m.data);
  for (let i = 0; i < rgba.length; i += 4) { const r = rgba[i]; rgba[i] = rgba[i + 2]; rgba[i + 2] = r; }
  let img = H.nativeImage.createFromBitmap(rgba, { width: m.w, height: m.h });
  if (size && Math.max(m.w, m.h) > size) img = img.resize(m.w >= m.h ? { width: size } : { height: size });
  return { data: img.toPNG(), type: 'image/png' };
}
// other mods in the project that have the same texture (same ytd file name + texture name)
function texCompare(file, p, texName) {
  const proj = H.loadProject();
  const base = path.basename(p).toLowerCase();
  const res = [];
  for (const m of proj.mods) {
    if (m.file === file) continue;
    const info = H.modInfo(m.file);
    if (!info.readable) continue;
    let l; try { l = listing(m.file).l; } catch { continue; }
    for (const e of l.entries) {
      if (e.type !== 'res' || path.basename(e.path).toLowerCase() !== base) continue;
      try { const t = openYtd(m.file, e.path).textures.find((x) => x.name.toLowerCase() === texName.toLowerCase()); if (t) res.push({ mod: m.file, path: e.path, index: t.index, width: t.width, height: t.height, format: t.format }); } catch { }
    }
  }
  return res;
}

// ------------------------------------------------------------ timecycle
const TC_HOURS = [0, 5, 6, 7, 10, 13, 16, 17, 18, 19, 20, 21, 22];
function weatherData(file, p) {
  const { p: rp, l } = listing(file);
  const e = l.entries.find((x) => x.path === p);
  if (!e) throw new Error('Datei nicht im Archiv');
  const xml = rpf.extract(rp, e).toString('utf8');
  const cyc = /<cycle\s+name="([^"]+)"/i.exec(xml);
  const regions = {};
  const re = /<region\s+name="([^"]+)"\s*>([\s\S]*?)<\/region>/gi; let m;
  while ((m = re.exec(xml))) {
    const vars = {};
    const vr = /<([a-z_0-9]+)>([^<]*)<\/\1>/gi; let v;
    while ((v = vr.exec(m[2]))) { const nums = v[2].trim().split(/\s+/).map(Number); if (nums.length && !nums.some(isNaN)) vars[v[1]] = nums; }
    regions[m[1]] = vars;
  }
  return { cycle: cyc ? cyc[1] : path.basename(p), hours: TC_HOURS, regions };
}

// ------------------------------------------------------------ visualsettings
function visualSettings(file, p) {
  const { p: rp, l } = listing(file);
  const e = l.entries.find((x) => x.path === p);
  if (!e) throw new Error('Datei nicht im Archiv');
  const out = [];
  for (const line of rpf.extract(rp, e).toString('utf8').split(/\r?\n/)) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const m = /^(\S+)\s+(.+)$/.exec(s); if (!m) continue;
    out.push({ key: m[1], value: m[2].trim() });
  }
  return out;
}
function findIn(file, re) { try { return listing(file).l.entries.filter((e) => e.type !== 'dir' && re.test(e.path)).map((e) => e.path); } catch { return []; } }

// ------------------------------------------------------------ 3D models (YDR / YFT / YDD) – geometry only
const VTYPE_SIZE = { 0: 0, 1: 4, 2: 4, 3: 8, 4: 0, 5: 8, 6: 12, 7: 16, 8: 4, 9: 4, 10: 4, 11: 4, 12: 4, 13: 4, 14: 8, 15: 0 };
function half(h) { const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff; if (e === 0) return s * Math.pow(2, -14) * (f / 1024); if (e === 31) return f ? NaN : s * Infinity; return s * Math.pow(2, e - 15) * (1 + f / 1024); }
function parseModel(buf) {
  if (buf.readUInt32LE(0) !== 0x37435352) throw new Error('Keine Ressource');
  const sys = buf.readUInt32LE(8), gfx = buf.readUInt32LE(12);
  const d = zlib.inflateRawSync(buf.slice(16));
  const sysSize = rpf.resSize(sys);
  const P = (o) => { const lo = d.readUInt32LE(o), hi = d.readUInt32LE(o + 4); if (hi !== 0) return -1; const k = lo >>> 28, off = lo & 0x0fffffff; return k === 5 ? off : k === 6 ? sysSize + off : -1; };
  const ok = (o) => o >= 0 && o + 16 <= d.length;
  const drawables = [];
  // try plain drawable at 0; fragments keep their drawable pointer at 0x30; dictionaries (ydd) list drawables at 0x30
  const tryDrawable = (o) => { if (!ok(o)) return false; const hp = P(o + 0x50); if (!ok(hp)) return false; drawables.push(o); return true; };
  if (!tryDrawable(0)) {
    const fp = P(0x30);
    if (ok(fp) && !tryDrawable(fp)) {
      const cnt = d.readUInt16LE(0x38);
      for (let i = 0; i < Math.min(cnt, 64); i++) { const q = P(fp + i * 8); if (ok(q)) tryDrawable(q); }
    }
  }
  if (!drawables.length) throw new Error('Kein darstellbares Modell gefunden');
  const meshes = []; let tri = 0;
  const bmin = [Infinity, Infinity, Infinity], bmax = [-Infinity, -Infinity, -Infinity];
  for (const dr of drawables.slice(0, 16)) {
    const listP = P(dr + 0x50); if (!ok(listP)) continue;
    const mCount = d.readUInt16LE(dr + 0x58 - 0x08 + 0x08) || 0; // count stored after the list pointer
    const lp = P(listP), lc = d.readUInt16LE(listP + 8);
    if (!ok(lp)) continue;
    for (let mi = 0; mi < Math.min(lc, 32); mi++) {
      const model = P(lp + mi * 8); if (!ok(model)) continue;
      const gp = P(model + 0x08), gc = d.readUInt16LE(model + 0x10);
      if (!ok(gp)) continue;
      for (let gi = 0; gi < Math.min(gc, 256); gi++) {
        const g = P(gp + gi * 8); if (!ok(g)) continue;
        const vb = P(g + 0x18), ib = P(g + 0x38);
        if (!ok(vb) || !ok(ib)) continue;
        const stride = d.readUInt16LE(vb + 0x08), vcount = d.readUInt32LE(vb + 0x18);
        let vdata = P(vb + 0x10); if (!ok(vdata)) vdata = P(vb + 0x20);
        const decl = P(vb + 0x30);
        const icount = d.readUInt32LE(ib + 0x08), idata = P(ib + 0x10);
        if (!ok(vdata) || !ok(decl) || !ok(idata) || !stride || vcount > 2e6 || icount > 6e6) continue;
        const flags = d.readUInt32LE(decl), types = d.readBigUInt64LE(decl + 8);
        // offsets of components
        let off = 0, posOff = -1, posType = 0, nrmOff = -1, nrmType = 0;
        for (let c = 0; c < 16; c++) {
          if (!((flags >>> c) & 1)) continue;
          const t = Number((types >> BigInt(c * 4)) & 0xfn);
          if (c === 0) { posOff = off; posType = t; }
          if (c === 3) { nrmOff = off; nrmType = t; }
          off += VTYPE_SIZE[t] || 0;
        }
        if (posOff < 0 || vdata + vcount * stride > d.length || idata + icount * 2 > d.length) continue;
        const pos = new Float32Array(vcount * 3), nrm = new Float32Array(vcount * 3);
        for (let v = 0; v < vcount; v++) {
          const o = vdata + v * stride;
          for (let k = 0; k < 3; k++) {
            const val = posType === 6 || posType === 7 ? d.readFloatLE(o + posOff + k * 4) : half(d.readUInt16LE(o + posOff + k * 2));
            pos[v * 3 + k] = val;
            if (isFinite(val)) { if (val < bmin[k]) bmin[k] = val; if (val > bmax[k]) bmax[k] = val; }
            if (nrmOff >= 0) nrm[v * 3 + k] = nrmType === 6 ? d.readFloatLE(o + nrmOff + k * 4) : nrmType === 10 ? 0 : half(d.readUInt16LE(o + nrmOff + k * 2));
          }
          if (nrmOff >= 0 && nrmType === 10) { const p = d.readUInt32LE(o + nrmOff); const sx = (x) => (x & 0x200 ? x - 0x400 : x) / 511; nrm[v * 3] = sx(p & 0x3ff); nrm[v * 3 + 1] = sx((p >> 10) & 0x3ff); nrm[v * 3 + 2] = sx((p >> 20) & 0x3ff); }
        }
        const idx = new Uint32Array(icount);
        for (let i = 0; i < icount; i++) { const x = d.readUInt16LE(idata + i * 2); idx[i] = x < vcount ? x : 0; }
        meshes.push({ pos: Buffer.from(pos.buffer).toString('base64'), nrm: nrmOff >= 0 ? Buffer.from(nrm.buffer).toString('base64') : null, idx: Buffer.from(idx.buffer).toString('base64'), vcount, icount });
        tri += icount / 3;
        if (meshes.length > 400) break;
      }
      void mCount;
    }
    if (meshes.length) break; // highest LOD of the first drawable is enough
  }
  if (!meshes.length) throw new Error('Geometrie konnte nicht gelesen werden');
  return { meshes, triangles: Math.round(tri), bmin, bmax };
}
function modelData(file, p) {
  const { p: rp, l } = listing(file);
  const e = l.entries.find((x) => x.path === p);
  if (!e) throw new Error('Datei nicht im Archiv');
  return parseModel(rpf.extract(rp, e));
}

async function api(route, b) {
  switch (route) {
    case 'ms/v/summary': return summary(b.file);
    case 'ms/v/textures': return modTextures(b.file);
    case 'ms/v/ytdinfo': return ytdInfo(b.file, b.path);
    case 'ms/v/texcompare': return texCompare(b.file, b.path, b.name);
    case 'ms/v/weather': return weatherData(b.file, b.path);
    case 'ms/v/weatherfind': return findIn(b.file, /(^|\/)w_[a-z_]+\.xml$/i);
    case 'ms/v/visual': return visualSettings(b.file, b.path);
    case 'ms/v/visualfind': return findIn(b.file, /visualsettings\.dat$/i);
    case 'ms/v/models': return findIn(b.file, /\.(ydr|yft|ydd)$/i);
    case 'ms/v/model': return modelData(b.file, b.path);
  }
  return undefined;
}
module.exports = { init, api, texImage, parseModel };
