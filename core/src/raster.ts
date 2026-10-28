// Raster primitives on one cel. Integer maths only. On a wrap document coordinates past an edge
// wrap around (the canvas is a torus, for seamless tiles); otherwise they are clipped.

import { TRANSPARENT } from './doc.ts';

export interface Target {
  width: number;
  height: number;
  wrap: boolean;
  pixels: Uint16Array;
}

export type Pt = [number, number];

const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** The pixel index for x,y, or -1 when clipped. */
export function indexOf(t: Target, x: number, y: number): number {
  if (t.wrap) return mod(y, t.height) * t.width + mod(x, t.width);
  if (x < 0 || y < 0 || x >= t.width || y >= t.height) return -1;
  return y * t.width + x;
}

export function plot(t: Target, x: number, y: number, c: number): void {
  const i = indexOf(t, x, y);
  if (i >= 0) t.pixels[i] = c;
}

/**
 * The pixels of one straight segment, in order from a to b. The N pixels along the major axis are
 * shared out as evenly as possible among the R rows (or columns) the line crosses, so a line whose
 * pixel count divides evenly has equal steps (0,0 11,3 is 3-3-3-3, never 2-4-4-2), and the rest are
 * spread symmetrically (0,0 6,2 is 2-3-2). Each step advances the major axis by one: 8-connected,
 * no L-corners. Run boundaries round to nearest, ties toward the nearer end (the middle tie toward
 * the endpoint first in (major, minor) order), so the pixels depend only on the two endpoints.
 */
export function segment(a: Pt, b: Pt): Pt[] {
  const xMajor = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
  const key = (p: Pt): [number, number] => (xMajor ? [p[0], p[1]] : [p[1], p[0]]);
  const [ka, kb] = [key(a), key(b)];
  const swap = kb[0] < ka[0] || (kb[0] === ka[0] && kb[1] < ka[1]);
  const [s, e] = swap ? [kb, ka] : [ka, kb];
  const n = e[0] - s[0] + 1; // pixels
  const r = Math.abs(e[1] - s[1]) + 1; // runs
  const sign = e[1] < s[1] ? -1 : 1;
  const boundary = (j: number): number => {
    const num = 2 * j * n + r;
    const den = 2 * r;
    let q = Math.floor(num / den);
    if (num % den === 0 && 2 * j <= r) q -= 1;
    return q;
  };
  const out: Pt[] = [];
  for (let j = 0; j < r; j++) {
    for (let i = boundary(j); i < boundary(j + 1); i++) {
      const maj = s[0] + i;
      const min = s[1] + sign * j;
      out.push(xMajor ? [maj, min] : [min, maj]);
    }
  }
  if (swap) out.reverse();
  return out;
}

/**
 * A polyline through the given vertices. With pixelPerfect, a pixel that forms a doubled L-corner
 * (its neighbours on the path touch diagonally) is dropped, except at a vertex joining two straight
 * horizontal or vertical segments, where the right angle is meant.
 */
export function polyline(vertices: Pt[], pixelPerfect: boolean): Pt[] {
  const path: Pt[] = [];
  const keep = new Set<number>(); // path indices of right-angle vertices
  for (let v = 0; v < vertices.length; v++) {
    if (v === 0) {
      path.push(vertices[0]!);
      continue;
    }
    const seg = segment(vertices[v - 1]!, vertices[v]!);
    for (let k = 1; k < seg.length; k++) path.push(seg[k]!);
    if (v < vertices.length - 1) {
      const [p, q, r] = [vertices[v - 1]!, vertices[v]!, vertices[v + 1]!];
      const axis1 = p[0] === q[0] || p[1] === q[1];
      const axis2 = q[0] === r[0] || q[1] === r[1];
      if (axis1 && axis2) keep.add(path.length - 1);
    }
  }
  if (!pixelPerfect || path.length < 3) return dedupe(path);
  const out: Pt[] = [path[0]!];
  for (let i = 1; i < path.length - 1; i++) {
    const prev = out[out.length - 1]!;
    const cur = path[i]!;
    const next = path[i + 1]!;
    const lCorner =
      Math.abs(prev[0] - next[0]) === 1 && Math.abs(prev[1] - next[1]) === 1 &&
      (prev[0] === cur[0] || prev[1] === cur[1]) && (next[0] === cur[0] || next[1] === cur[1]);
    if (lCorner && !keep.has(i)) continue;
    out.push(cur);
  }
  out.push(path[path.length - 1]!);
  return dedupe(out);
}

function dedupe(path: Pt[]): Pt[] {
  return path.filter((p, i) => i === 0 || p[0] !== path[i - 1]![0] || p[1] !== path[i - 1]![1]);
}

export function rectPixels(x: number, y: number, w: number, h: number, fill: boolean): Pt[] {
  const out: Pt[] = [];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (fill || j === 0 || j === h - 1 || i === 0 || i === w - 1) out.push([x + i, y + j]);
    }
  }
  return out;
}

/**
 * An ellipse inscribed in the box x0..x1, y0..y1 (inclusive), after Alois Zingl's integer
 * algorithm ("A Rasterizing Algorithm for Drawing Curves", 2012). Filled ellipses fill each row
 * between the outline's extremes.
 */
export function ellipsePixels(x0: number, y0: number, x1: number, y1: number, fill: boolean): Pt[] {
  const set = new Map<number, [number, number]>(); // row -> [minX, maxX]
  const outline: Pt[] = [];
  const put = (x: number, y: number): void => {
    outline.push([x, y]);
    const r = set.get(y);
    if (!r) set.set(y, [x, x]);
    else { r[0] = Math.min(r[0], x); r[1] = Math.max(r[1], x); }
  };
  let a = Math.abs(x1 - x0);
  const b = Math.abs(y1 - y0);
  let b1 = b & 1;
  let dx = 4 * (1 - a) * b * b;
  let dy = 4 * (b1 + 1) * a * a;
  let err = dx + dy + b1 * a * a;
  if (x0 > x1) { x0 = x1; x1 += a; }
  if (y0 > y1) y0 = y1;
  y0 += (b + 1) >> 1;
  y1 = y0 - b1;
  a *= 8 * a;
  b1 = 8 * b * b;
  do {
    put(x1, y0); put(x0, y0); put(x0, y1); put(x1, y1);
    const e2 = 2 * err;
    if (e2 <= dy) { y0++; y1--; dy += a; err += dy; }
    if (e2 >= dx || 2 * err > dy) { x0++; x1--; dx += b1; err += dx; }
  } while (x0 <= x1);
  while (y0 - y1 <= b) {
    put(x0 - 1, y0); put(x1 + 1, y0++);
    put(x0 - 1, y1); put(x1 + 1, y1--);
  }
  if (!fill) return uniq(outline);
  const out: Pt[] = [];
  for (const [y, [lo, hi]] of [...set.entries()].sort((p, q) => p[0] - q[0])) for (let x = lo; x <= hi; x++) out.push([x, y]);
  return out;
}

function uniq(pts: Pt[]): Pt[] {
  const seen = new Set<string>();
  return pts.filter(([x, y]) => (seen.has(`${x},${y}`) ? false : (seen.add(`${x},${y}`), true)));
}

/** Flood fill from x,y (4- or 8-connected; across edges on wrap targets), or a global colour swap. */
export function fill(t: Target, x: number, y: number, c: number, global: boolean, conn: 4 | 8): void {
  const start = indexOf(t, x, y);
  if (start < 0) return;
  const from = t.pixels[start]!;
  if (from === c) return;
  if (global) {
    for (let i = 0; i < t.pixels.length; i++) if (t.pixels[i] === from) t.pixels[i] = c;
    return;
  }
  const steps: Pt[] = conn === 4 ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const stack = [start];
  t.pixels[start] = c;
  while (stack.length) {
    const i = stack.pop()!;
    const px = i % t.width;
    const py = (i - px) / t.width;
    for (const [sx, sy] of steps) {
      const j = indexOf(t, px + sx, py + sy);
      if (j >= 0 && t.pixels[j] === from) {
        t.pixels[j] = c;
        stack.push(j);
      }
    }
  }
}

export { TRANSPARENT };
