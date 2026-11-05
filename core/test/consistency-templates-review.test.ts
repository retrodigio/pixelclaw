// Consistency on a small set (each held to the whole set's median), the face scheme's coverage
// template, and a review bundle's cells.txt.
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





describe('the smaller items', () => {
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
