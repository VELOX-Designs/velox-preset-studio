// YTD (texture dictionary, RSC7 gen8) reader/writer + BCn codecs. Pure JS, no dependencies.
// Replacing a texture keeps width/height/format/mip count, so the resource layout never changes.
'use strict';
const zlib = require('zlib');
const { resSize } = require('./rpf');

const FMT = {
  21: 'A8R8G8B8', 22: 'X8R8G8B8', 25: 'A1R5G5B5', 28: 'A8', 32: 'A8B8G8R8', 50: 'L8',
  0x31545844: 'DXT1', 0x33545844: 'DXT3', 0x35545844: 'DXT5', 0x31495441: 'ATI1', 0x32495441: 'ATI2', 0x20374342: 'BC7',
};
const BLOCK = { DXT1: 8, ATI1: 8, DXT3: 16, DXT5: 16, ATI2: 16, BC7: 16 };
const BPP = { A8R8G8B8: 4, X8R8G8B8: 4, A8B8G8R8: 4, A1R5G5B5: 2, A8: 1, L8: 1 };

function mipSize(fmt, w, h) {
  if (BLOCK[fmt]) return Math.max(1, (w + 3) >> 2) * Math.max(1, (h + 3) >> 2) * BLOCK[fmt];
  return w * h * (BPP[fmt] || 4);
}
function totalSize(fmt, w, h, levels) {
  let s = 0; for (let i = 0; i < levels; i++) s += mipSize(fmt, Math.max(1, w >> i), Math.max(1, h >> i)); return s;
}

// ------------------------------------------------------------ resource container
function openResource(buf) {
  if (buf.readUInt32LE(0) !== 0x37435352) throw new Error('Keine RSC7-Ressource');
  const version = buf.readUInt32LE(4), sys = buf.readUInt32LE(8), gfx = buf.readUInt32LE(12);
  const data = zlib.inflateRawSync(buf.slice(16));
  const sysSize = resSize(sys);
  return { version, sys, gfx, data, sysSize, gfxSize: data.length - sysSize };
}
function saveResource(r) {
  const h = Buffer.alloc(16);
  h.writeUInt32LE(0x37435352, 0); h.writeUInt32LE(r.version, 4); h.writeUInt32LE(r.sys >>> 0, 8); h.writeUInt32LE(r.gfx >>> 0, 12);
  return Buffer.concat([h, zlib.deflateRawSync(r.data, { level: 9 })]);
}
function ptr(r, lo, hi) { // 64-bit resource pointer -> absolute offset in r.data (0x5… system, 0x6… graphics)
  if (hi !== 0) return -1;
  const kind = lo >>> 28, off = lo & 0x0fffffff;
  if (kind === 5) return off;
  if (kind === 6) return r.sysSize + off;
  return -1;
}
const read64 = (r, o) => ptr(r, r.data.readUInt32LE(o), r.data.readUInt32LE(o + 4));
function cstr(r, o) { const e = r.data.indexOf(0, o); return r.data.toString('latin1', o, e < 0 ? r.data.length : e); }

// ------------------------------------------------------------ YTD
function parseYtd(buf) {
  const r = openResource(buf);
  const d = r.data;
  const listPtr = read64(r, 0x30), count = d.readUInt16LE(0x38);
  if (listPtr < 0 || count > 10000) throw new Error('Kein gültiges Texture-Dictionary');
  const textures = [];
  for (let i = 0; i < count; i++) {
    const t = read64(r, listPtr + i * 8);
    if (t < 0) continue;
    const nameP = read64(r, t + 0x28);
    const fcode = d.readUInt32LE(t + 0x58);
    const fmt = FMT[fcode] || ('0x' + fcode.toString(16));
    const w = d.readUInt16LE(t + 0x50), hgt = d.readUInt16LE(t + 0x52), depth = d.readUInt16LE(t + 0x54);
    const levels = d[t + 0x5d];
    const dataP = read64(r, t + 0x70);
    textures.push({ index: i, offset: t, name: nameP >= 0 ? cstr(r, nameP) : 'tex' + i, width: w, height: hgt, depth, stride: d.readUInt16LE(t + 0x56), format: fmt, fcode, levels, dataOffset: dataP, dataSize: totalSize(fmt, w, hgt, levels), supported: !!(BLOCK[fmt] || BPP[fmt]) });
  }
  return { res: r, textures };
}
function textureData(y, t, level = 0) {
  let off = t.dataOffset;
  for (let i = 0; i < level; i++) off += mipSize(t.format, Math.max(1, t.width >> i), Math.max(1, t.height >> i));
  const w = Math.max(1, t.width >> level), h = Math.max(1, t.height >> level);
  return { w, h, data: y.res.data.slice(off, off + mipSize(t.format, w, h)) };
}

// ------------------------------------------------------------ decoders -> RGBA
function c565(v) { return [((v >> 11) & 31) * 255 / 31 | 0, ((v >> 5) & 63) * 255 / 63 | 0, (v & 31) * 255 / 31 | 0]; }
function decodeColorBlock(src, o, out, w, x0, y0, h, dxt1) {
  const c0 = src.readUInt16LE(o), c1 = src.readUInt16LE(o + 2);
  const a = c565(c0), b = c565(c1);
  const pal = [a.concat(255), b.concat(255)];
  if (c0 > c1 || !dxt1) { pal.push([0, 1, 2].map((k) => (2 * a[k] + b[k]) / 3 | 0).concat(255)); pal.push([0, 1, 2].map((k) => (a[k] + 2 * b[k]) / 3 | 0).concat(255)); }
  else { pal.push([0, 1, 2].map((k) => (a[k] + b[k]) / 2 | 0).concat(255)); pal.push([0, 0, 0, 0]); }
  const bits = src.readUInt32LE(o + 4);
  for (let i = 0; i < 16; i++) {
    const x = x0 + (i & 3), y = y0 + (i >> 2); if (x >= w || y >= h) continue;
    const p = pal[(bits >>> (i * 2)) & 3], q = (y * w + x) * 4;
    out[q] = p[0]; out[q + 1] = p[1]; out[q + 2] = p[2]; if (dxt1) out[q + 3] = p[3];
  }
}
function decodeAlphaBC4(src, o) {
  const a0 = src[o], a1 = src[o + 1];
  const pal = [a0, a1];
  if (a0 > a1) for (let i = 1; i < 7; i++) pal.push(((7 - i) * a0 + i * a1) / 7 | 0);
  else { for (let i = 1; i < 5; i++) pal.push(((5 - i) * a0 + i * a1) / 5 | 0); pal.push(0, 255); }
  const lo = src.readUInt32LE(o + 2), hi = src.readUInt16LE(o + 6);
  const res = new Array(16);
  for (let i = 0; i < 16; i++) {
    const bit = i * 3; let v;
    if (bit + 3 <= 32) v = (lo >>> bit) & 7; else if (bit >= 32) v = (hi >>> (bit - 32)) & 7; else v = ((lo >>> bit) | (hi << (32 - bit))) & 7;
    res[i] = pal[v];
  }
  return res;
}
// ---- BC7 decoder (all modes)
const BC7_P2 = [0xcccc, 0x8888, 0xeeee, 0xecc8, 0xc880, 0xfeec, 0xfec8, 0xec80, 0xc800, 0xffec, 0xfe80, 0xe800, 0xffe8, 0xff00, 0xfff0, 0xf000, 0xf710, 0x008e, 0x7100, 0x08ce, 0x008c, 0x7310, 0x3100, 0x8cce, 0x088c, 0x3110, 0x6666, 0x366c, 0x17e8, 0x0ff0, 0x718e, 0x399c, 0xaaaa, 0xf0f0, 0x5a5a, 0x33cc, 0x3c3c, 0x55aa, 0x9696, 0xa55a, 0x73ce, 0x13c8, 0x324c, 0x3bdc, 0x6996, 0xc33c, 0x9966, 0x0660, 0x0272, 0x04e4, 0x4e40, 0x2720, 0xc936, 0x936c, 0x39c6, 0x639c, 0x9336, 0x9cc6, 0x817e, 0xe718, 0xccf0, 0x0fcc, 0x7744, 0xee22];
const BC7_P3 = ['0011001102210222', '0001001122112221', '0000200122112211', '0222002200110111', '0000000011221122', '0011001100220022', '0022002211111111', '0011001122112211', '0000000011112222', '0000111111112222', '0000111122222222', '0012001200120012', '0112011201120112', '0122012201220122', '0011011211221222', '0011200122002220', '0001001101121122', '0111001120012200', '0000112211221122', '0022002200220111', '0111011102220222', '0001000122212221', '0000001101220122', '0000110022102210', '0122012200110000', '0012001211222222', '0110122112210110', '0000011012211221', '0022110211020022', '0110011020022222', '0011012201220011', '0000200022112221', '0000000221112221', '0222002200120011', '0011001200220222', '0120012001200120', '0000111122220000', '0120120120120120', '0120201212010120', '0011220011220011', '0011112222000011', '0101010122222222', '0000000021212121', '0022112200221122', '0022001100220011', '0220122102201221', '0101222222220101', '0000212121212121', '0101010101012222', '0222011102220111', '0002111200021112', '0000211221122112', '0222011101110222', '0002111211121112', '0110011001100222', '0000000021122112', '0110011022222222', '0022001100110022', '0022112211220022', '0000000000002112', '0002000100020001', '0222122202221222', '0101222222222222', '0111201122012220'].map((s) => [...s].map(Number));
const BC7_A2 = [15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 2, 8, 2, 2, 8, 8, 15, 2, 8, 2, 2, 8, 8, 2, 2, 15, 15, 6, 8, 2, 8, 15, 15, 2, 8, 2, 2, 2, 15, 15, 6, 6, 2, 6, 8, 15, 15, 2, 2, 15, 15, 15, 15, 15, 2, 2, 15];
const BC7_A3a = [3, 3, 15, 15, 8, 3, 15, 15, 8, 8, 6, 6, 6, 5, 3, 3, 3, 3, 8, 15, 3, 3, 6, 10, 5, 8, 8, 6, 8, 5, 15, 15, 8, 15, 3, 5, 6, 10, 8, 15, 15, 3, 15, 5, 15, 15, 15, 15, 3, 15, 5, 5, 5, 8, 5, 10, 5, 10, 8, 13, 15, 12, 3, 3];
const BC7_A3b = [15, 8, 8, 3, 15, 15, 3, 8, 15, 15, 15, 15, 15, 15, 15, 8, 15, 8, 15, 3, 15, 8, 15, 8, 3, 15, 6, 10, 15, 15, 10, 8, 15, 3, 15, 10, 10, 8, 9, 10, 6, 15, 8, 15, 3, 6, 6, 8, 15, 3, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 3, 15, 15, 8];
const W2 = [0, 21, 43, 64], W3 = [0, 9, 18, 27, 37, 46, 55, 64], W4 = [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64];
const MODES = [
  { ns: 3, pb: 4, rb: 0, isb: 0, cb: 4, ab: 0, epb: 1, spb: 0, ib: 3, ib2: 0 },
  { ns: 2, pb: 6, rb: 0, isb: 0, cb: 6, ab: 0, epb: 0, spb: 1, ib: 3, ib2: 0 },
  { ns: 3, pb: 6, rb: 0, isb: 0, cb: 5, ab: 0, epb: 0, spb: 0, ib: 2, ib2: 0 },
  { ns: 2, pb: 6, rb: 0, isb: 0, cb: 7, ab: 0, epb: 1, spb: 0, ib: 2, ib2: 0 },
  { ns: 1, pb: 0, rb: 2, isb: 1, cb: 5, ab: 6, epb: 0, spb: 0, ib: 2, ib2: 3 },
  { ns: 1, pb: 0, rb: 2, isb: 0, cb: 7, ab: 8, epb: 0, spb: 0, ib: 2, ib2: 2 },
  { ns: 1, pb: 0, rb: 0, isb: 0, cb: 7, ab: 7, epb: 1, spb: 0, ib: 4, ib2: 0 },
  { ns: 2, pb: 6, rb: 0, isb: 0, cb: 5, ab: 5, epb: 1, spb: 0, ib: 2, ib2: 0 },
];
function decodeBC7Block(src, o, out, w, x0, y0, h) {
  let pos = 0;
  const bit = () => { const v = (src[o + (pos >> 3)] >> (pos & 7)) & 1; pos++; return v; };
  const bits = (n) => { let v = 0; for (let i = 0; i < n; i++) v |= bit() << i; return v; };
  let mode = 0; while (mode < 8 && !bit()) mode++;
  const put = (i, r, g, b, a) => { const x = x0 + (i & 3), y = y0 + (i >> 2); if (x < w && y < h) { const q = (y * w + x) * 4; out[q] = r; out[q + 1] = g; out[q + 2] = b; out[q + 3] = a; } };
  if (mode === 8) { for (let i = 0; i < 16; i++) put(i, 0, 0, 0, 0); return; }
  const M = MODES[mode];
  const part = bits(M.pb), rot = bits(M.rb), isel = bits(M.isb);
  const ne = M.ns * 2;
  const ep = Array.from({ length: ne }, () => [0, 0, 0, 255]);
  for (let c = 0; c < 3; c++) for (let e = 0; e < ne; e++) ep[e][c] = bits(M.cb);
  if (M.ab) for (let e = 0; e < ne; e++) ep[e][3] = bits(M.ab);
  let cb = M.cb, ab = M.ab;
  if (M.epb) { for (let e = 0; e < ne; e++) { const p = bit(); for (let c = 0; c < 4; c++) ep[e][c] = (ep[e][c] << 1) | p; } cb++; if (ab) ab++; }
  if (M.spb) { for (let s = 0; s < M.ns; s++) { const p = bit(); for (const e of [s * 2, s * 2 + 1]) for (let c = 0; c < 4; c++) ep[e][c] = (ep[e][c] << 1) | p; } cb++; if (ab) ab++; }
  const exp = (v, n) => { v <<= 8 - n; return v | (v >> n); };
  for (const e of ep) { for (let c = 0; c < 3; c++) e[c] = exp(e[c], cb); e[3] = ab ? exp(e[3], ab) : 255; }
  const subset = (i) => M.ns === 1 ? 0 : M.ns === 2 ? (BC7_P2[part] >> i) & 1 : BC7_P3[part][i];
  const anchor = (s) => s === 0 ? 0 : M.ns === 2 ? BC7_A2[part] : s === 1 ? BC7_A3a[part] : BC7_A3b[part];
  const idx1 = [], idx2 = [];
  for (let i = 0; i < 16; i++) { const s = subset(i); const isA = i === anchor(s); idx1.push(bits(M.ib - (isA ? 1 : 0))); }
  if (M.ib2) for (let i = 0; i < 16; i++) idx2.push(bits(M.ib2 - (i === 0 ? 1 : 0)));
  const wt = (n) => (n === 2 ? W2 : n === 3 ? W3 : W4);
  for (let i = 0; i < 16; i++) {
    const s = subset(i), e0 = ep[s * 2], e1 = ep[s * 2 + 1];
    let ci = idx1[i], ai = idx1[i], cn = M.ib, an = M.ib;
    if (M.ib2) { if (isel) { ci = idx2[i]; cn = M.ib2; } else { ai = idx2[i]; an = M.ib2; } }
    const cw = wt(cn)[ci], aw = wt(an)[ai];
    const px = [0, 1, 2].map((c) => ((64 - cw) * e0[c] + cw * e1[c] + 32) >> 6);
    let a = ((64 - aw) * e0[3] + aw * e1[3] + 32) >> 6;
    if (rot === 1) [px[0], a] = [a, px[0]]; else if (rot === 2) [px[1], a] = [a, px[1]]; else if (rot === 3) [px[2], a] = [a, px[2]];
    put(i, px[0], px[1], px[2], a);
  }
}
function decode(fmt, w, h, src) {
  const out = Buffer.alloc(w * h * 4, 255);
  const bw = Math.max(1, (w + 3) >> 2), bh = Math.max(1, (h + 3) >> 2);
  if (BLOCK[fmt]) {
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      const o = (by * bw + bx) * BLOCK[fmt], x0 = bx * 4, y0 = by * 4;
      if (fmt === 'DXT1') decodeColorBlock(src, o, out, w, x0, y0, h, true);
      else if (fmt === 'DXT3') {
        decodeColorBlock(src, o + 8, out, w, x0, y0, h, false);
        for (let i = 0; i < 16; i++) { const x = x0 + (i & 3), y = y0 + (i >> 2); if (x < w && y < h) out[(y * w + x) * 4 + 3] = ((src[o + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17; }
      } else if (fmt === 'DXT5') {
        decodeColorBlock(src, o + 8, out, w, x0, y0, h, false);
        const a = decodeAlphaBC4(src, o);
        for (let i = 0; i < 16; i++) { const x = x0 + (i & 3), y = y0 + (i >> 2); if (x < w && y < h) out[(y * w + x) * 4 + 3] = a[i]; }
      } else if (fmt === 'ATI1') {
        const a = decodeAlphaBC4(src, o);
        for (let i = 0; i < 16; i++) { const x = x0 + (i & 3), y = y0 + (i >> 2); if (x < w && y < h) { const q = (y * w + x) * 4; out[q] = out[q + 1] = out[q + 2] = a[i]; } }
      } else if (fmt === 'ATI2') {
        const r = decodeAlphaBC4(src, o), g = decodeAlphaBC4(src, o + 8);
        for (let i = 0; i < 16; i++) { const x = x0 + (i & 3), y = y0 + (i >> 2); if (x < w && y < h) { const q = (y * w + x) * 4; out[q] = r[i]; out[q + 1] = g[i]; out[q + 2] = 255; } }
      } else if (fmt === 'BC7') decodeBC7Block(src, o, out, w, x0, y0, h);
    }
    return out;
  }
  for (let i = 0; i < w * h; i++) {
    const q = i * 4;
    if (fmt === 'A8R8G8B8' || fmt === 'X8R8G8B8') { out[q] = src[i * 4 + 2]; out[q + 1] = src[i * 4 + 1]; out[q + 2] = src[i * 4]; out[q + 3] = fmt[0] === 'X' ? 255 : src[i * 4 + 3]; }
    else if (fmt === 'A8B8G8R8') { out[q] = src[i * 4]; out[q + 1] = src[i * 4 + 1]; out[q + 2] = src[i * 4 + 2]; out[q + 3] = src[i * 4 + 3]; }
    else if (fmt === 'L8') { out[q] = out[q + 1] = out[q + 2] = src[i]; }
    else if (fmt === 'A8') { out[q] = out[q + 1] = out[q + 2] = 255; out[q + 3] = src[i]; }
    else if (fmt === 'A1R5G5B5') { const v = src.readUInt16LE(i * 2); out[q] = ((v >> 10) & 31) * 255 / 31 | 0; out[q + 1] = ((v >> 5) & 31) * 255 / 31 | 0; out[q + 2] = (v & 31) * 255 / 31 | 0; out[q + 3] = v & 0x8000 ? 255 : 0; }
  }
  return out;
}

// ------------------------------------------------------------ encoders (RGBA -> format)
function blockPixels(rgba, w, h, x0, y0) {
  const px = [];
  for (let i = 0; i < 16; i++) { const x = Math.min(w - 1, x0 + (i & 3)), y = Math.min(h - 1, y0 + (i >> 2)); const q = (y * w + x) * 4; px.push([rgba[q], rgba[q + 1], rgba[q + 2], rgba[q + 3]]); }
  return px;
}
function axisFit(px, ch) { // principal-axis endpoints over channels ch
  const n = px.length, mean = ch.map((c) => px.reduce((s, p) => s + p[c], 0) / n);
  let ax = ch.map(() => 0);
  const cov = ch.map((a) => ch.map((b) => px.reduce((s, p) => s + (p[a] - mean[ch.indexOf(a)]) * (p[b] - mean[ch.indexOf(b)]), 0)));
  ax = ch.map(() => 1);
  for (let it = 0; it < 6; it++) { const nx = cov.map((row) => row.reduce((s, v, j) => s + v * ax[j], 0)); const l = Math.hypot(...nx) || 1; ax = nx.map((v) => v / l); }
  let mn = Infinity, mx = -Infinity;
  for (const p of px) { const t = ch.reduce((s, c, j) => s + (p[c] - mean[j]) * ax[j], 0); mn = Math.min(mn, t); mx = Math.max(mx, t); }
  const clamp = (v) => Math.max(0, Math.min(255, v));
  return [ch.map((c, j) => clamp(mean[j] + ax[j] * mn)), ch.map((c, j) => clamp(mean[j] + ax[j] * mx))];
}
const to565 = (c) => ((Math.round(c[0] * 31 / 255) << 11) | (Math.round(c[1] * 63 / 255) << 5) | Math.round(c[2] * 31 / 255));
function encodeColor(px, out, o) {
  let [a, b] = axisFit(px, [0, 1, 2]);
  let c0 = to565(b), c1 = to565(a);
  if (c0 < c1) { [c0, c1] = [c1, c0]; }
  if (c0 === c1) { out.writeUInt16LE(c0, o); out.writeUInt16LE(c1, o + 2); out.writeUInt32LE(0, o + 4); return; }
  const p0 = c565(c0), p1 = c565(c1);
  const pal = [p0, p1, [0, 1, 2].map((k) => (2 * p0[k] + p1[k]) / 3), [0, 1, 2].map((k) => (p0[k] + 2 * p1[k]) / 3)];
  let bits = 0;
  px.forEach((p, i) => { let best = 0, bd = Infinity; pal.forEach((q, j) => { const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2; if (d < bd) { bd = d; best = j; } }); bits |= best << (i * 2); });
  out.writeUInt16LE(c0, o); out.writeUInt16LE(c1, o + 2); out.writeUInt32LE(bits >>> 0, o + 4);
}
function encodeBC4(vals, out, o) {
  let mn = Math.min(...vals), mx = Math.max(...vals);
  out[o] = mx; out[o + 1] = mn;
  const pal = [mx, mn]; for (let i = 1; i < 7; i++) pal.push(((7 - i) * mx + i * mn) / 7);
  let lo = 0, hi = 0;
  vals.forEach((v, i) => {
    let best = 0, bd = Infinity; if (mx !== mn) pal.forEach((q, j) => { const d = Math.abs(v - q); if (d < bd) { bd = d; best = j; } });
    const bit = i * 3;
    if (bit + 3 <= 32) lo |= best << bit; else if (bit >= 32) hi |= best << (bit - 32); else { lo |= best << bit; hi |= best >> (32 - bit); }
  });
  out.writeUInt32LE(lo >>> 0, o + 2); out.writeUInt16LE(hi & 0xffff, o + 6);
}
function encodeBC7Mode6(px, out, o) {
  // mode 6: one subset, RGBA 7 bits + p-bit, 4-bit indices
  let [a, b] = axisFit(px, [0, 1, 2, 3]);
  const q = (e) => { // quantize to 7 bits + shared p-bit, choose best p
    let best = null;
    for (const p of [0, 1]) { const v = e.map((c) => Math.max(0, Math.min(127, Math.round((c - p) / 2)))); const r = v.map((x) => (x << 1) | p); const err = r.reduce((s, x, i) => s + (x - e[i]) ** 2, 0); if (!best || err < best.err) best = { v, p, r, err }; }
    return best;
  };
  let e0 = q(a), e1 = q(b);
  const lerp = (wt) => e0.r.map((c, i) => ((64 - wt) * c + wt * e1.r[i] + 32) >> 6);
  const pal = W4.map(lerp);
  const idx = px.map((p) => { let best = 0, bd = Infinity; pal.forEach((c, j) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2 + (p[3] - c[3]) ** 2; if (d < bd) { bd = d; best = j; } }); return best; });
  if (idx[0] & 8) { [e0, e1] = [e1, e0]; for (let i = 0; i < 16; i++) idx[i] = 15 - idx[i]; }
  out.fill(0, o, o + 16);
  let pos = 0;
  const put = (v, n) => { for (let i = 0; i < n; i++) { if ((v >> i) & 1) out[o + (pos >> 3)] |= 1 << (pos & 7); pos++; } };
  put(1 << 6, 7); // mode 6 = six zeros then a one
  for (let c = 0; c < 4; c++) { put(e0.v[c], 7); put(e1.v[c], 7); }
  put(e0.p, 1); put(e1.p, 1);
  for (let i = 0; i < 16; i++) put(idx[i], i === 0 ? 3 : 4);
}
function encode(fmt, w, h, rgba) {
  if (BLOCK[fmt]) {
    const bw = Math.max(1, (w + 3) >> 2), bh = Math.max(1, (h + 3) >> 2), bs = BLOCK[fmt];
    const out = Buffer.alloc(bw * bh * bs);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      const o = (by * bw + bx) * bs; const px = blockPixels(rgba, w, h, bx * 4, by * 4);
      if (fmt === 'DXT1') encodeColor(px, out, o);
      else if (fmt === 'DXT3') { for (let i = 0; i < 16; i += 2) out[o + (i >> 1)] = (Math.round(px[i][3] / 17)) | (Math.round(px[i + 1][3] / 17) << 4); encodeColor(px, out, o + 8); }
      else if (fmt === 'DXT5') { encodeBC4(px.map((p) => p[3]), out, o); encodeColor(px, out, o + 8); }
      else if (fmt === 'ATI1') encodeBC4(px.map((p) => p[0]), out, o);
      else if (fmt === 'ATI2') { encodeBC4(px.map((p) => p[0]), out, o); encodeBC4(px.map((p) => p[1]), out, o + 8); }
      else if (fmt === 'BC7') encodeBC7Mode6(px, out, o);
    }
    return out;
  }
  const bpp = BPP[fmt]; const out = Buffer.alloc(w * h * bpp);
  for (let i = 0; i < w * h; i++) {
    const q = i * 4;
    if (fmt === 'A8R8G8B8' || fmt === 'X8R8G8B8') { out[i * 4] = rgba[q + 2]; out[i * 4 + 1] = rgba[q + 1]; out[i * 4 + 2] = rgba[q]; out[i * 4 + 3] = fmt[0] === 'X' ? 255 : rgba[q + 3]; }
    else if (fmt === 'A8B8G8R8') rgba.copy(out, i * 4, q, q + 4);
    else if (fmt === 'L8') out[i] = (rgba[q] * 0.299 + rgba[q + 1] * 0.587 + rgba[q + 2] * 0.114) | 0;
    else if (fmt === 'A8') out[i] = rgba[q + 3];
    else if (fmt === 'A1R5G5B5') out.writeUInt16LE(((rgba[q + 3] > 127) << 15) | ((rgba[q] >> 3) << 10) | ((rgba[q + 1] >> 3) << 5) | (rgba[q + 2] >> 3), i * 2);
  }
  return out;
}

// box downscale for mips
function half(rgba, w, h) {
  const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1), out = Buffer.alloc(nw * nh * 4);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let c = 0; c < 4; c++) {
    let s = 0, n = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const sx = Math.min(w - 1, x * 2 + dx), sy = Math.min(h - 1, y * 2 + dy); s += rgba[(sy * w + sx) * 4 + c]; n++; }
    out[(y * nw + x) * 4 + c] = Math.round(s / n);
  }
  return { rgba: out, w: nw, h: nh };
}

/** Replace texture pixels (rgba must already be t.width x t.height). Keeps the layout identical. */
function replaceTexture(y, t, rgba) {
  let cur = { rgba, w: t.width, h: t.height }; let off = t.dataOffset;
  for (let l = 0; l < t.levels; l++) {
    const enc = encode(t.format, cur.w, cur.h, cur.rgba);
    enc.copy(y.res.data, off);
    off += enc.length;
    if (l < t.levels - 1) cur = half(cur.rgba, cur.w, cur.h);
  }
}

// ------------------------------------------------------------ DDS
const DDS_FOURCC = { DXT1: 'DXT1', DXT3: 'DXT3', DXT5: 'DXT5', ATI1: 'ATI1', ATI2: 'ATI2' };
function toDDS(t, data) {
  const dx10 = t.format === 'BC7';
  const h = Buffer.alloc(128 + (dx10 ? 20 : 0));
  h.write('DDS ', 0, 'ascii'); h.writeUInt32LE(124, 4);
  h.writeUInt32LE(0x1 | 0x2 | 0x4 | 0x1000 | 0x20000 | 0x80000, 8);
  h.writeUInt32LE(t.height, 12); h.writeUInt32LE(t.width, 16); h.writeUInt32LE(mipSize(t.format, t.width, t.height), 20);
  h.writeUInt32LE(1, 24); h.writeUInt32LE(t.levels, 28);
  h.writeUInt32LE(32, 76);
  if (BLOCK[t.format]) { h.writeUInt32LE(0x4, 80); h.write(dx10 ? 'DX10' : DDS_FOURCC[t.format], 84, 'ascii'); }
  else {
    const fmt = t.format;
    if (fmt === 'L8') { h.writeUInt32LE(0x20000, 80); h.writeUInt32LE(8, 88); h.writeUInt32LE(0xff, 92); }
    else if (fmt === 'A8') { h.writeUInt32LE(0x2, 80); h.writeUInt32LE(8, 88); h.writeUInt32LE(0xff, 104); }
    else { h.writeUInt32LE(0x41, 80); h.writeUInt32LE(32, 88); h.writeUInt32LE(fmt === 'A8B8G8R8' ? 0xff : 0xff0000, 92); h.writeUInt32LE(0xff00, 96); h.writeUInt32LE(fmt === 'A8B8G8R8' ? 0xff0000 : 0xff, 100); h.writeUInt32LE(0xff000000, 104); }
  }
  h.writeUInt32LE(0x1000 | 0x400000 | 0x8, 108);
  if (dx10) { h.writeUInt32LE(98, 128); h.writeUInt32LE(3, 132); h.writeUInt32LE(0, 136); h.writeUInt32LE(1, 140); h.writeUInt32LE(0, 144); }
  return Buffer.concat([h, data]);
}
function fromDDS(buf) { // returns { w, h, fmt, levels, data } (data = all mips)
  if (buf.toString('ascii', 0, 4) !== 'DDS ') throw new Error('Keine DDS-Datei');
  const h = buf.readUInt32LE(12), w = buf.readUInt32LE(16), levels = Math.max(1, buf.readUInt32LE(28));
  const pfFlags = buf.readUInt32LE(80), four = buf.toString('ascii', 84, 88);
  let fmt = null, off = 128;
  if (pfFlags & 4) {
    if (four === 'DX10') { const dxgi = buf.readUInt32LE(128); off = 148; fmt = { 71: 'DXT1', 74: 'DXT3', 77: 'DXT5', 80: 'ATI1', 83: 'ATI2', 98: 'BC7', 99: 'BC7' }[dxgi]; }
    else fmt = { DXT1: 'DXT1', DXT3: 'DXT3', DXT5: 'DXT5', ATI1: 'ATI1', BC4U: 'ATI1', ATI2: 'ATI2', BC5U: 'ATI2' }[four];
  } else {
    const bits = buf.readUInt32LE(88), rm = buf.readUInt32LE(92);
    fmt = bits === 32 ? (rm === 0xff ? 'A8B8G8R8' : 'A8R8G8B8') : bits === 8 ? (pfFlags & 0x2 ? 'A8' : 'L8') : null;
  }
  if (!fmt) throw new Error('DDS-Format wird nicht unterstützt');
  return { w, h, fmt, levels, data: buf.slice(off) };
}

module.exports = { parseYtd, textureData, decode, encode, replaceTexture, saveResource, toDDS, fromDDS, mipSize, totalSize, half };
