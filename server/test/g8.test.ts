// Plan §10 G8 on the server: a map painted and furnished through MCP (objects with footprints, a
// family's terrain, a road, scatter, map gen), its views (the whole map, a region, the camera, an
// object on its ground), the map checks in the run summary, a person's move read through
// `changes`, the review bundle's scenes, the Tiled and split exports, and verify.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openPage, spawnServer, texts, wsUrl, type Content, type Served } from './spawn.ts';

let s: Served;
const call = (name: string, args: Record<string, unknown>) => s.call(name, args);
const image = (c: Content) => c.find((x) => x.type === 'image');

beforeAll(async () => {
  s = await spawnServer('pixelclaw-g8-');
  await call('project', { path: s.proj });
}, 20000);

afterAll(async () => {
  await s?.close();
});

describe('maps through MCP', () => {
  it('objects with footprints, a family as terrain, and a map built from them', async () => {
    const setup: [string, string][] = [
      ['soil', 'new tile soil 24x24 bg=soil1\nnoise ramp=soil weights=1,4,2 seed=5'],
      ['pond', 'new tile pond 24x24 bg=pool'],
      ['bank', 'new family bank 24x24 scheme=blob47\nfamily texture inside from=soil\nfamily texture outside from=pond\nfamily band 3:outside 1:stone4 2:stone2 radius=2'],
      ['hut', 'new object hut 48x48 cell=24x24\nrect 0,0 48x24 c=soil2 fill\nrect 4,24 40x24 c=stone3 fill\noutline c=ink\nfootprint 2x2 <<\n  rr\n  bb\n>>'],
      ['pine', 'new object pine 24x48 cell=24x24\nellipse 2,2 20x30 c=moss2 fill\nrect 10,32 4x15 c=soil0 fill\noutline c=ink\nfootprint 1x1 <<\n  r\n  b\n>>'],
    ];
    for (const [asset, commands] of setup) {
      const r = await call('run', { asset, commands });
      expect(r.isError, texts(r.content)).toBeFalsy();
    }
    const h = await call('history', { asset: 'hut' });
    expect(texts(h.content)).toMatch(/footprint 2x2 at=0,0 anchor=0,1 <</);
    const r = await call('run', {
      asset: 'isle', commands: [
        'new map isle 20x14 tile=24', 'layer add land terrain=bank outside=on', 'layer add props objects',
        'map gen island layers=land seed=4', 'place hut 9,7 layer=props', 'scatter pine count=6 on=land minDist=2 layer=props seed=3',
      ].join('\n'),
    });
    expect(r.isError, texts(r.content)).toBeFalsy();
    const t = texts(r.content);
    expect(t).toMatch(/place hut 9,7 layer=props cells=2x2 anchor=0,1/);
    expect(t).toMatch(/checks: seam [\d.]+ ✓ · coverage 0 ✓ · repetition .* · footprint \d+ . · draworder 0 ✓/);
    // A footprint may not overlap: the batch is refused whole.
    const bad = await call('run', { asset: 'isle', commands: 'place hut 10,7 layer=props' });
    expect(bad.isError).toBe(true);
    expect(texts(bad.content)).toMatch(/is taken by hut at 9,7/);
  });

  it('views a map whole, a region and the camera at game scale, and an object on its ground', async () => {
    const whole = await call('view', { asset: 'isle', mode: 'map' });
    expect(image(whole.content)).toBeTruthy();
    const wt = texts(whole.content);
    expect(wt).toMatch(/isle: a map of 20x14 cells of 24 px \(480x336 px\)/);
    expect(wt).toMatch(/cells \(l land, (H hut, P pine|P pine, H hut), \+ under an object, \. nothing\):/);
    expect(wt).toMatch(/map: 480x336 px/);
    const cam = await call('view', { asset: 'isle', mode: 'map', camera: '9,7' });
    expect(texts(cam.content)).toMatch(/the camera at 9,7: a 384x216 px screen, cells \d+,\d+ 16x9 at 2x/);
    expect(texts(cam.content)).toMatch(/map: 768x432 px/);
    const reg = await call('view', { asset: 'isle', mode: 'map', region: '2,2 6x4' });
    expect(texts(reg.content)).toMatch(/map: 288x192 px/);
    const marks = await call('view', { asset: 'isle', mode: 'map', marks: 'failing' });
    expect(image(marks.content)).toBeTruthy();
    const obj = await call('view', { asset: 'hut', mode: 'map', ground: 'soil' });
    expect(texts(obj.content)).toMatch(/hut on soil at the game's scale: 48x48 px, 2x2 cells; footprint 2x2 at art cell 0,0, anchor 0,1/);
    const c = await call('check', { asset: 'pine' });
    expect(texts(c.content)).toMatch(/fit +0/);
  });

  it('a person moves the hut in the watch view; changes says what moved, with a picture', async () => {
    await call('changes', {});
    const page = await openPage(wsUrl(s.url));
    const r = await page.run('isle', 'move 9,7 9,9', 'human:chris');
    page.ws.close();
    if (!r.ok) {
      // The island's shape decides whether 9,9 is free; any free land cell will do for this test.
      const again = await openPage(wsUrl(s.url));
      expect((await again.run('isle', 'move 9,7 8,7', 'human:chris')).ok).toBe(true);
      again.ws.close();
    }
    const ch = await call('changes', {});
    const t = texts(ch.content);
    expect(t).toMatch(/#\d+ human:chris h1 +move 9,7 \d+,\d+ layer=props/);
    expect(t).toMatch(/diff #\d+ → #\d+: \d+ cells look different; moved: hut 9,7 → \d+,\d+ \(layer props\)/);
    expect(image(ch.content)).toBeTruthy();
  });

  it('writes scenes into the review bundle without naming the method', async () => {
    const r = await call('review', { assets: ['isle', 'hut', 'pine'], name: 'isle' });
    const dir = /review bundle: (\S+)/.exec(texts(r.content))![1]!;
    const files = readdirSync(join(dir, 'scenes'));
    expect(files).toEqual(expect.arrayContaining(['isle.png', 'isle.cells.txt', 'isle.screens.txt', 'isle.screen1.png', 'hut.png', 'pine.png']));
    expect(readFileSync(join(dir, 'rubric.md'), 'utf8')).toMatch(/8\. \*\*Scenes\.\*\*/);
    for (const f of ['rubric.md', 'scenes/isle.cells.txt', 'scenes/isle.screens.txt']) expect(readFileSync(join(dir, f), 'utf8')).not.toMatch(/claude|pixelclaw|tape|footprint|scatter|map gen/i);
  });

  it('exports the map for Tiled and splits the hut into cells; the tapes verify', async () => {
    const x = await call('export', { asset: 'isle', format: 'tmx' });
    expect(texts(x.content)).toMatch(/tmx: wrote 4 files/);
    const tmx = readFileSync(join(s.proj, 'exports', 'tmx', 'isle.tmx'), 'utf8');
    expect(tmx).toMatch(/<objectgroup id="\d+" name="props">/);
    for (const f of ['isle.tiles.png', 'objects/hut.png', 'objects/pine.png']) expect(existsSync(join(s.proj, 'exports', 'tmx', f))).toBe(true);
    const sp = await call('export', { asset: 'hut', format: 'split' });
    expect(texts(sp.content)).toMatch(/split: wrote 5 files/);
    const stamp = JSON.parse(readFileSync(join(s.proj, 'exports', 'split', 'hut', 'hut.stamp.json'), 'utf8'));
    expect(stamp.pieces.map((p: { name: string; roof: boolean }) => [p.name, p.roof])).toEqual([['hut_0_0', true], ['hut_1_0', true], ['hut_0_1', false], ['hut_1_1', false]]);
    const wrong = await call('export', { asset: 'soil', format: 'tmx' });
    expect(wrong.isError).toBe(true);
    const { execFileSync } = await import('node:child_process');
    const { BIN } = await import('./spawn.ts');
    expect(execFileSync(process.execPath, [BIN, 'verify', s.proj], { encoding: 'utf8' })).toMatch(/6 assets verified/);
  }, 30000);
});
