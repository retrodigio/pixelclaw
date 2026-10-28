// Autotile schemes (plan §4.2) are data: core/schemes/*.json says which neighbours count, the
// variants, their names and how each is built from four quadrants. This module reads them,
// resolves a neighbourhood to its variant, finds which authored piece supplies each quadrant of
// every other variant, and gives the quadrant geometry the derivation draws bands and lays
// textures with. Everything is integer maths.

import blob47 from '../schemes/blob47.json' with { type: 'json' };
import bridge8 from '../schemes/bridge8.json' with { type: 'json' };
import face from '../schemes/face.json' with { type: 'json' };
import path from '../schemes/path.json' with { type: 'json' };
import single from '../schemes/single.json' with { type: 'json' };
import wang16 from '../schemes/wang16-corner.json' with { type: 'json' };

/** Neighbourhood bits. Corner schemes use the diagonal bits for a tile's own corners. */
export const NB = { N: 1, NE: 2, E: 4, SE: 8, S: 16, SW: 32, W: 64, NW: 128 } as const;
/** Bits in N, NE, E, … order with their offsets. */
export const NB_DIRS: [number, number, number][] = [[1, 0, -1], [2, 1, -1], [4, 1, 0], [8, 1, 1], [16, 0, 1], [32, -1, 1], [64, -1, 0], [128, -1, -1]];

export type Neighbours = '8' | '4' | 'axis' | 'corners' | 'none';
/** The geometry a quadrant kind is drawn with. */
export type BaseKind = 'in' | 'out' | 'outer' | 'inner' | 'horiz' | 'vert';
const BASE: readonly string[] = ['in', 'out', 'outer', 'inner', 'horiz', 'vert'];
/** A quadrant (or the corner a kind faces): 0 NW, 1 NE, 2 SW, 3 SE. */
export type Quad = 0 | 1 | 2 | 3;
const QUAD_NAMES = ['nw', 'ne', 'sw', 'se'];

export interface SchemeVariant {
  name: string;
  /** The reduced neighbourhood that resolves to it (null: placed by name only). */
  key: number | null;
  /** Kinds of the quadrants NW, NE, SW, SE, as written ("outer", "vert@se"). */
  quads: string[];
  /** 'face': drawn in the cell below the terrain (the face scheme's south faces). */
  on?: 'face';
}

export interface SchemeJson {
  name: string;
  description: string;
  neighbours: Neighbours;
  cornerRule?: boolean;
  /** The strip's inset from the tile's edges as a fraction of the tile (path, bridge8). */
  inset?: [number, number];
  /** Extra kinds and the geometry each is drawn with. */
  kinds?: Record<string, string>;
  faces?: boolean;
  columns: number;
  pieces: string[];
  variants: SchemeVariant[];
}

/** A quadrant's kind, its geometry and the corner it faces. */
export interface QuadSpec {
  kind: string;
  base: BaseKind;
  face: Quad;
}

export interface Scheme extends SchemeJson {
  /** quadSpecs[v][q]: variant v's quadrant q. */
  quadSpecs: QuadSpec[][];
  /** For each variant and quadrant: the piece (variant index) and its quadrant that supply it; null for pieces. */
  sources: ([number, Quad][] | null)[];
  byName: Map<string, number>;
  byKey: Map<number, number>;
  faceByKey: Map<number, number>;
}

export class SchemeError extends Error {}

function quadSpec(s: SchemeJson, text: string, q: Quad): QuadSpec {
  const [kind, at] = text.split('@') as [string, string | undefined];
  const base = BASE.includes(kind) ? kind : s.kinds?.[kind];
  if (!base || !BASE.includes(base)) throw new SchemeError(`scheme ${s.name}: unknown quadrant kind '${kind}'`);
  const face = at === undefined ? q : QUAD_NAMES.indexOf(at);
  if (face < 0) throw new SchemeError(`scheme ${s.name}: '${text}' faces no corner (nw, ne, sw, se)`);
  return { kind, base: base as BaseKind, face: face as Quad };
}

/** Check a scheme's data and work out where every derived quadrant comes from. */
export function loadScheme(s: SchemeJson): Scheme {
  const byName = new Map<string, number>();
  const byKey = new Map<number, number>();
  const faceByKey = new Map<number, number>();
  s.variants.forEach((v, i) => {
    if (!/^[a-z][a-z0-9_]*$/.test(v.name)) throw new SchemeError(`scheme ${s.name}: '${v.name}' is not a usable variant name`);
    if (byName.has(v.name)) throw new SchemeError(`scheme ${s.name}: variant '${v.name}' twice`);
    if (v.quads.length !== 4) throw new SchemeError(`scheme ${s.name}: variant '${v.name}' needs 4 quads`);
    byName.set(v.name, i);
    if (v.key === null) return;
    const m = v.on === 'face' ? faceByKey : byKey;
    if (m.has(v.key)) throw new SchemeError(`scheme ${s.name}: key ${v.key} is both ${s.variants[m.get(v.key)!]!.name} and ${v.name}`);
    m.set(v.key, i);
  });
  const quadSpecs = s.variants.map((v) => v.quads.map((t, q) => quadSpec(s, t, q as Quad)));
  const pieces = s.pieces.map((p) => {
    const i = byName.get(p);
    if (i === undefined) throw new SchemeError(`scheme ${s.name}: piece '${p}' is not a variant`);
    return i;
  });
  const sources = s.variants.map((v, i) => {
    if (pieces.includes(i)) return null;
    return quadSpecs[i]!.map((spec, q): [number, Quad] => {
      for (const p of pieces) {
        const at = quadSpecs[p]!.findIndex((x) => x.kind === spec.kind && x.face === spec.face);
        if (at >= 0) return [p, at as Quad];
      }
      throw new SchemeError(`scheme ${s.name}: no piece has the ${spec.kind}@${QUAD_NAMES[spec.face]} quadrant variant '${v.name}' needs`);
    });
  });
  return { ...s, quadSpecs, sources, byName, byKey, faceByKey };
}

export const BUILTIN_SCHEMES: ReadonlyMap<string, Scheme> = new Map(
  ([blob47, wang16, path, bridge8, single, face] as SchemeJson[]).map((s) => [s.name, loadScheme(s)]),
);

export function schemeNamed(name: string): Scheme | undefined {
  return BUILTIN_SCHEMES.get(name);
}

/** The reduced key of a neighbourhood (bits of the neighbours that are the same terrain). */
export function reduceKey(s: SchemeJson, bits: number): number {
  const { N, NE, E, SE, S, SW, W, NW } = NB;
  switch (s.neighbours) {
    case 'none': return 0;
    case 'corners': return bits & (NE | SE | SW | NW);
    case '4': return bits & (N | E | S | W);
    case 'axis': return bits & (E | W) ? bits & (E | W) : bits & (N | S);
    case '8': {
      let k = bits & (N | E | S | W);
      if (!s.cornerRule) return bits & 255;
      if ((bits & N) && (bits & E) && (bits & NE)) k |= NE;
      if ((bits & S) && (bits & E) && (bits & SE)) k |= SE;
      if ((bits & S) && (bits & W) && (bits & SW)) k |= SW;
      if ((bits & N) && (bits & W) && (bits & NW)) k |= NW;
      return k;
    }
  }
}

/**
 * The variant (index) for a cell. `here`: the cell is the scheme's terrain; `bits`: which
 * neighbours are (for corner schemes: which of the tile's corners are). A cell outside the
 * terrain has a variant only in a face scheme, below the terrain. Null: plain outside.
 */
export function resolveVariant(s: Scheme, here: boolean, bits: number): number | null {
  if (s.neighbours === 'corners') return s.byKey.get(reduceKey(s, bits)) ?? null;
  if (here) return s.byKey.get(reduceKey(s, bits)) ?? null;
  if (!s.faces || !(bits & NB.N)) return null;
  // A face joins the faces beside it: a neighbour out of the terrain with terrain above it.
  const k = ((bits & NB.E) === 0 && (bits & NB.NE) ? NB.E : 0) | ((bits & NB.W) === 0 && (bits & NB.NW) ? NB.W : 0);
  return s.faceByKey.get(k) ?? null;
}

/** The variants a map can produce, in the scheme's order (the north-south single bridge cannot). */
export function reachable(s: Scheme): number[] {
  return s.variants.flatMap((v, i) => (v.key === null ? [] : [i]));
}

// --- Terrain grids: which cells (or, for corner schemes, which corners) are the terrain.

export interface Terrain {
  /** Cells across and down (the tiles of the map). */
  cols: number;
  rows: number;
  /** Edge schemes: cols x rows cells. Corner schemes: (cols+1) x (rows+1) corners. 1 = terrain. */
  cells: Uint8Array;
}

export const terrainWidth = (s: SchemeJson, t: Terrain): number => (s.neighbours === 'corners' ? t.cols + 1 : t.cols);

/** Every tile of a map: its variant (index) or null for plain outside. Outside the map is outside. */
export function resolveMap(s: Scheme, t: Terrain): (number | null)[] {
  const tw = terrainWidth(s, t);
  const at = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < tw && y < t.cells.length / tw && t.cells[y * tw + x] === 1;
  const out: (number | null)[] = [];
  for (let y = 0; y < t.rows; y++) for (let x = 0; x < t.cols; x++) {
    if (s.neighbours === 'corners') {
      const bits = (at(x + 1, y) ? NB.NE : 0) | (at(x + 1, y + 1) ? NB.SE : 0) | (at(x, y + 1) ? NB.SW : 0) | (at(x, y) ? NB.NW : 0);
      out.push(resolveVariant(s, true, bits));
      continue;
    }
    let bits = 0;
    for (const [b, dx, dy] of NB_DIRS) if (at(x + dx, y + dy)) bits |= b;
    out.push(resolveVariant(s, at(x, y), bits));
  }
  return out;
}

// --- Quadrant geometry

/** The band across a terrain's edge: widths from the edge inward, each a colour or a texture. */
export type BandFill = number | 'outside' | 'inside';
export interface Band {
  w: number;
  fill: BandFill;
}

export interface Geometry {
  /** How far inside the tile's edges the terrain's edge runs (path and bridge strips). */
  inset: number;
  /** The radius of the band's inner edge at outer corners (0: square). */
  radius: number;
  bands: Band[];
}

/** The total band width. */
export const bandWidth = (g: Geometry): number => g.bands.reduce((s, b) => s + b.w, 0);

/**
 * Doubled distances of a pixel's centre from the edge lines of a quadrant facing `face`, for a
 * tile of size t: U across (from the vertical edge), V down (from the horizontal one).
 */
function uv(t: number, q: Quad, face: Quad, x: number, y: number, inset: number): [number, number] {
  const h = t / 2;
  const qx = q & 1 ? h : 0;
  const qy = q & 2 ? h : 0;
  const u = face & 1 ? qx + h - 1 - x : x - qx;
  const v = face & 2 ? qy + h - 1 - y : y - qy;
  return [2 * (u - inset) + 1, 2 * (v - inset) + 1];
}

const isq = (n: number): number => n * n;

/**
 * Is the pixel's distance into the terrain (doubled) below K? Negative distances are outside the
 * terrain. Outer corners are round: every contour is an arc about one centre, so the band's inner
 * edge has `radius` and its outer contours are wider.
 */
function below(base: BaseKind, U: number, V: number, K: number, C: number): boolean {
  switch (base) {
    case 'in': return false;
    case 'out': return true;
    case 'horiz': return V < K;
    case 'vert': return U < K;
    case 'outer': {
      if (U >= C || V >= C) return Math.min(U, V) < K;
      // d = C - sqrt((C-U)^2 + (C-V)^2) < K  <=>  sqrt(..) > C - K
      return C - K < 0 || isq(C - U) + isq(C - V) > isq(C - K);
    }
    case 'inner': {
      if (U > 0 && V > 0) return K > 0 && isq(U) + isq(V) < isq(K);
      if (U > 0) return U < K;
      if (V > 0) return V < K;
      return true;
    }
  }
}

/**
 * Which band a pixel of a quadrant lies in: -1 outside the terrain, 0..n-1 a band, n inside past
 * the band (n = the number of bands).
 */
export function bandAt(spec: QuadSpec, t: number, q: Quad, x: number, y: number, g: Geometry): number {
  const [U, V] = uv(t, q, spec.face, x, y, g.inset);
  const C = 2 * (bandWidth(g) + g.radius);
  if (below(spec.base, U, V, 0, C)) return -1;
  let k = 0;
  for (let i = 0; i < g.bands.length; i++) {
    k += 2 * g.bands[i]!.w;
    if (below(spec.base, U, V, k, C)) return i;
  }
  return g.bands.length;
}

/** The quadrant a tile-local pixel is in. */
export const quadOf = (t: number, x: number, y: number): Quad => (((y >= t / 2 ? 2 : 0) | (x >= t / 2 ? 1 : 0)) as Quad);

/**
 * A variant's band map: for each pixel of the tile, its band (-1 outside .. n inside past the band).
 */
export function bandMap(s: Scheme, v: number, t: number, g: Geometry): Int8Array {
  const out = new Int8Array(t * t);
  for (let y = 0; y < t; y++) for (let x = 0; x < t; x++) {
    const q = quadOf(t, x, y);
    out[y * t + x] = bandAt(s.quadSpecs[v]![q]!, t, q, x, y, g);
  }
  return out;
}

/** A scheme's default inset for a tile size. */
export function defaultInset(s: SchemeJson, t: number): number {
  return s.inset ? Math.floor((t * s.inset[0]) / s.inset[1]) : 0;
}
