// Minimal ZIP writer/reader (store + deflate, no zip64). No dependencies.
'use strict';
const fs = require('fs');
const zlib = require('zlib');

let CRC_TABLE = null;
function crc32(buf) {
  if (zlib.crc32) return zlib.crc32(buf) >>> 0;
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

// entries: [{ name: 'a/b.txt', path?: 'C:/file', data?: Buffer|string }]
function writeZip(outFile, entries, onProgress) {
  const fd = fs.openSync(outFile + '.part', 'w');
  let offset = 0; const central = [];
  const w = (buf) => { fs.writeSync(fd, buf); offset += buf.length; };
  try {
    entries.forEach((e, i) => {
      const raw = e.data != null ? Buffer.from(e.data) : fs.readFileSync(e.path);
      const mtime = e.path ? fs.statSync(e.path).mtime : new Date();
      const comp = raw.length > 64 ? zlib.deflateRawSync(raw, { level: 6 }) : null;
      const useDeflate = comp && comp.length < raw.length;
      const body = useDeflate ? comp : raw;
      const name = Buffer.from(e.name.replace(/\\/g, '/'), 'utf8');
      const crc = crc32(raw); const { time, date } = dosTime(mtime);
      if (offset > 0xfffffff0 || body.length > 0xfffffff0) throw new Error('ZIP zu groß (über 4 GB)');
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(useDeflate ? 8 : 0, 8);
      lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18);
      lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
      const at = offset;
      w(lh); w(name); w(body);
      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(useDeflate ? 8 : 0, 10);
      ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(raw.length, 24);
      ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(at, 42);
      central.push(Buffer.concat([ch, name]));
      if (onProgress) onProgress(i + 1, entries.length);
    });
    const cdStart = offset;
    for (const c of central) w(c);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(offset - cdStart, 12); end.writeUInt32LE(cdStart, 16);
    w(end);
  } finally { fs.closeSync(fd); }
  fs.renameSync(outFile + '.part', outFile);
}

// returns [{ name, dir, size, read(): Buffer }]
function readZip(file) {
  const buf = fs.readFileSync(file);
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('Keine gültige ZIP-Datei');
  const count = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP beschädigt');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString('utf8');
    p += 46 + nl + xl + cl;
    out.push({
      name, dir: name.endsWith('/'), size,
      read() {
        const lnl = buf.readUInt16LE(lho + 26), lxl = buf.readUInt16LE(lho + 28);
        const data = buf.slice(lho + 30 + lnl + lxl, lho + 30 + lnl + lxl + csize);
        if (method === 0) return data;
        if (method === 8) return zlib.inflateRawSync(data);
        throw new Error('Nicht unterstützte ZIP-Kompression in ' + name);
      },
    });
  }
  return out;
}

// safe relative path inside a target dir (blocks ../ and absolute paths)
function safeJoin(root, rel) {
  const path = require('path');
  const clean = rel.replace(/\\/g, '/').split('/').filter((s) => s && s !== '.' && s !== '..').join(path.sep);
  if (!clean) return null;
  const full = path.join(root, clean);
  return path.resolve(full).toLowerCase().startsWith(path.resolve(root).toLowerCase() + path.sep) ? full : null;
}

module.exports = { writeZip, readZip, safeJoin, crc32 };
