// G15 (plan §26) in core. Item 3: the lattice check measures colour difference (ΔE), not
// lightness alone, and weighs a repeated mark by how much of its cell's marking it is (marks matched
// by their centres, not grown by the tolerance), so a puddle grid fails and a dense pebble floor of
// forks that share their border passes, while Fern Ledge's floor still fails and passes after its mix.
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

describe('item 3: the lattice check sees colour, and a dense texture\'s shared border is not a lattice', () => {
  it('keeps G14\'s result: Fern Ledge\'s floor fails as it stands and passes after its mix', () => {
    const g13 = { bed: bed('bed', 3, [6, 9]), bed_b: bed('bed_b', 41, null, 'bed') };
    const before = lattice(run(EMPTY, 'new map floor 12x8 tile=16\ntiles floor fill bed', g13).doc!, g13);
    expect(before.status).toBe('fail');
    expect(before.score).toBeCloseTo(0.5, 2);
    expect(before.detail).toMatch(/a mark at 6,9 3x2 of the cell \(bed ×\d+\) comes back on the tile pitch/);
    const docs = { ...g13, bed_c: bed('bed_c', 52, [2, 3], 'bed'), bed_d: bed('bed_d', 61, null, 'bed') };
    const after = lattice(run(EMPTY, 'new map floor 12x8 tile=16\ntiles floor fill mix=bed:1,bed_b:2,bed_c:1,bed_d:1 seed=7', docs).doc!, docs);
    expect(after.status, after.detail).toBe('pass');
    expect(after.score!).toBeLessThanOrEqual(0.3);
  });

  it('a grid of blue puddles on brown of about the same lightness fails (ΔL* alone scored it 0%)', () => {
    expect(Math.abs(lstar(hex('pool')) - lstar(hex('soil1')))).toBeLessThan(18);
    const [l1, a1, b1] = lab(hex('pool')), [l2, a2, b2] = lab(hex('soil1'));
    expect(Math.hypot(l1 - l2, a1 - a2, b1 - b2)).toBeGreaterThan(18);
    const puddle = run(EMPTY, 'new tile puddle 24x24 bg=soil1\nnoise 0,0 24x24 ramp=soil weights=1,6,3 density=0.2 base=soil1 seed=5\nellipse 8,9 8x6 c=pool fill').doc!;
    const r = lattice(run(EMPTY, 'new map floor 12x8 tile=24\ntiles floor fill puddle', { puddle }).doc!, { puddle });
    expect(r.status).toBe('fail');
    expect(r.shown).toBe('100%');
    expect(r.detail).toMatch(/^a mark at 8,9 8x6 of the cell \(puddle ×96\) comes back on the tile pitch: 96 of the 96 cells/);
  });

  it('a dense 48 px pebble floor of four forks with different insides passes (the shared border alone is not a lattice)', () => {
    const shingle = (name: string, inside?: number) => run(EMPTY, [
      `new tile ${name} 48x48 bg=stone1`, ...(inside ? ['variant of=shingle'] : []),
      'stamp save pebble <<\n  .3333.\n  344443\n  344442\n  434422\n  .3222.\n>>',
      'noise 0,0 48x48 ramp=stone weights=0,6,2,0,0,0 density=0.15 base=stone1 seed=9',
      'scatter 0,0 48x48 stamp=pebble count=22 minDist=9 seed=1',
      // A fork keeps the border ring and draws its own inside.
      ...(inside ? [`rect 6,6 36x36 c=stone1 fill`, `noise 6,6 36x36 ramp=stone weights=0,6,2,0,0,0 density=0.15 base=stone1 seed=${20 + inside}`, `scatter 6,6 36x36 stamp=pebble count=10 minDist=9 seed=${30 + inside}`] : []),
    ].join('\n')).doc!;
    const docs = { shingle: shingle('shingle'), shingle_b: shingle('shingle_b', 1), shingle_c: shingle('shingle_c', 2), shingle_d: shingle('shingle_d', 3) };
    const map = run(EMPTY, 'new map floor 16x10 tile=48\ntiles floor fill mix=shingle:1,shingle_b:1,shingle_c:1,shingle_d:1 seed=3', docs).doc!;
    const r = lattice(map, docs);
    expect(r.status, r.detail).toBe('pass');
    expect(r.score!).toBeLessThan(0.15);
    // The border's pebbles are in every cell; each is a small part of its cell's marking, and the detail says so.
    expect(r.detail).toMatch(/160 of the 160 cells of shingle's ground show it at the same spot \(as \d+% of their marking, on average\)/);
    // One of those pebbles alone on the same speckled stone, in every fork, is a lattice.
    const lone = (name: string, inside?: number) => run(EMPTY, [`new tile ${name} 48x48 bg=stone1`, ...(inside ? ['variant of=shingle'] : []),
      'stamp save pebble <<\n  .3333.\n  344443\n  344442\n  434422\n  .3222.\n>>', 'noise 0,0 48x48 ramp=stone weights=0,6,2,0,0,0 density=0.15 base=stone1 seed=9', 'stamp pebble 2,40'].join('\n')).doc!;
    const plain = { shingle: lone('shingle'), shingle_b: lone('shingle_b', 1), shingle_c: lone('shingle_c', 2), shingle_d: lone('shingle_d', 3) };
    const lr = lattice(run(EMPTY, 'new map floor 16x10 tile=48\ntiles floor fill mix=shingle:1,shingle_b:1,shingle_c:1,shingle_d:1 seed=3', plain).doc!, plain);
    expect(lr.status, lr.detail).toBe('fail');
  });
});

describe('item 4: terrain on maps', () => {
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
    // border=not is G14's rule: the map's edge is outside, so a band runs round the terrain there.
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
