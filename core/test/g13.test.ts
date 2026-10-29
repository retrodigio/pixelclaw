// G13 (plan §23): fixes from the acceptance run, in core. Each test failed before its fix.
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

describe('item 2: face cells on maps', () => {
  // A cliff (face scheme): the top is leaf, the outside sky, the face pieces painted rust.
  const cliff = run(EMPTY, `new family cliff ${T}x${T} scheme=face
rect @cell(inside) 0,0 ${T}x${T} c=leaf fill
rect @cell(outside) 0,0 ${T}x${T} c=sky fill
family band 1:outside 1:moss
layer band
rect @cell(face_o) 0,0 ${T}x5 c=rust fill
rect @cell(face_ew) 0,0 ${T}x5 c=rust fill`).doc!;
  const grass = run(EMPTY, `new tile grass ${T}x${T}\nrect 0,0 ${T}x${T} c=stone fill`).doc!;

  for (const outside of ['on', 'off']) {
    it(`a face below the terrain is drawn with outside=${outside}`, () => {
      const docs = { cliff, grass };
      const st = runMap(EMPTY, `new map m 6x6 tile=${T}

${Array.from({ length: 36 }, (_, i) => `place grass ${i % 6},${Math.floor(i / 6)} layer=floor`).join('\n')}
layer add top terrain=cliff outside=${outside}
terrain top rect 1,1 4x2`, docs);
      const c = composeMapDoc(st.doc!, world(docs));
      const W = 6 * T;
      const rust = c.palette.findIndex((p) => p.name === 'rust');
      const stone = c.palette.findIndex((p) => p.name === 'stone');
      const sky = c.palette.findIndex((p) => p.name === 'sky');
      // Row 3 is below the terrain: face cells. Their top five rows are the face's rust.
      for (let x = 1; x <= 4; x++) {
        expect(c.top[3 * 6 + x]?.variant ?? '', `cell ${x},3`).toMatch(/^face_/);
        for (let yy = 0; yy < 5; yy++) expect(c.px[(3 * T + yy) * W + x * T + 3], `cell ${x},3 row ${yy}`).toBe(rust);
        // Below the face: the layer's outside (on) or the floor under it (off).
        expect(c.px[(3 * T + 6) * W + x * T + 3]).toBe(outside === 'on' ? sky : stone);
      }
      void TRANSPARENT; void layoutOf;
    });
  }
});

describe('item 5: a fill for tiles layers; walkable ground', () => {
  const grass = run(EMPTY, `new tile grass ${T}x${T}\nrect 0,0 ${T}x${T} c=leaf fill`).doc!;
  const flag = run(EMPTY, `new tile flag ${T}x${T}\nrect 0,0 ${T}x${T} c=stone fill`).doc!;
  const hut = run(EMPTY, `new object hut ${T * 2}x${T} cell=${T}x${T}\nrect 0,0 ${T * 2}x${T} c=rust fill\nfootprint 2x1`).doc!;
  // A path family: the terrain is the path, its outside (the filled ground) grass.
  const path = run(EMPTY, `new family lane ${T}x${T} scheme=blob47
rect @cell(inside) 0,0 ${T}x${T} c=stone fill
rect @cell(outside) 0,0 ${T}x${T} c=leaf fill
family band 1:outside 1:moss`).doc!;
  const docs = { grass, flag, hut, lane: path };

  it('tiles <layer> fill lays a tile on every empty cell (or a box), leaving what is placed', () => {
    const st = runMap(EMPTY, `new map m 6x4 tile=${T}
place flag 2,1 layer=floor
tiles floor fill grass
tiles floor fill flag 4,2 2x2`, docs);
    const line = st.entries.find((e) => e.cmd.startsWith('tiles floor fill grass'))!.cmd;
    expect(line).toBe('tiles floor fill grass 0,0 6x4 cells=1x1 anchor=0,0');
    const c = composeMapDoc(st.doc!, world(docs));
    const names = c.top.map((x) => x?.asset ?? '-');
    expect(names.join(' ')).toBe(['grass grass grass grass grass grass', 'grass grass flag grass grass grass', 'grass grass grass grass grass grass', 'grass grass grass grass grass grass'].join(' '));
    // The box only fills empty cells; replace covers one-cell tiles too.
    const st2 = runMap(st, 'tiles floor fill flag 4,2 2x2 replace', docs);
    expect(composeMapDoc(st2.doc!, world(docs)).top.filter((x) => x?.asset === 'flag').length).toBe(5);
    // Replays byte for byte without the assets.
    const r = replay(st2.entries, palettes);
    expect(serializeDoc(r.doc!)).toEqual(serializeDoc(st2.doc!));
    expect(() => runMap(st, 'tiles floor fill hut', docs)).toThrow(/one-cell tiles/);
  });

  it('walkable=on: objects may stand on a terrain layer\'s filled ground', () => {
    const map = (walk: string) => runMap(EMPTY, `new map m 8x6 tile=${T}
layer add ground terrain=lane outside=on${walk}
terrain ground rect 0,2 8x1
layer add props objects
place hut 1,4 layer=props`, docs);
    const fp = (st: AssetState) => mapChecks(st.doc!, world(docs)).find((x) => x.id === 'footprint')!;
    expect(fp(map('')).pass).toBe(false);
    const st = map(' walkable=on');
    expect(st.entries[1]!.cmd).toBe('layer add ground terrain=lane outside=on walkable=on above=floor');
    expect(fp(st).pass).toBe(true);
    expect(deserializeDoc(serializeDoc(st.doc!)).layers.find((l) => l.name === 'ground')!.map).toEqual({ kind: 'terrain', family: 'lane', outside: true, walkable: true });
    // layer set turns it on and off.
    expect(fp(runMap(map(''), 'layer set ground walkable=on', docs)).pass).toBe(true);
    expect(fp(runMap(st, 'layer set ground walkable=off', docs)).pass).toBe(false);
  });
});

describe('item 6: profiles: corner order, path dead ends, a per-colour output map', () => {
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

describe('item 7: band jitter', () => {
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

describe('item 10: the smaller items', () => {
  it('consistency on a small set holds each to the whole set\'s median: only the odd one out fails', () => {
    // Outline shares 1 (all ink), 0.75 (three sides) and 0 (none) in a set of three.
    const box = (name: string, sides: string) => run(EMPTY, `new sprite ${name} 10x10\nrect 2,2 6x6 c=moss fill\n${[...sides].map((k) => ({ n: 'line 2,2 7,2', s: 'line 2,7 7,7', w: 'line 2,2 2,7', e: 'line 7,2 7,7' } as Record<string, string>)[k] + ' c=ink').join('\n')}`).doc!;
    const a = box('a', 'nsew'), b = box('b', 'nsw'), c = box('c', '');
    const set = [{ name: 'a', doc: a }, { name: 'b', doc: b }, { name: 'c', doc: c }];
    const st = (d: Doc) => runChecks(d, ['consistency'], { peers: set.filter((x) => x.doc !== d) })[0]!;
    const share = (d: Doc) => st(d).parts!.find((x) => x.name === 'outline share');
    expect(share(a)?.pass).toBe(true);
    expect(share(b)?.pass).toBe(true);
    expect(share(c)?.pass).toBe(false);
    expect(st(c).detail).toMatch(/outline share 0 against the set's median 0\.\d+ \(with 2 others\)/);
  });

  it('the face scheme\'s coverage template draws its faces', () => {
    const s = BUILTIN_SCHEMES.get('face')!;
    const t = coverageTemplate(s, { tile: 8, inside: [120, 160, 80], outside: [60, 90, 160] })!;
    const faceCells = t.variants.flatMap((v, i) => (v !== null && s.variants[v]!.on === 'face' ? [i] : []));
    expect(faceCells.length).toBeGreaterThan(0);
    for (const i of faceCells) {
      const x = (i % t.cols) * 8, y = Math.floor(i / t.cols) * 8;
      const px = (xx: number, yy: number) => Array.from(t.img.data.subarray(((y + yy) * t.img.width + x + xx) * 4, ((y + yy) * t.img.width + x + xx) * 4 + 3));
      expect(px(3, 1)).not.toEqual([60, 90, 160]); // the face, not the outside
      expect(px(3, 6)).toEqual([60, 90, 160]); // below it, the outside
    }
  });

  it('a review\'s cells.txt names the ground each cell shows and the objects on it', () => {
    const grass = run(EMPTY, `new tile grass ${T}x${T}\nrect 0,0 ${T}x${T} c=leaf fill`).doc!;
    const hut = run(EMPTY, `new object hut ${T * 2}x${T} cell=${T}x${T}\nrect 0,0 ${T * 2}x${T} c=rust fill\nfootprint 2x1`).doc!;
    const lake = run(EMPTY, `new family lake ${T}x${T} scheme=blob47\nrect @cell(inside) 0,0 ${T}x${T} c=sky fill\nrect @cell(outside) 0,0 ${T}x${T} c=moss fill\nfamily band 1:outside 1:ink`).doc!;
    const docs = { grass, hut, lake };
    const st = runMap(EMPTY, `new map m 6x3 tile=${T}
tiles floor fill grass
layer add water terrain=lake outside=off
terrain water rect 4,0 2x3
layer add props objects
place hut 1,1 layer=props`, docs);
    const txt = mapCellsText(st.doc!, composeMapDoc(st.doc!, world(docs)));
    const rows = txt.split('\n').slice(3).map((r) => r.slice(5));
    expect(rows).toEqual(['ggggll', 'gH+gll', 'ggggll']);
    expect(txt.split('\n')[0]).toBe("cells (columns across, rows down; g grass, l lake, H hut, + under an object, . nothing):");
  });
});
