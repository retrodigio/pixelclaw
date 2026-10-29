// G15 (plan §26) in core. Item 3: the lattice check measures colour difference (ΔE), not
// lightness alone, and weighs a repeated mark by how much of its cell's marking it is (marks matched
// by their centres, not grown by the tolerance), so a puddle grid fails and a dense pebble floor of
// forks that share their border passes, while Fern Ledge's floor still fails and passes after its mix.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lab, lstar, mapWorld, parsePaletteJson, runBatch, runChecks, type AssetState, type Doc, type PaletteSource } from '../src/index.ts';

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
