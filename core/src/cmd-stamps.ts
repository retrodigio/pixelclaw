// Stamps and brushes. `stamp save` keeps a piece of art in the document (from a box of your layer,
// or from a paint block), `stamp <name> x,y` places it (top-left at x,y; its transparent pixels
// leave the canvas alone), and `brush` makes outline-like commands (px, line, curve, stroke,
// outlines of rect, ellipse and polygon) draw with a square, a circle or a stamp's shape.

import { Args, blockText, drawable, fn, needDoc, registerCommand, type CommandSpec } from './commands.ts';
import { TRANSPARENT, setCtx } from './doc.ts';
import { drawColoured, targetOf } from './draw.ts';
import { DiagError, type BlockRow } from './parser.ts';
import { indexOf } from './raster.ts';

const NAME_RE = /^[a-z][a-z0-9_-]*$/;
const RESERVED = new Set(['save', 'remove']);

const stampCmd: CommandSpec = {
  name: 'stamp',
  summary: 'stamp save <name> <x,y> <W>x<H> | stamp save <name> << rows >> | stamp <name> <x,y> [flip=none|h|v|hv] | stamp remove <name>',
  normalise(cmd, ctx) {
    const doc = needDoc(cmd, ctx);
    const a = new Args(cmd, ['flip']);
    const cell = a.cellOrigin(doc);
    const how = a.take('word', 'save, remove or a stamp name');
    if (how.v === 'save') {
      const name = a.take('word', 'a name for the stamp');
      if (!NAME_RE.test(name.v) || RESERVED.has(name.v)) throw new DiagError(name.line, name.col, `stamp names use a-z, 0-9, _ and -, starting with a letter (not save or remove)`);
      if (a.opts.has('flip')) throw new DiagError(cmd.line, cmd.col, `stamp save takes no flip=`);
      if (a.peek()?.t === 'block') {
        const block = a.take('block', 'a block');
        a.done();
        const keyIndex = new Map(doc.palette.entries.map((e, i) => [e.key, i]));
        const rows = block.rows.map((r: BlockRow) => [...r.text].map((ch, i) => {
          if (ch === '.' || ch === ' ') return TRANSPARENT;
          const idx = keyIndex.get(ch);
          if (idx === undefined) throw new DiagError(r.line, r.col + i, `stamp: '${ch}' is not a key in palette '${doc.palette.name}'`);
          return idx;
        }));
        const w = Math.max(0, ...rows.map((r) => r.length));
        const h = rows.length;
        if (w < 1 || h < 1) throw new DiagError(block.line, block.col, `stamp save: the block is empty`);
        const px = new Uint16Array(w * h).fill(TRANSPARENT);
        rows.forEach((r, j) => r.forEach((v, i) => { px[j * w + i] = v; }));
        return {
          text: `stamp save ${name.v} <<\n${blockText(block.rows.map((r) => r.text))}>>`,
          op: fn((d) => { d.stamps = { ...d.stamps, [name.v]: { w, h, px } }; }),
        };
      }
      const p = a.take('point', 'a corner x,y (or a block: <<)');
      const s = a.take('size', 'a size WxH');
      a.done();
      if (s.w < 1 || s.h < 1 || s.w > 256 || s.h > 256) throw new DiagError(s.line, s.col, `stamp save: size must be 1x1 to 256x256`);
      return {
        text: `stamp${cell.text} save ${name.v} ${p.x},${p.y} ${s.w}x${s.h}`,
        op: fn((d, by) => {
          // From the author's layer; with a selection, unselected pixels are left out.
          const t = targetOf(d, by);
          const px = new Uint16Array(s.w * s.h).fill(TRANSPARENT);
          for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++) {
            const k = indexOf(t, p.x + cell.dx + i, p.y + cell.dy + j);
            if (k >= 0 && (!t.mask || t.mask[k])) px[j * s.w + i] = t.pixels[k]!;
          }
          d.stamps = { ...d.stamps, [name.v]: { w: s.w, h: s.h, px } };
        }),
      };
    }
    if (how.v === 'remove') {
      const name = a.take('word', 'a stamp name');
      a.done();
      if (!doc.stamps[name.v]) throw new DiagError(name.line, name.col, `no stamp '${name.v}'`);
      return {
        text: `stamp remove ${name.v}`,
        op: fn((d) => {
          const { [name.v]: _gone, ...rest } = d.stamps;
          d.stamps = rest;
          // A brush made from it falls back to one pixel.
          for (const [au, c] of Object.entries(d.ctx)) if (c.brush?.shape === 'stamp' && c.brush.stamp === name.v) setCtx(d, au, { brush: null });
        }),
      };
    }
    drawable(cmd, ctx);
    const s = doc.stamps[how.v];
    if (!s) throw new DiagError(how.line, how.col, `no stamp '${how.v}' (stamps: ${Object.keys(doc.stamps).join(', ') || 'none; make one with stamp save'})`);
    const p = a.take('point', 'where its top-left goes, x,y');
    a.done();
    const flip = a.choice('flip', ['none', 'h', 'v', 'hv'], 'none');
    const x0 = p.x + cell.dx;
    const y0 = p.y + cell.dy;
    const pts: [number, number, number][] = [];
    for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++) {
      const si = flip.includes('h') ? s.w - 1 - i : i;
      const sj = flip.includes('v') ? s.h - 1 - j : j;
      const v = s.px[sj * s.w + si]!;
      if (v !== TRANSPARENT) pts.push([x0 + i, y0 + j, v]);
    }
    return { text: `stamp${cell.text} ${how.v} ${p.x},${p.y} flip=${flip}`, op: fn((d, by) => drawColoured(d, by, pts, true)) };
  },
};

const brushCmd: CommandSpec = {
  name: 'brush',
  summary: 'brush square <n> | brush circle <n> | brush stamp <name> | brush off   (the shape px, line, curve, stroke and outlines draw with)',
  normalise(cmd, ctx) {
    const doc = needDoc(cmd, ctx);
    const a = new Args(cmd, []);
    const how = a.take('word', 'square, circle, stamp or off');
    if (how.v === 'off') {
      a.done();
      return { text: 'brush off', op: fn((d, by) => setCtx(d, by, { brush: null })) };
    }
    if (how.v === 'stamp') {
      const name = a.take('word', 'a stamp name');
      a.done();
      if (!doc.stamps[name.v]) throw new DiagError(name.line, name.col, `no stamp '${name.v}'`);
      return { text: `brush stamp ${name.v}`, op: fn((d, by) => setCtx(d, by, { brush: { shape: 'stamp', stamp: name.v } })) };
    }
    if (how.v !== 'square' && how.v !== 'circle') throw new DiagError(how.line, how.col, `brush: expected square, circle, stamp or off`);
    const n = a.take('int', 'a size in pixels');
    a.done();
    if (n.v < 1 || n.v > 32) throw new DiagError(n.line, n.col, `brush: size must be 1..32`);
    const shape = how.v;
    return {
      text: `brush ${shape} ${n.v}`,
      op: fn((d, by) => setCtx(d, by, { brush: n.v === 1 ? null : { shape, size: n.v } })),
    };
  },
};

registerCommand(stampCmd);
registerCommand(brushCmd);
