// The indexed document: layers x frames of cels (palette indices or transparent), a cell grid, a
// wrap flag, the document's own palette (lockable), open notes, stamps, macros, and each author's
// editing context (the layer and frame they draw on, their selection, symmetry and brush).

import type { Palette } from './palette.ts';

/** The pixel value for "no colour". Palette entry i is stored as i. */
export const TRANSPARENT = 0xffff;

export type DocKind = 'tile' | 'sprite' | 'sheet' | 'icon';
export const DOC_KINDS: readonly DocKind[] = ['tile', 'sprite', 'sheet', 'icon'];

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
  /** Editing contexts by author. Authors without one use the default (layer 0, frame 0, nothing else). */
  ctx: Record<string, AuthorCtx>;
  /** Open notes, in the order they were written. */
  notes: Note[];
  stamps: Record<string, Stamp>;
  macros: Record<string, Macro>;
}

export function newLayer(name: string, o: Partial<Layer> = {}): Layer {
  return { name, hidden: false, locked: false, reference: false, ...o };
}

export function createDoc(o: {
  kind: DocKind; name: string; width: number; height: number; cellW: number; cellH: number;
  wrap: boolean; palette: Palette; bg: number;
}): Doc {
  const pixels = new Uint16Array(o.width * o.height).fill(o.bg);
  return {
    kind: o.kind, name: o.name, width: o.width, height: o.height, cellW: o.cellW, cellH: o.cellH,
    wrap: o.wrap, palette: o.palette, paletteLocked: false, layers: [newLayer('main')], frameCount: 1, cels: [[pixels]],
    ctx: {}, notes: [], stamps: {}, macros: {},
  };
}

function cloneCtx(c: AuthorCtx): AuthorCtx {
  return { ...c, sel: c.sel ? c.sel.slice() : null, mirror: c.mirror ? { ...c.mirror } : null, brush: c.brush ? { ...c.brush } : null };
}

export function cloneDoc(d: Doc): Doc {
  return {
    ...d, layers: d.layers.map((l) => ({ ...l })), cels: d.cels.map((fr) => fr.map((c) => c.slice())),
    ctx: Object.fromEntries(Object.entries(d.ctx).map(([k, v]) => [k, cloneCtx(v)])),
    notes: d.notes.map((n) => ({ ...n })),
    stamps: Object.fromEntries(Object.entries(d.stamps).map(([k, s]) => [k, { ...s, px: s.px.slice() }])),
    macros: Object.fromEntries(Object.entries(d.macros).map(([k, m]) => [k, { params: [...m.params], body: m.body }])),
  };
}

const DEFAULT_CTX: AuthorCtx = { layer: 0, frame: 0, sel: null, mirror: null, brush: null };

/** An author's editing context (read-only: the default when they have none). */
export function ctxOf(d: Doc, by: string): AuthorCtx {
  return d.ctx[by] ?? DEFAULT_CTX;
}

/** Change an author's context; a context back at the default is dropped, so it adds nothing to the state. */
export function setCtx(d: Doc, by: string, change: Partial<AuthorCtx>): void {
  const c = { ...ctxOf(d, by), ...change };
  if (c.layer === 0 && c.frame === 0 && !c.sel && !c.mirror && !c.brush) delete d.ctx[by];
  else d.ctx[by] = c;
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

function utf8Decode(b: Uint8Array): string {
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
      name: d.palette.name, entries: d.palette.entries.map((e) => [e.key, e.name, e.hex]),
      ramps: sortedKeys(d.palette.ramps).map((k) => [k, d.palette.ramps[k]]), locked: d.paletteLocked,
    },
    layers: d.layers.map((l) => [l.name, l.hidden, l.locked, l.reference]), frameCount: d.frameCount,
    notes: d.notes.map((m) => [m.id, m.x, m.y, m.w, m.h, m.text]),
    ctx: authors.map((a) => {
      const c = d.ctx[a]!;
      const brush = !c.brush ? null : c.brush.shape === 'stamp' ? ['stamp', c.brush.stamp] : [c.brush.shape, c.brush.size];
      return [a, c.layer, c.frame, !!c.sel, c.mirror ? [c.mirror.x2, c.mirror.y2] : null, brush];
    }),
    stamps: stamps.map((s) => [s, d.stamps[s]!.w, d.stamps[s]!.h]),
    macros: macros.map((m) => [m, d.macros[m]!.params, d.macros[m]!.body]),
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
    palette: { name: string; entries: [string, string, string][]; ramps: [string, string[]][]; locked: boolean };
    layers: [string, boolean, boolean, boolean][]; frameCount: number; notes: [string, number, number, number, number, string][];
    ctx: [string, number, number, boolean, [number | null, number | null] | null, [string, string | number] | null][];
    stamps: [string, number, number][]; macros: [string, string[], string][];
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
  return {
    kind: h.kind, name: h.name, width: h.width, height: h.height, cellW: h.cellW, cellH: h.cellH, wrap: h.wrap,
    palette: {
      name: h.palette.name, entries: h.palette.entries.map(([key, name, hex]) => ({ key, name, hex })),
      ramps: Object.fromEntries(h.palette.ramps),
    },
    paletteLocked: h.palette.locked,
    layers: h.layers.map(([name, hidden, locked, reference]) => ({ name, hidden, locked, reference })),
    frameCount: h.frameCount, cels, ctx,
    notes: h.notes.map(([id, x, y, w, nh, text]) => ({ id, x, y, w, h: nh, text })),
    stamps, macros: Object.fromEntries(h.macros.map(([m, params, body]) => [m, { params, body }])),
  };
}

/**
 * The state bytes of language versions G1-G3 (PCLAWDOC 1), for documents that use none of the
 * later state: `verify` accepts an asset.json hash made this way until the asset is saved again.
 * Returns null when the document has state that format could not hold.
 */
export function serializeDocV1(d: Doc): Uint8Array | null {
  const authors = Object.keys(d.ctx);
  if (d.paletteLocked || d.frameCount !== 1 || d.layers.length !== 1 || Object.keys(d.stamps).length || Object.keys(d.macros).length) return null;
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
