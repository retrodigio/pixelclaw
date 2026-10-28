// Densities (plan §4.7): one asset at 1x, 2x and 4x. A higher copy declares `density of=<base>
// d=<n>`; it can start as a nearest-neighbour scale-up of the base (`scale <n>`) and is then
// detailed. A lower copy is authored, not just reduced, so the `density` check runs a reducer over
// the higher copy and reports where it differs from the authored lower one. Reducers are
// pluggable: a profile (or the style guide) names one and its options; more can be registered.

import { TRANSPARENT, flatten, type Doc } from './doc.ts';
import { rgbOf, type Palette } from './palette.ts';
import type { Pt } from './raster.ts';

export interface ReducerOptions {
  /** ink-vote: the entries that count as ink (default: entries named ink, outline or black). */
  ink?: string[];
  /** ink-vote: ink wins when it covers at least this share of the block, as [num, den] (default 1/4). */
  share?: [number, number];
  [k: string]: unknown;
}

/** A reducer: one d x d block of indices (row-major) to one index. */
export type Reducer = (block: Uint16Array, d: number, palette: Palette, o: ReducerOptions) => number;

const lumaOf = (hex: string) => { const [r, g, b] = rgbOf(hex); return 299 * r + 587 * g + 114 * b; };

/** The most common value of a block; ties go to the darker entry, then the lower index (transparent loses ties). */
function mode(block: Uint16Array, palette: Palette): number {
  const n = new Map<number, number>();
  for (const v of block) n.set(v, (n.get(v) ?? 0) + 1);
  let best = TRANSPARENT, bn = -1;
  for (const [v, c] of n) {
    if (c < bn) continue;
    if (c === bn) {
      if (v === TRANSPARENT) continue;
      if (best !== TRANSPARENT) {
        const lv = lumaOf(palette.entries[v]!.hex), lb = lumaOf(palette.entries[best]!.hex);
        if (lv > lb || (lv === lb && v > best)) continue;
      }
    }
    best = v; bn = c;
  }
  return best;
}

export const REDUCERS = new Map<string, Reducer>([
  // The most common colour in the block.
  ['mode', (b, _d, p) => mode(b, p)],
  // The pixel at the block's centre (the lower-right of the middle four).
  ['nearest', (b, d) => b[(d >> 1) * d + (d >> 1)]!],
  // The ink vote: ink wins when it covers a quarter of the block (outlines survive), else the most common colour.
  ['ink-vote', (b, _d, p, o) => {
    const names = o.ink ?? p.entries.filter((e) => /^(ink|outline|black)$/.test(e.name)).map((e) => e.name);
    const ink = new Set(names.map((nm) => p.entries.findIndex((e) => e.name === nm)).filter((i) => i >= 0));
    const [num, den] = o.share ?? [1, 4];
    const n = new Map<number, number>();
    for (const v of b) if (ink.has(v)) n.set(v, (n.get(v) ?? 0) + 1);
    let best = -1, bn = 0;
    for (const [v, c] of n) if (c > bn || (c === bn && v < best)) { best = v; bn = c; }
    if (best >= 0 && bn * den >= num * b.length) return best;
    return mode(b, p);
  }],
]);

export function registerReducer(name: string, r: Reducer): void {
  REDUCERS.set(name, r);
}

/** Reduce w x h indices by d with a reducer: (w/d) x (h/d). */
export function reduceIndices(px: Uint16Array, w: number, h: number, d: number, palette: Palette, reducer = 'mode', o: ReducerOptions = {}): Uint16Array {
  const r = REDUCERS.get(reducer);
  if (!r) throw new Error(`unknown reducer '${reducer}' (reducers: ${[...REDUCERS.keys()].join(', ')})`);
  const W = Math.floor(w / d), H = Math.floor(h / d);
  const out = new Uint16Array(W * H);
  const block = new Uint16Array(d * d);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    for (let j = 0; j < d; j++) for (let i = 0; i < d; i++) block[j * d + i] = px[(y * d + j) * w + x * d + i]!;
    out[y * W + x] = r(block, d, palette, o);
  }
  return out;
}

/** Scale indices up by d, nearest neighbour. */
export function scaleIndices(px: Uint16Array, w: number, h: number, d: number): Uint16Array {
  const out = new Uint16Array(w * d * h * d);
  for (let y = 0; y < h * d; y++) for (let x = 0; x < w * d; x++) out[y * w * d + x] = px[Math.floor(y / d) * w + Math.floor(x / d)]!;
  return out;
}

/** Map one palette's indices onto another by entry name (then colour); unknown entries become TRANSPARENT. */
export function remapByName(px: Uint16Array, from: Palette, to: Palette): Uint16Array {
  const map = from.entries.map((e) => {
    let i = to.entries.findIndex((x) => x.name === e.name);
    if (i < 0) i = to.entries.findIndex((x) => x.hex === e.hex);
    return i < 0 ? TRANSPARENT : i;
  });
  return px.map((v) => (v === TRANSPARENT ? v : map[v]!));
}

export interface DensityDiff {
  /** Pixels of the lower copy where the reduction differs, in the lower copy's coordinates. */
  pts: Pt[];
  /** Over the lower copy's opaque pixels (either side). */
  share: number;
  reduced: Uint16Array;
}

/**
 * Reduce a higher copy (d times the base) to the base's size and compare with the authored base,
 * frame by frame (the frame given, else the first).
 */
export function densityDiff(base: Doc, high: Doc, d: number, reducer = 'mode', o: ReducerOptions = {}, frame = 0): DensityDiff {
  const f = Math.min(frame, high.frameCount - 1);
  const red = reduceIndices(flatten(high, f), high.width, high.height, d, high.palette, reducer, o);
  const reduced = remapByName(red, high.palette, base.palette);
  const ref = flatten(base, Math.min(frame, base.frameCount - 1));
  const pts: Pt[] = [];
  let opaque = 0;
  const W = Math.min(base.width, Math.floor(high.width / d)), H = Math.min(base.height, Math.floor(high.height / d));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = ref[y * base.width + x]!, b = reduced[y * W + x]!;
    if (a !== TRANSPARENT || b !== TRANSPARENT) opaque++;
    if (a !== b) pts.push([x, y]);
  }
  return { pts, share: opaque ? pts.length / opaque : 0, reduced };
}
