// The map-scale lattice check: a mark repeated at the same spot of many cells reads as a grid.
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

describe('the map-scale lattice check', () => {
  // Fern Ledge's floor (examples/ledge-agent.ts): bed (seed 3, a pebble at 6,9) and its variant bed_b (seed 41, no pebble).
  const g13 = { bed: bed('bed', 3, [6, 9]), bed_b: bed('bed_b', 41, null, { of: 'bed' }) };
  const floor = (docs: Record<string, Doc>, s = 1) => run(EMPTY, `new map floor 12x8 tile=${16 * s}\ntiles floor fill bed`, docs).doc!;

  it('fails Fern Ledge\'s floor as it stands (the pebble at the same spot of half the cells), saying where and what to do', () => {
    const r = lattice(floor(g13), g13);
    expect(r.status).toBe('fail');
    expect(r.score!).toBeGreaterThan(0.4);
    expect(r.detail).toMatch(/a mark at 6,9 3x2 of the cell \(bed ×\d+\) comes back on the tile pitch: \d+ of the 96 cells of bed's ground/);
    expect(r.detail).toMatch(/texture variants that move or leave out the mark/);
    expect(r.groups[0]!.pts.length).toBeGreaterThan(40);
  });

  it('passes the same floor filled with a mix of variants (the pebble moved, or left out)', () => {
    const docs = { ...g13, bed_c: bed('bed_c', 52, [2, 3], { of: 'bed' }), bed_d: bed('bed_d', 61, null, { of: 'bed' }), bed_e: bed('bed_e', 70, [11, 12], { of: 'bed' }) };
    const r = lattice(floor(docs), docs);
    expect(r.status, r.detail).toBe('pass');
    expect(r.score!).toBeLessThanOrEqual(0.3);
  });

  it('a calm floor of one tile has no mark to repeat (that is repetition\'s motif)', () => {
    const docs = { bed: bed('bed', 3, null) };
    expect(lattice(floor(docs), docs).status).toBe('pass');
  });

  it('scales with the tile: the same floor at 48 px fails, and its noise specks are not marks', () => {
    const big = { bed: bed('bed', 3, [6, 9], { s: 3 }), bed_b: bed('bed_b', 41, null, { s: 3, of: 'bed' }) };
    const r = lattice(floor(big, 3), big);
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/a mark at 18,27 9x6 of the cell/);
    const calm = { bed: bed('bed', 3, null, { s: 3 }) };
    expect(lattice(floor(calm, 3), calm).score).toBe(0);
  });

  it('is a map check: skipped on a tile; its limit and contrast come from the style guide', () => {
    expect(runChecks(g13.bed, ['lattice'])[0]!.status).toBe('skip');
    const r = runChecks(floor(g13), ['lattice'], { world: world(g13), style: { checks: { lattice: { max: 0.6 } } } })[0]!;
    expect(r.status).toBe('pass');
    expect(r.limit).toBe('≤ 60%');
  });
});
