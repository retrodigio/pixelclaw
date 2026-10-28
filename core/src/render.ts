// Renders of a document: the flat image at 1x, the scaled view with pixel grid and rulers, the
// text index grid, and the tile 3x3 preview. All RGBA images go through encodePng.

import { TRANSPARENT, flatten, flattenReference, type Doc } from './doc.ts';
import { ROLES, rgbOf } from './palette.ts';
import { createRgba, type Rgba } from './png.ts';
import { indexOf, type Pt } from './raster.ts';
import { themedPalette, type Theme } from './themes.ts';

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

/** The tile repeated 3x3, at 1x and at 4x side by side, to show seams and repetition. Marks go on the middle copy at 4x. */
export function renderTile3x3(doc: Doc, frame = 0, o: { marks?: readonly Pt[]; theme?: Theme | null } = {}): Rgba {
  const pad = 8;
  const w = doc.width;
  const h = doc.height;
  const img = createRgba(pad + 3 * w + pad + 12 * w + pad, pad + 12 * h + pad);
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
  draw(pad + 3 * w + pad, pad, 4);
  if (o.marks?.length) drawMarks(img, pad + 3 * w + pad + 4 * w, pad + 4 * h, 4, o.marks, w, h);
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
