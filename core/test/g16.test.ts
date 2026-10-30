// G16 (plan §26): art help, in core. Item 1: the `pebbles` and `tufts` generators: seeded, lit
// from the style guide's light, wrap-safe (the looks of one ground share what crosses their edges),
// and at 16, 24 and 48 px a mixed floor of four looks passes jaggies, repetition and lattice with
// the defaults. Item 2: the face scheme's side faces, inner corners and alternate looks; the lane
// scheme (a filled path with a plain middle, and diagonal turns).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_SCHEMES, composeMapDoc, coverageTemplate, flatten, mapWorld, parsePaletteJson, resolveVariant, runBatch, runChecks, type AssetState, type Doc, type PaletteSource, type StyleDefaults } from '../src/index.ts';
import { pebbleShape, tuftShape } from '../src/cmd-structure.ts';

const MOSSY = parsePaletteJson(readFileSync(join(import.meta.dirname, '..', '..', 'examples', 'src', 'mossy-ruins.json'), 'utf8'));
const pals: PaletteSource = { get: (n) => (n === MOSSY.name ? MOSSY : undefined), defaultName: MOSSY.name };
const EMPTY: AssetState = { doc: null, entries: [] };
function run(state: AssetState, text: string, docs: Record<string, Doc> = {}, defaults: StyleDefaults = { light: 'nw' }): AssetState {
  const r = runBatch(state, text, { by: 'test', palettes: pals, assets: (n) => docs[n], assetNames: () => Object.keys(docs), defaults });
  if (!r.ok) throw new Error(r.errors.map((e) => `${e.line}:${e.col}: ${e.message}`).join('\n'));
  return r.state;
}
const ix = (n: string) => MOSSY.entries.findIndex((e) => e.name === n);
const lastCmd = (st: AssetState) => st.entries.at(-1)!.cmd;

describe('item 1: pebbles and tufts', () => {
  it('normal forms: the defaults written in, the light from the style guide, sizes from the cell', () => {
    const p = run(EMPTY, 'new tile g 24x24 bg=soil1\npebbles ramp=stone seed=3', {}, { light: 'ne' });
    expect(lastCmd(p)).toBe('pebbles 0,0 24x24 ramp=stone weights=1,1,1,1 size=3..5 density=0.3 light=ne cast=none gap=1 wrap=on edges=3 seed=3');
    const t = run(EMPTY, 'new tile g 48x48 bg=moss1\ntufts ramp=moss seed=3', {}, {});
    expect(lastCmd(t)).toBe('tufts 0,0 48x48 ramp=moss size=8..12 blades=3..5 density=0.2 light=nw foot=moss0 gap=1 wrap=on edges=3 seed=3');
    // At 16 px: smaller stones, shorter tufts of fewer blades.
    expect(lastCmd(run(EMPTY, 'new tile g 16x16 bg=soil1\npebbles ramp=stone seed=3'))).toMatch(/ size=3\.\.4 /);
    expect(lastCmd(run(EMPTY, 'new tile g 16x16 bg=moss1\ntufts ramp=moss seed=3'))).toMatch(/ size=3\.\.4 blades=2\.\.3 /);
    // Normalising a normalised line gives it back; wrap=off has no edges=.
    expect(lastCmd(run(p, lastCmd(p)))).toBe(lastCmd(p));
    expect(lastCmd(run(EMPTY, 'new tile g 24x24 bg=soil1\npebbles 4,4 16x16 ramp=stone wrap=off seed=2'))).toMatch(/ wrap=off seed=2$/);
    expect(() => run(EMPTY, 'new tile g 24x24 bg=soil1\npebbles 4,4 16x16 ramp=stone wrap=off edges=1')).toThrow(/edges= goes with wrap=on/);
    expect(() => run(EMPTY, 'new tile g 24x24 bg=soil1\npebbles ramp=soil0,soil1')).toThrow(/at least 3 colours/);
  });

  it('seeded: the same seed draws the same pixels, another seed others', () => {
    const px = (line: string) => flatten(run(EMPTY, `new tile g 24x24 bg=soil1\n${line}`).doc!, 0);
    expect(px('pebbles ramp=stone seed=5')).toEqual(px('pebbles ramp=stone seed=5'));
    expect(px('pebbles ramp=stone seed=5')).not.toEqual(px('pebbles ramp=stone seed=6'));
    expect(px('tufts ramp=moss seed=5')).not.toEqual(px('tufts ramp=moss seed=6'));
  });

  it('a pebble: a body tone, its shadow side away from the light, a lit pixel toward it; no doubled corners or strays', () => {
    const tone = { dark: ix('stone2'), body: ix('stone3'), lit: ix('stone4') };
    const at = (s: ReturnType<typeof pebbleShape>, c: number) => s.px.filter((q) => q[2] === c);
    const mean = (ps: [number, number, number][]) => [ps.reduce((a, q) => a + q[0], 0) / ps.length, ps.reduce((a, q) => a + q[1], 0) / ps.length];
    for (const [light, sx, sy] of [[[-1, -1], -1, -1], [[1, -1], 1, -1]] as const) {
      const s = pebbleShape(9, 7, [light[0], light[1]], tone);
      const [lx, ly] = mean(at(s, tone.lit)), [dx, dy] = mean(at(s, tone.dark));
      expect(Math.sign(lx - 4), `lit pixel toward ${light}`).toBe(sx);
      expect(Math.sign(ly - 3)).toBe(sy);
      expect(Math.sign(dx - 4)).toBe(-sx);
      expect(Math.sign(dy - 3)).toBe(-sy);
    }
    // Every size, alone on a tile, under several lights: jaggies 0 and orphans 0.
    for (const light of [[-1, -1], [1, -1], [0, -1], [-1, 0]] as [number, number][]) for (let w = 3; w <= 12; w++) for (const h of [w - 1 - (w >> 2), w - (w >> 2)]) {
      const s = pebbleShape(w, Math.max(2, Math.min(w, h)), light, tone);
      const rows = Array.from({ length: s.h }, (_, y) => Array.from({ length: s.w }, (_, x) => MOSSY.entries[s.px.find((q) => q[0] === x && q[1] === y)?.[2] ?? ix('soil1')]!.key).join(''));
      const d = run(EMPTY, `new tile t 24x24 bg=soil1\npaint 4,4 <<\n${rows.map((r) => `  ${r}`).join('\n')}\n>>`).doc!;
      const [j, o] = runChecks(d, ['jaggies', 'orphans']);
      expect(j!.score, `${w}x${s.h} under ${light}: ${j!.detail}`).toBe(0);
      expect(o!.score, `${w}x${s.h} under ${light}: ${o!.detail}`).toBe(0);
    }
  });

  it('a tuft: blades on the light\'s side lit, on the far side shaded, a dark foot', () => {
    const ramp = ['moss0', 'moss1', 'moss2', 'moss3', 'lichen'].map(ix);
    const t = tuftShape(5, 8, [0, 0, 0, 0, 0], [-1, -1], ramp, ix('moss0'));
    const col = (c: string) => t.px.filter((q) => q[2] === ix(c));
    const meanX = (ps: [number, number, number][]) => ps.reduce((a, q) => a + q[0], 0) / ps.length;
    expect(meanX(col('lichen'))).toBeLessThan(meanX(col('moss2')));
    expect(col('moss0').every((q) => q[1] === t.h - 1)).toBe(true);
    const lit = tuftShape(5, 8, [0, 0, 0, 0, 0], [1, -1], ramp, null);
    expect(meanX(lit.px.filter((q) => q[2] === ix('lichen')))).toBeGreaterThan(meanX(lit.px.filter((q) => q[2] === ix('moss2'))));
  });

  // Four looks of one ground (a base and three texture variants with the same edges=), filled as a
  // mix on a map: every tile passes jaggies, orphans, repetition and seam, the map passes lattice,
  // its repetition and its seam. Two seeds at each size, the generators' defaults throughout.
  const floor = (gen: 'pebbles' | 'tufts', S: number, base: number) => {
    const [bg, ramp] = gen === 'pebbles' ? ['soil1', 'stone'] : ['moss1', 'moss'];
    const docs: Record<string, Doc> = {};
    ['g', 'g_b', 'g_c', 'g_d'].forEach((n, i) => {
      docs[n] = run(EMPTY, `new tile ${n} ${S}x${S} bg=${bg}\n${i ? 'variant of=g\n' : ''}${gen} ramp=${ramp} edges=${base} seed=${base + i}`, docs).doc!;
    });
    const map = run(EMPTY, `new map floor 12x8 tile=${S}\ntiles floor fill mix=g:1,g_b:1,g_c:1,g_d:1 seed=3`, docs).doc!;
    const world = mapWorld(Object.entries(docs).map(([name, doc]) => ({ name, doc })));
    const tiles = Object.entries(docs).map(([n, d]) => ({ n, r: runChecks(d, ['jaggies', 'orphans', 'repetition', 'seam'], { world }) }));
    return { tiles, map: runChecks(map, ['lattice', 'repetition', 'seam'], { world }) };
  };
  for (const gen of ['pebbles', 'tufts'] as const) for (const S of [16, 24, 48]) {
    it(`${gen} at ${S} px: a mixed floor of four looks passes its checks with the defaults`, () => {
      for (const base of [1, 11]) {
        const f = floor(gen, S, base);
        for (const { n, r } of f.tiles) for (const c of r) expect(c.status, `${n} (edges=${base}): ${c.id} ${c.shown} ${c.detail}`).toBe('pass');
        for (const c of f.map) expect(c.status, `the map (edges=${base}): ${c.id} ${c.shown} ${c.detail}`).toBe('pass');
      }
    }, 60_000);
  }

  it('the looks of one ground share what crosses their edges, so any two join with nothing cut', () => {
    for (const [gen, bg, ramp] of [['pebbles', 'soil1', 'stone'], ['tufts', 'moss1', 'moss']] as const) {
      const look = (seed: number) => flatten(run(EMPTY, `new tile t 24x24 bg=${bg}\n${gen} ramp=${ramp} edges=4 seed=${seed}`).doc!, 0);
      const ground = ix(bg);
      // Where art runs across an edge: both pixels either side of it are art (shapes keep a gap, so
      // two that merely touch the edge from either side never meet there).
      const across = (px: Uint16Array) => {
        const out: string[] = [];
        for (let k = 0; k < 24; k++) {
          if (px[k * 24 + 23] !== ground && px[k * 24] !== ground) out.push(`row ${k}: ${px[k * 24 + 23]} ${px[k * 24]}`);
          if (px[23 * 24 + k] !== ground && px[k] !== ground) out.push(`column ${k}: ${px[23 * 24 + k]} ${px[k]}`);
        }
        return out;
      };
      const a = look(4), b = look(9), c = look(17);
      expect(across(a).length, gen).toBeGreaterThan(0);
      expect(across(b), gen).toEqual(across(a));
      expect(across(c), gen).toEqual(across(a));
      expect(b).not.toEqual(a);
    }
  });
});

describe('item 2: faces of a cliff, and lanes', () => {
  const T = 16;
  const face = BUILTIN_SCHEMES.get('face')!;
  const N = 1, NE = 2, E = 4, SE = 8, S = 16, SW = 32, W = 64, NW = 128;
  const name = (here: boolean, bits: number) => { const v = resolveVariant(face, here, bits); return v === null ? null : face.variants[v]!.name; };
  const world = (docs: Record<string, Doc>) => mapWorld(Object.entries(docs).map(([n, doc]) => ({ name: n, doc })));

  it('the face scheme resolves south faces (ends, joins, inner corners), side faces and corners', () => {
    // South faces: below the terrain; each side ends, joins the face beside it, or meets the terrain (an inner corner).
    expect(name(false, N)).toBe('face_o');
    expect(name(false, N | NE | NW)).toBe('face_ew');
    expect(name(false, N | NE | E)).toBe('face_ie');
    expect(name(false, N | NW | W)).toBe('face_iw');
    expect(name(false, N | E | W | NE | NW)).toBe('face_ie_iw');
    expect(name(false, N | NE | NW | W)).toBe('face_e_iw');
    // Side faces: beside the terrain, not below it; joining up where the terrain goes on above, down unless it is below.
    expect(name(false, W)).toBe('side_e_s');
    expect(name(false, W | NW)).toBe('side_e_ns');
    expect(name(false, W | NW | S)).toBe('side_e_n');
    expect(name(false, W | S | SW)).toBe('side_e');
    expect(name(false, E | NE)).toBe('side_w_ns');
    expect(name(false, E | W | NE | NW)).toBe('side_ew_ns');
    // Corners: the terrain diagonally above only.
    expect(name(false, NW)).toBe('corner_e');
    expect(name(false, NE)).toBe('corner_w');
    expect(name(false, NE | NW)).toBe('corner_ew');
    expect(name(false, SE)).toBeNull();
    // Inside the terrain nothing changed: blob47.
    expect(name(true, 255)).toBe('nesw_ne_se_sw_nw');
    expect(face.variants.filter((v) => v.on === 'face' && v.key !== null)).toHaveLength(9);
    expect(face.variants.filter((v) => v.on === 'side')).toHaveLength(14);
    expect(face.variants.filter((v) => v.alt).map((v) => `${v.name}:${v.alt}`)).toEqual(['face_ew_b:face_ew', 'face_ew_c:face_ew', 'side_e_ns_b:side_e_ns', 'side_w_ns_b:side_w_ns']);
  });

  // A cliff: the top moss, the outside grass; its face pieces painted (rock, darker on the west side).
  const cliffLines = [`new family cliff ${T}x${T} scheme=face`, `rect @cell(inside) 0,0 ${T}x${T} c=moss3 fill`, `rect @cell(outside) 0,0 ${T}x${T} c=moss1 fill`, 'family band 1:ink 1:moss2', 'layer band',
    ...['face_o', 'face_ew', 'face_ie_iw'].map((n) => `rect @cell(${n}) 0,0 ${T}x10 c=stone2 fill`),
    ...['side_e', 'side_e_ns'].map((n) => `rect @cell(${n}) 0,0 4x${T} c=stone2 fill`),
    ...['side_w', 'side_w_ns'].map((n) => `rect @cell(${n}) ${T - 4},0 4x${T} c=stone1 fill`),
    'rect @cell(corner_ew) 0,0 4x10 c=stone2 fill', `rect @cell(corner_ew) ${T - 4},0 4x10 c=stone1 fill`];
  const cliff = run(EMPTY, cliffLines.join('\n')).doc!;
  const plateau = `terrain top paint 1,1 <<
  ######..
  ######..
  ##..###.
  ##......
>>`;

  for (const outside of ['on', 'off']) {
    it(`side faces and corners are drawn beside the terrain with outside=${outside}`, () => {
      const floor = run(EMPTY, `new tile floor ${T}x${T} bg=soil1`).doc!;
      const docs = { cliff, floor };
      const st = run(EMPTY, `new map m 10x8 tile=${T}\ntiles floor fill floor\nlayer add top terrain=cliff outside=${outside}\n${plateau}`, docs);
      const c = composeMapDoc(st.doc!, world(docs));
      const at = (x: number, y: number) => c.top[y * 10 + x]?.variant ?? '-';
      const px = (cx: number, cy: number, x: number, y: number) => c.palette[c.px[(cy * T + y) * c.w + cx * T + x]!]!.name;
      // East of the plateau's east side: a side face on the cell's west edge; west of it, on the east edge.
      expect(at(7, 1)).toMatch(/^side_e/);
      expect(px(7, 1, 1, 8)).toBe('stone2');
      expect(px(7, 1, 10, 8)).toBe(outside === 'on' ? 'moss1' : 'soil1');
      expect(at(0, 2)).toMatch(/^side_w/);
      expect(px(0, 2, T - 2, 8)).toBe('stone1');
      // Below the east side's foot, past the south face's end: a corner. In the notch: inner corners.
      expect(at(0, 5)).toBe('corner_w');
      expect(px(0, 5, T - 2, 3)).toBe('stone1');
      expect([at(3, 3), at(4, 3)]).toEqual(['face_e_iw', 'face_ie_w']);
      expect(px(3, 3, 8, 3)).toBe('stone2');
    });
  }

  it('alternate looks of the long middles: placed by the cell, the middle\'s copy until detached and drawn', () => {
    const docs = { cliff };
    const long = run(EMPTY, `new map m 14x3 tile=${T}\nlayer add top terrain=cliff outside=on\nterrain top rect 0,0 14x1`, docs).doc!;
    const names = composeMapDoc(long, world(docs)).top.slice(14, 28).map((x) => x!.variant);
    expect(new Set(names.filter((n) => /^face_ew/.test(n!)))).toEqual(new Set(['face_ew', 'face_ew_b', 'face_ew_c']));
    const block = (d: Doc, cx: number) => { const c = composeMapDoc(long, world({ cliff: d })); return Array.from({ length: T * T }, (_, i) => c.px[(T + Math.floor(i / T)) * c.w + cx * T + (i % T)]).join(','); };
    // Not yet drawn: every look shows the middle's art.
    const looks = new Set(names.map((_, x) => block(cliff, x)).filter((_, x) => /^face_ew/.test(names[x]!)));
    expect(looks.size).toBe(1);
    const drawn = run({ doc: cliff, entries: [] }, 'family detach face_ew_b\nlayer band\nrect @cell(face_ew_b) 5,3 3x2 c=stone4 fill').doc!;
    const after = new Set(names.map((_, x) => block(drawn, x)).filter((_, x) => /^face_ew/.test(names[x]!)));
    expect(after.size).toBe(2);
  });

  it('the coverage template draws side faces and corners', () => {
    const t = coverageTemplate(face, { tile: 8, inside: [120, 160, 80], outside: [60, 90, 160] })!;
    const cells = t.variants.flatMap((v, i) => (v !== null && (face.variants[v]!.on === 'side' || face.variants[v]!.on === 'corner') ? [i] : []));
    expect(cells.length).toBeGreaterThan(4);
    for (const i of cells) {
      const v = face.variants[t.variants[i]!]!;
      const q = v.quads.findIndex((k) => k !== 'out');
      const x = (i % t.cols) * 8 + (q & 1 ? 6 : 1), y = Math.floor(i / t.cols) * 8 + (q & 2 ? 6 : 1);
      expect(Array.from(t.img.data.subarray((y * t.img.width + x) * 4, (y * t.img.width + x) * 4 + 3)), v.name).not.toEqual([60, 90, 160]);
    }
  });

  // A lane on soil through grass: band 1:outside 1:soil0 1:soil1.
  const laneOf = (scheme: string) => run(EMPTY, `new family l ${T}x${T} scheme=${scheme}\nrect @cell(inside) 0,0 ${T}x${T} c=soil2 fill\nrect @cell(outside) 0,0 ${T}x${T} c=moss2 fill\nfamily band 1:outside 1:soil0 1:soil1`).doc!;
  const compose = (fam: Doc, rows: string[]) => {
    const st = run(EMPTY, `new map m ${rows[0]!.length}x${rows.length} tile=${T}\nlayer add road terrain=l outside=on\nterrain road paint 0,0 <<\n${rows.map((r) => `  ${r}`).join('\n')}\n>>`, { l: fam });
    return composeMapDoc(st.doc!, world({ l: fam }));
  };

  it('a lane three cells wide has a plain middle; the path scheme shows the grass at every inside corner', () => {
    const rows = ['.....', '.###.', '.###.', '.###.', '.....'];
    const grass = (c: ReturnType<typeof compose>) => {
      let n = 0;
      for (let y = 2 * T - 4; y < 3 * T + 4; y++) for (let x = 2 * T - 4; x < 3 * T + 4; x++) if (c.palette[c.px[y * c.w + x]!]!.name === 'moss2') n++;
      return n;
    };
    const lane = compose(laneOf('lane'), rows);
    expect(lane.top[2 * 5 + 2]!.variant).toBe('nesw_ne_se_sw_nw');
    expect(grass(lane)).toBe(0);
    expect(grass(compose(laneOf('path'), rows))).toBeGreaterThan(0);
  });

  it('a lane turns diagonally: a strip runs to the corner, clean 45° steps, joined by the cells beside it', () => {
    const c = compose(laneOf('lane'), ['......', '.#....', '..#...', '...#..', '....#.', '......']);
    expect(c.top.map((x) => x!.variant).filter((v) => v !== 'outside')).toEqual(expect.arrayContaining(['o_se', 'o_se_nw', 'o_nw', 'd_sw', 'd_ne']));
    // The lane's pixels (everything but grass) from the first cell to the last are one 4-connected piece.
    const lane = (i: number) => c.palette[c.px[i]!]!.name !== 'moss2';
    const seen = new Set<number>([(T + 8) * c.w + T + 8]);
    const stack = [...seen];
    while (stack.length) {
      const i = stack.pop()!;
      for (const j of [i - 1, i + 1, i - c.w, i + c.w]) if (j >= 0 && j < c.px.length && !seen.has(j) && lane(j)) { seen.add(j); stack.push(j); }
    }
    expect(seen.has((4 * T + 8) * c.w + 4 * T + 8)).toBe(true);
    // Along the strip, every row crosses the same run: grass, the soil0 edge (one pixel), soil1, the inside, and back.
    const runs = (y: number) => {
      const out: string[] = [];
      for (let x = 0; x < c.w; x++) { const n = c.palette[c.px[y * c.w + x]!]!.name; if (out.at(-1)?.startsWith(n) !== true) out.push(`${n}`); else out[out.length - 1] = n; }
      return out.join(' ');
    };
    const widths = new Set<string>();
    for (let y = 2 * T; y < 4 * T; y++) {
      expect(runs(y), `row ${y}`).toBe('moss2 soil0 soil1 soil2 soil1 soil0 moss2');
      const row = Array.from({ length: c.w }, (_, x) => c.palette[c.px[y * c.w + x]!]!.name);
      widths.add(`${row.filter((n) => n === 'soil0').length},${row.filter((n) => n !== 'moss2').length}`);
    }
    expect(widths).toEqual(new Set(['2,' + [...widths][0]!.split(',')[1]]));
  });
});
