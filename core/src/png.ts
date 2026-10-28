// A small PNG encoder with no dependencies: zlib (LZ77 with fixed Huffman codes), CRC-32 and
// Adler-32 written out here. Images with at most 256 distinct colours are written as indexed PNGs.
// The output depends only on the pixels, so the same image always gives the same bytes.

/** An RGBA image, 4 bytes per pixel, row-major. */
export interface Rgba {
  width: number;
  height: number;
  data: Uint8Array;
}

export function createRgba(width: number, height: number, fill = 0): Rgba {
  const data = new Uint8Array(width * height * 4);
  if (fill) for (let i = 0; i < width * height; i++) writeU32(data, i * 4, fill);
  return { width, height, data };
}

function writeU32(b: Uint8Array, o: number, v: number): void {
  b[o] = (v >>> 24) & 255;
  b[o + 1] = (v >>> 16) & 255;
  b[o + 2] = (v >>> 8) & 255;
  b[o + 3] = v & 255;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(b: Uint8Array, start = 0, end = b.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ b[i]!) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(b: Uint8Array): number {
  let a = 1;
  let s = 0;
  for (let i = 0; i < b.length; i++) {
    a = (a + b[i]!) % 65521;
    s = (s + a) % 65521;
  }
  return ((s << 16) | a) >>> 0;
}

class BitWriter {
  private buf: number[] = [];
  private acc = 0;
  private n = 0;
  /** Write the low `count` bits of v, least significant first. */
  bits(v: number, count: number): void {
    for (let i = 0; i < count; i++) {
      this.acc |= ((v >>> i) & 1) << this.n;
      if (++this.n === 8) { this.buf.push(this.acc); this.acc = 0; this.n = 0; }
    }
  }
  /** Write a Huffman code, most significant bit first. */
  code(c: number, len: number): void {
    for (let i = len - 1; i >= 0; i--) this.bits((c >>> i) & 1, 1);
  }
  finish(): Uint8Array {
    if (this.n) this.buf.push(this.acc);
    return Uint8Array.from(this.buf);
  }
}

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

function litCode(w: BitWriter, sym: number): void {
  if (sym < 144) w.code(0x30 + sym, 8);
  else if (sym < 256) w.code(0x190 + sym - 144, 9);
  else if (sym < 280) w.code(sym - 256, 7);
  else w.code(0xc0 + sym - 280, 8);
}

function lastIndexLE(table: number[], v: number): number {
  let i = table.length - 1;
  while (table[i]! > v) i--;
  return i;
}

/** Raw deflate: one final block with the fixed Huffman codes, LZ77 over a 32 KiB window. */
export function deflate(input: Uint8Array): Uint8Array {
  const w = new BitWriter();
  w.bits(1, 1); // BFINAL
  w.bits(1, 2); // BTYPE = 01, fixed codes
  const WINDOW = 32768;
  const MAX_CHAIN = 64;
  const head = new Int32Array(1 << 15).fill(-1);
  const prev = new Int32Array(input.length);
  const hash = (i: number): number => ((input[i]! << 10) ^ (input[i + 1]! << 5) ^ input[i + 2]!) & 0x7fff;
  const insert = (i: number): void => {
    if (i + 2 >= input.length) return;
    const h = hash(i);
    prev[i] = head[h]!;
    head[h] = i;
  };
  let i = 0;
  while (i < input.length) {
    let bestLen = 0;
    let bestDist = 0;
    if (i + 2 < input.length) {
      let j = head[hash(i)]!;
      let chain = 0;
      const maxLen = Math.min(258, input.length - i);
      while (j >= 0 && i - j <= WINDOW && chain++ < MAX_CHAIN) {
        let l = 0;
        while (l < maxLen && input[j + l] === input[i + l]) l++;
        if (l > bestLen) { bestLen = l; bestDist = i - j; if (l === maxLen) break; }
        j = prev[j]!;
      }
    }
    if (bestLen >= 3) {
      const li = lastIndexLE(LEN_BASE, bestLen);
      litCode(w, 257 + li);
      w.bits(bestLen - LEN_BASE[li]!, LEN_EXTRA[li]!);
      const di = lastIndexLE(DIST_BASE, bestDist);
      w.code(di, 5);
      w.bits(bestDist - DIST_BASE[di]!, DIST_EXTRA[di]!);
      for (let k = 0; k < bestLen; k++) insert(i + k);
      i += bestLen;
    } else {
      litCode(w, input[i]!);
      insert(i);
      i++;
    }
  }
  litCode(w, 256);
  return w.finish();
}

export function zlibCompress(input: Uint8Array): Uint8Array {
  const body = deflate(input);
  const out = new Uint8Array(body.length + 6);
  out[0] = 0x78;
  out[1] = 0x01;
  out.set(body, 2);
  writeU32(out, body.length + 2, adler32(input));
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  writeU32(out, 0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  writeU32(out, 8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Encode RGBA pixels as a PNG file. */
export function encodePng(img: Rgba): Uint8Array {
  const { width, height, data } = img;
  const n = width * height;
  // Count colours; at most 256 means an indexed PNG (palette in first-seen order).
  const index = new Map<number, number>();
  const colours: number[] = [];
  for (let i = 0; i < n && colours.length <= 256; i++) {
    const v = ((data[i * 4]! << 24) | (data[i * 4 + 1]! << 16) | (data[i * 4 + 2]! << 8) | data[i * 4 + 3]!) >>> 0;
    if (!index.has(v)) { index.set(v, colours.length); colours.push(v); }
  }
  const indexed = colours.length <= 256;
  const ihdr = new Uint8Array(13);
  writeU32(ihdr, 0, width);
  writeU32(ihdr, 4, height);
  ihdr[8] = 8;
  ihdr[9] = indexed ? 3 : 6;
  const parts: Uint8Array[] = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr)];
  let raw: Uint8Array;
  if (indexed) {
    const plte = new Uint8Array(colours.length * 3);
    const trns = new Uint8Array(colours.length);
    colours.forEach((v, k) => {
      plte[k * 3] = v >>> 24; plte[k * 3 + 1] = (v >>> 16) & 255; plte[k * 3 + 2] = (v >>> 8) & 255;
      trns[k] = v & 255;
    });
    parts.push(chunk('PLTE', plte));
    let lastOpaque = -1;
    trns.forEach((a, k) => { if (a !== 255) lastOpaque = k; });
    if (lastOpaque >= 0) parts.push(chunk('tRNS', trns.slice(0, lastOpaque + 1)));
    raw = new Uint8Array(height * (width + 1));
    for (let y = 0; y < height; y++) {
      raw[y * (width + 1)] = 0;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const v = ((data[i]! << 24) | (data[i + 1]! << 16) | (data[i + 2]! << 8) | data[i + 3]!) >>> 0;
        raw[y * (width + 1) + 1 + x] = index.get(v)!;
      }
    }
  } else {
    // Truecolour: pick the filter per row with the smallest sum of absolute values.
    const stride = width * 4;
    raw = new Uint8Array(height * (stride + 1));
    const cand = [0, 1, 2, 3, 4].map(() => new Uint8Array(stride));
    for (let y = 0; y < height; y++) {
      const row = y * stride;
      for (let x = 0; x < stride; x++) {
        const cur = data[row + x]!;
        const a = x >= 4 ? data[row + x - 4]! : 0;
        const b = y > 0 ? data[row - stride + x]! : 0;
        const c = x >= 4 && y > 0 ? data[row - stride + x - 4]! : 0;
        cand[0]![x] = cur;
        cand[1]![x] = (cur - a) & 255;
        cand[2]![x] = (cur - b) & 255;
        cand[3]![x] = (cur - ((a + b) >> 1)) & 255;
        cand[4]![x] = (cur - paeth(a, b, c)) & 255;
      }
      let best = 0;
      let bestSum = Infinity;
      cand.forEach((cnd, f) => {
        let s = 0;
        for (let x = 0; x < stride; x++) s += cnd[x]! < 128 ? cnd[x]! : 256 - cnd[x]!;
        if (s < bestSum) { bestSum = s; best = f; }
      });
      raw[y * (stride + 1)] = best;
      raw.set(cand[best]!, y * (stride + 1) + 1);
    }
  }
  parts.push(chunk('IDAT', zlibCompress(raw)), chunk('IEND', new Uint8Array(0)));
  return concat(parts);
}
