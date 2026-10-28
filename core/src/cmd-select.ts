// Selections (plan §3.2): rectangle, ellipse, lasso polygon, magic wand (contiguous or global, by
// palette index), by colour, by a layer's opaque pixels, all, none and invert. Each author has
// their own selection, and it clips every drawing command that author writes until `deselect`.
// A trailing `add`, `sub` or `and` combines the new shape with the current selection.

import { Args, drawable, fn, needDoc, pt, ptText, registerCommand, resolveColour, type CommandSpec } from './commands.ts';
import { TRANSPARENT, ctxOf, setCtx, type Doc } from './doc.ts';
import { targetOf } from './draw.ts';
import { DiagError } from './parser.ts';
import { ellipsePixels, indexOf, polygonPixels, rectPixels, type Pt } from './raster.ts';

type Combine = 'replace' | 'add' | 'sub' | 'and';
const COMBINE = ['add', 'sub', 'and'];

function maskOf(doc: Doc, pts: Pt[]): Uint8Array {
  const t = { width: doc.width, height: doc.height, wrap: doc.wrap, pixels: new Uint16Array(0) };
  const m = new Uint8Array(doc.width * doc.height);
  for (const [x, y] of pts) {
    const i = indexOf(t, x, y);
    if (i >= 0) m[i] = 1;
  }
  return m;
}

/** The author's selection combined with a new mask; an empty result is no selection. */
function combine(cur: Uint8Array | null, m: Uint8Array, how: Combine): Uint8Array | null {
  let out: Uint8Array;
  if (how === 'replace') out = m;
  else {
    out = new Uint8Array(m.length);
    for (let i = 0; i < m.length; i++) {
      const c = cur ? cur[i]! : 0;
      out[i] = how === 'add' ? c | m[i]! : how === 'sub' ? c & (m[i]! ^ 1) : c & m[i]!;
    }
  }
  return out.some((v) => v) ? out : null;
}

/** The pixels of a cel reachable from i through the same value (or every pixel of that value). */
function wandMask(doc: Doc, cel: Uint16Array, x: number, y: number, global: boolean, conn: 4 | 8): Uint8Array {
  const t = { width: doc.width, height: doc.height, wrap: doc.wrap, pixels: cel };
  const m = new Uint8Array(cel.length);
  const start = indexOf(t, x, y);
  const v = cel[start]!;
  if (global) {
    for (let i = 0; i < cel.length; i++) if (cel[i] === v) m[i] = 1;
    return m;
  }
  const steps: Pt[] = conn === 4 ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const stack = [start];
  m[start] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const px = i % doc.width;
    const py = (i - px) / doc.width;
    for (const [sx, sy] of steps) {
      const j = indexOf(t, px + sx, py + sy);
      if (j >= 0 && !m[j] && cel[j] === v) { m[j] = 1; stack.push(j); }
    }
  }
  return m;
}

const KINDS = 'rect, ellipse, lasso, wand, colour, layer, all, none or invert';

const selectCmd: CommandSpec = {
  name: 'select',
  summary: 'select rect <x,y> <W>x<H> | ellipse <cx,cy> r=<RX>x<RY> | ellipse <x,y> <W>x<H> | lasso <x,y> <x,y> <x,y>... | wand <x,y> [mode=contiguous|global] [conn=4|8] | colour c=<colour> | layer [<name>] | all | none | invert   [add|sub|and]',
  normalise(cmd, ctx) {
    const doc = needDoc(cmd, ctx);
    const a = new Args(cmd, ['r', 'mode', 'conn', 'c'], COMBINE);
    const cell = a.cellOrigin(doc);
    const how = a.take('word', KINDS);
    const comb = a.flag(COMBINE, 'replace') as Combine;
    const tail = comb === 'replace' ? '' : ` ${comb}`;
    const noOpts = (allowed: string[]) => {
      for (const o of a.opts.values()) if (!allowed.includes(o.key)) throw new DiagError(o.line, o.col, `select ${how.v} takes no ${o.key}=`);
    };
    const set = (text: string, mask: (d: Doc, by: string) => Uint8Array) => ({
      text: `select${cell.text} ${text}${tail}`,
      op: fn((d, by) => setCtx(d, by, { sel: combine(ctxOf(d, by).sel, mask(d, by), comb) })),
    });
    const off = (p: Pt): Pt => [p[0] + cell.dx, p[1] + cell.dy];
    switch (how.v) {
      case 'all': case 'none': case 'invert': {
        a.done();
        noOpts([]);
        if (comb !== 'replace') throw new DiagError(cmd.line, cmd.col, `select ${how.v} takes no ${comb}`);
        if (how.v === 'none') return { text: `select${cell.text} none`, op: fn((d, by) => setCtx(d, by, { sel: null })) };
        if (how.v === 'all') return { text: `select${cell.text} all`, op: fn((d, by) => setCtx(d, by, { sel: new Uint8Array(d.width * d.height).fill(1) })) };
        return {
          text: `select${cell.text} invert`,
          op: fn((d, by) => {
            const cur = ctxOf(d, by).sel;
            const m = new Uint8Array(d.width * d.height);
            for (let i = 0; i < m.length; i++) m[i] = cur ? cur[i]! ^ 1 : 1;
            setCtx(d, by, { sel: m.some((v) => v) ? m : null });
          }),
        };
      }
      case 'rect': {
        const p = a.take('point', 'a corner x,y');
        const sz = a.take('size', 'a size WxH');
        a.done();
        noOpts([]);
        if (sz.w < 1 || sz.h < 1) throw new DiagError(sz.line, sz.col, `select: size must be at least 1x1`);
        const m = maskOf(doc, rectPixels(p.x + cell.dx, p.y + cell.dy, sz.w, sz.h, true));
        return set(`rect ${p.x},${p.y} ${sz.w}x${sz.h}`, () => m);
      }
      case 'ellipse': {
        const p = a.take('point', 'a centre x,y (with r=) or a corner x,y (with a size)');
        const rOpt = a.opts.get('r');
        noOpts(['r']);
        let box: [number, number, number, number];
        let shape: string;
        if (rOpt) {
          const m = /^(\d+)(?:x(\d+))?$/.exec(rOpt.value);
          if (!m) throw new DiagError(rOpt.line, rOpt.vcol, `r= must be a radius like 5 or 5x3`);
          const rx = Number(m[1]);
          const ry = Number(m[2] ?? m[1]);
          a.done();
          box = [p.x - rx, p.y - ry, p.x + rx, p.y + ry];
          shape = `${p.x},${p.y} r=${rx}x${ry}`;
        } else {
          const s = a.take('size', 'a size WxH (or r=<radius>)');
          a.done();
          if (s.w < 1 || s.h < 1) throw new DiagError(s.line, s.col, `select: size must be at least 1x1`);
          box = [p.x, p.y, p.x + s.w - 1, p.y + s.h - 1];
          shape = `${p.x},${p.y} ${s.w}x${s.h}`;
        }
        const m = maskOf(doc, ellipsePixels(box[0] + cell.dx, box[1] + cell.dy, box[2] + cell.dx, box[3] + cell.dy, true));
        return set(`ellipse ${shape}`, () => m);
      }
      case 'lasso': {
        const pts: Pt[] = [];
        for (const t of a.rest()) {
          if (t.t !== 'point') throw new DiagError(t.line, t.col, `select lasso: expected a point x,y`);
          pts.push(pt(t));
        }
        noOpts([]);
        if (pts.length < 3) throw new DiagError(cmd.line, cmd.col, `select lasso: give at least 3 points`);
        const m = maskOf(doc, polygonPixels(pts.map(off), true, false));
        return set(`lasso ${pts.map(ptText).join(' ')}`, () => m);
      }
      case 'wand': {
        const p = a.take('point', 'a point x,y');
        a.done();
        noOpts(['mode', 'conn']);
        const mode = a.choice('mode', ['contiguous', 'global'], 'contiguous');
        const conn = a.choice('conn', ['4', '8'], '4');
        const x = p.x + cell.dx;
        const y = p.y + cell.dy;
        if (!doc.wrap && (x < 0 || y < 0 || x >= doc.width || y >= doc.height)) throw new DiagError(p.line, p.col, `select wand: ${p.x},${p.y} is outside the canvas`);
        // The wand reads the author's own layer, as it is when the line runs.
        return set(`wand ${p.x},${p.y} mode=${mode} conn=${conn}`, (d, by) => wandMask(d, targetOf(d, by).pixels, x, y, mode === 'global', conn === '8' ? 8 : 4));
      }
      case 'colour': case 'color': {
        a.done();
        noOpts(['c']);
        const o = a.opts.get('c');
        if (!o) throw new DiagError(cmd.line, cmd.col, `select colour: missing c=<colour>`);
        const c = resolveColour(o.value, doc.palette, o.line, o.vcol);
        return set(`colour c=${c.name}`, (d, by) => {
          const cel = targetOf(d, by).pixels;
          return Uint8Array.from(cel, (v) => (v === c.index ? 1 : 0));
        });
      }
      case 'layer': {
        const nameTok = a.peek()?.t === 'word' ? a.take('word', 'a layer name') : null;
        a.done();
        noOpts([]);
        const li = nameTok ? doc.layers.findIndex((l) => l.name === nameTok.v) : ctxOf(doc, ctx.by).layer;
        if (li < 0) throw new DiagError(nameTok!.line, nameTok!.col, `no layer '${nameTok!.v}'`);
        const name = doc.layers[li]!.name;
        return set(`layer ${name}`, (d, by) => {
          const l = d.layers.findIndex((x) => x.name === name);
          const cel = d.cels[l]![ctxOf(d, by).frame]!;
          return Uint8Array.from(cel, (v) => (v === TRANSPARENT ? 0 : 1));
        });
      }
      default:
        throw new DiagError(how.line, how.col, `select: '${how.v}' is not a selection (${KINDS})`);
    }
  },
};

const deselectCmd: CommandSpec = {
  name: 'deselect',
  summary: 'deselect   (the same as select none)',
  normalise(cmd, ctx) {
    needDoc(cmd, ctx);
    new Args(cmd, []).done();
    return { text: 'deselect', op: fn((d, by) => setCtx(d, by, { sel: null })) };
  },
};

/** Clear the selected pixels (or the whole cel) of the author's layer to transparent. */
const clearCmd: CommandSpec = {
  name: 'clear',
  summary: 'clear   (clears the selected pixels of your layer, or all of it, to transparent)',
  normalise(cmd, ctx) {
    drawable(cmd, ctx);
    new Args(cmd, []).done();
    return {
      text: 'clear',
      op: fn((d, by) => {
        const t = targetOf(d, by);
        for (let i = 0; i < t.pixels.length; i++) if (!t.mask || t.mask[i]) t.pixels[i] = TRANSPARENT;
      }),
    };
  },
};

registerCommand(selectCmd);
registerCommand(deselectCmd);
registerCommand(clearCmd);
