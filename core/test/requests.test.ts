// Request records and their state machine (open, claimed, blocked, done, cancelled), folded from
// requests.jsonl.
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_SCHEMES, applyRequest, foldRequests, nextRequestId, occupancy, openRequests, replay, requestProblem, runBatch, sceneGaps, serializeDoc, sliceCells, sliceNames,
  validateManifest, entryBox, footprintOf, type Doc, type Manifest, type RequestRecord, type Status, type WorkRequest,
} from '../src/index.ts';
import { EMPTY, palettes, run } from './helpers.ts';

const at = '2026-10-29T10:00:00Z';
const req = (id: string, asset: string, kind: 'draw' | 'change' | 'new', note = ''): RequestRecord => ({ type: 'request', id, asset, kind, note, by: 'human:ana', at });
const ev = (type: Exclude<RequestRecord['type'], 'request'>, id: string, by = 'claude', text?: string): RequestRecord => ({ type, id, by, at, ...(text !== undefined ? { text } : {}) });

describe('requests', () => {
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
