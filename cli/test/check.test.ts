// pixelclaw check | review and the game and recolour views from the command line, on a copy of the language 1 fixture
// project (the chest's rivets are single pixels; the grass rows make stripes).
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main, type Io } from '../src/index.ts';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'lang1.pclaw');

function cli(args: string[]): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const io: Io = { out: (s) => { out += s; }, err: (s) => { err += s; }, stdin: () => '', now: () => '2026-10-27T12:00:00Z' };
  return { code: main(args, io), out, err };
}

let tmp: string;
let proj: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pixelclaw-check-'));
  proj = join(tmp, 'p.pclaw');
  cpSync(FIXTURE, proj, { recursive: true });
  const pj = join(proj, 'project.json');
  writeFileSync(pj, JSON.stringify({ ...JSON.parse(readFileSync(pj, 'utf8')), style: { palettes: ['mossy-ruins', 'ruins-props'], ground: 'grass' } }));
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('pixelclaw check', () => {
  it('prints the table with coordinates and exits 1 when a check fails', () => {
    const r = cli(['check', proj, 'chest']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('chest: 1 of 9 checks failing'); // margin and pieces included
    expect(r.out).toContain('✗  orphans     2.4%   ≤ 1%    9 stray px in 374 (9 lone, 0 near-orphans)');
    expect(r.out).toContain('lone pixel (no neighbour shares its colour): 7,4 17,4 6,14 17,14 6,18 17,18 6,19 6,20 16,20');
    expect(r.out).toMatch(/✓ {2}readability 1 +≥ 0.8 +edge contrast: 66 of 66 edge px differ from 'grass'/);
  });

  it('--checks picks checks; --marks writes the image with the flagged pixels', () => {
    const ok = cli(['check', proj, 'chest', '--checks', 'palette,outline']);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain('chest: all 2 checks pass');
    const m = cli(['check', proj, 'grass_b', '--marks']);
    // The faint rows still fail (the contrast-scaled limit reports the band nearest to failing).
    expect(m.out).toMatch(/✗ {2}repetition +3\.7 +≤ 3 +most visible stripe: rows 1-2, darker by ΔL\* 2\.6/);
    expect(m.out).toContain('rows 1-2: darker than the rest (ΔL* 2.6), a stripe when tiled: 0,1 3,1 12,1 13,1 19,1 22,1 23,1 9,2 10,2');
    expect(existsSync(join(proj, 'views', 'grass_b.tile3x3.png'))).toBe(true);
    expect(cli(['check', proj, '--checks', 'shiny']).code).toBe(2);
  });

  it('a run prints the check summary', () => {
    const r = cli(['run', proj, '-e', 'px 6,14 17,14 c=stone3', '--asset', 'chest']);
    expect(r.out).toMatch(/checks: palette 0 ✓ · orphans 1\.9% ✗/);
  });
});

describe('views and review', () => {
  it('game and recolour views, and marks on the render', () => {
    const g = cli(['view', proj, 'chest', 'game', 'recolour', 'render', '--marks', 'failing']);
    expect(g.code).toBe(0);
    expect(g.out).toMatch(/wrote .*chest\.game\.png \(\d+x\d+\)/);
    expect(g.out).toMatch(/wrote .*chest\.recolour\.png/);
    expect(cli(['view', proj, 'chest', 'render', '--theme', 'nope']).err).toContain(`no theme 'nope'`);
  });

  it('review writes the bundle', () => {
    const r = cli(['review', proj, 'chest', 'grass', '--name', 'props']);
    expect(r.code).toBe(0);
    const dir = join(proj, 'reviews', '2026-10-27-props');
    expect(r.out).toContain(`to ${dir}`);
    for (const f of ['rubric.md', 'palette.md', 'assets/chest.png', 'scenes/chest.png', 'tiles/grass.3x3.png']) expect(existsSync(join(dir, f))).toBe(true);
  });
});
