// Helpers that apply house rules exactly: `outline` (a 1-px outline around the shapes
// on your layer), `shade` (light the lit side of each shape a ramp step lighter and the far side a
// step darker) and `clean` (remove lone pixels and tiny clusters). Each works on the author's
// layer, inside their selection, and reads neighbours across the edges of wrap documents.

import { Args, drawable, fn, needDoc, registerCommand, resolveColour, synthOpt, type CommandSpec } from './commands.ts';
import { TRANSPARENT, ctxOf, flatten, type Doc } from './doc.ts';
import { SHADOW_DIRS, shadowBox, shadowDirOf, shadowPixels } from './shadow.ts';
import { targetOf } from './draw.ts';
import { DiagError } from './parser.ts';
import { indexOf, type Target } from './raster.ts';
import { intOpt, rampOpt, rampsOf } from './values.ts';

const N4: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const N8: [number, number][] = [...N4, [1, -1], [1, 1], [-1, 1], [-1, -1]];

/** A neighbour's value: off the canvas (not wrapping) counts as transparent. */
function at(t: Target, src: Uint16Array, x: number, y: number): number {
  const i = indexOf(t, x, y);
  return i < 0 ? TRANSPARENT : src[i]!;
}

const outlineCmd: CommandSpec = {
  name: 'outline',
  summary: 'outline c=<colour> [mode=outer|inner] [corners=on|off] [from=<layer>]   (around the shapes on your layer, or on another layer)',
  normalise(cmd, ctx) {
    const doc = drawable(cmd, ctx);
    const a = new Args(cmd, ['c', 'mode', 'corners', 'from']);
    a.done();
    const ink = ctx.defaults?.outline?.find((n) => doc.palette.entries.some((e) => e.name === n));
    const co = a.opts.get('c') ?? (ink ? synthOpt('c', ink, cmd) : undefined);
    if (!co) throw new DiagError(cmd.line, cmd.col, `outline: missing c=<colour> (or give the style guide an outline colour)`);
    const c = resolveColour(co.value, doc.palette, co.line, co.vcol);
    const mode = a.choice('mode', ['outer', 'inner'], 'outer');
    const corners = a.choice('corners', ['on', 'off'], 'off');
    const fo = a.opts.get('from');
    const from = fo ? doc.layers.findIndex((l) => l.name === fo.value) : -1;
    if (fo && from < 0) throw new DiagError(fo.line, fo.vcol, `no layer '${fo.value}'`);
    if (fo && mode === 'inner') throw new DiagError(fo.line, fo.col, `outline: from= goes with mode=outer (an inner outline is drawn on the shape itself)`);
    const nb = corners === 'on' ? N8 : N4;
    return {
      text: `outline c=${c.name} mode=${mode} corners=${corners}${fo ? ` from=${fo.value}` : ''}`,
      op: fn((d, by) => {
        const t = targetOf(d, by);
        const src = from >= 0 ? d.cels[from]![ctxOf(d, by).frame]! : t.pixels.slice();
        const own = t.pixels.slice();
        for (let i = 0; i < src.length; i++) {
          if (t.mask && !t.mask[i]) continue;
          const x = i % d.width;
          const y = (i - x) / d.width;
          const solid = src[i] !== TRANSPARENT;
          if (mode === 'outer' ? solid || own[i] !== TRANSPARENT : !solid) continue;
          const hit = nb.some(([dx, dy]) => (at(t, src, x + dx, y + dy) !== TRANSPARENT) === (mode === 'outer'));
          if (hit) t.pixels[i] = c.index;
        }
      }),
    };
  },
};

const LIGHTS: Record<string, [number, number]> = { n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1] };

const shadeCmd: CommandSpec = {
  name: 'shade',
  summary: 'shade light=n|ne|e|se|s|sw|w|nw [ramp=<ramp>|all] [edge=<n>]   (each shape\'s lit edge a ramp step lighter, its far edge a step darker)',
  normalise(cmd, ctx) {
    const doc = drawable(cmd, ctx);
    const a = new Args(cmd, ['light', 'ramp', 'edge']);
    a.done();
    const styleLight = ctx.defaults?.light && ctx.defaults.light in LIGHTS ? ctx.defaults.light : undefined;
    if (!a.opts.has('light') && !styleLight) throw new DiagError(cmd.line, cmd.col, `shade: missing light=<direction> (n, ne, e, se, s, sw, w, nw), or a light in the style guide`);
    const light = a.choice('light', Object.keys(LIGHTS), styleLight ?? 'nw');
    const ro = a.opts.get('ramp');
    const ramp = ro && ro.value !== 'all' ? rampOpt(ro, doc.palette) : null;
    const eo = a.opts.get('edge');
    const edge = eo ? intOpt(eo, 1, 8) : 1;
    const [lx, ly] = LIGHTS[light]!;
    return {
      text: `shade light=${light} ramp=${ramp ? ramp.text : 'all'} edge=${edge}`,
      op: fn((d, by) => {
        const t = targetOf(d, by);
        const src = t.pixels.slice();
        // The ramp each colour shades along (the given one, or the first ramp it is in).
        const rampFor = new Map<number, { ramp: number[]; at: number }>();
        const look = (v: number) => {
          if (!rampFor.has(v)) {
            const r = ramp ? (ramp.idx.includes(v) ? { ramp: ramp.idx, at: ramp.idx.indexOf(v) } : null) : rampsOf(d.palette, v)[0] ?? null;
            rampFor.set(v, r!);
          }
          return rampFor.get(v);
        };
        for (let i = 0; i < src.length; i++) {
          const v = src[i]!;
          if (v === TRANSPARENT || (t.mask && !t.mask[i])) continue;
          const r = look(v);
          if (!r) continue;
          const x = i % d.width;
          const y = (i - x) / d.width;
          // The shape is the run of pixels of the same ramp; anything else is its boundary.
          const outside = (sx: number, sy: number) => {
            for (let k = 1; k <= edge; k++) {
              const u = at(t, src, x + sx * k, y + sy * k);
              if (u === TRANSPARENT || !r.ramp.includes(u)) return true;
            }
            return false;
          };
          const toward = (dx: number, dy: number) => (dx !== 0 && outside(dx, 0)) || (dy !== 0 && outside(0, dy));
          const lit = toward(lx, ly);
          const dark = toward(-lx, -ly);
          if (lit === dark) continue;
          const to = r.at + (lit ? 1 : -1);
          if (to >= 0 && to < r.ramp.length) t.pixels[i] = r.ramp[to]!;
        }
      }),
    };
  },
};

const cleanCmd: CommandSpec = {
  name: 'clean',
  summary: 'clean orphans [size=<n>] [keep=none|texture]   (pixels or clusters of up to n that share no 4-neighbour\'s colour take the colour around them)',
  normalise(cmd, ctx) {
    const doc = drawable(cmd, ctx);
    const a = new Args(cmd, ['size', 'keep']);
    const what = a.take('word', 'orphans');
    if (what.v !== 'orphans') throw new DiagError(what.line, what.col, `clean: expected orphans`);
    a.done();
    const so = a.opts.get('size');
    const size = so ? intOpt(so, 1, 64) : 1;
    const keep = a.choice('keep', ['none', 'texture'], 'none');
    return {
      text: `clean orphans size=${size} keep=${keep}`,
      op: fn((d, by) => cleanOrphans(d, targetOf(d, by), size, keep === 'texture')),
    };
  },
};

/**
 * Replace every 4-connected cluster of one colour (transparent counts as a colour) of at most
 * `size` pixels with the colour most common around it (ties: the lowest palette index). With
 * keepTexture, a cluster one ramp step from that colour stays: it is texture, not a stray.
 */
function cleanOrphans(d: Doc, t: Target, size: number, keepTexture: boolean): void {
  const src = t.pixels.slice();
  const seen = new Uint8Array(src.length);
  for (let s = 0; s < src.length; s++) {
    if (seen[s]) continue;
    const v = src[s]!;
    const comp = [s];
    seen[s] = 1;
    for (let k = 0; k < comp.length && comp.length <= size; k++) {
      const i = comp[k]!;
      const x = i % d.width;
      const y = (i - x) / d.width;
      for (const [dx, dy] of N4) {
        const j = indexOf(t, x + dx, y + dy);
        if (j >= 0 && !seen[j] && src[j] === v) { seen[j] = 1; comp.push(j); }
      }
    }
    if (comp.length > size) {
      // Too big: mark the rest of it seen so it is not looked at again piece by piece.
      for (let k = 0; k < comp.length; k++) {
        const i = comp[k]!;
        const x = i % d.width;
        const y = (i - x) / d.width;
        for (const [dx, dy] of N4) {
          const j = indexOf(t, x + dx, y + dy);
          if (j >= 0 && !seen[j] && src[j] === v) { seen[j] = 1; comp.push(j); }
        }
      }
      continue;
    }
    const inComp = new Set(comp);
    const count = new Map<number, number>();
    for (const i of comp) {
      const x = i % d.width;
      const y = (i - x) / d.width;
      for (const [dx, dy] of N4) {
        const j = indexOf(t, x + dx, y + dy);
        if (j < 0 || inComp.has(j)) continue;
        count.set(src[j]!, (count.get(src[j]!) ?? 0) + 1);
      }
    }
    let best = -1;
    let bestN = 0;
    for (const [c, n] of [...count.entries()].sort((p, q) => p[0] - q[0])) if (n > bestN) { best = c; bestN = n; }
    if (best < 0 || best === v) continue;
    if (keepTexture && v !== TRANSPARENT && best !== TRANSPARENT && rampsOf(d.palette, v).some((r) => Math.abs(r.ramp.indexOf(best) - r.at) === 1 && r.ramp.includes(best))) continue;
    for (const i of comp) if (!t.mask || t.mask[i]) t.pixels[i] = best;
  }
}

/**
 * A shadow under a sprite or an object: a flat ellipse on the ground, pushed away from the
 * light, in the style guide's shadow colour and direction unless given; drawn on your layer only
 * where the art is empty, so it sits behind. The line records the box it was drawn in.
 */
const shadowCmd: CommandSpec = {
  name: 'shadow',
  summary: 'shadow [<x,y> <W>x<H>] [c=<colour>] [dir=n|ne|e|se|s|sw|w|nw]   (an ellipse on the ground under the art, away from the light; the style guide\'s colour and direction)',
  normalise(cmd, ctx) {
    const doc = drawable(cmd, ctx);
    const a = new Args(cmd, ['c', 'dir']);
    const cell = a.cellOrigin(doc);
    let box: { x: number; y: number; w: number; h: number } | null = null;
    if (a.peek()?.t === 'point') {
      const p = a.take('point', 'a corner x,y');
      const sz = a.take('size', 'a size WxH');
      box = { x: p.x + cell.dx, y: p.y + cell.dy, w: sz.w, h: sz.h };
    }
    a.done();
    const st = ctx.defaults?.shadow;
    const dir = a.choice('dir', SHADOW_DIRS, st?.dir && SHADOW_DIRS.includes(st.dir) ? st.dir : shadowDirOf(ctx.defaults?.light));
    const co = a.opts.get('c') ?? (st?.c && st.c !== 'darker' ? synthOpt('c', st.c, cmd) : undefined);
    if (!co) throw new DiagError(cmd.line, cmd.col, `shadow: give c=<colour>${st?.c === 'darker' ? ' (the style guide\'s shadow is darker, a step down the ramps of the ground under it: maps draw that; a sprite has no ground)' : ' (or a shadow colour in the style guide: style.shadow.c)'}`);
    const c = resolveColour(co.value, doc.palette, co.line, co.vcol);
    if (!box) {
      const f = ctxOf(doc, ctx.by).frame;
      box = shadowBox(flatten(doc, f), doc.width, doc.height, dir);
      if (!box) throw new DiagError(cmd.line, cmd.col, `shadow: nothing is drawn yet to cast one (or give its box x,y WxH)`);
    }
    const b = box;
    return {
      text: `shadow ${b.x},${b.y} ${b.w}x${b.h} c=${c.name} dir=${dir}`,
      op: fn((d, by) => {
        const t = targetOf(d, by);
        const flat = flatten(d, ctxOf(d, by).frame);
        for (const [x, y] of shadowPixels(b)) {
          if (x < 0 || y < 0 || x >= d.width || y >= d.height) continue;
          const i = y * d.width + x;
          if (flat[i] !== TRANSPARENT || (t.mask && !t.mask[i])) continue;
          t.pixels[i] = c.index;
        }
      }),
    };
  },
};

const keepCmd: CommandSpec = {
  name: 'keep',
  summary: 'keep <x,y> [<W>x<H>]   (a single pixel or a region that is meant to be on its own, an eye or a mouth: the orphans check leaves it alone)   or   keep remove <x,y>   or   keep clear',
  normalise(cmd, ctx) {
    const doc = needDoc(cmd, ctx);
    const a = new Args(cmd, []);
    const first = a.peek();
    if (first?.t === 'word' && first.v === 'clear') {
      a.take('word', 'clear');
      a.done();
      return { text: 'keep clear', op: fn((d) => { d.keeps = []; }) };
    }
    if (first?.t === 'word' && first.v === 'remove') {
      a.take('word', 'remove');
      const p = a.take('point', 'a point x,y inside the kept pixels to forget');
      a.done();
      const hit = (k: { x: number; y: number; w: number; h: number }) => p.x >= k.x && p.x < k.x + k.w && p.y >= k.y && p.y < k.y + k.h;
      if (!doc.keeps.some(hit)) throw new DiagError(p.line, p.col, `keep remove: nothing kept at ${p.x},${p.y}${doc.keeps.length ? ` (kept: ${doc.keeps.map((k) => `${k.x},${k.y}${k.w * k.h > 1 ? ` ${k.w}x${k.h}` : ''}`).join('; ')})` : ''}`);
      return { text: `keep remove ${p.x},${p.y}`, op: fn((d) => { d.keeps = d.keeps.filter((k) => !hit(k)); }) };
    }
    const p = a.take('point', 'a point x,y (or remove x,y, or clear)');
    const sz = a.peek()?.t === 'size' ? a.take('size', 'a size WxH') : null;
    a.done();
    const w = sz?.w ?? 1, h = sz?.h ?? 1;
    if (w < 1 || h < 1) throw new DiagError(sz!.line, sz!.col, 'keep: size must be at least 1x1');
    if (p.x < 0 || p.y < 0 || p.x + w > doc.width || p.y + h > doc.height) throw new DiagError(p.line, p.col, `keep: ${p.x},${p.y}${sz ? ` ${w}x${h}` : ''} is outside the ${doc.width}x${doc.height} canvas`);
    if (doc.keeps.length >= 64) throw new DiagError(cmd.line, cmd.col, 'keep: 64 kept regions is enough; use a larger region or keep clear');
    const same = doc.keeps.some((k) => k.x === p.x && k.y === p.y && k.w === w && k.h === h);
    return {
      text: `keep ${p.x},${p.y}${sz ? ` ${w}x${h}` : ''}`,
      op: fn((d) => { if (!same) d.keeps = [...d.keeps, { x: p.x, y: p.y, w, h }]; }),
    };
  },
};

registerCommand(keepCmd);
registerCommand(outlineCmd);
registerCommand(shadowCmd);
registerCommand(shadeCmd);
registerCommand(cleanCmd);
