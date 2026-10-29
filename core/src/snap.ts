// Snap (plan §6): read a full-colour underlay (a generated mockup, a photo of a drawing) back into
// pixel art. Three steps:
//
// 1. Grid fit. An image of pixel art drawn at some scale has its colour changes on a regular grid.
//    For each axis, the edge profile (the summed colour change between neighbouring columns) is
//    a train of edges every pitch pixels. Its Fourier component is strong at the pitch and its
//    fractions and has nothing at multiples, so the longest strong period is the pitch, and the
//    phase gives the offset (a blurred edge counts at its middle).
// 2. Blocks. Each grid cell's colour is the per-channel median of its middle (a quarter of the
//    pitch in from each side, where blur and seams do not reach); block R² says how much of the
//    image's colour variance the blocks explain (1: perfectly blocky).
// 3. Palette quantise, and the layout match. The block colours go to the nearest palette entries
//    (as imports do). With the flat template the image was made from, the material match is the
//    share of blocks whose colour is nearest the mean colour of their own template colour's
//    blocks: did each material land where the layout put it?
//
// Below 0.8 R² or 0.85 material match, the result suggests a reroll. The result is written into
// the tape as rows, so replay never runs this again.

import { quantise } from './decode.ts';
import type { Palette } from './palette.ts';
import type { Rgba } from './png.ts';

export const SNAP_MIN_R2 = 0.8;
export const SNAP_MIN_MATERIAL = 0.85;

export interface AxisFit {
  pitch: number;
  offset: number;
  /** The edge profile's strength at the pitch, over its total (how clearly the grid shows). */
  score: number;
}

export interface GridFit {
  x: AxisFit;
  y: AxisFit;
  /** Grid cells (blocks) across and down, counting partial cells at least half inside. */
  cols: number;
  rows: number;
  /** The first block's index (-1 when a partial cell before the offset is at least half inside). */
  i0: number;
  j0: number;
}

/** The edge profile along x: prof[k] = Σ_y |I(k+1,y) - I(k,y)| over RGB (the line between pixels k and k+1 is at k + 1). */
function profile(img: Rgba, axis: 'x' | 'y'): Float64Array {
  const W = img.width, H = img.height, d = img.data;
  const n = axis === 'x' ? W - 1 : H - 1;
  const out = new Float64Array(Math.max(0, n));
  const step = axis === 'x' ? 4 : W * 4;
  for (let y = 0; y < (axis === 'x' ? H : H - 1); y++) {
    for (let x = 0; x < (axis === 'x' ? W - 1 : W); x++) {
      const i = (y * W + x) * 4;
      const a = d[i + 3]! < 128, b = d[i + step + 3]! < 128;
      const diff = a || b ? (a === b ? 0 : 255 * 3) : Math.abs(d[i]! - d[i + step]!) + Math.abs(d[i + 1]! - d[i + step + 1]!) + Math.abs(d[i + 2]! - d[i + step + 2]!);
      out[axis === 'x' ? x : y]! += diff;
    }
  }
  return out;
}

/**
 * The edge profile's Fourier component at period p: its strength (over the profile's total) and
 * where the grid lines fall (the offset, from the phase). A train of edges every p pixels is strong
 * at p and its fractions p/2, p/3, … and has nothing at 2p, 3p, …; so the true pitch is the
 * longest period that is strong.
 */
function component(prof: Float64Array, p: number, total: number): { m: number; o: number } {
  // Rotate a unit vector by 2π/p per pixel (the line between pixels k and k+1 sits at k + 1).
  const th = (2 * Math.PI) / p;
  const c = Math.cos(th), s = Math.sin(th);
  let re = c, im = s, sr = 0, si = 0;
  for (let k = 0; k < prof.length; k++) {
    sr += prof[k]! * re; si += prof[k]! * im;
    const r2 = re * c - im * s;
    im = re * s + im * c; re = r2;
  }
  const m = Math.hypot(sr, si) / (total || 1);
  let o = (Math.atan2(si, sr) / (2 * Math.PI)) * p;
  if (o < 0) o += p;
  return { m, o };
}

/**
 * Fit one axis: pitch and offset (0 <= offset < pitch). With a `hint` (the pitch the underlay's
 * placement implies) the strongest period within ±15 % of it wins; without one, the longest strong
 * period up to an eighth of the image.
 */
export function fitAxis(img: Rgba, axis: 'x' | 'y', hint?: number): AxisFit {
  const prof = profile(img, axis);
  const len = axis === 'x' ? img.width : img.height;
  const total = prof.reduce((s, v) => s + v, 0);
  // Without its mean (noise adds a floor to every column, which would leak into every period whose
  // multiple is not the image's length).
  const mean = total / Math.max(1, prof.length);
  for (let k = 0; k < prof.length; k++) prof[k]! -= mean;
  const lo = hint ? Math.max(1.5, hint * 0.85) : 1.5;
  const hi = hint ? Math.min(len / 2, hint * 1.15) : Math.min(64, len / 8);
  // Coarse: periods close enough that the grid drifts less than a quarter pixel across the image.
  const step = 1 + 0.25 / Math.max(16, len);
  const spec: { p: number; m: number; o: number }[] = [];
  for (let p = lo; p <= hi; p *= step) spec.push({ p, ...component(prof, p, total) });
  if (!spec.length) return { pitch: lo, offset: 0, score: 0 };
  const top = Math.max(...spec.map((c) => c.m));
  const peaks = spec.filter((c, i) => c.m >= 0.5 * top && c.m >= (spec[i - 1]?.m ?? -1) && c.m >= (spec[i + 1]?.m ?? -1));
  const pick = (hint ? undefined : peaks.at(-1)) ?? spec.find((c) => c.m === top)!;
  // Fine: the strongest period near the pick, in steps that move the far end by a fiftieth of a pixel.
  let fine = pick;
  for (let p = pick.p * (1 - 1 / len); p <= pick.p * (1 + 1 / len); p *= 1 + 0.02 / len) {
    const c = component(prof, p, total);
    if (c.m > fine.m) fine = { p, ...c };
  }
  return { pitch: fine.p, offset: fine.o, score: fine.m };
}

/** One axis at a known pitch: only the offset (where the grid lines fall) is fitted. */
export function fitAxisAt(img: Rgba, axis: 'x' | 'y', pitch: number): AxisFit {
  const prof = profile(img, axis);
  const total = prof.reduce((s, v) => s + v, 0);
  const mean = total / Math.max(1, prof.length);
  for (let k = 0; k < prof.length; k++) prof[k]! -= mean;
  const c = component(prof, pitch, total);
  return { pitch, offset: c.o, score: c.m };
}

/**
 * Fit the grid on both axes (hints: the expected pitch on each). With `cells` (the placement's
 * size in document pixels, G13) the grid is the placement's: the pitch is the image's size over
 * the cells, exactly that many blocks, and only the offset is fitted (by less than half a block),
 * so the draft lands on the placement pixel for pixel.
 */
export function fitGrid(img: Rgba, hint?: { x?: number; y?: number }, cells?: { cols: number; rows: number }): GridFit {
  if (cells) {
    const x = fitAxisAt(img, 'x', img.width / cells.cols);
    const y = fitAxisAt(img, 'y', img.height / cells.rows);
    // A grid line past the middle of the first block belongs to the block before it.
    const k0 = (f: AxisFit) => (f.offset > f.pitch / 2 ? -1 : 0);
    return { x, y, cols: cells.cols, rows: cells.rows, i0: k0(x), j0: k0(y) };
  }
  const x = fitAxis(img, 'x', hint?.x);
  const y = fitAxis(img, 'y', hint?.y);
  const span = (f: AxisFit, len: number) => {
    // Block k covers [offset + k*pitch, offset + (k+1)*pitch); keep those at least half inside.
    const inside = (k: number) => Math.min(len, f.offset + (k + 1) * f.pitch) - Math.max(0, f.offset + k * f.pitch);
    const k0 = inside(-1) >= f.pitch / 2 ? -1 : 0;
    let k1 = k0;
    while (inside(k1 + 1) >= f.pitch / 2) k1++;
    return { k0, n: k1 - k0 + 1 };
  };
  const sx = span(x, img.width), sy = span(y, img.height);
  return { x, y, cols: sx.n, rows: sy.n, i0: sx.k0, j0: sy.k0 };
}

function median(xs: number[]): number {
  const s = xs.sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
}

/** Each block's colour (the median of its middle), as a cols x rows image, and block R². */
export function blockColours(img: Rgba, g: GridFit): { img: Rgba; r2: number } {
  const W = img.width, H = img.height, d = img.data;
  const out: Rgba = { width: g.cols, height: g.rows, data: new Uint8Array(g.cols * g.rows * 4) };
  const range = (f: AxisFit, k: number, len: number, inset: number): [number, number] => {
    const a = f.offset + k * f.pitch, b = a + f.pitch;
    let lo = Math.ceil(a + f.pitch * inset), hi = Math.floor(b - f.pitch * inset - 1e-9);
    lo = Math.max(0, lo); hi = Math.min(len - 1, hi);
    if (hi < lo) { const m = Math.min(len - 1, Math.max(0, Math.floor((a + b) / 2))); lo = hi = m; }
    return [lo, hi];
  };
  for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.cols; i++) {
    const [x0, x1] = range(g.x, g.i0 + i, W, 0.25), [y0, y1] = range(g.y, g.j0 + j, H, 0.25);
    const ch: number[][] = [[], [], [], []];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let c = 0; c < 4; c++) ch[c]!.push(d[(y * W + x) * 4 + c]!);
    for (let c = 0; c < 4; c++) out.data[(j * g.cols + i) * 4 + c] = Math.round(median(ch[c]!));
  }
  // R²: every pixel against its block's mean, over the pixels inside the grid.
  const sums = new Float64Array(g.cols * g.rows * 3), counts = new Float64Array(g.cols * g.rows);
  const cellOf = (q: number, f: AxisFit, k0: number, n: number) => {
    const k = Math.floor((q + 0.5 - f.offset) / f.pitch) - k0;
    return k >= 0 && k < n ? k : -1;
  };
  const cx = Int32Array.from({ length: W }, (_, x) => cellOf(x, g.x, g.i0, g.cols));
  const cy = Int32Array.from({ length: H }, (_, y) => cellOf(y, g.y, g.j0, g.rows));
  let n = 0;
  const tot = [0, 0, 0];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (cx[x]! < 0 || cy[y]! < 0) continue;
    const b = cy[y]! * g.cols + cx[x]!, i = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) { sums[b * 3 + c]! += d[i + c]!; tot[c]! += d[i + c]!; }
    counts[b]!++; n++;
  }
  let ssTot = 0, ssIn = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (cx[x]! < 0 || cy[y]! < 0) continue;
    const b = cy[y]! * g.cols + cx[x]!, i = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) {
      const v = d[i + c]!;
      ssTot += (v - tot[c]! / n) ** 2;
      ssIn += (v - sums[b * 3 + c]! / counts[b]!) ** 2;
    }
  }
  return { img: out, r2: ssTot > 0 ? 1 - ssIn / ssTot : 1 };
}

/**
 * The material match (see the top of this file): the layout resampled at each block's centre;
 * each layout colour's blocks give a mean colour; a block matches when its colour is nearest its
 * own layout colour's mean. Null without a layout (or with fewer than two layout colours).
 */
export function materialMatch(blocks: Rgba, layout: Rgba): number | null {
  const n = blocks.width * blocks.height;
  const cls = new Int32Array(n);
  const keys = new Map<number, number>();
  for (let j = 0; j < blocks.height; j++) for (let i = 0; i < blocks.width; i++) {
    const lx = Math.min(layout.width - 1, Math.floor(((i + 0.5) * layout.width) / blocks.width));
    const ly = Math.min(layout.height - 1, Math.floor(((j + 0.5) * layout.height) / blocks.height));
    const o = (ly * layout.width + lx) * 4;
    const key = layout.data[o + 3]! < 128 ? -1 : (layout.data[o]! << 16) | (layout.data[o + 1]! << 8) | layout.data[o + 2]!;
    if (!keys.has(key)) keys.set(key, keys.size);
    cls[j * blocks.width + i] = keys.get(key)!;
  }
  const k = keys.size;
  if (k < 2) return null;
  const mean = new Float64Array(k * 3), cnt = new Float64Array(k);
  for (let b = 0; b < n; b++) { for (let c = 0; c < 3; c++) mean[cls[b]! * 3 + c]! += blocks.data[b * 4 + c]!; cnt[cls[b]!]!++; }
  for (let q = 0; q < k; q++) for (let c = 0; c < 3; c++) mean[q * 3 + c]! /= cnt[q]!;
  let hit = 0;
  for (let b = 0; b < n; b++) {
    let best = -1, bd = Infinity;
    for (let q = 0; q < k; q++) {
      let dd = 0;
      for (let c = 0; c < 3; c++) dd += (blocks.data[b * 4 + c]! - mean[q * 3 + c]!) ** 2;
      if (dd < bd) { bd = dd; best = q; }
    }
    if (best === cls[b]) hit++;
  }
  return hit / n;
}

export interface SnapResult {
  fit: GridFit;
  /** Palette indices, cols x rows (transparent where the image is). */
  px: Uint16Array;
  r2: number;
  material: number | null;
  /** Blocks whose colour had no exact palette entry, and the largest distance. */
  inexact: number;
  worst: number;
  /** Below a threshold: why a reroll is suggested (empty when it passes). */
  reroll: string[];
}

/** Snap an image to the palette (see the top of this file). */
export function snapImage(img: Rgba, palette: Palette, o: { hint?: { x?: number; y?: number }; cells?: { cols: number; rows: number }; layout?: Rgba | null } = {}): SnapResult {
  const fit = fitGrid(img, o.hint, o.cells);
  const { img: blocks, r2 } = blockColours(img, fit);
  const q = quantise(blocks, palette);
  const material = o.layout ? materialMatch(blocks, o.layout) : null;
  const reroll: string[] = [];
  if (r2 < SNAP_MIN_R2) reroll.push(`block R² ${r2.toFixed(2)} is below ${SNAP_MIN_R2}`);
  if (material !== null && material < SNAP_MIN_MATERIAL) reroll.push(`material match ${material.toFixed(2)} is below ${SNAP_MIN_MATERIAL}`);
  return { fit, px: q.px, r2, material, inexact: q.inexact, worst: q.worst, reroll };
}

