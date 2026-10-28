// The indexed document: a canvas of palette indices (or transparent), a cell grid, a wrap flag.
// G1 has one layer and one frame, but the shape (layers x frames of cels) is the one later steps
// fill in.

import type { Palette } from './palette.ts';

/** The pixel value for "no colour". Palette entry i is stored as i. */
export const TRANSPARENT = 0xffff;

export type DocKind = 'tile' | 'sprite' | 'sheet' | 'icon';
export const DOC_KINDS: readonly DocKind[] = ['tile', 'sprite', 'sheet', 'icon'];

export interface Layer {
  name: string;
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

export interface Doc {
  kind: DocKind;
  name: string;
  width: number;
  height: number;
  cellW: number;
  cellH: number;
  wrap: boolean;
  palette: Palette;
  layers: Layer[];
  frameCount: number;
  /** cels[layer][frame]: width*height palette indices, row-major. */
  cels: Uint16Array[][];
  /** The cel drawing commands target. */
  active: { layer: number; frame: number };
  /** Open notes, in the order they were written. */
  notes: Note[];
  /** The selection mask (1 = selected), width*height, or null when nothing is selected. */
  sel: Uint8Array | null;
}

export function createDoc(o: {
  kind: DocKind; name: string; width: number; height: number; cellW: number; cellH: number;
  wrap: boolean; palette: Palette; bg: number;
}): Doc {
  const pixels = new Uint16Array(o.width * o.height).fill(o.bg);
  return {
    kind: o.kind, name: o.name, width: o.width, height: o.height, cellW: o.cellW, cellH: o.cellH,
    wrap: o.wrap, palette: o.palette, layers: [{ name: 'main' }], frameCount: 1, cels: [[pixels]],
    active: { layer: 0, frame: 0 }, notes: [], sel: null,
  };
}

export function cloneDoc(d: Doc): Doc {
  return {
    ...d, layers: d.layers.map((l) => ({ ...l })), cels: d.cels.map((fr) => fr.map((c) => c.slice())), active: { ...d.active },
    notes: d.notes.map((n) => ({ ...n })), sel: d.sel ? d.sel.slice() : null,
  };
}

/** The active cel's pixels. */
export function activeCel(d: Doc): Uint16Array {
  return d.cels[d.active.layer]![d.active.frame]!;
}

/** The flattened image of a frame: top layer first, first non-transparent pixel wins. */
export function flatten(d: Doc, frame = 0): Uint16Array {
  const out = new Uint16Array(d.width * d.height).fill(TRANSPARENT);
  for (let l = d.layers.length - 1; l >= 0; l--) {
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

/**
 * Canonical bytes for a document: a magic line, a JSON header with fixed key order, then every cel
 * as little-endian u16. Two documents are the same iff these bytes are. This is also the body of a
 * checkpoint file (checkpoints/NNNNNN.gwc; written from a later step). Open notes and a selection
 * are written only when there are any, so documents without them keep the bytes they had in G1;
 * the selection mask follows the cels, one byte per pixel.
 */
export function serializeDoc(d: Doc): Uint8Array {
  const header = JSON.stringify({
    kind: d.kind, name: d.name, width: d.width, height: d.height, cellW: d.cellW, cellH: d.cellH, wrap: d.wrap,
    palette: { name: d.palette.name, entries: d.palette.entries.map((e) => [e.key, e.name, e.hex]) },
    layers: d.layers.map((l) => l.name), frameCount: d.frameCount, active: [d.active.layer, d.active.frame],
    ...(d.notes.length ? { notes: d.notes.map((m) => [m.id, m.x, m.y, m.w, m.h, m.text]) } : {}),
    ...(d.sel ? { sel: true } : {}),
  });
  const head = utf8('PCLAWDOC 1\n' + header + '\n');
  const n = d.width * d.height;
  const out = new Uint8Array(head.length + d.layers.length * d.frameCount * n * 2 + (d.sel ? n : 0));
  out.set(head, 0);
  let o = head.length;
  for (const fr of d.cels) for (const cel of fr) for (let i = 0; i < n; i++) {
    out[o++] = cel[i]! & 255;
    out[o++] = cel[i]! >> 8;
  }
  if (d.sel) out.set(d.sel, o);
  return out;
}
