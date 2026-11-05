// Family and overlay commands: the band profile (route 1), the textures, detaching
// variants for hand work, the coverage map (route 3's flat template) and cutting from it, and an
// overlay's settings. The pieces (route 2) are drawn with the ordinary commands on the band layer,
// addressed by name: `layer band ; paint @cell(o) 0,0 << … >>`.

import { blockText, fn, needDoc, registerCommand, resolveColour, Args, type CommandSpec, type NormaliseContext } from './commands.ts';
import { OVERLAY_MODES, TRANSPARENT, ctxOf, flatten, newLayer, remapCtx, type Doc, type FamilyState, type OverlayMode, type OverlayState } from './doc.ts';
import {
  BAND_LAYER, GROUND_LAYER, bandMaps, composeMap, coverageTerrain, cutFamily, familyCell, layoutOf, schemeOf, variantCounts,
} from './family.ts';
import { DiagError, parse, type ParsedCommand } from './parser.ts';
import { isFace, reachable, type Band, type BandFill } from './schemes.ts';

function familyOf(cmd: ParsedCommand, ctx: NormaliseContext): { doc: Doc; f: FamilyState } {
  const doc = needDoc(cmd, ctx);
  if (!doc.family) throw new DiagError(cmd.line, cmd.col, `${cmd.name}: '${doc.name}' is not a family (new family <name> <T>x<T> scheme=…)`);
  return { doc, f: doc.family };
}

function noFlags(a: Args): void {
  if (a.flags.length) throw new DiagError(a.flags[0]!.line, a.flags[0]!.col, `${a.cmd.name}: unexpected '${a.flags[0]!.v}'`);
}

function onlyOpts(a: Args, what: string, allowed: string[]): void {
  for (const o of a.opts.values()) if (!allowed.includes(o.key)) throw new DiagError(o.line, o.col, `${what} takes no ${o.key}=`);
}

function intOpt(a: Args, key: string, lo: number, hi: number, dflt: number): number {
  const o = a.opts.get(key);
  if (!o) return dflt;
  if (!/^\d+$/.test(o.value) || Number(o.value) < lo || Number(o.value) > hi) throw new DiagError(o.line, o.vcol, `${key}= must be a whole number ${lo}..${hi}`);
  return Number(o.value);
}

const layerIndex = (d: Doc, name: string): number => d.layers.findIndex((l) => l.name === name);

/** The most common colour of a cell as it looks (for the flat template). */
function modeColour(d: Doc, frame: number, cx: number, cy: number, t: number): number {
  const cel = flatten(d, frame);
  const n = new Map<number, number>();
  for (let y = 0; y < t; y++) for (let x = 0; x < t; x++) {
    const v = cel[(cy * t + y) * d.width + cx * t + x]!;
    if (v !== TRANSPARENT) n.set(v, (n.get(v) ?? 0) + 1);
  }
  let best = TRANSPARENT, bn = 0;
  for (const [v, k] of n) if (k > bn || (k === bn && v < best)) { best = v; bn = k; }
  return best;
}

/**
 * `family band from=<family>`: the band of another family of the same scheme and tile (its
 * geometry, detached variants and band layer), copied into the line so replay never reads it.
 * Only the cells the family does not assemble are recorded: its pieces, its detached
 * variants and any other cell with band art; the variants built from the pieces' quadrants are
 * built again after the line, so they come out as the source's. The line as written:
 * `family band from=<f> <bands> radius= inset= [fillet=] [jitter= seed=] detached=<a,b|none>
 * frames=<n> cells=<names|none> << each recorded cell's rows side by side, frame after frame >>`
 * (a cell is named by its variant, `inside`, `outside`, or `<cx>:<cy>` for a spare cell). The
 * older form without cells= (the whole band layer's sheet rows) still replays.
 */
function bandFrom(a: Args, doc: Doc, f: FamilyState, ctx: NormaliseContext): { text: string; run: (d: Doc) => void } {
  const from = a.opts.get('from')!;
  const L = layoutOf(f);
  const s = schemeOf(f);
  const t = f.tile;
  const sheetH = L.mapRow * t;
  const W = doc.width;
  const keyOf = new Map(doc.palette.entries.map((e, i) => [i, e.key]));
  const items = a.rest();
  const blk = items.at(-1)?.t === 'block' ? items.pop() as Extract<typeof items[number], { t: 'block' }> : null;
  /** The sheet's cells by name, and the name of each. */
  const cellName = (cx: number, cy: number): string => {
    if (cx === L.inside[0] && cy === L.inside[1]) return 'inside';
    if (cx === L.outside[0] && cy === L.outside[1]) return 'outside';
    const v = L.cells.findIndex(([x, y]) => x === cx && y === cy);
    return v >= 0 ? s.variants[v]!.name : `${cx}:${cy}`;
  };
  const cellAt = (name: string): [number, number] | null => {
    const m = /^(\d+):(\d+)$/.exec(name);
    if (m) return Number(m[1]) < W / t && Number(m[2]) < L.mapRow ? [Number(m[1]), Number(m[2])] : null;
    return familyCell(f, name);
  };
  if (!blk && !a.opts.get('cells')) {
    if (items.length) throw new DiagError(items[0]!.line, items[0]!.col, `family band from=: the band comes from '${from.value}' (give nothing else)`);
    onlyOpts(a, 'family band from=', ['from']);
    const src = ctx.asset?.(from.value);
    if (!src) throw new DiagError(from.line, from.vcol, `family band: no asset '${from.value}' to copy the band from (not this one)`);
    const sf = src.family;
    if (!sf || sf.scheme !== f.scheme || sf.tile !== t) throw new DiagError(from.line, from.vcol, `family band: '${from.value}' is not a ${f.scheme} family of ${t}px tiles`);
    const g = sf.geometry;
    const name = (fill: BandFill) => (fill === 'outside' || fill === 'inside' ? fill : src.palette.entries[fill]!.name);
    for (const b of g.bands) if (typeof b.fill === 'number' && !doc.palette.entries.some((e) => e.name === name(b.fill))) throw new DiagError(from.line, from.vcol, `family band: '${from.value}' uses ${name(b.fill)}, which palette '${doc.palette.name}' does not have`);
    const geometryText = `${g.bands.map((b) => `${b.w}:${name(b.fill)}`).join(' ')} radius=${g.radius} inset=${g.inset}${g.fillet !== undefined ? ` fillet=${g.fillet}` : ''}${g.jitter ? ` jitter=${g.jitter.px} seed=${g.jitter.seed}` : ''}`;
    const detached = sf.detached;
    const frames = Math.min(src.frameCount, doc.frameCount);
    const sbl = layerIndex(src, BAND_LAYER);
    // The cells to record: every cell of the sheet the family does not assemble, with band art on some frame.
    const det = new Set(detached);
    const SL = layoutOf(sf);
    const assembled = new Set(s.variants.map((v, i) => (s.sources[i] && !det.has(v.name) ? `${SL.cells[i]![0]},${SL.cells[i]![1]}` : '')).filter(Boolean));
    const at = (fr: number, x: number, y: number) => (sbl >= 0 ? src.cels[sbl]![fr]![y * src.width + x]! : TRANSPARENT);
    const cells: [number, number][] = [];
    for (let cy = 0; cy < L.mapRow; cy++) for (let cx = 0; cx < W / t; cx++) {
      if (assembled.has(`${cx},${cy}`)) continue;
      let any = false;
      for (let fr = 0; fr < frames && !any; fr++) for (let y = 0; y < t && !any; y++) for (let x = 0; x < t; x++) if (at(fr, cx * t + x, cy * t + y) !== TRANSPARENT) { any = true; break; }
      if (any) cells.push([cx, cy]);
    }
    const rows: string[] = [];
    for (let fr = 0; fr < frames; fr++) for (let y = 0; y < t; y++) {
      let row = '';
      for (const [cx, cy] of cells) for (let x = 0; x < t; x++) {
        const v = at(fr, cx * t + x, cy * t + y);
        if (v === TRANSPARENT) { row += '.'; continue; }
        const k = doc.palette.entries.findIndex((e) => e.name === src.palette.entries[v]!.name);
        if (k < 0) throw new DiagError(from.line, from.vcol, `family band: '${from.value}' uses ${src.palette.entries[v]!.name}, which palette '${doc.palette.name}' does not have`);
        row += keyOf.get(k)!;
      }
      rows.push(row);
    }
    // Replay reads the line, so it goes through the parser as written.
    const text = `band from=${from.value} ${geometryText} detached=${detached.length ? detached.join(',') : 'none'} frames=${frames} cells=${cells.length ? cells.map(([x, y]) => cellName(x, y)).join(',') : 'none'}${cells.length ? ` <<\n${blockText(rows)}>>` : ''}`;
    const re = parse(`family ${text}`);
    if (re.errors.length || re.commands.length !== 1) throw new DiagError(from.line, from.vcol, `family band from=: ${re.errors[0]?.message ?? 'could not record the band'}`);
    const a2 = new Args(re.commands[0]!, ['radius', 'inset', 'fillet', 'jitter', 'draw', 'from', 'frame', 'seed', 'copies', 'fill', 'textures', 'detached', 'frames', 'cells']);
    a2.take('word', 'band');
    return bandFrom(a2, doc, f, ctx);
  }
  // The recorded line: geometry from the band items, the layer from the rows.
  onlyOpts(a, 'family band from=', ['from', 'radius', 'inset', 'fillet', 'jitter', 'seed', 'detached', 'frames', 'cells']);
  const bands: Band[] = [];
  const parts: string[] = [];
  for (const it of items) {
    const m = it.t === 'word' ? /^(\d+):(.+)$/.exec(it.v) : null;
    if (!m) throw new DiagError(it.line, it.col, `family band: expected <width>:<colour|outside|inside>`);
    const fill: BandFill = m[2] === 'outside' || m[2] === 'inside' ? m[2] : resolveColour(m[2]!, doc.palette, it.line, it.col).index;
    bands.push({ w: Number(m[1]), fill });
    parts.push(`${m[1]}:${m[2]}`);
  }
  const h = t / 2;
  const radius = intOpt(a, 'radius', 0, h, 0), inset = intOpt(a, 'inset', 0, h - 1, 0);
  const fo = a.opts.get('fillet');
  const fillet = fo ? intOpt(a, 'fillet', 1, h, 1) : undefined;
  const jit = intOpt(a, 'jitter', 0, h, 0);
  const seed = jit ? intOpt(a, 'seed', 1, 0x7fffffff, 1) : 0;
  const det = a.opts.get('detached')?.value ?? 'none';
  const detachedList = det === 'none' ? [] : det.split(',');
  for (const n of detachedList) if (!s.byName.has(n)) throw new DiagError(a.opts.get('detached')!.line, a.opts.get('detached')!.vcol, `${s.name} has no variant '${n}'`);
  const nf = intOpt(a, 'frames', 1, doc.frameCount, 1);
  const co = a.opts.get('cells');
  // cells=: only those cells' rows, side by side; without it, the whole sheet (the original form).
  const cells: [number, number][] = [];
  if (co && co.value !== 'none') for (const n of co.value.split(',')) {
    const c = cellAt(n);
    if (!c) throw new DiagError(co.line, co.vcol, `family band from=: '${n}' is not a cell of the sheet (a variant, inside, outside or <cx>:<cy>)`);
    cells.push(c);
  }
  const rowW = co ? cells.length * t : W, nRows = co ? (cells.length ? nf * t : 0) : nf * sheetH;
  const rowsIn = blk?.rows ?? [];
  if (rowsIn.length !== nRows || rowsIn.some((r) => r.text.length !== rowW)) {
    const at = blk ?? co!;
    throw new DiagError(at.line, at.col, `family band from=: the rows must be ${nf} frame${nf === 1 ? '' : 's'} of ${rowW}x${co ? t : sheetH}${co ? ` (the ${cells.length} cells side by side)` : ''}`);
  }
  const keyIndex = new Map(doc.palette.entries.map((e, i) => [e.key, i]));
  const px = rowsIn.map((r) => [...r.text].map((ch, k) => {
    if (ch === '.') return TRANSPARENT;
    const v = keyIndex.get(ch);
    if (v === undefined) throw new DiagError(r.line, r.col + k, `'${ch}' is not a key in palette '${doc.palette.name}'`);
    return v;
  }));
  const geometry = { inset, radius, bands, ...(fillet !== undefined ? { fillet } : {}), ...(jit ? { jitter: { px: jit, seed } } : {}) };
  return {
    text: `band from=${from.value} ${parts.join(' ')} radius=${radius} inset=${inset}${fillet !== undefined ? ` fillet=${fillet}` : ''}${jit ? ` jitter=${jit} seed=${seed}` : ''} detached=${det} frames=${nf}${co ? ` cells=${co.value}` : ''}${rowsIn.length ? ` <<\n${blockText(rowsIn.map((r) => r.text))}>>` : ''}`,
    run: (d) => {
      const fam = d.family!;
      fam.geometry = geometry;
      fam.detached = s.variants.map((x) => x.name).filter((n) => detachedList.includes(n));
      const bl = layerIndex(d, BAND_LAYER);
      if (bl < 0) return;
      // Linked cels are written once.
      const seen = new Set<Uint16Array>();
      for (let fr = 0; fr < nf; fr++) {
        const cel = d.cels[bl]![fr]!;
        if (seen.has(cel)) continue;
        seen.add(cel);
        if (!co) { for (let y = 0; y < sheetH; y++) for (let x = 0; x < W; x++) cel[y * W + x] = px[fr * sheetH + y]![x]!; continue; }
        // The recorded cells; every other cell is cleared, and the family builds its variants again after the line.
        cel.fill(TRANSPARENT, 0, sheetH * W);
        cells.forEach(([cx, cy], k) => {
          for (let y = 0; y < t; y++) for (let x = 0; x < t; x++) cel[(cy * t + y) * W + cx * t + x] = px[fr * t + y]![k * t + x]!;
        });
      }
    },
  };
}

function bandCmd(a: Args, doc: Doc, f: FamilyState, ctx: NormaliseContext): { text: string; run: (d: Doc) => void } {
  const items = a.rest();
  if (!items.length) throw new DiagError(a.cmd.line, a.cmd.col, `family band: give the band from the edge in, as <width>:<colour|outside|inside> (e.g. 3:outside 1:foam 2:sand1)`);
  const bands: Band[] = [];
  const parts: string[] = [];
  for (const t of items) {
    const raw = t.t === 'word' ? t.v : '';
    const m = /^(\d+):(.+)$/.exec(raw);
    if (!m) throw new DiagError(t.line, t.col, `family band: expected <width>:<colour|outside|inside>, like 2:foam`);
    const w = Number(m[1]);
    if (w < 1) throw new DiagError(t.line, t.col, `family band: a width is at least 1`);
    let fill: BandFill;
    let name: string;
    if (m[2] === 'outside' || m[2] === 'inside') { fill = m[2]; name = m[2]; } else {
      const c = resolveColour(m[2]!, doc.palette, t.line, t.col + m[1]!.length + 1);
      if (c.index === TRANSPARENT) throw new DiagError(t.line, t.col, `family band: a band needs a colour, outside or inside (not none)`);
      fill = c.index; name = c.name;
    }
    bands.push({ w, fill });
    parts.push(`${w}:${name}`);
  }
  const fillets = !!schemeOf(f).fillets;
  onlyOpts(a, 'family band', fillets ? ['radius', 'inset', 'draw', 'fillet', 'jitter', 'seed'] : ['radius', 'inset', 'draw', 'jitter', 'seed']);
  const h = f.tile / 2;
  const radius = intOpt(a, 'radius', 0, h, 0);
  const inset = intOpt(a, 'inset', 0, h - 1, f.geometry.inset);
  const draw = a.choice('draw', ['on', 'off'], 'on') === 'on';
  const total = bands.reduce((s, b) => s + b.w, 0);
  if (inset + total + radius > h) {
    throw new DiagError(a.cmd.line, a.cmd.col, `family band: the inset (${inset}), the band (${total}) and the corner radius (${radius}) must fit in half a tile (${h} px)`);
  }
  // A fillet scheme rounds inner corners: by what the family had, else the band's width, unless told.
  const fillet = fillets ? intOpt(a, 'fillet', 1, h, f.geometry.fillet ?? Math.min(h, total || 1)) : undefined;
  // Jitter: band edges move in and out by up to n px (a seeded field that repeats every tile).
  const jitter = intOpt(a, 'jitter', 0, Math.max(0, h - inset - total - radius), 0);
  if (!jitter && a.opts.get('seed')) throw new DiagError(a.opts.get('seed')!.line, a.opts.get('seed')!.col, `family band: seed= goes with jitter=`);
  const seed = jitter ? (a.opts.get('seed') ? intOpt(a, 'seed', 1, 0x7fffffff, 1) : ctx.newSeed()) : 0;
  const geometry = { inset, radius, bands, ...(fillet !== undefined ? { fillet } : {}), ...(jitter ? { jitter: { px: jitter, seed } } : {}) };
  return {
    text: `band ${parts.join(' ')} radius=${radius} inset=${inset}${fillet !== undefined ? ` fillet=${fillet}` : ''}${jitter ? ` jitter=${jitter} seed=${seed}` : ''} draw=${draw ? 'on' : 'off'}`,
    run: (d) => {
      const fam = d.family!;
      fam.geometry = geometry;
      const bl = layerIndex(d, BAND_LAYER);
      if (!draw || bl < 0) return;
      // Route 1: draw the band's colours on every piece; the variants follow from them.
      const s = schemeOf(fam);
      const t = fam.tile;
      const L = layoutOf(fam);
      const maps = bandMaps(s, t, geometry);
      // Face pieces (south, side, corner) are the face's own art, drawn by hand outside the terrain: the band leaves them.
      const pieces = s.pieces.map((p) => s.byName.get(p)!).filter((v) => !isFace(s.variants[v]!.on));
      const seen = new Set<Uint16Array>();
      for (const cel of d.cels[bl]!) {
        if (seen.has(cel)) continue;
        seen.add(cel);
        for (const v of pieces) {
          const [cx, cy] = L.cells[v]!;
          for (let y = 0; y < t; y++) for (let x = 0; x < t; x++) {
            const b = maps[v]![y * t + x]!;
            const fill = b >= 0 && b < bands.length ? bands[b]!.fill : 'inside';
            cel[(cy * t + y) * d.width + cx * t + x] = typeof fill === 'number' ? fill : TRANSPARENT;
          }
        }
      }
    },
  };
}

/** `family texture inside|outside [from=<asset>] [frame=<n>] << rows >>`: the rows are what is drawn; from= says where they came from. */
function textureCmd(a: Args, doc: Doc, f: FamilyState, ctx: NormaliseContext): { text: string; run: (d: Doc, by: string) => void } {
  const which = a.take('word', 'inside or outside');
  if (which.v !== 'inside' && which.v !== 'outside') throw new DiagError(which.line, which.col, `family texture: expected inside or outside`);
  const block = a.peek()?.t === 'block' ? a.take('block', 'texture rows') : null;
  a.done();
  onlyOpts(a, 'family texture', ['from', 'frame']);
  const t = f.tile;
  const from = a.opts.get('from');
  const frameOpt = a.opts.get('frame');
  let rows: string[];
  let frameN = 1;
  if (block) {
    rows = block.rows.map((r) => r.text);
    if (frameOpt) frameN = intOpt(a, 'frame', 1, 4096, 1);
  } else {
    if (!from) throw new DiagError(a.cmd.line, a.cmd.col, `family texture: give from=<tile asset> or the rows in a block`);
    const src = ctx.asset?.(from.value);
    if (!src) throw new DiagError(from.line, from.vcol, `family texture: no asset '${from.value}' to copy from`);
    if (src.width !== t || src.height !== t) throw new DiagError(from.line, from.vcol, `family texture: '${from.value}' is ${src.width}x${src.height}, the family's tiles are ${t}x${t}`);
    frameN = intOpt(a, 'frame', 1, src.frameCount, 1);
    const px = flatten(src, frameN - 1);
    // Colours by name (else by exact colour) into the family's palette.
    const map = src.palette.entries.map((e) => {
      let i = doc.palette.entries.findIndex((x) => x.name === e.name);
      if (i < 0) i = doc.palette.entries.findIndex((x) => x.hex === e.hex);
      return i;
    });
    const missing = [...new Set([...px].filter((v) => v !== TRANSPARENT && map[v]! < 0).map((v) => src.palette.entries[v]!.name))];
    if (missing.length) throw new DiagError(from.line, from.vcol, `family texture: ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not in palette '${doc.palette.name}' (palette add first)`);
    rows = Array.from({ length: t }, (_, y) => Array.from({ length: t }, (_, x) => {
      const v = px[y * t + x]!;
      return v === TRANSPARENT ? ' ' : doc.palette.entries[map[v]!]!.key;
    }).join(''));
  }
  if (rows.length !== t || rows.some((r) => [...r].length !== t)) throw new DiagError(block?.line ?? a.cmd.line, block?.col ?? a.cmd.col, `family texture: the rows must be ${t} rows of ${t} keys`);
  const keyIndex = new Map(doc.palette.entries.map((e, i) => [e.key, i]));
  const px = new Uint16Array(t * t);
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    const i = ch === ' ' ? TRANSPARENT : keyIndex.get(ch);
    if (i === undefined) {
      const row = block?.rows[y];
      throw new DiagError(row?.line ?? a.cmd.line, (row?.col ?? a.cmd.col) + x, `family texture: '${ch}' is not a key in palette '${doc.palette.name}'`);
    }
    px[y * t + x] = i;
  }));
  const [cx, cy] = familyCell(f, which.v)!;
  return {
    text: `texture ${which.v}${from ? ` from=${from.value} frame=${frameN}` : ''} <<\n${blockText(rows)}>>`,
    run: (d, by) => {
      const gl = layerIndex(d, GROUND_LAYER);
      if (gl < 0) return;
      const cel = d.cels[gl]![ctxOf(d, by).frame]!;
      for (let y = 0; y < t; y++) cel.set(px.subarray(y * t, y * t + t), (cy * t + y) * d.width + cx * t);
    },
  };
}

const familyCmd: CommandSpec = {
  name: 'family',
  summary: 'family band <w>:<colour|outside|inside>… [radius=<r>] [inset=<n>] [draw=on|off] | family texture inside|outside from=<tile> [frame=<n>] | ' +
    'family detach|attach <variant>|all | family coverage [seed=<n>] [copies=<n>] [fill=on|off] | family cut [textures=on|off]',
  normalise(cmd, ctx) {
    const { doc, f } = familyOf(cmd, ctx);
    const a = new Args(cmd, ['radius', 'inset', 'fillet', 'jitter', 'draw', 'from', 'frame', 'seed', 'copies', 'fill', 'textures', 'detached', 'frames', 'cells']);
    noFlags(a);
    const how = a.take('word', 'band, texture, detach, attach, coverage or cut');
    const s = schemeOf(f);
    if (how.v === 'band' && a.opts.get('from')) {
      const r = bandFrom(a, doc, f, ctx);
      return { text: `family ${r.text}`, op: fn((d) => r.run(d)) };
    }
    if (f.bandOf && ['cut', 'detach', 'attach'].includes(how.v)) throw new DiagError(how.line, how.col, `family ${how.v}: '${doc.name}' inherits its band from '${f.bandOf}': do it there, or make the band its own (variant of=${f.bandOf} band=own)`);
    if (how.v === 'band' && f.bandOf) throw new DiagError(how.line, how.col, `family band: '${doc.name}' inherits its band from '${f.bandOf}' (variant of=${f.bandOf} band=inherit): fix the band there, or make it its own (variant of=${f.bandOf} band=own)`);
    if (how.v === 'band') {
      const r = bandCmd(a, doc, f, ctx);
      return { text: `family ${r.text}`, op: fn((d) => r.run(d)) };
    }
    if (how.v === 'texture') {
      const r = textureCmd(a, doc, f, ctx);
      return { text: `family ${r.text}`, op: fn(r.run) };
    }
    if (how.v === 'detach' || how.v === 'attach') {
      const v = a.take('word', 'a variant name or all');
      a.done();
      onlyOpts(a, `family ${how.v}`, []);
      const pieces = new Set(s.pieces);
      let names: string[];
      if (v.v === 'all') names = s.variants.map((x) => x.name).filter((n) => !pieces.has(n));
      else {
        if (!s.byName.has(v.v)) throw new DiagError(v.line, v.col, `${s.name} has no variant '${v.v}'`);
        if (pieces.has(v.v)) throw new DiagError(v.line, v.col, `'${v.v}' is a piece: pieces are always drawn by hand (the other variants are built from them)`);
        names = [v.v];
      }
      const on = how.v === 'detach';
      return {
        text: `family ${how.v} ${v.v}`,
        op: fn((d) => {
          const fam = d.family!;
          const set = new Set(fam.detached);
          for (const n of names) if (on) set.add(n); else set.delete(n);
          fam.detached = s.variants.map((x) => x.name).filter((n) => set.has(n));
        }),
      };
    }
    if (how.v === 'coverage') {
      a.done();
      onlyOpts(a, 'family coverage', ['seed', 'copies', 'fill']);
      if (!f.mapCols) throw new DiagError(cmd.line, cmd.col, `family coverage: this family has no map area (new family … map=<C>x<R>)`);
      const seedOpt = a.opts.get('seed');
      const seed = seedOpt ? intOpt(a, 'seed', 1, 0x7fffffff, 1) : ctx.newSeed();
      const copies = intOpt(a, 'copies', 1, 8, 1);
      const fill = a.choice('fill', ['on', 'off'], 'off') === 'on';
      const terrain = coverageTerrain(s, f.mapCols, f.mapRows, seed, copies);
      if (!terrain) throw new DiagError(cmd.line, cmd.col, `family coverage: no ${f.mapCols}x${f.mapRows} layout with every variant ${copies > 1 ? `${copies} times ` : ''}was found from seed ${seed} (try another seed, fewer copies, or a bigger map)`);
      return {
        text: `family coverage seed=${seed} copies=${copies} fill=${fill ? 'on' : 'off'}`,
        op: fn((d) => {
          const fam = d.family!;
          fam.terrain = terrain.cells.slice();
          const L = layoutOf(fam);
          const t = fam.tile;
          // The flat template on a reference layer: inside, outside and the band in flat colours.
          let tl = layerIndex(d, 'template');
          if (tl < 0) {
            d.layers.unshift(newLayer('template', { reference: true }));
            d.cels.unshift(Array.from({ length: d.frameCount }, () => new Uint16Array(d.width * d.height).fill(TRANSPARENT)));
            remapCtx(d, (l) => l + 1, (fr) => fr);
            tl = 0;
          }
          const gl = layerIndex(d, GROUND_LAYER);
          const maps = bandMaps(s, t, fam.geometry);
          const g = fam.geometry;
          for (let fr = 0; fr < d.frameCount; fr++) {
            const inC = modeColour(d, fr, L.inside[0], L.inside[1], t);
            const outC = modeColour(d, fr, L.outside[0], L.outside[1], t);
            const img = composeMap(d, terrain, fr);
            const cel = d.cels[tl]![fr]!;
            img.variants.forEach((v, i) => {
              const mx = i % fam.mapCols, my = L.mapRow + Math.floor(i / fam.mapCols);
              for (let y = 0; y < t; y++) for (let x = 0; x < t; x++) {
                const b = v === null ? -1 : maps[v]![y * t + x]!;
                const band = b >= 0 && b < g.bands.length ? g.bands[b]!.fill : null;
                const c = typeof band === 'number' ? band : b < 0 || band === 'outside' ? outC : inC;
                cel[(my * t + y) * d.width + mx * t + x] = c;
              }
            });
            if (fill && gl >= 0) {
              const gc = d.cels[gl]![fr]!;
              for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) gc[(L.mapRow * t + y) * d.width + x] = img.px[y * img.w + x]!;
            }
          }
        }),
      };
    }
    if (how.v === 'cut') {
      a.done();
      onlyOpts(a, 'family cut', ['textures']);
      if (!f.terrain.length) throw new DiagError(cmd.line, cmd.col, `family cut: lay out the coverage map first (family coverage), then paint it`);
      if (!f.geometry.bands.length) throw new DiagError(cmd.line, cmd.col, `family cut: the band's widths say what to keep from the map (family band … draw=off first)`);
      const textures = a.choice('textures', ['on', 'off'], 'off') === 'on';
      const terrain = { cols: f.mapCols, rows: f.mapRows, cells: f.terrain };
      const counts = variantCounts(s, terrain);
      const missing = reachable(s).filter((v) => !counts[v]).map((v) => s.variants[v]!.name);
      if (missing.length) throw new DiagError(cmd.line, cmd.col, `family cut: the map has no tile of ${missing.join(', ')} (lay it out again with family coverage)`);
      return { text: `family cut textures=${textures ? 'on' : 'off'}`, op: fn((d) => { cutFamily(d, textures); }) };
    }
    throw new DiagError(how.line, how.col, `family: expected band, texture, detach, attach, coverage or cut`);
  },
};

const ANCHOR_RE = /^(-?\d+),(-?\d+)$/;

const overlayCmd: CommandSpec = {
  name: 'overlay',
  summary: 'overlay set [mode=cycle|pingpong|wave|sparkle] [on=outside|inside|all] [anchor=<x,y>|centre] [spread=<dx>x<dy>] [every=<n>] [rest=<ticks>] [seed=<n>]   (how an overlay plays over a map\'s tiles)',
  normalise(cmd, ctx) {
    const doc = needDoc(cmd, ctx);
    if (!doc.overlay) throw new DiagError(cmd.line, cmd.col, `overlay: '${doc.name}' is not an overlay (new overlay <name> <W>x<H>)`);
    const a = new Args(cmd, ['mode', 'on', 'anchor', 'spread', 'every', 'rest', 'seed']);
    noFlags(a);
    const how = a.take('word', 'set');
    if (how.v !== 'set') throw new DiagError(how.line, how.col, `overlay: expected set`);
    a.done();
    const cur = doc.overlay;
    const mode = a.choice('mode', [...OVERLAY_MODES], cur.mode) as OverlayMode;
    const on = a.choice('on', ['outside', 'inside', 'all'], cur.on) as OverlayState['on'];
    let anchor = cur.anchor;
    const an = a.opts.get('anchor');
    if (an) {
      const m = ANCHOR_RE.exec(an.value);
      if (an.value === 'centre' || an.value === 'center') anchor = null;
      else if (m) anchor = [Number(m[1]), Number(m[2])];
      else throw new DiagError(an.line, an.vcol, `anchor= must be a pixel x,y in the tile, or centre`);
    }
    let spread = cur.spread;
    const sp = a.opts.get('spread');
    if (sp) {
      const m = /^(\d+)x(\d+)$/.exec(sp.value);
      if (!m) throw new DiagError(sp.line, sp.vcol, `spread= must be like 4x2 (pixels either way across and down)`);
      spread = [Number(m[1]), Number(m[2])];
    }
    const every = intOpt(a, 'every', 1, 1000, cur.every);
    const rest = intOpt(a, 'rest', 0, 100000, cur.rest);
    const seed = intOpt(a, 'seed', 1, 0x7fffffff, cur.seed);
    const st: OverlayState = { mode, on, anchor, spread: [spread[0], spread[1]], every, rest, seed };
    return {
      text: `overlay set mode=${mode} on=${on} anchor=${anchor ? `${anchor[0]},${anchor[1]}` : 'centre'} spread=${spread[0]}x${spread[1]} every=${every} rest=${rest} seed=${seed}`,
      op: fn((d) => { d.overlay = { ...st, anchor: st.anchor ? [st.anchor[0], st.anchor[1]] : null, spread: [st.spread[0], st.spread[1]] }; }),
    };
  },
};

for (const c of [familyCmd, overlayCmd]) registerCommand(c);
