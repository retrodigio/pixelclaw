// The indexed document: layers x frames of cels (palette indices or transparent), a cell grid, a
// wrap flag, the document's own palette (lockable), open notes, stamps, macros, each author's
// editing context (the layer and frame they draw on, their selection, symmetry and brush), and the
// animation (plan §4.4): frame durations in ticks, tags, directional views (a view can be a live
// mirror of another), a pivot and a ground line. Linked cels are one shared pixel array.

import type { Palette, Role } from './palette.ts';
import type { Geometry, SchemeJson } from './schemes.ts';

/** The pixel value for "no colour". Palette entry i is stored as i. */
export const TRANSPARENT = 0xffff;

export type DocKind = 'tile' | 'sprite' | 'sheet' | 'icon' | 'family' | 'overlay' | 'object' | 'map' | 'font';
export const DOC_KINDS: readonly DocKind[] = ['tile', 'sprite', 'sheet', 'icon', 'family', 'overlay', 'object', 'map', 'font'];

/**
 * How an icon is exported (plan §4.5): `tone` art is recoloured by the game (role entries, written
 * through the profile's encoding), `full` art is drawn as is (often a white silhouette), `channel`
 * art is pure-RGB channel masks (every colour's channels 0 or 255, written exactly).
 */
export type IconMode = 'tone' | 'full' | 'channel';
export const ICON_MODES: readonly IconMode[] = ['tone', 'full', 'channel'];

/**
 * A glyph sheet (plan §4.6): a grid of cells, one per code point in `chars` order (row-major,
 * `cols` cells a row), each glyph drawn from its cell's left edge. `baseline` is the cell row the
 * glyphs stand on (the bottom row of a capital), `line` the line height in pixels, `spacing` the
 * pixels added after each glyph's advance. A glyph's advance is its own (`advances`, by code
 * point) or its ink width (the rightmost drawn column + 1); an empty glyph's is half the cell.
 */
export interface FontState {
  chars: number[];
  cols: number;
  baseline: number;
  line: number;
  spacing: number;
  advances: Record<number, number>;
}

/**
 * An image under the art (plan §6): a content-addressed blob (blobs/<sha256>.png) of `iw` x `ih`
 * pixels shown on a reference layer, stretched over the document rectangle x,y w x h. Never part
 * of the art or an export; `snap` reads it into a draft layer. `layout` is the flat template the
 * image was made from (a blob too), when there was one.
 */
export interface Underlay {
  blob: string;
  iw: number;
  ih: number;
  x: number;
  y: number;
  w: number;
  h: number;
  layout: string | null;
}

/**
 * An asset's footprint on a map (plan §4.10): `cols` x `rows` grid cells of its art grid (the
 * canvas in cells), starting at art cell `at` (default: the bottom-left of the art), placed by
 * its `anchor` cell (within the footprint). `flags` has a row per art cell row, a character per
 * art cell: `.` nothing, `b` blocks movement, `r` roof or canopy (drawn above actors), `x` both.
 * Footprint cells that do not block are walkable.
 */
export interface Footprint {
  cols: number;
  rows: number;
  at: [number, number];
  anchor: [number, number];
  flags: string[];
}

/** What a map layer holds (plan §4.11). Terrain layers hold 1 where their family's terrain is. */
export type MapLayerInfo =
  | { kind: 'terrain'; family: string; outside: boolean; walkable?: boolean }
  | { kind: 'tiles' }
  | { kind: 'objects' }
  | { kind: 'overlay'; overlay: string; on: string };

/** A thing a map places by name: a tile, a family's variant, an object; with the footprint it was placed with. */
export interface MapEntry {
  name: string;
  /** A family's variant placed by name (shore.ns), else null. */
  variant: string | null;
  cols: number;
  rows: number;
  anchor: [number, number];
}

/**
 * A map document (plan §4.11): its canvas is the grid of cells (one 'pixel' per cell), each
 * layer's cels hold what is in each cell (terrain: 1; tiles and objects: an entry index at the
 * anchor cell). The art is read from the assets it names when it is drawn, so a map redraws
 * itself when a tile changes, and its tape never reads another asset.
 */
export interface MapState {
  /** Pixels per cell. */
  tile: number;
  entries: MapEntry[];
}

/**
 * An autotile family (plan §4.2): a sheet of the scheme's variants, with the two textures the
 * variants share and, optionally, a coverage map to paint and cut from. The `ground` layer of
 * every variant is the textures laid by the band geometry; the `band` layer of every variant that
 * is not a piece (and not detached) is assembled from the pieces' quadrants after every command.
 */
export interface FamilyState {
  scheme: string;
  /** The tile size (square, even). */
  tile: number;
  geometry: Geometry;
  /** Variants drawn by hand (or cut from the map): their band layer is not derived. */
  detached: string[];
  /** The coverage map's size in tiles (0x0: none). */
  mapCols: number;
  mapRows: number;
  /** The coverage map's terrain (1 = the family's terrain), once laid out; empty otherwise. */
  terrain: Uint8Array;
  /** A project's own scheme, as its tape recorded it (null: a built-in scheme by name). */
  def?: SchemeJson | null;
  /** A texture variant that inherits its band from this family (G13): `variant of=<it> band=inherit`. */
  bandOf?: string;
}

export type OverlayMode = 'cycle' | 'pingpong' | 'wave' | 'sparkle';
export const OVERLAY_MODES: readonly OverlayMode[] = ['cycle', 'pingpong', 'wave', 'sparkle'];

/**
 * An overlay (plan §4.3): a sub-tile sprite drawn over tiles of a map in a mode: all in step
 * (cycle, pingpong), in a wave across the map, or as sparkles at random times.
 */
export interface OverlayState {
  mode: OverlayMode;
  /** Which tiles of a family's map it is drawn on. */
  on: 'outside' | 'inside' | 'all';
  /** The overlay's top-left in the tile (null: centred). */
  anchor: [number, number] | null;
  /** Each instance is moved by up to this many pixels either way (seeded per tile). */
  spread: [number, number];
  /** One tile in this many gets an instance (seeded). */
  every: number;
  /** Sparkle: ticks hidden between showings. */
  rest: number;
  seed: number;
}

/**
 * A layer. Layers are listed bottom to top; the flat image takes the topmost non-transparent pixel
 * of the visible art layers. A `reference` layer is never part of the art (nor of an export): views
 * show it faded underneath, for tracing.
 */
export interface Layer {
  name: string;
  hidden: boolean;
  locked: boolean;
  reference: boolean;
  /** A map's layer: what it holds (never changed in place, so copies may share it). */
  map?: MapLayerInfo;
  /** A reference layer showing an image (never changed in place, so copies may share it). */
  underlay?: Underlay;
}

/** A note pinned to a pixel (1x1) or a region, for whoever reads the tape next (plan §1.3). */
export interface Note {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

/** Live symmetry: axes as doubled coordinates (x2 = 23 mirrors x to 23 - x, an axis at 11.5). */
export interface Mirror {
  x2: number | null;
  y2: number | null;
}

export type Brush = { shape: 'square' | 'circle'; size: number } | { shape: 'stamp'; stamp: string };

/** Where and how one author draws. Each author has their own, so nobody's selection clips anyone else. */
export interface AuthorCtx {
  layer: number;
  frame: number;
  /** The selection mask (1 = selected), width*height, or null when nothing is selected. */
  sel: Uint8Array | null;
  mirror: Mirror | null;
  brush: Brush | null;
}

/** A saved piece of art: w*h pixels, TRANSPARENT where the stamp leaves the canvas alone. */
export interface Stamp {
  w: number;
  h: number;
  px: Uint16Array;
}

export interface Macro {
  params: string[];
  body: string;
}

/** The default frame duration in ticks (the engine profile's `frameTicks` default, §7.4). */
export const DEFAULT_TICKS = 10;

export type Loop = 'cycle' | 'pingpong';

/** A named frame range (0-based, inclusive) and how it loops. */
export interface Tag {
  name: string;
  from: number;
  to: number;
  loop: Loop;
}

/** A direction's frames (0-based, inclusive). A mirror view's cels are its source's, flipped left to right. */
export interface View {
  name: string;
  from: number;
  to: number;
  mirror: string | null;
}

export interface Doc {
  kind: DocKind;
  name: string;
  width: number;
  height: number;
  cellW: number;
  cellH: number;
  wrap: boolean;
  palette: Palette;
  /** A locked palette refuses palette edits and ramp changes. */
  paletteLocked: boolean;
  layers: Layer[];
  frameCount: number;
  /** cels[layer][frame]: width*height palette indices, row-major. */
  cels: Uint16Array[][];
  /** Editing contexts by author. Authors without one draw on the home layer and frame, with nothing else set. */
  ctx: Record<string, AuthorCtx>;
  /** Where authors without a context draw: it moves with its layer and frame when others are added or removed. */
  home: { layer: number; frame: number };
  /** Open notes, in the order they were written. */
  notes: Note[];
  stamps: Record<string, Stamp>;
  macros: Record<string, Macro>;
  /** Each frame's duration in ticks (the project sets the tick rate). */
  ticks: number[];
  tags: Tag[];
  views: View[];
  /** The pixel the sprite stands on (null: not set). */
  pivot: [number, number] | null;
  /** The row the feet rest on (null: not set). */
  ground: number | null;
  family: FamilyState | null;
  overlay: OverlayState | null;
  /** Where the asset stands on a map (null: its whole art grid, placed by the bottom-left cell). */
  footprint: Footprint | null;
  /** The asset this one is a texture variant of (plan §4.1): maps pick among an asset and its variants per cell. */
  variantOf: string | null;
  /** The asset this one is a higher-density copy of, and how many times its size (plan §4.7). */
  densityOf: { of: string; d: number } | null;
  map: MapState | null;
  /** Named points on the tape (plan §7.2 marks); `reviewed`, `approved` and `rejected` set the asset's status (plan §7.3). */
  marks: Mark[];
  /** An icon's export mode (null: tone when the palette has roles, else full). */
  iconMode: IconMode | null;
  /** A glyph sheet's code points and metrics (kind font). */
  font: FontState | null;
}

/** An icon's export mode, with the default filled in. */
export function iconModeOf(d: Doc): IconMode {
  return d.iconMode ?? (d.palette.entries.some((e) => e.role) ? 'tone' : 'full');
}

export function cloneFont(f: FontState): FontState {
  return { ...f, chars: [...f.chars], advances: { ...f.advances } };
}

/** A mark: a name on the tape at a command, with what the art was then (its art hash). */
export interface Mark {
  name: string;
  seq: number;
  by: string;
  text: string;
  /** artHash of the document when the mark was written: a later change to the art makes it stale. */
  art: string;
}

export function cloneFootprint(f: Footprint): Footprint {
  return { ...f, at: [f.at[0], f.at[1]], anchor: [f.anchor[0], f.anchor[1]], flags: [...f.flags] };
}

export function cloneMap(m: MapState): MapState {
  return { tile: m.tile, entries: m.entries.map((e) => ({ ...e, anchor: [e.anchor[0], e.anchor[1]] })) };
}

export function newLayer(name: string, o: Partial<Layer> = {}): Layer {
  return { name, hidden: false, locked: false, reference: false, ...o };
}

export function createDoc(o: {
  kind: DocKind; name: string; width: number; height: number; cellW: number; cellH: number;
  wrap: boolean; palette: Palette; bg: number; family?: FamilyState | null; overlay?: OverlayState | null; map?: MapState | null; font?: FontState | null;
}): Doc {
  const pixels = new Uint16Array(o.width * o.height).fill(o.bg);
  // A family draws its textures on 'ground' and its band on 'band' (see family.ts).
  // A map starts with one layer of tiles placed by name.
  const layers = o.family ? [newLayer('ground'), newLayer('band')] : o.map ? [newLayer('floor', { map: { kind: 'tiles' } })] : [newLayer('main')];
  const cels = o.family ? [[pixels], [new Uint16Array(o.width * o.height).fill(TRANSPARENT)]] : [[pixels]];
  return {
    kind: o.kind, name: o.name, width: o.width, height: o.height, cellW: o.cellW, cellH: o.cellH,
    wrap: o.wrap, palette: o.palette, paletteLocked: false, layers, frameCount: 1, cels,
    // A family's authors draw on its band layer unless they choose another.
    ctx: {}, home: { layer: o.family ? 1 : 0, frame: 0 }, notes: [], stamps: {}, macros: {},
    ticks: [DEFAULT_TICKS], tags: [], views: [], pivot: null, ground: null,
    family: o.family ? cloneFamily(o.family) : null, overlay: o.overlay ? cloneOverlay(o.overlay) : null,
    footprint: null, variantOf: null, densityOf: null, map: o.map ? cloneMap(o.map) : null, marks: [],
    iconMode: null, font: o.font ? cloneFont(o.font) : null,
  };
}

export function cloneFamily(f: FamilyState): FamilyState {
  return { ...f, geometry: { ...f.geometry, bands: f.geometry.bands.map((b) => ({ ...b })) }, detached: [...f.detached], terrain: f.terrain.slice() };
}

export function cloneOverlay(o: OverlayState): OverlayState {
  return { ...o, anchor: o.anchor ? [o.anchor[0], o.anchor[1]] : null, spread: [o.spread[0], o.spread[1]] };
}

/** Copy each layer's cels, keeping linked cels (one shared array) linked in the copy. */
function cloneCels(cels: Uint16Array[][]): Uint16Array[][] {
  return cels.map((fr) => {
    const seen = new Map<Uint16Array, Uint16Array>();
    return fr.map((c) => {
      let k = seen.get(c);
      if (!k) seen.set(c, (k = c.slice()));
      return k;
    });
  });
}

/** Linked cels as [layer, frame, the first frame sharing its array], for frames after the first of each link. */
export function celLinks(d: Doc): [number, number, number][] {
  const out: [number, number, number][] = [];
  d.cels.forEach((fr, l) => fr.forEach((c, f) => {
    const g = fr.indexOf(c);
    if (g !== f) out.push([l, f, g]);
  }));
  return out;
}

/** Is anything about the animation set beyond a plain list of frames at the default duration? */
function hasAnim(d: Doc): boolean {
  return d.ticks.some((t) => t !== DEFAULT_TICKS) || d.tags.length > 0 || d.views.length > 0 || d.pivot !== null || d.ground !== null || celLinks(d).length > 0;
}

function cloneCtx(c: AuthorCtx): AuthorCtx {
  return { ...c, sel: c.sel ? c.sel.slice() : null, mirror: c.mirror ? { ...c.mirror } : null, brush: c.brush ? { ...c.brush } : null };
}

export function cloneDoc(d: Doc): Doc {
  return {
    ...d, layers: d.layers.map((l) => ({ ...l })), cels: cloneCels(d.cels),
    ticks: [...d.ticks], tags: d.tags.map((t) => ({ ...t })), views: d.views.map((v) => ({ ...v })), pivot: d.pivot ? [d.pivot[0], d.pivot[1]] : null,
    ctx: Object.fromEntries(Object.entries(d.ctx).map(([k, v]) => [k, cloneCtx(v)])),
    home: { ...d.home },
    family: d.family ? cloneFamily(d.family) : null, overlay: d.overlay ? cloneOverlay(d.overlay) : null,
    footprint: d.footprint ? cloneFootprint(d.footprint) : null, map: d.map ? cloneMap(d.map) : null,
    notes: d.notes.map((n) => ({ ...n })), marks: d.marks.map((m) => ({ ...m })), font: d.font ? cloneFont(d.font) : null,
    stamps: Object.fromEntries(Object.entries(d.stamps).map(([k, s]) => [k, { ...s, px: s.px.slice() }])),
    macros: Object.fromEntries(Object.entries(d.macros).map(([k, m]) => [k, { params: [...m.params], body: m.body }])),
  };
}

/** An author's editing context (read-only: the home layer and frame when they have none). */
export function ctxOf(d: Doc, by: string): AuthorCtx {
  return d.ctx[by] ?? { layer: d.home.layer, frame: d.home.frame, sel: null, mirror: null, brush: null };
}

/** Change an author's context; a context back at the default is dropped, so it adds nothing to the state. */
export function setCtx(d: Doc, by: string, change: Partial<AuthorCtx>): void {
  const c = { ...ctxOf(d, by), ...change };
  if (c.layer === d.home.layer && c.frame === d.home.frame && !c.sel && !c.mirror && !c.brush) delete d.ctx[by];
  else d.ctx[by] = c;
}

/**
 * Renumber every author's layer and frame (and the home ones) after layers or frames moved:
 * `layer(i)` and `frame(f)` give the new index of what was at i or f.
 */
export function remapCtx(d: Doc, layer: (i: number) => number, frame: (f: number) => number): void {
  const old = Object.keys(d.ctx).map((a) => [a, ctxOf(d, a)] as const);
  d.home = { layer: layer(d.home.layer), frame: frame(d.home.frame) };
  for (const [a, c] of old) d.ctx[a] = { ...c, layer: layer(c.layer), frame: frame(c.frame) };
  for (const [a] of old) setCtx(d, a, {});
}

/** The cel an author draws on. */
export function activeCel(d: Doc, by = ''): Uint16Array {
  const c = ctxOf(d, by);
  return d.cels[c.layer]![c.frame]!;
}

/** The art layers that make up the flat image: visible, not reference. */
export function artLayers(d: Doc): number[] {
  return d.layers.flatMap((l, i) => (l.hidden || l.reference ? [] : [i]));
}

/** The flattened art of a frame: the topmost non-transparent pixel of the visible art layers. */
export function flatten(d: Doc, frame = 0): Uint16Array {
  return composite(d, frame, artLayers(d));
}

/** The visible reference layers of a frame, flattened (shown faded under the art). */
export function flattenReference(d: Doc, frame = 0): Uint16Array | null {
  const refs = d.layers.flatMap((l, i) => (l.reference && !l.hidden ? [i] : []));
  return refs.length ? composite(d, frame, refs) : null;
}

function composite(d: Doc, frame: number, layers: number[]): Uint16Array {
  const out = new Uint16Array(d.width * d.height).fill(TRANSPARENT);
  for (const l of layers) {
    const cel = d.cels[l]![frame]!;
    for (let i = 0; i < out.length; i++) if (cel[i] !== TRANSPARENT) out[i] = cel[i]!;
  }
  return out;
}

/** UTF-8 encode without TextEncoder (core uses no host APIs). */
export function utf8(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

export function utf8Decode(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length;) {
    const c = b[i]!;
    let cp: number;
    if (c < 0x80) { cp = c; i += 1; }
    else if (c < 0xe0) { cp = ((c & 31) << 6) | (b[i + 1]! & 63); i += 2; }
    else if (c < 0xf0) { cp = ((c & 15) << 12) | ((b[i + 1]! & 63) << 6) | (b[i + 2]! & 63); i += 3; }
    else { cp = ((c & 7) << 18) | ((b[i + 1]! & 63) << 12) | ((b[i + 2]! & 63) << 6) | (b[i + 3]! & 63); i += 4; }
    s += String.fromCodePoint(cp);
  }
  return s;
}

const sortedKeys = (o: Record<string, unknown>): string[] => Object.keys(o).sort();

/**
 * Canonical bytes for a document: a magic line, a JSON header with fixed key order, then every cel
 * as little-endian u16, every selection mask (one byte per pixel, authors in sorted order) and
 * every stamp's pixels (u16, stamps in sorted order). Two documents are the same iff these bytes
 * are, and `deserializeDoc` rebuilds the document from them (the body of a checkpoint file).
 */
export function serializeDoc(d: Doc): Uint8Array {
  const authors = sortedKeys(d.ctx);
  const stamps = sortedKeys(d.stamps);
  const macros = sortedKeys(d.macros);
  const header = JSON.stringify({
    kind: d.kind, name: d.name, width: d.width, height: d.height, cellW: d.cellW, cellH: d.cellH, wrap: d.wrap,
    palette: {
      name: d.palette.name, entries: d.palette.entries.map((e) => (e.role ? [e.key, e.name, e.hex, e.role] : [e.key, e.name, e.hex])),
      ramps: sortedKeys(d.palette.ramps).map((k) => [k, d.palette.ramps[k]]), locked: d.paletteLocked,
    },
    layers: d.layers.map((l) => (l.map ? [l.name, l.hidden, l.locked, l.reference, mapLayerJson(l.map)] : [l.name, l.hidden, l.locked, l.reference])), frameCount: d.frameCount,
    home: [d.home.layer, d.home.frame],
    notes: d.notes.map((m) => [m.id, m.x, m.y, m.w, m.h, m.text]),
    ctx: authors.map((a) => {
      const c = d.ctx[a]!;
      const brush = !c.brush ? null : c.brush.shape === 'stamp' ? ['stamp', c.brush.stamp] : [c.brush.shape, c.brush.size];
      return [a, c.layer, c.frame, !!c.sel, c.mirror ? [c.mirror.x2, c.mirror.y2] : null, brush];
    }),
    stamps: stamps.map((s) => [s, d.stamps[s]!.w, d.stamps[s]!.h]),
    macros: macros.map((m) => [m, d.macros[m]!.params, d.macros[m]!.body]),
    // Written only when set, so documents without animation keep the bytes (and hashes) they had.
    ...(hasAnim(d) ? {
      anim: {
        ticks: d.ticks, tags: d.tags.map((t) => [t.name, t.from, t.to, t.loop]), views: d.views.map((v) => [v.name, v.from, v.to, v.mirror]),
        pivot: d.pivot, ground: d.ground, links: celLinks(d),
      },
    } : {}),
    ...(d.family ? {
      family: {
        scheme: d.family.scheme, tile: d.family.tile, inset: d.family.geometry.inset, radius: d.family.geometry.radius,
        ...(d.family.geometry.fillet !== undefined ? { fillet: d.family.geometry.fillet } : {}),
        ...(d.family.geometry.jitter ? { jitter: [d.family.geometry.jitter.px, d.family.geometry.jitter.seed] } : {}),
        ...(d.family.bandOf ? { bandOf: d.family.bandOf } : {}),
        bands: d.family.geometry.bands.map((b) => [b.w, b.fill]), detached: d.family.detached, map: [d.family.mapCols, d.family.mapRows],
        terrain: Array.from(d.family.terrain).join(''),
        ...(d.family.def ? { def: d.family.def } : {}),
      },
    } : {}),
    ...(d.overlay ? {
      overlay: { mode: d.overlay.mode, on: d.overlay.on, anchor: d.overlay.anchor, spread: d.overlay.spread, every: d.overlay.every, rest: d.overlay.rest, seed: d.overlay.seed },
    } : {}),
    ...(d.footprint ? { footprint: [d.footprint.cols, d.footprint.rows, d.footprint.at, d.footprint.anchor, d.footprint.flags] } : {}),
    ...(d.variantOf ? { variantOf: d.variantOf } : {}),
    ...(d.densityOf ? { densityOf: [d.densityOf.of, d.densityOf.d] } : {}),
    ...(d.map ? { map: { tile: d.map.tile, entries: d.map.entries.map((e) => [e.name, e.variant, e.cols, e.rows, e.anchor]) } } : {}),
    ...(d.marks.length ? { marks: d.marks.map((m) => [m.name, m.seq, m.by, m.text, m.art]) } : {}),
    ...(d.iconMode ? { iconMode: d.iconMode } : {}),
    ...(d.font ? { font: [d.font.chars.join(','), d.font.cols, d.font.baseline, d.font.line, d.font.spacing, Object.keys(d.font.advances).map(Number).sort((a, b) => a - b).map((c) => [c, d.font!.advances[c]])] } : {}),
    ...(d.layers.some((l) => l.underlay) ? {
      underlays: d.layers.flatMap((l, i) => (l.underlay ? [[i, l.underlay.blob, l.underlay.iw, l.underlay.ih, l.underlay.x, l.underlay.y, l.underlay.w, l.underlay.h, l.underlay.layout]] : [])),
    } : {}),
  });
  const head = utf8('PCLAWDOC 2\n' + header + '\n');
  const n = d.width * d.height;
  const sels = authors.flatMap((a) => (d.ctx[a]!.sel ? [d.ctx[a]!.sel!] : []));
  const stampPx = stamps.reduce((s, k) => s + d.stamps[k]!.px.length, 0);
  const out = new Uint8Array(head.length + d.layers.length * d.frameCount * n * 2 + sels.length * n + stampPx * 2);
  out.set(head, 0);
  let o = head.length;
  const u16 = (a: Uint16Array) => {
    for (let i = 0; i < a.length; i++) { out[o++] = a[i]! & 255; out[o++] = a[i]! >> 8; }
  };
  for (const fr of d.cels) for (const cel of fr) u16(cel);
  for (const m of sels) { out.set(m, o); o += n; }
  for (const k of stamps) u16(d.stamps[k]!.px);
  return out;
}

/** The document back from `serializeDoc`'s bytes. */
export function deserializeDoc(bytes: Uint8Array): Doc {
  const magic = 'PCLAWDOC 2\n';
  for (let i = 0; i < magic.length; i++) if (bytes[i] !== magic.charCodeAt(i)) throw new Error('not a PCLAWDOC 2 document');
  let nl = magic.length;
  while (nl < bytes.length && bytes[nl] !== 10) nl++;
  type Header = {
    kind: DocKind; name: string; width: number; height: number; cellW: number; cellH: number; wrap: boolean;
    palette: { name: string; entries: ([string, string, string] | [string, string, string, Role])[]; ramps: [string, string[]][]; locked: boolean };
    layers: ([string, boolean, boolean, boolean] | [string, boolean, boolean, boolean, string[]])[]; frameCount: number; home: [number, number]; notes: [string, number, number, number, number, string][];
    ctx: [string, number, number, boolean, [number | null, number | null] | null, [string, string | number] | null][];
    stamps: [string, number, number][]; macros: [string, string[], string][];
    anim?: {
      ticks: number[]; tags: [string, number, number, Loop][]; views: [string, number, number, string | null][];
      pivot: [number, number] | null; ground: number | null; links: [number, number, number][];
    };
    family?: { scheme: string; tile: number; inset: number; radius: number; fillet?: number; jitter?: [number, number]; bandOf?: string; bands: [number, number | 'outside' | 'inside'][]; detached: string[]; map: [number, number]; terrain: string; def?: SchemeJson };
    overlay?: OverlayState;
    footprint?: [number, number, [number, number], [number, number], string[]];
    variantOf?: string;
    densityOf?: [string, number];
    map?: { tile: number; entries: [string, string | null, number, number, [number, number]][] };
    marks?: [string, number, string, string, string][];
    iconMode?: IconMode;
    font?: [string, number, number, number, number, [number, number][]];
    underlays?: [number, string, number, number, number, number, number, number, string | null][];
  };
  const h = JSON.parse(utf8Decode(bytes.subarray(magic.length, nl))) as Header;
  let o = nl + 1;
  const n = h.width * h.height;
  const u16 = (len: number): Uint16Array => {
    const a = new Uint16Array(len);
    for (let i = 0; i < len; i++) { a[i] = bytes[o]! | (bytes[o + 1]! << 8); o += 2; }
    return a;
  };
  const cels = h.layers.map(() => Array.from({ length: h.frameCount }, () => u16(n)));
  for (const [l, f, g] of h.anim?.links ?? []) cels[l]![f] = cels[l]![g]!;
  const ctx: Record<string, AuthorCtx> = {};
  for (const [a, layer, frame, hasSel, mirror, brush] of h.ctx) {
    ctx[a] = {
      layer, frame, sel: null, mirror: mirror ? { x2: mirror[0], y2: mirror[1] } : null,
      brush: !brush ? null : brush[0] === 'stamp' ? { shape: 'stamp', stamp: String(brush[1]) } : { shape: brush[0] as 'square' | 'circle', size: Number(brush[1]) },
    };
    if (hasSel) { ctx[a]!.sel = bytes.slice(o, o + n); }
    if (hasSel) o += n;
  }
  const stamps: Record<string, Stamp> = {};
  for (const [s, w, sh] of h.stamps) stamps[s] = { w, h: sh, px: u16(w * sh) };
  const layers: Layer[] = h.layers.map(([name, hidden, locked, reference, m]) => (m ? { name, hidden, locked, reference, map: mapLayerFromJson(m) } : { name, hidden, locked, reference }));
  for (const [i, blob, iw, ih, x, y, w, uh, layout] of h.underlays ?? []) layers[i]!.underlay = { blob, iw, ih, x, y, w, h: uh, layout };
  return {
    kind: h.kind, name: h.name, width: h.width, height: h.height, cellW: h.cellW, cellH: h.cellH, wrap: h.wrap,
    palette: {
      name: h.palette.name, entries: h.palette.entries.map(([key, name, hex, role]) => (role ? { key, name, hex, role } : { key, name, hex })),
      ramps: Object.fromEntries(h.palette.ramps),
    },
    paletteLocked: h.palette.locked,
    layers,
    frameCount: h.frameCount, cels, ctx, home: { layer: h.home[0], frame: h.home[1] },
    notes: h.notes.map(([id, x, y, w, nh, text]) => ({ id, x, y, w, h: nh, text })),
    stamps, macros: Object.fromEntries(h.macros.map(([m, params, body]) => [m, { params, body }])),
    ticks: h.anim?.ticks ?? Array.from({ length: h.frameCount }, () => DEFAULT_TICKS),
    tags: (h.anim?.tags ?? []).map(([name, from, to, loop]) => ({ name, from, to, loop })),
    views: (h.anim?.views ?? []).map(([name, from, to, mirror]) => ({ name, from, to, mirror })),
    pivot: h.anim?.pivot ?? null, ground: h.anim?.ground ?? null,
    family: h.family ? {
      scheme: h.family.scheme, tile: h.family.tile, geometry: { inset: h.family.inset, radius: h.family.radius, bands: h.family.bands.map(([w, fill]) => ({ w, fill })), ...(h.family.fillet !== undefined ? { fillet: h.family.fillet } : {}), ...(h.family.jitter ? { jitter: { px: h.family.jitter[0], seed: h.family.jitter[1] } } : {}) },
      detached: h.family.detached, mapCols: h.family.map[0], mapRows: h.family.map[1], terrain: Uint8Array.from([...h.family.terrain].map(Number)),
      ...(h.family.def ? { def: h.family.def } : {}),
      ...(h.family.bandOf ? { bandOf: h.family.bandOf } : {}),
    } : null,
    overlay: h.overlay ?? null,
    footprint: h.footprint ? { cols: h.footprint[0], rows: h.footprint[1], at: h.footprint[2], anchor: h.footprint[3], flags: h.footprint[4] } : null,
    variantOf: h.variantOf ?? null,
    densityOf: h.densityOf ? { of: h.densityOf[0], d: h.densityOf[1] } : null,
    map: h.map ? { tile: h.map.tile, entries: h.map.entries.map(([name, variant, cols, rows, anchor]) => ({ name, variant, cols, rows, anchor })) } : null,
    marks: (h.marks ?? []).map(([name, seq, by, text, art]) => ({ name, seq, by, text, art })),
    iconMode: h.iconMode ?? null,
    font: h.font ? {
      chars: h.font[0] ? h.font[0].split(',').map(Number) : [], cols: h.font[1], baseline: h.font[2], line: h.font[3], spacing: h.font[4],
      advances: Object.fromEntries(h.font[5]),
    } : null,
  };
}

function mapLayerJson(m: MapLayerInfo): string[] {
  switch (m.kind) {
    case 'terrain': return ['terrain', m.family, m.outside ? 'outside' : '', ...(m.walkable ? ['walkable'] : [])];
    case 'overlay': return ['overlay', m.overlay, m.on];
    default: return [m.kind];
  }
}

function mapLayerFromJson(a: string[]): MapLayerInfo {
  if (a[0] === 'terrain') return { kind: 'terrain', family: a[1]!, outside: a[2] === 'outside', ...(a[3] === 'walkable' ? { walkable: true } : {}) };
  if (a[0] === 'overlay') return { kind: 'overlay', overlay: a[1]!, on: a[2]! };
  return { kind: a[0] as 'tiles' | 'objects' };
}

/**
 * The state bytes of language versions G1-G3 (PCLAWDOC 1), for documents that use none of the
 * later state: `verify` accepts an asset.json hash made this way until the asset is saved again.
 * Returns null when the document has state that format could not hold.
 */
export function serializeDocV1(d: Doc): Uint8Array | null {
  const authors = Object.keys(d.ctx);
  if (hasAnim(d) || d.marks.length || d.iconMode || d.font || d.family || d.overlay || d.footprint || d.variantOf || d.densityOf || d.map || d.paletteLocked || d.home.layer || d.home.frame || d.frameCount !== 1 || d.layers.length !== 1 || Object.keys(d.stamps).length || Object.keys(d.macros).length) return null;
  const l = d.layers[0]!;
  if (l.hidden || l.locked || l.reference) return null;
  if (authors.length > 1 || authors.some((a) => d.ctx[a]!.mirror || d.ctx[a]!.brush || d.ctx[a]!.layer || d.ctx[a]!.frame)) return null;
  const sel = authors.length ? d.ctx[authors[0]!]!.sel : null;
  const header = JSON.stringify({
    kind: d.kind, name: d.name, width: d.width, height: d.height, cellW: d.cellW, cellH: d.cellH, wrap: d.wrap,
    palette: { name: d.palette.name, entries: d.palette.entries.map((e) => [e.key, e.name, e.hex]) },
    layers: d.layers.map((x) => x.name), frameCount: d.frameCount, active: [0, 0],
    ...(d.notes.length ? { notes: d.notes.map((m) => [m.id, m.x, m.y, m.w, m.h, m.text]) } : {}),
    ...(sel ? { sel: true } : {}),
  });
  const head = utf8('PCLAWDOC 1\n' + header + '\n');
  const n = d.width * d.height;
  const out = new Uint8Array(head.length + n * 2 + (sel ? n : 0));
  out.set(head, 0);
  let o = head.length;
  const cel = d.cels[0]![0]!;
  for (let i = 0; i < n; i++) { out[o++] = cel[i]! & 255; out[o++] = cel[i]! >> 8; }
  if (sel) out.set(sel, o);
  return out;
}

/**
 * A hash of what the document looks like: its size, frames and ticks, every frame's flat art and,
 * for a map, what stands on it. Notes, marks, selections and hidden or reference layers leave it
 * alone, so a mark goes stale only when the art changes. 64 bits as hex (two FNV-1a passes).
 */
export function artHash(d: Doc): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  const mix = (v: number) => {
    a = Math.imul(a ^ (v & 0xffff), 0x01000193) >>> 0;
    b = Math.imul(b ^ ((v * 31 + 7) & 0xffff), 0x5bd1e995) >>> 0;
    b = (b ^ (b >>> 15)) >>> 0;
  };
  for (const v of [d.width, d.height, d.frameCount, ...d.ticks]) mix(v);
  for (let f = 0; f < d.frameCount; f++) for (const v of flatten(d, f)) mix(v);
  if (d.map) {
    for (const ch of JSON.stringify([d.map.entries, d.layers.map((l) => l.map ?? null)])) mix(ch.charCodeAt(0));
    for (const fr of d.cels) for (const cel of fr) for (const v of cel) mix(v);
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
