// Map commands (plan §4.11) and oversized assets' footprints (§4.10). On a map document:
// `terrain` paints a terrain layer (the family's scheme picks every edge variant when the map is
// drawn), `place`, `move` and `remove` put tiles and multi-cell objects by name with footprint
// collision, `road` lays a path terrain along a route, `scatter` places objects at random, and
// `map gen` lays out an island, a village or a dungeon. Footprints are written into the lines that
// place things, so a map's tape never reads another asset. On any asset: `footprint` (cells,
// anchor, blocking and roof flags) and `variant of=<base>` (a texture variant, §4.1).

import { COMMANDS, Args, fn, needDoc, pt, ptText, registerCommand, type CommandSpec, type NormaliseContext } from './commands.ts';
import { TRANSPARENT, ctxOf, type Doc, type Footprint, type MapEntry } from './doc.ts';
import { artGrid, entryBox, footprintOf, occupancy } from './map.ts';
import { DiagError, type ParsedCommand, type Token } from './parser.ts';
import { Pcg32 } from './pcg.ts';
import { parseMix, spreadMix, type MixItem } from './mix.ts';
import { ellipsePixels, fill, freehand, rectPixels, type Pt } from './raster.ts';

type Kv = Extract<Token, { t: 'kv' }>;

function mapOf(cmd: ParsedCommand, ctx: NormaliseContext): Doc {
  const doc = needDoc(cmd, ctx);
  if (!doc.map) throw new DiagError(cmd.line, cmd.col, `${cmd.name}: '${doc.name}' is not a map (new map <name> <C>x<R> tile=<T>)`);
  return doc;
}

function layerNamed(doc: Doc, tok: { v: string; line: number; col: number }, kinds: string[]): number {
  const i = doc.layers.findIndex((l) => l.name === tok.v);
  const fit = doc.layers.filter((l) => l.map && kinds.includes(l.map.kind)).map((l) => l.name);
  if (i < 0 || !kinds.includes(doc.layers[i]!.map?.kind ?? '')) {
    throw new DiagError(tok.line, tok.col, `no ${kinds.join(' or ')} layer '${tok.v}' (${fit.length ? fit.join(', ') : `none yet: layer add <name> ${kinds[0] === 'terrain' ? 'terrain=<family>' : kinds[0]}`})`);
  }
  if (doc.layers[i]!.locked) throw new DiagError(tok.line, tok.col, `layer '${tok.v}' is locked`);
  return i;
}

/** The tiles or objects layer a command places on: layer=, else the author's own layer. */
function placeLayer(a: Args, doc: Doc, by: string): number {
  const o = a.opts.get('layer');
  if (o) return layerNamed(doc, { v: o.value, line: o.line, col: o.vcol }, ['tiles', 'objects']);
  const i = ctxOf(doc, by).layer;
  const l = doc.layers[i]!;
  if (l.map?.kind !== 'tiles' && l.map?.kind !== 'objects') {
    throw new DiagError(a.cmd.line, a.cmd.col, `${a.cmd.name}: your layer '${l.name}' is not a tiles or objects layer (give layer=<name>)`);
  }
  if (l.locked) throw new DiagError(a.cmd.line, a.cmd.col, `layer '${l.name}' is locked`);
  return i;
}

function intOf(o: Kv, lo: number, hi: number): number {
  if (!/^-?\d+$/.test(o.value) || Number(o.value) < lo || Number(o.value) > hi) throw new DiagError(o.line, o.vcol, `${o.key}= must be a whole number ${lo}..${hi}`);
  return Number(o.value);
}

const seedOf = (a: Args, ctx: NormaliseContext): number => {
  const o = a.opts.get('seed');
  return o ? intOf(o, 1, 0x7fffffff) : ctx.newSeed();
};

const inMap = (d: Doc, x: number, y: number) => x >= 0 && y >= 0 && x < d.width && y < d.height;

// --- terrain

const TERRAIN_HOW = ['rect', 'ellipse', 'brush', 'fill', 'paint', 'clear'];

const terrainCmd: CommandSpec = {
  name: 'terrain',
  summary: 'terrain <layer> rect <x,y> <W>x<H> | ellipse <x,y> <W>x<H> | brush <x,y>... [size=<n>] | fill <x,y> | paint <x,y> << rows of # and . >> | clear   [erase]   (paints a terrain layer; the family\'s scheme picks the edge tiles)',
  normalise(cmd, ctx) {
    const doc = mapOf(cmd, ctx);
    const a = new Args(cmd, ['size'], ['erase']);
    const lt = a.take('word', 'a terrain layer');
    const li = layerNamed(doc, lt, ['terrain']);
    const how = a.take('word', TERRAIN_HOW.join(', '));
    if (!TERRAIN_HOW.includes(how.v)) throw new DiagError(how.line, how.col, `terrain: expected ${TERRAIN_HOW.join(', ')}`);
    const erase = a.flags.length > 0;
    const v = erase ? TRANSPARENT : 1;
    const so = a.opts.get('size');
    if (so && how.v !== 'brush') throw new DiagError(so.line, so.col, `size= goes with brush`);
    const tail = erase ? ' erase' : '';
    let pts: Pt[] = [];
    let text: string;
    if (how.v === 'rect' || how.v === 'ellipse') {
      const p = a.take('point', 'a corner x,y');
      const s = a.take('size', 'a size WxH');
      a.done();
      if (s.w < 1 || s.h < 1) throw new DiagError(s.line, s.col, `terrain: size must be at least 1x1`);
      pts = how.v === 'rect' ? rectPixels(p.x, p.y, s.w, s.h, true) : ellipsePixels(p.x, p.y, p.x + s.w - 1, p.y + s.h - 1, true);
      text = `${how.v} ${p.x},${p.y} ${s.w}x${s.h}`;
    } else if (how.v === 'brush') {
      const list: Pt[] = [];
      for (const t of a.rest()) {
        if (t.t !== 'point') throw new DiagError(t.line, t.col, `terrain brush: expected a point x,y`);
        list.push(pt(t));
      }
      if (!list.length) throw new DiagError(how.line, how.col + 6, `terrain brush: expected a point x,y`);
      const size = so ? intOf(so, 1, 32) : 1;
      const lo = -Math.floor((size - 1) / 2);
      for (const [x, y] of freehand(list, false)) for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) pts.push([x + lo + i, y + lo + j]);
      text = `brush ${list.map(ptText).join(' ')} size=${size}`;
    } else if (how.v === 'fill') {
      const p = a.take('point', 'a start x,y');
      a.done();
      if (!inMap(doc, p.x, p.y)) throw new DiagError(p.line, p.col, `terrain fill: ${p.x},${p.y} is off the ${doc.width}x${doc.height} map`);
      text = `fill ${p.x},${p.y}`;
      return {
        text: `terrain ${lt.v} ${text}${tail}`,
        op: fn((d) => fill({ width: d.width, height: d.height, wrap: false, pixels: d.cels[li]![0]! }, p.x, p.y, v, false, 4)),
      };
    } else if (how.v === 'paint') {
      const p = a.take('point', 'a top-left x,y');
      const block = a.take('block', `a block of rows: '#' terrain, '-' not, '.' leave`);
      a.done();
      if (erase) throw new DiagError(a.flags[0]!.line, a.flags[0]!.col, `terrain paint: the rows say what is terrain ('#') and what is not ('-')`);
      const set: [number, number, number][] = [];
      block.rows.forEach((r, j) => [...r.text].forEach((ch, i) => {
        if (ch === '#') set.push([p.x + i, p.y + j, 1]);
        else if (ch === '-') set.push([p.x + i, p.y + j, TRANSPARENT]);
        else if (ch !== '.') throw new DiagError(r.line, r.col + i, `terrain paint: '${ch}' is not '#' (terrain), '-' (not) or '.' (leave)`);
      }));
      return {
        text: `terrain ${lt.v} paint ${p.x},${p.y} <<\n${block.rows.map((r) => `  ${r.text}\n`).join('')}>>`,
        op: fn((d) => {
          const cel = d.cels[li]![0]!;
          for (const [x, y, c] of set) if (inMap(d, x, y)) cel[y * d.width + x] = c;
        }),
      };
    } else {
      a.done();
      if (erase) throw new DiagError(a.flags[0]!.line, a.flags[0]!.col, `terrain clear takes no erase`);
      return { text: `terrain ${lt.v} clear`, op: fn((d) => { d.cels[li]![0]!.fill(TRANSPARENT); }) };
    }
    return {
      text: `terrain ${lt.v} ${text}${tail}`,
      op: fn((d) => {
        const cel = d.cels[li]![0]!;
        for (const [x, y] of pts) if (inMap(d, x, y)) cel[y * d.width + x] = v;
      }),
    };
  },
};

// --- place, move, remove

/** A name and an optional family variant: `house`, `shore.ns`. */
function thingName(tok: Token): { name: string; variant: string | null } {
  if (tok.t !== 'word') throw new DiagError(tok.line, tok.col, `expected an asset name (or <family>.<variant>)`);
  const m = /^([a-z][a-z0-9_-]*)(?:\.([a-z][a-z0-9_]*))?$/.exec(tok.v);
  if (!m) throw new DiagError(tok.line, tok.col, `'${tok.v}' is not an asset name (or <family>.<variant>)`);
  return { name: m[1]!, variant: m[2] ?? null };
}

/** The footprint a thing is placed with: from the line (cells=, anchor=), else read from the asset as it is now. */
function footprintFor(a: Args, ctx: NormaliseContext, name: string, variant: string | null, at: { line: number; col: number }, layerKind: string): { cols: number; rows: number; anchor: [number, number] } {
  const co = a.opts.get('cells');
  const ao = a.opts.get('anchor');
  if (co || ao) {
    if (!co || !ao) throw new DiagError((co ?? ao)!.line, (co ?? ao)!.col, `give cells= and anchor= together (or neither: they are read from the asset)`);
    const m = /^(\d+)x(\d+)$/.exec(co.value);
    if (!m || Number(m[1]) < 1 || Number(m[2]) < 1 || Number(m[1]) > 64 || Number(m[2]) > 64) throw new DiagError(co.line, co.vcol, `cells= must be a footprint like 2x2`);
    const n = /^(\d+),(\d+)$/.exec(ao.value);
    const cols = Number(m[1]), rows = Number(m[2]);
    if (!n || Number(n[1]) >= cols || Number(n[2]) >= rows) throw new DiagError(ao.line, ao.vcol, `anchor= must be a cell of the ${cols}x${rows} footprint, like 0,${rows - 1}`);
    return { cols, rows, anchor: [Number(n[1]), Number(n[2])] };
  }
  const src = ctx.asset?.(name);
  if (!src) throw new DiagError(at.line, at.col, `no asset '${name}' to place`);
  if (variant !== null) {
    if (!src.family) throw new DiagError(at.line, at.col, `'${name}' is not a family, so it has no variant '${variant}'`);
    return { cols: 1, rows: 1, anchor: [0, 0] };
  }
  if (src.family || src.overlay || src.map) throw new DiagError(at.line, at.col, `'${name}' is a ${src.kind}: ${src.family ? 'paint it as a terrain layer (layer add <name> terrain=' + name + '), or place one of its variants by name (' + name + '.<variant>)' : src.overlay ? 'add it as an overlay layer' : 'maps do not nest'}`);
  if (layerKind === 'tiles' && (src.width % src.cellW || src.height % src.cellH)) throw new DiagError(at.line, at.col, `'${name}' is ${src.width}x${src.height}, not whole cells of ${src.cellW}x${src.cellH}`);
  const fp = footprintOf(src);
  return { cols: fp.cols, rows: fp.rows, anchor: fp.anchor };
}

function entryText(e: { cols: number; rows: number; anchor: [number, number] }): string {
  return `cells=${e.cols}x${e.rows} anchor=${e.anchor[0]},${e.anchor[1]}`;
}

/** The entry's index in the map's table, adding it when new. */
function entryIndex(d: Doc, e: MapEntry): number {
  const m = d.map!;
  let i = m.entries.findIndex((x) => x.name === e.name && x.variant === e.variant && x.cols === e.cols && x.rows === e.rows && x.anchor[0] === e.anchor[0] && x.anchor[1] === e.anchor[1] && !x.exact === !e.exact);
  if (i < 0) { m.entries.push({ ...e, anchor: [e.anchor[0], e.anchor[1]] }); i = m.entries.length - 1; }
  return i;
}

/** Refuse a footprint that leaves the map or overlaps another (`skip`: the placement being moved). */
function checkFree(doc: Doc, li: number, e: { cols: number; rows: number; anchor: [number, number] }, x: number, y: number, at: { line: number; col: number }, skip?: { x: number; y: number; layer: number }): void {
  const b = entryBox({ name: '', variant: null, ...e }, x, y);
  if (b.x < 0 || b.y < 0 || b.x + b.w > doc.width || b.y + b.h > doc.height) {
    throw new DiagError(at.line, at.col, `the ${e.cols}x${e.rows} footprint at ${b.x},${b.y} runs off the ${doc.width}x${doc.height} map`);
  }
  const { grid, placed } = occupancy(doc, li);
  for (let yy = b.y; yy < b.y + b.h; yy++) for (let xx = b.x; xx < b.x + b.w; xx++) {
    const k = grid[yy * doc.width + xx]!;
    if (k < 0) continue;
    const p = placed[k]!;
    if (skip && p.x === skip.x && p.y === skip.y && p.layer === skip.layer) continue;
    const o = doc.map!.entries[p.entry]!;
    throw new DiagError(at.line, at.col, `${xx},${yy} is taken by ${o.name}${o.variant ? `.${o.variant}` : ''} at ${p.x},${p.y} (on layer ${doc.layers[p.layer]!.name})`);
  }
}

const placeCmd: CommandSpec = {
  name: 'place',
  summary: 'place <asset>|<family>.<variant> <x,y> [layer=<tiles or objects layer>] [cells=<C>x<R> anchor=<x,y>]   (by its anchor cell; footprints may not overlap)',
  normalise(cmd, ctx) {
    const doc = mapOf(cmd, ctx);
    const a = new Args(cmd, ['layer', 'cells', 'anchor']);
    const what = a.take('word', 'an asset name');
    const thing = thingName(what);
    const p = a.take('point', 'the cell x,y for its anchor');
    a.done();
    const li = placeLayer(a, doc, ctx.by);
    const kind = doc.layers[li]!.map!.kind;
    if (thing.variant && kind !== 'tiles') throw new DiagError(what.line, what.col, `a family's variant goes on a tiles layer`);
    const fp = footprintFor(a, ctx, thing.name, thing.variant, what, kind);
    checkFree(doc, li, fp, p.x, p.y, p);
    const e: MapEntry = { name: thing.name, variant: thing.variant, ...fp };
    return {
      text: `place ${what.v} ${p.x},${p.y} layer=${doc.layers[li]!.name} ${entryText(fp)}`,
      op: fn((d) => { d.cels[li]![0]![p.y * d.width + p.x] = entryIndex(d, e); }),
    };
  },
};

/** The placement under a cell on a layer (layer= or the author's), or an error. */
function takePlaced(a: Args, doc: Doc, by: string, p: Extract<Token, { t: 'point' }>): { li: number; x: number; y: number; entry: MapEntry } {
  const lo = a.opts.get('layer');
  const layers = lo ? [placeLayer(a, doc, by)] : doc.layers.map((_, i) => i).filter((i) => doc.layers[i]!.map?.kind === 'objects' || doc.layers[i]!.map?.kind === 'tiles').reverse();
  for (const li of layers) {
    const { grid, placed } = occupancy(doc, li);
    const k = inMap(doc, p.x, p.y) ? grid[p.y * doc.width + p.x]! : -1;
    if (k < 0) continue;
    const q = placed[k]!;
    if (q.layer !== li && lo) continue;
    if (doc.layers[q.layer]!.locked) throw new DiagError(p.line, p.col, `layer '${doc.layers[q.layer]!.name}' is locked`);
    return { li: q.layer, x: q.x, y: q.y, entry: doc.map!.entries[q.entry]! };
  }
  throw new DiagError(p.line, p.col, `nothing is placed at ${p.x},${p.y}${lo ? ` on layer ${lo.value}` : ''}`);
}

const moveCmd: CommandSpec = {
  name: 'move',
  summary: 'move <x,y> <x,y> [layer=<layer>]   (moves what is placed at the first cell so its anchor is at the second)',
  normalise(cmd, ctx) {
    const doc = mapOf(cmd, ctx);
    const a = new Args(cmd, ['layer']);
    const from = a.take('point', 'a cell x,y with something placed on it');
    const to = a.take('point', 'the cell x,y for its anchor');
    a.done();
    const got = takePlaced(a, doc, ctx.by, from);
    checkFree(doc, got.li, got.entry, to.x, to.y, to, { x: got.x, y: got.y, layer: got.li });
    return {
      text: `move ${got.x},${got.y} ${to.x},${to.y} layer=${doc.layers[got.li]!.name}`,
      op: fn((d) => {
        const cel = d.cels[got.li]![0]!;
        const v = cel[got.y * d.width + got.x]!;
        cel[got.y * d.width + got.x] = TRANSPARENT;
        cel[to.y * d.width + to.x] = v;
      }),
    };
  },
};

const removeCmd: CommandSpec = {
  name: 'remove',
  summary: 'remove <x,y> [layer=<layer>]   (takes away what is placed on that cell)',
  normalise(cmd, ctx) {
    const doc = mapOf(cmd, ctx);
    const a = new Args(cmd, ['layer']);
    const at = a.take('point', 'a cell x,y with something placed on it');
    a.done();
    const got = takePlaced(a, doc, ctx.by, at);
    return {
      text: `remove ${got.x},${got.y} layer=${doc.layers[got.li]!.name}`,
      op: fn((d) => { d.cels[got.li]![0]![got.y * d.width + got.x] = TRANSPARENT; }),
    };
  },
};

function unlockBand(d: Doc): void {
  const bl = d.layers.find((l) => l.name === 'band');
  if (bl) bl.locked = false;
}

// --- tiles fill

/**
 * A seeded scatter of a mix over cells (in row order): each cell draws a tile, leaving out the tile
 * of the cell to its left and the one above where another tile is left to draw. Draws are weighted
 * by what each tile still has to lay of its share (weight × cells), so the counts follow the weights
 * as closely as the neighbour rule allows (a tile over half the mix cannot have no equal neighbours).
 * Two tiles (G15): that rule leaves no choice at all, a strict checkerboard, which reads as a
 * pattern of its own (and banning only an L of three alike still locks rows into alternation); a
 * cell then leaves out only the tile that would complete a 2x2 block of one tile.
 */
export function scatterMix(items: MixItem[], cells: number[], width: number, seed: number, named: (i: number) => string | null): string[] {
  const rng = new Pcg32(seed, 0x6d6978);
  const got = new Map<number, string>();
  const at = (i: number) => got.get(i) ?? named(i);
  const W = items.reduce((s, o) => s + o.weight, 0);
  const used = new Map(items.map((o) => [o.name, 0]));
  // What a tile still has to lay, in units of 1/W cell: weight × cells − laid × W.
  const left = (o: MixItem) => Math.max(0, o.weight * cells.length - used.get(o.name)! * W);
  const draw = (from: MixItem[], w: (o: MixItem) => number): MixItem | null => {
    const total = from.reduce((s, o) => s + w(o), 0);
    if (!total) return null;
    let r = rng.nextInt(total);
    for (const o of from) { if (r < w(o)) return o; r -= w(o); }
    return null;
  };
  return cells.map((i) => {
    const x = i % width;
    const toLeft = x > 0 ? at(i - 1) : null, above = at(i - width), corner = x > 0 ? at(i - width - 1) : null;
    const two = items.length === 2 ? (toLeft && toLeft === above && toLeft === corner ? [toLeft] : []) : [toLeft, above];
    const avoid = new Set(two.filter((v): v is string => !!v));
    const open = items.filter((o) => !avoid.has(o.name));
    const from = open.length ? open : items;
    const o = draw(from, left) ?? draw(from, (q) => q.weight)!;
    got.set(i, o.name);
    used.set(o.name, used.get(o.name)! + 1);
    return o.name;
  });
}

const tilesCmd: CommandSpec = {
  name: 'tiles',
  summary: 'tiles <tiles layer> fill <asset>|<family>.<variant>|mix=<tile>:<weight>,... [<x,y> <W>x<H>] [replace] [variants=spread|named] [seed=]   (lays a one-cell tile on every empty cell of the layer, or of the box; replace also covers one-cell tiles already there; the map picks among the tile\'s texture variants. mix=: a seeded scatter of several tiles by weight, no two equal neighbours where it can help it; each tile\'s weight is shared with its texture variants the mix does not name, unless variants=named; each cell shows the tile drawn for it)',
  normalise(cmd, ctx) {
    const doc = mapOf(cmd, ctx);
    const a = new Args(cmd, ['cells', 'anchor', 'mix', 'seed', 'variants'], ['replace']);
    const lt = a.take('word', 'a tiles layer');
    const li = layerNamed(doc, lt, ['tiles']);
    const how = a.take('word', 'fill');
    if (how.v !== 'fill') throw new DiagError(how.line, how.col, `tiles: expected fill`);
    const mixOpt = a.opts.get('mix');
    const what = mixOpt ? null : a.take('word', 'an asset name (or mix=<tile>:<weight>,...)');
    const thing = what ? thingName(what) : null;
    let box = { x: 0, y: 0, w: doc.width, h: doc.height };
    if (a.peek()?.t === 'point') {
      const p = a.take('point', 'a corner x,y');
      const sz = a.take('size', 'a size WxH');
      if (sz.w < 1 || sz.h < 1) throw new DiagError(sz.line, sz.col, `tiles fill: the box must be at least 1x1`);
      box = { x: p.x, y: p.y, w: sz.w, h: sz.h };
    }
    a.done();
    const replace = a.flags.some((f) => f.v === 'replace');
    for (const k of ['seed', 'variants']) if (!mixOpt && a.opts.get(k)) throw new DiagError(a.opts.get(k)!.line, a.opts.get(k)!.col, `${k}= goes with mix=`);
    const vo = a.opts.get('variants');
    if (vo && vo.value !== 'spread' && vo.value !== 'named') throw new DiagError(vo.line, vo.vcol, `variants= is spread (a tile's weight shared with its texture variants) or named (only the tiles the mix names)`);
    // The tiles: one, or the mix (each a one-cell tile, drawn exactly as named).
    const items = mixOpt ? parseMix(mixOpt) : null;
    const mix = items ? (vo?.value === 'named' ? items : spreadMix(items, ctx)) : null;
    const fp = footprintFor(a, ctx, mix ? mix[0]!.name : thing!.name, thing?.variant ?? null, (what ?? mixOpt)!, 'tiles');
    if (mix && !a.opts.get('cells')) {
      for (const m of mix) {
        const f = footprintFor(a, ctx, m.name, null, mixOpt!, 'tiles');
        const src = ctx.asset?.(m.name);
        if (f.cols !== 1 || f.rows !== 1 || (src && src.kind !== 'tile')) throw new DiagError(mixOpt!.line, mixOpt!.vcol, `mix= takes one-cell tiles; '${m.name}' is ${src && src.kind !== 'tile' ? `a ${src.kind}` : `${f.cols}x${f.rows} cells`}`);
      }
    }
    if (fp.cols !== 1 || fp.rows !== 1) throw new DiagError(what!.line, what!.col, `tiles fill lays one-cell tiles; '${thing!.name}' is ${fp.cols}x${fp.rows} cells (place it instead)`);
    // The cells to fill, worked out now so the line replays without the asset.
    const { grid, placed } = occupancy(doc, li);
    const cells: number[] = [];
    for (let y = Math.max(0, box.y); y < Math.min(doc.height, box.y + box.h); y++) for (let x = Math.max(0, box.x); x < Math.min(doc.width, box.x + box.w); x++) {
      const k = grid[y * doc.width + x]!;
      if (k < 0) { cells.push(y * doc.width + x); continue; }
      const q = placed[k]!, o = doc.map!.entries[q.entry]!;
      if (replace && o.cols === 1 && o.rows === 1 && q.x === x && q.y === y) cells.push(y * doc.width + x);
    }
    const tail = `${box.x},${box.y} ${box.w}x${box.h} ${entryText(fp)}${replace ? ' replace' : ''}`;
    if (!mix) {
      const e: MapEntry = { name: thing!.name, variant: thing!.variant, ...fp };
      return {
        text: `tiles ${lt.v} fill ${what!.v} ${tail}`,
        op: fn((d) => {
          const v = entryIndex(d, e);
          const cel = d.cels[li]![0]!;
          for (const i of cells) cel[i] = v;
        }),
      };
    }
    const seed = seedOf(a, ctx);
    const fillSet = new Set(cells);
    const named = (i: number): string | null => {
      if (i < 0 || fillSet.has(i)) return null;
      const k = grid[i]!;
      return k < 0 ? null : doc.map!.entries[placed[k]!.entry]!.name;
    };
    const chosen = scatterMix(mix, cells, doc.width, seed, named);
    return {
      text: `tiles ${lt.v} fill mix=${mix.map((m) => `${m.name}:${m.weight}`).join(',')} ${tail} variants=named seed=${seed}`,
      op: fn((d) => {
        const ids = new Map<string, number>();
        const id = (n: string) => ids.get(n) ?? ids.set(n, entryIndex(d, { name: n, variant: null, ...fp, exact: true })).get(n)!;
        const cel = d.cels[li]![0]!;
        cells.forEach((i, k) => { cel[i] = id(chosen[k]!); });
      }),
    };
  },
};

// --- road

/** A route through points, along x then y between each pair (4-connected, so path schemes join it up). */
export function routeCells(pts: Pt[]): Pt[] {
  const out: Pt[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    let [x, y] = out[out.length - 1]!;
    const [tx, ty] = pts[i]!;
    while (x !== tx) { x += Math.sign(tx - x); out.push([x, y]); }
    while (y !== ty) { y += Math.sign(ty - y); out.push([x, y]); }
  }
  return out;
}

const roadCmd: CommandSpec = {
  name: 'road',
  summary: 'road <terrain layer> <x,y> <x,y> [<x,y>...] [width=<n>]   (lays the terrain along x then y between each pair of points)',
  normalise(cmd, ctx) {
    const doc = mapOf(cmd, ctx);
    const a = new Args(cmd, ['width']);
    const lt = a.take('word', 'a terrain layer (a path family)');
    const li = layerNamed(doc, lt, ['terrain']);
    const pts: Pt[] = [];
    for (const t of a.rest()) {
      if (t.t !== 'point') throw new DiagError(t.line, t.col, `road: expected a point x,y`);
      pts.push(pt(t));
    }
    if (pts.length < 2) throw new DiagError(cmd.line, cmd.col, `road: give at least two points`);
    const wo = a.opts.get('width');
    const width = wo ? intOf(wo, 1, 8) : 1;
    const cells = routeCells(pts);
    return {
      text: `road ${lt.v} ${pts.map(ptText).join(' ')} width=${width}`,
      op: fn((d) => {
        const cel = d.cels[li]![0]!;
        for (const [x, y] of cells) for (let j = 0; j < width; j++) for (let i = 0; i < width; i++) if (inMap(d, x + i, y + j)) cel[(y + j) * d.width + x + i] = 1;
      }),
    };
  },
};

// --- scatter on a map

const FP_RE = /^(\d+)x(\d+):(\d+),(\d+)$/;

function mapScatter(cmd: ParsedCommand, ctx: NormaliseContext, doc: Doc) {
  const a = new Args(cmd, ['count', 'on', 'off', 'minDist', 'layer', 'seed', 'fp']);
  const what = a.take('word', 'the assets to scatter (house or tree,bush)');
  const names = what.v.split(',');
  for (const n of names) if (!/^[a-z][a-z0-9_-]*$/.test(n)) throw new DiagError(what.line, what.col, `'${n}' is not an asset name`);
  const box = a.peek()?.t === 'point' ? { p: a.take('point', 'a corner'), s: a.take('size', 'a size in cells') } : null;
  a.done();
  const li = placeLayer(a, doc, ctx.by);
  const co = a.opts.get('count');
  if (!co) throw new DiagError(cmd.line, cmd.col, `scatter: missing count=<n>`);
  const count = intOf(co, 1, 10000);
  const mo = a.opts.get('minDist');
  const minDist = mo ? intOf(mo, 0, 512) : 1;
  const on = a.opts.get('on');
  const onLayer = on ? layerNamed(doc, { v: on.value, line: on.line, col: on.vcol }, ['terrain']) : -1;
  const off = a.opts.get('off');
  const offLayer = off ? layerNamed(doc, { v: off.value, line: off.line, col: off.vcol }, ['terrain']) : -1;
  const fo = a.opts.get('fp');
  let fps: { cols: number; rows: number; anchor: [number, number] }[];
  if (fo) {
    const parts = fo.value.split('/');
    if (parts.length !== names.length) throw new DiagError(fo.line, fo.vcol, `fp= needs one footprint per asset, like 2x2:0,1/1x1:0,0`);
    fps = parts.map((s) => {
      const m = FP_RE.exec(s);
      if (!m || Number(m[3]) >= Number(m[1]) || Number(m[4]) >= Number(m[2])) throw new DiagError(fo.line, fo.vcol, `fp= footprints look like 2x2:0,1 (cells, then the anchor)`);
      return { cols: Number(m[1]), rows: Number(m[2]), anchor: [Number(m[3]), Number(m[4])] as [number, number] };
    });
  } else {
    fps = names.map((n) => {
      const src = ctx.asset?.(n);
      if (!src) throw new DiagError(what.line, what.col, `no asset '${n}' to scatter`);
      const fp = footprintOf(src);
      return { cols: fp.cols, rows: fp.rows, anchor: fp.anchor };
    });
  }
  const seed = seedOf(a, ctx);
  const bx = box ? box.p.x : 0, by = box ? box.p.y : 0, bw = box ? box.s.w : doc.width, bh = box ? box.s.h : doc.height;
  // Place in turn at seeded spots: inside the box, every footprint cell on the terrain, free, and minDist from the others.
  const rng = new Pcg32(seed, 0x5ca7);
  const work: Doc = { ...doc, cels: doc.cels.map((fr, i) => (i === li ? [fr[0]!.slice()] : fr)), map: { tile: doc.map!.tile, entries: doc.map!.entries.map((e) => ({ ...e })) } };
  const terr = onLayer >= 0 ? doc.cels[onLayer]![0]! : null;
  const not = offLayer >= 0 ? doc.cels[offLayer]![0]! : null;
  const spots: { x: number; y: number; k: number }[] = [];
  for (let tries = 0; spots.length < count && tries < count * 40; tries++) {
    const k = rng.nextInt(names.length);
    const fp = fps[k]!;
    const x = bx + rng.nextInt(bw), y = by + rng.nextInt(bh);
    const b = entryBox({ name: names[k]!, variant: null, ...fp }, x, y);
    if (b.x < bx || b.y < by || b.x + b.w > bx + bw || b.y + b.h > by + bh || b.x < 0 || b.y < 0 || b.x + b.w > doc.width || b.y + b.h > doc.height) continue;
    let ok = true;
    for (let yy = b.y; yy < b.y + b.h && ok; yy++) for (let xx = b.x; xx < b.x + b.w; xx++) if ((terr && terr[yy * doc.width + xx] !== 1) || (not && not[yy * doc.width + xx] === 1)) { ok = false; break; }
    if (!ok) continue;
    if (spots.some((s) => Math.max(Math.abs(s.x - x), Math.abs(s.y - y)) < minDist)) continue;
    const { grid } = occupancy(work, li);
    for (let yy = b.y; yy < b.y + b.h && ok; yy++) for (let xx = b.x; xx < b.x + b.w; xx++) if (grid[yy * doc.width + xx]! >= 0) { ok = false; break; }
    if (!ok) continue;
    work.cels[li]![0]![y * doc.width + x] = entryIndex(work, { name: names[k]!, variant: null, ...fp });
    spots.push({ x, y, k });
  }
  return {
    text: `scatter ${what.v}${box ? ` ${box.p.x},${box.p.y} ${box.s.w}x${box.s.h}` : ''} count=${count}${on ? ` on=${on.value}` : ''}${off ? ` off=${off.value}` : ''} minDist=${minDist} layer=${doc.layers[li]!.name} fp=${fps.map((f) => `${f.cols}x${f.rows}:${f.anchor[0]},${f.anchor[1]}`).join('/')} seed=${seed}`,
    op: fn((d: Doc) => {
      for (const s of spots) d.cels[li]![0]![s.y * d.width + s.x] = entryIndex(d, { name: names[s.k]!, variant: null, ...fps[s.k]! });
    }),
  };
}

// --- map gen: quick layouts for test scenes

/** Smooth a terrain: each cell takes the majority of its 3x3 neighbourhood, then cells with fewer than 2 like neighbours (spits, notches) flip. */
export function smoothCells(cells: Uint8Array, W: number, H: number, rounds = 2, keepEdge = true): void {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : cells[y * W + x]!);
  for (let r = 0; r < rounds; r++) {
    const next = cells.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let n = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) n += at(x + i, y + j);
      next[y * W + x] = n >= 5 ? 1 : 0;
    }
    cells.set(next);
  }
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = cells[y * W + x]!;
      const like = [at(x + 1, y), at(x - 1, y), at(x, y + 1), at(x, y - 1)].filter((u) => u === v).length;
      if (like < 2) { cells[y * W + x] = v ? 0 : 1; changed = true; }
    }
    if (!changed) break;
  }
  if (keepEdge) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x === 0 || y === 0 || x === W - 1 || y === H - 1) cells[y * W + x] = 0;
}

/** Seeded value noise (0..255) on a grid of g cells, bilinear. */
function valueNoise(W: number, H: number, g: number, rng: Pcg32): Int32Array {
  const gw = Math.floor(W / g) + 2, gh = Math.floor(H / g) + 2;
  const grid = Array.from({ length: gw * gh }, () => rng.nextInt(256));
  const out = new Int32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const gx = Math.floor(x / g), gy = Math.floor(y / g), fx = x % g, fy = y % g;
    const a = grid[gy * gw + gx]!, b = grid[gy * gw + gx + 1]!, c = grid[(gy + 1) * gw + gx]!, e = grid[(gy + 1) * gw + gx + 1]!;
    out[y * W + x] = Math.floor(((a * (g - fx) + b * fx) * (g - fy) + (c * (g - fx) + e * fx) * fy) / (g * g));
  }
  return out;
}

/** An island: high in the middle, falling off to the edges, with noise for bays and points; smoothed. */
export function genIsland(W: number, H: number, rng: Pcg32, margin = 2): Uint8Array {
  const n1 = valueNoise(W, H, 4, rng), n2 = valueNoise(W, H, 2, rng);
  const cells = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = 2 * x - (W - 1), dy = 2 * y - (H - 1);
    const r = Math.floor((dx * dx * 256) / ((W - 1 - 2 * margin) ** 2 || 1) + (dy * dy * 256) / ((H - 1 - 2 * margin) ** 2 || 1));
    const noise = (n1[y * W + x]! * 3 + n2[y * W + x]!) / 4;
    cells[y * W + x] = (noise - 128) + 200 - r > 0 ? 1 : 0;
  }
  smoothCells(cells, W, H, 2, true);
  return cells;
}

/** Shrink a terrain by n cells (the cells within n of its outside are dropped). */
function erode(cells: Uint8Array, W: number, H: number, n: number): Uint8Array {
  const out = cells.slice();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!cells[y * W + x]) continue;
    for (let j = -n; j <= n && out[y * W + x]; j++) for (let i = -n; i <= n; i++) {
      const X = x + i, Y = y + j;
      if (X < 0 || Y < 0 || X >= W || Y >= H || !cells[Y * W + X]) { out[y * W + x] = 0; break; }
    }
  }
  return out;
}

const GEN_KINDS = ['island', 'village', 'dungeon'];

/**
 * The cells `map gen` lays on each terrain layer named, in order. island: the land. village: the
 * land, an inner ground (two cells in from the shore) and lanes crossing it. dungeon: rooms
 * joined by corridors on the first layer (the floor).
 */
export function genLayout(kind: string, W: number, H: number, seed: number, layers: number): Uint8Array[] {
  const rng = new Pcg32(seed, 0x6e6);
  if (kind === 'dungeon') {
    const floor = new Uint8Array(W * H);
    const rooms: [number, number, number, number][] = [];
    for (let tries = 0; tries < 200 && rooms.length < Math.max(3, Math.floor((W * H) / 90)); tries++) {
      const w = 4 + rng.nextInt(5), h = 3 + rng.nextInt(4);
      const x = 1 + rng.nextInt(Math.max(1, W - w - 2)), y = 1 + rng.nextInt(Math.max(1, H - h - 2));
      if (rooms.some(([a, b, c, d]) => x < a + c + 2 && a < x + w + 2 && y < b + d + 2 && b < y + h + 2)) continue;
      rooms.push([x, y, w, h]);
    }
    rooms.sort((p, q) => p[0] - q[0]);
    for (const [x, y, w, h] of rooms) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) floor[(y + j) * W + x + i] = 1;
    for (let k = 1; k < rooms.length; k++) {
      const [ax, ay, aw, ah] = rooms[k - 1]!, [bx, by, bw, bh] = rooms[k]!;
      for (const [x, y] of routeCells([[ax + (aw >> 1), ay + (ah >> 1)], [bx + (bw >> 1), by + (bh >> 1)]])) {
        floor[y * W + x] = 1;
        if (y + 1 < H - 1) floor[(y + 1) * W + x] = 1;
      }
    }
    return [floor, ...Array.from({ length: layers - 1 }, () => new Uint8Array(W * H))];
  }
  const land = genIsland(W, H, rng, kind === 'village' ? 1 : 2);
  if (kind === 'island') return [land, ...Array.from({ length: layers - 1 }, () => new Uint8Array(W * H))];
  const inner = erode(land, W, H, 2);
  smoothCells(inner, W, H, 1, true);
  const lanes = new Uint8Array(W * H);
  // Lanes: one across and one down through the middle of the inner ground, a cell in from its edge.
  const lanesOn = erode(inner, W, H, 1);
  const mx = Math.floor(W / 2) + rng.nextInt(5) - 2, my = Math.floor(H / 2) + rng.nextInt(5) - 2;
  for (let x = 0; x < W; x++) if (lanesOn[my * W + x]) lanes[my * W + x] = 1;
  for (let y = 0; y < H; y++) if (lanesOn[y * W + mx]) lanes[y * W + mx] = 1;
  return [land, inner, lanes, ...Array.from({ length: Math.max(0, layers - 3) }, () => new Uint8Array(W * H))].slice(0, Math.max(1, layers));
}

/**
 * Where `map gen` stands objects: well inside the ground it laid (village: the inner ground off the
 * lanes; island: the land a cell in from its shore; dungeon: the floor a cell in from its walls).
 */
function genGround(kind: string, W: number, H: number, seed: number): Uint8Array {
  const [land, inner, lanes] = genLayout(kind, W, H, seed, 3);
  if (kind === 'village') return inner!.map((v, i) => (v && !lanes![i] ? 1 : 0));
  return erode(land!, W, H, 1);
}

const OBJ_RE = /^([a-z][a-z0-9_-]*)(?::(\d+))?$/;

/**
 * Seeded spots for objects on the allowed cells: larger footprints first, every footprint cell
 * allowed, free on the layer, and a free cell between any two of them.
 */
function genPlacements(doc: Doc, li: number, objs: { name: string; count: number; fp: { cols: number; rows: number; anchor: [number, number] } }[], allowed: Uint8Array, seed: number): { x: number; y: number; k: number }[] {
  const rng = new Pcg32(seed, 0x0b1e);
  const W = doc.width, H = doc.height;
  const taken = new Uint8Array(W * H);
  const { grid } = occupancy(doc, li);
  for (let i = 0; i < W * H; i++) if (grid[i]! >= 0) taken[i] = 1;
  const order = objs.map((o, k) => ({ o, k })).sort((a, b) => b.o.fp.cols * b.o.fp.rows - a.o.fp.cols * a.o.fp.rows || a.k - b.k);
  const spots: { x: number; y: number; k: number }[] = [];
  for (const { o, k } of order) {
    for (let n = 0; n < o.count; n++) {
      for (let tries = 0; tries < 400; tries++) {
        const x = rng.nextInt(W), y = rng.nextInt(H);
        const b = entryBox({ name: o.name, variant: null, ...o.fp }, x, y);
        if (b.x < 0 || b.y < 0 || b.x + b.w > W || b.y + b.h > H) continue;
        let ok = true;
        for (let yy = b.y - 1; yy <= b.y + b.h && ok; yy++) for (let xx = b.x - 1; xx <= b.x + b.w; xx++) {
          const inside = xx >= b.x && xx < b.x + b.w && yy >= b.y && yy < b.y + b.h;
          if (inside && (!allowed[yy * W + xx] || taken[yy * W + xx])) { ok = false; break; }
          if (!inside && inMap(doc, xx, yy) && taken[yy * W + xx]) { ok = false; break; }
        }
        if (!ok) continue;
        for (let yy = b.y; yy < b.y + b.h; yy++) for (let xx = b.x; xx < b.x + b.w; xx++) taken[yy * W + xx] = 1;
        spots.push({ x, y, k });
        break;
      }
    }
  }
  return spots;
}

const mapCmd: CommandSpec = {
  name: 'map',
  summary: 'map gen island|village|dungeon [layers=<terrain layer>,..] [objects=<asset>[:<n>],..] [layer=<objects layer>] [seed=<n>]   (lays out the terrain layers for a quick scene and stands the objects on it (default: the objects the manifest says the map uses); edit it after)',
  normalise(cmd, ctx) {
    const doc = mapOf(cmd, ctx);
    const a = new Args(cmd, ['layers', 'seed', 'objects', 'layer', 'fp']);
    const how = a.take('word', 'gen');
    if (how.v !== 'gen') throw new DiagError(how.line, how.col, `map: expected gen`);
    const kind = a.take('word', GEN_KINDS.join(', '));
    if (!GEN_KINDS.includes(kind.v)) throw new DiagError(kind.line, kind.col, `map gen: expected ${GEN_KINDS.join(', ')}`);
    a.done();
    const lo = a.opts.get('layers');
    const terrains = doc.layers.flatMap((l) => (l.map?.kind === 'terrain' ? [l.name] : []));
    const want = lo ? lo.value.split(',') : terrains.slice(0, kind.v === 'village' ? 3 : 1);
    if (!want.length) throw new DiagError(cmd.line, cmd.col, `map gen: the map has no terrain layers (layer add <name> terrain=<family>)`);
    const idx = want.map((n) => layerNamed(doc, { v: n, line: lo?.line ?? cmd.line, col: lo?.vcol ?? cmd.col }, ['terrain']));
    // The objects: given, else the manifest's (those the map uses that are drawn objects).
    const oo = a.opts.get('objects');
    const at = oo ? { line: oo.line, col: oo.vcol } : { line: cmd.line, col: cmd.col };
    let objs: { name: string; count: number }[] = [];
    if (oo) {
      objs = oo.value.split(',').map((s) => {
        const m = OBJ_RE.exec(s);
        if (!m) throw new DiagError(oo.line, oo.vcol, `objects= is a list like well,house:2,tree:3`);
        return { name: m[1]!, count: m[2] ? Math.max(1, Math.min(64, Number(m[2]))) : 1 };
      });
    } else {
      const dflt = ctx.defaults?.mapObjects?.(doc.name) ?? [];
      const hasLayer = doc.layers.some((l) => l.map?.kind === 'objects');
      if (hasLayer) objs = dflt.filter((n) => { const d = ctx.asset?.(n); return !!d && !d.map && !d.family && !d.overlay; }).map((name) => ({ name, count: 1 }));
    }
    const seed = seedOf(a, ctx);
    const cells = genLayout(kind.v, doc.width, doc.height, seed, idx.length);
    const terrainOp = (d: Doc) => idx.forEach((li, k) => { d.cels[li]![0]!.set(Uint16Array.from(cells[k]!, (v) => (v ? 1 : TRANSPARENT))); });
    if (!objs.length) {
      if (a.opts.get('layer') || a.opts.get('fp')) throw new DiagError(cmd.line, cmd.col, 'map gen: layer= and fp= go with objects=');
      return { text: `map gen ${kind.v} layers=${want.join(',')} seed=${seed}`, op: fn(terrainOp) };
    }
    const lyo = a.opts.get('layer');
    let li: number;
    if (lyo) li = layerNamed(doc, { v: lyo.value, line: lyo.line, col: lyo.vcol }, ['objects']);
    else {
      li = doc.layers.findIndex((l) => l.map?.kind === 'objects');
      if (li < 0) throw new DiagError(at.line, at.col, `map gen: the map has no objects layer to stand objects on (layer add <name> objects)`);
    }
    if (doc.layers[li]!.locked) throw new DiagError(at.line, at.col, `layer '${doc.layers[li]!.name}' is locked`);
    const fo = a.opts.get('fp');
    let fps: { cols: number; rows: number; anchor: [number, number] }[];
    if (fo) {
      const parts = fo.value.split('/');
      if (parts.length !== objs.length) throw new DiagError(fo.line, fo.vcol, `fp= needs one footprint per object, like 2x2:0,1/1x1:0,0`);
      fps = parts.map((s) => {
        const m = FP_RE.exec(s);
        if (!m || Number(m[3]) >= Number(m[1]) || Number(m[4]) >= Number(m[2])) throw new DiagError(fo.line, fo.vcol, `fp= footprints look like 2x2:0,1 (cells, then the anchor)`);
        return { cols: Number(m[1]), rows: Number(m[2]), anchor: [Number(m[3]), Number(m[4])] as [number, number] };
      });
    } else {
      fps = objs.map((o) => {
        const src = ctx.asset?.(o.name);
        if (!src) throw new DiagError(at.line, at.col, `map gen: no asset '${o.name}' to stand on the map`);
        const fp = footprintOf(src);
        return { cols: fp.cols, rows: fp.rows, anchor: fp.anchor };
      });
    }
    const list = objs.map((o, k) => ({ ...o, fp: fps[k]! }));
    const spots = genPlacements(doc, li, list, genGround(kind.v, doc.width, doc.height, seed), seed);
    return {
      text: `map gen ${kind.v} layers=${want.join(',')} objects=${objs.map((o) => (o.count > 1 ? `${o.name}:${o.count}` : o.name)).join(',')} layer=${doc.layers[li]!.name} fp=${fps.map((f) => `${f.cols}x${f.rows}:${f.anchor[0]},${f.anchor[1]}`).join('/')} seed=${seed}`,
      op: fn((d) => {
        terrainOp(d);
        for (const s of spots) d.cels[li]![0]![s.y * d.width + s.x] = entryIndex(d, { name: list[s.k]!.name, variant: null, ...list[s.k]!.fp });
      }),
    };
  },
};

// --- footprint and variant (any asset)

const FLAG_CHARS = new Set(['.', 'b', 'r', 'x']);

const footprintCmd: CommandSpec = {
  name: 'footprint',
  summary: 'footprint <C>x<R> [at=<cx,cy>] [anchor=<x,y>] [<< a row per cell row of the art: . b (blocks) r (roof: drawn above actors) x (both) >>] | footprint off',
  normalise(cmd, ctx) {
    const doc = needDoc(cmd, ctx);
    if (doc.map || doc.family || doc.overlay) throw new DiagError(cmd.line, cmd.col, `footprint: a ${doc.kind} is not placed on a map as an object`);
    const a = new Args(cmd, ['at', 'anchor']);
    if (a.peek()?.t === 'word' && (a.peek() as { v: string }).v === 'off') {
      a.take('word', 'off');
      a.done();
      return { text: 'footprint off', op: fn((d) => { d.footprint = null; }) };
    }
    if (doc.width % doc.cellW || doc.height % doc.cellH) throw new DiagError(cmd.line, cmd.col, `footprint: the ${doc.width}x${doc.height} canvas is not whole cells of ${doc.cellW}x${doc.cellH} (new … cell=<W>x<H>)`);
    const [ac, ar] = artGrid(doc);
    const s = a.take('size', 'the footprint in cells, like 2x2');
    const block = a.peek()?.t === 'block' ? a.take('block', 'flag rows') : null;
    a.done();
    if (s.w < 1 || s.h < 1 || s.w > ac || s.h > ar) throw new DiagError(s.line, s.col, `footprint: ${s.w}x${s.h} must fit the art's ${ac}x${ar} cells`);
    const pair = (o: Kv | undefined, dflt: [number, number], what: string, mx: number, my: number): [number, number] => {
      if (!o) return dflt;
      const m = /^(\d+),(\d+)$/.exec(o.value);
      if (!m || Number(m[1]) >= mx || Number(m[2]) >= my) throw new DiagError(o.line, o.vcol, `${o.key}= must be ${what} (x 0..${mx - 1}, y 0..${my - 1})`);
      return [Number(m[1]), Number(m[2])];
    };
    const at = pair(a.opts.get('at'), [0, ar - s.h], 'the footprint\'s top-left art cell', ac - s.w + 1, ar - s.h + 1);
    const anchor = pair(a.opts.get('anchor'), [0, s.h - 1], 'a cell of the footprint', s.w, s.h);
    let flags: string[];
    if (block) {
      flags = block.rows.map((r) => r.text);
      if (flags.length !== ar || flags.some((r) => r.length !== ac)) throw new DiagError(block.line, block.col, `footprint: the flags are ${ar} rows of ${ac} (one per cell of the art)`);
      block.rows.forEach((r) => [...r.text].forEach((ch, i) => {
        if (!FLAG_CHARS.has(ch)) throw new DiagError(r.line, r.col + i, `footprint: '${ch}' is not . b r or x`);
      }));
    } else {
      // By default the footprint blocks and nothing is a roof.
      flags = Array.from({ length: ar }, (_, y) => Array.from({ length: ac }, (_, x) => (x >= at[0] && y >= at[1] && x < at[0] + s.w && y < at[1] + s.h ? 'b' : '.')).join(''));
    }
    const fp: Footprint = { cols: s.w, rows: s.h, at, anchor, flags };
    return {
      text: `footprint ${s.w}x${s.h} at=${at[0]},${at[1]} anchor=${anchor[0]},${anchor[1]} <<\n${flags.map((r) => `  ${r}\n`).join('')}>>`,
      op: fn((d) => { d.footprint = { ...fp, at: [at[0], at[1]], anchor: [anchor[0], anchor[1]], flags: [...flags] }; }),
    };
  },
};

const variantCmd: CommandSpec = {
  name: 'variant',
  summary: 'variant of=<asset> [band=inherit|own] | variant off   (this asset is a texture variant of another: maps pick among them cell by cell; check variant compares their colour mix; band=inherit: a family variant takes its band from the base, now and after every change to it, and overrides only the textures)',
  normalise(cmd, ctx) {
    const doc = needDoc(cmd, ctx);
    const a = new Args(cmd, ['of', 'band']);
    if (a.peek()?.t === 'word' && (a.peek() as { v: string }).v === 'off') {
      a.take('word', 'off');
      a.done();
      return { text: 'variant off', op: fn((d) => { d.variantOf = null; if (d.family?.bandOf) { delete d.family.bandOf; unlockBand(d); } }) };
    }
    a.done();
    const of = a.opts.get('of');
    if (!of) throw new DiagError(cmd.line, cmd.col, `variant: give of=<the asset this is a variant of> (or off)`);
    if (!/^[a-z][a-z0-9_-]*$/.test(of.value)) throw new DiagError(of.line, of.vcol, `'${of.value}' is not an asset name`);
    if (of.value === doc.name) throw new DiagError(of.line, of.vcol, `an asset is not a variant of itself`);
    if (doc.map) throw new DiagError(cmd.line, cmd.col, `variant: a map has no variants`);
    const band = a.choice('band', ['inherit', 'own'], 'own');
    if (band === 'inherit') {
      if (!doc.family) throw new DiagError(a.opts.get('band')!.line, a.opts.get('band')!.col, `variant: band=inherit is for a family's texture variant`);
      const src = ctx.asset?.(of.value);
      if (src && (!src.family || src.family.scheme !== doc.family.scheme || src.family.tile !== doc.family.tile)) {
        throw new DiagError(of.line, of.vcol, `variant: '${of.value}' is not a ${doc.family.scheme} family of ${doc.family.tile}px tiles, so its band does not fit`);
      }
    }
    // band=inherit locks the band layer: the band is the base's (family band from=<base> copies it;
    // the server does after every change to the base), and only the textures are the variant's own.
    return {
      text: `variant of=${of.value}${band === 'inherit' ? ' band=inherit' : ''}`,
      op: fn((d) => {
        d.variantOf = of.value;
        if (!d.family) return;
        if (band === 'inherit') { d.family.bandOf = of.value; const bl = d.layers.find((l) => l.name === 'band'); if (bl) bl.locked = true; } else if (d.family.bandOf) { delete d.family.bandOf; unlockBand(d); }
      }),
    };
  },
};

for (const c of [terrainCmd, tilesCmd, placeCmd, moveCmd, removeCmd, roadCmd, mapCmd, footprintCmd, variantCmd]) registerCommand(c);

// `scatter` on a map places assets; elsewhere it is the stamp generator.
const pixelScatter = COMMANDS.get('scatter')!;
registerCommand({
  name: 'scatter',
  summary: `${pixelScatter.summary}   |   (maps) scatter <asset>[,<asset>..] [<x,y> <W>x<H>] count=<n> [on=<terrain layer>] [off=<terrain layer>] [minDist=<n>] [layer=<objects layer>] [seed=<n>]`,
  normalise(cmd, ctx) {
    return ctx.doc?.map ? mapScatter(cmd, ctx, ctx.doc) : pixelScatter.normalise(cmd, ctx);
  },
});

