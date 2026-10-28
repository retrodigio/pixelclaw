import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { expect } from 'vitest';
import { runBatch, type AssetState, type Palette, type PaletteSource } from '../src/index.ts';

/** An invented test palette. */
export const TEST_PALETTE: Palette = {
  name: 'test',
  entries: [
    { key: '0', name: 'ink', hex: '#14161c' },
    { key: '1', name: 'moss', hex: '#3f6b3a' },
    { key: '2', name: 'leaf', hex: '#7fae4c' },
    { key: '3', name: 'stone', hex: '#8a8d84' },
    { key: '4', name: 'sky', hex: '#9cc7e6' },
    { key: 'r', name: 'rust', hex: '#a4552e' },
  ],
  ramps: { green: ['moss', 'leaf'] },
};

export const palettes: PaletteSource = { get: (n) => (n === 'test' ? TEST_PALETTE : undefined), defaultName: 'test' };

export const EMPTY: AssetState = { doc: null, entries: [] };

/** Run a batch that must succeed. */
export function run(state: AssetState, text: string, by = 'test'): AssetState {
  const r = runBatch(state, text, { by, palettes });
  if (!r.ok) throw new Error(r.errors.map((e) => `${e.line}:${e.col}: ${e.message}`).join('\n'));
  return r.state;
}

const GOLDEN = join(dirname(new URL(import.meta.url).pathname), 'golden');

/** Compare bytes with a golden file; UPDATE_GOLDEN=1 rewrites it. */
export function golden(name: string, data: Uint8Array | string): void {
  const f = join(GOLDEN, name);
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
  if (process.env.UPDATE_GOLDEN || !existsSync(f)) {
    mkdirSync(GOLDEN, { recursive: true });
    writeFileSync(f, bytes);
    if (!process.env.UPDATE_GOLDEN) throw new Error(`golden ${name} was missing and has been written; check it and re-run`);
  }
  expect(Buffer.compare(bytes, readFileSync(f)), `golden ${name} differs (UPDATE_GOLDEN=1 to accept)`).toBe(0);
}

/** A minimal PNG decoder for tests (8-bit indexed or RGBA, no interlace), via node:zlib. */
export function decodePng(png: Uint8Array): { width: number; height: number; rgba: Uint8Array; colourType: number } {
  const b = Buffer.from(png);
  expect([...b.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  let o = 8;
  let width = 0, height = 0, colourType = 0;
  let plte: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o);
    const type = b.toString('latin1', o + 4, o + 8);
    const data = b.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colourType = data[9]!; }
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colourType === 6 ? 4 : 1;
  const stride = width * bpp;
  const px = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= bpp ? px[y * stride + x - bpp]! : 0;
      const up = y > 0 ? px[(y - 1) * stride + x]! : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp]! : 0;
      let p = 0;
      if (f === 1) p = a; else if (f === 2) p = up; else if (f === 3) p = (a + up) >> 1;
      else if (f === 4) { const q = a + up - c; const pa = Math.abs(q - a), pb = Math.abs(q - up), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      px[y * stride + x] = (v + p) & 255;
    }
  }
  if (colourType === 6) return { width, height, rgba: px, colourType };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const k = px[i]!;
    rgba.set([plte![k * 3]!, plte![k * 3 + 1]!, plte![k * 3 + 2]!, trns && k < trns.length ? trns[k]! : 255], i * 4);
  }
  return { width, height, rgba, colourType };
}
