// G16 (plan §26): art help, in core. Item 1: the `pebbles` and `tufts` generators: seeded, lit
// from the style guide's light, wrap-safe (the looks of one ground share what crosses their edges),
// and at 16, 24 and 48 px a mixed floor of four looks passes jaggies, repetition and lattice with
// the defaults.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { flatten, mapWorld, parsePaletteJson, runBatch, runChecks, type AssetState, type Doc, type PaletteSource, type StyleDefaults } from '../src/index.ts';
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
