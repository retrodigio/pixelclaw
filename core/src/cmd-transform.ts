// Transforms of the selected pixels (or, with nothing selected, the author's whole layer): `shift`
// (with `wrap`, inside the selection's box or the canvas: how a tile's seam is moved inside),
// `flip`, `rotate`; and symmetry: `mirror ... live` mirrors every later stroke of that author
// until `mirror off`, while `mirror ... from=<side>` copies one side over the other once.

import { Args, drawable, fn, needDoc, registerCommand, type CommandSpec } from './commands.ts';
import { TRANSPARENT, ctxOf, setCtx, type Doc } from './doc.ts';
import { targetOf } from './draw.ts';
import { DiagError, type Token } from './parser.ts';
import { indexOf } from './raster.ts';

const mod = (a: number, n: number): number => ((a % n) + n) % n;

interface Region {
  mask: Uint8Array | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The author's selection and its bounding box (the whole canvas with nothing selected). */
function regionOf(d: Doc, by: string): Region {
  const sel = ctxOf(d, by).sel;
  if (!sel) return { mask: null, x: 0, y: 0, w: d.width, h: d.height };
  let x0 = d.width, y0 = d.height, x1 = -1, y1 = -1;
  for (let i = 0; i < sel.length; i++) {
    if (!sel[i]) continue;
    const x = i % d.width;
    const y = (i - x) / d.width;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { mask: sel, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Move every selected pixel (transparent ones too) of the author's layer to `to(x, y)`. The places
 * they leave become transparent; destinations wrap on wrap documents or clip. The selection moves
 * with them.
 */
function movePixels(d: Doc, by: string, to: (x: number, y: number) => [number, number]): void {
  const t = targetOf(d, by, false);
  const r = regionOf(d, by);
  const moved: [number, number, number][] = [];
  for (let i = 0; i < t.pixels.length; i++) {
    if (r.mask && !r.mask[i]) continue;
    const x = i % d.width;
    const y = (i - x) / d.width;
    moved.push([...to(x, y), t.pixels[i]!]);
    t.pixels[i] = TRANSPARENT;
  }
  const out = r.mask ? new Uint8Array(r.mask.length) : null;
  for (const [x, y, v] of moved) {
    const j = indexOf(t, x, y);
    if (j < 0) continue;
    t.pixels[j] = v;
    if (out) out[j] = 1;
  }
  if (r.mask) setCtx(d, by, { sel: out!.some((v) => v) ? out : null });
}

/** `sel` (a selection is required) and `wrap` words, wherever they are in the line. */
function words(a: Args, doc: Doc, by: string, allowWrap: boolean): { sel: boolean; wrap: boolean } {
  const sel = a.flags.find((f) => f.v === 'sel');
  const wrap = a.flags.find((f) => f.v === 'wrap');
  if (wrap && !allowWrap) throw new DiagError(wrap.line, wrap.col, `${a.cmd.name}: unexpected 'wrap'`);
  if (sel && !ctxOf(doc, by).sel) throw new DiagError(sel.line, sel.col, `${a.cmd.name} sel: nothing is selected`);
  return { sel: !!sel, wrap: !!wrap };
}

const tail = (w: { sel: boolean; wrap: boolean }) => `${w.sel ? ' sel' : ''}${w.wrap ? ' wrap' : ''}`;

const shiftCmd: CommandSpec = {
  name: 'shift',
  summary: 'shift <dx,dy> [sel] [wrap]   (moves the selected pixels, or your whole layer; wrap: around the selection\'s box or the canvas)',
  normalise(cmd, ctx) {
    const doc = drawable(cmd, ctx);
    const a = new Args(cmd, [], ['sel', 'wrap']);
    const d = a.take('point', 'an offset dx,dy');
    a.done();
    const w = words(a, doc, ctx.by, true);
    return {
      text: `shift ${d.x},${d.y}${tail(w)}`,
      op: fn((doc2, by) => {
        const r = regionOf(doc2, by);
        movePixels(doc2, by, w.wrap ? (x, y) => [r.x + mod(x - r.x + d.x, r.w), r.y + mod(y - r.y + d.y, r.h)] : (x, y) => [x + d.x, y + d.y]);
      }),
    };
  },
};

const flipCmd: CommandSpec = {
  name: 'flip',
  summary: 'flip h|v [sel]   (mirrors the selected pixels within their box, or your whole layer)',
  normalise(cmd, ctx) {
    const doc = drawable(cmd, ctx);
    const a = new Args(cmd, [], ['sel']);
    const dir = a.take('word', 'h or v');
    if (dir.v !== 'h' && dir.v !== 'v') throw new DiagError(dir.line, dir.col, `flip: expected h (left-right) or v (top-bottom)`);
    a.done();
    const w = words(a, doc, ctx.by, false);
    return {
      text: `flip ${dir.v}${tail(w)}`,
      op: fn((d, by) => {
        const r = regionOf(d, by);
        movePixels(d, by, dir.v === 'h' ? (x, y) => [2 * r.x + r.w - 1 - x, y] : (x, y) => [x, 2 * r.y + r.h - 1 - y]);
      }),
    };
  },
};

const rotateCmd: CommandSpec = {
  name: 'rotate',
  summary: 'rotate 90|180|270 [sel]   (clockwise, about the middle of the selection\'s box or the canvas)',
  normalise(cmd, ctx) {
    const doc = drawable(cmd, ctx);
    const a = new Args(cmd, [], ['sel']);
    const ang = a.take('int', '90, 180 or 270');
    if (![90, 180, 270].includes(ang.v)) throw new DiagError(ang.line, ang.col, `rotate: the angle must be 90, 180 or 270 (clockwise)`);
    a.done();
    const w = words(a, doc, ctx.by, false);
    return {
      text: `rotate ${ang.v}${tail(w)}`,
      op: fn((d, by) => {
        const r = regionOf(d, by);
        // A quarter turn swaps the box's sides, keeping its middle (rounded up and left).
        const nx = r.x + Math.floor((r.w - r.h) / 2);
        const ny = r.y + Math.floor((r.h - r.w) / 2);
        movePixels(d, by, (x, y) => {
          const u = x - r.x;
          const v = y - r.y;
          if (ang.v === 180) return [r.x + r.w - 1 - u, r.y + r.h - 1 - v];
          if (ang.v === 90) return [nx + r.h - 1 - v, ny + u];
          return [nx + v, ny + r.w - 1 - u];
        });
      }),
    };
  },
};

/** An axis position in pixels, a whole or half number (11.5 is between pixels 11 and 12), doubled. */
function axis(o: Extract<Token, { t: 'kv' }>): number {
  const m = /^(-?\d+)(\.5|\.0)?$/.exec(o.value);
  if (!m) throw new DiagError(o.line, o.vcol, `${o.key}= must be a pixel position like 12 or 11.5`);
  return 2 * Number(m[1]) + (m[2] === '.5' ? (o.value.startsWith('-') ? -1 : 1) : 0);
}
const axisText = (x2: number) => (x2 % 2 === 0 ? String(x2 / 2) : `${(x2 - 1) / 2}.5`);

const mirrorCmd: CommandSpec = {
  name: 'mirror',
  summary: 'mirror [x=<a>] [y=<b>] live   (later strokes are mirrored)  |  mirror off  |  mirror x=<a> from=left|right  or  mirror y=<b> from=top|bottom   (copies one side over the other once)',
  normalise(cmd, ctx) {
    const doc = needDoc(cmd, ctx);
    const a = new Args(cmd, ['x', 'y', 'from'], ['live', 'off']);
    a.done();
    const off = a.flags.find((f) => f.v === 'off');
    const live = a.flags.find((f) => f.v === 'live');
    const xo = a.opts.get('x');
    const yo = a.opts.get('y');
    const from = a.opts.get('from');
    if (off) {
      if (live || xo || yo || from) throw new DiagError(off.line, off.col, `mirror off takes nothing else`);
      return { text: 'mirror off', op: fn((d, by) => setCtx(d, by, { mirror: null })) };
    }
    if (live && from) throw new DiagError(from.line, from.col, `mirror: give live or from=, not both`);
    let x2 = xo ? axis(xo) : null;
    const y2 = yo ? axis(yo) : null;
    if (live) {
      if (x2 === null && y2 === null) x2 = doc.width - 1;
      const parts = [x2 !== null ? `x=${axisText(x2)}` : '', y2 !== null ? `y=${axisText(y2)}` : ''].filter(Boolean);
      return { text: `mirror ${parts.join(' ')} live`, op: fn((d, by) => setCtx(d, by, { mirror: { x2, y2 } })) };
    }
    drawable(cmd, ctx);
    if (xo && yo) throw new DiagError(yo.line, yo.col, `mirror from=: give one axis, x= or y=`);
    if (x2 === null && y2 === null) x2 = doc.width - 1;
    const horiz = x2 !== null;
    const side = from ? from.value : horiz ? 'left' : 'top';
    const sides = horiz ? ['left', 'right'] : ['top', 'bottom'];
    if (!sides.includes(side)) throw new DiagError(from!.line, from!.vcol, `from= must be ${sides.join(' or ')} for a ${horiz ? 'vertical (x=)' : 'horizontal (y=)'} axis`);
    const ax = horiz ? x2! : y2!;
    const firstSide = side === sides[0];
    return {
      text: `mirror ${horiz ? 'x' : 'y'}=${axisText(ax)} from=${side}`,
      op: fn((d, by) => {
        const t = targetOf(d, by);
        const src = t.pixels.slice();
        for (let i = 0; i < src.length; i++) {
          const x = i % d.width;
          const y = (i - x) / d.width;
          const p = horiz ? x : y;
          // Copy from the chosen side (pixels on the axis stay).
          if (firstSide ? 2 * p >= ax : 2 * p <= ax) continue;
          const j = indexOf(t, horiz ? ax - x : x, horiz ? y : ax - y);
          if (j >= 0 && (!t.mask || t.mask[j])) t.pixels[j] = src[i]!;
        }
      }),
    };
  },
};

registerCommand(shiftCmd);
registerCommand(flipCmd);
registerCommand(rotateCmd);
registerCommand(mirrorCmd);
