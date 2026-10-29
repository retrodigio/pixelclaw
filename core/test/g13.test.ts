// G13 (plan §23): fixes from the acceptance run, in core. Each test failed before its fix.
import { describe, expect, it } from 'vitest';
import { TRANSPARENT, composeMapDoc, layoutOf, mapWorld, runBatch, type AssetState, type Doc } from '../src/index.ts';
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
