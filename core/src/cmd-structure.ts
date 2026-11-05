// Generators for structure : `pebbles` (stones with a lit pixel and a shadow
// side, in sizes, never overlapping) and `tufts` (blades of grass lit from one side). Both are lit
// from the style guide's light unless light= says otherwise and take seed= like every generator
// (so the `seeds` tool ranks them).
//
// Placement is balanced: each shape goes where the rows and columns it covers have the least
// coverage so far (the best of a few seeded tries), so no band of rows or columns comes out lighter
// than the rest (the repetition and seam checks look for exactly that).
//
// wrap=on (the default on tiles) works on the box as a torus: a shape that crosses an edge is drawn
// whole across it, so the tile tiles with itself. The shapes that cross an edge come from edges=
// (by default the seed itself); the rest from seed=. Looks of one ground drawn with the same edges=
// and different seeds share every shape on their borders, so they join each other any way round,
// with nothing cut where they meet. wrap=off keeps every shape whole inside the box.

import { Args, drawable, fn, registerCommand, resolveColour, type CommandSpec, type NormaliseContext } from './commands.ts';
import { LIGHT_DIRS } from './consistency.ts';
import { TRANSPARENT, ctxOf, flatten, type Doc } from './doc.ts';
import { lstar, luma601 } from './checks.ts';
import { drawColoured } from './draw.ts';
import { mod, optBox, pick, seedOf, wrapOpt, type Box } from './cmd-gen.ts';
import { DiagError, type ParsedCommand } from './parser.ts';
import { Pcg32 } from './pcg.ts';
import { segment } from './raster.ts';
import { fraction, intOpt, rampOpt, rangeOpt, weightsOpt, type Fraction, type Ramp } from './values.ts';

type Pt = [number, number];
/** A shape to place: pixels relative to its top-left, each with its colour. */
interface Shape { w: number; h: number; px: [number, number, number][]; alts?: Shape[] }

/** The light: given, else the style guide's, else from the north-west; written into the line. */
function lightOf(a: Args, ctx: NormaliseContext): { name: string; dir: Pt } {
  const style = ctx.defaults?.light && ctx.defaults.light in LIGHT_DIRS ? ctx.defaults.light : 'nw';
  const name = a.choice('light', Object.keys(LIGHT_DIRS), style);
  return { name, dir: LIGHT_DIRS[name]! };
}

function rampOf(a: Args, doc: Doc, cmd: ParsedCommand, min: number): Ramp {
  const ro = a.opts.get('ramp');
  if (!ro) throw new DiagError(cmd.line, cmd.col, `${cmd.name}: missing ramp=<ramp> (a palette ramp, darkest first, or entries a,b,c)`);
  const ramp = rampOpt(ro, doc.palette);
  if (ramp.idx.length < min) throw new DiagError(ro.line, ro.vcol, `${cmd.name}: ramp= needs at least ${min} colours (darkest first), not ${ramp.idx.length}`);
  return ramp;
}

/** A colour option, or none. */
function colourOrNone(a: Args, doc: Doc, key: string, dflt: number | null): { index: number | null; text: string } {
  const o = a.opts.get(key);
  if (!o) return { index: dflt, text: dflt === null ? 'none' : doc.palette.entries[dflt]!.name };
  if (o.value === 'none') return { index: null, text: 'none' };
  const c = resolveColour(o.value, doc.palette, o.line, o.vcol);
  return { index: c.index, text: c.name };
}

/** Sizes in px scale with the cell (16 px tiles get small stones, 48 px ones bigger). */
const cellOf = (doc: Doc): number => Math.max(8, Math.min(doc.cellW, doc.cellH));

/** The settings every structure generator shares. */
interface Placing { box: Box; wrap: boolean; gap: number; density: Fraction; seed: number; edges: number }

function placingOf(a: Args, doc: Doc, ctx: NormaliseContext, box: Box, density: Fraction): Placing {
  const go = a.opts.get('gap');
  const gap = go ? intOpt(go, 0, 16) : 1;
  const wrap = wrapOpt(a, doc);
  const seed = seedOf(a, ctx);
  const eo = a.opts.get('edges');
  if (eo && !wrap) throw new DiagError(eo.line, eo.col, `edges= goes with wrap=on (with wrap=off nothing crosses the box's edge)`);
  const edges = eo ? intOpt(eo, 0, 0x7fffffff) : seed;
  return { box, wrap, gap, density, seed, edges };
}

const placingText = (p: Placing): string => `gap=${p.gap} wrap=${p.wrap ? 'on' : 'off'}${p.wrap ? ` edges=${p.edges}` : ''} seed=${p.seed}`;

/**
 * How even a box is along one axis, kept up to date pixel by pixel: every band of 1 to a few lines
 * (rows, or columns) as the repetition check weighs it (ΔL* from the box's mean times √width, over
 * a limit of 3 raised by how uneven the band is along its length; bands wrap), and the seam check's
 * line (the edge lines' mean luma against the rest, over the rest's spread).
 */
class Evenness {
  readonly n: number;
  readonly len: number;
  readonly wmax: number;
  readonly unit: number;
  /** Per band (start k, width w): the band's sum at each place along it, and those sums' total and sum of squares. */
  private readonly C: Float64Array;
  private readonly S1: Float64Array;
  private readonly S2: Float64Array;
  /** Per line: its luma sum. */
  private readonly Y: Float64Array;
  /** Per pair of lines k and k+1 (wrapping): at how many places their colours differ. */
  private readonly mis: Float64Array;
  total = 0;

  constructor(n: number, len: number) {
    this.n = n;
    this.len = len;
    this.unit = Math.max(1, Math.floor(n / 24));
    this.wmax = Math.max(1, Math.min(6 * this.unit, n >> 2));
    this.C = new Float64Array(n * this.wmax * len);
    this.S1 = new Float64Array(n * this.wmax);
    this.S2 = new Float64Array(n * this.wmax);
    this.Y = new Float64Array(n);
    this.mis = new Float64Array(n);
  }

  /** Line r, place j changes colour from a to b; at(k) is the colour on line k at that place. */
  recolour(r: number, a: number, b: number, at: (k: number) => number): void {
    const n = this.n;
    const up = at((r - 1 + n) % n), down = at((r + 1) % n);
    this.mis[(r - 1 + n) % n] += (up !== b ? 1 : 0) - (up !== a ? 1 : 0);
    this.mis[r] += (down !== b ? 1 : 0) - (down !== a ? 1 : 0);
  }

  /** The seam check's jump: colour changes across the edge (the last line to the first) against those between other lines. */
  jump(): number {
    const { n, len } = this;
    if (n < 4) return 0;
    let m = 0;
    for (let k = 0; k < n - 1; k++) m += this.mis[k]! / len;
    m /= n - 1;
    let v = 0;
    for (let k = 0; k < n - 1; k++) v += (this.mis[k]! / len - m) ** 2;
    return (this.mis[n - 1]! / len - m) / (Math.sqrt(v / (n - 1)) + 0.02);
  }

  /** Line r, place j: lightness changes by dl and luma by dy. */
  add(r: number, j: number, dl: number, dy: number): void {
    const { n, wmax, len } = this;
    this.total += dl;
    this.Y[r] += dy;
    for (let w = 1; w <= wmax; w++) for (let t = 0; t < w; t++) {
      const b = ((r - t + n) % n) * wmax + w - 1;
      const c = this.C[b * len + j]!;
      this.C[b * len + j] = c + dl;
      this.S1[b] += dl;
      this.S2[b] += 2 * c * dl + dl * dl;
    }
  }

  /** The worst band's ratio to its limit, and the sum of the squared ratios. */
  bands(): [number, number] {
    const { n, wmax, len, unit } = this;
    const mu = this.total / (n * len);
    let worst = 0, ss = 0;
    for (let b = 0; b < n * wmax; b++) {
      const w = (b % wmax) + 1;
      const m = this.S1[b]! / (len * w);
      const v = Math.max(0, this.S2[b]! / (len * w * w) - m * m);
      const score = Math.abs(m - mu) * Math.sqrt(w / unit);
      const q = score / Math.max(3, 3 * Math.sqrt(v) * Math.sqrt(w / unit / len));
      ss += q * q;
      if (q > worst) worst = q;
    }
    return [worst, ss];
  }

  /** The seam check's line: the two edge lines against the others. */
  line(): number {
    const { n, len } = this;
    if (n < 4) return 0;
    let m = 0;
    for (let k = 1; k < n - 1; k++) m += this.Y[k]! / len;
    m /= n - 2;
    let v = 0;
    for (let k = 1; k < n - 1; k++) v += (this.Y[k]! / len - m) ** 2;
    const sd = Math.sqrt(v / (n - 2));
    return Math.abs((this.Y[0]! + this.Y[n - 1]!) / (2 * len) - m) / (sd + 2);
  }
}

/**
 * Place shapes without overlap (no pixel within `gap` of another shape's, Chebyshev) until they
 * cover the density's share of the box, then move them about until it is even: rows and columns
 * as the repetition check sees them, and (on a whole tile) its edges as the seam check does. Each
 * shape tries a few seeded spots and the places near it, and keeps the evenest. With wrap, the
 * shapes that cross the box's edge come from a first pass seeded by `edges` (on an even ground, so
 * they depend on edges= alone) and stay; the others come from a second pass seeded by `seed`, none
 * crossing. Returns the pixels to draw, in canvas coordinates.
 */
function placeShapes(p: Placing, under: { l: Float64Array; y: Float64Array; c: Int32Array }, L: number[], Y: number[], make: (rng: Pcg32) => Shape, stream: number): [number, number, number][] {
  const { box, wrap, gap } = p;
  const W = box.w, H = box.h;
  const target = Math.floor((p.density.num * W * H * 2 + p.density.den) / (2 * p.density.den));
  const idx = (u: number, v: number) => (wrap ? mod(v, H) * W + mod(u, W) : u < 0 || v < 0 || u >= W || v >= H ? -1 : v * W + u);
  const crosses = (at: Pt, s: Shape) => at[0] + s.w > W || at[1] + s.h > H;
  interface State { baseL: Float64Array; baseY: Float64Array; baseC: Int32Array; occ: Uint8Array; lum: Float64Array; luma: Float64Array; cls: Int32Array; rows: Evenness; cols: Evenness; covered: number }
  const stateOn = (gl: Float64Array, gy: Float64Array, gc: Int32Array): State => {
    const st: State = { baseL: gl, baseY: gy, baseC: gc, occ: new Uint8Array(W * H), lum: gl.slice(), luma: gy.slice(), cls: new Int32Array(W * H).fill(-2), rows: new Evenness(H, W), cols: new Evenness(W, H), covered: 0 };
    for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) { st.rows.add(v, u, gl[v * W + u]!, gy[v * W + u]!); st.cols.add(u, v, gl[v * W + u]!, gy[v * W + u]!); }
    for (let i = 0; i < W * H; i++) recolour(st, i, gc[i]!);
    return st;
  };
  const recolour = (st: State, i: number, c: number) => {
    const u = i % W, v = Math.floor(i / W), was = st.cls[i]!;
    if (was === c) return;
    st.rows.recolour(v, was, c, (k) => st.cls[k * W + u]!);
    st.cols.recolour(u, was, c, (k) => st.cls[v * W + k]!);
    st.cls[i] = c;
  };
  const put = (st: State, at: Pt, s: Shape, on: boolean) => {
    for (const [x, y, c] of s.px) {
      const i = idx(at[0] + x, at[1] + y);
      if (i < 0) continue;
      const toL = on ? L[c]! : st.baseL[i]!, toY = on ? Y[c]! : st.baseY[i]!;
      const dl = toL - st.lum[i]!, dy = toY - st.luma[i]!;
      st.lum[i] = toL;
      st.luma[i] = toY;
      const u = i % W, v = Math.floor(i / W);
      st.rows.add(v, u, dl, dy);
      st.cols.add(u, v, dl, dy);
      st.occ[i] = on ? 1 : 0;
      st.covered += on ? 1 : -1;
      recolour(st, i, on ? c : st.baseC[i]!);
    }
  };
  const fits = (st: State, at: Pt, s: Shape) => {
    for (const [x, y] of s.px) for (let dy = -gap; dy <= gap; dy++) for (let dx = -gap; dx <= gap; dx++) {
      const i = idx(at[0] + x + dx, at[1] + y + dy);
      if (i >= 0 && st.occ[i]) return false;
    }
    return true;
  };
  /** How uneven the box is: [the worst of the bands and the edge lines (a seam under 0.8 counts as 0), the sum of squares]. */
  const unevenness = (st: State): [number, number] => {
    const r = st.rows.bands(), c = st.cols.bands();
    const seam = wrap ? Math.max(st.rows.line(), st.cols.line(), st.rows.jump(), st.cols.jump()) / 0.8 : 0;
    return [Math.max(r[0], c[0], seam), r[1] + c[1] + seam * seam];
  };
  const cost = (st: State, at: Pt, s: Shape): [number, number] => {
    put(st, at, s, true);
    const e = unevenness(st);
    put(st, at, s, false);
    return e;
  };
  const better = (a: [number, number], b: [number, number]) => a[0] < b[0] - 1e-9 || (a[0] <= b[0] + 1e-9 && a[1] < b[1] - 1e-9);
  const pass = (seed: number, keepCrossing: boolean, st: State, attempt = 0) => {
    const rng = new Pcg32(seed, stream + (keepCrossing ? 0 : 16) + 32 * attempt);
    const allowed = (at: Pt, s: Shape): Pt | null => {
      if (wrap) { const q: Pt = [mod(at[0], W), mod(at[1], H)]; return !keepCrossing && crosses(q, s) ? null : q; }
      return at[0] < 0 || at[1] < 0 || at[0] + s.w > W || at[1] + s.h > H ? null : at;
    };
    const spot = (s: Shape): Pt | null => allowed(wrap ? [rng.nextInt(W), rng.nextInt(H)] : [rng.nextInt(W - s.w + 1), rng.nextInt(H - s.h + 1)], s);
    const placed: { at: Pt; s: Shape }[] = [];
    // Lay them, each at the evenest of a few spots (by the sum of squares: early on any spot makes some band the worst).
    for (let tries = 0; st.covered < target && tries < 64 + 3 * target; tries++) {
      const s = make(rng);
      if (s.w > W || s.h > H) continue;
      let best: Pt | null = null, bestCost = Infinity;
      for (let k = 0; k < 8; k++) {
        const at = spot(s);
        if (!at || !fits(st, at, s)) continue;
        const e = cost(st, at, s)[1];
        if (e < bestCost) { bestCost = e; best = at; }
      }
      if (!best) continue;
      put(st, best, s, true);
      placed.push({ at: best, s });
    }
    // Then even them out: each in turn moves to whichever of a few spots and the places around it
    // makes the worst band (or edge) least bad, until a round moves none, or the box is even enough
    // (a worst band at 0.8 of its limit: going further would draw every seed to the same few spots).
    const ENOUGH = 0.8;
    const settle = () => {
      for (let round = 0; round < 8; round++) {
        let moved = false;
        for (const q of placed) {
          if (unevenness(st)[0] <= ENOUGH) return;
          put(st, q.at, q.s, false);
          let best = q.at, bestCost = cost(st, q.at, q.s);
          const tries: (Pt | null)[] = [];
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dx || dy) tries.push(allowed([q.at[0] + dx, q.at[1] + dy], q.s));
          for (let k = 0; k < 8; k++) tries.push(spot(q.s));
          for (const at of tries) {
            if (!at || !fits(st, at, q.s)) continue;
            const e = cost(st, at, q.s);
            if (better(e, bestCost)) { bestCost = e; best = at; }
          }
          // Another of its tones, where it stands, if that is evener.
          let shape = q.s;
          for (const alt of q.s.alts ?? []) {
            if (alt === q.s) continue;
            const e = cost(st, best, alt);
            if (better(e, bestCost)) { bestCost = e; shape = alt; }
          }
          if (best !== q.at || shape !== q.s) moved = true;
          q.at = best;
          q.s = shape;
          put(st, q.at, q.s, true);
        }
        if (!moved) break;
      }
    };
    settle();
    // Still uneven somewhere (a small box has few shapes to move): one more shape where it helps
    // most, a few times over (up to a quarter more than the density asks).
    for (let extra = 0; extra < 8 && st.covered < target + (target >> 2) && unevenness(st)[0] > ENOUGH; extra++) {
      const s = make(rng);
      const now = unevenness(st);
      let best: Pt | null = null, bestCost = now;
      const all = W * H <= 1024;
      for (let k = 0; k < (all ? W * H : 64); k++) {
        const at = all ? allowed([k % W, Math.floor(k / W)], s) : spot(s);
        if (!at || !fits(st, at, s)) continue;
        const e = cost(st, at, s);
        if (better(e, bestCost)) { bestCost = e; best = at; }
      }
      if (!best) continue;
      put(st, best, s, true);
      placed.push({ at: best, s });
      settle();
    }
    return { placed, cost: unevenness(st) };
  };
  // A small box has few shapes to move about: a few attempts (each from the seed), the evenest kept.
  const attempts = W * H <= 400 ? 4 : W * H <= 1024 ? 3 : 2;
  const best = (seed: number, keepCrossing: boolean, start: () => State) => {
    let out = pass(seed, keepCrossing, start());
    for (let k = 1; k < attempts && out.cost[0] > 0.8; k++) {
      const o = pass(seed, keepCrossing, start(), k);
      if (better(o.cost, out.cost)) out = o;
    }
    return out.placed;
  };
  let shapes: { at: Pt; s: Shape }[];
  if (!wrap) shapes = best(p.seed, true, () => stateOn(under.l, under.y, under.c));
  else {
    // The shapes across the edges, from edges=, laid on an even ground of one colour (so they
    // depend on edges= alone: every look drawn with the same edges= has them); the rest from seed=.
    const ml = under.l.reduce((a, b) => a + b, 0) / (W * H), my = under.y.reduce((a, b) => a + b, 0) / (W * H);
    const edge = best(p.edges, true, () => stateOn(new Float64Array(W * H).fill(ml), new Float64Array(W * H).fill(my), new Int32Array(W * H).fill(-1))).filter(({ at, s }) => crosses(at, s));
    shapes = [...edge, ...best(p.seed, false, () => {
      const st = stateOn(under.l, under.y, under.c);
      for (const { at, s } of edge) put(st, at, s, true);
      return st;
    })];
  }
  const out: [number, number, number][] = [];
  const mine = new Map<number, number>();
  for (const { at, s } of shapes) for (const [x, y, c] of s.px) {
    const i = idx(at[0] + x, at[1] + y);
    if (i >= 0) mine.set(i, c);
  }
  // Ground of a shape's own colour right beside it (a speck of the noise under it) would join the
  // shape and change its outline: it takes the box's commonest colour instead.
  const counts = new Map<number, number>();
  for (const c of under.c) counts.set(c, (counts.get(c) ?? 0) + 1);
  const ground = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? -1;
  const clear = new Set<number>();
  for (const [i, c] of mine) {
    if (c === ground || ground < 0) continue;
    const u = i % W, v = Math.floor(i / W);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const j = idx(u + dx, v + dy);
      if (j >= 0 && !mine.has(j) && under.c[j] === c) clear.add(j);
    }
  }
  for (const j of [...clear].sort((a, b) => a - b)) out.push([box.x + (j % W), box.y + Math.floor(j / W), ground]);
  for (const [i, c] of mine) out.push([box.x + (i % W), box.y + Math.floor(i / W), c]);
  return out;
}

/** The lightness (L*) and luma of what is in the box now, and of every palette entry: what placing evens out. */
function lightness(doc: Doc, by: string, box: Box): { under: { l: Float64Array; y: Float64Array; c: Int32Array }; L: number[]; Y: number[] } {
  const L = doc.palette.entries.map((e) => lstar(e.hex));
  const Y = doc.palette.entries.map((e) => luma601(e.hex));
  const flat = flatten(doc, ctxOf(doc, by).frame);
  const l = new Float64Array(box.w * box.h), y = new Float64Array(box.w * box.h), cl = new Int32Array(box.w * box.h);
  for (let v = 0; v < box.h; v++) for (let u = 0; u < box.w; u++) {
    const X = box.x + u, Yp = box.y + v;
    const c = X < doc.width && Yp < doc.height ? flat[Yp * doc.width + X]! : TRANSPARENT;
    l[v * box.w + u] = c === TRANSPARENT ? 50 : L[c]!;
    y[v * box.w + u] = c === TRANSPARENT ? 128 : Y[c]!;
    cl[v * box.w + u] = c === TRANSPARENT ? -1 : c;
  }
  return { under: { l, y, c: cl }, L, Y };
}

// --- pebbles

/** A pebble's pixels: an ellipse in a w x h box (pixel centres inside it). */
function ellipseMask(w: number, h: number): Uint8Array {
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ex = (2 * x + 1 - w) * h, ey = (2 * y + 1 - h) * w;
    if (ex * ex + ey * ey <= w * w * h * h) m[y * w + x] = 1;
  }
  return m;
}

const N8: Pt[] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

/**
 * One pebble: its body tone, a shadow side one ramp step darker (the edge pixels whose outward
 * side faces away from the light), and a lit pixel one step lighter one in from its lit edge (two
 * side by side on a pebble 8 px wide or more).
 */
export function pebbleShape(w: number, h: number, light: Pt, tone: { dark: number; body: number; lit: number }): Shape {
  const m = ellipseMask(w, h);
  const [lx, ly] = light;
  const inn = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && m[y * w + x] === 1;
  const col = new Array<number>(w * h).fill(-1);
  const facing = new Array<number>(w * h).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!m[y * w + x]) continue;
    // The edge's outward side: the sum of the directions to the pixels around it that are not stone.
    let nx = 0, ny = 0;
    for (const [dx, dy] of N8) if (!inn(x + dx, y + dy)) { nx += dx; ny += dy; }
    facing[y * w + x] = nx * lx + ny * ly;
    col[y * w + x] = facing[y * w + x]! < 0 ? tone.dark : tone.body;
  }
  // The shadow side is one pixel wide where it turns round the stone's outline: a shadow pixel
  // that only joins the side above or below it and one beside it, round a corner of the outline,
  // is a doubled corner (the side steps diagonally there instead) and takes the body tone.
  const dark = (x: number, y: number) => inn(x, y) && col[y * w + x] === tone.dark;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!dark(x, y)) continue;
    const hs = [-1, 1].filter((d) => dark(x + d, y)), vs = [-1, 1].filter((d) => dark(x, y + d));
    if (hs.length === 1 && vs.length === 1 && !inn(x + hs[0]!, y + vs[0]!)) col[y * w + x] = tone.body;
  }
  // The lit pixel: the body pixel facing the light most, among those one in from the edge when the
  // pebble is big enough; ties go to the pixel nearest the middle across the light. It must sit in
  // the body (most of its sides body pixels) and leave no body pixel alone, or it would be a stray.
  const big = w >= 5 && h >= 4;
  const body = (x: number, y: number) => inn(x, y) && col[y * w + x] === tone.body;
  const cands: { k: number; s: number }[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x;
    if (col[k] !== tone.body) continue;
    if (big && N8.some(([dx, dy]) => !inn(x + dx, y + dy))) continue;
    cands.push({ k, s: 4 * (lx * (2 * x + 1 - w) + ly * (2 * y + 1 - h)) - Math.abs(ly * (2 * x + 1 - w)) - Math.abs(lx * (2 * y + 1 - h)) });
  }
  cands.sort((a, b) => b.s - a.s || a.k - b.k);
  const N4: Pt[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const ok = (ks: number[]) => {
    const was = ks.map((k) => col[k]!);
    for (const k of ks) col[k] = tone.lit;
    // A lone lit pixel must sit in the body; a pair (on small stones) holds itself together.
    let good = ks.length > 1 || ks.every((k) => {
      const x = k % w, y = Math.floor(k / w);
      const nb = N4.map(([dx, dy]) => (inn(x + dx, y + dy) ? col[(y + dy) * w + x + dx]! : -1));
      const nBody = nb.filter((v) => v === tone.body).length;
      return nBody >= 2 && nb.filter((v) => v !== tone.body && v !== tone.lit).length < nBody;
    });
    for (let y = 0; good && y < h; y++) for (let x = 0; x < w; x++) if (body(x, y) && !N4.some(([dx, dy]) => body(x + dx, y + dy))) { good = false; break; }
    if (!good) ks.forEach((k, i) => { col[k] = was[i]!; });
    return good;
  };
  const across = (k: number): number | null => {
    const bx = k % w, by = Math.floor(k / w);
    const [sx, sy]: Pt = ly !== 0 ? [lx === 0 ? 1 : -lx, 0] : [0, 1];
    return body(bx + sx, by + sy) ? (by + sy) * w + bx + sx : null;
  };
  let done = false;
  for (const { k } of cands) {
    if (!ok([k])) continue;
    done = true;
    if (w >= 8) {
      // A second lit pixel beside it, across the light.
      const k2 = across(k);
      if (k2 !== null) ok([k2]);
    }
    break;
  }
  // A small stone with no room for one: two side by side, across the light.
  for (const { k } of done ? [] : cands) {
    const k2 = across(k);
    if (k2 !== null && ok([k, k2])) break;
  }
  const px: [number, number, number][] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (col[y * w + x]! >= 0) px.push([x, y, col[y * w + x]!]);
  return { w, h, px };
}

/** A pebble's height for its width: a little flatter than round, by a seeded 0 or 1. */
export const pebbleHeight = (w: number, r: number): number => Math.max(2, Math.min(w, w - 1 - (w >> 2) + r));

const pebblesCmd: CommandSpec = {
  name: 'pebbles',
  summary: 'pebbles [<x,y> <W>x<H>] ramp=<ramp> [weights=<w,..>] [size=<a>..<b>] [density=<0..1>] [gap=<n>] [light=<dir>] [cast=<colour>|none] [wrap=on|off] [edges=<seed>] [seed=<n>]   (stones: a body tone, a shadow side and a lit pixel from the light, never overlapping)',
  normalise(cmd, ctx) {
    const doc = drawable(cmd, ctx);
    const a = new Args(cmd, ['ramp', 'weights', 'size', 'density', 'gap', 'light', 'cast', 'wrap', 'edges', 'seed']);
    const box = optBox(a, doc, 'pebbles');
    a.done();
    const ramp = rampOf(a, doc, cmd, 3);
    // A body tone needs a darker step (its shadow side) and a lighter one (its lit pixel).
    const bodies = ramp.idx.slice(1, -1);
    const wo = a.opts.get('weights');
    const weights = wo ? weightsOpt(wo, bodies.length) : bodies.map(() => 1);
    const c = cellOf(doc);
    const so = a.opts.get('size');
    const dmin = Math.max(3, Math.floor((c + 4) / 9));
    const [smin, smax] = so ? rangeOpt(so, 3, 64) : [dmin, Math.max(dmin + 1, Math.floor((2 * c + 4) / 9))];
    const dOpt = a.opts.get('density');
    const density = dOpt ? fraction(dOpt) : { num: 3, den: 10, text: '0.3' };
    const light = lightOf(a, ctx);
    const cast = colourOrNone(a, doc, 'cast', null);
    const p = placingOf(a, doc, ctx, box, density);
    const make = (rng: Pcg32): Shape => {
      const w = rng.range(smin, smax);
      const h = pebbleHeight(w, rng.nextInt(2));
      const k = pick(rng, weights);
      const tone = (t: number) => withCast(pebbleShape(w, h, light.dir, { dark: ramp.idx[t]!, body: ramp.idx[t + 1]!, lit: ramp.idx[t + 2]! }));
      // The same stone in the other tones it may take: evening out may pick one of them instead.
      const s = tone(k);
      s.alts = weights.flatMap((wt, t) => (wt > 0 ? [t === k ? s : tone(t)] : []));
      for (const a of s.alts) a.alts = s.alts;
      return s;
    };
    const withCast = (s: Shape): Shape => {
      if (cast.index === null) return s;
      // A cast shadow on the ground, away from the light, under the stone.
      const own = new Set(s.px.map(([x, y]) => `${x},${y}`));
      const [lx, ly] = light.dir;
      const shadow = s.px.map(([x, y]): [number, number, number] => [x - lx, y - ly, cast.index!]).filter(([x, y]) => !own.has(`${x},${y}`));
      const all = [...shadow, ...s.px];
      const ox = Math.min(...all.map((q) => q[0])), oy = Math.min(...all.map((q) => q[1]));
      const px = all.map(([x, y, v]): [number, number, number] => [x - ox, y - oy, v]);
      return { w: Math.max(...px.map((q) => q[0])) + 1, h: Math.max(...px.map((q) => q[1])) + 1, px };
    };
    const { under, L, Y } = lightness(doc, ctx.by, box);
    const pts = placeShapes(p, under, L, Y, make, 7);
    return {
      text: `pebbles${box.text} ramp=${ramp.text} weights=${weights.join(',')} size=${smin}..${smax} density=${density.text} light=${light.name} cast=${cast.text} ${placingText(p)}`,
      op: fn((d, by) => drawColoured(d, by, pts, false)),
    };
  },
};

// --- tufts

/**
 * One tuft: `n` blades from a row of roots, the middle one tallest and upright, the outer ones
 * shorter and leaning out. Blades on the light's side take the ramp's lightest colour, those on the
 * far side a dark step, the rest the one below the lightest; a foot (one row under the roots).
 */
export function tuftShape(n: number, height: number, short: number[], light: Pt, ramp: number[], foot: number | null): Shape {
  const lit = ramp[ramp.length - 1]!, mid = ramp[ramp.length - 2]!, shade = ramp[Math.max(0, ramp.length - 3)]!;
  const step = height >= 8 ? 2 : 1;
  const px: [number, number, number][] = [];
  for (let j = 0; j < n; j++) {
    const d = 2 * j - (n - 1); // doubled offset from the middle
    const side = Math.sign(d);
    const lean = side * Math.ceil(Math.abs(d) / 2) * step;
    const h = Math.max(3, height - Math.ceil(Math.abs(d) / 2) * Math.max(1, height >> 2) - (short[j] ?? 0));
    const c = side === 0 ? (light[1] < 0 || light[0] === 0 ? lit : mid) : light[0] === 0 ? mid : side === Math.sign(light[0]) ? lit : shade;
    for (const [x, y] of segment([j, height - 1], [j + lean, height - h])) px.push([x, y, c]);
  }
  if (foot !== null) for (let j = 0; j < n; j++) px.push([j, height, foot]);
  const ox = Math.min(...px.map((q) => q[0])), oy = Math.min(...px.map((q) => q[1]));
  const out = px.map(([x, y, c]): [number, number, number] => [x - ox, y - oy, c]);
  return { w: Math.max(...out.map((q) => q[0])) + 1, h: Math.max(...out.map((q) => q[1])) + 1, px: out };
}

const tuftsCmd: CommandSpec = {
  name: 'tufts',
  summary: 'tufts [<x,y> <W>x<H>] ramp=<ramp> [size=<a>..<b>] [blades=<a>..<b>] [density=<0..1>] [gap=<n>] [light=<dir>] [foot=<colour>|none] [wrap=on|off] [edges=<seed>] [seed=<n>]   (tufts of blades lit from the light, never overlapping)',
  normalise(cmd, ctx) {
    const doc = drawable(cmd, ctx);
    const a = new Args(cmd, ['ramp', 'size', 'blades', 'density', 'gap', 'light', 'foot', 'wrap', 'edges', 'seed']);
    const box = optBox(a, doc, 'tufts');
    a.done();
    const ramp = rampOf(a, doc, cmd, 3);
    const c = cellOf(doc);
    const so = a.opts.get('size');
    const hmin = Math.max(3, Math.floor((c + 2) / 6));
    const [smin, smax] = so ? rangeOpt(so, 3, 64) : [hmin, Math.max(hmin + 1, Math.floor((c + 2) / 4))];
    const bo = a.opts.get('blades');
    const [bmin, bmax] = bo ? rangeOpt(bo, 1, 9) : c < 20 ? [2, 3] : c < 32 ? [3, 4] : [3, 5];
    const dOpt = a.opts.get('density');
    const density = dOpt ? fraction(dOpt) : { num: 2, den: 10, text: '0.2' };
    const light = lightOf(a, ctx);
    const foot = colourOrNone(a, doc, 'foot', ramp.idx[0]!);
    const p = placingOf(a, doc, ctx, box, density);
    const { under, L, Y } = lightness(doc, ctx.by, box);
    const make = (rng: Pcg32): Shape => {
      const n = rng.range(bmin, bmax), height = rng.range(smin, smax);
      const short = Array.from({ length: n }, () => rng.nextInt(2));
      // The same tuft a pixel shorter or taller: evening out may pick one of them instead.
      const alts = [height - 1, height, height + 1].filter((h) => h >= smin && h <= smax).map((h) => tuftShape(n, h, short, light.dir, ramp.idx, foot.index));
      for (const t of alts) t.alts = alts;
      return alts[alts.length > 2 ? 1 : height > smin ? alts.length - 1 : 0]!;
    };
    const pts = placeShapes(p, under, L, Y, make, 8);
    return {
      text: `tufts${box.text} ramp=${ramp.text} size=${smin}..${smax} blades=${bmin}..${bmax} density=${density.text} light=${light.name} foot=${foot.text} ${placingText(p)}`,
      op: fn((d, by) => drawColoured(d, by, pts, false)),
    };
  },
};

registerCommand(pebblesCmd);
registerCommand(tuftsCmd);
