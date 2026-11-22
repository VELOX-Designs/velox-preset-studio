// RPF7 archive reader/writer (GTA V / FiveM). Supports unencrypted and OPEN archives.
// AES/NG (Rockstar) and CFXP (Cfx-protected) archives are detected and reported, never decrypted.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MAGIC = 0x52504637; // 'RPF7'
const ENC = { 0: 'none', 0x4e45504f: 'open', 0x0ffffff9: 'aes', 0x0fefffff: 'ng', 0x50584643: 'cfxp' };
const encName = (v) => ENC[v] || 'unknown';
const RES_EXT = new Set(['ydr', 'ydd', 'yft', 'ytd', 'ybn', 'ycd', 'ypt', 'ynd', 'ynv', 'ymap', 'ytyp', 'ymt', 'yed', 'yld', 'ypdb', 'yvr', 'ywr', 'yfd', 'ysc', 'mrf', 'cut', 'awc', 'fxc']);

function readAt(fd, pos, len) {
  const b = Buffer.alloc(len);
  let got = 0;
  while (got < len) { const n = fs.readSync(fd, b, got, len - got, pos + got); if (!n) break; got += n; }
  return got === len ? b : b.slice(0, got);
}

// size of decompressed resource data from flags (for validation)
function resSize(flags) {
  const n = (((flags >>> 27) & 0x1) << 0) + (((flags >>> 26) & 0x1) << 1) + (((flags >>> 25) & 0x1) << 2) + (((flags >>> 24) & 0x1) << 3) +
    (((flags >>> 17) & 0x7f) << 4) + (((flags >>> 11) & 0x3f) << 5) + (((flags >>> 7) & 0xf) << 6) + (((flags >>> 5) & 0x3) << 7) + (((flags >>> 4) & 0x1) << 8);
  return (0x200 << (flags & 0xf)) * n;
}
const resVersion = (sys, gfx) => (((sys >>> 28) & 0xf) << 4) | ((gfx >>> 28) & 0xf);

/**
 * Open an RPF (or nested RPF at byte offset `start`).
 * Returns { enc, readable, entries: [{ path, name, type:'dir'|'bin'|'res', size, csize, offset, sys, gfx, nested? }] }
 * Nested .rpf files are expanded recursively (their entries get path "outer.rpf/inner.rpf/…").
 */
function list(file, opts = {}) {
  const fd = typeof file === 'number' ? file : fs.openSync(file, 'r');
  try { return listAt(fd, opts.start || 0, opts.prefix || '', opts.depth || 0); }
  finally { if (typeof file !== 'number') fs.closeSync(fd); }
}
function listAt(fd, start, prefix, depth) {
  const h = readAt(fd, start, 16);
  if (h.length < 16 || h.readUInt32LE(0) !== MAGIC) throw new Error('Keine RPF7-Datei');
  const count = h.readUInt32LE(4), namesLen = h.readUInt32LE(8), encv = h.readUInt32LE(12);
  const enc = encName(encv);
  if (enc !== 'none' && enc !== 'open') return { enc, readable: false, count, entries: [] };
  const eb = readAt(fd, start + 16, count * 16);
  const nb = readAt(fd, start + 16 + count * 16, namesLen);
  const nameAt = (off) => { const e = nb.indexOf(0, off); return nb.toString('utf8', off, e < 0 ? nb.length : e); };
  const raw = [];
  for (let i = 0; i < count; i++) {
    const o = i * 16;
    const x = eb.readUInt32LE(o + 4);
    if (x === 0x7fffff00) {
      raw.push({ type: 'dir', name: nameAt(eb.readUInt32LE(o)), index: eb.readUInt32LE(o + 8), cnt: eb.readUInt32LE(o + 12) });
    } else if ((x & 0x80000000) === 0) {
      const lo = eb.readUInt32LE(o), hi = eb.readUInt32LE(o + 4);
      const nameOff = lo & 0xffff, csize = ((lo >>> 16) | ((hi & 0xff) << 16)) >>> 0, off = (hi >>> 8) & 0xffffff;
      raw.push({ type: 'bin', name: nameAt(nameOff), csize, offset: off, size: eb.readUInt32LE(o + 8), encrypted: eb.readUInt32LE(o + 12) === 1 });
    } else {
      const nameOff = eb.readUInt16LE(o);
      const csize = eb[o + 2] | (eb[o + 3] << 8) | (eb[o + 4] << 16);
      const off = (eb[o + 5] | (eb[o + 6] << 8) | (eb[o + 7] << 16)) & 0x7fffff;
      const sys = eb.readUInt32LE(o + 8), gfx = eb.readUInt32LE(o + 12);
      let real = csize, big = false;
      if (csize === 0xffffff) {
        const b = readAt(fd, start + off * 512, 16);
        real = (b[7] | (b[14] << 8) | (b[5] << 16) | (b[2] << 24)) >>> 0; big = true;
      }
      raw.push({ type: 'res', name: nameAt(nameOff), csize: real, big, offset: off, sys, gfx, size: resSize(sys) + resSize(gfx) });
    }
  }
  const out = [];
  const walk = (di, base) => {
    const d = raw[di];
    for (let i = d.index; i < d.index + d.cnt; i++) {
      const e = raw[i];
      const p = base ? base + '/' + e.name : e.name;
      if (e.type === 'dir') { out.push({ path: prefix + p, name: e.name, type: 'dir' }); walk(i, p); continue; }
      const item = { path: prefix + p, name: e.name, type: e.type, size: e.size, csize: e.csize, offset: start + e.offset * 512, sys: e.sys, gfx: e.gfx, big: e.big, encrypted: e.encrypted };
      out.push(item);
      if (e.type === 'bin' && /\.rpf$/i.test(e.name) && depth < 6) {
        try {
          const sub = listAt(fd, start + e.offset * 512, prefix + p + '/', depth + 1);
          item.nested = sub.enc;
          if (sub.readable) out.push(...sub.entries);
        } catch (err) { item.nested = 'error'; }
      }
    }
  };
  if (raw.length && raw[0].type === 'dir') walk(0, '');
  return { enc, readable: true, count, entries: out };
}

/** Extract one entry's bytes. Resources are returned as standalone files (RSC7 header + compressed data), like OpenIV/CodeWalker export. */
function extract(file, entry) {
  const fd = fs.openSync(file, 'r');
  try {
    if (entry.type === 'bin') {
      if (entry.encrypted) throw new Error('Datei ist verschlüsselt');
      if (entry.csize === 0) return readAt(fd, entry.offset, entry.size);
      const data = readAt(fd, entry.offset, entry.csize);
      try { return zlib.inflateRawSync(data); } catch { return data; }
    }
    if (entry.type === 'res') {
      let data = readAt(fd, entry.offset, entry.csize);
      // OpenIV-style archives store the RSC7 header with the data; huge entries have size bytes patched into it
      if (entry.big || (data.length >= 16 && data.readUInt32LE(0) === 0x37435352)) data = data.slice(16);
      const hdr = Buffer.alloc(16);
      hdr.writeUInt32LE(0x37435352, 0); // 'RSC7'
      hdr.writeUInt32LE(resVersion(entry.sys, entry.gfx), 4);
      hdr.writeUInt32LE(entry.sys >>> 0, 8);
      hdr.writeUInt32LE(entry.gfx >>> 0, 12);
      return Buffer.concat([hdr, data]);
    }
    throw new Error('Ordner kann nicht extrahiert werden');
  } finally { fs.closeSync(fd); }
}

/**
 * Build an OPEN RPF7 from a list of files: [{ path: 'x64/levels/a.ytd', data?: Buffer, file?: string }].
 * Resource files (.ytd/.ydr/… with RSC7 header) are stored as resources, everything else as binary (deflated).
 * Directories are created from the paths. Writes in one pass to `out`.
 */
function build(out, files, onProgress) {
  // tree
  const root = { name: '', dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.replace(/\\/g, '/').split('/').filter(Boolean);
    let d = root;
    for (const p of parts.slice(0, -1)) { const k = p.toLowerCase(); if (!d.dirs.has(k)) d.dirs.set(k, { name: p, dirs: new Map(), files: [] }); d = d.dirs.get(k); }
    const name = parts[parts.length - 1];
    const ex = d.files.findIndex((x) => x.name.toLowerCase() === name.toLowerCase());
    if (ex >= 0) d.files[ex] = { name, src: f }; else d.files.push({ name, src: f });
  }
  // flatten breadth-first: each directory's children contiguous and sorted
  const entries = [{ kind: 'dir', name: '', node: root }];
  const queue = [entries[0]];
  while (queue.length) {
    const de = queue.shift();
    const kids = [...[...de.node.dirs.values()].map((n) => ({ kind: 'dir', name: n.name, node: n })), ...de.node.files.map((f) => ({ kind: 'file', name: f.name, src: f.src }))];
    kids.sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0));
    de.index = entries.length; de.cnt = kids.length;
    for (const k of kids) { entries.push(k); if (k.kind === 'dir') queue.push(k); }
  }
  // names table
  const names = []; const nameOff = new Map(); let nlen = 0;
  for (const e of entries) {
    if (nameOff.has(e.name)) { e.nameOff = nameOff.get(e.name); continue; }
    e.nameOff = nlen; nameOff.set(e.name, nlen);
    const b = Buffer.from(e.name + '\0', 'utf8'); names.push(b); nlen += b.length;
  }
  if (nlen > 0xffff) throw new Error('Zu viele Dateinamen für eine RPF (Namenstabelle über 64 KB) – Pack aufteilen');
  const nameBuf = Buffer.alloc(Math.ceil(nlen / 16) * 16);
  Buffer.concat(names).copy(nameBuf);
  const headerLen = 16 + entries.length * 16 + nameBuf.length;
  let pos = Math.ceil(headerLen / 512) * 512; // data starts at next block
  const fd = fs.openSync(out + '.part', 'w');
  try {
    let done = 0;
    for (const e of entries) {
      if (e.kind !== 'file') continue;
      let raw;
      if (e.src.file) raw = fs.readFileSync(e.src.file); else { const d = e.src.data; raw = Buffer.isBuffer(d) ? d : Buffer.from(d); }
      let data;
      if (raw.length >= 16 && raw.readUInt32LE(0) === 0x37435352) { // RSC7 resource
        e.res = true; e.sys = raw.readUInt32LE(8); e.gfx = raw.readUInt32LE(12);
        // stored like OpenIV does: full RSC7 file; for >= 16 MB the size is patched into header bytes 2/5/7/14
        if (raw.length >= 0xffffff) {
          const len = raw.length;
          const h = Buffer.from(raw.slice(0, 16));
          h[7] = len & 0xff; h[14] = (len >>> 8) & 0xff; h[5] = (len >>> 16) & 0xff; h[2] = (len >>> 24) & 0xff;
          data = Buffer.concat([h, raw.slice(16)]); e.csize = 0xffffff;
        } else { data = raw; e.csize = raw.length; }
      } else {
        e.res = false; e.size = raw.length;
        const c = raw.length > 64 && !/\.rpf$/i.test(e.name) ? zlib.deflateRawSync(raw, { level: 6 }) : null;
        if (c && c.length < raw.length) { data = c; e.csize = c.length; } else { data = raw; e.csize = 0; }
      }
      if (pos / 512 > 0xffffff) throw new Error('RPF zu groß');
      e.block = pos / 512;
      fs.writeSync(fd, data, 0, data.length, pos);
      pos += Math.ceil(data.length / 512) * 512;
      if (onProgress) onProgress(++done, files.length);
    }
    // header + toc
    const h = Buffer.alloc(16);
    h.writeUInt32LE(MAGIC, 0); h.writeUInt32LE(entries.length, 4); h.writeUInt32LE(nameBuf.length, 8); h.writeUInt32LE(0x4e45504f, 12);
    const toc = Buffer.alloc(entries.length * 16);
    entries.forEach((e, i) => {
      const o = i * 16;
      if (e.kind === 'dir') { toc.writeUInt32LE(e.nameOff, o); toc.writeUInt32LE(0x7fffff00, o + 4); toc.writeUInt32LE(e.index, o + 8); toc.writeUInt32LE(e.cnt, o + 12); return; }
      if (e.res) {
        toc.writeUInt16LE(e.nameOff, o);
        toc[o + 2] = e.csize & 0xff; toc[o + 3] = (e.csize >>> 8) & 0xff; toc[o + 4] = (e.csize >>> 16) & 0xff;
        const off = (e.block & 0x7fffff) | 0x800000;
        toc[o + 5] = off & 0xff; toc[o + 6] = (off >>> 8) & 0xff; toc[o + 7] = (off >>> 16) & 0xff;
        toc.writeUInt32LE(e.sys >>> 0, o + 8); toc.writeUInt32LE(e.gfx >>> 0, o + 12);
      } else {
        const lo = (e.nameOff & 0xffff) | ((e.csize & 0xffff) << 16);
        const hi = ((e.csize >>> 16) & 0xff) | ((e.block & 0xffffff) << 8);
        toc.writeUInt32LE(lo >>> 0, o); toc.writeUInt32LE(hi >>> 0, o + 4); toc.writeUInt32LE(e.size, o + 8); toc.writeUInt32LE(0, o + 12);
      }
    });
    fs.writeSync(fd, Buffer.concat([h, toc, nameBuf]), 0, headerLen, 0);
    // pad file end to block size
    const st = fs.fstatSync(fd); if (st.size < pos) fs.ftruncateSync(fd, pos);
  } finally { fs.closeSync(fd); }
  fs.renameSync(out + '.part', out);
  return { entries: entries.length, size: pos };
}

const typeOf = (name) => { const m = /\.([a-z0-9]+)$/i.exec(name); return m ? m[1].toLowerCase() : ''; };
module.exports = { list, extract, build, encName, typeOf, RES_EXT, resSize };
