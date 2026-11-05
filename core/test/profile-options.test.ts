// Export profile options: corner order, path dead ends, and a per-colour output map read back on
// import.
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



describe('profiles: corner order, path dead ends, a per-colour output map', () => {
  const fam = (scheme: string, name = 'f') => run(EMPTY, `new family ${name} ${T}x${T} scheme=${scheme}
rect @cell(inside) 0,0 ${T}x${T} c=leaf fill
rect @cell(outside) 0,0 ${T}x${T} c=sky fill
family band 1:outside 1:moss`).doc!;
  const names = (p: ProfileJson, d: Doc) => new Map(exportItems(loadProfile(p), [d]).map((i) => [i.cell, i.name]));

  it('corners= orders the corner suffixes', () => {
    const d = fam('blob47');
    const plain = names({ name: 'p', layout: 'loose', autotile: { blob47: { template: '{asset}_{sides}{corners}' } } }, d);
    expect(plain.get('nesw_ne_se_sw_nw')).toBe('f_nesw_ne_se_sw_nw');
    const ord = names({ name: 'p', layout: 'loose', autotile: { blob47: { template: '{asset}_{sides}{corners}', corners: 'nw,ne,sw,se' } } }, d);
    expect(ord.get('nesw_ne_se_sw_nw')).toBe('f_nesw_nw_ne_sw_se');
    expect(ord.get('nes_ne_se')).toBe('f_nes_ne_se');
    expect(() => loadProfile({ name: 'p', layout: 'loose', autotile: { blob47: { corners: 'nw,ne,se' } } })).toThrow(/orders the corners/);
  });

  it('shapes name a path\'s dead ends apart from its straights', () => {
    const d = fam('path', 'lane');
    const n = names({ name: 'p', layout: 'loose', autotile: { path: { template: '{asset}_{shape}_{sides}', shapes: { end: '{asset}_end_{sides}', straight: '{asset}_{sides}' } } } }, d);
    expect([n.get('n'), n.get('ns'), n.get('ne'), n.get('nes'), n.get('nesw'), n.get('o')]).toEqual(['lane_end_n', 'lane_ns', 'lane_corner_ne', 'lane_tee_nes', 'lane_cross_nesw', 'lane_lone_']);
    expect(new Set(n.values()).size).toBe(n.size);
    expect(() => loadProfile({ name: 'p', layout: 'loose', autotile: { path: { shapes: { stub: 'x' } as never } } })).toThrow(/not a shape/);
  });

  it('colours maps palette entries to output colours or tones, and import reads them back', () => {
    const d = run(EMPTY, 'new sprite s 4x4\nrect 0,0 4x4 c=moss fill\npx 1,1 c=ink\npx 2,2 c=leaf').doc!;
    const p = loadProfile({ name: 'tones', layout: 'loose', roles: { black: '#000000', light: '#c0c0c0' }, colours: { ink: 'black', moss: '#606060', 'test.leaf': 'light' } });
    const ex = exportProfile(p, [d]);
    const img = decodePng(ex.files.get('s.png')!);
    const at = (x: number, y: number) => Array.from(img.data.subarray((y * 4 + x) * 4, (y * 4 + x) * 4 + 3)).map((v) => v.toString(16).padStart(2, '0')).join('');
    expect([at(0, 0), at(1, 1), at(2, 2)]).toEqual(['606060', '000000', 'c0c0c0']);
    const im = importProfile(p, ex.files, [d]);
    expect(Array.from(im.assets.get('s')!.frames[0]!)).toEqual(Array.from(d.cels[0]![0]!));
    expect(() => loadProfile({ name: 'x', layout: 'loose', colours: { ink: 'dark' } })).toThrow(/roles does not give a colour/);
    expect(() => loadProfile({ name: 'x', layout: 'loose', colours: { ink: 'red' } })).toThrow(/#rrggbb or a role/);
  });
});
