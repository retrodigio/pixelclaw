// Write the built-in autotile schemes (plan §4.2) as JSON data in core/schemes/. The files are the
// source of truth the tool reads; this script is how they were made, kept so they can be checked.
//   node scripts/gen-schemes.ts
//
// Neighbourhood bits: N=1 NE=2 E=4 SE=8 S=16 SW=32 W=64 NW=128 (for corner schemes, a tile's own
// corners use the diagonal bits). A variant's quads are its quadrants NW, NE, SW, SE, each a kind
// (in, out, outer, inner, horiz, vert, or an alias the scheme declares) facing a direction
// ("outer@se"); without "@", the kind faces the quadrant's own corner.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(import.meta.dirname, '..', 'core', 'schemes');
const N = 1, NE = 2, E = 4, SE = 8, S = 16, SW = 32, W = 64, NW = 128;
const SIDES: [number, string][] = [[N, 'n'], [E, 'e'], [S, 's'], [W, 'w']];
const DIAGS: [number, string][] = [[NE, 'ne'], [SE, 'se'], [SW, 'sw'], [NW, 'nw']];

interface Variant { name: string; key: number | null; quads: string[]; on?: 'face' | 'fillet' }
interface Scheme {
  name: string; description: string; neighbours: '8' | '4' | 'axis' | 'corners' | 'none'; cornerRule?: boolean | 'either';
  inset?: [number, number]; kinds?: Record<string, string>; faces?: boolean; fillets?: boolean; columns: number; pieces: string[]; variants: Variant[];
}

const sideName = (k: number) => SIDES.filter(([b]) => k & b).map(([, s]) => s).join('') || 'o';
const blobName = (k: number) => [sideName(k), ...DIAGS.filter(([b]) => k & b).map(([, s]) => s)].join('_');

/** The quadrant kind at a corner from its vertical side, horizontal side and diagonal neighbour. */
function quad(v: boolean, h: boolean, d: boolean, interior = true): string {
  if (v && h) return interior && d ? 'in' : 'inner';
  if (!v && !h) return 'outer';
  return v ? 'vert' : 'horiz';
}
// Quadrants NW NE SW SE: [vertical side, horizontal side, diagonal].
const CORNERS: [number, number, number][] = [[N, W, NW], [N, E, NE], [S, W, SW], [S, E, SE]];

function blob47(): Scheme {
  const keys = new Set<number>();
  for (let raw = 0; raw < 256; raw++) {
    let k = raw & (N | E | S | W);
    for (const [v, h, d] of CORNERS) if ((raw & v) && (raw & h) && (raw & d)) k |= d;
    keys.add(k);
  }
  const variants = [...keys].sort((a, b) => a - b).map((k) => ({
    name: blobName(k), key: k, quads: CORNERS.map(([v, h, d]) => quad(!!(k & v), !!(k & h), !!(k & d))),
  }));
  return {
    name: 'blob47', description: '8 neighbours with the corner rule (a diagonal counts only when both sides next to it are the same terrain): 47 variants',
    neighbours: '8', cornerRule: true, columns: 8, pieces: ['o', 'nesw', 'ew', 'ns', 'nesw_ne_se_sw_nw'], variants,
  };
}

function path(): Scheme {
  const variants: Variant[] = [];
  for (let m = 0; m < 16; m++) {
    const k = (m & 1 ? N : 0) | (m & 2 ? E : 0) | (m & 4 ? S : 0) | (m & 8 ? W : 0);
    variants.push({ name: sideName(k), key: k, quads: CORNERS.map(([v, h]) => quad(!!(k & v), !!(k & h), false, false)) });
  }
  variants.sort((a, b) => a.key! - b.key!);
  return {
    name: 'path', description: '4 neighbours: a strip through the middle of the tile toward each joined side (roads, rivers, fences): 16 variants',
    neighbours: '4', inset: [1, 4], columns: 8, pieces: ['o', 'nesw', 'ew', 'ns'], variants,
  };
}

function bridge8(): Scheme {
  const h = (k: number) => CORNERS.map(([, hs]) => (k & hs ? 'horiz' : 'endh'));
  const v = (k: number) => CORNERS.map(([vs]) => (k & vs ? 'vert' : 'endv'));
  return {
    name: 'bridge8',
    description: 'a deck joined along one axis (east-west wins when both): single, the two ends and the middle of each axis: 8 variants. A tile with no bridge beside it is the east-west single; the north-south single is placed by name',
    neighbours: 'axis', inset: [1, 4], kinds: { endh: 'horiz', endv: 'vert' }, columns: 4, pieces: ['h', 'h_ew', 'v', 'v_ns'],
    variants: [
      { name: 'h', key: 0, quads: h(0) }, { name: 'h_e', key: E, quads: h(E) }, { name: 'h_ew', key: E | W, quads: h(E | W) }, { name: 'h_w', key: W, quads: h(W) },
      { name: 'v', key: null, quads: v(0) }, { name: 'v_s', key: S, quads: v(S) }, { name: 'v_ns', key: N | S, quads: v(N | S) }, { name: 'v_n', key: N, quads: v(N) },
    ],
  };
}

function wang16(): Scheme {
  // A tile's corners NW NE SW SE; a corner that is in owns its quadrant, which faces the tile's
  // middle: its vertical neighbour is the corner below or above it, its horizontal one beside it.
  const C = [NW, NE, SW, SE];
  const vOf = [SW, SE, NW, NE];
  const hOf = [NE, NW, SE, SW];
  const dOf = [SE, SW, NE, NW];
  const face = ['se', 'sw', 'ne', 'nw'];
  const cname = (k: number) => DIAGS.filter(([b]) => k & b).map(([, s]) => s).join('_') || 'o';
  const variants: Variant[] = [];
  for (let m = 0; m < 16; m++) {
    const k = (m & 1 ? NE : 0) | (m & 2 ? SE : 0) | (m & 4 ? SW : 0) | (m & 8 ? NW : 0);
    variants.push({
      name: cname(k), key: k,
      quads: C.map((c, i) => (k & c ? `${quad(!!(k & vOf[i]!), !!(k & hOf[i]!), !!(k & dOf[i]!))}@${face[i]}` : 'out')),
    });
  }
  variants.sort((a, b) => a.key! - b.key!);
  // Pieces: the fewest variants that hold every kind and facing the others need (greedy).
  const need = new Set(variants.flatMap((x) => x.quads.filter((q) => q !== 'out')));
  const pieces: string[] = [];
  while (need.size) {
    const best = variants.reduce((b, x) => (x.quads.filter((q) => need.has(q)).length > b.quads.filter((q) => need.has(q)).length ? x : b));
    pieces.push(best.name);
    for (const q of best.quads) need.delete(q);
  }
  return {
    name: 'wang16-corner', description: 'corner Wang tiles: each of the four corners is in or out, and the edge runs through the middle of the tile: 16 variants',
    neighbours: 'corners', columns: 8, pieces, variants,
  };
}

function face(): Scheme {
  const b = blob47();
  const faces: Variant[] = [
    { name: 'face_o', key: 0, quads: ['faceend', 'faceend', 'faceend', 'faceend'], on: 'face' },
    { name: 'face_e', key: E, quads: ['faceend', 'facemid', 'faceend', 'facemid'], on: 'face' },
    { name: 'face_ew', key: E | W, quads: ['facemid', 'facemid', 'facemid', 'facemid'], on: 'face' },
    { name: 'face_w', key: W, quads: ['facemid', 'faceend', 'facemid', 'faceend'], on: 'face' },
  ];
  return {
    ...b, name: 'face',
    description: 'blob47 plus a south face: a cell below the terrain (and not in it) gets a face piece, joined east and west to the faces beside it: 47 + 4 variants',
    faces: true, kinds: { faceend: 'out', facemid: 'out' }, pieces: [...b.pieces, 'face_o', 'face_ew'], variants: [...b.variants, ...faces],
  };
}

function single(): Scheme {
  return {
    name: 'single', description: 'one tile whatever its neighbours (plain ground, props): 1 variant',
    neighbours: 'none', columns: 1, pieces: ['o'], variants: [{ name: 'o', key: 0, quads: ['in', 'in', 'in', 'in'] }],
  };
}

/**
 * blob47 with rounder inner corners (a scheme option, plan §17). A diagonal counts when either side
 * next to it is the terrain, so an edge knows when the terrain turns an inner corner at its end:
 * there its quadrant bends into the corner (vround, hround), the inner corner's arc widens, and
 * the cell outside the corner gets the rounding's tip (15 fillet variants keyed by the corners the
 * terrain turns around). The band's `fillet=` says how much wider. 161 + 15 variants; pieces are
 * chosen so every quadrant kind at every corner has one. The example project ships it as one of
 * its own schemes (schemes/*.json), which a family's tape copies.
 */
function blob47Round(): Scheme {
  const keys = new Set<number>();
  for (let raw = 0; raw < 256; raw++) {
    let k = raw & (N | E | S | W);
    for (const [v, h, d] of CORNERS) if ((raw & d) && (raw & (v | h))) k |= d;
    keys.add(k);
  }
  const qr = (v: boolean, h: boolean, d: boolean) => (v && h ? (d ? 'in' : 'inner') : !v && !h ? 'outer' : v ? (d ? 'vround' : 'vert') : d ? 'hround' : 'horiz');
  const variants: Variant[] = [...keys].sort((a, c) => a - c).map((k) => ({ name: blobName(k), key: k, quads: CORNERS.map(([v, h, d]) => qr(!!(k & v), !!(k & h), !!(k & d))) }));
  // Pieces: blob47's, then greedily whichever variant supplies the most quadrants still missing.
  const pieces = ['o', 'nesw', 'ew', 'ns', 'nesw_ne_se_sw_nw'];
  const have = (n: string) => variants.find((v) => v.name === n)!.quads.map((q, i) => `${q}@${i}`);
  const need = new Set(variants.flatMap((v) => v.quads.map((q, i) => `${q}@${i}`)));
  for (const p of pieces) for (const q of have(p)) need.delete(q);
  while (need.size) {
    const best = variants.reduce((a, c) => (c.quads.filter((q, i) => need.has(`${q}@${i}`)).length > a.quads.filter((q, i) => need.has(`${q}@${i}`)).length ? c : a));
    pieces.push(best.name);
    best.quads.forEach((q, i) => need.delete(`${q}@${i}`));
  }
  for (let m = 1; m < 16; m++) {
    const k = (m & 1 ? NE : 0) | (m & 2 ? SE : 0) | (m & 4 ? SW : 0) | (m & 8 ? NW : 0);
    const corners = DIAGS.filter(([bit]) => k & bit).map(([, n]) => n);
    // Quadrants NW NE SW SE: the tip of the rounding in each corner the terrain turns around.
    variants.push({ name: `f_${corners.join('_')}`, key: k, quads: [NW, NE, SW, SE].map((bit) => (k & bit ? 'fillet' : 'out')), on: 'fillet' });
  }
  pieces.push('f_ne_se_sw_nw');
  return {
    name: 'blob47-round', description: 'blob47 with rounder inner corners: edges bend into each inner corner and the cell outside it rounds it off (161 variants + 15 fillets; family band fillet=<px>)',
    neighbours: '8', cornerRule: 'either', fillets: true, columns: 8, pieces, variants,
  };
}

const write = (dir: string, s: Scheme) => {
  // One variant per line, so the files read (and diff) as tables.
  const { variants, ...head } = s;
  const lines = JSON.stringify(head, null, 2).replace(/\n}$/, ',\n  "variants": [\n');
  const body = variants.map((v) => '    ' + JSON.stringify(v)).join(',\n');
  writeFileSync(join(dir, `${s.name}.json`), `${lines}${body}\n  ]\n}\n`);
  console.log(`${s.name}: ${variants.length} variants, pieces ${s.pieces.join(' ')}`);
};

mkdirSync(OUT, { recursive: true });
const EXAMPLE = join(import.meta.dirname, '..', 'examples', 'mossy-ruins.pclaw', 'schemes');
mkdirSync(EXAMPLE, { recursive: true });
// blob47-round is built in since G15 (plan §26 item 4); the example project keeps its own copy (its
// tapes name it with def=, as a project scheme).
write(EXAMPLE, blob47Round());
for (const s of [blob47(), blob47Round(), wang16(), path(), bridge8(), single(), face()]) {
  write(OUT, s);
}
