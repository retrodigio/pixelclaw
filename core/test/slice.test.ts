// Slicing a sheet into named cells.
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


describe('slicing a sheet', () => {
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
