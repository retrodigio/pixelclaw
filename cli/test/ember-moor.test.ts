// The ember-moor example (examples/ember-moor.pclaw): a small original set at 48 px, its grid 48: the
// moor ground and two texture variants, the bog water, a blob47 pool family, a waystone, and a
// 20x12 map whose floor is a mix of the moor's looks. Every tape replays; running the scripts
// again gives the same tape commands, state and previews; every check passes.
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main, type Io } from '../src/index.ts';

const ROOT = join(import.meta.dirname, '..', '..', 'examples');
const PROJECT = join(ROOT, 'ember-moor.pclaw');
const ASSETS = ['moor', 'moor_b', 'moor_c', 'bog', 'pool', 'waystone', 'moor_map'];

function cli(args: string[]): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const io: Io = { out: (s) => { out += s; }, err: (s) => { err += s; }, stdin: () => '', now: () => '2026-10-29T00:00:00Z' };
  return { code: main(args, io), out, err };
}
const cmds = (dir: string, a: string) => readFileSync(join(dir, 'assets', a, 'tape.jsonl'), 'utf8').trim().split('\n').slice(1).map((l) => JSON.parse(l).cmd as string);

describe('examples/ember-moor.pclaw (48 px)', () => {
  it('verifies, its grid is 48, and every check passes on every asset', () => {
    const v = cli(['verify', PROJECT]);
    for (const a of ASSETS) expect(v.out).toContain(`ok   ${a}`);
    expect(v.code).toBe(0);
    expect(JSON.parse(readFileSync(join(PROJECT, 'project.json'), 'utf8')).grid).toBe(48);
    const c = cli(['check', PROJECT]);
    expect(c.code).toBe(0);
    for (const a of ASSETS) expect(c.out).toMatch(new RegExp(`^${a}: all \\d+ checks pass$`, 'm'));
    // The map took its tile from the grid; its floor is a mix.
    expect(cmds(PROJECT, 'moor_map')[0]).toMatch(/^new map moor_map 20x12 tile=48 /);
    expect(cmds(PROJECT, 'moor_map')[1]).toMatch(/^tiles floor fill mix=moor:2,moor_b:2,moor_c:3 0,0 20x12 cells=1x1 anchor=0,0 variants=named seed=11$/);
  });

  it('the scripts rebuild every asset: the same commands, state and preview', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pixelclaw-ember-'));
    try {
      const copy = join(tmp, 'ember-moor.pclaw');
      cpSync(PROJECT, copy, { recursive: true });
      for (const a of ASSETS) {
        const r = cli(['run', copy, join(ROOT, 'ember-moor', 'scripts', `${a}.pclaw`), '--replace']);
        expect(r.err).toBe('');
        const f = (p: string, n: string) => readFileSync(join(p, 'assets', a, n));
        expect(cmds(copy, a)).toEqual(cmds(PROJECT, a));
        expect(JSON.parse(f(copy, 'asset.json').toString()).state).toEqual(JSON.parse(f(PROJECT, 'asset.json').toString()).state);
        expect(Buffer.compare(f(copy, 'preview.png'), f(PROJECT, 'preview.png'))).toBe(0);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 120_000);

  it('the skill notes the per-size defaults and points at this example', () => {
    const skill = readFileSync(join(ROOT, '..', 'skill', 'SKILL.md'), 'utf8');
    expect(skill).toContain('## Per-size defaults');
    expect(skill).toMatch(/project\(grid=48\)/);
    expect(skill).toMatch(/768x432 \(16x9 cells\)/);
    expect(skill).toContain('examples/ember-moor.pclaw');
  });
});
