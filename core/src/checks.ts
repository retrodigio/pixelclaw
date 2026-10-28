// Quality checks (plan §5). Each check reads one frame of a document's flat art and returns a
// score, pass or fail against a threshold (defaults here, overridden by the project's style
// guide), and the pixels it flags. Checks never change the document; they are pure functions of
// the art, so the server, the CLI and the watch view all get the same answers.

import { TRANSPARENT, flatten, type Doc } from './doc.ts';
import { rgbOf, type Palette } from './palette.ts';
import type { Pt } from './raster.ts';
import { hasRoles } from './themes.ts';
import { rampsOf } from './values.ts';

export const CHECK_IDS = ['palette', 'orphans', 'jaggies', 'banding', 'outline', 'seam', 'coverage', 'readability', 'revert', 'repetition'] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export function isCheckId(s: string): s is CheckId {
  return (CHECK_IDS as readonly string[]).includes(s);
}

/** One sub-measure of a check (readability has three). */
export interface CheckPart {
  name: string;
  value: number | null;
  limit: string;
  pass: boolean | null;
  detail: string;
}

/** Flagged pixels with what is wrong with them. */
export interface FlagGroup {
  label: string;
  pts: Pt[];
}

export interface CheckResult {
  id: CheckId;
  status: 'pass' | 'fail' | 'skip';
  /** The measure (null when skipped or not measurable). */
  score: number | null;
  /** The score as a chip shows it: "3", "2.1%", "0.31". */
  shown: string;
  /** The threshold the score is held to: "≤ 1", "≥ 0.85". */
  limit: string;
  /** Every flagged pixel (each once). */
  flagged: Pt[];
  groups: FlagGroup[];
  detail: string;
  parts?: CheckPart[];
}

/** The style guide's part in checking: allowed colours, the outline colours and thresholds. */
export interface CheckStyle {
  /** Colours the art may use (the style guide's palettes). Unset: any colour of the document's palette. */
  palettes?: Palette[];
  /** Entry names that count as outline ink (default: entries named ink, outline or black; else the darkest used). */
  outline?: string[];
  /** Required sizes per kind ("24x24", or several: "24x24|24x48"). */
  sizes?: Record<string, string>;
  /**
   * Threshold overrides per check, from project.json `style.checks`:
   * `{ "orphans": { "max": 1.5, "tile": { "max": 3 } }, "jaggies": { "off": true } }`.
   */
  checks?: Record<string, unknown>;
  /** Per-asset overrides, from `style.assets.<name>.checks` (a laid stone floor's rows are its pattern). */
  assets?: Record<string, { checks?: Record<string, unknown> }>;
}

export interface CheckContext {
  /** The frame to check (0-based; default the first). */
  frame?: number;
  style?: CheckStyle;
  /** readability: the ground the sprite usually stands on (a tile, repeated under it). */
  ground?: Doc | null;
  /** readability: the other assets of its set, for silhouette distinctness. */
  set?: { name: string; doc: Doc }[];
  /** revert: the reference asset the art must not simply copy. */
  ref?: Doc | null;
}

type Params = Record<string, number | boolean>;

/** Default thresholds: for every kind, then per kind. */
const DEFAULTS: Record<CheckId, { all: Params } & Partial<Record<string, Params>>> = {
  palette: { all: { max: 0 } },
  // Stray pixels per 100 opaque pixels. Tiles are texture: a stray one ramp step from its
  // surroundings is allowed there.
  orphans: { all: { max: 1, texture: false }, tile: { max: 2, texture: true } },
  jaggies: { all: { max: 0 }, tile: { max: 2 } },
  // The pillow share: 1 when ramp steps follow the outline on every side alike.
  banding: { all: { max: 0.5, minEdges: 8 } },
  outline: { all: { min: 0.85 } },
  seam: { all: { max: 1 } },
  coverage: { all: { max: 0 } },
  readability: { all: { min: 0.8, delta: 15, maxIou: 0.9, minSpread: 25 } },
  revert: { all: { max: 0.15 } },
  // The most visible stripe when tiled: a band of rows or columns lighter or darker than the
  // rest, ΔL* times the square root of its width.
  repetition: { all: { max: 3 } },
};

/** A check's thresholds for a document kind: defaults, then the style guide's. */
export function checkParams(id: CheckId, kind: string, style?: CheckStyle, asset?: string): Params {
  const d = DEFAULTS[id];
  const out: Params = { ...d.all, ...(d[kind] ?? {}) };
  const merge = (o: unknown) => {
    if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  };
  const s = style?.checks?.[id];
  if (s && typeof s === 'object') {
    merge(s);
    merge((s as Record<string, unknown>)[kind]);
  }
  if (asset) merge(style?.assets?.[asset]?.checks?.[id]);
  return out;
}

// --- colour measures

/** Rec. 601 luma, 0-255. */
export function luma601(hex: string): number {
  const [r, g, b] = rgbOf(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** CIE L* (0-100) of an sRGB colour. */
export function lstar(hex: string): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgbOf(hex);
  const y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}

// --- the image every check reads

interface Img {
  doc: Doc;
  w: number;
  h: number;
  wrap: boolean;
  px: Uint16Array;
  /** Pixel index at x,y, wrapping on wrap documents; -1 outside the canvas. */
  at(x: number, y: number): number;
  /** The colour at x,y (TRANSPARENT outside the canvas). */
  get(x: number, y: number): number;
}

function image(doc: Doc, frame: number): Img {
  const px = flatten(doc, frame);
  const { width: w, height: h, wrap } = doc;
  const at = (x: number, y: number): number => {
    if (wrap) return (((y % h) + h) % h) * w + (((x % w) + w) % w);
    return x < 0 || y < 0 || x >= w || y >= h ? -1 : y * w + x;
  };
  return { doc, w, h, wrap, px, at, get: (x, y) => { const i = at(x, y); return i < 0 ? TRANSPARENT : px[i]!; } };
}

const N4: Pt[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const N8: Pt[] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ptOf = (img: Img, i: number): Pt => [i % img.w, Math.floor(i / img.w)];
const fmt = (n: number, d = 2): string => String(Number(n.toFixed(d)));

function result(id: CheckId, o: Partial<CheckResult> & { status: CheckResult['status']; detail: string }): CheckResult {
  const groups = (o.groups ?? []).map((g) => {
    const once = new Set<number>();
    return { label: g.label, pts: g.pts.filter((p) => { const k = p[1] * 65536 + p[0]; if (once.has(k)) return false; once.add(k); return true; }) };
  });
  const seen = new Set<number>();
  const flagged: Pt[] = [];
  for (const g of groups) for (const p of g.pts) {
    const k = p[1] * 65536 + p[0];
    if (!seen.has(k)) { seen.add(k); flagged.push(p); }
  }
  return { id, score: null, shown: '—', limit: '', flagged, groups, ...o };
}

const skip = (id: CheckId, why: string): CheckResult => result(id, { status: 'skip', detail: why });

/** Is the document a texture tile (wraps), or a sprite with a silhouette? */
const isTile = (d: Doc): boolean => d.wrap;

// --- palette

function checkPalette(img: Img, p: Params, ctx: CheckContext): CheckResult {
  const pal = img.doc.palette;
  const roleArt = hasRoles(pal);
  const allowed = ctx.style?.palettes?.length ? new Set(ctx.style.palettes.flatMap((x) => x.entries.map((e) => e.hex))) : null;
  const by = new Map<string, Pt[]>();
  const add = (label: string, i: number) => { if (!by.has(label)) by.set(label, []); by.get(label)!.push(ptOf(img, i)); };
  let opaque = 0;
  for (let i = 0; i < img.px.length; i++) {
    const v = img.px[i]!;
    if (v === TRANSPARENT) continue;
    opaque++;
    const e = pal.entries[v];
    if (!e) add(`index ${v} is not a palette entry`, i);
    else if (roleArt && !e.role) add(`${e.name} is a fixed colour in role art`, i);
    else if (allowed && !e.role && !allowed.has(e.hex)) add(`${e.name} ${e.hex} is not in the style palettes`, i);
  }
  const groups = [...by].map(([label, pts]) => ({ label, pts }));
  const n = groups.reduce((s, g) => s + g.pts.length, 0);
  const max = Number(p.max);
  const scope = roleArt ? 'role entries' : allowed ? `the style palettes (${ctx.style!.palettes!.map((x) => x.name).join(', ')})` : `palette '${pal.name}'`;
  return result('palette', {
    status: n <= max ? 'pass' : 'fail', score: n, shown: String(n), limit: `≤ ${max}`, groups,
    detail: n === 0 ? `all ${opaque} px are ${roleArt ? 'role entries' : `in ${scope}`}` : `${n} px outside ${scope}: ${groups.map((g) => `${g.label} (${g.pts.length})`).join('; ')}`,
  });
}

// --- orphans

/** How many ramp steps apart two entries are (Infinity when they share no ramp). */
function rampSteps(pal: Palette, a: number, b: number): number {
  let best = Infinity;
  for (const r of rampsOf(pal, a)) {
    const j = r.ramp.indexOf(b);
    if (j >= 0) best = Math.min(best, Math.abs(j - r.at));
  }
  return best;
}

/** The size of a pixel's 8-connected same-colour cluster, counted up to `cap`. */
function clusterSize(img: Img, i0: number, cap: number): number {
  const c = img.px[i0]!;
  const seen = new Set([i0]);
  const stack = [i0];
  while (stack.length && seen.size < cap) {
    const i = stack.pop()!;
    const [x, y] = ptOf(img, i);
    for (const [dx, dy] of N8) {
      const j = img.at(x + dx, y + dy);
      if (j >= 0 && !seen.has(j) && img.px[j] === c) { seen.add(j); stack.push(j); }
    }
  }
  return seen.size;
}

function checkOrphans(img: Img, p: Params): CheckResult {
  const lone: Pt[] = [];
  const near: Pt[] = [];
  let opaque = 0;
  let excused = 0;
  for (let i = 0; i < img.px.length; i++) {
    const c = img.px[i]!;
    if (c === TRANSPARENT) continue;
    opaque++;
    const [x, y] = ptOf(img, i);
    if (N4.some(([dx, dy]) => img.get(x + dx, y + dy) === c)) continue;
    // A pixel on a diagonal line is not a stray: only clusters of one, or two touching corners.
    const size = clusterSize(img, i, 3);
    if (size > 2) continue;
    if (p.texture) {
      const counts = new Map<number, number>();
      for (const [dx, dy] of N4) {
        const v = img.get(x + dx, y + dy);
        if (v !== TRANSPARENT) counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      const around = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
      if (around !== undefined && rampSteps(img.doc.palette, c, around) === 1) { excused++; continue; }
    }
    (size === 1 ? lone : near).push([x, y]);
  }
  const n = lone.length + near.length;
  const score = opaque ? (100 * n) / opaque : 0;
  const max = Number(p.max);
  const groups = [
    ...(lone.length ? [{ label: 'lone pixel (no neighbour shares its colour)', pts: lone }] : []),
    ...(near.length ? [{ label: 'near-orphan (a diagonal pair)', pts: near }] : []),
  ];
  return result('orphans', {
    status: score <= max ? 'pass' : 'fail', score, shown: `${fmt(score, 1)}%`, limit: `≤ ${max}%`, groups,
    detail: `${n} stray px in ${opaque} (${lone.length} lone, ${near.length} near-orphans)${p.texture ? `; ${excused} one ramp step from their surroundings allowed as texture` : ''}`,
  });
}

// --- jaggies

/** The commonest value (the lowest of equals). */
function modeOf(px: Uint16Array): number {
  const counts = new Map<number, number>();
  for (const v of px) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
}

/** Same-colour 8-neighbours. */
function sameN8(img: Img, x: number, y: number): Pt[] {
  const c = img.get(x, y);
  return N8.filter(([dx, dy]) => img.get(x + dx, y + dy) === c).map(([dx, dy]): Pt => [x + dx, y + dy]);
}

const same = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];

/**
 * Pixel runs along a path of pixels (a thin line or a silhouette's contour), split into straight
 * or gently curving segments (one axial and one diagonal direction each). Returns the irregular
 * runs: a run longer or shorter than both neighbours where the three differ by 2 or more
 * (1-2-1-3), never the cut runs at a segment's ends.
 */
export function irregularRuns(path: Pt[], w: number, h: number, wrap: boolean): Pt[][] {
  const out: Pt[][] = [];
  const step = (a: Pt, b: Pt): Pt => {
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    if (wrap) { if (dx > 1) dx -= w; if (dx < -1) dx += w; if (dy > 1) dy -= h; if (dy < -1) dy += h; }
    return [dx, dy];
  };
  const flush = (runs: Pt[][]) => {
    const r = runs.map((x) => x.length);
    for (let i = 2; i <= r.length - 3; i++) {
      const a = r[i - 1]!, b = r[i]!, c = r[i + 1]!;
      const zig = (b > a && b > c) || (b < a && b < c);
      if (zig && Math.max(a, b, c) - Math.min(a, b, c) >= 2) out.push(runs[i]!);
    }
  };
  let axial: Pt | null = null;
  let diag: Pt | null = null;
  let runs: Pt[][] = path.length ? [[path[0]!]] : [];
  for (let i = 1; i < path.length; i++) {
    const d = step(path[i - 1]!, path[i]!);
    const isAxial = (d[0] === 0) !== (d[1] === 0);
    const fits = (ax: Pt | null, dg: Pt | null): boolean => !ax || !dg || (ax[0] !== 0 ? ax[0] === dg[0] : ax[1] === dg[1]);
    let ok: boolean;
    if (isAxial) ok = axial ? same(axial, d) : fits(d, diag);
    else ok = diag ? same(diag, d) : fits(axial, d);
    if (!ok) {
      flush(runs);
      runs = [[path[i - 1]!]];
      axial = null;
      diag = null;
    }
    if (isAxial) { axial = d; runs[runs.length - 1]!.push(path[i]!); } else { diag = d; runs.push([path[i]!]); }
  }
  flush(runs);
  return out;
}

/** The outer contour of each 8-connected opaque shape, by Moore-neighbour tracing (clockwise). */
function contours(img: Img): Pt[][] {
  const seen = new Uint8Array(img.px.length);
  const out: Pt[][] = [];
  const opaque = (x: number, y: number) => img.get(x, y) !== TRANSPARENT;
  for (let i = 0; i < img.px.length; i++) {
    if (img.px[i] === TRANSPARENT || seen[i]) continue;
    // Mark the shape, so each is traced once from its first pixel in reading order.
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      const [x, y] = ptOf(img, j);
      for (const [dx, dy] of N8) {
        const k = img.at(x + dx, y + dy);
        if (k >= 0 && !seen[k] && img.px[k] !== TRANSPARENT) { seen[k] = 1; stack.push(k); }
      }
    }
    const start = ptOf(img, i);
    // Clockwise from west (y grows downward): W NW N NE E SE S SW.
    const ring: Pt[] = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];
    const dirOf = (dx: number, dy: number) => ring.findIndex(([rx, ry]) => rx === dx && ry === dy);
    const path: Pt[] = [start];
    let cur = start;
    let back = 0; // the outside pixel we backtrack to, as a direction from cur: west of the start
    for (let guard = 0; guard < 4 * img.px.length + 8; guard++) {
      let k = 1;
      while (k <= 8 && !opaque(cur[0] + ring[(back + k) % 8]![0], cur[1] + ring[(back + k) % 8]![1])) k++;
      if (k > 8) break; // a single pixel
      const d = ring[(back + k) % 8]!;
      const prev = ring[(back + k - 1) % 8]!;
      const next: Pt = [cur[0] + d[0], cur[1] + d[1]];
      if (same(cur, start) && path.length > 1 && same(next, path[1]!)) break;
      back = dirOf(prev[0] - d[0], prev[1] - d[1]);
      cur = next;
      path.push(cur);
    }
    if (path.length > 1 && same(path[path.length - 1]!, start)) path.pop();
    out.push(path);
  }
  return out;
}

/** Thin lines of one colour (each pixel with one or two same-colour neighbours), at least `min` long. */
function thinChains(img: Img, min: number): Pt[][] {
  const deg = new Int8Array(img.px.length).fill(-1);
  for (let i = 0; i < img.px.length; i++) {
    if (img.px[i] === TRANSPARENT) continue;
    const [x, y] = ptOf(img, i);
    deg[i] = sameN8(img, x, y).length;
  }
  const used = new Uint8Array(img.px.length);
  const out: Pt[][] = [];
  for (let i = 0; i < img.px.length; i++) {
    if (deg[i] !== 1 || used[i]) continue;
    const chain: Pt[] = [];
    let cur = i;
    for (;;) {
      used[cur] = 1;
      const p = ptOf(img, cur);
      chain.push(p);
      const nb = sameN8(img, p[0], p[1]).map(([x, y]) => img.at(x, y)).filter((j) => !used[j]);
      if (nb.length !== 1 || (deg[nb[0]!]! !== 1 && deg[nb[0]!]! !== 2)) break;
      cur = nb[0]!;
    }
    if (chain.length >= min) out.push(chain);
  }
  return out;
}

function checkJaggies(img: Img, p: Params): CheckResult {
  // A doubled L-corner: a pixel whose only same-colour 4-neighbours are one horizontal and one
  // vertical, with the corner between them empty, where the line zig-zags through it (it steps
  // the same way before and after, as a staircase does): a pixel-perfect line steps diagonally
  // there. A corner where the line turns and carries on (a box, a hook) is meant.
  // On a tile the commonest colour is the ground the marks sit on, not a line.
  const ground = isTile(img.doc) ? modeOf(img.px) : -1;
  const elbows: Pt[] = [];
  for (let i = 0; i < img.px.length; i++) {
    const c = img.px[i]!;
    if (c === TRANSPARENT || c === ground) continue;
    const [x, y] = ptOf(img, i);
    const n4 = N4.filter(([dx, dy]) => img.get(x + dx, y + dy) === c);
    if (n4.length !== 2) continue;
    const h = n4.find(([, dy]) => dy === 0);
    const v = n4.find(([dx]) => dx === 0);
    if (!h || !v || img.get(x + h[0] + v[0], y + v[1]) === c) continue;
    const zig = img.get(x + v[0] - h[0], y + v[1]) === c || img.get(x + h[0], y - v[1]) === c;
    if (zig) elbows.push([x, y]);
  }
  // Touching elbows are one doubled corner.
  let corners = 0;
  {
    const key = (q: Pt) => img.at(q[0], q[1]);
    const left = new Set(elbows.map(key));
    for (const e of elbows) {
      if (!left.has(key(e))) continue;
      corners++;
      const stack = [e];
      left.delete(key(e));
      while (stack.length) {
        const [x, y] = stack.pop()!;
        for (const [dx, dy] of N4) {
          const k = img.at(x + dx, y + dy);
          if (left.has(k)) { left.delete(k); stack.push(ptOf(img, k)); }
        }
      }
    }
  }
  // Irregular runs on thin lines and on silhouettes; a run found on both (a line is its own
  // silhouette) counts once.
  const runSets = new Map<string, Pt[]>();
  const addRuns = (runs: Pt[][]) => { for (const r of runs) runSets.set(r.map((q) => img.at(q[0], q[1])).sort((a, b) => a - b).join(','), r); };
  for (const chain of thinChains(img, 6)) if (img.get(chain[0]![0], chain[0]![1]) !== ground) addRuns(irregularRuns(chain, img.w, img.h, img.wrap));
  if (!isTile(img.doc)) for (const path of contours(img)) addRuns(irregularRuns(path, img.w, img.h, false));
  const irregular = [...runSets.values()].flat();
  const spikes: Pt[] = [];
  const notches: Pt[] = [];
  if (!isTile(img.doc)) {
    const op = (x: number, y: number) => img.get(x, y) !== TRANSPARENT;
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      const n4 = N4.filter(([dx, dy]) => op(x + dx, y + dy));
      if (op(x, y)) {
        if (n4.length !== 1) continue;
        const [qx, qy] = [x + n4[0]![0], y + n4[0]![1]];
        const base = N4.filter(([dx, dy]) => op(qx + dx, qy + dy)).length;
        const n8 = N8.filter(([dx, dy]) => op(x + dx, y + dy)).length;
        if (base >= 3 && n8 <= 3) spikes.push([x, y]);
      } else if (n4.length === 4) notches.push([x, y]);
      else if (n4.length === 3) {
        // A dent in a solid edge: the shape is at least two pixels deep behind it (the inside of
        // a thin bracket is not a notch).
        const open = N4.find(([dx, dy]) => !op(x + dx, y + dy))!;
        if (op(x - 2 * open[0], y - 2 * open[1])) notches.push([x, y]);
      }
    }
  }
  const groups = [
    ...(elbows.length ? [{ label: 'doubled L-corner', pts: elbows }] : []),
    ...(irregular.length ? [{ label: 'irregular step run', pts: irregular }] : []),
    ...(spikes.length ? [{ label: 'spike on the outline', pts: spikes }] : []),
    ...(notches.length ? [{ label: 'notch in the outline', pts: notches }] : []),
  ];
  // Each doubled corner, spike and notch is one defect; so is an irregular run, however long.
  const runs = runSets.size;
  const n = corners + runs + spikes.length + notches.length;
  const max = Number(p.max);
  return result('jaggies', {
    status: n <= max ? 'pass' : 'fail', score: n, shown: String(n), limit: `≤ ${max}`, groups,
    detail: n === 0 ? 'lines and outlines step evenly' : `${corners} doubled L-corners, ${runs} irregular step runs, ${spikes.length} spikes, ${notches.length} notches`,
  });
}

// --- banding

/** 4-distance of every opaque pixel to the nearest transparent pixel or the canvas edge (1 on the edge). */
function edgeDistance(img: Img): Int32Array {
  const d = new Int32Array(img.px.length).fill(0);
  const q: number[] = [];
  for (let i = 0; i < img.px.length; i++) {
    if (img.px[i] === TRANSPARENT) continue;
    const [x, y] = ptOf(img, i);
    if (N4.some(([dx, dy]) => img.get(x + dx, y + dy) === TRANSPARENT)) { d[i] = 1; q.push(i); }
  }
  for (let h = 0; h < q.length; h++) {
    const i = q[h]!;
    const [x, y] = ptOf(img, i);
    for (const [dx, dy] of N4) {
      const j = img.at(x + dx, y + dy);
      if (j >= 0 && img.px[j] !== TRANSPARENT && d[j] === 0) { d[j] = d[i]! + 1; q.push(j); }
    }
  }
  return d;
}

/** The outline colours: the style's, else entries named ink, outline or black, else the darkest colour used. */
function inkSet(img: Img, style?: CheckStyle): Set<number> {
  const pal = img.doc.palette;
  const names = style?.outline?.length ? style.outline : ['ink', 'outline', 'black'];
  const set = new Set(pal.entries.flatMap((e, i) => (names.includes(e.name) ? [i] : [])));
  if (set.size || style?.outline?.length) return set;
  let best = -1;
  for (const v of new Set(img.px)) if (v !== TRANSPARENT && (best < 0 || luma601(pal.entries[v]!.hex) < luma601(pal.entries[best]!.hex))) best = v;
  return new Set(best >= 0 ? [best] : []);
}

/** The first ramp two entries share (its index in the palette's ramps), or -1. */
function sharedRamp(pal: Palette, a: number, b: number): number {
  const names = Object.keys(pal.ramps);
  const na = pal.entries[a]?.name;
  const nb = pal.entries[b]?.name;
  return names.findIndex((r) => pal.ramps[r]!.includes(na!) && pal.ramps[r]!.includes(nb!));
}

/**
 * Pillow shading, per material: for the ramp steps that follow the outline (the inner pixel one
 * step further from the edge), which way lightness goes inward on each side of the shape. Light
 * from one side makes the lit side and the far side disagree; pillow shading goes the same way
 * on all four sides. The score is the weakest side's agreement for the worst ramp (0 to 1).
 */
function checkBanding(img: Img, p: Params, ctx: CheckContext): CheckResult {
  if (isTile(img.doc)) return skip('banding', 'tiles have no silhouette to band along');
  const pal = img.doc.palette;
  const d = edgeDistance(img);
  const ink = inkSet(img, ctx.style);
  const L = pal.entries.map((e) => luma601(e.hex));
  const hasRamps = Object.keys(pal.ramps).length > 0;
  const rampNames = Object.keys(pal.ramps);
  // Per ramp: counts by inward direction (E from the west side, S from the top, W, N) and sign.
  const by = new Map<number, { count: number[][]; edges: { p: Pt; sign: number }[] }>();
  for (let i = 0; i < img.px.length; i++) {
    const a = img.px[i]!;
    if (a === TRANSPARENT || ink.has(a)) continue;
    const [x, y] = ptOf(img, i);
    N4.forEach(([dx, dy], dir) => {
      const j = img.at(x + dx, y + dy);
      if (j < 0) return;
      const b = img.px[j]!;
      if (b === TRANSPARENT || b === a || ink.has(b) || d[j] !== d[i]! + 1) return;
      const r = hasRamps ? sharedRamp(pal, a, b) : 0;
      if (r < 0) return;
      const sign = Math.sign(L[b]! - L[a]!);
      if (!sign) return;
      if (!by.has(r)) by.set(r, { count: N4.map(() => [0, 0]), edges: [] });
      const g = by.get(r)!;
      g.count[dir]![sign > 0 ? 0 : 1]!++;
      g.edges.push({ p: [x, y], sign });
    });
  }
  const minEdges = Number(p.minEdges);
  const max = Number(p.max);
  const sides = ['west', 'top', 'east', 'bottom'];
  let worst = { score: 0, ramp: -1, sign: 0, net: [0, 0, 0, 0], n: 0 };
  let total = 0;
  for (const [r, g] of by) {
    total += g.edges.length;
    if (g.edges.length < minEdges) continue;
    const net = g.count.map(([pos, neg]) => (pos! + neg! >= 2 ? (pos! - neg!) / (pos! + neg!) : 0));
    const sign = Math.sign(net[0]!);
    const score = sign !== 0 && net.every((n) => Math.sign(n) === sign) ? Math.min(...net.map(Math.abs)) : 0;
    if (score > worst.score || worst.ramp < 0) worst = { score, ramp: r, sign, net, n: g.edges.length };
  }
  const name = hasRamps && worst.ramp >= 0 ? `ramp ${rampNames[worst.ramp]}` : 'the colours';
  if (worst.ramp < 0) {
    return result('banding', { status: 'pass', score: 0, shown: '0', limit: `≤ ${max}`, detail: `${total} ramp steps follow the outline; too few to band` });
  }
  const fail = worst.score > max;
  const pts = fail ? by.get(worst.ramp)!.edges.filter((e) => e.sign === worst.sign).map((e) => e.p) : [];
  return result('banding', {
    status: fail ? 'fail' : 'pass', score: worst.score, shown: fmt(worst.score), limit: `≤ ${max}`,
    groups: fail ? [{ label: `pillow shading in ${name}: it gets ${worst.sign > 0 ? 'lighter' : 'darker'} inward on every side`, pts }] : [],
    detail: `${name}: ${worst.n} ramp steps along the outline; inward ${worst.net.map((n, k) => `${sides[k]} ${n > 0 ? '+' : ''}${fmt(n)}`).join(', ')}` +
      (fail ? ' (the same on every side: light one side and shade the other)' : ''),
  });
}

// --- outline

/** Opaque pixels with a transparent 4-neighbour (or the canvas edge, on documents that do not wrap). */
function silhouetteEdge(img: Img): number[] {
  const out: number[] = [];
  for (let i = 0; i < img.px.length; i++) {
    if (img.px[i] === TRANSPARENT) continue;
    const [x, y] = ptOf(img, i);
    if (N4.some(([dx, dy]) => img.get(x + dx, y + dy) === TRANSPARENT)) out.push(i);
  }
  return out;
}

function checkOutline(img: Img, p: Params, ctx: CheckContext): CheckResult {
  if (isTile(img.doc)) return skip('outline', 'tiles have no silhouette');
  const edge = silhouetteEdge(img);
  if (!edge.length) return skip('outline', 'nothing drawn');
  const ink = inkSet(img, ctx.style);
  const gaps = edge.filter((i) => !ink.has(img.px[i]!));
  const share = 1 - gaps.length / edge.length;
  const min = Number(p.min);
  const names = [...ink].map((i) => img.doc.palette.entries[i]!.name).join(', ') || 'none';
  return result('outline', {
    status: share >= min ? 'pass' : 'fail', score: share, shown: fmt(share), limit: `≥ ${min}`,
    groups: gaps.length ? [{ label: `silhouette edge not in the outline colour (${names})`, pts: gaps.map((i) => ptOf(img, i)) }] : [],
    detail: `${edge.length - gaps.length} of ${edge.length} silhouette edge px are ${names}${gaps.length ? `; ${gaps.length} gaps` : ''}`,
  });
}

// --- seam (plan §13: the pilot's metric, exactly)

const mean = (a: number[]): number => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const std = (a: number[]): number => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((v) => (v - m) * (v - m))));
};

/**
 * The seam metric on a class image (H x W, row-major) of a tiling with tile size t along x:
 * `jump` (border columns differ from their neighbours more often than other columns do) and
 * `line` (border columns are darker or lighter than the rest).
 */
export function seamAxis(cls: Int32Array, grey: Float64Array, W: number, H: number, t: number): { jump: number; line: number } {
  const mis: number[] = [];
  for (let k = 0; k <= W - 2; k++) {
    let n = 0;
    for (let y = 0; y < H; y++) if (cls[y * W + k] !== cls[y * W + k + 1]) n++;
    mis.push(n / H);
  }
  const isb = mis.map((_, k) => (k + 1) % t === 0);
  const border = mis.filter((_, k) => isb[k]);
  const rest = mis.filter((_, k) => !isb[k]);
  const jump = (mean(border) - mean(rest)) / (std(rest) + 0.02);
  const colm: number[] = [];
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let y = 0; y < H; y++) s += grey[y * W + x]!;
    colm.push(s / H);
  }
  const touch = colm.map((_, x) => ((x + 1) % t === 0 || x % t === 0) && x !== 0 && x !== W - 1);
  const tc = colm.filter((_, x) => touch[x]);
  const nc = colm.filter((_, x) => !touch[x]);
  const line = Math.abs(mean(tc) - mean(nc)) / (std(nc) + 2.0);
  return { jump, line };
}

/** The seam score of a tile: its art tiled 3x3, both axes; max(jx, jy, lx, ly, 0). */
export function seamScore(doc: Doc, frame = 0): { score: number; jx: number; jy: number; lx: number; ly: number } {
  const px = flatten(doc, frame);
  const { width: w, height: h } = doc;
  const L = doc.palette.entries.map((e) => luma601(e.hex));
  const W = 3 * w;
  const H = 3 * h;
  const cls = new Int32Array(W * H);
  const grey = new Float64Array(W * H);
  const clsT = new Int32Array(W * H);
  const greyT = new Float64Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = px[(y % h) * w + (x % w)]!;
    const c = v === TRANSPARENT ? -1 : v;
    const g = v === TRANSPARENT ? 0 : L[v]!;
    cls[y * W + x] = c; grey[y * W + x] = g;
    clsT[x * H + y] = c; greyT[x * H + y] = g;
  }
  const ax = seamAxis(cls, grey, W, H, w);
  const ay = seamAxis(clsT, greyT, H, W, h);
  return { score: Math.max(ax.jump, ay.jump, ax.line, ay.line, 0), jx: ax.jump, jy: ay.jump, lx: ax.line, ly: ay.line };
}

function checkSeam(img: Img, p: Params, ctx: CheckContext): CheckResult {
  if (!img.wrap) return skip('seam', 'not a wrap (tile) document');
  const s = seamScore(img.doc, ctx.frame ?? 0);
  const max = Number(p.max);
  const groups: FlagGroup[] = [];
  const { w, h } = img;
  if (s.jx > max || s.lx > max) {
    const pts: Pt[] = [];
    for (let y = 0; y < h; y++) if (s.lx > max || img.get(w - 1, y) !== img.get(0, y)) pts.push([0, y], [w - 1, y]);
    groups.push({ label: s.lx > max ? 'left and right edge columns stand out (a line at the seam)' : 'the colour changes across the left-right seam', pts });
  }
  if (s.jy > max || s.ly > max) {
    const pts: Pt[] = [];
    for (let x = 0; x < w; x++) if (s.ly > max || img.get(x, h - 1) !== img.get(x, 0)) pts.push([x, 0], [x, h - 1]);
    groups.push({ label: s.ly > max ? 'top and bottom edge rows stand out (a line at the seam)' : 'the colour changes across the top-bottom seam', pts });
  }
  return result('seam', {
    status: s.score <= max ? 'pass' : 'fail', score: s.score, shown: fmt(s.score), limit: `≤ ${max}`, groups,
    detail: `jump x ${fmt(s.jx)} y ${fmt(s.jy)}; line x ${fmt(s.lx)} y ${fmt(s.ly)} (about 1 or less reads as no seam)`,
  });
}

// --- coverage

function checkCoverage(img: Img, p: Params, ctx: CheckContext): CheckResult {
  const d = img.doc;
  const missing: string[] = [];
  const groups: FlagGroup[] = [];
  const want = ctx.style?.sizes?.[d.kind];
  if (want && !want.split('|').map((s) => s.trim()).includes(`${d.width}x${d.height}`)) missing.push(`size ${d.width}x${d.height} is not the style's ${want} for a ${d.kind}`);
  if (d.width % d.cellW || d.height % d.cellH) missing.push(`size ${d.width}x${d.height} is not a whole number of ${d.cellW}x${d.cellH} cells`);
  for (let f = 0; f < d.frameCount; f++) {
    const px = flatten(d, f);
    if (px.every((v) => v === TRANSPARENT)) { missing.push(`frame ${f + 1} is empty`); continue; }
    if (d.cellW >= d.width && d.cellH >= d.height) continue;
    for (let cy = 0; cy + d.cellH <= d.height; cy += d.cellH) for (let cx = 0; cx + d.cellW <= d.width; cx += d.cellW) {
      let empty = true;
      for (let y = cy; y < cy + d.cellH && empty; y++) for (let x = cx; x < cx + d.cellW; x++) if (px[y * d.width + x] !== TRANSPARENT) { empty = false; break; }
      if (!empty) continue;
      missing.push(`cell (${cx / d.cellW},${cy / d.cellH})${d.frameCount > 1 ? ` of frame ${f + 1}` : ''} is empty`);
      const pts: Pt[] = [];
      for (let i = 0; i < d.cellW; i++) pts.push([cx + i, cy], [cx + i, cy + d.cellH - 1]);
      for (let j = 1; j < d.cellH - 1; j++) pts.push([cx, cy + j], [cx + d.cellW - 1, cy + j]);
      groups.push({ label: `empty cell (${cx / d.cellW},${cy / d.cellH})`, pts });
    }
  }
  const max = Number(p.max);
  return result('coverage', {
    status: missing.length <= max ? 'pass' : 'fail', score: missing.length, shown: String(missing.length), limit: `≤ ${max}`, groups,
    detail: missing.length ? missing.join('; ') : `${d.frameCount} frame${d.frameCount > 1 ? 's' : ''}, every cell drawn${want ? `, size ${want}` : ''} (autotile names come with schemes)`,
  });
}

// --- readability

function checkReadability(img: Img, p: Params, ctx: CheckContext): CheckResult {
  if (isTile(img.doc)) return skip('readability', 'tiles are ground, not figures');
  const pal = img.doc.palette;
  const Ls = pal.entries.map((e) => lstar(e.hex));
  const opaque: number[] = [];
  for (let i = 0; i < img.px.length; i++) if (img.px[i] !== TRANSPARENT) opaque.push(i);
  if (!opaque.length) return skip('readability', 'nothing drawn');
  const parts: CheckPart[] = [];
  const groups: FlagGroup[] = [];
  let score: number | null = null;
  const delta = Number(p.delta);
  const ground = ctx.ground;
  if (ground) {
    const gpx = flatten(ground, 0);
    const gL = ground.palette.entries.map((e) => lstar(e.hex));
    const at = (x: number, y: number) => {
      const v = gpx[(((y % ground.height) + ground.height) % ground.height) * ground.width + (((x % ground.width) + ground.width) % ground.width)]!;
      return v === TRANSPARENT ? null : gL[v]!;
    };
    const low: Pt[] = [];
    let n = 0;
    for (const i of silhouetteEdge(img)) {
      const [x, y] = ptOf(img, i);
      let best = -1;
      for (const [dx, dy] of N4) {
        if (img.get(x + dx, y + dy) !== TRANSPARENT) continue;
        const g = at(x + dx, y + dy);
        if (g !== null) best = Math.max(best, Math.abs(Ls[img.px[i]!]! - g));
      }
      if (best < 0) continue;
      n++;
      if (best < delta) low.push([x, y]);
    }
    score = n ? 1 - low.length / n : 1;
    const min = Number(p.min);
    parts.push({ name: 'edge contrast', value: score, limit: `≥ ${min}`, pass: score >= min, detail: `${n - low.length} of ${n} edge px differ from '${ground.name}' by ΔL* ≥ ${delta}` });
    if (low.length) groups.push({ label: `edge too close to the ground '${ground.name}' (ΔL* < ${delta})`, pts: low });
  } else {
    parts.push({ name: 'edge contrast', value: null, limit: '', pass: null, detail: 'no ground tile to judge against' });
  }
  const others = (ctx.set ?? []).filter((o) => !o.doc.wrap && o.doc.width === img.w && o.doc.height === img.h && o.doc.name !== img.doc.name);
  if (others.length) {
    const mine = img.px.map((v) => (v === TRANSPARENT ? 0 : 1));
    let worst = { name: '', iou: 0 };
    for (const o of others) {
      const opx = flatten(o.doc, Math.min(ctx.frame ?? 0, o.doc.frameCount - 1));
      let inter = 0, uni = 0;
      for (let i = 0; i < opx.length; i++) {
        const a = mine[i]!, b = opx[i] !== TRANSPARENT ? 1 : 0;
        if (a && b) inter++;
        if (a || b) uni++;
      }
      const iou = uni ? inter / uni : 0;
      if (iou > worst.iou || !worst.name) worst = { name: o.name, iou };
    }
    const maxIou = Number(p.maxIou);
    parts.push({ name: 'distinct silhouette', value: worst.iou, limit: `≤ ${maxIou}`, pass: worst.iou <= maxIou, detail: `most like '${worst.name}' (IoU ${fmt(worst.iou)})` });
  }
  const sorted = opaque.map((i) => Ls[img.px[i]!]!).sort((a, b) => a - b);
  const q = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))]!;
  const spread = q(0.95) - q(0.05);
  const minSpread = Number(p.minSpread);
  parts.push({ name: 'lightness spread', value: spread, limit: `≥ ${minSpread}`, pass: spread >= minSpread, detail: `L* ${fmt(q(0.05), 0)}..${fmt(q(0.95), 0)} inside the sprite` });
  const fail = parts.some((x) => x.pass === false);
  return result('readability', {
    status: fail ? 'fail' : 'pass', score, shown: score === null ? (fail ? '✗' : '✓') : fmt(score), limit: parts[0]!.limit || '', groups, parts,
    detail: parts.map((x) => `${x.name}: ${x.detail}`).join('; '),
  });
}

// --- revert

function checkRevert(img: Img, p: Params, ctx: CheckContext): CheckResult {
  const ref = ctx.ref;
  if (!ref) return skip('revert', 'no reference asset (give ref=<asset>)');
  const rpx = flatten(ref, Math.min(ctx.frame ?? 0, ref.frameCount - 1));
  const copied: Pt[] = [];
  let union = 0;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const a = img.px[y * img.w + x]!;
    const b = x < ref.width && y < ref.height ? rpx[y * ref.width + x]! : TRANSPARENT;
    if (a === TRANSPARENT && b === TRANSPARENT) continue;
    union++;
    if (a !== TRANSPARENT && b !== TRANSPARENT && img.doc.palette.entries[a]!.hex === ref.palette.entries[b]!.hex) copied.push([x, y]);
  }
  const share = union ? copied.length / union : 0;
  const max = Number(p.max);
  return result('revert', {
    status: share <= max ? 'pass' : 'fail', score: share, shown: `${fmt(100 * share, 0)}%`, limit: `≤ ${fmt(100 * max, 0)}%`,
    groups: share > max ? [{ label: `same colour as '${ref.name}'`, pts: copied }] : [],
    detail: `${copied.length} of ${union} px are unchanged from '${ref.name}'`,
  });
}

// --- repetition (tiles)

/**
 * The most visible stripe a tile makes when it is tiled: every band of 1 to 6 whole rows (or
 * columns) repeats across a tiled floor as a stripe, so the band whose mean lightness differs
 * most from the tile's shows. The score is that difference in L* times the square root of the
 * band's width (wider bands show at lower contrast). Random noise on a calm ramp scores about 2;
 * marks that line up in rows score more.
 */
export function repetitionScore(doc: Doc, frame = 0): { score: number; axis: 'rows' | 'columns'; from: number; width: number; delta: number } {
  const px = flatten(doc, frame);
  const { width: w, height: h } = doc;
  const L = doc.palette.entries.map((e) => lstar(e.hex));
  const v = Float64Array.from(px, (c) => (c === TRANSPARENT ? 0 : L[c]!));
  const mu = v.reduce((s, x) => s + x, 0) / v.length;
  let best = { score: 0, axis: 'rows' as 'rows' | 'columns', from: 0, width: 1, delta: 0 };
  for (const axis of ['rows', 'columns'] as const) {
    const n = axis === 'rows' ? h : w;
    const len = axis === 'rows' ? w : h;
    const lines = Array.from({ length: n }, (_, k) => {
      let s = 0;
      for (let i = 0; i < len; i++) s += axis === 'rows' ? v[k * w + i]! : v[i * w + k]!;
      return s / len;
    });
    for (let width = 1; width <= Math.min(6, Math.floor(n / 4)) || width === 1; width++) {
      for (let k = 0; k < n; k++) {
        let s = 0;
        for (let i = 0; i < width; i++) s += lines[(k + i) % n]!;
        const delta = s / width - mu;
        const score = Math.abs(delta) * Math.sqrt(width);
        if (score > best.score + 1e-9) best = { score, axis, from: k, width, delta };
      }
      if (n < 4) break;
    }
  }
  return best;
}

function checkRepetition(img: Img, p: Params, ctx: CheckContext): CheckResult {
  if (!img.wrap) return skip('repetition', 'not a wrap (tile) document');
  const r = repetitionScore(img.doc, ctx.frame ?? 0);
  const max = Number(p.max);
  const fail = r.score > max;
  const n = r.axis === 'rows' ? img.h : img.w;
  const len = r.axis === 'rows' ? img.w : img.h;
  const band: Pt[] = [];
  for (let i = 0; i < r.width; i++) for (let j = 0; j < len; j++) {
    const k = (r.from + i) % n;
    band.push(r.axis === 'rows' ? [j, k] : [k, j]);
  }
  // The pixels that make the band stand out: those darker (or lighter) than the tile's commonest colour.
  const counts = new Map<number, number>();
  for (const v of img.px) counts.set(v, (counts.get(v) ?? 0) + 1);
  const mode = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
  const L = (v: number) => (v === TRANSPARENT ? 0 : lstar(img.doc.palette.entries[v]!.hex));
  const marks = band.filter(([x, y]) => { const v = img.get(x, y); return v !== mode && Math.sign(L(v) - L(mode)) === Math.sign(r.delta); });
  const pts = marks.length ? marks : band;
  const last = (r.from + r.width - 1) % n;
  const where = r.width === 1 ? `${r.axis === 'rows' ? 'row' : 'column'} ${r.from}` : `${r.axis} ${r.from}-${last}`;
  const tone = r.delta < 0 ? 'darker' : 'lighter';
  return result('repetition', {
    status: fail ? 'fail' : 'pass', score: r.score, shown: fmt(r.score, 1), limit: `≤ ${max}`,
    groups: fail ? [{ label: `${where}: ${tone} than the rest (ΔL* ${fmt(Math.abs(r.delta), 1)}), a stripe when tiled`, pts }] : [],
    detail: `most visible stripe: ${where}, ${tone} by ΔL* ${fmt(Math.abs(r.delta), 1)} (score ΔL*·√width ${fmt(r.score, 1)})`,
  });
}

// --- all together

const RUNNERS: Record<CheckId, (img: Img, p: Params, ctx: CheckContext) => CheckResult> = {
  palette: checkPalette, orphans: checkOrphans, jaggies: checkJaggies, banding: checkBanding, outline: checkOutline,
  seam: checkSeam, coverage: checkCoverage, readability: checkReadability, revert: checkRevert, repetition: checkRepetition,
};

/**
 * Run checks on one frame of a document (all of them by default). A check that does not apply
 * (seam on a sprite, outline on a tile, revert with no reference) or that the style guide turns
 * off (`"off": true`) comes back as `skip`.
 */
export function runChecks(doc: Doc, ids: readonly CheckId[] = CHECK_IDS, ctx: CheckContext = {}): CheckResult[] {
  const img = image(doc, ctx.frame ?? 0);
  return ids.map((id) => {
    const p = checkParams(id, doc.kind, ctx.style, doc.name);
    if (p.off === true) return skip(id, 'turned off in the style guide');
    return RUNNERS[id](img, p, ctx);
  });
}

/** One line for a run result: every check that applies, with ✓ or ✗. */
export function checkSummary(results: CheckResult[]): string {
  const shown = results.filter((r) => r.status !== 'skip');
  if (!shown.length) return 'checks: none apply';
  const failing = shown.filter((r) => r.status === 'fail').length;
  return `checks: ${shown.map((r) => `${r.id} ${r.shown} ${r.status === 'pass' ? '✓' : '✗'}`).join(' · ')}` +
    (failing ? `  (${failing} failing: \`check\` gives coordinates)` : '');
}
