// Scenes in the manifest and what each still needs.
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

describe('scenes in the manifest', () => {
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
