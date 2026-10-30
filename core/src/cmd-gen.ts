// Texture generators (plan §3.4): seeded clustered `noise` on a ramp, `scatter` of stamps (or
// single pixels) with a minimum spacing, `voronoi` stones and `bricks`. Every one takes seed=; when
// it is left out the normaliser picks one and writes it into the line. With wrap=on (the default
// on wrap documents) a generator works on the box as a torus, so the texture tiles by construction.

import { Args, drawable, fn, registerCommand, resolveColour, type CommandSpec, type NormaliseContext } from './commands.ts';
import { TRANSPARENT, type Doc } from './doc.ts';
import { drawColoured } from './draw.ts';
import { DiagError, type ParsedCommand } from './parser.ts';
import { Pcg32 } from './pcg.ts';
import { fraction, intOpt, isqrt, rampOpt, rangeOpt, weightsOpt, type Ramp } from './values.ts';

export const mod = (a: number, n: number): number => ((a % n) + n) % n;

export interface Box { x: number; y: number; w: number; h: number; text: string }

/** An optional box (default: the whole canvas), offset by @cell. */
export function optBox(a: Args, doc: Doc, cmdName: string): Box {
  const cell = a.cellOrigin(doc);
  if (a.peek()?.t !== 'point') {
    if (a.cell) return { x: cell.dx, y: cell.dy, w: doc.cellW, h: doc.cellH, text: `${cell.text} 0,0 ${doc.cellW}x${doc.cellH}` };
    return { x: 0, y: 0, w: doc.width, h: doc.height, text: ` 0,0 ${doc.width}x${doc.height}` };
  }
  const p = a.take('point', 'a corner x,y');
  const s = a.take('size', 'a size WxH');
  if (s.w < 1 || s.h < 1) throw new DiagError(s.line, s.col, `${cmdName}: size must be at least 1x1`);
  return { x: p.x + cell.dx, y: p.y + cell.dy, w: s.w, h: s.h, text: `${cell.text} ${p.x},${p.y} ${s.w}x${s.h}` };
}

export function seedOf(a: Args, ctx: NormaliseContext): number {
  const o = a.opts.get('seed');
  return o ? intOpt(o, 0, 0x7fffffff) : ctx.newSeed();
}

export function wrapOpt(a: Args, doc: Doc): boolean {
  return a.choice('wrap', ['on', 'off'], doc.wrap ? 'on' : 'off') === 'on';
}

/** Pick an index by weight. */
export function pick(rng: Pcg32, weights: number[]): number {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rng.nextInt(total);
  for (let i = 0; i < weights.length; i++) {
    if (r < weights[i]!) return i;
    r -= weights[i]!;
  }
  return weights.length - 1;
}

export function rampAndWeights(a: Args, doc: Doc, cmd: ParsedCommand): { ramp: Ramp; weights: number[] } {
  const ro = a.opts.get('ramp');
  if (!ro) throw new DiagError(cmd.line, cmd.col, `${cmd.name}: missing ramp=<ramp> (a palette ramp, or entries a,b,c)`);
  const ramp = rampOpt(ro, doc.palette);
  const wo = a.opts.get('weights');
  const weights = wo ? weightsOpt(wo, ramp.idx.length) : ramp.idx.map(() => 1);
  return { ramp, weights };
}

/** A place in the box: wrapped around it (as a torus) or null when it falls outside. */
export function placer(b: Box, wrap: boolean) {
  return (u: number, v: number): [number, number] | null => {
    if (wrap) return [b.x + mod(u, b.w), b.y + mod(v, b.h)];
    return u < 0 || v < 0 || u >= b.w || v >= b.h ? null : [b.x + u, b.y + v];
  };
}

const noiseCmd: CommandSpec = {
  name: 'noise',
  summary: 'noise [<x,y> <W>x<H>] ramp=<ramp> [weights=<w,w,..>] [cluster=<a>..<b>] [density=<0..1>] [base=<entry>|keep] [wrap=on|off] [seed=<n>]   (clustered specks on a ramp)',
  normalise(cmd, ctx) {
    const doc = drawable(cmd, ctx);
    const a = new Args(cmd, ['ramp', 'weights', 'cluster', 'density', 'base', 'wrap', 'seed']);
    const box = optBox(a, doc, 'noise');
    a.done();
    const { ramp, weights } = rampAndWeights(a, doc, cmd);
    const co = a.opts.get('cluster');
    // Specks scale with the cell (G14): 1..3 px up to 47 px cells, 2..6 at 48, and so on.
    const k = Math.max(1, Math.floor(doc.cellW / 24));
    const [cmin, cmax] = co ? rangeOpt(co, 1, 64) : [k, 3 * k];
    const dOpt = a.opts.get('density');
    const density = dOpt ? fraction(dOpt) : { num: 15, den: 100, text: '0.15' };
    const bo = a.opts.get('base');
    // The base colour fills the box first: by default the heaviest-weighted entry.
    let base: number | null = ramp.idx[weights.indexOf(Math.max(...weights))]!;
    let baseText = doc.palette.entries[base]!.name;
    if (bo && bo.value === 'keep') { base = null; baseText = 'keep'; }
    else if (bo) {
      const c = resolveColour(bo.value, doc.palette, bo.line, bo.vcol);
      base = c.index;
      baseText = c.name;
    }
    const wrap = wrapOpt(a, doc);
    const seed = seedOf(a, ctx);
    // Specks take the other colours (all of them on base=keep), by weight.
    const speck = ramp.idx.map((c, i) => (c === base ? 0 : weights[i]!));
    if (speck.every((w) => w === 0)) throw new DiagError(cmd.line, cmd.col, `noise: the ramp has no colour other than the base to scatter (check weights=)`);
    const pts: [number, number, number][] = [];
    if (base !== null) for (let v = 0; v < box.h; v++) for (let u = 0; u < box.w; u++) pts.push([box.x + u, box.y + v, base]);
    const rng = new Pcg32(seed, 1);
    const place = placer(box, wrap);
    const target = Math.floor((density.num * box.w * box.h * 2 + density.den) / (2 * density.den));
    const covered = new Uint8Array(box.w * box.h);
    let placed = 0;
    for (let tries = 0; placed < target && tries < target * 4 + 16; tries++) {
      const size = rng.range(cmin, cmax);
      const colour = ramp.idx[pick(rng, speck)]!;
      const cells: [number, number][] = [[rng.nextInt(box.w), rng.nextInt(box.h)]];
      const key = (u: number, v: number) => `${mod(u, box.w)},${mod(v, box.h)}`;
      const has = new Set([key(...cells[0]!)]);
      for (let g = 0; cells.length < size && g < size * 8; g++) {
        const [cu, cv] = cells[rng.nextInt(cells.length)]!;
        const [du, dv] = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const)[rng.nextInt(4)]!;
        const nu = cu + du;
        const nv = cv + dv;
        if (!place(nu, nv) || has.has(key(nu, nv))) continue;
        has.add(key(nu, nv));
        cells.push([nu, nv]);
      }
      for (const [u, v] of cells) {
        const p = place(u, v);
        if (!p) continue;
        pts.push([p[0], p[1], colour]);
        const k = (p[1] - box.y) * box.w + (p[0] - box.x);
        if (!covered[k]) { covered[k] = 1; placed++; }
      }
    }
    return {
      text: `noise${box.text} ramp=${ramp.text} weights=${weights.join(',')} cluster=${cmin}..${cmax} density=${density.text} base=${baseText} wrap=${wrap ? 'on' : 'off'} seed=${seed}`,
      op: fn((d, by) => drawColoured(d, by, pts, false)),
    };
  },
};

const scatterCmd: CommandSpec = {
  name: 'scatter',
  summary: 'scatter [<x,y> <W>x<H>] stamp=<name>[,<name>..]|c=<colour> count=<n> [minDist=<n>] [flip=on|off] [wrap=on|off] [seed=<n>]   (places stamps by their middle, at least minDist apart)',
  normalise(cmd, ctx) {
    const doc = drawable(cmd, ctx);
    const a = new Args(cmd, ['stamp', 'c', 'count', 'minDist', 'flip', 'wrap', 'seed']);
    const box = optBox(a, doc, 'scatter');
    a.done();
    const so = a.opts.get('stamp');
    const co = a.opts.get('c');
    if (!!so === !!co) throw new DiagError(cmd.line, cmd.col, `scatter: give stamp=<name> or c=<colour> (one of them)`);
    let what: string;
    let shapes: { w: number; h: number; px: Uint16Array }[];
    if (so) {
      const names = so.value.split(',');
      shapes = names.map((n) => {
        const s = doc.stamps[n];
        if (!s) throw new DiagError(so.line, so.vcol, `no stamp '${n}' (stamps: ${Object.keys(doc.stamps).join(', ') || 'none; make one with stamp save'})`);
        return s;
      });
      what = `stamp=${names.join(',')}`;
    } else {
      const c = resolveColour(co!.value, doc.palette, co!.line, co!.vcol);
      shapes = [{ w: 1, h: 1, px: Uint16Array.of(c.index) }];
      what = `c=${c.name}`;
    }
    const cto = a.opts.get('count');
    if (!cto) throw new DiagError(cmd.line, cmd.col, `scatter: missing count=<n>`);
    const count = intOpt(cto, 1, 10000);
    const mo = a.opts.get('minDist');
    const minDist = mo ? intOpt(mo, 0, 4096) : 0;
    const flip = a.choice('flip', ['on', 'off'], 'off') === 'on';
    const wrap = wrapOpt(a, doc);
    const seed = seedOf(a, ctx);
    const rng = new Pcg32(seed, 2);
    const spots: [number, number][] = [];
    const d2 = (p: [number, number], q: [number, number]) => {
      let dx = Math.abs(p[0] - q[0]);
      let dy = Math.abs(p[1] - q[1]);
      if (wrap) { dx = Math.min(dx, box.w - dx); dy = Math.min(dy, box.h - dy); }
      return dx * dx + dy * dy;
    };
    for (let tries = 0; spots.length < count && tries < count * 30; tries++) {
      const p: [number, number] = [rng.nextInt(box.w), rng.nextInt(box.h)];
      if (spots.some((q) => d2(p, q) < minDist * minDist)) continue;
      spots.push(p);
    }
    const place = placer(box, wrap);
    const pts: [number, number, number][] = [];
    for (const [u, v] of spots) {
      const s = shapes[rng.nextInt(shapes.length)]!;
      const mirror = flip && rng.nextInt(2) === 1;
      for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++) {
        const c = s.px[j * s.w + (mirror ? s.w - 1 - i : i)]!;
        if (c === TRANSPARENT) continue;
        const p = place(u - (s.w >> 1) + i, v - (s.h >> 1) + j);
        if (p) pts.push([p[0], p[1], c]);
      }
    }
    return {
      text: `scatter${box.text} ${what} count=${count} minDist=${minDist} flip=${flip ? 'on' : 'off'} wrap=${wrap ? 'on' : 'off'} seed=${seed}`,
      op: fn((d, by) => drawColoured(d, by, pts, false)),
    };
  },
};

/** The colour for a gap (mortar), or null for none (leave those pixels as they are). */
function gapOpt(a: Args, doc: Doc): { index: number | null; text: string } {
  const o = a.opts.get('gap');
  if (!o) return { index: null, text: 'none' };
  if (o.value === 'none') return { index: null, text: 'none' };
  const c = resolveColour(o.value, doc.palette, o.line, o.vcol);
  return { index: c.index, text: c.name };
}

const voronoiCmd: CommandSpec = {
  name: 'voronoi',
  summary: 'voronoi [<x,y> <W>x<H>] cells=<n> ramp=<ramp> [weights=<w,..>] [gap=<colour>|none] [relax=<n>] [wrap=on|off] [seed=<n>]   (stones: cells of the nearest point, each a ramp colour, 1-px gaps)',
  normalise(cmd, ctx) {
    const doc = drawable(cmd, ctx);
    const a = new Args(cmd, ['cells', 'ramp', 'weights', 'gap', 'relax', 'wrap', 'seed']);
    const box = optBox(a, doc, 'voronoi');
    a.done();
    const { ramp, weights } = rampAndWeights(a, doc, cmd);
    const no = a.opts.get('cells');
    if (!no) throw new DiagError(cmd.line, cmd.col, `voronoi: missing cells=<n>`);
    const cells = intOpt(no, 1, Math.max(1, Math.min(4096, box.w * box.h)));
    const gap = gapOpt(a, doc);
    const ro = a.opts.get('relax');
    const relax = ro ? intOpt(ro, 0, 8) : 1;
    const wrap = wrapOpt(a, doc);
    const seed = seedOf(a, ctx);
    const rng = new Pcg32(seed, 3);
    // Points spread out: a candidate closer than about 0.6 of the mean spacing to another is skipped.
    const minD = isqrt(Math.floor((box.w * box.h * 36) / (100 * cells)));
    const delta = (p: number, q: number, n: number) => {
      const d = q - p;
      if (!wrap) return d;
      const m = mod(d, n);
      return m * 2 > n ? m - n : m;
    };
    const dist2 = (u: number, v: number, p: [number, number]) => {
      const dx = delta(p[0], u, box.w);
      const dy = delta(p[1], v, box.h);
      return dx * dx + dy * dy;
    };
    let pts: [number, number][] = [];
    for (let tries = 0; pts.length < cells && tries < cells * 50; tries++) {
      const p: [number, number] = [rng.nextInt(box.w), rng.nextInt(box.h)];
      if (tries < cells * 40 && pts.some((q) => dist2(p[0], p[1], q) < minD * minD)) continue;
      pts.push(p);
    }
    const owner = new Int32Array(box.w * box.h);
    const assign = () => {
      for (let v = 0; v < box.h; v++) for (let u = 0; u < box.w; u++) {
        let best = 0;
        let bd = Infinity;
        pts.forEach((p, k) => { const dd = dist2(u, v, p); if (dd < bd) { bd = dd; best = k; } });
        owner[v * box.w + u] = best;
      }
    };
    assign();
    for (let r = 0; r < relax; r++) {
      // Lloyd: move each point to its cell's centroid (offsets measured from the point, wrapped).
      const sx = new Array(pts.length).fill(0);
      const sy = new Array(pts.length).fill(0);
      const n = new Array(pts.length).fill(0);
      for (let v = 0; v < box.h; v++) for (let u = 0; u < box.w; u++) {
        const k = owner[v * box.w + u]!;
        sx[k] += delta(pts[k]![0], u, box.w);
        sy[k] += delta(pts[k]![1], v, box.h);
        n[k]++;
      }
      pts = pts.map((p, k) => {
        if (!n[k]) return p;
        const nx = p[0] + Math.floor((2 * sx[k] + n[k]) / (2 * n[k]));
        const ny = p[1] + Math.floor((2 * sy[k] + n[k]) / (2 * n[k]));
        return wrap ? [mod(nx, box.w), mod(ny, box.h)] : [Math.max(0, Math.min(box.w - 1, nx)), Math.max(0, Math.min(box.h - 1, ny))];
      });
      assign();
    }
    const colour = pts.map(() => ramp.idx[pick(rng, weights)]!);
    const place = placer(box, wrap);
    const out: [number, number, number][] = [];
    for (let v = 0; v < box.h; v++) for (let u = 0; u < box.w; u++) {
      const k = owner[v * box.w + u]!;
      // A gap pixel borders a cell with a lower number: the gaps are one pixel wide.
      let edge = false;
      if (gap.index !== null) {
        for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const q = place(u + du, v + dv);
          if (q && owner[(q[1] - box.y) * box.w + (q[0] - box.x)]! < k) { edge = true; break; }
        }
      }
      out.push([box.x + u, box.y + v, edge ? gap.index! : colour[k]!]);
    }
    return {
      text: `voronoi${box.text} cells=${cells} ramp=${ramp.text} weights=${weights.join(',')} gap=${gap.text} relax=${relax} wrap=${wrap ? 'on' : 'off'} seed=${seed}`,
      op: fn((d, by) => drawColoured(d, by, out, false)),
    };
  },
};

const bricksCmd: CommandSpec = {
  name: 'bricks',
  summary: 'bricks [<x,y> <W>x<H>] size=<W>x<H> ramp=<ramp> [weights=<w,..>] [gap=<colour>|none] [offset=<n>] [seed=<n>]   (courses of bricks with 1-px joints; every other course shifted)',
  normalise(cmd, ctx) {
    const doc = drawable(cmd, ctx);
    const a = new Args(cmd, ['size', 'ramp', 'weights', 'gap', 'offset', 'seed']);
    const box = optBox(a, doc, 'bricks');
    a.done();
    const so = a.opts.get('size');
    const m = so ? /^(\d+)x(\d+)$/.exec(so.value) : null;
    if (!so || !m || Number(m[1]) < 2 || Number(m[2]) < 2) throw new DiagError(so?.line ?? cmd.line, so?.vcol ?? cmd.col, `bricks: size= must be a brick size like 8x4 (joints included), at least 2x2`);
    const bw = Number(m[1]);
    const bh = Number(m[2]);
    const { ramp, weights } = rampAndWeights(a, doc, cmd);
    const gap = gapOpt(a, doc);
    const oo = a.opts.get('offset');
    const offset = oo ? intOpt(oo, 0, bw - 1) : bw >> 1;
    const seed = seedOf(a, ctx);
    const rng = new Pcg32(seed, 4);
    const rows = Math.ceil(box.h / bh);
    const cols = Math.ceil(box.w / bw) + 1;
    const colour = Array.from({ length: rows * cols }, () => ramp.idx[pick(rng, weights)]!);
    const out: [number, number, number][] = [];
    for (let v = 0; v < box.h; v++) for (let u = 0; u < box.w; u++) {
      const row = Math.floor(v / bh);
      const su = u + (row % 2 ? offset : 0);
      // A box a whole number of bricks wide repeats seamlessly: the brick past its right edge is the first one.
      const col = box.w % bw === 0 ? Math.floor(su / bw) % (box.w / bw) : Math.floor(su / bw);
      const joint = v % bh === bh - 1 || su % bw === bw - 1;
      if (joint && gap.index === null) continue;
      out.push([box.x + u, box.y + v, joint ? gap.index! : colour[row * cols + col]!]);
    }
    return {
      text: `bricks${box.text} size=${bw}x${bh} ramp=${ramp.text} weights=${weights.join(',')} gap=${gap.text} offset=${offset} seed=${seed}`,
      op: fn((d, by) => drawColoured(d, by, out, false)),
    };
  },
};

registerCommand(noiseCmd);
registerCommand(scatterCmd);
registerCommand(voronoiCmd);
registerCommand(bricksCmd);
