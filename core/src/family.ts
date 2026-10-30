// Autotile families (plan §4.2, §4.3): the sheet's layout, the live derivation of every variant
// from the shared textures and the authored pieces (run after every command, like mirror views),
// sample maps composed with the scheme (random islands and coverage maps), the seam score over a
// map, cutting variants from a painted coverage map, and overlays played over a map.

import { frameAtTick, loopTicks, playOrder, sequences, type Sequence } from './anim.ts';
import { TRANSPARENT, flatten, type Doc, type FamilyState, type OverlayState } from './doc.ts';
import { luma601, seamAxis } from './checks.ts';
import { Pcg32 } from './pcg.ts';
import {
  bandMap, bandWidth, loadScheme, reachable, resolveMap, schemeNamed, terrainWidth, type Geometry, type Scheme, type Terrain,
} from './schemes.ts';

import type { Pt } from './raster.ts';

export const GROUND_LAYER = 'ground';
export const BAND_LAYER = 'band';

/** The scheme of a family (built in). */
const loaded = new Map<string, Scheme>();

export function schemeOf(f: FamilyState): Scheme {
  if (f.def) {
    const k = JSON.stringify(f.def);
    const hit = loaded.get(k);
    if (hit) return hit;
    const s = loadScheme(f.def);
    loaded.set(k, s);
    return s;
  }
  const s = schemeNamed(f.scheme);
  if (!s) throw new Error(`unknown scheme '${f.scheme}'`);
  return s;
}

export interface FamilyLayout {
  /** Cells across and down the sheet. */
  cols: number;
  rows: number;
  /** The inside and outside textures' cells. */
  inside: Pt;
  outside: Pt;
  /** Each variant's cell, in the scheme's order. */
  cells: Pt[];
  /** The coverage map's first row (cells), when the family has one. */
  mapRow: number;
}

/**
 * The sheet: row 0 holds the two textures; then the variants, `columns` to a row, in the scheme's
 * order; then the coverage map, if the family has one.
 */
export function familyLayout(s: Scheme, mapCols: number, mapRows: number): FamilyLayout {
  const n = s.variants.length;
  const cols = Math.max(2, s.columns, mapCols);
  const vRows = Math.ceil(n / s.columns);
  const cells = s.variants.map((_, i): Pt => [i % s.columns, 1 + Math.floor(i / s.columns)]);
  return { cols, rows: 1 + vRows + mapRows, inside: [0, 0], outside: [1, 0], cells, mapRow: 1 + vRows };
}

export const layoutOf = (f: FamilyState): FamilyLayout => familyLayout(schemeOf(f), f.mapCols, f.mapRows);

/** A cell by name: `inside`, `outside` or a variant. */
export function familyCell(f: FamilyState, name: string): Pt | null {
  const L = layoutOf(f);
  if (name === 'inside') return L.inside;
  if (name === 'outside') return L.outside;
  const i = schemeOf(f).byName.get(name);
  return i === undefined ? null : L.cells[i]!;
}

/** The name of the cell under a pixel of the sheet (a texture, a variant, `map` or null). */
export function familyCellAt(f: FamilyState, x: number, y: number): string | null {
  const L = layoutOf(f);
  const cx = Math.floor(x / f.tile), cy = Math.floor(y / f.tile);
  if (cx === L.inside[0] && cy === L.inside[1]) return 'inside';
  if (cx === L.outside[0] && cy === L.outside[1]) return 'outside';
  if (f.mapRows && cy >= L.mapRow && cx < f.mapCols) return 'map';
  const i = L.cells.findIndex(([a, b]) => a === cx && b === cy);
  return i < 0 ? null : schemeOf(f).variants[i]!.name;
}

const masks = new Map<string, Int8Array[]>();

/** Every variant's band map (cached: they depend only on the scheme, the tile size and the geometry). */
export function bandMaps(s: Scheme, t: number, g: Geometry): Int8Array[] {
  const key = `${s.name}|${t}|${g.inset}|${g.radius}|${g.fillet ?? ''}|${g.jitter ? `${g.jitter.px}:${g.jitter.seed}` : ''}|${g.bands.map((b) => `${b.w}:${b.fill}`).join(',')}`;
  let m = masks.get(key);
  if (!m) {
    m = s.variants.map((_, v) => bandMap(s, v, t, g));
    if (masks.size > 64) masks.clear();
    masks.set(key, m);
  }
  return m;
}

/** Does a band index show the outside texture underneath (-1 is outside the terrain)? */
export function showsOutside(g: Geometry, b: number): boolean {
  return b < 0 || (b < g.bands.length && g.bands[b]!.fill === 'outside');
}

/** Is a band index part of the band (the pixels a cut keeps): the edge's bands, from the edge in? */
export const inBand = (g: Geometry, b: number): boolean => b >= 0 && b < g.bands.length;

function copyBlock(cel: Uint16Array, W: number, sx: number, sy: number, dx: number, dy: number, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    const s = (sy + y) * W + sx;
    cel.copyWithin((dy + y) * W + dx, s, s + w);
  }
}

/** A tile-sized block of a frame's flat art (the art layers composited), without flattening the whole sheet. */
function artBlock(d: Doc, fr: number, cx: number, cy: number, t: number): Uint16Array {
  const out = new Uint16Array(t * t).fill(TRANSPARENT);
  d.layers.forEach((l, li) => {
    if (l.hidden || l.reference) return;
    const cel = d.cels[li]![fr]!;
    for (let y = 0; y < t; y++) for (let x = 0; x < t; x++) {
      const v = cel[(cy * t + y) * d.width + cx * t + x]!;
      if (v !== TRANSPARENT) out[y * t + x] = v;
    }
  });
  return out;
}

const outMasks = new WeakMap<Int8Array[], Uint8Array[]>();
/** Per variant, the pixels that show the outside texture (cached with the band maps). */
function outsideMasks(s: Scheme, t: number, g: Geometry, maps: Int8Array[]): Uint8Array[] {
  let m = outMasks.get(maps);
  if (!m) {
    m = maps.map((b) => Uint8Array.from(b, (x) => (showsOutside(g, x) ? 1 : 0)));
    outMasks.set(maps, m);
  }
  void s; void t;
  return m;
}

/**
 * Derive a family's variants on every frame: each variant's ground is the inside or outside
 * texture at the same pixel of the tile, by its band map (the textures are re-projected, so every
 * variant tiles with the plain textures and with each other); each variant that is not a piece and
 * not detached takes its band layer from the pieces' quadrants.
 */
export function syncFamily(d: Doc): void {
  const f = d.family;
  if (!f) return;
  const s = schemeOf(f);
  const t = f.tile;
  const h = t / 2;
  const W = d.width;
  const L = layoutOf(f);
  const maps = bandMaps(s, t, f.geometry);
  const gl = d.layers.findIndex((l) => l.name === GROUND_LAYER);
  const bl = d.layers.findIndex((l) => l.name === BAND_LAYER);
  const detached = new Set(f.detached.map((n) => s.byName.get(n)));
  const done = new Set<Uint16Array>();
  for (let fr = 0; fr < d.frameCount; fr++) {
    if (gl >= 0 && !done.has(d.cels[gl]![fr]!)) {
      const cel = d.cels[gl]![fr]!;
      done.add(cel);
      // The textures as they look (every art layer), so they can be drawn on any layer.
      const inside = artBlock(d, fr, L.inside[0], L.inside[1], t), outside = artBlock(d, fr, L.outside[0], L.outside[1], t);
      const outs = outsideMasks(s, t, f.geometry, maps);
      for (let v = 0; v < s.variants.length; v++) {
        const [cx, cy] = L.cells[v]!;
        const o = outs[v]!;
        for (let y = 0; y < t; y++) {
          const row = (cy * t + y) * W + cx * t;
          for (let x = 0; x < t; x++) { const k = y * t + x; cel[row + x] = o[k] ? outside[k]! : inside[k]!; }
        }
      }
    }
    if (bl >= 0 && !done.has(d.cels[bl]![fr]!)) {
      const cel = d.cels[bl]![fr]!;
      done.add(cel);
      for (let v = 0; v < s.variants.length; v++) {
        const src = s.sources[v];
        if (!src || detached.has(v)) continue;
        const [cx, cy] = L.cells[v]!;
        src.forEach(([p, pq], q) => {
          if (p < 0) {
            for (let y = 0; y < h; y++) cel.fill(TRANSPARENT, (cy * t + (q & 2 ? h : 0) + y) * W + cx * t + (q & 1 ? h : 0), (cy * t + (q & 2 ? h : 0) + y) * W + cx * t + (q & 1 ? h : 0) + h);
            return;
          }
          const [px, py] = L.cells[p]!;
          copyBlock(cel, W, px * t + (pq & 1 ? h : 0), py * t + (pq & 2 ? h : 0), cx * t + (q & 1 ? h : 0), cy * t + (q & 2 ? h : 0), h, h);
        });
      }
    }
  }
}

// --- Maps

/** A tile-sized block of a flat image. */
function block(px: Uint16Array, W: number, cx: number, cy: number, t: number): Uint16Array {
  const out = new Uint16Array(t * t);
  for (let y = 0; y < t; y++) out.set(px.subarray((cy * t + y) * W + cx * t, (cy * t + y) * W + cx * t + t), y * t);
  return out;
}

export interface MapImage {
  /** Palette indices, w x h. */
  px: Uint16Array;
  w: number;
  h: number;
  t: number;
  /** Each tile's variant (index into the scheme's variants), null for plain outside. */
  variants: (number | null)[];
}

/**
 * A map composed from the family's sheet: each tile its variant's cell (the flat art of a frame),
 * plain outside tiles the outside texture.
 */
export function composeMap(d: Doc, terrain: Terrain, frame = 0): MapImage {
  const f = d.family!;
  const s = schemeOf(f);
  const t = f.tile;
  const L = layoutOf(f);
  const flat = flatten(d, frame);
  const variants = resolveMap(s, terrain);
  const tiles = new Map<number, Uint16Array>();
  const tileOf = (v: number | null) => {
    const k = v ?? -1;
    let b = tiles.get(k);
    if (!b) {
      const [cx, cy] = v === null ? L.outside : L.cells[v]!;
      tiles.set(k, (b = block(flat, d.width, cx, cy, t)));
    }
    return b;
  };
  const w = terrain.cols * t, h = terrain.rows * t;
  const px = new Uint16Array(w * h);
  variants.forEach((v, i) => {
    const b = tileOf(v);
    const mx = (i % terrain.cols) * t, my = Math.floor(i / terrain.cols) * t;
    for (let y = 0; y < t; y++) px.set(b.subarray(y * t, y * t + t), (my + y) * w + mx);
  });
  return { px, w, h, t, variants };
}

/** A map of a plain tile: the tile repeated. */
export function tileMap(d: Doc, cols: number, rows: number, frame = 0): MapImage {
  const flat = flatten(d, frame);
  const w = cols * d.width, h = rows * d.height;
  const px = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = flat[(y % d.height) * d.width + (x % d.width)]!;
  return { px, w, h, t: d.width, variants: Array.from({ length: cols * rows }, () => null) };
}

/** A cheap integer hash of a few numbers (for per-tile choices that must not depend on order). */
export function hash32(...ns: number[]): number {
  let h = 0x9e3779b9;
  for (const n of ns) {
    h = Math.imul(h ^ (n | 0), 0x85ebca6b) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
  }
  return h;
}

/**
 * A random island: the terrain is high in the middle and falls off toward the map's edge, with
 * seeded value noise on a coarse grid (cells of 2 tiles) for an irregular coast with bays and
 * spits. Integer maths.
 */
export function islandTerrain(s: Scheme, cols: number, rows: number, seed: number): Terrain {
  const tw = s.neighbours === 'corners' ? cols + 1 : cols;
  const th = s.neighbours === 'corners' ? rows + 1 : rows;
  const rng = new Pcg32(seed, 0x15a);
  const G = 2;
  const gw = Math.floor(tw / G) + 2, gh = Math.floor(th / G) + 2;
  const grid = Array.from({ length: gw * gh }, () => rng.nextInt(256));
  const cells = new Uint8Array(tw * th);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const gx = Math.floor(x / G), gy = Math.floor(y / G), fx = x % G, fy = y % G;
    const a = grid[gy * gw + gx]!, b = grid[gy * gw + gx + 1]!, c = grid[(gy + 1) * gw + gx]!, e = grid[(gy + 1) * gw + gx + 1]!;
    const noise = Math.floor(((a * (G - fx) + b * fx) * (G - fy) + (c * (G - fx) + e * fx) * fy) / (G * G));
    // Distance from the middle, 0 there and 256 at the edge's midpoints (doubled coordinates).
    const dx = 2 * x - (tw - 1), dy = 2 * y - (th - 1);
    const r = Math.floor((dx * dx * 256) / ((tw - 1) * (tw - 1) || 1) + (dy * dy * 256) / ((th - 1) * (th - 1) || 1));
    const edge = x === 0 || y === 0 || x === tw - 1 || y === th - 1;
    cells[y * tw + x] = !edge && (noise - 128) * 2 + 150 - r > 0 ? 1 : 0;
  }
  return { cols, rows, cells };
}

/** How many times each variant appears on a map. */
export function variantCounts(s: Scheme, terrain: Terrain): number[] {
  const n = new Array<number>(s.variants.length).fill(0);
  for (const v of resolveMap(s, terrain, 'not', false)) if (v !== null) n[v]!++;
  return n;
}

/** A variant among its neighbours: the smallest terrain that resolves to it, 3x3 tiles. */
export function neighbourhoodOf(s: Scheme, v: number): Terrain | null {
  const x = s.variants[v]!;
  if (x.key === null) return null;
  if (s.neighbours === 'corners') {
    const cells = new Uint8Array(16);
    const k = x.key;
    if (k & 128) cells[5] = 1;
    if (k & 2) cells[6] = 1;
    if (k & 32) cells[9] = 1;
    if (k & 8) cells[10] = 1;
    return { cols: 3, rows: 3, cells };
  }
  const cells = new Uint8Array(9);
  if (x.on === 'fillet') {
    // Rounder inner corners: both sides and the diagonal; a lane's diagonal strip: both sides only.
    const lane = s.cornerRule === 'diagonal';
    for (const [b, around] of [[2, [1, 2, 5]], [8, [5, 8, 7]], [32, [7, 6, 3]], [128, [3, 0, 1]]] as [number, number[]][]) if (x.key & b) for (const i of around) if (!lane || i !== around[1]) cells[i] = 1;
    return { cols: 3, rows: 3, cells };
  }
  if (x.on === 'face') {
    // Below the terrain; each side joins (the terrain above the cell beside it) or is an inner corner (the terrain beside it).
    cells[1] = 1;
    if (x.key & 4) cells[2] = 1;
    if (x.key & 64) cells[0] = 1;
    if (x.key & 8) cells[2] = cells[5] = 1;
    if (x.key & 32) cells[0] = cells[3] = 1;
    return { cols: 3, rows: 3, cells };
  }
  if (x.on === 'side') {
    // Beside the terrain (west: the terrain's east side); joining up when it goes on above, down unless it is below.
    if (x.key & 64) cells[3] = 1;
    if (x.key & 4) cells[5] = 1;
    if (x.key & 1) { if (x.key & 64) cells[0] = 1; if (x.key & 4) cells[2] = 1; }
    if (!(x.key & 16)) { cells[7] = 1; if (x.key & 64) cells[6] = 1; if (x.key & 4) cells[8] = 1; }
    return { cols: 3, rows: 3, cells };
  }
  if (x.on === 'corner') {
    if (x.key & 128) cells[0] = 1;
    if (x.key & 2) cells[2] = 1;
    return { cols: 3, rows: 3, cells };
  }
  cells[4] = 1;
  const dirs: [number, number][] = [[1, 1], [2, 2], [4, 5], [8, 8], [16, 7], [32, 6], [64, 3], [128, 0]];
  for (const [b, i] of dirs) if (x.key & b) cells[i] = 1;
  return { cols: 3, rows: 3, cells };
}

/**
 * A coverage map (plan §4.2): a terrain laid out so every variant the scheme can produce appears
 * at least `copies` times. Each missing variant's neighbourhood (the 3x3 map that resolves to it)
 * is stamped where it keeps every variant already placed, trying places in a seeded order; a few
 * seeded rounds, and the first that places everything wins. Null when the map is too small.
 */
export function coverageTerrain(s: Scheme, cols: number, rows: number, seed: number, copies = 1): Terrain | null {
  const corners = s.neighbours === 'corners';
  const tw = corners ? cols + 1 : cols;
  const th = corners ? rows + 1 : rows;
  const want = reachable(s);
  const rng = new Pcg32(seed, 0xc0e);
  const shuffle = <T>(a: T[]): T[] => {
    for (let i = a.length - 1; i > 0; i--) { const j = rng.nextInt(i + 1); [a[i], a[j]] = [a[j]!, a[i]!]; }
    return a;
  };
  // A corner tile is its own four corners; an edge tile needs its 3x3 neighbourhood.
  const pw = corners ? 2 : 3;
  const patternOf = (v: number): Uint8Array => {
    const nb = neighbourhoodOf(s, v)!.cells;
    return corners ? Uint8Array.from([nb[5]!, nb[6]!, nb[9]!, nb[10]!]) : nb;
  };
  const W = tw - pw + 1, H = th - pw + 1;
  for (let round = 0; round < 8; round++) {
    const t: Terrain = { cols, rows, cells: new Uint8Array(tw * th) };
    let n = variantCounts(s, t);
    let ok = true;
    // The variants with the most terrain around them first: they are the hardest to fit.
    const ins = new Map(want.map((v) => [v, patternOf(v).reduce((a, b) => a + b, 0)]));
    for (const v of shuffle([...want]).sort((a, b) => ins.get(b)! - ins.get(a)!)) {
      const pat = patternOf(v);
      while (n[v]! < copies) {
        // Places that change the fewest cells first (patterns share what they agree on).
        const order = shuffle(Array.from({ length: W * H }, (_, i) => i));
        const cost = (p: number) => {
          const px = p % W, py = Math.floor(p / W);
          let c = 0;
          for (let y = 0; y < pw; y++) for (let x = 0; x < pw; x++) if (t.cells[(py + y) * tw + px + x] !== pat[y * pw + x]) c++;
          return c;
        };
        const costs = new Map(order.map((p) => [p, cost(p)]));
        order.sort((a, b) => costs.get(a)! - costs.get(b)!);
        let placed = false;
        for (const p of order) {
          const px = p % W, py = Math.floor(p / W);
          const saved = t.cells.slice();
          for (let y = 0; y < pw; y++) for (let x = 0; x < pw; x++) t.cells[(py + y) * tw + px + x] = pat[y * pw + x]!;
          const m = variantCounts(s, t);
          if (m[v]! > n[v]! && want.every((w) => w === v || m[w]! >= Math.min(copies, n[w]!))) { n = m; placed = true; break; }
          t.cells.set(saved);
        }
        if (!placed) { ok = false; break; }
      }
    }
    if (ok) return t;
    // Some did not fit: flip single cells where that helps most (a seeded hill climb), from here.
    const score = (x: Terrain) => { const m = variantCounts(s, x); return want.reduce((a, w) => a + Math.min(copies, m[w]!), 0); };
    const goal = want.length * copies;
    let cur = score(t);
    for (let pass = 0; pass < 60 && cur < goal; pass++) {
      let gain = 0, at = -1;
      const start = rng.nextInt(t.cells.length);
      for (let k = 0; k < t.cells.length; k++) {
        const i = (start + k) % t.cells.length;
        t.cells[i] ^= 1;
        const sc = score(t);
        t.cells[i] ^= 1;
        if (sc - cur > gain) { gain = sc - cur; at = i; }
      }
      if (at < 0) { const i = rng.nextInt(t.cells.length); t.cells[i] ^= 1; cur = score(t); continue; }
      t.cells[at] ^= 1;
      cur += gain;
    }
    if (cur >= goal) return t;
  }
  return null;
}

// --- The seam score over a map (plan §13's metric on a composed image instead of a 3x3 tiling)


export function mapSeam(img: MapImage, d: Doc): { score: number; jx: number; jy: number; lx: number; ly: number } {
  const { w: W, h: H, t } = img;
  const L = d.palette.entries.map((e) => luma601(e.hex));
  const cls = new Int32Array(W * H), grey = new Float64Array(W * H), clsT = new Int32Array(W * H), greyT = new Float64Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = img.px[y * W + x]!;
    const c = v === TRANSPARENT ? -1 : v, g = v === TRANSPARENT ? 0 : L[v]!;
    cls[y * W + x] = c; grey[y * W + x] = g; clsT[x * H + y] = c; greyT[x * H + y] = g;
  }
  const ax = seamAxis(cls, grey, W, H, t);
  const ay = seamAxis(clsT, greyT, H, W, t);
  return { score: Math.max(ax.jump, ay.jump, ax.line, ay.line, 0), jx: ax.jump, jy: ay.jump, lx: ax.line, ly: ay.line };
}

/** The island a family's checks and map preview use by default. */
export const DEFAULT_MAP = { cols: 12, rows: 10, seed: 1 };

// --- Cutting variants from a painted coverage map

export interface CutResult {
  /** Variant index → its chosen map tile (index) and how many it was chosen from. */
  chosen: Map<number, { tile: number; of: number }>;
  missing: string[];
}

/** The medoid of some blocks: the one with the fewest differing pixels (over `mask`) to all the others. */
function medoid(blocks: Uint16Array[], mask: (i: number) => boolean): number {
  let best = 0, bestCost = Infinity;
  blocks.forEach((a, i) => {
    let cost = 0;
    for (const b of blocks) if (b !== a) for (let k = 0; k < a.length; k++) if (mask(k) && a[k] !== b[k]) cost++;
    if (cost < bestCost) { bestCost = cost; best = i; }
  });
  return best;
}

/**
 * Cut the family from its painted coverage map: each variant takes the medoid of the map tiles
 * that resolve to it, keeping only its band (the textures stay the shared ones: re-projection),
 * and is detached. With `textures`, the inside and outside textures become the medoids of the
 * map's all-inside and all-outside tiles.
 */
export function cutFamily(d: Doc, textures: boolean): CutResult {
  const f = d.family!;
  const s = schemeOf(f);
  const t = f.tile;
  const L = layoutOf(f);
  const terrain: Terrain = { cols: f.mapCols, rows: f.mapRows, cells: f.terrain };
  const vs = resolveMap(s, terrain);
  const bl = d.layers.findIndex((l) => l.name === BAND_LAYER);
  const gl = d.layers.findIndex((l) => l.name === GROUND_LAYER);
  const maps = bandMaps(s, t, f.geometry);
  const chosen = new Map<number, { tile: number; of: number }>();
  const missing: string[] = [];
  const W = d.width;
  const detached = new Set(f.detached);
  for (let fr = 0; fr < d.frameCount; fr++) {
    const flat = flatten(d, fr);
    const tileBlock = (i: number) => block(flat, W, i % f.mapCols, L.mapRow + Math.floor(i / f.mapCols), t);
    s.variants.forEach((v, vi) => {
      const tiles = vs.flatMap((x, i) => (x === vi ? [i] : []));
      if (!tiles.length) { if (fr === 0 && v.key !== null) missing.push(v.name); return; }
      const keep = (k: number) => !!v.on || inBand(f.geometry, maps[vi]![k]!);
      const blocks = tiles.map(tileBlock);
      const m = medoid(blocks, keep);
      if (fr === 0) chosen.set(vi, { tile: tiles[m]!, of: tiles.length });
      if (bl < 0) return;
      const cel = d.cels[bl]![fr]!;
      const [cx, cy] = L.cells[vi]!;
      for (let y = 0; y < t; y++) for (let x = 0; x < t; x++) cel[(cy * t + y) * W + cx * t + x] = keep(y * t + x) ? blocks[m]![y * t + x]! : TRANSPARENT;
      if (!s.pieces.includes(v.name)) detached.add(v.name);
    });
    if (textures && gl >= 0) {
      const full = s.variants.findIndex((v) => !v.on && v.quads.every((q) => q === 'in' || q.startsWith('in@')));
      const pureIn = vs.flatMap((x, i) => (x === full ? [i] : []));
      const pureOut = vs.flatMap((x, i) => {
        if (x !== null) return [];
        if (s.neighbours === 'corners') return [];
        const mx = i % f.mapCols, my = Math.floor(i / f.mapCols);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const X = mx + dx, Y = my + dy;
          if (X >= 0 && Y >= 0 && X < f.mapCols && Y < f.mapRows && f.terrain[Y * f.mapCols + X]) return [];
        }
        return [i];
      });
      const corners0 = s.neighbours === 'corners' ? vs.flatMap((x, i) => (x !== null && s.variants[x]!.key === 0 ? [i] : [])) : [];
      const cel = d.cels[gl]![fr]!;
      for (const [cell, from] of [[L.inside, pureIn], [L.outside, s.neighbours === 'corners' ? corners0 : pureOut]] as [Pt, number[]][]) {
        if (!from.length) continue;
        const blocks = from.map(tileBlock);
        const b = blocks[medoid(blocks, () => true)]!;
        for (let y = 0; y < t; y++) cel.set(b.subarray(y * t, y * t + t), (cell[1] * t + y) * W + cell[0] * t);
      }
    }
  }
  f.detached = s.variants.map((v) => v.name).filter((n) => detached.has(n));
  return { chosen, missing };
}

// --- Overlays over a map

export interface OverlayItem {
  doc: Doc;
}

/** The sequence an overlay plays: its first (a tag or view, else all frames). */
const overlaySeq = (o: Doc): Sequence => {
  const q = sequences(o)[0]!;
  return o.overlay?.mode === 'pingpong' ? { ...q, loop: 'pingpong' } : q;
};

/** Ticks before an overlay's pattern repeats on a map. */
export function overlayPeriod(o: Doc): number {
  const st = o.overlay!;
  const loop = Math.max(1, loopTicks(o, overlaySeq(o)));
  return st.mode === 'sparkle' ? loop + st.rest : loop;
}

/** Which frame of an overlay a tile shows at a tick (null: none at this moment, or no instance on this tile). */
export function overlayFrameAt(o: Doc, tx: number, ty: number, tick: number): number | null {
  const st = o.overlay!;
  if (hash32(st.seed, tx, ty) % st.every !== 0) return null;
  const q = overlaySeq(o);
  const loop = Math.max(1, loopTicks(o, q));
  if (st.mode === 'cycle' || st.mode === 'pingpong') return frameAtTick(o, q, tick);
  if (st.mode === 'wave') return frameAtTick(o, q, tick + Math.floor(((tx + ty) * loop) / 8));
  const period = loop + st.rest;
  const local = (tick + (hash32(st.seed, tx, ty, 7) % period)) % period;
  return local < loop ? frameAtTick(o, q, local) : null;
}

/** Draw one instance of an overlay's frame on the tile tx,ty of a map of t px tiles: put(x, y, colour) per pixel. */
export function drawOverlayAt(o: Doc, f: number, tx: number, ty: number, t: number, put: (x: number, y: number, c: number) => void, flat?: Uint16Array): void {
  const st = o.overlay!;
  const px = flat ?? flatten(o, f);
  const r = hash32(st.seed, tx, ty, 1);
  const ox = (st.anchor ? st.anchor[0] : Math.floor((t - o.width) / 2)) + (st.spread[0] ? (r % (2 * st.spread[0] + 1)) - st.spread[0] : 0);
  const oy = (st.anchor ? st.anchor[1] : Math.floor((t - o.height) / 2)) + (st.spread[1] ? ((r >>> 8) % (2 * st.spread[1] + 1)) - st.spread[1] : 0);
  for (let y = 0; y < o.height; y++) for (let x = 0; x < o.width; x++) {
    const c = px[y * o.width + x]!;
    if (c !== TRANSPARENT) put(tx * t + ox + x, ty * t + oy + y, c);
  }
}

/** Draw overlays onto a map image at a tick (in place). */
export function drawOverlays(img: MapImage, items: Doc[], tick: number, fam: Doc | null): void {
  const s = fam?.family ? schemeOf(fam.family) : null;
  for (const o of items) {
    const st = o.overlay;
    if (!st) continue;
    const cols = img.w / img.t;
    const flats = new Map<number, Uint16Array>();
    img.variants.forEach((v, i) => {
      const tx = i % cols, ty = Math.floor(i / cols);
      const inside = v !== null && !s?.variants[v]!.on;
      if ((st.on === 'outside' && inside) || (st.on === 'inside' && !inside)) return;
      const f = overlayFrameAt(o, tx, ty, tick);
      if (f === null) return;
      const flat = flats.get(f) ?? flats.set(f, flatten(o, f)).get(f)!;
      drawOverlayAt(o, f, tx, ty, img.t, (X, Y, c) => { if (X >= 0 && Y >= 0 && X < img.w && Y < img.h) img.px[Y * img.w + X] = c; }, flat);
    });
  }
}

/**
 * Overlay colours on a family's map are the overlay's own palette entries: they are remapped by
 * name (or exact colour) onto the map's palette, adding any that are missing for the render only.
 */
export function overlayOnPalette(o: Doc, entries: { name: string; hex: string }[]): Doc {
  const map = o.palette.entries.map((e) => {
    let i = entries.findIndex((x) => x.name === e.name && x.hex === e.hex);
    if (i < 0) i = entries.findIndex((x) => x.hex === e.hex);
    if (i < 0) { entries.push({ name: e.name, hex: e.hex }); i = entries.length - 1; }
    return i;
  });
  const cels = o.cels.map((fr) => fr.map((c) => c.map((v) => (v === TRANSPARENT ? v : map[v]!))));
  return { ...o, cels };
}

/** The ticks in one loop of a map with these documents (lcm of their loops, capped). */
export function mapPeriod(fam: Doc, overlays: Doc[], cap: number): number {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  let p = 1;
  const add = (l: number) => { p = Math.min(cap, (p / gcd(p, l)) * l); };
  if (fam.frameCount > 1) add(Math.max(1, loopTicks(fam, sequences(fam)[0]!)));
  for (const o of overlays) if (o.overlay) add(overlayPeriod(o));
  return p;
}

/** The family's frame at a tick (its first sequence playing). */
export function familyFrameAt(fam: Doc, tick: number): number {
  if (fam.frameCount < 2) return 0;
  const q = sequences(fam)[0]!;
  return playOrder(q).length ? frameAtTick(fam, q, tick) : 0;
}

/** A new overlay's settings: in step on the outside tiles, centred, on every tile. */
export function defaultOverlay(): OverlayState {
  return { mode: 'cycle', on: 'outside', anchor: null, spread: [0, 0], every: 1, rest: 60, seed: 1 };
}
