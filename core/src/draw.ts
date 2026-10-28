// Drawing for one author: their active cel, clipped by their selection, with their brush and live
// symmetry applied. Every command that writes pixels goes through here.

import { TRANSPARENT, ctxOf, type Brush, type Doc } from './doc.ts';
import { indexOf, type Pt, type Target } from './raster.ts';

/** The author's active cel as a raster target, masked by their selection. */
export function targetOf(doc: Doc, by: string, masked = true): Target {
  const c = ctxOf(doc, by);
  return { width: doc.width, height: doc.height, wrap: doc.wrap, pixels: doc.cels[c.layer]![c.frame]!, mask: masked ? c.sel : null };
}

/** The pixel offsets a brush covers, around its anchor (the middle, rounded up and left). */
export function brushOffsets(doc: Doc, b: Brush | null): Pt[] {
  if (!b) return [[0, 0]];
  if (b.shape === 'stamp') {
    const s = doc.stamps[b.stamp];
    if (!s) return [[0, 0]];
    const out: Pt[] = [];
    for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++) if (s.px[j * s.w + i] !== TRANSPARENT) out.push([i - (s.w >> 1), j - (s.h >> 1)]);
    return out.length ? out : [[0, 0]];
  }
  const n = b.size;
  const out: Pt[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (b.shape === 'circle') {
      // Pixel centres within the circle, in doubled coordinates; n*n - n + 1 rounds 3 to a plus.
      const dx = 2 * i - (n - 1);
      const dy = 2 * j - (n - 1);
      if (dx * dx + dy * dy > n * n - n + 1) continue;
    }
    out.push([i - (n >> 1), j - (n >> 1)]);
  }
  return out;
}

/** The points and their mirror images under the author's live symmetry. */
export function mirrored<T extends Pt | [number, number, number]>(doc: Doc, by: string, pts: T[]): T[] {
  const m = ctxOf(doc, by).mirror;
  if (!m) return pts;
  const out: T[] = [...pts];
  const flip = (p: T, fx: boolean, fy: boolean): T => {
    const q = [...p] as T;
    if (fx) q[0] = m.x2! - p[0];
    if (fy) q[1] = m.y2! - p[1];
    return q;
  };
  for (const p of pts) {
    if (m.x2 !== null) out.push(flip(p, true, false));
    if (m.y2 !== null) out.push(flip(p, false, true));
    if (m.x2 !== null && m.y2 !== null) out.push(flip(p, true, true));
  }
  return out;
}

export interface DrawOptions {
  /** Stamp the author's brush at each point (outline-like commands). */
  brush?: boolean;
  /** Apply live symmetry. */
  mirror?: boolean;
}

/** Plot one colour at the points, as the author draws (brush, symmetry, selection). */
export function drawPoints(doc: Doc, by: string, pts: Pt[], c: number, o: DrawOptions = {}): void {
  const t = targetOf(doc, by);
  let all = pts;
  if (o.brush) {
    const offs = brushOffsets(doc, ctxOf(doc, by).brush);
    if (offs.length !== 1 || offs[0]![0] !== 0 || offs[0]![1] !== 0) all = pts.flatMap(([x, y]) => offs.map(([dx, dy]): Pt => [x + dx, y + dy]));
  }
  if (o.mirror) all = mirrored(doc, by, all);
  for (const [x, y] of all) plotMasked(t, x, y, c);
}

/** Plot coloured points (x, y, colour), as the author draws (symmetry if asked, selection). */
export function drawColoured(doc: Doc, by: string, pts: [number, number, number][], mirror: boolean): void {
  const t = targetOf(doc, by);
  for (const [x, y, c] of mirror ? mirrored(doc, by, pts) : pts) plotMasked(t, x, y, c);
}

function plotMasked(t: Target, x: number, y: number, c: number): void {
  const i = indexOf(t, x, y);
  if (i >= 0 && (!t.mask || t.mask[i])) t.pixels[i] = c;
}
