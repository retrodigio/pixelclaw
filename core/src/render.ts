// Renders of a document: the flat image at 1x, the scaled view with pixel grid and rulers, the
// text index grid, and the tile 3x3 preview. All RGBA images go through encodePng.

import { TRANSPARENT, flatten, type Doc } from './doc.ts';
import { rgbOf } from './palette.ts';
import { createRgba, type Rgba } from './png.ts';
import { indexOf } from './raster.ts';

type RGB = [number, number, number];

const RULER_BG: RGB = [30, 31, 36];
const RULER_TICK: RGB = [120, 126, 136];
const RULER_TEXT: RGB = [216, 219, 224];
const CHECK_A: RGB = [204, 204, 204];
const CHECK_B: RGB = [238, 238, 238];
const CELL_LINE: RGB = [255, 79, 216];

// 3x5 digits, rows top to bottom, 3 bits each (MSB = left).
const DIGITS: number[][] = [
  [7, 5, 5, 5, 7], [2, 6, 2, 2, 7], [7, 1, 7, 4, 7], [7, 1, 7, 1, 7], [5, 5, 7, 1, 1],
  [7, 4, 7, 1, 7], [7, 4, 7, 5, 7], [7, 1, 1, 1, 1], [7, 5, 7, 5, 7], [7, 5, 7, 1, 7],
];

function put(img: Rgba, x: number, y: number, c: RGB, a = 255): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const o = (y * img.width + x) * 4;
  img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = a;
}

function rect(img: Rgba, x: number, y: number, w: number, h: number, c: RGB): void {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(img, x + i, y + j, c);
}

/** Blend the pixel at x,y toward black (on light pixels) or white (on dark ones); alpha in 1/256. */
function shade(img: Rgba, x: number, y: number, alpha: number): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const o = (y * img.width + x) * 4;
  const d = img.data;
  const lum = (d[o]! * 77 + d[o + 1]! * 150 + d[o + 2]! * 29) >> 8;
  const k = lum > 100 ? 0 : 255;
  for (let ch = 0; ch < 3; ch++) d[o + ch] = (d[o + ch]! * (256 - alpha) + k * alpha) >> 8;
}

function tint(img: Rgba, x: number, y: number, c: RGB, alpha: number): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const o = (y * img.width + x) * 4;
  for (let ch = 0; ch < 3; ch++) img.data[o + ch] = (img.data[o + ch]! * (256 - alpha) + c[ch]! * alpha) >> 8;
}

function text(img: Rgba, x: number, y: number, s: string, c: RGB, scale: number): void {
  for (const ch of s) {
    const g = DIGITS[ch.charCodeAt(0) - 48];
    if (g) g.forEach((bits, row) => {
      for (let col = 0; col < 3; col++) if (bits & (4 >> col)) rect(img, x + col * scale, y + row * scale, scale, scale, c);
    });
    x += 4 * scale;
  }
}

const textWidth = (s: string, scale: number): number => s.length * 4 * scale - scale;

function colourTable(doc: Doc): RGB[] {
  return doc.palette.entries.map((e) => rgbOf(e.hex));
}

/** The flat document at 1x: palette colours, transparent pixels with alpha 0. */
export function renderFlat(doc: Doc, frame = 0): Rgba {
  const px = flatten(doc, frame);
  const pal = colourTable(doc);
  const img = createRgba(doc.width, doc.height);
  for (let i = 0; i < px.length; i++) {
    if (px[i] === TRANSPARENT) continue;
    const c = pal[px[i]!]!;
    img.data.set([c[0], c[1], c[2], 255], i * 4);
  }
  return img;
}

/** The default scale for the render view: about 192 px on the long side (8x for a 24 px tile). */
export function defaultScale(doc: Doc): number {
  return Math.max(1, Math.min(16, Math.floor(192 / Math.max(doc.width, doc.height))));
}

export interface ScaledOptions {
  scale?: number;
  grid?: boolean;
  rulers?: boolean;
}

/**
 * Nearest-neighbour at an integer scale. A faint pixel grid (from 4x up), stronger lines every 8
 * pixels, magenta cell boundaries on sheets, and rulers labelled every 8 pixels. Transparent
 * pixels show as a grey checkerboard.
 */
export function renderScaled(doc: Doc, o: ScaledOptions = {}): Rgba {
  const s = o.scale ?? defaultScale(doc);
  const grid = (o.grid ?? true) && s >= 4;
  const rulers = o.rulers ?? true;
  const f = s >= 6 ? 2 : 1;
  const digits = String(Math.max(doc.width, doc.height)).length;
  const top = rulers ? 5 * f + 9 : 0;
  const left = rulers ? 2 + textWidth('0'.repeat(digits), f) + 3 + 5 : 0;
  const W = doc.width * s;
  const H = doc.height * s;
  const img = createRgba(left + W + 1, top + H + 1);
  rect(img, 0, 0, img.width, img.height, RULER_BG);
  const px = flatten(doc);
  const pal = colourTable(doc);
  const chk = Math.max(2, s >> 1);
  for (let y = 0; y < doc.height; y++) for (let x = 0; x < doc.width; x++) {
    const v = px[y * doc.width + x]!;
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
      const c = v === TRANSPARENT ? (((x * s + i) / chk | 0) + ((y * s + j) / chk | 0)) % 2 ? CHECK_A : CHECK_B : pal[v]!;
      put(img, left + x * s + i, top + y * s + j, c);
    }
  }
  if (grid) {
    for (let x = 0; x <= doc.width; x++) {
      const a = x % 8 === 0 ? 96 : 40;
      for (let y = 0; y < H; y++) shade(img, left + x * s, top + y, a);
    }
    for (let y = 0; y <= doc.height; y++) {
      const a = y % 8 === 0 ? 96 : 40;
      for (let x = 0; x < W + 1; x++) if ((x % s) !== 0 || x === W) shade(img, left + x, top + y * s, a);
    }
  }
  const sheet = doc.cellW < doc.width || doc.cellH < doc.height;
  if (sheet) {
    for (let x = doc.cellW; x < doc.width; x += doc.cellW) for (let y = 0; y < H; y++) tint(img, left + x * s, top + y, CELL_LINE, 180);
    for (let y = doc.cellH; y < doc.height; y += doc.cellH) for (let x = 0; x < W; x++) tint(img, left + x, top + y * s, CELL_LINE, 180);
  }
  if (rulers) {
    for (let x = 0; x <= doc.width; x++) {
      const major = x % 8 === 0;
      if (!major && s < 4) continue;
      rect(img, left + x * s, top - (major ? 6 : 3), 1, major ? 6 : 3, major ? RULER_TEXT : RULER_TICK);
      if (major && x < doc.width) text(img, left + x * s + 2, 2, String(x), RULER_TEXT, f);
    }
    for (let y = 0; y <= doc.height; y++) {
      const major = y % 8 === 0;
      if (!major && s < 4) continue;
      rect(img, left - (major ? 6 : 3), top + y * s, major ? 6 : 3, 1, major ? RULER_TEXT : RULER_TICK);
      if (major && y < doc.height) {
        const label = String(y);
        text(img, left - 8 - textWidth(label, f), top + y * s + 2, label, RULER_TEXT, f);
      }
    }
  }
  return img;
}

/** The tile repeated 3x3, at 1x and at 4x side by side, to show seams and repetition. */
export function renderTile3x3(doc: Doc): Rgba {
  const pad = 8;
  const w = doc.width;
  const h = doc.height;
  const img = createRgba(pad + 3 * w + pad + 12 * w + pad, pad + 12 * h + pad);
  rect(img, 0, 0, img.width, img.height, RULER_BG);
  const px = flatten(doc);
  const pal = colourTable(doc);
  const draw = (ox: number, oy: number, s: number): void => {
    for (let ty = 0; ty < 3; ty++) for (let tx = 0; tx < 3; tx++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = px[y * w + x]!;
      const gx = (tx * w + x) * s;
      const gy = (ty * h + y) * s;
      for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
        const c = v === TRANSPARENT ? (((gx + i) >> 2) + ((gy + j) >> 2)) % 2 ? CHECK_A : CHECK_B : pal[v]!;
        put(img, ox + gx + i, oy + gy + j, c);
      }
    }
  };
  draw(pad, pad, 1);
  draw(pad + 3 * w + pad, pad, 4);
  return img;
}

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The text index grid: one character per pixel (the palette key; '.' for transparent), column
 * numbers above, row numbers at the left, and a legend of the keys used with pixel counts.
 */
export function renderGrid(doc: Doc, region?: Region): string {
  const r = region ?? { x: 0, y: 0, w: doc.width, h: doc.height };
  const px = flatten(doc);
  const t = { width: doc.width, height: doc.height, wrap: doc.wrap, pixels: px };
  const lastY = r.y + r.h - 1;
  const lastX = r.x + r.w - 1;
  const rowW = Math.max(2, String(lastY).length);
  const margin = ' '.repeat(rowW + 2);
  const lines: string[] = [];
  const header = (digitAt: (x: number) => string): string => {
    let s = '';
    for (let x = r.x; x <= lastX; x++) s += digitAt(x);
    return (margin + s).trimEnd();
  };
  const mag = Math.max(2, String(lastX).length);
  for (let p = mag - 1; p >= 1; p--) {
    const unit = 10 ** p;
    lines.push(header((x) => (x % unit === 0 || x === r.x ? String(Math.floor(x / unit) % 10) : ' ')));
  }
  lines.push(header((x) => String(((x % 10) + 10) % 10)));
  const counts = new Map<number, number>();
  for (let y = r.y; y <= lastY; y++) {
    let row = '';
    for (let x = r.x; x <= lastX; x++) {
      const i = indexOf(t, x, y);
      if (i < 0) { row += ' '; continue; }
      const v = px[i]!;
      counts.set(v, (counts.get(v) ?? 0) + 1);
      row += v === TRANSPARENT ? '.' : doc.palette.entries[v]!.key;
    }
    lines.push(String(y).padStart(rowW) + '  ' + row);
  }
  lines.push('');
  const legend = [...counts.entries()].sort((a, b) => a[0] - b[0]);
  for (const [v, n] of legend) {
    if (v === TRANSPARENT) lines.push(`  .  (transparent)  ${n} px`);
    else {
      const e = doc.palette.entries[v]!;
      lines.push(`  ${e.key}  ${e.name.padEnd(10)} ${e.hex}  ${n} px`);
    }
  }
  return lines.join('\n') + '\n';
}
