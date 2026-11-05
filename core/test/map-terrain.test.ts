// Terrain layers on maps: the map's border rule, an inside drawn as a mix of tiles, and a two-tile
// mix that is not a strict checkerboard.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { composeMapDoc, deserializeDoc, lab, lstar, mapWorld, parsePaletteJson, runBatch, runChecks, schemeOf, serializeDoc, type AssetState, type Doc, type PaletteSource } from '../src/index.ts';
import { TEST_PALETTE as TEST } from './helpers.ts';

const MOSSY = parsePaletteJson(readFileSync(join(import.meta.dirname, '..', '..', 'examples', 'src', 'mossy-ruins.json'), 'utf8'));
const pals: PaletteSource = { get: (n) => (n === MOSSY.name ? MOSSY : undefined), defaultName: MOSSY.name };
const EMPTY: AssetState = { doc: null, entries: [] };
function run(state: AssetState, text: string, docs: Record<string, Doc> = {}): AssetState {
  const r = runBatch(state, text, { by: 'test', palettes: pals, assets: (n) => docs[n] });
  if (!r.ok) throw new Error(r.errors.map((e) => `${e.line}:${e.col}: ${e.message}`).join('\n'));
  return r.state;
}
const world = (docs: Record<string, Doc>) => mapWorld(Object.entries(docs).map(([name, doc]) => ({ name, doc })));
const lattice = (map: Doc, docs: Record<string, Doc>) => runChecks(map, ['lattice'], { world: world(docs) })[0]!;
const hex = (n: string) => MOSSY.entries.find((e) => e.name === n)!.hex;

/** examples/demo-g13's stream bed (as in g14.test.ts): soil noise, optionally a pebble at x,y. */
function bed(name: string, seed: number, pebble: [number, number] | null, of?: string): Doc {
  const lines = [`new tile ${name} 16x16 bg=soil1`, ...(of ? [`variant of=${of}`] : []),
    `noise 0,0 16x16 ramp=soil weights=1,6,3 cluster=1..2 density=0.25 base=soil1 wrap=on seed=${seed}`];
  if (pebble) {
    const [x, y] = pebble;
    lines.push(`rect ${x},${y} 3x2 c=stone3 fill`, `px ${x},${y} c=stone4`, `px ${x + 2},${y + 1} c=stone2`);
  }
  return run(EMPTY, lines.join('\n')).doc!;
}


describe('terrain on maps', () => {
  const T = 8;
  const pal = { get: (n: string) => (n === TEST.name ? TEST : undefined), defaultName: TEST.name };
  const mk = (text: string, docs: Record<string, Doc> = {}) => {
    const r = runBatch(EMPTY, text, { by: 'test', palettes: pal, assets: (n) => docs[n], assetNames: () => Object.keys(docs) });
    if (!r.ok) throw new Error(r.errors.map((e) => `${e.line}:${e.col}: ${e.message}`).join('\n'));
    return r.state;
  };
  const land = mk(`new family land ${T}x${T} scheme=blob47\nrect @cell(inside) 0,0 ${T}x${T} c=leaf fill\nrect @cell(outside) 0,0 ${T}x${T} c=sky fill\nfamily band 1:outside 1:moss`).doc!;
  const variantsOf = (layer: string, docs: Record<string, Doc>) => {
    const st = mk(`new map m 6x4 tile=${T}\n${layer}\nterrain ground rect 0,0 3x4`, docs);
    const c = composeMapDoc(st.doc!, mapWorld(Object.entries(docs).map(([name, doc]) => ({ name, doc }))));
    return { st, c, names: c.top.map((x) => x?.variant ?? '') };
  };

  it('the map\'s border counts as the edge cell\'s own value: terrain running off the map has no edge band along it (border=terrain|not to choose)', () => {
    // The terrain fills the left half, top to bottom: only its east side is an edge.
    const same = variantsOf('layer add ground terrain=land outside=on', { land }).names;
    expect([same[0], same[6], same[12], same[18]]).toEqual(Array(4).fill('nesw_ne_se_sw_nw'));
    expect([same[2], same[8], same[14], same[20]]).toEqual(Array(4).fill('nsw_sw_nw'));
    // border=not is the original rule: the map's edge is outside, so a band runs round the terrain there.
    const not = variantsOf('layer add ground terrain=land outside=on border=not', { land }).names;
    expect([not[0], not[1], not[6], not[18]]).toEqual(['es_se', 'esw_se_sw', 'nes_ne_se', 'ne_ne']);
    // border=terrain: past the edge is terrain. blob47 draws outside cells plain, so it reads as
    // same here; on a corner scheme the outside cells along the border take the terrain's corners.
    expect(variantsOf('layer add ground terrain=land outside=on border=terrain', { land }).names).toEqual(same);
    const corner = mk(`new family dune ${T}x${T} scheme=wang16-corner\nrect @cell(ne_se_sw_nw) 0,0 ${T}x${T} c=leaf fill\nfamily band 1:outside 1:moss`).doc!;
    const cv = (b: string) => variantsOf(`layer add ground terrain=dune outside=on${b}`, { dune: corner }).names;
    expect(cv('')[5]).toBe('o'); // wang16-corner's cell with no terrain corner
    expect(cv(' border=terrain')[5]).not.toBe('o');
    expect(cv(' border=not')[0]).not.toBe(cv('')[0]);
    // layer set changes it; the normal form names it only when it is not the default.
    const st = mk(`new map m 6x4 tile=${T}\nlayer add ground terrain=land border=same\nlayer set ground border=not\nlayer set ground border=same`, { land });
    expect(st.entries.map((e) => e.cmd)).toEqual([expect.stringMatching(/^new map m 6x4/), expect.stringMatching(/^layer add ground terrain=land outside=off above=\w+$/), 'layer set ground border=not', 'layer set ground border=same']);
    expect(st.doc!.layers.at(-1)!.map).toEqual({ kind: 'terrain', family: 'land', outside: false });
  });

  it('a terrain layer\'s inside takes mix=: its inside cells drawn as a seeded scatter of one-cell tiles, the edges from the family', () => {
    const tile = (name: string, c: string, of?: string) => mk(`new tile ${name} ${T}x${T}\n${of ? `variant of=${of}\n` : ''}rect 0,0 ${T}x${T} c=${c} fill\npx 3,3 c=ink`).doc!;
    const docs = { land, meadow: tile('meadow', 'leaf'), meadow_b: tile('meadow_b', 'moss', 'meadow'), clover: tile('clover', 'leaf') };
    const st = mk(`new map m 16x12 tile=${T}\nlayer add ground terrain=land outside=on mix=meadow:2,clover:1 seed=4\nterrain ground rect 0,0 16x12\nterrain ground rect 6,4 3x3 erase`, docs);
    // The weight of meadow is shared with its variant meadow_b (variants=spread, as tiles fill mix= does).
    expect(st.entries[1]!.cmd).toMatch(/^layer add ground terrain=land outside=on mix=meadow:1,meadow_b:1,clover:1 variants=named seed=4 above=\w+$/);
    const w = mapWorld(Object.entries(docs).map(([name, doc]) => ({ name, doc })));
    const c = composeMapDoc(st.doc!, w);
    const inside = c.top.map((x, i) => [x!, i] as const).filter(([x]) => x.variant === 'nesw_ne_se_sw_nw');
    const edges = c.top.filter((x) => x && x.variant !== 'nesw_ne_se_sw_nw' && x.variant !== 'outside');
    expect(edges.length).toBeGreaterThan(8);
    expect(edges.every((x) => x!.asset === 'land')).toBe(true);
    const n = (a: string) => inside.filter(([x]) => x.asset === a).length;
    expect(n('meadow') + n('meadow_b') + n('clover')).toBe(inside.length);
    for (const a of ['meadow', 'meadow_b', 'clover']) expect(n(a)).toBeGreaterThan(inside.length / 6);
    // The cells show the tiles' own pixels (the ink speck at 3,3 of each cell).
    const ink = c.palette.findIndex((e) => e.name === 'ink');
    const [, i0] = inside[0]!;
    expect(c.px[((Math.floor(i0 / 16) * T) + 3) * c.w + (i0 % 16) * T + 3]).toBe(ink);
    // Painting terrain elsewhere does not move a cell's choice.
    const more = runBatch(st, 'terrain ground rect 6,4 1x1', { by: 'test', palettes: pal, assets: (k) => docs[k as keyof typeof docs] });
    if (!more.ok) throw new Error('paint');
    const c2 = composeMapDoc(more.state.doc!, w);
    expect([0, 1, 16, 17, 100, 150].map((i) => c2.top[i]!.asset)).toEqual([0, 1, 16, 17, 100, 150].map((i) => c.top[i]!.asset));
    // It survives the state bytes; mix=none clears it; a mix takes only tiles.
    expect(deserializeDoc(serializeDoc(st.doc!)).layers.at(-1)!.map).toEqual(st.doc!.layers.at(-1)!.map);
    const cleared = runBatch(st, 'layer set ground mix=none', { by: 'test', palettes: pal, assets: (k) => docs[k as keyof typeof docs] });
    expect(cleared.ok && cleared.state.doc!.layers.at(-1)!.map).toEqual({ kind: 'terrain', family: 'land', outside: true });
    const bad = runBatch(EMPTY, `new map m 4x4 tile=${T}\nlayer add ground terrain=land mix=land:1`, { by: 'test', palettes: pal, assets: (k) => docs[k as keyof typeof docs] });
    expect(bad.ok ? '' : bad.errors[0]!.message).toMatch(/mix= takes one-cell tiles; 'land' is a family/);
  });

  it('blob47-round is built in, as the docs say', () => {
    const r = mk(`new family coast 24x24 scheme=blob47-round\nfamily band 2:outside 1:moss fillet=2`);
    expect(r.entries[0]!.cmd).toMatch(/^new family coast 24x24 scheme=blob47-round palette=test /);
    expect(r.entries[0]!.cmd).not.toContain('def=');
    expect(schemeOf(r.doc!.family!).variants.length).toBe(176);
  });
});

describe('a two-tile mix is not a strict checkerboard', () => {
  const docs = { bed: bed('bed', 3, [6, 9]), gravel: bed('gravel', 8, null) };
  const cells = (text: string) => {
    const d = run(EMPTY, `new map floor 12x8 tile=16\n${text}`, docs).doc!;
    const li = d.layers.findIndex((l) => l.name === 'floor');
    const cel = d.cels[li]![0]!;
    return Array.from({ length: 96 }, (_, i) => d.map!.entries[cel[i]!]!.name);
  };
  const stats = (c: string[]) => {
    let same = 0, block = 0;
    for (let i = 0; i < 96; i++) {
      const x = i % 12, left = x > 0 ? c[i - 1] : null, up = i >= 12 ? c[i - 12] : null, corner = x > 0 && i >= 12 ? c[i - 13] : null;
      if (left === c[i]) same++;
      if (up === c[i]) same++;
      if (left === c[i] && up === c[i] && corner === c[i]) block++;
    }
    return { same, block, bed: c.filter((n) => n === 'bed').length };
  };

  it('1:1 scatters with equal neighbours here and there, never a 2x2 block of one tile, and about half each', () => {
    for (const seed of [1, 2, 3, 4]) {
      const s = stats(cells(`tiles floor fill mix=bed:1,gravel:1 seed=${seed}`));
      expect(s.same, `seed ${seed}`).toBeGreaterThan(50); // a checkerboard has none; random would have about 86 of 172
      expect(s.block).toBe(0);
      expect(Math.abs(s.bed - 48)).toBeLessThanOrEqual(6);
    }
  });

  it('2:1 follows the weights; three tiles keep the original rule (no equal neighbours where it can help)', () => {
    const s = stats(cells('tiles floor fill mix=bed:2,gravel:1 seed=5'));
    expect(s.block).toBe(0);
    expect(Math.abs(s.bed - 64)).toBeLessThanOrEqual(6);
    const three = { ...docs, bed_b: bed('bed_b', 41, null, 'bed') };
    const d = run(EMPTY, 'new map floor 12x8 tile=16\ntiles floor fill mix=bed:1,bed_b:1,gravel:1 variants=named seed=5', three).doc!;
    const cel = d.cels[d.layers.findIndex((l) => l.name === 'floor')]![0]!;
    const names = Array.from({ length: 96 }, (_, i) => d.map!.entries[cel[i]!]!.name);
    expect(stats(names).same).toBe(0);
  });
});
