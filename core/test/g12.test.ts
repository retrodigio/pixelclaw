// G12 (plan §21): the request records and their state machine; scenes in the manifest and what
// they still need; slicing a sheet into named cells; `map gen` standing objects on the ground it
// lays (given, or the manifest's), replayed byte for byte.
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_SCHEMES, applyRequest, foldRequests, nextRequestId, occupancy, openRequests, replay, requestProblem, runBatch, sceneGaps, serializeDoc, sliceCells, sliceNames,
  validateManifest, entryBox, footprintOf, type Doc, type Manifest, type RequestRecord, type Status, type WorkRequest,
} from '../src/index.ts';
import { EMPTY, palettes, run } from './helpers.ts';

const at = '2026-10-29T10:00:00Z';
const req = (id: string, asset: string, kind: 'draw' | 'change' | 'new', note = ''): RequestRecord => ({ type: 'request', id, asset, kind, note, by: 'human:ana', at });
const ev = (type: Exclude<RequestRecord['type'], 'request'>, id: string, by = 'claude', text?: string): RequestRecord => ({ type, id, by, at, ...(text !== undefined ? { text } : {}) });

describe('requests (§21 item 1)', () => {
  it('open → claimed → progress → done', () => {
    const { requests, problems } = foldRequests([req('r1', 'urn', 'draw'), ev('claim', 'r1'), ev('progress', 'r1', 'claude', 'blocked in the shape'), ev('done', 'r1', 'claude', 'drew it; checks pass')]);
    expect(problems).toEqual([]);
    expect(requests.get('r1')).toMatchObject({ state: 'done', claimedBy: 'claude', latest: 'drew it; checks pass', question: null });
    expect(requests.get('r1')!.events.map((e) => e.type)).toEqual(['claim', 'progress', 'done']);
  });

  it('blocked asks a question; a reply opens it again; cancel withdraws it', () => {
    const { requests } = foldRequests([req('r1', 'goat', 'draw'), ev('claim', 'r1'), ev('blocked', 'r1', 'claude', 'horns or none?'), ev('reply', 'r1', 'human:ana', 'small horns')]);
    expect(requests.get('r1')).toMatchObject({ state: 'open', claimedBy: null, question: null, latest: 'small horns' });
    const m = new Map(requests);
    applyRequest(m, ev('cancel', 'r1', 'human:ana'));
    expect(m.get('r1')!.state).toBe('cancelled');
  });

  it('records that do not fit the state are refused', () => {
    const base = foldRequests([req('r1', 'urn', 'draw'), req('r2', 'kiln', 'change', 'more glow'), ev('claim', 'r2')]).requests;
    const no = (r: RequestRecord) => expect(requestProblem(base, r)).not.toBeNull();
    no(req('r1', 'urn', 'draw')); // the id is taken
    no(req('r3', 'Urn!', 'draw')); // not an asset name
    no(req('r3', 'urn', 'change', ' ')); // a change says what
    no({ ...req('r3', 'urn', 'draw'), kind: 'paint' } as unknown as RequestRecord);
    no(ev('done', 'r1')); // not claimed
    no(ev('progress', 'r1', 'claude', 'x'));
    no(ev('claim', 'r2', 'other')); // claude has it
    no(ev('done', 'r2', 'other', 'x'));
    no(ev('done', 'r2', 'claude')); // no text
    no(ev('blocked', 'r2', 'claude', ''));
    no(ev('reply', 'r2', 'human:ana', 'x')); // not blocked
    no(ev('claim', 'r9'));
    expect(requestProblem(base, ev('claim', 'r2'))).toBeNull(); // claiming again is harmless
    const done = foldRequests([req('r1', 'urn', 'draw'), ev('claim', 'r1'), ev('done', 'r1', 'claude', 'ok')]).requests;
    expect(requestProblem(done, ev('cancel', 'r1', 'human:ana'))).toMatch(/already finished/);
    expect(requestProblem(done, ev('claim', 'r1'))).toMatch(/only an open request/);
  });

  it('a file with a bad line skips it and says so; ids and the queue order', () => {
    const { requests, problems } = foldRequests([req('r1', 'urn', 'draw'), ev('done', 'r1', 'claude', 'x'), req('r2', 'goat', 'new'), req('r3', 'kiln', 'draw'), ev('claim', 'r3'), req('r5', 'jar', 'draw')]);
    expect(problems).toEqual(['record 2: r1 is open: claim it before finishing it']);
    expect(nextRequestId(requests)).toBe('r6');
    expect(nextRequestId(new Map<string, WorkRequest>())).toBe('r1');
    expect(openRequests(requests).map((q) => q.id)).toEqual(['r1', 'r2', 'r5', 'r3']);
  });
});

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

describe('scenes in the manifest (§21 item 5)', () => {
  it('validates names, uses and the map', () => {
    expect(validateManifest(MANIFEST).errors).toEqual([]);
    const bad = { ...MANIFEST, scenes: [{ name: 'a', uses: ['ghost'], map: 'urn', extra: 1 }, { name: 'a', uses: 'urn' }, 'x'] };
    expect(validateManifest(bad).errors.map((e) => `${e.path}: ${e.message}`)).toEqual([
      "scenes[0].extra: unknown field 'extra' (fields: name, description, uses, map)",
      "scenes[0].uses: no asset 'ghost' in the manifest",
      "scenes[0].map: 'urn' is a sprite, not a map",
      "scenes[1].name: scene 'a' is already listed",
      'scenes[1].uses: a list of asset names',
      'scenes[2]: a scene is { "name", "description", "uses": [...], "map" }',
    ]);
  });

  it('gaps: what is not drawn, and what is drawn but failing, including the map and what it uses', () => {
    const m = validateManifest(MANIFEST).manifest as Manifest;
    const st: Record<string, Status> = { clay: 'exported', lane: 'drafted', urn: 'planned', kiln: 'checked', yard: 'planned' };
    expect(sceneGaps(m, m.scenes![0]!, (n) => st[n]!)).toEqual({ needs: ['clay', 'urn', 'lane', 'kiln', 'yard'], missing: ['urn', 'yard'], unfinished: ['lane'] });
    expect(sceneGaps(m, m.scenes![1]!, (n) => st[n]!).missing).toEqual(['urn']);
  });
});

describe('slicing a sheet (§21 item 4)', () => {
  it('cells in reading order with an offset and a gap', () => {
    expect(sliceCells(52, 27, { cell: [16, 12], offset: [2, 1], gap: [1, 1] })).toEqual([
      { col: 0, row: 0, x: 2, y: 1 }, { col: 1, row: 0, x: 19, y: 1 }, { col: 2, row: 0, x: 36, y: 1 },
      { col: 0, row: 1, x: 2, y: 14 }, { col: 1, row: 1, x: 19, y: 14 }, { col: 2, row: 1, x: 36, y: 14 },
    ]);
    expect(sliceCells(10, 10, { cell: [11, 4] })).toEqual([]);
  });

  it('names from a pattern or a list, never twice', () => {
    const cells = sliceCells(48, 24, { cell: [24, 24] });
    expect(sliceNames(cells, { base: 'Ground Sheet' })).toEqual(['ground_sheet_1', 'ground_sheet_2']);
    expect(sliceNames(cells, { base: 'g', pattern: 'tile_{col}_{row}' })).toEqual(['tile_0_0', 'tile_1_0']);
    expect(sliceNames(cells, { base: 'g', names: ['moss', 'rock', 'extra'] })).toEqual(['moss', 'rock']);
    expect(sliceNames(cells, { base: 'g', names: ['moss'] })).toMatch(/2 cells but only 1 names/);
    expect(sliceNames(cells, { base: 'g', pattern: 'same' })).toMatch(/comes out twice/);
  });
});

describe('map gen places objects (§21 item 6)', () => {
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
