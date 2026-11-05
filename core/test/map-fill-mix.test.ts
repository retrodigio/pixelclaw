// `tiles <layer> fill mix=`: a seeded scatter of one-cell tiles by weight.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { composeMapDoc, mapWorld, parsePaletteJson, renderGame, runBatch, runChecks, type AssetState, type Doc, type PaletteSource } from '../src/index.ts';

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

/** A stream-bed tile as examples/ledge-agent.ts draws it: soil noise (by seed), optionally a pebble at x,y, scaled by s. */
function bed(name: string, seed: number, pebble: [number, number] | null, o: { s?: number; of?: string } = {}): Doc {
  const s = o.s ?? 1, T = 16 * s;
  const lines = [`new tile ${name} ${T}x${T} bg=soil1`, ...(o.of ? [`variant of=${o.of}`] : []),
    `noise 0,0 ${T}x${T} ramp=soil weights=1,6,3 cluster=1..${2 * s} density=0.25 base=soil1 wrap=on seed=${seed}`];
  if (pebble) {
    const [x, y] = pebble;
    lines.push(`rect ${x * s},${y * s} ${3 * s}x${2 * s} c=stone3 fill`, `rect ${x * s},${y * s} ${s}x${s} c=stone4 fill`, `rect ${(x + 2) * s},${(y + 1) * s} ${s}x${s} c=stone2 fill`);
  }
  return run(EMPTY, lines.join('\n')).doc!;
}


describe('tiles <layer> fill mix=', () => {
  const docs = {
    bed: bed('bed', 3, [6, 9]), bed_b: bed('bed_b', 41, null, { of: 'bed' }),
    bed_c: bed('bed_c', 52, [2, 3], { of: 'bed' }), gravel: bed('gravel', 9, null),
  };
  const names = () => Object.keys(docs);
  const runMix = (state: AssetState, text: string) => {
    const r = runBatch(state, text, { by: 'test', palettes: pals, assets: (n) => (docs as Record<string, Doc>)[n], assetNames: names });
    if (!r.ok) throw new Error(r.errors.map((e) => `${e.line}:${e.col}: ${e.message}`).join('\n'));
    return r.state;
  };
  const fresh = () => run(EMPTY, 'new map m 12x8 tile=16');
  const shown = (st: AssetState) => {
    const c = runChecks(st.doc!, ['coverage'], { world: world(docs) });
    expect(c[0]!.status).toBe('pass');
    return st.doc!;
  };

  it('scatters several tiles by weight, seeded, written into the line (each cell shows the tile drawn for it)', () => {
    const st = runMix(fresh(), 'tiles floor fill mix=bed:1,bed_b:2,bed_c:2 seed=7');
    const line = st.entries.at(-1)!.cmd;
    expect(line).toBe('tiles floor fill mix=bed:1,bed_b:2,bed_c:2 0,0 12x8 cells=1x1 anchor=0,0 variants=named seed=7');
    const d = shown(st);
    const li = d.layers.findIndex((l) => l.name === 'floor');
    const counts = new Map<string, number>();
    for (const v of d.cels[li]![0]!) { const e = d.map!.entries[v]!; expect(e.exact).toBe(true); counts.set(e.name, (counts.get(e.name) ?? 0) + 1); }
    // The counts follow the weights (1:2:2 of 96: about 19, 38, 38), as closely as the neighbour rule allows.
    const want = { bed: 19.2, bed_b: 38.4, bed_c: 38.4 };
    for (const [n, w] of Object.entries(want)) expect(Math.abs(counts.get(n)! - w), JSON.stringify([...counts])).toBeLessThanOrEqual(4);
    expect(counts.get('bed')! + counts.get('bed_b')! + counts.get('bed_c')!).toBe(96);
    // The same line again (its normal form) gives the same map, without reading any asset.
    const again = run(fresh(), line);
    expect([...again.doc!.cels[li]![0]!]).toEqual([...d.cels[li]![0]!]);
    // Each cell is drawn as named, not re-picked among bed's variants.
    const c = composeMapDoc(d, world(docs));
    d.cels[li]![0]!.forEach((v, i) => expect(c.top[i]!.asset).toBe(d.map!.entries[v]!.name));
  });

  it('no two equal neighbours where it can help it', () => {
    const d = runMix(fresh(), 'tiles floor fill mix=bed:1,bed_b:1,bed_c:1,gravel:1 seed=3').doc!;
    const li = d.layers.findIndex((l) => l.name === 'floor');
    const cel = d.cels[li]![0]!;
    let same = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 12; x++) {
      if (x > 0 && cel[y * 12 + x] === cel[y * 12 + x - 1]) same++;
      if (y > 0 && cel[y * 12 + x] === cel[(y - 1) * 12 + x]) same++;
    }
    expect(same).toBe(0);
  });

  it('a tile\'s weight is shared with its texture variants the mix does not name (variants=named keeps to the names)', () => {
    expect(runMix(fresh(), 'tiles floor fill mix=bed:3,gravel:1 seed=1').entries.at(-1)!.cmd).toMatch(/mix=bed:1,bed_b:1,bed_c:1,gravel:1 /);
    expect(runMix(fresh(), 'tiles floor fill mix=bed:2,bed_c:1 seed=1').entries.at(-1)!.cmd).toMatch(/mix=bed:1,bed_b:1,bed_c:1 /);
    expect(runMix(fresh(), 'tiles floor fill mix=bed:3,gravel:1 variants=named seed=1').entries.at(-1)!.cmd).toMatch(/mix=bed:3,gravel:1 /);
  });

  it('fills a box, leaves what is placed (or replaces it), and refuses what is not a one-cell tile', () => {
    const st = runMix(run(fresh(), 'place gravel 0,0 layer=floor', docs), 'tiles floor fill mix=bed,bed_b 0,0 3x2 seed=2');
    const d = st.doc!;
    const li = d.layers.findIndex((l) => l.name === 'floor');
    const at = (x: number, y: number) => { const v = d.cels[li]![0]![y * 12 + x]!; return v === 0xffff ? '-' : d.map!.entries[v]!.name; };
    expect(at(0, 0)).toBe('gravel');
    expect([at(1, 0), at(2, 0), at(0, 1)].every((n) => /^bed/.test(n))).toBe(true);
    expect(at(3, 0)).toBe('-');
    const hut = run(EMPTY, 'new object hut 32x16 cell=16x16\nrect 0,0 32x16 c=stone2 fill\nfootprint 2x1').doc!;
    const r = runBatch(fresh(), 'tiles floor fill mix=bed:1,hut:1', { by: 'test', palettes: pals, assets: (n) => (n === 'hut' ? hut : (docs as Record<string, Doc>)[n]) });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors[0]!.message).toMatch(/mix= takes one-cell tiles; 'hut'/);
    expect(() => runMix(fresh(), 'tiles floor fill bed seed=3')).toThrow(/seed= goes with mix=/);
  });

  it('the lattice check fails a fill of bed and passes a mix that moves and leaves out its pebble', () => {
    const one = runMix(fresh(), 'tiles floor fill mix=bed variants=named').doc!;
    expect(lattice(one, docs).status).toBe('fail');
    const mixed = runMix(fresh(), 'tiles floor fill mix=bed:1,bed_b:2,bed_c:1,gravel:1 seed=5').doc!;
    expect(lattice(mixed, docs).status, lattice(mixed, docs).detail).toBe('pass');
  });
});
