// Maps and scenes (plan §4.11) and oversized assets on them (§4.10). A map document holds names,
// not pixels: its layers say which cells are a family's terrain, which tiles and objects are
// placed where. Drawing a map reads the assets it names (a `MapWorld`), so it redraws itself when
// a tile changes. Terrain resolves through the family's autotile scheme exactly as the sample maps
// do (`resolveMap`), each cell picks among a tile and its texture variants (§4.1) by its place,
// objects are drawn in order of their base row and roof cells last. Also here: the map checks
// (seams, repetition hot spots, footprints, draw order, coverage), Tiled `.tmx` export and the
// `split` of an oversized asset into one-cell pieces.

import { frameAtTick, loopTicks, playOrder, sequences } from './anim.ts';
import { TRANSPARENT, flatten, type Doc, type Footprint, type MapEntry, type MapLayerInfo } from './doc.ts';
import { drawOverlayAt, hash32, layoutOf, mapSeam, overlayFrameAt, schemeOf, type MapImage } from './family.ts';
import { luma601, lstar } from './checks.ts';
import type { Rgba } from './png.ts';
import type { Pt } from './raster.ts';
import { resolveMap, type Scheme, type Terrain } from './schemes.ts';

// --- The assets a map reads

export interface MapWorld {
  get(name: string): Doc | undefined;
  /** The asset and its texture variants (assets whose `variantOf` is it), the asset first. */
  family(name: string): Doc[];
}

export function mapWorld(assets: { name: string; doc: Doc }[]): MapWorld {
  const by = new Map(assets.map((a) => [a.name, a.doc]));
  const vars = new Map<string, Doc[]>();
  for (const a of [...assets].sort((p, q) => (p.name < q.name ? -1 : p.name > q.name ? 1 : 0))) {
    const base = a.doc.variantOf;
    if (base) vars.set(base, [...(vars.get(base) ?? []), a.doc]);
  }
  return {
    get: (n) => by.get(n),
    family: (n) => {
      const d = by.get(n);
      return d ? [d, ...(vars.get(n) ?? []).filter((v) => sameShape(d, v))] : [];
    },
  };
}

/** A variant can stand in for its base only with the same size (and, for families, the same scheme and tile). */
function sameShape(a: Doc, b: Doc): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  if (a.family || b.family) return !!a.family && !!b.family && a.family.scheme === b.family.scheme && a.family.tile === b.family.tile;
  return true;
}

// --- Footprints

/** An asset's art grid in cells. */
export const artGrid = (d: Doc): [number, number] => [Math.max(1, Math.floor(d.width / d.cellW)), Math.max(1, Math.floor(d.height / d.cellH))];

/** An asset's footprint: its own, else its whole art grid placed by the bottom-left cell, nothing flagged. */
export function footprintOf(d: Doc): Footprint {
  if (d.footprint) return d.footprint;
  const [c, r] = artGrid(d);
  return { cols: c, rows: r, at: [0, 0], anchor: [0, r - 1], flags: Array.from({ length: r }, () => '.'.repeat(c)) };
}

/** The flag of an art cell: blocks movement, and draws above actors. */
export function cellFlag(f: Footprint, cx: number, cy: number): { block: boolean; roof: boolean } {
  const ch = f.flags[cy]?.[cx] ?? '.';
  return { block: ch === 'b' || ch === 'x', roof: ch === 'r' || ch === 'x' };
}

/** Is an art cell inside the footprint? */
export const inFootprint = (f: Footprint, cx: number, cy: number): boolean => cx >= f.at[0] && cy >= f.at[1] && cx < f.at[0] + f.cols && cy < f.at[1] + f.rows;

/** The map cells an entry placed with its anchor at x,y covers: its footprint's top-left and size. */
export function entryBox(e: MapEntry, x: number, y: number): { x: number; y: number; w: number; h: number } {
  return { x: x - e.anchor[0], y: y - e.anchor[1], w: e.cols, h: e.rows };
}

/** A placed thing: the entry at an anchor cell of a layer. */
export interface Placed {
  layer: number;
  entry: number;
  x: number;
  y: number;
}

/** Everything placed on a map's tiles and objects layers (anchor cells, row by row). */
export function placements(d: Doc, kinds: ('tiles' | 'objects')[] = ['tiles', 'objects']): Placed[] {
  const out: Placed[] = [];
  d.layers.forEach((l, li) => {
    if (!l.map || !kinds.includes(l.map.kind as 'tiles')) return;
    const cel = d.cels[li]![0]!;
    for (let i = 0; i < cel.length; i++) if (cel[i] !== TRANSPARENT) out.push({ layer: li, entry: cel[i]!, x: i % d.width, y: Math.floor(i / d.width) });
  });
  return out;
}

/**
 * Who occupies each cell: for objects, every objects layer counts (a footprint is physical); for
 * a tiles layer, only that layer. -1: free. Values index `placements`.
 */
export function occupancy(d: Doc, layer: number): { grid: Int32Array; placed: Placed[] } {
  const kind = d.layers[layer]?.map?.kind;
  const placed = placements(d).filter((p) => (kind === 'objects' ? d.layers[p.layer]!.map!.kind === 'objects' : p.layer === layer));
  const grid = new Int32Array(d.width * d.height).fill(-1);
  placed.forEach((p, k) => {
    const b = entryBox(d.map!.entries[p.entry]!, p.x, p.y);
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (x >= 0 && y >= 0 && x < d.width && y < d.height) grid[y * d.width + x] = k;
  });
  return { grid, placed };
}

/** The placement covering a cell on a layer (or, on an objects layer, any objects layer), or null. */
export function placedAt(d: Doc, layer: number, x: number, y: number): Placed | null {
  const { grid, placed } = occupancy(d, layer);
  const k = x >= 0 && y >= 0 && x < d.width && y < d.height ? grid[y * d.width + x]! : -1;
  return k >= 0 ? placed[k]! : null;
}

// --- Terrain

/** A terrain layer's cells as a scheme's terrain (corner schemes: each cell's top-left corner, the last row and column repeated). */
export function layerTerrain(d: Doc, layer: number, s: Scheme): Terrain {
  const cel = d.cels[layer]![0]!;
  const W = d.width, H = d.height;
  const on = (x: number, y: number) => (cel[Math.min(y, H - 1) * W + Math.min(x, W - 1)] === 1 ? 1 : 0);
  if (s.neighbours !== 'corners') return { cols: W, rows: H, cells: Uint8Array.from(cel, (v) => (v === 1 ? 1 : 0)) };
  const cells = new Uint8Array((W + 1) * (H + 1));
  for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) cells[y * (W + 1) + x] = on(x, y);
  return { cols: W, rows: H, cells };
}

// --- Composing

/** The palette a composed map is drawn in: the map's own entries, then every asset's, merged by name and colour. */
export class MapPalette {
  readonly entries: { name: string; hex: string }[];
  private maps = new Map<Doc, number[]>();
  constructor(base: { name: string; hex: string }[]) {
    this.entries = base.map((e) => ({ name: e.name, hex: e.hex }));
  }
  /** Each of the document's palette indices in this palette. */
  of(d: Doc): number[] {
    let m = this.maps.get(d);
    if (m) return m;
    m = d.palette.entries.map((e) => {
      let i = this.entries.findIndex((x) => x.name === e.name && x.hex === e.hex);
      if (i < 0) i = this.entries.findIndex((x) => x.hex === e.hex);
      if (i < 0) { this.entries.push({ name: e.name, hex: e.hex }); i = this.entries.length - 1; }
      return i;
    });
    this.maps.set(d, m);
    return m;
  }
}

/** What a cell of a ground layer shows (for the text, the tiles list and the checks). */
export interface CellTile {
  /** The asset drawn (a variant's name when a variant was picked). */
  asset: string;
  /** A family's variant name, `outside` for a terrain layer's outside ground, null for a tile. */
  variant: string | null;
  /** A family's edge tile (not the plain inside or outside). */
  edge: boolean;
  /** Drawn by a terrain layer that fills the map with its outside ground (the land against the sea). */
  base?: boolean;
}

export interface PlacedObject extends Placed {
  doc: Doc | null;
  name: string;
  fp: Footprint;
  /** The art's top-left in map pixels. */
  px: number;
  py: number;
  /** The map row the footprint's bottom is on (the draw order). */
  base: number;
}

export interface ComposedMap extends MapImage {
  cols: number;
  rows: number;
  palette: { name: string; hex: string }[];
  /** The ground layers only (terrain, tiles, overlays), before objects. */
  ground: Uint16Array;
  /** For each cell, the topmost ground layer's tile (null: nothing there). */
  top: (CellTile | null)[];
  objects: PlacedObject[];
  /** Pixels drawn by each object's roof cells, last: object index per pixel (-1 none). */
  roofOwner: Int32Array;
  /** The object whose art is on top at each pixel before roofs (-1 none). */
  artOwner: Int32Array;
  problems: string[];
}

export interface ComposeOptions {
  tick?: number;
  /** Leave out hidden layers (default) or draw only the ground. */
  groundOnly?: boolean;
}

const fullInside = (s: Scheme, v: number): boolean => s.variants[v]!.on !== 'face' && s.variants[v]!.quads.every((q) => q === 'in' || q.startsWith('in@'));

/** The frame of an asset at a tick: its first sequence playing (one frame: 0). */
export function frameOf(d: Doc, tick: number): number {
  if (d.frameCount < 2) return 0;
  const q = sequences(d)[0]!;
  return playOrder(q).length ? frameAtTick(d, q, tick) : 0;
}

/** The map composed at a tick from the assets it names. */
export function composeMapDoc(d: Doc, world: MapWorld, o: ComposeOptions = {}): ComposedMap {
  const m = d.map!;
  const t = m.tile, cols = d.width, rows = d.height;
  const W = cols * t, H = rows * t;
  const tick = o.tick ?? 0;
  const pal = new MapPalette(d.palette.entries);
  const px = new Uint16Array(W * H).fill(TRANSPARENT);
  const top: (CellTile | null)[] = Array.from({ length: cols * rows }, () => null);
  const variants: (number | null)[] = Array.from({ length: cols * rows }, () => null);
  const problems: string[] = [];
  const flats = new Map<Doc, Map<number, Uint16Array>>();
  const flat = (x: Doc) => {
    const f = frameOf(x, tick);
    let byF = flats.get(x);
    if (!byF) flats.set(x, (byF = new Map()));
    let a = byF.get(f);
    if (!a) {
      const map = pal.of(x);
      a = flatten(x, f).map((v) => (v === TRANSPARENT ? v : map[v]!));
      byF.set(f, a);
    }
    return a;
  };
  const blit = (src: Uint16Array, sw: number, sx: number, sy: number, w: number, h: number, dx: number, dy: number) => {
    for (let y = 0; y < h; y++) {
      const Y = dy + y;
      if (Y < 0 || Y >= H) continue;
      for (let x = 0; x < w; x++) {
        const X = dx + x;
        if (X < 0 || X >= W) continue;
        const v = src[(sy + y) * sw + sx + x]!;
        if (v !== TRANSPARENT) px[Y * W + X] = v;
      }
    }
  };
  const missing = new Set<string>();
  const need = (name: string): Doc[] => {
    const fam = world.family(name);
    if (!fam.length && !missing.has(name)) { missing.add(name); problems.push(`no asset '${name}'`); }
    return fam;
  };
  /**
   * Pick among an asset and its variants by the cell's place: a hash of the cell, moved on when it
   * would repeat both the cell to the left and the one above (so clumps of one look are rare).
   */
  const choice = new Map<number, Int16Array>();
  const pick = (fam: Doc[], x: number, y: number, li: number): Doc => {
    if (fam.length < 2) return fam[0]!;
    let ch = choice.get(li);
    if (!ch) choice.set(li, (ch = new Int16Array(cols * rows).fill(-1)));
    const h = hash32(x, y, li, 0x5a);
    let k = h % fam.length;
    const left = x > 0 ? ch[y * cols + x - 1]! : -1, up = y > 0 ? ch[(y - 1) * cols + x]! : -1;
    if (k === left && k === up) k = (k + 1 + ((h >>> 16) % (fam.length - 1))) % fam.length;
    if (x >= 0 && y >= 0 && x < cols && y < rows) ch[y * cols + x] = k;
    return fam[k]!;
  };
  const objects: PlacedObject[] = [];

  d.layers.forEach((l, li) => {
    const info = l.map;
    if (!info || l.hidden) return;
    if (info.kind === 'objects') return;
    if (o.groundOnly && info.kind === 'overlay') return;
    const cel = d.cels[li]![0]!;
    if (info.kind === 'terrain') {
      const fam = need(info.family).filter((x) => x.family);
      if (!fam.length) { if (world.get(info.family)) problems.push(`layer ${l.name}: '${info.family}' is not a family`); return; }
      const s = schemeOf(fam[0]!.family!);
      const vs = resolveMap(s, layerTerrain(d, li, s));
      vs.forEach((v, i) => {
        const x = i % cols, y = Math.floor(i / cols);
        if (v === null && !info.outside) return;
        const f = pick(fam, x, y, li);
        const L = layoutOf(f.family!);
        const [cx, cy] = v === null ? L.outside : L.cells[v]!;
        blit(flat(f), f.width, cx * t, cy * t, t, t, x * t, y * t);
        top[i] = { asset: f.name, variant: v === null ? 'outside' : s.variants[v]!.name, edge: v !== null && !fullInside(s, v), ...(info.outside ? { base: true } : {}) };
        variants[i] = v;
      });
      return;
    }
    if (info.kind === 'tiles') {
      for (let i = 0; i < cel.length; i++) {
        const k = cel[i]!;
        if (k === TRANSPARENT) continue;
        const e = m.entries[k]!;
        const x = i % cols, y = Math.floor(i / cols);
        const fam = need(e.name);
        if (!fam.length) continue;
        const b = entryBox(e, x, y);
        if (e.variant) {
          const f = pick(fam, x, y, li);
          const vi = f.family ? schemeOf(f.family).byName.get(e.variant) : undefined;
          if (vi === undefined) { problems.push(`${e.name} has no variant '${e.variant}'`); continue; }
          const [cx, cy] = layoutOf(f.family!).cells[vi]!;
          blit(flat(f), f.width, cx * t, cy * t, t, t, b.x * t, b.y * t);
          if (b.x >= 0 && b.y >= 0 && b.x < cols && b.y < rows) top[b.y * cols + b.x] = { asset: f.name, variant: e.variant, edge: !fullInside(schemeOf(f.family!), vi) };
          continue;
        }
        const f = pick(fam, x, y, li);
        const fp = footprintOf(f);
        // The art's top-left cell is the footprint's top-left less the footprint's place in the art.
        blit(flat(f), f.width, 0, 0, f.width, f.height, (b.x - fp.at[0]) * t, (b.y - fp.at[1]) * t);
        for (let yy = b.y; yy < b.y + b.h; yy++) for (let xx = b.x; xx < b.x + b.w; xx++) {
          if (xx >= 0 && yy >= 0 && xx < cols && yy < rows) top[yy * cols + xx] = { asset: f.name, variant: null, edge: false };
        }
      }
      return;
    }
    // An overlay layer: the overlay's sprite over the cells its `on=` names.
    const ov = world.get(info.overlay);
    if (!ov?.overlay) { problems.push(`layer ${l.name}: no overlay '${info.overlay}'`); return; }
    const on = overlayCells(d, info);
    const map = pal.of(ov);
    const ovFlats = new Map<number, Uint16Array>();
    for (let i = 0; i < on.length; i++) {
      if (!on[i]) continue;
      const x = i % cols, y = Math.floor(i / cols);
      const fr = overlayFrameAt(ov, x, y, tick);
      if (fr === null) continue;
      const fl = ovFlats.get(fr) ?? ovFlats.set(fr, flatten(ov, fr)).get(fr)!;
      drawOverlayAt(ov, fr, x, y, t, (X, Y, c) => { if (X >= 0 && Y >= 0 && X < W && Y < H) px[Y * W + X] = map[c]!; }, fl);
    }
  });
  const ground = px.slice();

  // Objects: every objects layer, in order of the footprint's bottom row, then the layer, then x.
  if (!o.groundOnly) {
    for (const p of placements(d, ['objects'])) {
      if (d.layers[p.layer]!.hidden) continue;
      const e = m.entries[p.entry]!;
      const fam = need(e.name);
      const doc = fam.length ? pick(fam, p.x, p.y, p.layer) : null;
      const fp = doc ? footprintOf(doc) : { cols: e.cols, rows: e.rows, at: [0, 0] as [number, number], anchor: e.anchor, flags: [] };
      const b = entryBox(e, p.x, p.y);
      objects.push({ ...p, doc, name: e.name, fp, px: (b.x - fp.at[0]) * t, py: (b.y - fp.at[1]) * t, base: b.y + b.h - 1 });
      if (doc && doc.cellW !== t) problems.push(`${e.name}: its cells are ${doc.cellW} px, the map's ${t}`);
    }
    objects.sort((a, b) => a.base - b.base || a.layer - b.layer || a.x - b.x || a.y - b.y);
  }
  const artOwner = new Int32Array(W * H).fill(-1);
  const roofOwner = new Int32Array(W * H).fill(-1);
  const drawObj = (k: number, roofOnly: boolean) => {
    const ob = objects[k]!;
    if (!ob.doc) return;
    const src = flat(ob.doc);
    const [ac, ar] = artGrid(ob.doc);
    for (let cy = 0; cy < ar; cy++) for (let cx = 0; cx < ac; cx++) {
      if (roofOnly && !cellFlag(ob.fp, cx, cy).roof) continue;
      for (let y = 0; y < ob.doc.cellH; y++) for (let x = 0; x < ob.doc.cellW; x++) {
        const sx = cx * ob.doc.cellW + x, sy = cy * ob.doc.cellH + y;
        const v = src[sy * ob.doc.width + sx]!;
        if (v === TRANSPARENT) continue;
        const X = ob.px + sx, Y = ob.py + sy;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        px[Y * W + X] = v;
        (roofOnly ? roofOwner : artOwner)[Y * W + X] = k;
      }
    }
  };
  objects.forEach((_, k) => drawObj(k, false));
  // Roof and canopy cells draw above actors, so above everything placed in front of them too.
  objects.forEach((_, k) => drawObj(k, true));
  return { px, w: W, h: H, t, variants, cols, rows, palette: pal.entries, ground, top, objects, roofOwner, artOwner, problems };
}

/** The cells an overlay layer plays on: `all`, `<layer>` (inside that terrain) or `<layer>:out`. */
export function overlayCells(d: Doc, info: Extract<MapLayerInfo, { kind: 'overlay' }>): Uint8Array {
  const n = d.width * d.height;
  if (info.on === 'all') return new Uint8Array(n).fill(1);
  const [name, out] = info.on.split(':');
  const li = d.layers.findIndex((l) => l.name === name);
  const out1 = out === 'out';
  if (li < 0) return new Uint8Array(n);
  const cel = d.cels[li]![0]!;
  return Uint8Array.from(cel, (v) => ((v !== TRANSPARENT) !== out1 ? 1 : 0));
}

// --- Views

export interface MapDocView {
  scale?: number;
  /** Cells to show (default: the whole map). */
  region?: { x: number; y: number; w: number; h: number };
  tick?: number;
  /** Cells outlined in magenta (check hot spots). */
  marks?: readonly Pt[];
  /** Outline the cell grid faintly. */
  grid?: boolean;
  /** Recolour role entries (palette hex per entry name) before drawing. */
  hex?: (name: string, hex: string) => string;
}

const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/** A composed map (or a region of it) as RGBA at a scale, with marked cells outlined. */
export function paintComposed(c: ComposedMap, o: MapDocView = {}): Rgba {
  const s = o.scale ?? 1;
  const r = o.region ?? { x: 0, y: 0, w: c.cols, h: c.rows };
  const t = c.t;
  const w = r.w * t * s, h = r.h * t * s;
  const data = new Uint8Array(w * h * 4);
  const cols = c.palette.map((e) => rgb(o.hex ? o.hex(e.name, e.hex) : e.hex));
  for (let y = 0; y < r.h * t; y++) for (let x = 0; x < r.w * t; x++) {
    const X = r.x * t + x, Y = r.y * t + y;
    const v = X >= 0 && Y >= 0 && X < c.w && Y < c.h ? c.px[Y * c.w + X]! : TRANSPARENT;
    const col: [number, number, number] = v === TRANSPARENT ? ((((X >> 2) + (Y >> 2)) & 1) ? [204, 204, 204] : [238, 238, 238]) : cols[v]!;
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
      const k = ((y * s + j) * w + x * s + i) * 4;
      data[k] = col[0]; data[k + 1] = col[1]; data[k + 2] = col[2]; data[k + 3] = 255;
    }
  }
  const put = (x: number, y: number, col: [number, number, number], a = 1) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const k = (y * w + x) * 4;
    data[k] = Math.round(data[k]! * (1 - a) + col[0] * a); data[k + 1] = Math.round(data[k + 1]! * (1 - a) + col[1] * a); data[k + 2] = Math.round(data[k + 2]! * (1 - a) + col[2] * a);
  };
  if (o.grid) {
    for (let cy = 0; cy <= r.h; cy++) for (let x = 0; x < w; x++) put(x, Math.min(h - 1, cy * t * s), [0, 0, 0], 0.18);
    for (let cx = 0; cx <= r.w; cx++) for (let y = 0; y < h; y++) put(Math.min(w - 1, cx * t * s), y, [0, 0, 0], 0.18);
  }
  // Marked cells: the outline of each group of them (edges between a marked and an unmarked cell).
  const marked = new Set((o.marks ?? []).map(([x, y]) => `${x},${y}`));
  const on = (x: number, y: number) => marked.has(`${x},${y}`);
  const th = Math.max(1, s);
  for (const [mx, my] of o.marks ?? []) {
    const x0 = (mx - r.x) * t * s, y0 = (my - r.y) * t * s, e = t * s;
    for (let k = 0; k < e; k++) for (let d = 0; d < th; d++) {
      if (!on(mx, my - 1)) put(x0 + k, y0 + d, [255, 0, 200]);
      if (!on(mx, my + 1)) put(x0 + k, y0 + e - 1 - d, [255, 0, 200]);
      if (!on(mx - 1, my)) put(x0 + d, y0 + k, [255, 0, 200]);
      if (!on(mx + 1, my)) put(x0 + e - 1 - d, y0 + k, [255, 0, 200]);
    }
    // A light tint inside, so a large hot spot reads as an area.
    for (let y = 0; y < e; y += 2) for (let x = (y >> 1) % 2; x < e; x += 2) put(x0 + x, y0 + y, [255, 0, 200], 0.3);
  }
  return { width: w, height: h, data };
}

/** Ticks before everything a map draws repeats (families' and objects' first sequences, overlays), capped. */
export function mapDocPeriod(d: Doc, world: MapWorld, cap: number): number {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  let p = 1;
  const add = (l: number) => { if (l > 1) p = Math.min(cap, (p / gcd(p, l)) * l); };
  const seen = new Set<Doc>();
  const docs: Doc[] = [];
  for (const l of d.layers) {
    const info = l.map;
    if (!info || l.hidden) continue;
    if (info.kind === 'terrain') docs.push(...world.family(info.family));
    if (info.kind === 'overlay') { const o = world.get(info.overlay); if (o) docs.push(o); }
  }
  for (const pl of placements(d)) docs.push(...world.family(d.map!.entries[pl.entry]!.name));
  for (const x of docs) {
    if (seen.has(x)) continue;
    seen.add(x);
    if (x.overlay) add(overlayPeriodOf(x));
    else if (x.frameCount > 1) add(loopOf(x));
  }
  return p;
}

const loopOf = (x: Doc): number => { const q = sequences(x)[0]!; return Math.max(1, loopTicks(x, q)); };
const overlayPeriodOf = (x: Doc): number => (x.overlay!.mode === 'sparkle' ? loopOf(x) + x.overlay!.rest : loopOf(x));

/** A map (or a region) playing at the game's speed: one loop, at most `seconds`, in steps of at least 3 ticks. */
export function mapDocGifFrames(d: Doc, world: MapWorld, o: MapDocView & { tickRate?: number; seconds?: number } = {}): { img: Rgba; delay: number }[] {
  const rate = o.tickRate ?? 60;
  const period = mapDocPeriod(d, world, rate * (o.seconds ?? 4));
  if (period <= 1) return [];
  const cs = (t: number) => Math.round((t * 100) / rate);
  const out: { img: Rgba; delay: number }[] = [];
  let prev: Uint16Array | null = null;
  let start = 0;
  for (let t = 0; t <= period; t += t === period ? 1 : Math.min(3, period - t)) {
    const c = t < period ? composeMapDoc(d, world, { tick: t }) : null;
    if (c && prev && c.px.every((v, i) => v === prev![i])) continue;
    if (prev && out.length) out[out.length - 1]!.delay = Math.max(1, cs(t) - cs(start));
    if (!c) break;
    out.push({ img: paintComposed(c, { ...o, tick: t }), delay: 1 });
    prev = c.px;
    start = t;
  }
  return out.length > 1 ? out : [];
}

/** The camera: what a player standing at cell x,y sees, a screen of w x h art pixels, kept on the map. */
export function cameraRegion(c: { cols: number; rows: number; t: number }, x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number; px: [number, number] } {
  const cw = Math.min(c.cols, Math.ceil(w / c.t)), ch = Math.min(c.rows, Math.ceil(h / c.t));
  const cx = Math.max(0, Math.min(c.cols - cw, x - Math.floor(cw / 2)));
  const cy = Math.max(0, Math.min(c.rows - ch, y - Math.floor(ch / 2)));
  return { x: cx, y: cy, w: cw, h: ch, px: [w, h] };
}

/** The map in words: its size, layers, what is placed where, and the composed seam score. */
export function mapDocText(d: Doc, world: MapWorld, c: ComposedMap = composeMapDoc(d, world)): string {
  const m = d.map!;
  const f2 = (n: number) => String(Number(n.toFixed(2)));
  const seam = mapSeam({ px: c.ground, w: c.w, h: c.h, t: c.t, variants: c.variants }, { palette: { entries: c.palette } } as unknown as Doc);
  const lines = [`${d.name}: a map of ${d.width}x${d.height} cells of ${m.tile} px (${c.w}x${c.h} px); seam over the ground ${f2(seam.score)} (about 1 or less reads as no seam)`];
  d.layers.forEach((l, li) => {
    const info = l.map;
    if (!info) return;
    const cel = d.cels[li]![0]!;
    const hid = l.hidden ? ' (hidden)' : '';
    if (info.kind === 'terrain') {
      const n = cel.reduce((a, v) => a + (v === 1 ? 1 : 0), 0);
      const fam = world.family(info.family);
      lines.push(`layer ${l.name}: terrain of ${info.family}${fam.length > 1 ? ` (+ variants ${fam.slice(1).map((x) => x.name).join(', ')})` : ''}, ${n} cells${info.outside ? '; its outside ground fills the rest' : ''}${hid}`);
    } else if (info.kind === 'overlay') {
      lines.push(`layer ${l.name}: overlay ${info.overlay} on ${info.on}${hid}`);
    } else {
      const ps = placements(d, [info.kind]).filter((p) => p.layer === li);
      const shown = ps.slice(0, 40).map((p) => { const e = m.entries[p.entry]!; return `${e.name}${e.variant ? `.${e.variant}` : ''} ${p.x},${p.y}`; });
      lines.push(`layer ${l.name}: ${info.kind}, ${ps.length} placed${ps.length ? `: ${shown.join('; ')}${ps.length > 40 ? '; …' : ''}` : ''}${hid}`);
    }
  });
  if (c.problems.length) lines.push(`problems: ${c.problems.join('; ')}`);
  return lines.join('\n');
}

/**
 * The map as a grid of characters, a row per map row, with column numbers: each terrain layer by
 * the first letter of its name where its terrain is (the topmost wins), '.' elsewhere; objects by
 * the first letter of their name in capitals at their anchor and '+' over the rest of the footprint.
 */
export function mapAscii(d: Doc, c?: ComposedMap): string {
  const W = d.width, H = d.height;
  const g = Array.from({ length: W * H }, () => '.');
  const legend: string[] = [];
  const taken = new Set(['.', '+']);
  /** A letter for a name: its first letter not yet used, else any free one. */
  const letter = (name: string, upper: boolean): string => {
    const cands = [...name.replace(/[^a-z]/gi, ''), ...'abcdefghijklmnopqrstuvwxyz'].map((c) => (upper ? c.toUpperCase() : c.toLowerCase()));
    const ch = cands.find((c) => !taken.has(c)) ?? '?';
    taken.add(ch);
    return ch;
  };
  d.layers.forEach((l, li) => {
    if (l.map?.kind !== 'terrain' || l.hidden) return;
    const ch = letter(l.name, false);
    legend.push(`${ch} ${l.name}`);
    const cel = d.cels[li]![0]!;
    for (let i = 0; i < cel.length; i++) if (cel[i] === 1) g[i] = ch;
  });
  const names = new Map<string, string>();
  for (const p of placements(d)) {
    const e = d.map!.entries[p.entry]!;
    const full = `${e.name}${e.variant ? `.${e.variant}` : ''}`;
    if (!names.has(full)) names.set(full, letter(e.name, true));
    const b = entryBox(e, p.x, p.y);
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (x >= 0 && y >= 0 && x < W && y < H) g[y * W + x] = '+';
    if (p.x >= 0 && p.y >= 0 && p.x < W && p.y < H) g[p.y * W + p.x] = names.get(full)!;
  }
  void c;
  const tens = '     ' + Array.from({ length: W }, (_, x) => (x % 10 === 0 ? String(Math.floor(x / 10) % 10) : ' ')).join('');
  const ones = '     ' + Array.from({ length: W }, (_, x) => String(x % 10)).join('');
  const rows = Array.from({ length: H }, (_, y) => `${String(y).padStart(3)}  ${g.slice(y * W, y * W + W).join('')}`);
  return [`cells (${[...legend, ...[...names].map(([n, ch]) => `${ch} ${n}`), '+ under an object, . nothing'].join(', ')}):`, tens, ones, ...rows].join('\n');
}

/** The tile at each cell, as rows of short labels (the topmost ground tile; objects' anchors marked). */
export function mapTilesText(c: ComposedMap): string {
  const labels = new Map<string, string>();
  const keyOf = (x: CellTile | null) => (x ? `${x.asset}${x.variant ? `.${x.variant}` : ''}` : '-');
  const out: string[] = [];
  for (let y = 0; y < c.rows; y++) {
    const row: string[] = [];
    for (let x = 0; x < c.cols; x++) {
      const k = keyOf(c.top[y * c.cols + x]!);
      if (!labels.has(k)) labels.set(k, k);
      row.push(k);
    }
    out.push(`${String(y).padStart(3)}: ${row.join(' ')}`);
  }
  return out.join('\n');
}

// --- Map checks (plan §4.11): seams, repetition hot spots, footprints, draw order, coverage

export interface MapCheck {
  id: 'seam' | 'repetition' | 'footprint' | 'draworder' | 'coverage';
  score: number;
  limit: number;
  pass: boolean;
  shown: string;
  limitText: string;
  /** Cells flagged, with what is wrong. */
  groups: { label: string; cells: Pt[] }[];
  detail: string;
  parts?: { name: string; value: number; limit: string; pass: boolean; detail: string }[];
}

/** Thresholds a map is held to (the style guide can change them as for any check). */
export const MAP_LIMITS = { seam: 1, edgeRun: 4, motif: 10, window: 4 };

/** A content hash of each cell's ground pixels: equal cells look the same. */
function cellKeys(c: ComposedMap): Int32Array {
  const out = new Int32Array(c.cols * c.rows);
  const ids = new Map<string, number>();
  for (let cy = 0; cy < c.rows; cy++) for (let cx = 0; cx < c.cols; cx++) {
    let h1 = 0x811c9dc5, h2 = 0x1234567;
    for (let y = 0; y < c.t; y++) for (let x = 0; x < c.t; x++) {
      const v = c.ground[(cy * c.t + y) * c.w + cx * c.t + x]!;
      h1 = Math.imul(h1 ^ v, 0x01000193) >>> 0;
      h2 = Math.imul(h2 + v + 1, 0x9e3779b1) >>> 0;
    }
    const k = `${h1}:${h2}`;
    let id = ids.get(k);
    if (id === undefined) ids.set(k, (id = ids.size));
    out[cy * c.cols + cx] = id;
  }
  return out;
}

/** A cell with no motif to repeat: one colour, or nearly. */
function flatCell(c: ComposedMap, cx: number, cy: number): boolean {
  const n = new Map<number, number>();
  for (let y = 0; y < c.t; y++) for (let x = 0; x < c.t; x++) {
    const v = c.ground[(cy * c.t + y) * c.w + cx * c.t + x]!;
    n.set(v, (n.get(v) ?? 0) + 1);
  }
  const most = Math.max(...n.values());
  return most >= c.t * c.t * 0.97;
}

export function mapChecks(d: Doc, world: MapWorld, limits: Partial<typeof MAP_LIMITS> = {}, c: ComposedMap = composeMapDoc(d, world)): MapCheck[] {
  const L = { ...MAP_LIMITS, ...limits };
  const f2 = (n: number) => String(Number(n.toFixed(2)));
  const out: MapCheck[] = [];
  const cols = c.cols, rows = c.rows;

  // Seams over the composed ground.
  const seam = mapSeam({ px: c.ground, w: c.w, h: c.h, t: c.t, variants: c.variants }, { palette: { entries: c.palette } } as unknown as Doc);
  out.push({
    id: 'seam', score: seam.score, limit: L.seam, pass: seam.score <= L.seam, shown: f2(seam.score), limitText: `≤ ${L.seam}`, groups: [],
    detail: `the tile grid over the whole ground: jump x ${f2(seam.jx)} y ${f2(seam.jy)}, line x ${f2(seam.lx)} y ${f2(seam.ly)}`,
  });

  // Repetition hot spots: straight runs of the same edge tile, and windows where one textured tile repeats.
  const keys = cellKeys(c);
  const flat = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) flat[y * cols + x] = flatCell(c, x, y) ? 1 : 0;
  const runs: { cells: Pt[]; name: string }[] = [];
  const edgeAt = (x: number, y: number) => !!c.top[y * cols + x]?.edge && !flat[y * cols + x];
  for (const horiz of [true, false]) {
    const A = horiz ? rows : cols, B = horiz ? cols : rows;
    for (let a = 0; a < A; a++) {
      let start = 0;
      for (let b = 1; b <= B; b++) {
        const at = (k: number): Pt => (horiz ? [k, a] : [a, k]);
        const [x0, y0] = at(start);
        const same = b < B && edgeAt(...at(b)) && keys[at(b)[1] * cols + at(b)[0]] === keys[y0 * cols + x0];
        if (same) continue;
        const len = b - start;
        if (edgeAt(x0, y0) && len > L.edgeRun) {
          const t = c.top[y0 * cols + x0]!;
          runs.push({ cells: Array.from({ length: len }, (_, k) => at(start + k)), name: `${t.asset}.${t.variant}` });
        }
        start = b;
      }
    }
  }
  const longest = runs.reduce((m, r) => Math.max(m, r.cells.length), 0);
  let worstRun = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!edgeAt(x, y)) continue;
      let k = 1;
      while (x + k < cols && edgeAt(x + k, y) && keys[y * cols + x + k] === keys[y * cols + x]) k++;
      worstRun = Math.max(worstRun, k);
      k = 1;
      while (y + k < rows && edgeAt(x, y + k) && keys[(y + k) * cols + x] === keys[y * cols + x]) k++;
      worstRun = Math.max(worstRun, k);
    }
  }
  const N = Math.min(L.window, cols, rows);
  const windows: { x: number; y: number; n: number; key: number }[] = [];
  let worstWin = 0;
  for (let y = 0; y + N <= rows; y++) for (let x = 0; x + N <= cols; x++) {
    const n = new Map<number, number>();
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = (y + j) * cols + x + i;
      // The open ground a map is filled with (the sea) is a backdrop, judged as its own tile.
      if (flat[k] || !c.top[k] || c.top[k]!.variant === 'outside') continue;
      n.set(keys[k]!, (n.get(keys[k]!) ?? 0) + 1);
    }
    let best = 0, bk = -1;
    for (const [k, v] of n) if (v > best) { best = v; bk = k; }
    worstWin = Math.max(worstWin, best);
    if (best > L.motif) windows.push({ x, y, n: best, key: bk });
  }
  // Hot spots: overlapping windows merged into the cells they repeat on.
  const hot = new Uint8Array(cols * rows);
  for (const w of windows) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = (w.y + j) * cols + w.x + i;
    if (keys[k] === w.key) hot[k] = 1;
  }
  const hotCells: Pt[] = [];
  for (let i = 0; i < hot.length; i++) if (hot[i]) hotCells.push([i % cols, Math.floor(i / cols)]);
  const motifNames = new Map<string, number>();
  for (const [x, y] of hotCells) { const t = c.top[y * cols + x]!; const k = `${t.asset}${t.variant ? `.${t.variant}` : ''}`; motifNames.set(k, (motifNames.get(k) ?? 0) + 1); }
  const box = (cells: Pt[]) => {
    const xs = cells.map((p) => p[0]), ys = cells.map((p) => p[1]);
    return `${Math.min(...xs)},${Math.min(...ys)} ${Math.max(...xs) - Math.min(...xs) + 1}x${Math.max(...ys) - Math.min(...ys) + 1}`;
  };
  const runPass = worstRun <= L.edgeRun, winPass = worstWin <= L.motif;
  const repGroups = [
    ...runs.map((r) => ({ label: `${r.cells.length} ${r.name} in a row at ${box(r.cells)}`, cells: r.cells })),
    ...(hotCells.length ? [{ label: `the same tile over and over (${[...motifNames].map(([k, n]) => `${k} ×${n}`).join(', ')})`, cells: hotCells }] : []),
  ];
  out.push({
    id: 'repetition', score: Math.max(worstRun / L.edgeRun, worstWin / L.motif), limit: 1, pass: runPass && winPass,
    shown: `run ${worstRun} · ${worstWin}/${N * N}`, limitText: `run ≤ ${L.edgeRun}, ≤ ${L.motif}/${N * N}`,
    groups: repGroups,
    detail: [
      `longest straight run of one edge tile: ${worstRun}${runs.length ? ` (${runs.slice(0, 4).map((r) => `${r.name} ×${r.cells.length} at ${box(r.cells)}`).join('; ')})` : ''}`,
      `most of one textured tile in a ${N}x${N} window: ${worstWin} of ${N * N}${hotCells.length ? ` (hot spots: ${[...motifNames].map(([k, n]) => `${k} on ${n} cells`).join(', ')})` : ''}`,
      ...(runPass && winPass ? [] : ['texture variants (an asset with variant of=<base>) break the pattern: the map picks among them cell by cell']),
    ].join('; '),
    parts: [
      { name: 'edge run', value: worstRun, limit: `≤ ${L.edgeRun}`, pass: runPass, detail: `the same edge tile in a straight line` },
      { name: 'motif', value: worstWin, limit: `≤ ${L.motif} of ${N * N}`, pass: winPass, detail: `one textured tile in a ${N}x${N} window` },
    ],
  });

  // Footprints: overlapping, off the map, changed since placed, standing on an edge or the outside ground.
  const fpGroups: { label: string; cells: Pt[] }[] = [];
  const objCells = new Map<number, number>();
  c.objects.forEach((ob, k) => {
    const e = d.map!.entries[ob.entry]!;
    const b = entryBox(e, ob.x, ob.y);
    const cells: Pt[] = [];
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) cells.push([x, y]);
    const at = `${ob.name} at ${ob.x},${ob.y}`;
    if (!ob.doc) { fpGroups.push({ label: `${at}: no such asset`, cells }); return; }
    const off = cells.filter(([x, y]) => x < 0 || y < 0 || x >= cols || y >= rows);
    if (off.length) fpGroups.push({ label: `${at}: off the map`, cells: cells.filter((p) => !off.includes(p)) });
    const fp = footprintOf(ob.doc);
    if (fp.cols !== e.cols || fp.rows !== e.rows || fp.anchor[0] !== e.anchor[0] || fp.anchor[1] !== e.anchor[1]) {
      fpGroups.push({ label: `${at}: placed as ${e.cols}x${e.rows} anchor ${e.anchor.join(',')}, its footprint is now ${fp.cols}x${fp.rows} anchor ${fp.anchor.join(',')} (place it again)`, cells });
    }
    const clash: Pt[] = [];
    const bad: Pt[] = [];
    for (const [x, y] of cells) {
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      const i = y * cols + x;
      if (objCells.has(i)) clash.push([x, y]); else objCells.set(i, k);
      const g = c.top[i];
      // Only the ground a map is filled with stops an object: its outside (the sea) and its edge tiles.
      if (!g) bad.push([x, y]);
      else if (g.variant === 'outside' || (g.edge && g.base)) bad.push([x, y]);
    }
    if (clash.length) fpGroups.push({ label: `${at}: overlaps ${c.objects[objCells.get(clash[0]![1] * cols + clash[0]![0])!]!.name}`, cells: clash });
    if (bad.length) {
      const g = c.top[bad[0]![1] * cols + bad[0]![0]];
      fpGroups.push({ label: `${at}: stands on ${!g ? 'nothing' : g.variant === 'outside' ? `${g.asset}'s outside ground` : `the edge tile ${g.asset}.${g.variant}`} (${bad.length} of ${cells.length} cells)`, cells: bad });
    }
  });
  out.push({
    id: 'footprint', score: fpGroups.length, limit: 0, pass: fpGroups.length === 0, shown: String(fpGroups.length), limitText: '0',
    groups: fpGroups, detail: fpGroups.length ? fpGroups.slice(0, 6).map((g) => g.label).join('; ') : `${c.objects.length} objects, every footprint on plain ground`,
  });

  // Draw order: overhanging art not drawn above actors, and roofs that hide what stands in front.
  const doGroups: { label: string; cells: Pt[] }[] = [];
  const t = c.t;
  c.objects.forEach((ob, k) => {
    if (!ob.doc) return;
    const [ac, ar] = artGrid(ob.doc);
    const src = flatten(ob.doc, 0);
    const over: Pt[] = [];
    for (let cy = 0; cy < ar; cy++) for (let cx = 0; cx < ac; cx++) {
      if (inFootprint(ob.fp, cx, cy) || cellFlag(ob.fp, cx, cy).roof) continue;
      let any = false;
      for (let y = 0; y < ob.doc.cellH && !any; y++) for (let x = 0; x < ob.doc.cellW; x++) if (src[(cy * ob.doc.cellH + y) * ob.doc.width + cx * ob.doc.cellW + x] !== TRANSPARENT) { any = true; break; }
      if (any) over.push([Math.floor(ob.px / t) + cx, Math.floor(ob.py / t) + cy]);
    }
    if (over.length) doGroups.push({ label: `${ob.name} at ${ob.x},${ob.y}: art outside its footprint is not a roof (an actor walking behind would be drawn over it)`, cells: over });
  });
  const hidden = new Map<string, Set<number>>();
  for (let i = 0; i < c.roofOwner.length; i++) {
    const r = c.roofOwner[i]!, a = c.artOwner[i]!;
    if (r < 0 || a < 0 || a === r) continue;
    if (c.objects[a]!.base <= c.objects[r]!.base) continue;
    const key = `${r}>${a}`;
    let s = hidden.get(key);
    if (!s) hidden.set(key, (s = new Set()));
    s.add(Math.floor(Math.floor(i / c.w) / t) * cols + Math.floor((i % c.w) / t));
  }
  for (const [key, s] of hidden) {
    const [r, a] = key.split('>').map(Number) as [number, number];
    const R = c.objects[r]!, A = c.objects[a]!;
    doGroups.push({ label: `${R.name} at ${R.x},${R.y}: its roof hides ${A.name} at ${A.x},${A.y}, which stands in front of it`, cells: [...s].map((i) => [i % cols, Math.floor(i / cols)] as Pt) });
  }
  out.push({
    id: 'draworder', score: doGroups.length, limit: 0, pass: doGroups.length === 0, shown: String(doGroups.length), limitText: '0',
    groups: doGroups, detail: doGroups.length ? doGroups.slice(0, 6).map((g) => g.label).join('; ') : 'objects in order of their base row; overhangs are roofs; no roof hides what stands in front',
  });

  // Coverage: missing assets, and cells whose tile is not drawn (a variant the map needs and its family lacks).
  const covGroups: { label: string; cells: Pt[] }[] = [];
  const empty = new Map<string, Pt[]>();
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const tt = c.top[y * cols + x];
    if (!tt || !tt.variant || tt.variant === 'outside') continue;
    let blank = true;
    for (let j = 0; j < t && blank; j++) for (let i = 0; i < t; i++) if (c.ground[(y * t + j) * c.w + x * t + i] !== TRANSPARENT) { blank = false; break; }
    if (blank) { const k = `${tt.asset}.${tt.variant}`; empty.set(k, [...(empty.get(k) ?? []), [x, y]]); }
  }
  for (const [k, cells] of empty) covGroups.push({ label: `${k} is not drawn`, cells });
  for (const p of c.problems) covGroups.push({ label: p, cells: [] });
  out.push({
    id: 'coverage', score: covGroups.length, limit: 0, pass: covGroups.length === 0, shown: String(covGroups.length), limitText: '0',
    groups: covGroups, detail: covGroups.length ? covGroups.map((g) => g.label).join('; ') : 'every tile and object the map names exists and is drawn',
  });
  return out;
}

// --- Texture variants (plan §4.1): the colour mix of a variant against its base, and its border

export interface VariantMatch {
  /** L1 distance between the colour histograms (shares), 0..2. */
  l1: number;
  /** Mean L* difference. */
  dl: number;
  /** Border pixels (the outer ring, 1 px) that differ from the base: where a variant meets its base, a seam. */
  border: Pt[];
  ok: boolean;
}

/** Does a variant match its base (the pilot's rule: L1 < 0.3, ΔL* < 2), and keep its border? */
export function variantMatch(base: Doc, v: Doc, frame = 0): VariantMatch {
  const a = flatten(base, frame), b = flatten(v, Math.min(frame, v.frameCount - 1));
  const hist = (px: Uint16Array, d: Doc) => {
    const n = new Map<string, number>();
    let tot = 0, l = 0;
    for (const x of px) {
      if (x === TRANSPARENT) continue;
      const hex = d.palette.entries[x]!.hex;
      n.set(hex, (n.get(hex) ?? 0) + 1);
      l += lstar(hex);
      tot++;
    }
    return { n, tot: Math.max(1, tot), l: l / Math.max(1, tot) };
  };
  const ha = hist(a, base), hb = hist(b, v);
  let l1 = 0;
  for (const k of new Set([...ha.n.keys(), ...hb.n.keys()])) l1 += Math.abs((ha.n.get(k) ?? 0) / ha.tot - (hb.n.get(k) ?? 0) / hb.tot);
  const dl = Math.abs(ha.l - hb.l);
  const border: Pt[] = [];
  const W = base.width, H = base.height;
  if (v.width === W && v.height === H && !base.family) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (x !== 0 && y !== 0 && x !== W - 1 && y !== H - 1) continue;
      const pa = a[y * W + x]!, pb = b[y * W + x]!;
      const ca = pa === TRANSPARENT ? '' : base.palette.entries[pa]!.hex, cb = pb === TRANSPARENT ? '' : v.palette.entries[pb]!.hex;
      if (ca !== cb) border.push([x, y]);
    }
  }
  return { l1, dl, border, ok: l1 < 0.3 && dl < 2 };
}

// --- Tiled export (plan §4.11)

export interface TmxExport {
  tmx: string;
  /** The ground tileset: every distinct tile the map's ground layers draw, in a grid. */
  tileset: { width: number; height: number; px: Uint16Array; columns: number; count: number };
  /** One image per object asset (Tiled's image-collection tileset). */
  objects: { name: string; width: number; height: number; px: Uint16Array }[];
  palette: { name: string; hex: string }[];
}

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A Tiled map: each ground layer (terrain, tiles) a tile layer of the distinct tiles it draws
 * (CSV), each objects layer an object group of tile objects (bottom-left placed, as Tiled does)
 * with their footprint, anchor and cell flags as properties. Overlays are left out (they are
 * engine effects). Files: `<name>.tmx`, `<name>.tiles.png`, `objects/<asset>.png`.
 */
export function mapToTmx(d: Doc, world: MapWorld): TmxExport {
  const t = d.map!.tile, cols = d.width, rows = d.height;
  const tiles: Uint16Array[] = [];
  const ids = new Map<string, number>();
  const layersXml: string[] = [];
  let palette: { name: string; hex: string }[] = [];
  let nextObj = 1;
  const objectAssets: string[] = [];
  const objXml: string[] = [];
  d.layers.forEach((l, li) => {
    const info = l.map;
    if (!info || info.kind === 'overlay') return;
    // Compose the layer alone (the others hidden) to read its tiles.
    const solo: Doc = { ...d, layers: d.layers.map((x, j) => ({ ...x, hidden: j !== li })) };
    const c = composeMapDoc(solo, world);
    palette = c.palette.length > palette.length ? c.palette : palette;
    if (info.kind === 'objects') {
      const objs = c.objects.filter((o) => o.layer === li && o.doc);
      objXml.push(`  <objectgroup id="${li + 1}" name="${xmlEsc(l.name)}"${l.hidden ? ' visible="0"' : ''}>`);
      for (const o of objs) {
        let k = objectAssets.indexOf(o.doc!.name);
        if (k < 0) { objectAssets.push(o.doc!.name); k = objectAssets.length - 1; }
        const e = d.map!.entries[o.entry]!;
        objXml.push(`   <object id="${nextObj++}" name="${xmlEsc(e.name)}" gid="${OBJ_GID + k}" x="${o.px}" y="${o.py + o.doc!.height}" width="${o.doc!.width}" height="${o.doc!.height}">`,
          `    <properties>`,
          `     <property name="cell" value="${o.x},${o.y}"/>`,
          `     <property name="footprint" value="${e.cols}x${e.rows}"/>`,
          `     <property name="anchor" value="${e.anchor.join(',')}"/>`,
          `     <property name="flags" value="${xmlEsc(o.fp.flags.join('/'))}"/>`,
          `    </properties>`,
          `   </object>`);
      }
      objXml.push(`  </objectgroup>`);
      return;
    }
    const gids: number[] = [];
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      const b = new Uint16Array(t * t);
      let any = false;
      for (let y = 0; y < t; y++) for (let x = 0; x < t; x++) {
        const v = c.px[(cy * t + y) * c.w + cx * t + x]!;
        b[y * t + x] = v;
        if (v !== TRANSPARENT) any = true;
      }
      if (!any) { gids.push(0); continue; }
      const key = Array.from(b).join(',');
      let id = ids.get(key);
      if (id === undefined) { ids.set(key, (id = tiles.length)); tiles.push(b); }
      gids.push(id + 1);
    }
    const csv = Array.from({ length: rows }, (_, y) => gids.slice(y * cols, y * cols + cols).join(',')).join(',\n');
    layersXml.push(`  <layer id="${li + 1}" name="${xmlEsc(l.name)}" width="${cols}" height="${rows}"${l.hidden ? ' visible="0"' : ''}>\n   <data encoding="csv">\n${csv}\n</data>\n  </layer>`);
  });
  // Composing with every layer gives the full palette every tile and object uses.
  palette = composeMapDoc(d, world).palette;
  const columns = Math.max(1, Math.min(16, tiles.length));
  const trows = Math.max(1, Math.ceil(tiles.length / columns));
  const sheet = new Uint16Array(columns * t * trows * t).fill(TRANSPARENT);
  tiles.forEach((b, i) => {
    const ox = (i % columns) * t, oy = Math.floor(i / columns) * t;
    for (let y = 0; y < t; y++) sheet.set(b.subarray(y * t, y * t + t), (oy + y) * columns * t + ox);
  });
  const pal = new MapPalette(palette);
  const objects = objectAssets.map((n) => {
    const doc = world.get(n)!;
    const map = pal.of(doc);
    return { name: n, width: doc.width, height: doc.height, px: flatten(doc, 0).map((v) => (v === TRANSPARENT ? v : map[v]!)) };
  });
  const tsxObjects = objects.length ? [
    ` <tileset firstgid="${OBJ_GID}" name="objects" tilewidth="${Math.max(...objects.map((o) => o.width))}" tileheight="${Math.max(...objects.map((o) => o.height))}" tilecount="${objects.length}" columns="0">`,
    ...objects.flatMap((o, i) => [`  <tile id="${i}">`, `   <image width="${o.width}" height="${o.height}" source="objects/${o.name}.png"/>`, `  </tile>`]),
    ` </tileset>`,
  ] : [];
  const tmx = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<map version="1.10" tiledversion="1.10.2" orientation="orthogonal" renderorder="right-down" width="${cols}" height="${rows}" tilewidth="${t}" tileheight="${t}" infinite="0" nextlayerid="${d.layers.length + 1}" nextobjectid="${nextObj}">`,
    ` <tileset firstgid="1" name="${xmlEsc(d.name)}-tiles" tilewidth="${t}" tileheight="${t}" tilecount="${tiles.length}" columns="${columns}">`,
    `  <image source="${xmlEsc(d.name)}.tiles.png" width="${columns * t}" height="${trows * t}"/>`,
    ` </tileset>`,
    ...tsxObjects,
    ...layersXml,
    ...objXml,
    `</map>`,
    '',
  ].join('\n');
  return { tmx, tileset: { width: columns * t, height: trows * t, px: sheet, columns, count: tiles.length }, objects, palette: pal.entries };
}

/** Object tiles start here, after any ground tileset a map could need. */
const OBJ_GID = 100001;

// --- Split (plan §4.10): an oversized asset as one-cell pieces plus a placement stamp

export interface SplitPiece {
  name: string;
  cx: number;
  cy: number;
  px: Uint16Array;
  /** No pixel drawn: an engine may leave it out (the stamp still lists it). */
  empty: boolean;
}

export interface SplitStamp {
  asset: string;
  cellW: number;
  cellH: number;
  cols: number;
  rows: number;
  /** Each piece and its place in cells from the art's top-left; with the cell's flags. */
  pieces: { name: string; dx: number; dy: number; block: boolean; roof: boolean; footprint: boolean }[];
  anchor: [number, number];
  footprint: [number, number];
  at: [number, number];
}

/** Split a frame of an asset into one-cell pieces named <name>_<cx>_<cy>, and the stamp that puts them back. */
export function splitAsset(d: Doc, frame = 0): { pieces: SplitPiece[]; stamp: SplitStamp } {
  const [ac, ar] = artGrid(d);
  const fp = footprintOf(d);
  const px = flatten(d, frame);
  const pieces: SplitPiece[] = [];
  for (let cy = 0; cy < ar; cy++) for (let cx = 0; cx < ac; cx++) {
    const b = new Uint16Array(d.cellW * d.cellH);
    let empty = true;
    for (let y = 0; y < d.cellH; y++) for (let x = 0; x < d.cellW; x++) {
      const v = px[(cy * d.cellH + y) * d.width + cx * d.cellW + x]!;
      b[y * d.cellW + x] = v;
      if (v !== TRANSPARENT) empty = false;
    }
    pieces.push({ name: `${d.name}_${cx}_${cy}`, cx, cy, px: b, empty });
  }
  return {
    pieces,
    stamp: {
      asset: d.name, cellW: d.cellW, cellH: d.cellH, cols: ac, rows: ar,
      pieces: pieces.map((p) => ({ name: p.name, dx: p.cx, dy: p.cy, ...cellFlag(fp, p.cx, p.cy), footprint: inFootprint(fp, p.cx, p.cy) })),
      anchor: [fp.at[0] + fp.anchor[0], fp.at[1] + fp.anchor[1]], footprint: [fp.cols, fp.rows], at: [fp.at[0], fp.at[1]],
    },
  };
}

/** Put split pieces back together by their stamp: the asset's flat pixels. */
export function reassemble(stamp: SplitStamp, pieces: { name: string; px: Uint16Array }[]): Uint16Array {
  const W = stamp.cols * stamp.cellW, H = stamp.rows * stamp.cellH;
  const out = new Uint16Array(W * H).fill(TRANSPARENT);
  const by = new Map(pieces.map((p) => [p.name, p.px]));
  for (const p of stamp.pieces) {
    const b = by.get(p.name);
    if (!b) continue;
    for (let y = 0; y < stamp.cellH; y++) out.set(b.subarray(y * stamp.cellW, (y + 1) * stamp.cellW), (p.dy * stamp.cellH + y) * W + p.dx * stamp.cellW);
  }
  return out;
}

/** Luma per palette entry of a composed map (for callers that score it). */
export const mapLuma = (c: ComposedMap): number[] => c.palette.map((e) => luma601(e.hex));

// --- What changed on a map (for `changes` and the diff view)

export interface MapDiff {
  /** Cells whose composed pixels differ. */
  cells: Pt[];
  text: string;
  /** Before and after of the changed part (a cell's margin round it), at the scale, changed cells outlined. */
  img: Rgba;
}

/** The difference between two states of a map: what moved, was placed or taken away, the terrain painted, and a picture. */
export function mapDiff(before: Doc | null, after: Doc, world: MapWorld, scale = 2): MapDiff {
  const a = composeMapDoc(after, world);
  const b = before?.map && before.width === after.width && before.height === after.height ? composeMapDoc(before, world) : null;
  const t = a.t, cols = a.cols, rows = a.rows;
  const cells: Pt[] = [];
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    let diff = !b;
    for (let y = 0; y < t && !diff; y++) for (let x = 0; x < t; x++) {
      const i = (cy * t + y) * a.w + cx * t + x;
      const pa = a.px[i]!, pb = b!.px[i]!;
      const ca = pa === TRANSPARENT ? '' : a.palette[pa]!.hex, cb = pb === TRANSPARENT ? '' : b!.palette[pb]!.hex;
      if (ca !== cb) { diff = true; break; }
    }
    if (diff) cells.push([cx, cy]);
  }
  const key = (d: Doc, p: Placed) => { const e = d.map!.entries[p.entry]!; return `${d.layers[p.layer]!.name}|${e.name}${e.variant ? `.${e.variant}` : ''}`; };
  const was = before?.map ? placements(before).map((p) => ({ k: key(before, p), p })) : [];
  const now = placements(after).map((p) => ({ k: key(after, p), p }));
  const gone = was.filter((x) => !now.some((y) => y.k === x.k && y.p.x === x.p.x && y.p.y === x.p.y));
  const added = now.filter((x) => !was.some((y) => y.k === x.k && y.p.x === x.p.x && y.p.y === x.p.y));
  const lines: string[] = [];
  for (const g of [...gone]) {
    const j = added.findIndex((x) => x.k === g.k);
    if (j < 0) continue;
    const n = added[j]!;
    lines.push(`moved: ${g.k.split('|')[1]} ${g.p.x},${g.p.y} → ${n.p.x},${n.p.y} (layer ${g.k.split('|')[0]})`);
    added.splice(j, 1);
    gone.splice(gone.indexOf(g), 1);
  }
  for (const g of gone) lines.push(`taken away: ${g.k.split('|')[1]} at ${g.p.x},${g.p.y} (layer ${g.k.split('|')[0]})`);
  for (const n of added) lines.push(`placed: ${n.k.split('|')[1]} at ${n.p.x},${n.p.y} (layer ${n.k.split('|')[0]})`);
  after.layers.forEach((l, li) => {
    if (l.map?.kind !== 'terrain' || !before?.map) return;
    const bi = before.layers.findIndex((x) => x.name === l.name);
    if (bi < 0) { lines.push(`terrain layer ${l.name} added`); return; }
    const ca = after.cels[li]![0]!, cb = before.cels[bi]![0]!;
    let on = 0, off = 0;
    for (let i = 0; i < ca.length; i++) { if (ca[i] === 1 && cb[i] !== 1) on++; else if (ca[i] !== 1 && cb[i] === 1) off++; }
    if (on || off) lines.push(`terrain ${l.name}: ${on} cells painted, ${off} erased`);
  });
  const text = cells.length ? `${cells.length} cells look different${lines.length ? `; ${lines.join('; ')}` : ''}` : `no cell looks different${lines.length ? `; ${lines.join('; ')}` : ''}`;
  const xs = cells.map((p) => p[0]), ys = cells.map((p) => p[1]);
  const r = cells.length ? { x: Math.max(0, Math.min(...xs) - 1), y: Math.max(0, Math.min(...ys) - 1), x1: Math.min(cols - 1, Math.max(...xs) + 1), y1: Math.min(rows - 1, Math.max(...ys) + 1) } : { x: 0, y: 0, x1: Math.min(cols, 8) - 1, y1: Math.min(rows, 6) - 1 };
  const region = { x: r.x, y: r.y, w: r.x1 - r.x + 1, h: r.y1 - r.y + 1 };
  const right = paintComposed(a, { scale, region, marks: cells });
  const left = b ? paintComposed(b, { scale, region, marks: cells }) : null;
  const gap = 8;
  const W = right.width * 2 + gap, H = right.height;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = (y * W + x) * 4;
    const src = x < right.width ? left : x >= right.width + gap ? right : null;
    const sx = x < right.width ? x : x - right.width - gap;
    if (!src) { data[k] = 30; data[k + 1] = 31; data[k + 2] = 36; data[k + 3] = 255; continue; }
    const j = (y * right.width + sx) * 4;
    data[k] = src.data[j]!; data[k + 1] = src.data[j + 1]!; data[k + 2] = src.data[j + 2]!; data[k + 3] = 255;
  }
  return { cells, text, img: { width: W, height: H, data } };
}
