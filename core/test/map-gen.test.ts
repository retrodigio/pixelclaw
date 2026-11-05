// `map gen` standing objects on the ground it lays (given, or the manifest's), replayed byte for
// byte.
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_SCHEMES, applyRequest, foldRequests, nextRequestId, occupancy, openRequests, replay, requestProblem, runBatch, sceneGaps, serializeDoc, sliceCells, sliceNames,
  validateManifest, entryBox, footprintOf, type Doc, type Manifest, type RequestRecord, type Status, type WorkRequest,
} from '../src/index.ts';
import { EMPTY, palettes, run } from './helpers.ts';

const at = '2026-10-29T10:00:00Z';
const req = (id: string, asset: string, kind: 'draw' | 'change' | 'new', note = ''): RequestRecord => ({ type: 'request', id, asset, kind, note, by: 'human:ana', at });
const ev = (type: Exclude<RequestRecord['type'], 'request'>, id: string, by = 'claude', text?: string): RequestRecord => ({ type, id, by, at, ...(text !== undefined ? { text } : {}) });


const MANIFEST = {
  format: 'pixelclaw-manifest', version: 1, theme: 'A potters\' hamlet.',
  assets: [
    { name: 'clay', kind: 'tile', size: '24x24' },
    { name: 'lane', kind: 'family', size: '24x24', scheme: 'blob47' },
    { name: 'urn', kind: 'sprite', size: '24x24' },
    { name: 'kiln', kind: 'object', size: '24x48', cells: '1x1' },
    { name: 'yard', kind: 'map', size: '16x12', uses: ['lane', 'kiln'] },
  ],
  scenes: [
    { name: 'kiln_yard', description: 'the yard by the kilns', uses: ['clay', 'urn'], map: 'yard' },
    { name: 'stall', uses: ['urn'] },
  ],
};



describe('map gen places objects', () => {
  const T = 8;
  const land = run(EMPTY, `new family land ${T}x${T} scheme=blob47\nrect @cell(inside) 0,0 ${T}x${T} c=leaf fill\nrect @cell(outside) 0,0 ${T}x${T} c=sky fill\nfamily band 1:outside 1:moss`).doc!;
  const house = run(EMPTY, `new object house 16x16 cell=${T}x${T}\nrect 0,0 16x16 c=rust fill\nfootprint 2x1 anchor=0,0`).doc!;
  const well = run(EMPTY, `new object well 8x8 cell=${T}x${T}\nrect 0,0 8x8 c=stone fill\nfootprint 1x1`).doc!;
  const docs: Record<string, Doc> = { land, house, well };
  const MAP = `new map v 30x22 tile=${T}\nlayer add sea terrain=land outside=on\nlayer add ground terrain=land\nlayer add lane terrain=land\nlayer add props objects`;
  const go = (text: string, defaults?: Parameters<typeof runBatch>[2]['defaults']) => {
    const r = runBatch(EMPTY, `${MAP}\n${text}`, { by: 'test', palettes, assets: (n) => docs[n], defaults });
    if (!r.ok) throw new Error(r.errors.map((e) => e.message).join('; '));
    return r.state;
  };
  const placed = (d: Doc) => occupancy(d, d.layers.findIndex((l) => l.name === 'props')).placed.map((p) => ({ name: d.map!.entries[p.entry]!.name, x: p.x, y: p.y }));

  it('stands each object on the inner ground, off the lanes, apart, and replays', () => {
    const st = go('map gen village layers=sea,ground,lane objects=house:2,well:3 seed=4');
    const line = st.entries.at(-1)!.cmd;
    expect(line).toBe('map gen village layers=sea,ground,lane objects=house:2,well:3 layer=props fp=2x1:0,0/1x1:0,0 seed=4');
    const d = st.doc!;
    const ps = placed(d);
    expect(ps.filter((p) => p.name === 'house')).toHaveLength(2);
    expect(ps.filter((p) => p.name === 'well')).toHaveLength(3);
    const W = d.width;
    const cel = (n: string) => d.cels[d.layers.findIndex((l) => l.name === n)]![0]!;
    const ground = cel('ground'), lane = cel('lane');
    const boxes = ps.map((p) => entryBox({ name: p.name, variant: null, ...footprintOf(docs[p.name]!) }, p.x, p.y));
    for (const b of boxes) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
      expect(ground[y * W + x]).toBe(1);
      expect(lane[y * W + x]).not.toBe(1);
    }
    // A free cell between any two.
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!, b = boxes[j]!;
      expect(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y).toBe(true);
    }
    const r = replay(st.entries, palettes, { assets: (n: string) => docs[n] } as never);
    expect(r.problems).toEqual([]);
    expect(serializeDoc(r.doc!)).toEqual(serializeDoc(d));
  });

  it('without objects=, the manifest\'s objects for the map (written into the line); none: terrain only as before', () => {
    const st = go('map gen island layers=sea seed=2', { mapObjects: (m) => (m === 'v' ? ['land', 'house', 'well', 'ghost'] : []) });
    expect(st.entries.at(-1)!.cmd).toBe('map gen island layers=sea objects=house,well layer=props fp=2x1:0,0/1x1:0,0 seed=2');
    expect(placed(st.doc!).map((p) => p.name).sort()).toEqual(['house', 'well']);
    expect(go('map gen island layers=sea seed=2').entries.at(-1)!.cmd).toBe('map gen island layers=sea seed=2');
    expect(BUILTIN_SCHEMES.has('blob47')).toBe(true);
  });

  it('refuses objects with no objects layer, and unknown objects', () => {
    const r = runBatch(EMPTY, `new map m 12x10 tile=${T}\nlayer add sea terrain=land outside=on\nmap gen island objects=well seed=1`, { by: 't', palettes, assets: (n) => docs[n] });
    expect(r.ok ? [] : r.errors.map((e) => e.message)).toEqual(['map gen: the map has no objects layer to stand objects on (layer add <name> objects)']);
    const r2 = runBatch(EMPTY, `${MAP}\nmap gen island objects=ghost seed=1`, { by: 't', palettes, assets: (n) => docs[n] });
    expect(r2.ok ? [] : r2.errors.map((e) => e.message)).toEqual(["map gen: no asset 'ghost' to stand on the map"]);
  });
});
