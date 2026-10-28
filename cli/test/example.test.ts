// The checked-in demo (plan §10 G1): the stone floor tile must replay to the committed state and
// preview, and running its script from scratch must give the same tape commands and pixels.
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
    expect(r.out).toContain('ok   stone_floor');
    expect(r.code).toBe(0);
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
