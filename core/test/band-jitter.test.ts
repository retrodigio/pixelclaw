// A family band's jitter: a field that repeats every tile, so the family still joins.
import { describe, expect, it } from 'vitest';
import { BUILTIN_SCHEMES, TRANSPARENT, coverageTemplate, mapCellsText, bandMaps, decodePng, runChecks, flatten, exportItems, exportProfile, importProfile, loadProfile, type ProfileJson, composeMapDoc, deserializeDoc, layoutOf, mapChecks, mapWorld, replay, runBatch, serializeDoc, type AssetState, type Doc } from '../src/index.ts';
import { EMPTY, palettes, run } from './helpers.ts';

const T = 8;
function world(docs: Record<string, Doc>) {
  return mapWorld(Object.entries(docs).map(([name, doc]) => ({ name, doc })));
}
function runMap(state: AssetState, text: string, docs: Record<string, Doc>): AssetState {
  const r = runBatch(state, text, { by: 'test', palettes, assets: (n) => docs[n] });
  if (!r.ok) throw new Error(r.errors.map((e) => `${e.line}:${e.col}: ${e.message}`).join('\n'));
  return r.state;
}




describe('band jitter', () => {
  const T2 = 16;
  const fam = (extra: string) => run(EMPTY, `new family shore ${T2}x${T2} scheme=blob47
rect @cell(inside) 0,0 ${T2}x${T2} c=leaf fill
rect @cell(outside) 0,0 ${T2}x${T2} c=sky fill
family band 2:outside 1:ink 2:moss${extra}`);

  it('moves the band edges by a field that repeats every tile, so the family still joins', () => {
    const plain = fam('').doc!;
    const st = fam(' jitter=2 seed=4');
    const d = st.doc!;
    expect(st.entries.at(-1)!.cmd).toBe('family band 2:outside 1:ink 2:moss radius=0 inset=0 jitter=2 seed=4 draw=on');
    const s = BUILTIN_SCHEMES.get('blob47')!;
    const n = s.byName.get('ew')!; // joined east and west: a band along its top and bottom
    // The plain band's ink row is straight; the jittered one is not, and stays within 2 px of it.
    const inkRows = (g: typeof d) => Array.from({ length: T2 }, (_, x) => {
      const m = bandMaps(s, T2, g.family!.geometry)[n]!;
      return Array.from({ length: T2 / 2 }, (_, y) => y).filter((y) => m[y * T2 + x] === 1);
    });
    expect(new Set(inkRows(plain).map((r) => r.join())).size).toBe(1);
    const rows = inkRows(d);
    expect(new Set(rows.map((r) => r.join())).size).toBeGreaterThan(1);
    for (const r of rows) for (const y of r) expect(Math.abs(y - 2)).toBeLessThanOrEqual(2);
    // Across a tile edge the field continues: the first and last columns' rows differ by at most one.
    const first = rows[0]![0]!, last = rows[T2 - 1]![0]!;
    expect(Math.abs(first - last)).toBeLessThanOrEqual(1);
    const seam = runChecks(d, ['seam'])[0]!;
    expect(seam.status).toBe('pass');
    // Another seed is another wobble; replay is byte-identical.
    expect(flatten(fam(' jitter=2 seed=5').doc!, 0)).not.toEqual(flatten(d, 0));
    expect(serializeDoc(replay(st.entries, palettes).doc!)).toEqual(serializeDoc(d));
    expect(serializeDoc(deserializeDoc(serializeDoc(d)))).toEqual(serializeDoc(d));
    // Without a seed one is written in.
    expect(fam(' jitter=1').entries.at(-1)!.cmd).toMatch(/ jitter=1 seed=\d+ draw=on$/);
  });
});
