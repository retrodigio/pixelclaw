// Reading images back in: zlib inflate, a PNG decoder (every colour type, bit depths 1-16,
// not interlaced), and quantising RGBA to a palette: exact matches first, else the nearest colour by
// a weighted RGB distance in integers. Building a palette from an image takes its colours in the
// order they first appear (popularity when there are more than 256). No host APIs.

import { autoKeys, rgbOf, validatePalette, type Palette, type PaletteEntry, type Role } from './palette.ts';
import { TRANSPARENT } from './doc.ts';
import type { Rgba } from './png.ts';

export class DecodeError extends Error {}

// --- inflate (RFC 1950/1951)

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

interface Huff { counts: Uint16Array; symbols: Uint16Array }

function huff(lengths: ArrayLike<number>, n: number): Huff {
  const counts = new Uint16Array(16);
  for (let i = 0; i < n; i++) counts[lengths[i]!]!++;
  counts[0] = 0;
  const offs = new Uint16Array(16);
  for (let i = 1; i < 16; i++) offs[i] = offs[i - 1]! + counts[i - 1]!;
  const symbols = new Uint16Array(n);
  for (let i = 0; i < n; i++) if (lengths[i]) symbols[offs[lengths[i]!]!++] = i;
  return { counts, symbols };
}

/** Inflate a raw deflate stream. */
export function inflateRaw(src: Uint8Array, start = 0): Uint8Array {
  let pos = start, bit = 0, bits = 0;
  let out = new Uint8Array(Math.max(1024, src.length * 4));
  let o = 0;
  const need = (n: number) => {
    if (o + n <= out.length) return;
    let m = out.length * 2;
    while (m < o + n) m *= 2;
    const b = new Uint8Array(m); b.set(out.subarray(0, o)); out = b;
  };
  const get = (n: number): number => {
    while (bits < n) {
      if (pos >= src.length) throw new DecodeError('compressed data ends early');
      bit |= src[pos++]! << bits; bits += 8;
    }
    const v = bit & ((1 << n) - 1);
    bit >>>= n; bits -= n;
    return v;
  };
  const decode = (h: Huff): number => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= get(1);
      const c = h.counts[len]!;
      if (code - c < first) return h.symbols[index + (code - first)]!;
      index += c; first += c; first <<= 1; code <<= 1;
    }
    throw new DecodeError('bad compressed data (no such code)');
  };
  const fixedL = new Uint8Array(288);
  for (let i = 0; i < 288; i++) fixedL[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8;
  const fixedLit = huff(fixedL, 288);
  const fixedDist = huff(new Uint8Array(30).fill(5), 30);
  for (;;) {
    const last = get(1);
    const type = get(2);
    if (type === 0) {
      bit = 0; bits = 0;
      if (pos + 4 > src.length) throw new DecodeError('compressed data ends early');
      const len = src[pos]! | (src[pos + 1]! << 8);
      pos += 4;
      if (pos + len > src.length) throw new DecodeError('compressed data ends early');
      need(len); out.set(src.subarray(pos, pos + len), o); o += len; pos += len;
    } else if (type === 1 || type === 2) {
      let lit = fixedLit, dist = fixedDist;
      if (type === 2) {
        const nlen = get(5) + 257, ndist = get(5) + 1, ncode = get(4) + 4;
        const cl = new Uint8Array(19);
        for (let i = 0; i < ncode; i++) cl[CL_ORDER[i]!] = get(3);
        const clh = huff(cl, 19);
        const lens = new Uint8Array(nlen + ndist);
        for (let i = 0; i < nlen + ndist;) {
          const sym = decode(clh);
          if (sym < 16) lens[i++] = sym;
          else {
            let rep = 0, val = 0;
            if (sym === 16) { if (!i) throw new DecodeError('bad compressed data (repeat with nothing before)'); val = lens[i - 1]!; rep = 3 + get(2); }
            else if (sym === 17) rep = 3 + get(3);
            else rep = 11 + get(7);
            if (i + rep > nlen + ndist) throw new DecodeError('bad compressed data (too many lengths)');
            lens.fill(val, i, i + rep); i += rep;
          }
        }
        lit = huff(lens.subarray(0, nlen), nlen);
        dist = huff(lens.subarray(nlen), ndist);
      }
      for (;;) {
        const sym = decode(lit);
        if (sym < 256) { need(1); out[o++] = sym; continue; }
        if (sym === 256) break;
        const li = sym - 257;
        if (li >= 29) throw new DecodeError('bad compressed data (length code)');
        const len = LEN_BASE[li]! + get(LEN_EXTRA[li]!);
        const di = decode(dist);
        if (di >= 30) throw new DecodeError('bad compressed data (distance code)');
        const d = DIST_BASE[di]! + get(DIST_EXTRA[di]!);
        if (d > o) throw new DecodeError('bad compressed data (distance too far back)');
        need(len);
        for (let k = 0; k < len; k++, o++) out[o] = out[o - d]!;
      }
    } else throw new DecodeError('bad compressed data (block type 3)');
    if (last) return out.slice(0, o);
  }
}

/** Inflate a zlib stream (2-byte header, deflate data, Adler-32). */
export function inflate(src: Uint8Array): Uint8Array {
  if (src.length < 2 || (src[0]! & 15) !== 8 || ((src[0]! << 8) | src[1]!) % 31) throw new DecodeError('not zlib data');
  return inflateRaw(src, 2);
}

// --- PNG

const u32 = (b: Uint8Array, o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;

/** Decode a PNG file to RGBA (8 bits a channel; 16-bit channels keep their high byte). */
export function decodePng(bytes: Uint8Array): Rgba {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 8 || sig.some((v, i) => bytes[i] !== v)) throw new DecodeError('not a PNG file');
  let o = 8;
  let w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
  let plte: Uint8Array | null = null, trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (o + 8 <= bytes.length) {
    const len = u32(bytes, o);
    const type = String.fromCharCode(bytes[o + 4]!, bytes[o + 5]!, bytes[o + 6]!, bytes[o + 7]!);
    const data = bytes.subarray(o + 8, o + 8 + len);
    if (data.length < len) throw new DecodeError(`PNG chunk ${type} is cut short`);
    if (type === 'IHDR') { w = u32(data, 0); h = u32(data, 4); depth = data[8]!; ctype = data[9]!; interlace = data[12]!; }
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  if (!w || !h) throw new DecodeError('PNG has no IHDR');
  if (interlace) throw new DecodeError('interlaced PNGs are not read; save it without interlacing');
  const chans = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype as 0 | 2 | 3 | 4 | 6];
  if (!chans) throw new DecodeError(`PNG colour type ${ctype} is not known`);
  if (ctype === 3 && !plte) throw new DecodeError('indexed PNG without a palette');
  const all = new Uint8Array(idat.reduce((n, d) => n + d.length, 0));
  let k = 0;
  for (const d of idat) { all.set(d, k); k += d.length; }
  const raw = inflate(all);
  const bpp = Math.max(1, (chans * depth) >> 3);
  const stride = (w * chans * depth + 7) >> 3;
  if (raw.length < h * (stride + 1)) throw new DecodeError('PNG image data is cut short');
  const cur = new Uint8Array(stride), prev = new Uint8Array(stride);
  const out = new Uint8Array(w * h * 4);
  const sample = (row: Uint8Array, i: number): number => {
    if (depth === 8) return row[i]!;
    if (depth === 16) return row[i * 2]!;
    const per = 8 / depth;
    const byte = row[Math.floor(i / per)]!;
    const shift = 8 - depth * ((i % per) + 1);
    return (byte >> shift) & ((1 << depth) - 1);
  };
  const scale = (v: number) => (depth >= 8 ? v : Math.floor((v * 255) / ((1 << depth) - 1)));
  const tr16 = (i: number) => (trns && trns.length >= i * 2 + 2 ? (trns[i * 2]! << 8) | trns[i * 2 + 1]! : -1);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp]! : 0, b = prev[x]!, c = x >= bpp ? prev[x - bpp]! : 0;
      let v = line[x]!;
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (f !== 0) throw new DecodeError(`PNG filter ${f} is not known`);
      cur[x] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      let r: number, g: number, bl: number, al = 255;
      if (ctype === 3) {
        const i = sample(cur, x);
        r = plte![i * 3] ?? 0; g = plte![i * 3 + 1] ?? 0; bl = plte![i * 3 + 2] ?? 0;
        if (trns && i < trns.length) al = trns[i]!;
      } else if (ctype === 0 || ctype === 4) {
        const raw0 = depth === 16 ? (cur[x * chans * 2]! << 8) | cur[x * chans * 2 + 1]! : sample(cur, x * chans);
        r = g = bl = scale(sample(cur, x * chans));
        if (ctype === 4) al = sample(cur, x * chans + 1);
        else if (tr16(0) === raw0) al = 0;
      } else {
        r = sample(cur, x * chans); g = sample(cur, x * chans + 1); bl = sample(cur, x * chans + 2);
        if (ctype === 6) al = sample(cur, x * chans + 3);
        else if (trns && depth === 8 && trns[1] === r && trns[3] === g && trns[5] === bl) al = 0;
      }
      out[p] = r; out[p + 1] = g; out[p + 2] = bl; out[p + 3] = al;
    }
    prev.set(cur);
  }
  return { width: w, height: h, data: out };
}

// --- quantising

/** Alpha below this is transparent. */
export const ALPHA_CUT = 128;

/** Weighted RGB distance ("redmean"), in integers: small for colours people see as close. */
export function colourDist(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const rm = (r1 + r2) >> 1, dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return (((512 + rm) * dr * dr) >> 8) + 4 * dg * dg + (((767 - rm) * db * db) >> 8);
}

export interface Quantised {
  px: Uint16Array;
  /** Pixels whose colour was not exactly a palette colour. */
  inexact: number;
  /** The largest distance to the chosen colour (0: every pixel exact). */
  worst: number;
}

/**
 * Map RGBA pixels to palette indices. `colours` overrides the colour an entry is matched by (role
 * entries matched by their encoded colour); with two entries of one colour, the first wins.
 */
export function quantise(img: Rgba, palette: Palette, colours?: (string | null)[]): Quantised {
  const rgb = palette.entries.map((e, i) => rgbOf(colours?.[i] ?? e.hex));
  const exact = new Map<number, number>();
  rgb.forEach(([r, g, b], i) => { const k = (r << 16) | (g << 8) | b; if (!exact.has(k)) exact.set(k, i); });
  const near = new Map<number, [number, number]>();
  const px = new Uint16Array(img.width * img.height);
  let inexact = 0, worst = 0;
  for (let i = 0; i < px.length; i++) {
    const r = img.data[i * 4]!, g = img.data[i * 4 + 1]!, b = img.data[i * 4 + 2]!, a = img.data[i * 4 + 3]!;
    if (a < ALPHA_CUT) { px[i] = TRANSPARENT; continue; }
    const k = (r << 16) | (g << 8) | b;
    const e = exact.get(k);
    if (e !== undefined) { px[i] = e; continue; }
    let hit = near.get(k);
    if (!hit) {
      let best = 0, bd = Infinity;
      rgb.forEach(([R, G, B], j) => { const d = colourDist(r, g, b, R, G, B); if (d < bd) { bd = d; best = j; } });
      near.set(k, (hit = [best, bd]));
    }
    px[i] = hit[0]; inexact++; worst = Math.max(worst, hit[1]);
  }
  return { px, inexact, worst };
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

/**
 * A palette from an image's colours: every opaque colour in the order it first appears (the most
 * used ones when there are more than `max`), named c0, c1, … with keys assigned automatically.
 */
export function paletteFromImages(name: string, imgs: Rgba[], max = 256): Palette {
  const count = new Map<number, number>();
  const order: number[] = [];
  for (const img of imgs) {
    for (let i = 0; i < img.width * img.height; i++) {
      if (img.data[i * 4 + 3]! < ALPHA_CUT) continue;
      const k = (img.data[i * 4]! << 16) | (img.data[i * 4 + 1]! << 8) | img.data[i * 4 + 2]!;
      if (!count.has(k)) order.push(k);
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  let keep = order;
  if (order.length > max) {
    const top = new Set([...order].sort((a, b) => count.get(b)! - count.get(a)! || a - b).slice(0, max));
    keep = order.filter((k) => top.has(k));
  }
  const keys = autoKeys(keep.length);
  const entries: PaletteEntry[] = keep.map((k, i) => ({ key: keys[i]!, name: `c${i}`, hex: `#${hex2(k >> 16)}${hex2((k >> 8) & 255)}${hex2(k & 255)}` }));
  return validatePalette({ name, entries, ramps: {} });
}

/** The colours a palette's entries are written as: role entries through an encoding (role → hex), the rest as they are. */
export function encodedColours(palette: Palette, roles?: Partial<Record<Role, string>>): string[] {
  return palette.entries.map((e) => (e.role && roles?.[e.role] ? roles[e.role]! : e.hex));
}

/** Indices to RGBA through a list of colours (transparent stays transparent). */
export function indicesToRgba(px: Uint16Array, w: number, h: number, colours: string[]): Rgba {
  const data = new Uint8Array(w * h * 4);
  const rgb = colours.map(rgbOf);
  for (let i = 0; i < w * h; i++) {
    const v = px[i]!;
    if (v === TRANSPARENT) continue;
    const c = rgb[v]!;
    data[i * 4] = c[0]; data[i * 4 + 1] = c[1]; data[i * 4 + 2] = c[2]; data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}

/** A region of an RGBA image (pixels outside it are transparent). */
export function cropRgba(img: Rgba, x: number, y: number, w: number, h: number): Rgba {
  const data = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) {
    const sy = y + j;
    if (sy < 0 || sy >= img.height) continue;
    for (let i = 0; i < w; i++) {
      const sx = x + i;
      if (sx < 0 || sx >= img.width) continue;
      data.set(img.data.subarray((sy * img.width + sx) * 4, (sy * img.width + sx) * 4 + 4), (j * w + i) * 4);
    }
  }
  return { width: w, height: h, data };
}
