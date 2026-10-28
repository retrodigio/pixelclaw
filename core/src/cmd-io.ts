// Import and densities as commands (plan §4.7, §4.9). `import` writes an imported image's palette
// indices onto the author's layer and frame: the rows are in the line (as `family texture` records
// its pixels), and the source file and its blob hash are kept for the record, so a tape that
// starts from an import replays with nothing but itself. `scale <n>` makes a nearest-neighbour
// scale-up (a higher density starts from one), and `density of=<asset> d=<n>` says this asset is
// that asset at n times the size.

import { Args, blockText, drawable, fn, needDoc, registerCommand, type CommandSpec } from './commands.ts';
import { TRANSPARENT, ctxOf, type Doc } from './doc.ts';
import { scaleIndices } from './density.ts';
import { DiagError, quote, type BlockRow } from './parser.ts';
import { intOpt } from './values.ts';

const importCmd: CommandSpec = {
  name: 'import',
  summary: "import <x,y> [from=\"<file>\"] [blob=<sha256>] << rows of palette keys ('.' is transparent) >>   (an imported image's pixels; replaces the rectangle on your layer and frame)",
  normalise(cmd, ctx) {
    const doc = drawable(cmd, ctx);
    const a = new Args(cmd, ['from', 'blob']);
    const p = a.take('point', 'a top-left corner x,y');
    const block = a.take('block', `the image's rows in a block`);
    a.done();
    const from = a.opts.get('from');
    const blob = a.opts.get('blob');
    if (blob && !/^[0-9a-f]{8,64}$/.test(blob.value)) throw new DiagError(blob.line, blob.vcol, `blob= is the image's sha256 in hex`);
    const keyIndex = new Map(doc.palette.entries.map((e, i) => [e.key, i]));
    const rows = block.rows.map((r: BlockRow) => [...r.text].map((ch, i) => {
      if (ch === '.') return TRANSPARENT;
      const idx = keyIndex.get(ch);
      if (idx === undefined) throw new DiagError(r.line, r.col + i, `import: '${ch}' is not a key in palette '${doc.palette.name}'`);
      return idx;
    }));
    const w = Math.max(0, ...rows.map((r) => r.length));
    const opts = `${from ? ` from=${quote(from.value)}` : ''}${blob ? ` blob=${blob.value}` : ''}`;
    return {
      text: `import ${p.x},${p.y}${opts} <<\n${blockText(block.rows.map((r) => r.text))}>>`,
      op: fn((d, by) => {
        const c = ctxOf(d, by);
        const cel = d.cels[c.layer]![c.frame]!;
        rows.forEach((row, j) => {
          const y = p.y + j;
          if (y < 0 || y >= d.height) return;
          for (let i = 0; i < w; i++) {
            const x = p.x + i;
            if (x < 0 || x >= d.width) continue;
            cel[y * d.width + x] = row[i] ?? TRANSPARENT;
          }
        });
      }),
    };
  },
};

/** Rows of keys for an import line ('.' transparent). */
export function importRows(px: Uint16Array, w: number, h: number, keys: string[]): string[] {
  return Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => {
    const v = px[y * w + x]!;
    return v === TRANSPARENT ? '.' : keys[v]!;
  }).join(''));
}

function scaleDoc(d: Doc, n: number): void {
  const w = d.width, h = d.height;
  d.cels = d.cels.map((fr) => {
    const seen = new Map<Uint16Array, Uint16Array>();
    return fr.map((c) => seen.get(c) ?? seen.set(c, scaleIndices(c, w, h, n)).get(c)!);
  });
  for (const s of Object.values(d.stamps)) { s.px = scaleIndices(s.px, s.w, s.h, n); s.w *= n; s.h *= n; }
  d.width *= n; d.height *= n; d.cellW *= n; d.cellH *= n;
  d.notes = d.notes.map((m) => ({ ...m, x: m.x * n, y: m.y * n, w: m.w * n, h: m.h * n }));
  if (d.pivot) d.pivot = [d.pivot[0] * n + (n >> 1), d.pivot[1] * n + n - 1];
  if (d.ground !== null) d.ground = d.ground * n + n - 1;
  for (const k of Object.keys(d.ctx)) d.ctx[k] = { ...d.ctx[k]!, sel: null, mirror: null };
}

const scaleCmd: CommandSpec = {
  name: 'scale',
  summary: 'scale <n>   (the whole document n times larger, nearest neighbour: every layer, frame and stamp, the cell grid, pivot, ground and notes; selections and symmetry are dropped)',
  normalise(cmd, ctx) {
    const doc = needDoc(cmd, ctx);
    const a = new Args(cmd, []);
    const n = a.take('int', 'a factor 2..8');
    a.done();
    if (n.v < 2 || n.v > 8) throw new DiagError(n.line, n.col, `scale: the factor is 2..8`);
    if (doc.map || doc.family) throw new DiagError(cmd.line, cmd.col, `scale: a ${doc.kind} is not scaled (its cells are tiles)`);
    if (doc.width * n.v > 4096 || doc.height * n.v > 4096) throw new DiagError(n.line, n.col, `scale: ${doc.width * n.v}x${doc.height * n.v} is over 4096`);
    return { text: `scale ${n.v}`, op: fn((d) => scaleDoc(d, n.v)) };
  },
};

const densityCmd: CommandSpec = {
  name: 'density',
  summary: 'density of=<asset> d=<2|4|n> | density off   (this asset is <asset> at n times its size: the density check reduces it and compares; exports write it as that level)',
  normalise(cmd, ctx) {
    const doc = needDoc(cmd, ctx);
    const a = new Args(cmd, ['of', 'd']);
    if (a.peek()?.t === 'word' && (a.peek() as { v: string }).v === 'off') {
      a.take('word', 'off');
      a.done();
      return { text: 'density off', op: fn((d) => { d.densityOf = null; }) };
    }
    a.done();
    const of = a.opts.get('of');
    const dOpt = a.opts.get('d');
    if (!of || !dOpt) throw new DiagError(cmd.line, cmd.col, `density: give of=<the base asset> d=<times its size> (or off)`);
    if (!/^[a-z][a-z0-9_-]*$/.test(of.value)) throw new DiagError(of.line, of.vcol, `'${of.value}' is not an asset name`);
    if (of.value === doc.name) throw new DiagError(of.line, of.vcol, `an asset is not a density of itself`);
    if (doc.map) throw new DiagError(cmd.line, cmd.col, `density: a map has no densities`);
    const d = intOpt(dOpt, 2, 8);
    if (doc.width % d || doc.height % d) throw new DiagError(dOpt.line, dOpt.vcol, `density: ${doc.width}x${doc.height} is not a whole ${d} times a base size`);
    const base = ctx.asset?.(of.value);
    if (base && (base.width * d !== doc.width || base.height * d !== doc.height)) {
      throw new DiagError(dOpt.line, dOpt.vcol, `density: '${of.value}' is ${base.width}x${base.height}; ${d} times that is ${base.width * d}x${base.height * d}, not ${doc.width}x${doc.height}`);
    }
    return { text: `density of=${of.value} d=${d}`, op: fn((x) => { x.densityOf = { of: of.value, d }; }) };
  },
};

for (const c of [importCmd, scaleCmd, densityCmd]) registerCommand(c);
