// Family and overlay commands (plan §4.2, §4.3): the band profile (route 1), the textures, detaching
// variants for hand work, the coverage map (route 3's flat template) and cutting from it, and an
// overlay's settings. The pieces (route 2) are drawn with the ordinary commands on the band layer,
// addressed by name: `layer band ; paint @cell(o) 0,0 << … >>`.

import { blockText, fn, needDoc, registerCommand, resolveColour, Args, type CommandSpec, type NormaliseContext } from './commands.ts';
import { OVERLAY_MODES, TRANSPARENT, ctxOf, flatten, newLayer, remapCtx, type Doc, type FamilyState, type OverlayMode, type OverlayState } from './doc.ts';
import {
  BAND_LAYER, GROUND_LAYER, bandMaps, composeMap, coverageTerrain, cutFamily, familyCell, layoutOf, schemeOf, variantCounts,
} from './family.ts';
import { DiagError, type ParsedCommand } from './parser.ts';
import { reachable, type Band, type BandFill } from './schemes.ts';

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

function bandCmd(a: Args, doc: Doc, f: FamilyState): { text: string; run: (d: Doc) => void } {
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
  onlyOpts(a, 'family band', fillets ? ['radius', 'inset', 'draw', 'fillet'] : ['radius', 'inset', 'draw']);
  const h = f.tile / 2;
  const radius = intOpt(a, 'radius', 0, h, 0);
  const inset = intOpt(a, 'inset', 0, h - 1, f.geometry.inset);
  const draw = a.choice('draw', ['on', 'off'], 'on') === 'on';
  const total = bands.reduce((s, b) => s + b.w, 0);
  if (inset + total + radius > h) {
    throw new DiagError(a.cmd.line, a.cmd.col, `family band: the inset (${inset}), the band (${total}) and the corner radius (${radius}) must fit in half a tile (${h} px)`);
  }
  // A fillet scheme rounds inner corners into the outside cell, by the band's width unless told.
  const fillet = fillets ? intOpt(a, 'fillet', 1, h, Math.min(h, total || 1)) : undefined;
  const geometry = { inset, radius, bands, ...(fillet !== undefined ? { fillet } : {}) };
  return {
    text: `band ${parts.join(' ')} radius=${radius} inset=${inset}${fillet !== undefined ? ` fillet=${fillet}` : ''} draw=${draw ? 'on' : 'off'}`,
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
      const pieces = s.pieces.map((p) => s.byName.get(p)!);
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
    const a = new Args(cmd, ['radius', 'inset', 'fillet', 'draw', 'from', 'frame', 'seed', 'copies', 'fill', 'textures']);
    noFlags(a);
    const how = a.take('word', 'band, texture, detach, attach, coverage or cut');
    const s = schemeOf(f);
    if (how.v === 'band') {
      const r = bandCmd(a, doc, f);
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
