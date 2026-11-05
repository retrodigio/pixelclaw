// Curves and polygons, dithering, gradients and ramps. Patterns are ordered
// threshold matrices anchored to the canvas (not the box), so dithered areas on a tile line up
// across its edges.

import { Args, colourOpt, drawOp, drawable, fn, needDoc, pt, ptText, registerCommand, resolveColour, type CommandSpec } from './commands.ts';
import type { Doc } from './doc.ts';
import { drawColoured } from './draw.ts';
import { DiagError } from './parser.ts';
import { bezier, polygonPixels, rectPixels, type Pt } from './raster.ts';
import { fraction, idiv, intOpt, isqrt, rampOpt } from './values.ts';

const curveCmd: CommandSpec = {
  name: 'curve',
  summary: 'curve <x,y> <x,y> <x,y> [<x,y>] c=<colour> [pp=on|off]   (quadratic with 3 points, cubic with 4; the middle points pull the curve)',
  normalise(cmd, ctx) {
    const doc = drawable(cmd, ctx);
    const a = new Args(cmd, ['c', 'pp']);
    const cell = a.cellOrigin(doc);
    const pts: Pt[] = [];
    for (const t of a.rest()) {
      if (t.t !== 'point') throw new DiagError(t.line, t.col, `curve: expected a point x,y`);
      pts.push(pt(t));
    }
    if (pts.length < 3 || pts.length > 4) throw new DiagError(cmd.line, cmd.col, `curve: give 3 points (quadratic) or 4 (cubic): start, control point(s), end`);
    const c = colourOpt(a, doc);
    const pp = a.choice('pp', ['on', 'off'], 'on');
    const shifted = pts.map(([x, y]): Pt => [x + cell.dx, y + cell.dy]);
    return { text: `curve${cell.text} ${pts.map(ptText).join(' ')} c=${c.name} pp=${pp}`, op: drawOp(bezier(shifted, pp === 'on'), c.index) };
  },
};

const polygonCmd: CommandSpec = {
  name: 'polygon',
  summary: 'polygon <x,y> <x,y> <x,y> [...] c=<colour> [outline|fill]   (closed; fill takes pixels whose centre is inside)',
  normalise(cmd, ctx) {
    const doc = drawable(cmd, ctx);
    const a = new Args(cmd, ['c'], ['outline', 'fill']);
    const cell = a.cellOrigin(doc);
    const pts: Pt[] = [];
    for (const t of a.rest()) {
      if (t.t !== 'point') throw new DiagError(t.line, t.col, `polygon: expected a point x,y`);
      pts.push(pt(t));
    }
    if (pts.length < 3) throw new DiagError(cmd.line, cmd.col, `polygon: give at least 3 points`);
    const c = colourOpt(a, doc);
    const mode = a.flag(['outline', 'fill'], 'outline');
    const shifted = pts.map(([x, y]): Pt => [x + cell.dx, y + cell.dy]);
    return {
      text: `polygon${cell.text} ${pts.map(ptText).join(' ')} c=${c.name} ${mode}`,
      op: drawOp(polygonPixels(shifted, mode === 'fill', true), c.index, mode === 'outline'),
    };
  },
};

/** Ordered dither matrices: values 0..levels-1. */
function bayer(n: number): number[][] {
  if (n === 1) return [[0]];
  const h = bayer(n / 2);
  const out: number[][] = [];
  for (let y = 0; y < n; y++) {
    out.push([]);
    for (let x = 0; x < n; x++) {
      const q = [0, 2, 3, 1][(y >= n / 2 ? 2 : 0) + (x >= n / 2 ? 1 : 0)]!;
      out[y]!.push(4 * h[y % (n / 2)]![x % (n / 2)]! + q);
    }
  }
  return out;
}

export const PATTERNS: Record<string, number[][]> = {
  checker: [[0, 1], [1, 0]],
  bayer2: bayer(2),
  bayer4: bayer(4),
  bayer8: bayer(8),
  hlines: [[0], [1]],
  vlines: [[0, 1]],
};
const PATTERN_NAMES = Object.keys(PATTERNS);

/** True where a pattern at canvas pixel x,y shows the second colour for a share num/den. */
export function patternOn(m: number[][], x: number, y: number, num: number, den: number): boolean {
  const levels = Math.max(...m.flat()) + 1;
  const v = m[((y % m.length) + m.length) % m.length]![((x % m[0]!.length) + m[0]!.length) % m[0]!.length]!;
  return 2 * num * levels > (2 * v + 1) * den;
}

function boxArgs(a: Args, what: string): { x: number; y: number; w: number; h: number; text: string } {
  const p = a.take('point', 'a corner x,y');
  const s = a.take('size', 'a size WxH');
  if (s.w < 1 || s.h < 1) throw new DiagError(s.line, s.col, `${what}: size must be at least 1x1`);
  return { x: p.x, y: p.y, w: s.w, h: s.h, text: `${p.x},${p.y} ${s.w}x${s.h}` };
}

const ditherCmd: CommandSpec = {
  name: 'dither',
  summary: `dither <x,y> <W>x<H> a=<colour> b=<colour> [pattern=${PATTERN_NAMES.join('|')}] [level=<0..1>]   (b covers the share 'level' of the box)`,
  normalise(cmd, ctx) {
    const doc = drawable(cmd, ctx);
    const a = new Args(cmd, ['a', 'b', 'pattern', 'level']);
    const cell = a.cellOrigin(doc);
    const box = boxArgs(a, 'dither');
    a.done();
    const col = (k: 'a' | 'b') => {
      const o = a.opts.get(k);
      if (!o) throw new DiagError(cmd.line, cmd.col, `dither: missing ${k}=<colour>`);
      return resolveColour(o.value, doc.palette, o.line, o.vcol);
    };
    const ca = col('a');
    const cb = col('b');
    const pattern = a.choice('pattern', PATTERN_NAMES, 'bayer4');
    const lo = a.opts.get('level');
    const level = lo ? fraction(lo) : { num: 1, den: 2, text: '0.5' };
    const m = PATTERNS[pattern]!;
    const pts: [number, number, number][] = rectPixels(box.x + cell.dx, box.y + cell.dy, box.w, box.h, true)
      .map(([x, y]) => [x, y, patternOn(m, x, y, level.num, level.den) ? cb.index : ca.index]);
    return {
      text: `dither${cell.text} ${box.text} a=${ca.name} b=${cb.name} pattern=${pattern} level=${level.text}`,
      op: fn((d, by) => drawColoured(d, by, pts, false)),
    };
  },
};

const DIRS = ['down', 'up', 'right', 'left', 'radial'];

const gradientCmd: CommandSpec = {
  name: 'gradient',
  summary: `gradient <x,y> <W>x<H> ramp=<ramp|a,b,c> [dir=${DIRS.join('|')}] [steps=<n>] [pattern=none|${PATTERN_NAMES.join('|')}]   (banded, or dithered between bands)`,
  normalise(cmd, ctx) {
    const doc = drawable(cmd, ctx);
    const a = new Args(cmd, ['ramp', 'dir', 'steps', 'pattern']);
    const cell = a.cellOrigin(doc);
    const box = boxArgs(a, 'gradient');
    a.done();
    const ro = a.opts.get('ramp');
    if (!ro) throw new DiagError(cmd.line, cmd.col, `gradient: missing ramp=<ramp> (a palette ramp, or entries a,b,c)`);
    const ramp = rampOpt(ro, doc.palette);
    const dir = a.choice('dir', DIRS, 'down');
    const so = a.opts.get('steps');
    const steps = so ? intOpt(so, 2, ramp.idx.length) : ramp.idx.length;
    if (steps < 2) throw new DiagError(ro.line, ro.vcol, `gradient: the ramp needs at least 2 colours`);
    const pattern = a.choice('pattern', ['none', ...PATTERN_NAMES], 'none');
    // The colours used: `steps` of the ramp, spread evenly from its first to its last.
    const cols = Array.from({ length: steps }, (_, k) => ramp.idx[idiv(2 * k * (ramp.idx.length - 1) + (steps - 1), 2 * (steps - 1))]!);
    const m = pattern === 'none' ? null : PATTERNS[pattern]!;
    const x0 = box.x + cell.dx;
    const y0 = box.y + cell.dy;
    // Position along the gradient as p / len, 0 at the start, 1 at the end.
    const cx2 = 2 * x0 + box.w - 1;
    const cy2 = 2 * y0 + box.h - 1;
    const maxR2 = (box.w - 1) ** 2 + (box.h - 1) ** 2;
    const along = (x: number, y: number): [number, number] => {
      switch (dir) {
        case 'down': return [y - y0, box.h - 1];
        case 'up': return [y0 + box.h - 1 - y, box.h - 1];
        case 'right': return [x - x0, box.w - 1];
        case 'left': return [x0 + box.w - 1 - x, box.w - 1];
        default: return [isqrt(4 * ((2 * x - cx2) ** 2 + (2 * y - cy2) ** 2)), isqrt(4 * maxR2) || 1];
      }
    };
    const pts: [number, number, number][] = rectPixels(x0, y0, box.w, box.h, true).map(([x, y]) => {
      const [p, len] = along(x, y);
      if (len <= 0) return [x, y, cols[0]!];
      // u = p * (steps - 1) / len: a band and how far into the next one.
      const num = p * (steps - 1);
      const band = Math.min(steps - 1, idiv(num, len));
      const rest = num - band * len;
      if (band === steps - 1) return [x, y, cols[band]!];
      const next = m ? patternOn(m, x, y, rest, len) : 2 * rest >= len;
      return [x, y, cols[next ? band + 1 : band]!];
    });
    return {
      text: `gradient${cell.text} ${box.text} ramp=${ramp.text} dir=${dir} steps=${steps} pattern=${pattern}`,
      op: fn((d, by) => drawColoured(d, by, pts, false)),
    };
  },
};

const rampCmd: CommandSpec = {
  name: 'ramp',
  summary: 'ramp <name> = <entry> <entry> ...   (defines or replaces a ramp of this document\'s palette, darkest first)',
  normalise(cmd, ctx) {
    const doc = needDoc(cmd, ctx);
    const a = new Args(cmd, []);
    const name = a.take('word', 'a ramp name');
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name.v)) throw new DiagError(name.line, name.col, `'${name.v}' is not a usable ramp name`);
    const eq = a.take('word', "'='");
    if (eq.v !== '=') throw new DiagError(eq.line, eq.col, `ramp: expected '=' after the name`);
    const members: string[] = [];
    for (const t of a.rest()) {
      const v = t.t === 'word' ? t.v : t.t === 'int' ? String(t.v) : null;
      if (v === null) throw new DiagError(t.line, t.col, `ramp: expected an entry name or key`);
      members.push(resolveColour(v, doc.palette, t.line, t.col).name);
      if (members.at(-1) === 'none') throw new DiagError(t.line, t.col, `ramp: 'none' cannot be in a ramp`);
    }
    if (members.length < 2) throw new DiagError(cmd.line, cmd.col, `ramp: give at least 2 entries, darkest first`);
    if (doc.paletteLocked) throw new DiagError(cmd.line, cmd.col, `palette '${doc.palette.name}' is locked (palette unlock to change its ramps)`);
    return {
      text: `ramp ${name.v} = ${members.join(' ')}`,
      op: fn((d: Doc) => { d.palette = { ...d.palette, ramps: { ...d.palette.ramps, [name.v]: members } }; }),
    };
  },
};

registerCommand(curveCmd);
registerCommand(polygonCmd);
registerCommand(ditherCmd);
registerCommand(gradientCmd);
registerCommand(rampCmd);
