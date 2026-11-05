// The project's grid size (16, 24, 48 px): new maps, the camera and the draw scale follow it.

import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { BAND_LAYER, layoutOf, replay, runBatch, serializeDoc } from '@pixelclaw/core';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Writer, createProject, paletteSource } from '../src/index.ts';
import { projectSummary } from '../src/mcp.ts';
import { PALETTE } from './spawn.ts';

const root = mkdtempSync(join(tmpdir(), 'pixelclaw-g14-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));


describe('the 48 px audit (what assumed 16 or 24 px)', () => {
  const T = 48;
  const make = (name: string, grid?: number) => {
    const p = createProject(join(root, `${name}.pclaw`), { palettes: [JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'examples', 'ember-moor', 'ember-moor.json'), 'utf8'))], ...(grid ? { grid } : {}) });
    return { p, w: new Writer(p, { now: () => '2026-10-29T09:00:00Z' }) };
  };
  const ok = (r: ReturnType<Writer['run']>) => { if (!r.ok) throw new Error(r.errors.map((e) => e.message).join('; ')); return r; };
  const line = (w: Writer, a: string, re: RegExp) => w.state(a).entries.map((e) => e.cmd).find((c) => re.test(c))!;

  it('the project\'s grid: set on a project; new maps, the camera and the draw scale follow it', () => {
    const { p, w } = make('grid48');
    expect(p.json.grid).toBe(24);
    w.setGrid(T);
    expect(JSON.parse(readFileSync(join(p.dir, 'project.json'), 'utf8')).grid).toBe(48);
    expect(projectSummary(w, 'http://x')).toMatch(/grid 48 px \(new maps' tile; camera 768x432; draw scale 1x\)/);
    expect(projectSummary(w, 'http://x')).toContain('new tile <name> 48x48');
    ok(w.run({ commands: `new tile moor ${T}x${T} bg=moor2\nnoise ramp=moor weights=0,2,6,3,1 density=0.3 seed=4`, by: 'claude' }));
    ok(w.run({ commands: `new object stone ${T}x${T * 2} cell=${T}x${T}\nellipse 10,20 28x70 c=stone2 fill\noutline c=ink\nfootprint 1x1 anchor=0,0 <<\n  r\n  b\n>>`, by: 'claude' }));
    ok(w.run({ commands: `new family pool ${T}x${T} scheme=blob47\nrect @cell(inside) 0,0 ${T}x${T} c=bog1 fill\nrect @cell(outside) 0,0 ${T}x${T} c=moor2 fill\nfamily band 2:outside 2:peat1 2:bog2`, by: 'claude' }));
    // A map with no tile= takes the grid (it was always 24).
    ok(w.run({ commands: 'new map moor_map 20x12\ntiles floor fill moor\nlayer add bog terrain=pool outside=off above=floor\nterrain bog rect 3,2 5x4\nlayer add props objects above=bog\nplace stone 10,5 layer=props', by: 'claude' }));
    expect(line(w, 'moor_map', /^new map/)).toMatch(/^new map moor_map 20x12 tile=48 /);
    // The camera: 16x9 cells of the grid, at the draw scale (1x from 48 px).
    const cam = w.view('moor_map', 'map', { camera: [10, 6] });
    expect(cam.text).toMatch(/a 768x432 px screen, cells \d+,\d+ 16x9 at 1x/);
    // The family's sample map at the draw scale (it was always 2x).
    const fam = w.view('pool', 'map', {});
    if (fam.kind !== 'image') throw new Error('an image');
    expect([fam.width, fam.height]).toEqual([12 * T, 10 * T]);
    // The game view shows the scene once at 1x (not twice at the same size).
    const game = w.view('stone', 'game', {});
    if (game.kind !== 'image') throw new Error('an image');
    expect(game.height).toBeLessThan(2 * T * 2 + 8);
    // The map's cells as text: the bog painted over the filled floor shows (layers in order).
    const text = w.view('moor_map', 'map', {}).text!;
    expect(text).toMatch(/^ {2}2 {2}MMMbbbbbMM/m);
  });

  it('a project left at 24 px keeps its defaults', () => {
    const { w } = make('grid24');
    ok(w.run({ commands: 'new tile t 24x24 bg=moor2', by: 'claude' }));
    ok(w.run({ commands: 'new map m 20x12\ntiles floor fill t', by: 'claude' }));
    expect(line(w, 'm', /^new map/)).toMatch(/ tile=24 /);
    expect(w.view('m', 'map', { camera: [10, 6] }).text).toMatch(/a 384x216 px screen, cells \d+,\d+ 16x9 at 2x/);
  });
});
