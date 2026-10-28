// Plan §10 G6 on the server: the anim view (contact sheet, GIF, numbers), a mirror view updated
// live through MCP, the game view with every direction, and run summaries over every frame.

import { existsSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnServer, texts, type Content, type Served } from './spawn.ts';

let s: Served;
const call = (name: string, args: Record<string, unknown>) => s.call(name, args);
const image = (c: Content) => c.find((x) => x.type === 'image');

beforeAll(async () => {
  s = await spawnServer('pixelclaw-g6-');
  await call('project', { path: s.proj });
}, 20000);

afterAll(async () => {
  await s?.close();
});

const FIG = (legs: string) => `paint 2,1 <<\n  .00.\n  0110\n  0110\n  .00.\n${legs}\n>>`;

describe('animation through MCP', () => {
  it('a run summary checks every frame and names a failing one', async () => {
    const r = await call('run', {
      asset: 'pip',
      commands: `new sprite pip 8x8\n${FIG('  0..0\n  0..0')}\nframe add empty\nframe 2\n${FIG('  .00.\n  0..0')}\npx 7,0 c=lichen`,
    });
    expect(texts(r.content)).toMatch(/orphans [\d.]+% ✗/);
    const c = await call('check', { asset: 'pip', checks: ['orphans', 'anim'] });
    const t = texts(c.content);
    expect(t).toMatch(/frame 2: .*7,0/);
    expect(t).toMatch(/✓ {2}anim/);
  });

  it('a mirror view follows its source', async () => {
    await call('run', { asset: 'pip', commands: 'frame 2\npx 7,0 c=none\nview E frames=1-2\nview W mirror=E\nframe 1\npx 2,0 c=lichen' });
    const g = await call('view', { asset: 'pip', mode: 'grid', frame: 3 });
    expect(texts(g.content).split('\n')[2]).toMatch(/^\s*0 {2}\.{5}[^.]\.{2}/);
    const bad = await call('run', { asset: 'pip', commands: 'frame 3\npx 0,0 c=ink' });
    expect(bad.isError).toBe(true);
    expect(texts(bad.content)).toMatch(/live mirror of E: draw on E \(frame 1\)/);
  });

  it('the anim view: a contact sheet inline, a GIF saved, and the numbers', async () => {
    const r = await call('view', { asset: 'pip', mode: 'anim' });
    const t = texts(r.content);
    expect(t).toMatch(/pip: 4 frames at 60 ticks\/s/);
    expect(t).toMatch(/E: cycle, frames 1,2, ticks 10,10 \(a loop is 20 ticks, 333 ms\); changed 1→2 \d+%/);
    expect(t).toMatch(/W: mirror of E/);
    const gif = /animated GIF .*: (\S+\.gif)/.exec(t)![1]!;
    expect(existsSync(gif)).toBe(true);
    expect(readFileSync(gif).subarray(0, 6).toString()).toBe('GIF89a');
    expect(image(r.content)).toBeTruthy();
  });

  it('the game view shows every direction', async () => {
    const one = await call('view', { asset: 'pip', mode: 'game', frame: 1 });
    expect(texts(one.content)).toMatch(/game: \d+x\d+ px/);
    const w = Number(/game: (\d+)x/.exec(texts(one.content))![1]);
    // Two directions of an 8 px sprite (margins 8, a gap of 8), at the draw scale 2, with 8 px padding.
    expect(w).toBe(8 + 2 * (8 + 8 + 8 + 8 + 8) + 8);
  });
});
