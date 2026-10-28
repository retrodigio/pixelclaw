// Plan §10 G7 on the server: a family drawn through MCP (textures copied from tile assets, a band
// profile, a hand-detailed piece), the map and family views, overlays over the map, the run
// summary's family checks, and the tape replaying on verify.

import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnServer, texts, type Content, type Served } from './spawn.ts';

let s: Served;
const call = (name: string, args: Record<string, unknown>) => s.call(name, args);
const image = (c: Content) => c.find((x) => x.type === 'image');

beforeAll(async () => {
  s = await spawnServer('pixelclaw-g7-');
  await call('project', { path: s.proj });
}, 20000);

afterAll(async () => {
  await s?.close();
});

describe('families through MCP', () => {
  it('copies textures from tiles, draws a band, and every variant follows a hand-detailed piece', async () => {
    await call('run', { asset: 'soil', commands: 'new tile soil 24x24 bg=soil1\nnoise ramp=soil weights=1,4,2 seed=5' });
    await call('run', { asset: 'pond', commands: 'new tile pond 24x24 bg=pool' });
    const r = await call('run', {
      asset: 'bank', commands: 'new family bank 24x24 scheme=blob47\nfamily texture inside from=soil\nfamily texture outside from=pond\nfamily band 3:outside 1:stone4 2:stone2 radius=2',
    });
    expect(r.isError).toBeFalsy();
    const t = texts(r.content);
    expect(t).toMatch(/coverage 0 ✓/);
    expect(t).toMatch(/seam [\d.]+ ✓/);
    const h = await call('history', { asset: 'bank' });
    expect(texts(h.content)).toMatch(/family texture inside from=soil frame=1 <</);
    const p = await call('run', { asset: 'bank', commands: 'layer band\npx @cell(o) 5,5 c=ink' });
    expect(p.isError).toBeFalsy();
    const g = await call('view', { asset: 'bank', mode: 'grid', region: '24,24 24x24' });
    expect(texts(g.content)).toMatch(/k/);
  });

  it('the family view and the map view: images, the sheet in words, the seam score and the variants used', async () => {
    const f = await call('view', { asset: 'bank', mode: 'family' });
    expect(image(f.content)).toBeTruthy();
    const ft = texts(f.content);
    expect(ft).toMatch(/bank: blob47, 47 variants of 24x24; band 3:outside 1:stone4 2:stone2 radius 2 inset 0/);
    expect(ft).toMatch(/pieces \(draw these on layer band; the others are built from their quadrants\): o, nesw, ew, ns, nesw_ne_se_sw_nw/);
    const m = await call('view', { asset: 'bank', mode: 'map', size: '10x8', seed: 3 });
    expect(image(m.content)).toBeTruthy();
    const mt = texts(m.content);
    expect(mt).toMatch(/^map: \d+x\d+ px, saved .*bank\.map\.png/m);
    expect(mt).toMatch(/10x8 tiles of 24 px, a random island \(seed 3\); seam [\d.]+/);
    expect(mt).toMatch(/\d+ of 47 variants on the map: /);
    const bad = await call('view', { asset: 'soil', mode: 'family' });
    expect(bad.isError).toBe(true);
  });

  it('overlays play over the map (a GIF), and an overlay is shown on a family', async () => {
    await call('run', { asset: 'glint', commands: 'new overlay glint 4x3\npx 1,1 c=stone5\nframe add empty\nframe 2\npx 2,1 c=stone5 ; px 1,0 c=stone4\noverlay set mode=sparkle on=outside every=3 spread=6x6 rest=30' });
    const m = await call('view', { asset: 'bank', mode: 'map', with: ['glint'] });
    const t = texts(m.content);
    expect(t).toMatch(/overlays: glint \(sparkle on outside, every 3\)/);
    const gif = /animated GIF at game speed: (\S+\.gif)/.exec(t)?.[1];
    expect(gif && existsSync(gif)).toBe(true);
    const o = await call('view', { asset: 'glint', mode: 'map' });
    expect(texts(o.content)).toMatch(/\d+ of 47 variants on the map/);
    const notOverlay = await call('view', { asset: 'bank', mode: 'map', with: ['soil'] });
    expect(notOverlay.isError).toBe(true);
  });

  it('a review bundle puts each family on a map, with the tile at each place, and every variant among its neighbours', async () => {
    const r = await call('review', { assets: ['bank', 'glint', 'soil'], name: 'shore', size: '10x8', seed: 3 });
    const t = texts(r.content);
    for (const f of ['maps/bank.png', 'maps/bank.gif', 'maps/bank.tiles.txt', 'sets/bank.png', 'tiles/soil.3x3.png', 'rubric.md']) expect(t).toContain(f);
    expect(t).not.toContain('assets/bank.png');
    const dir = /review bundle: (\S+)/.exec(t)![1]!;
    const { readFileSync } = await import('node:fs');
    const tiles = readFileSync(`${dir}/maps/bank.tiles.txt`, 'utf8');
    expect(tiles.split('\n').filter((l) => /^ ?\d+: /.test(l)).length).toBe(8);
    expect(readFileSync(`${dir}/rubric.md`, 'utf8')).toMatch(/<set> map <col>,<row> <x>,<y>/);
    for (const f of ['rubric.md', 'maps/bank.tiles.txt']) expect(readFileSync(`${dir}/${f}`, 'utf8')).not.toMatch(/claude|pixelclaw|tape|derive|band profile/i);
  });

  it('cuts from a coverage map, and the tapes replay', async () => {
    const r = await call('run', {
      asset: 'cove', commands: 'new family cove 24x24 scheme=blob47 map=14x12\nfamily texture inside from=soil\nfamily texture outside from=pond\nfamily band 3:outside 1:stone4 radius=2 draw=off\nfamily coverage seed=2 fill=on\nfamily cut',
    });
    expect(r.isError).toBeFalsy();
    const c = await call('check', { asset: 'cove', checks: ['coverage'] });
    expect(texts(c.content)).toMatch(/42 detached/);
    // Verify replays every tape (the families' included) against what was saved; it only reads, so it runs beside the server.
    const { execFileSync } = await import('node:child_process');
    const { BIN } = await import('./spawn.ts');
    const out = execFileSync(process.execPath, [BIN, 'verify', s.proj], { encoding: 'utf8' });
    expect(out).toMatch(/5 assets verified/);
  }, 30000);
});
