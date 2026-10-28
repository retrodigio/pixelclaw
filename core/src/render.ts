// Renders of a document: the flat image at 1x, the scaled view with pixel grid and rulers, the
// text index grid, and the tile 3x3 preview. All RGBA images go through encodePng.

import { frameAtTick, loopTicks, playOrder, sequences, type Sequence } from './anim.ts';
import { TRANSPARENT, flatten, flattenReference, type Doc } from './doc.ts';
import type { GifFrame } from './gif.ts';
import { ROLES, rgbOf } from './palette.ts';
import { createRgba, type Rgba } from './png.ts';
import { indexOf, type Pt } from './raster.ts';
import { themedPalette, type Theme } from './themes.ts';
import {
  DEFAULT_MAP, composeMap, drawOverlays, familyFrameAt, islandTerrain, layoutOf, mapPeriod, mapSeam, neighbourhoodOf, overlayOnPalette, schemeOf, tileMap, type MapImage,
} from './family.ts';
import type { Terrain } from './schemes.ts';

type RGB = [number, number, number];

const RULER_BG: RGB = [30, 31, 36];
const RULER_TICK: RGB = [120, 126, 136];
const RULER_TEXT: RGB = [216, 219, 224];
const CHECK_A: RGB = [204, 204, 204];
const CHECK_B: RGB = [238, 238, 238];
const CELL_LINE: RGB = [255, 79, 216];
const MARK: RGB = [255, 0, 200];

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

// 3x5 capitals and a few signs for labels (lower case is drawn as capitals).
const GLYPHS: Record<string, number[]> = {
  A: [2, 5, 7, 5, 5], B: [6, 5, 6, 5, 6], C: [3, 4, 4, 4, 3], D: [6, 5, 5, 5, 6], E: [7, 4, 6, 4, 7], F: [7, 4, 6, 4, 4],
  G: [3, 4, 5, 5, 3], H: [5, 5, 7, 5, 5], I: [7, 2, 2, 2, 7], J: [1, 1, 1, 5, 2], K: [5, 5, 6, 5, 5], L: [4, 4, 4, 4, 7],
  M: [5, 7, 7, 5, 5], N: [6, 5, 5, 5, 5], O: [2, 5, 5, 5, 2], P: [6, 5, 6, 4, 4], Q: [2, 5, 5, 6, 3], R: [6, 5, 6, 5, 5],
  S: [3, 4, 2, 1, 6], T: [7, 2, 2, 2, 2], U: [5, 5, 5, 5, 7], V: [5, 5, 5, 5, 2], W: [5, 5, 7, 7, 5], X: [5, 5, 2, 5, 5],
  Y: [5, 5, 2, 2, 2], Z: [7, 1, 2, 4, 7], '%': [5, 1, 2, 4, 5], '-': [0, 0, 7, 0, 0], '.': [0, 0, 0, 0, 2], '>': [4, 2, 1, 2, 4],
  _: [0, 0, 0, 0, 7], ':': [0, 2, 0, 2, 0], '/': [1, 1, 2, 4, 4], '+': [0, 2, 7, 2, 0],
};

function text(img: Rgba, x: number, y: number, s: string, c: RGB, scale: number): void {
  for (const ch of s) {
    const g = DIGITS[ch.charCodeAt(0) - 48] ?? GLYPHS[ch.toUpperCase()];
    if (g) g.forEach((bits, row) => {
      for (let col = 0; col < 3; col++) if (bits & (4 >> col)) rect(img, x + col * scale, y + row * scale, scale, scale, c);
    });
    x += 4 * scale;
  }
}

const textWidth = (s: string, scale: number): number => s.length * 4 * scale - scale;

function colourTable(doc: Doc, theme?: Theme | null): RGB[] {
  return themedPalette(doc.palette, theme).entries.map((e) => rgbOf(e.hex));
}


/**
 * Circle flagged pixels in magenta (plan §2): a ring around each pixel of an image drawn at
 * `s` px per pixel with its top-left pixel at ox,oy. Below 4x the pixel is filled instead.
 */
export function drawMarks(img: Rgba, ox: number, oy: number, s: number, marks: readonly Pt[], w: number, h: number): void {
  for (const [x, y] of marks) {
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const x0 = ox + x * s;
    const y0 = oy + y * s;
    if (s < 4) {
      for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) put(img, x0 + i, y0 + j, MARK);
      continue;
    }
    // In doubled coordinates around the pixel's centre: a ring just outside the pixel.
    const r = s + Math.max(2, s >> 1);
    const t = s >= 8 ? 4 : 2;
    const reach = (r >> 1) + 1;
    for (let j = -reach; j < s + reach; j++) for (let i = -reach; i < s + reach; i++) {
      const dx = 2 * i + 1 - s;
      const dy = 2 * j + 1 - s;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r * r && d2 > (r - t) * (r - t)) put(img, x0 + i, y0 + j, MARK);
    }
  }
}

/** The flat document at 1x: palette colours (role entries as the theme shows them), transparent pixels with alpha 0. */
export function renderFlat(doc: Doc, frame = 0, theme?: Theme | null): Rgba {
  const px = flatten(doc, frame);
  const pal = colourTable(doc, theme);
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
  /** The frame to show (0-based; default the first). */
  frame?: number;
  /** Pixels a check flagged: circled in magenta. */
  marks?: readonly Pt[];
  /** The preview theme for role entries. */
  theme?: Theme | null;
}

/** A reference pixel shown under transparent art: its colour half-way to the checkerboard's. */
function faded(c: RGB, under: RGB): RGB {
  return [(c[0] + under[0]) >> 1, (c[1] + under[1]) >> 1, (c[2] + under[2]) >> 1];
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
  const px = flatten(doc, o.frame ?? 0);
  const ref = flattenReference(doc, o.frame ?? 0);
  const pal = colourTable(doc, o.theme);
  const chk = Math.max(2, s >> 1);
  for (let y = 0; y < doc.height; y++) for (let x = 0; x < doc.width; x++) {
    const v = px[y * doc.width + x]!;
    const r = ref ? ref[y * doc.width + x]! : TRANSPARENT;
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
      let c: RGB;
      if (v !== TRANSPARENT) c = pal[v]!;
      else {
        c = (((x * s + i) / chk | 0) + ((y * s + j) / chk | 0)) % 2 ? CHECK_A : CHECK_B;
        if (r !== TRANSPARENT) c = faded(pal[r]!, c);
      }
      put(img, left + x * s + i, top + y * s + j, c);
    }
  }
  if (grid) {
    for (let x = 0; x <= doc.width; x++) {
      const a = x % 8 === 0 ? 80 : 30;
      for (let y = 0; y < H; y++) shade(img, left + x * s, top + y, a);
    }
    for (let y = 0; y <= doc.height; y++) {
      const a = y % 8 === 0 ? 80 : 30;
      for (let x = 0; x < W + 1; x++) if ((x % s) !== 0 || x === W) shade(img, left + x, top + y * s, a);
    }
  }
  const sheet = doc.cellW < doc.width || doc.cellH < doc.height;
  if (sheet) {
    for (let x = doc.cellW; x < doc.width; x += doc.cellW) for (let y = 0; y < H; y++) tint(img, left + x * s, top + y, CELL_LINE, 180);
    for (let y = doc.cellH; y < doc.height; y += doc.cellH) for (let x = 0; x < W; x++) tint(img, left + x, top + y * s, CELL_LINE, 180);
  }
  if (o.marks?.length) drawMarks(img, left, top, s, o.marks, doc.width, doc.height);
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

/**
 * The tile repeated 3x3, at 1x and at 4x (or `scale`) side by side, to show seams and repetition.
 * Marks go on the middle copy of the enlarged one.
 */
export function renderTile3x3(doc: Doc, frame = 0, o: { marks?: readonly Pt[]; theme?: Theme | null; scale?: number } = {}): Rgba {
  const pad = 8;
  const w = doc.width;
  const h = doc.height;
  const k = o.scale ?? 4;
  const img = createRgba(pad + 3 * w + pad + 3 * k * w + pad, pad + Math.max(3 * h, 3 * k * h) + pad);
  rect(img, 0, 0, img.width, img.height, RULER_BG);
  const px = flatten(doc, frame);
  const pal = colourTable(doc, o.theme);
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
  draw(pad + 3 * w + pad, pad, k);
  if (o.marks?.length) drawMarks(img, pad + 3 * w + pad + k * w, pad + k * h, k, o.marks, w, h);
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
export function renderGrid(doc: Doc, region?: Region, frame = 0): string {
  const r = region ?? { x: 0, y: 0, w: doc.width, h: doc.height };
  const px = flatten(doc, frame);
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

/** One pixel that differs between two documents (palette indices; TRANSPARENT for none), in frame `f` (0-based). */
export interface PixelChange {
  x: number;
  y: number;
  from: number;
  to: number;
  f: number;
}

/**
 * The pixels of the flat image that differ, in every frame of `after`. A missing or differently
 * sized `before` counts as all changed, and so does a frame `before` does not have.
 */
export function diffPixels(before: Doc | null, after: Doc): PixelChange[] {
  const same = before && before.width === after.width && before.height === after.height;
  const out: PixelChange[] = [];
  for (let f = 0; f < after.frameCount; f++) {
    const a = flatten(after, f);
    const b = same && f < before.frameCount ? flatten(before, f) : null;
    for (let i = 0; i < a.length; i++) {
      const from = b ? b[i]! : TRANSPARENT;
      if (b && from === a[i]) continue;
      if (!b && a[i] === TRANSPARENT && same) continue; // a new empty frame changes nothing visible
      out.push({ x: i % after.width, y: Math.floor(i / after.width), from, to: a[i]!, f });
    }
  }
  return out;
}

const NOTE: RGB = [255, 214, 10];

/** The changes as text: one `x,y from→to` per pixel (by entry name; `f2 x,y …` on documents with frames), up to `limit` of them. */
export function diffText(before: Doc | null, after: Doc, changes: PixelChange[], limit = 60): string {
  const name = (d: Doc | null, v: number) => (v === TRANSPARENT ? 'none' : d?.palette.entries[v]?.name ?? `#${v}`);
  if (changes.length === 0) return 'no pixels changed';
  const frames = after.frameCount > 1 || (before?.frameCount ?? 1) > 1;
  const per = [...new Set(changes.map((c) => c.f))].map((f) => `frame ${f + 1}: ${changes.filter((c) => c.f === f).length}`);
  const head = `${changes.length} px changed${frames ? ` (${per.join(', ')})` : ''}`;
  if (changes.length > limit) return `${head} (more than ${limit}: see the image)`;
  return [head + ':', ...changes.map((c) => `  ${frames ? `f${c.f + 1} ` : ''}${c.x},${c.y} ${name(before, c.from)}→${name(after, c.to)}`)].join('\n');
}

/**
 * Before and after side by side at the render scale, each changed pixel outlined in magenta on
 * both, and the after document's open notes outlined in yellow dashes. With more than `limit`
 * changes a third panel shows them as a map: the after image dimmed, changed pixels solid magenta.
 * On documents with frames there is one row per frame that changed, numbered at the left.
 */
export function renderDiff(before: Doc | null, after: Doc, o: { scale?: number; limit?: number } = {}): Rgba {
  const changes = diffPixels(before, after);
  const s = o.scale ?? defaultScale(after);
  const pad = 8;
  const W = after.width * s;
  const H = after.height * s;
  const bw = before ? before.width * s : W;
  const bh = before ? before.height * s : H;
  const panels = changes.length > (o.limit ?? 60) ? 3 : 2;
  const multi = after.frameCount > 1 || (before?.frameCount ?? 1) > 1;
  const changed = [...new Set(changes.map((c) => c.f))].sort((a, b) => a - b);
  const rows = multi && changed.length ? changed : [0];
  const label = multi ? textWidth(String(after.frameCount), 2) + pad : 0;
  const rowH = Math.max(bh, H) + pad;
  const img = createRgba(label + pad + bw + pad + (W + pad) * (panels - 1), pad + rowH * rows.length);
  rect(img, 0, 0, img.width, img.height, RULER_BG);
  const draw = (d: Doc, f: number, ox: number, oy: number, dim: boolean): void => {
    const px = f < d.frameCount ? flatten(d, f) : new Uint16Array(d.width * d.height).fill(TRANSPARENT);
    const pal = colourTable(d);
    const chk = Math.max(2, s >> 1);
    for (let y = 0; y < d.height; y++) for (let x = 0; x < d.width; x++) {
      const v = px[y * d.width + x]!;
      for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
        const c = v === TRANSPARENT ? (((x * s + i) / chk | 0) + ((y * s + j) / chk | 0)) % 2 ? CHECK_A : CHECK_B : pal[v]!;
        put(img, ox + x * s + i, oy + y * s + j, c);
        if (dim) tint(img, ox + x * s + i, oy + y * s + j, RULER_BG, 190);
      }
    }
  };
  const mark = (f: number, ox: number, oy: number, w: number, h: number, solid: boolean): void => {
    for (const c of changes) {
      if (c.f !== f || c.x >= w || c.y >= h) continue;
      const x0 = ox + c.x * s;
      const y0 = oy + c.y * s;
      if (solid || s < 4) {
        for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
          if (solid) put(img, x0 + i, y0 + j, MARK);
          else tint(img, x0 + i, y0 + j, MARK, 150);
        }
        continue;
      }
      // An outline on the pixel's border, 1 px (2 px from 8x), so its colour stays visible.
      const t = s >= 8 ? 2 : 1;
      for (let k = 0; k < s; k++) for (let q = 0; q < t; q++) {
        put(img, x0 + k, y0 + q, MARK); put(img, x0 + k, y0 + s - 1 - q, MARK);
        put(img, x0 + q, y0 + k, MARK); put(img, x0 + s - 1 - q, y0 + k, MARK);
      }
    }
  };
  rows.forEach((f, r) => {
    const oy = pad + r * rowH;
    if (multi) text(img, pad, oy + 2, String(f + 1), RULER_TEXT, 2);
    const bx = label + pad;
    if (before) {
      draw(before, f, bx, oy, false);
      mark(f, bx, oy, before.width, before.height, false);
    }
    const ax = bx + bw + pad;
    draw(after, f, ax, oy, false);
    mark(f, ax, oy, after.width, after.height, false);
    for (const n of after.notes) {
      // A dashed box just outside the note's pixels (on the panel's border it sits inside).
      const x0 = Math.max(ax, ax + n.x * s - 1);
      const y0 = Math.max(oy, oy + n.y * s - 1);
      const x1 = Math.min(ax + W - 1, ax + (n.x + n.w) * s);
      const y1 = Math.min(oy + H - 1, oy + (n.y + n.h) * s);
      for (let x = x0; x <= x1; x++) if (((x - x0) >> 1) % 2 === 0) { put(img, x, y0, NOTE); put(img, x, y1, NOTE); }
      for (let y = y0; y <= y1; y++) if (((y - y0) >> 1) % 2 === 0) { put(img, x0, y, NOTE); put(img, x1, y, NOTE); }
    }
    if (panels === 3) {
      const mx = ax + W + pad;
      draw(after, f, mx, oy, true);
      mark(f, mx, oy, after.width, after.height, true);
    }
  });
  return img;
}

/** A neutral ground for previews when there is no ground tile. */
const PLAIN_GROUND: RGB = [88, 94, 102];

/**
 * The game preview (plan §2): sprites side by side on their ground tile (repeated), at 1x (real
 * size) and again at the engine's draw scale. Sprites stand on a common baseline. The first item
 * is the asset being judged; the rest are its neighbours in the set.
 */
export function renderGame(items: { doc: Doc; frame?: number }[], o: { ground?: Doc | null; scale?: number; theme?: Theme | null; marks?: readonly Pt[] } = {}): Rgba {
  const k = Math.max(1, o.scale ?? 2);
  const gap = 8;
  const margin = 8;
  const maxH = Math.max(1, ...items.map((i) => i.doc.height));
  const sceneW = margin * 2 + items.reduce((n, i) => n + i.doc.width, 0) + gap * Math.max(0, items.length - 1);
  const sceneH = margin * 2 + maxH;
  // The scene at 1x, as colours (null: not yet drawn).
  const scene: RGB[] = [];
  const g = o.ground ? flatten(o.ground, 0) : null;
  const gpal = o.ground ? colourTable(o.ground, o.theme) : [];
  for (let y = 0; y < sceneH; y++) for (let x = 0; x < sceneW; x++) {
    const v = g ? g[(y % o.ground!.height) * o.ground!.width + (x % o.ground!.width)]! : TRANSPARENT;
    scene.push(v === TRANSPARENT ? PLAIN_GROUND : gpal[v]!);
  }
  let ox = margin;
  const firstAt: Pt = [margin, margin + maxH - (items[0]?.doc.height ?? 0)];
  for (const it of items) {
    const px = flatten(it.doc, it.frame ?? 0);
    const pal = colourTable(it.doc, o.theme);
    const oy = margin + maxH - it.doc.height;
    for (let y = 0; y < it.doc.height; y++) for (let x = 0; x < it.doc.width; x++) {
      const v = px[y * it.doc.width + x]!;
      if (v !== TRANSPARENT) scene[(oy + y) * sceneW + ox + x] = pal[v]!;
    }
    ox += it.doc.width + gap;
  }
  const pad = 8;
  const img = createRgba(pad + Math.max(sceneW, sceneW * k) + pad, pad + sceneH + pad + sceneH * k + pad);
  rect(img, 0, 0, img.width, img.height, RULER_BG);
  for (let y = 0; y < sceneH; y++) for (let x = 0; x < sceneW; x++) {
    const c = scene[y * sceneW + x]!;
    put(img, pad + x, pad + y, c);
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) put(img, pad + x * k + i, pad + sceneH + pad + y * k + j, c);
  }
  if (o.marks?.length && items[0]) drawMarks(img, pad + firstAt[0] * k, pad + sceneH + pad + firstAt[1] * k, k, o.marks, items[0].doc.width, items[0].doc.height);
  return img;
}

/**
 * The recolour preview (plan §2, §4.8): the art under several preview themes side by side, each
 * with a strip of its role colours (black, white, light, dark, darkest) underneath.
 */
export function renderRecolour(doc: Doc, themes: Theme[], o: { scale?: number; frame?: number } = {}): Rgba {
  const s = o.scale ?? Math.max(1, Math.min(4, Math.floor(96 / Math.max(doc.width, doc.height))));
  const pad = 8;
  const W = doc.width * s;
  const H = doc.height * s;
  const sw = Math.max(4, Math.floor(W / ROLES.length));
  const n = Math.max(1, themes.length);
  const img = createRgba(pad + n * (W + pad), pad + H + 4 + 6 + pad);
  rect(img, 0, 0, img.width, img.height, RULER_BG);
  const px = flatten(doc, o.frame ?? 0);
  const chk = Math.max(2, s >> 1);
  themes.forEach((t, k) => {
    const ox = pad + k * (W + pad);
    const pal = colourTable(doc, t);
    for (let y = 0; y < doc.height; y++) for (let x = 0; x < doc.width; x++) {
      const v = px[y * doc.width + x]!;
      for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
        const c = v === TRANSPARENT ? (((x * s + i) / chk | 0) + ((y * s + j) / chk | 0)) % 2 ? CHECK_A : CHECK_B : pal[v]!;
        put(img, ox + x * s + i, pad + y * s + j, c);
      }
    }
    ROLES.forEach((r, i) => rect(img, ox + i * sw, pad + H + 4, sw, 6, rgbOf(t.colours[r])));
  });
  return img;
}

// --- animation (plan §2 `anim`, §4.4)

const GUIDE: RGB = [64, 220, 230];
const ONION_PREV: RGB = [255, 110, 70];
const ANIM_BG: RGB = [58, 60, 68];
const LABEL: RGB = [216, 219, 224];
const LABEL_DIM: RGB = [150, 156, 166];

const pctText = (v: number): string => `${Math.round(v * 100)}%`;

/** The share of pixels that differ between two frames, over the union of their silhouettes. */
export function frameDiffShare(doc: Doc, a: number, b: number): number {
  const A = flatten(doc, a);
  const B = flatten(doc, b);
  let changed = 0, union = 0;
  for (let i = 0; i < A.length; i++) {
    if (A[i] !== TRANSPARENT || B[i] !== TRANSPARENT) union++;
    if (A[i] !== B[i]) changed++;
  }
  return union ? changed / union : 0;
}

export interface AnimOptions {
  /** Pixels per art pixel (default: about 96 px per frame, 2..8). */
  scale?: number;
  theme?: Theme | null;
  /** Game ticks per second (the project's tick rate; default 60). */
  tickRate?: number;
  /** Only these sequences (by name). */
  only?: string[];
}

const animScale = (doc: Doc, o: AnimOptions): number => o.scale ?? Math.max(2, Math.min(8, Math.floor(96 / Math.max(doc.width, doc.height))));

function pickSequences(doc: Doc, o: AnimOptions): Sequence[] {
  const all = sequences(doc);
  if (!o.only?.length) return all;
  const out = all.filter((s) => o.only!.includes(s.name));
  if (!out.length) throw new Error(`no sequence named ${o.only.join(', ')} (sequences: ${all.map((s) => s.name).join(', ')})`);
  return out;
}

/** The frame before f when a sequence plays (a cycle wraps; a ping-pong turns back). */
function prevInPlay(s: Sequence, k: number): number | null {
  const order = playOrder(s);
  if (order.length < 2) return null;
  const i = order.indexOf(s.frames[k]!);
  return order[(i - 1 + order.length) % order.length]!;
}

/**
 * The `anim` contact sheet: one row per sequence (tags, views), every frame with its number and
 * ticks above, the previous frame as an onion skin (tinted) under it, the pivot and the ground
 * line, and under each frame the share of pixels that changed from the frame before it.
 */
export function renderAnimSheet(doc: Doc, o: AnimOptions = {}): Rgba {
  const s = animScale(doc, o);
  const seqs = pickSequences(doc, o);
  const W = doc.width * s;
  const H = doc.height * s;
  const pad = 8;
  const t = 2; // label text scale
  const lh = 5 * t + 4;
  const labelW = Math.max(...seqs.map((q) => Math.max(textWidth(q.name, t), textWidth(q.mirror ? 'MIRROR' : q.loop, t), textWidth(`${loopTicks(doc, q)}T`, t)))) + pad;
  const cols = Math.max(...seqs.map((q) => q.frames.length));
  const rowH = lh + H + lh + pad;
  const img = createRgba(pad + labelW + cols * (W + pad), pad + seqs.length * rowH);
  rect(img, 0, 0, img.width, img.height, RULER_BG);
  const pal = colourTable(doc, o.theme);
  const chk = Math.max(2, s >> 1);
  seqs.forEach((q, r) => {
    const oy = pad + r * rowH;
    text(img, pad, oy + lh, q.name, LABEL, t);
    text(img, pad, oy + lh * 2, q.mirror ? 'MIRROR' : q.loop, LABEL_DIM, t);
    text(img, pad, oy + lh * 3, `${loopTicks(doc, q)}T`, LABEL_DIM, t);
    q.frames.forEach((f, k) => {
      const ox = pad + labelW + k * (W + pad);
      text(img, ox, oy, `${f + 1} ${doc.ticks[f]}T`, LABEL, t);
      const px = flatten(doc, f);
      const prev = prevInPlay(q, k);
      const under = prev !== null && prev !== f ? flatten(doc, prev) : null;
      for (let y = 0; y < doc.height; y++) for (let x = 0; x < doc.width; x++) {
        const i = y * doc.width + x;
        const v = px[i]!;
        for (let j = 0; j < s; j++) for (let ii = 0; ii < s; ii++) {
          const X = ox + x * s + ii, Y = oy + lh + y * s + j;
          if (v !== TRANSPARENT) { put(img, X, Y, pal[v]!); continue; }
          put(img, X, Y, (((x * s + ii) / chk | 0) + ((y * s + j) / chk | 0)) % 2 ? CHECK_A : CHECK_B);
          if (under && under[i] !== TRANSPARENT) tint(img, X, Y, ONION_PREV, 110);
        }
      }
      if (!doc.wrap && doc.ground !== null) for (let x = 0; x < W; x += 2) put(img, ox + x, oy + lh + (doc.ground + 1) * s - 1, GUIDE);
      if (!doc.wrap && doc.pivot) {
        const [px0, py0] = doc.pivot;
        const cx = ox + px0 * s, cy = oy + lh + py0 * s;
        for (let i = -1; i <= s; i++) { put(img, cx + i, cy - 1, GUIDE); put(img, cx + i, cy + s, GUIDE); put(img, cx - 1, cy + i, GUIDE); put(img, cx + s, cy + i, GUIDE); }
      }
      if (prev !== null && prev !== f) text(img, ox, oy + lh + H + 4, `${prev + 1}>${f + 1} ${pctText(frameDiffShare(doc, prev, f))}`, LABEL_DIM, t);
    });
  });
  return img;
}

/** The sheet's numbers as text: per sequence, its frames, ticks, loop time and frame diffs. */
export function animText(doc: Doc, o: AnimOptions = {}): string {
  const rate = o.tickRate ?? 60;
  const out = [`${doc.name}: ${doc.frameCount} frame${doc.frameCount === 1 ? '' : 's'} at ${rate} ticks/s` +
    (doc.pivot ? `; pivot ${doc.pivot[0]},${doc.pivot[1]}` : '') + (doc.ground !== null ? `; ground ${doc.ground}` : '')];
  for (const q of pickSequences(doc, o)) {
    const ticks = loopTicks(doc, q);
    const order = playOrder(q);
    const pairs = order.length < 2 ? [] : (q.loop === 'pingpong' ? q.frames.slice(1).map((b, k) => [q.frames[k]!, b]) : order.map((a, k) => [a, order[(k + 1) % order.length]!]));
    const src = q.mirror ? doc.views.find((v) => v.name === q.name)?.mirror : null;
    out.push(`  ${q.name}: ${src ? `mirror of ${src}, ` : ''}${q.loop}, frames ${q.frames.map((f) => f + 1).join(',')}, ticks ${q.frames.map((f) => doc.ticks[f]).join(',')}` +
      ` (a loop is ${ticks} ticks, ${Math.round((ticks * 1000) / rate)} ms)` + (pairs.length ? `; changed ${pairs.map(([a, b]) => `${a! + 1}→${b! + 1} ${pctText(frameDiffShare(doc, a!, b!))}`).join(', ')}` : ''));
  }
  return out.join('\n');
}

/**
 * The animation as GIF frames: every sequence side by side, each playing its own frames at the
 * game's tick rate (tiles 3x3, so a shimmer reads as a surface). One GIF loop is the least common
 * multiple of the sequences' loops (capped at a minute).
 */
export function animGifFrames(doc: Doc, o: AnimOptions = {}): GifFrame[] {
  const s = o.scale ?? (doc.wrap ? Math.max(1, Math.min(4, Math.floor(72 / doc.width))) : animScale(doc, o));
  const rate = o.tickRate ?? 60;
  const seqs = pickSequences(doc, o);
  const reps = doc.wrap ? 3 : 1;
  const W = doc.width * s * reps, H = doc.height * s * reps;
  const pad = 8;
  const pal = colourTable(doc, o.theme);
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  let period = 1;
  for (const q of seqs) {
    const l = Math.max(1, loopTicks(doc, q));
    period = Math.min(rate * 60, (period / gcd(period, l)) * l);
  }
  // Every tick where some sequence changes frame.
  const cuts = new Set<number>([0]);
  for (const q of seqs) {
    const order = playOrder(q);
    let t = 0;
    for (let k = 0; t < period; k++) { cuts.add(t); t += Math.max(1, doc.ticks[order[k % order.length]!]!); }
  }
  // Delays in hundredths, rounded at each boundary so they add up exactly; a cut that rounds to the same hundredth as the one before is dropped.
  const cs = (t: number) => Math.round((t * 100) / rate);
  const times = [...cuts].sort((a, b) => a - b).filter((t, k, all) => k === 0 || cs(t) !== cs(all[k - 1]!));
  const flat = new Map<number, Uint16Array>();
  const frameAt = (f: number) => flat.get(f) ?? flat.set(f, flatten(doc, f)).get(f)!;
  return times.map((t0, k) => {
    const t1 = k + 1 < times.length ? times[k + 1]! : period;
    const img = createRgba(pad + seqs.length * (W + pad), pad + H + pad);
    rect(img, 0, 0, img.width, img.height, ANIM_BG);
    seqs.forEach((q, n) => {
      const px = frameAt(frameAtTick(doc, q, t0));
      const ox = pad + n * (W + pad);
      for (let y = 0; y < doc.height * reps; y++) for (let x = 0; x < doc.width * reps; x++) {
        const v = px[(y % doc.height) * doc.width + (x % doc.width)]!;
        if (v !== TRANSPARENT) rect(img, ox + x * s, pad + y * s, s, s, pal[v]!);
      }
    });
    return { img, delay: Math.max(1, cs(t1) - cs(t0)) };
  });
}

// --- Maps and families (plan §2 `map`, §4.2, §4.3)

export interface MapViewOptions {
  /** The map's size in tiles and the island's seed (a family's default: 12x10, seed 1). */
  cols?: number;
  rows?: number;
  seed?: number;
  /** A given terrain instead of a random island. */
  terrain?: Terrain;
  /** Pixels per art pixel (default 2, the game's draw scale). */
  scale?: number;
  theme?: Theme | null;
  /** Overlay documents played over the map. */
  overlays?: Doc[];
  /** A tile under an overlay's map (for `view map` of an overlay). */
  ground?: Doc | null;
  /** The family's frame (default: its first sequence at `tick`). */
  frame?: number;
  tick?: number;
  tickRate?: number;
}

interface MapScene {
  base: Doc;
  img: MapImage;
  colours: RGB[];
  overlays: Doc[];
  terrain: Terrain | null;
}

/** The map's documents and palette: the family (or tile) underneath, overlays remapped onto its colours. */
function mapScene(doc: Doc, o: MapViewOptions, tick: number): MapScene {
  const base = doc.overlay ? o.ground ?? null : doc;
  if (!base) throw new Error(`a map of an overlay needs a ground tile or family under it`);
  const overlays = [...(doc.overlay ? [doc] : []), ...(o.overlays ?? [])];
  const entries = themedPalette(base.palette, o.theme).entries.map((e) => ({ name: e.name, hex: e.hex }));
  const remapped = overlays.map((x) => overlayOnPalette(x, entries));
  let img: MapImage;
  let terrain: Terrain | null = null;
  if (base.family) {
    const s = schemeOf(base.family);
    const cols = o.cols ?? o.terrain?.cols ?? DEFAULT_MAP.cols, rows = o.rows ?? o.terrain?.rows ?? DEFAULT_MAP.rows;
    terrain = o.terrain ?? islandTerrain(s, cols, rows, o.seed ?? DEFAULT_MAP.seed);
    img = composeMap(base, terrain, o.frame ?? familyFrameAt(base, tick));
  } else {
    const t = base.width;
    img = tileMap(base, o.cols ?? Math.max(4, Math.ceil(288 / t)), o.rows ?? Math.max(3, Math.ceil(216 / base.height)), o.frame ?? (base.frameCount > 1 ? frameAtTick(base, sequences(base)[0]!, tick) : 0));
  }
  drawOverlays(img, remapped, tick, base.family ? base : null);
  return { base, img, colours: entries.map((e) => rgbOf(e.hex)), overlays: remapped, terrain };
}

function paintMap(sc: MapScene, s: number): Rgba {
  const { img } = sc;
  const out = createRgba(img.w * s, img.h * s);
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const v = img.px[y * img.w + x]!;
    rect(out, x * s, y * s, s, s, v === TRANSPARENT ? (((x >> 2) + (y >> 2)) % 2 ? CHECK_A : CHECK_B) : sc.colours[v]!);
  }
  return out;
}

/** The `map` view: a sample map built with the family's scheme (a random island, or a given terrain), at game scale. */
export function renderMap(doc: Doc, o: MapViewOptions = {}): Rgba {
  return paintMap(mapScene(doc, o, o.tick ?? 0), o.scale ?? 2);
}

/** What the map view shows, in words: its size, seed, the seam score over it, and the variants it used. */
export function mapText(doc: Doc, o: MapViewOptions = {}): string {
  const sc = mapScene(doc, o, o.tick ?? 0);
  const { img, base } = sc;
  const seam = mapSeam(img, base);
  const f2 = (n: number) => String(Number(n.toFixed(2)));
  const lines = [`${img.w / img.t}x${img.h / img.t} tiles of ${img.t} px${base.family && !o.terrain ? `, a random island (seed ${o.seed ?? DEFAULT_MAP.seed})` : ''}` +
    `; seam ${f2(seam.score)} (jump x ${f2(seam.jx)} y ${f2(seam.jy)}, line x ${f2(seam.lx)} y ${f2(seam.ly)}; about 1 or less reads as no seam)`];
  if (base.family) {
    const s = schemeOf(base.family);
    const n = new Map<number, number>();
    for (const v of img.variants) if (v !== null) n.set(v, (n.get(v) ?? 0) + 1);
    const used = [...n.keys()].sort((a, b) => a - b);
    lines.push(`${used.length} of ${s.variants.length} variants on the map: ${used.map((v) => `${s.variants[v]!.name}×${n.get(v)}`).join(' ')}`);
  }
  if (sc.overlays.length) lines.push(`overlays: ${sc.overlays.map((x) => `${x.name} (${x.overlay!.mode} on ${x.overlay!.on}, every ${x.overlay!.every})`).join(', ')}`);
  return lines.join('\n');
}

/**
 * The map playing at the game's speed (family frames and overlays), as GIF frames: one loop of
 * everything on it, at most four seconds, in steps of at least 3 ticks.
 */
export function mapGifFrames(doc: Doc, o: MapViewOptions = {}): GifFrame[] {
  const rate = o.tickRate ?? 60;
  const first = mapScene(doc, o, 0);
  const period = mapPeriod(first.base, first.overlays, rate * 4);
  const s = o.scale ?? 2;
  const cs = (t: number) => Math.round((t * 100) / rate);
  const out: GifFrame[] = [];
  let prev: Uint16Array | null = null;
  let start = 0;
  for (let t = 0; t <= period; t += t === period ? 1 : Math.min(3, period - t)) {
    const sc = t === 0 ? first : t < period ? mapScene(doc, o, t) : null;
    const same = sc && prev && sc.img.px.every((v, i) => v === prev![i]);
    if (same) continue;
    if (prev && out.length) out[out.length - 1]!.delay = Math.max(1, cs(t) - cs(start));
    if (!sc) break;
    out.push({ img: paintMap(sc, s), delay: 1 });
    prev = sc.img.px;
    start = t;
  }
  return out;
}

/** A variant in the middle of the 3x3 map that resolves to it (one placed by name only: among plain outside), the neighbours dimmed. */
export function renderVariant(doc: Doc, v: number, o: { frame?: number; theme?: Theme | null } = {}): Rgba {
  const f = doc.family!;
  const s = schemeOf(f);
  const t = f.tile;
  const frame = o.frame ?? 0;
  const pal = colourTable(doc, o.theme);
  const nb = neighbourhoodOf(s, v);
  const m = composeMap(doc, nb ?? { cols: 3, rows: 3, cells: new Uint8Array(s.neighbours === 'corners' ? 16 : 9) }, frame);
  if (!nb) {
    const [cx, cy] = layoutOf(f).cells[v]!;
    const flat = flatten(doc, frame);
    for (let y = 0; y < t; y++) for (let x = 0; x < t; x++) m.px[(t + y) * m.w + t + x] = flat[(cy * t + y) * doc.width + cx * t + x]!;
  }
  const img = createRgba(m.w, m.h);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const c = m.px[y * m.w + x]!;
    const centre = x >= t && x < 2 * t && y >= t && y < 2 * t;
    const rgb = c === TRANSPARENT ? CHECK_A : pal[c]!;
    put(img, x, y, centre ? rgb : [Math.round(rgb[0] * 0.55 + 20), Math.round(rgb[1] * 0.55 + 20), Math.round(rgb[2] * 0.55 + 22)]);
  }
  return img;
}

/**
 * The family view: every variant in the middle of its neighbourhood (the 3x3 map that resolves to
 * it), labelled; pieces' labels in cyan, detached variants' in amber.
 */
export function renderFamilyView(doc: Doc, o: { scale?: number; frame?: number; theme?: Theme | null; cols?: number } = {}): Rgba {
  const f = doc.family!;
  const s = schemeOf(f);
  const t = f.tile;
  const k = o.scale ?? 1;
  const cols = o.cols ?? Math.min(8, s.variants.length);
  const pad = 6, lh = 9;
  const cw = 3 * t * k, ch = 3 * t * k + lh;
  const rows = Math.ceil(s.variants.length / cols);
  const img = createRgba(pad + cols * (cw + pad), pad + rows * (ch + pad));
  rect(img, 0, 0, img.width, img.height, ANIM_BG);
  const pieces = new Set(s.pieces);
  const detached = new Set(f.detached);
  s.variants.forEach((x, v) => {
    const ox = pad + (v % cols) * (cw + pad), oy = pad + Math.floor(v / cols) * (ch + pad);
    text(img, ox, oy, x.name.length > cw / 4 ? x.name.slice(0, Math.floor(cw / 4)) : x.name, pieces.has(x.name) ? PIECE_LABEL : detached.has(x.name) ? DETACHED_LABEL : LABEL_DIM, 1);
    const one = renderVariant(doc, v, o);
    for (let y = 0; y < one.height; y++) for (let xx = 0; xx < one.width; xx++) {
      const i = (y * one.width + xx) * 4;
      rect(img, ox + xx * k, oy + lh + y * k, k, k, [one.data[i]!, one.data[i + 1]!, one.data[i + 2]!]);
    }
  });
  return img;
}

const PIECE_LABEL: RGB = [120, 220, 230];
const DETACHED_LABEL: RGB = [240, 190, 90];
