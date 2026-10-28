// The checked-in demos: the stone floor tile (plan §10 G1), and the G4 grass tile with two variants
// and the chest sprite. Every tape must replay to the committed state and preview, and running
// the scripts from scratch must give the same tape commands and pixels.
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

const cmds = (tape: string) => tape.trim().split('\n').slice(1).map((l) => JSON.parse(l).cmd as string);

describe('examples/mossy-ruins.pclaw', () => {
  it('verifies: every tape replays to asset.json and preview.png', () => {
    const r = cli(['verify', PROJECT]);
    expect(r.err).toBe('');
    for (const a of ['stone_floor', 'grass', 'grass_b', 'grass_c', 'chest']) expect(r.out).toContain(`ok   ${a}`);
    expect(r.code).toBe(0);
  });

  it('the G4 scripts rebuild the grass tile, its variants and the chest', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pixelclaw-example-'));
    try {
      const copy = join(tmp, 'mossy-ruins.pclaw');
      cpSync(PROJECT, copy, { recursive: true });
      rmSync(join(copy, 'palettes', 'ruins-props.json'));
      for (const name of ['grass', 'grass_b', 'grass_c', 'chest']) {
        const r = cli(['run', copy, join(ROOT, 'scripts', `${name}.pclaw`), '--replace']);
        expect(r.err).toBe('');
        const asset = (p: string, f: string) => readFileSync(join(p, 'assets', name, f));
        expect(cmds(asset(copy, 'tape.jsonl').toString())).toEqual(cmds(asset(PROJECT, 'tape.jsonl').toString()));
        expect(JSON.parse(asset(copy, 'asset.json').toString()).state).toEqual(JSON.parse(asset(PROJECT, 'asset.json').toString()).state);
        expect(Buffer.compare(asset(copy, 'preview.png'), asset(PROJECT, 'preview.png'))).toBe(0);
      }
      // The chest saved its palette back to the project.
      expect(readFileSync(join(copy, 'palettes', 'ruins-props.json'), 'utf8')).toBe(readFileSync(join(PROJECT, 'palettes', 'ruins-props.json'), 'utf8'));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('the stone floor script rebuilds the same tile', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pixelclaw-example-'));
    try {
      const copy = join(tmp, 'mossy-ruins.pclaw');
      cpSync(PROJECT, copy, { recursive: true });
      const r = cli(['run', copy, join(ROOT, 'scripts', 'stone_floor.pclaw'), '--replace']);
      expect(r.code).toBe(0);
      const asset = (p: string, f: string) => readFileSync(join(p, 'assets', 'stone_floor', f));
      expect(cmds(asset(copy, 'tape.jsonl').toString())).toEqual(cmds(asset(PROJECT, 'tape.jsonl').toString()));
      expect(JSON.parse(asset(copy, 'asset.json').toString()).state).toEqual(JSON.parse(asset(PROJECT, 'asset.json').toString()).state);
      expect(Buffer.compare(asset(copy, 'preview.png'), asset(PROJECT, 'preview.png'))).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
