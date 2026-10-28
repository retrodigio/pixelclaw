// The checked-in demos: the stone floor tile (plan §10 G1), the G4 grass tile with two variants and
// the chest sprite, and G5's test sprite, with G5's fixes and review round on all of them; G6's
// walking figure and water tile, and the stone floor redrawn as flagstones; G7's sand tile, the
// shore family built from it and the water, and the glint overlay; G8's house, tree and well, the
// meadow and lane families, the village map, the variants that fixed its repetition, and the
// person's move of the well. Every
// tape must replay to the committed state and preview, running the scripts from scratch must give
// the same tape commands and pixels, and every check passes.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main, type Io } from '../src/index.ts';

const ROOT = join(import.meta.dirname, '..', '..', 'examples');
const PROJECT = join(ROOT, 'mossy-ruins.pclaw');

function cli(args: string[]): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const io: Io = { out: (s) => { out += s; }, err: (s) => { err += s; }, stdin: () => '', now: () => '2026-10-27T00:00:00Z' };
  return { code: main(args, io), out, err };
}

// In order: the shore copies its textures from the sand and the water.
const ASSETS = ['stone_floor', 'grass', 'grass_b', 'grass_c', 'chest', 'glowcap', 'walker', 'water', 'sand', 'glint', 'shore',
  'house', 'tree', 'well', 'meadow', 'lane', 'village', 'lane_b', 'lane_c', 'meadow_b', 'meadow_c', 'shore_b'];
const SAVED = ['ruins-props', 'ruins-folk', 'ruins-water', 'ruins-shore', 'ruins-village'];

const cmds = (tape: string) => tape.trim().split('\n').slice(1).map((l) => JSON.parse(l).cmd as string);

describe('examples/mossy-ruins.pclaw', () => {
  it('verifies: every tape replays to asset.json and preview.png', () => {
    const r = cli(['verify', PROJECT]);
    expect(r.err).toBe('');
    for (const a of ASSETS) expect(r.out).toContain(`ok   ${a}`);
    expect(r.code).toBe(0);
  });

  it("the scripts rebuild every asset: G4's art, G5's test sprite, the fixes and the review round", () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pixelclaw-example-'));
    try {
      const copy = join(tmp, 'mossy-ruins.pclaw');
      cpSync(PROJECT, copy, { recursive: true });
      for (const p of SAVED) rmSync(join(copy, 'palettes', `${p}.json`));
      for (const name of ASSETS) {
        const r = cli(['run', copy, join(ROOT, 'scripts', `${name}.pclaw`), '--replace']);
        expect(r.err).toBe('');
        for (const step of ['fix', 'well', 'review', 'redraw', 'g6review']) {
          const f = join(ROOT, 'scripts', `${name}_${step}.pclaw`);
          // The well was moved by a person in the watch view (the G8 demo).
          if (existsSync(f)) expect(cli(['run', copy, f, '--asset', name, ...(step === 'well' ? ['--by', 'human:chris'] : [])]).err).toBe('');
        }
        const asset = (p: string, f: string) => readFileSync(join(p, 'assets', name, f));
        expect(cmds(asset(copy, 'tape.jsonl').toString())).toEqual(cmds(asset(PROJECT, 'tape.jsonl').toString()));
        expect(JSON.parse(asset(copy, 'asset.json').toString()).state).toEqual(JSON.parse(asset(PROJECT, 'asset.json').toString()).state);
        expect(Buffer.compare(asset(copy, 'preview.png'), asset(PROJECT, 'preview.png'))).toBe(0);
      }
      // The chest, the figure, the water and the sand saved their palettes back to the project.
      for (const p of SAVED) expect(readFileSync(join(copy, 'palettes', `${p}.json`), 'utf8')).toBe(readFileSync(join(PROJECT, 'palettes', `${p}.json`), 'utf8'));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('every check passes on every asset, with the style guide in project.json', () => {
    const r = cli(['check', PROJECT]);
    expect(r.code).toBe(0);
    for (const a of ASSETS) expect(r.out).toMatch(new RegExp(`^${a}: all \\d checks pass$`, 'm'));
  });
});
