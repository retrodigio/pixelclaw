// Export, import and densities through MCP and the CLI: export through the sample profile and read
// it back, import a PNG sheet and an .aseprite file, a density copy with its check and view,
// project schemes copied into a family's tape, and verify.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodePng, writeAseprite, runBatch, type PaletteSource } from '@pixelclaw/core';
import { BIN, REPO, spawnServer, texts, type Served } from './spawn.ts';

let s: Served;
const call = (name: string, args: Record<string, unknown>) => s.call(name, args);
const EXAMPLE = join(REPO, 'examples', 'mossy-ruins.pclaw');

beforeAll(async () => {
  s = await spawnServer('pixelclaw-g9-');
  mkdirSync(join(s.proj, 'profiles'), { recursive: true });
  mkdirSync(join(s.proj, 'schemes'), { recursive: true });
  copyFileSync(join(EXAMPLE, 'profiles', 'bramble.json'), join(s.proj, 'profiles', 'bramble.json'));
  copyFileSync(join(EXAMPLE, 'schemes', 'blob47-round.json'), join(s.proj, 'schemes', 'blob47-round.json'));
  await call('project', { path: s.proj });
}, 20000);

afterAll(async () => {
  await s?.close();
});

describe('export, import and densities through MCP', () => {
  it('sets the stage: a tile, a sprite with a 2x copy, a family on a project scheme', async () => {
    const setup: [string, string][] = [
      ['soil', 'new tile soil 24x24 bg=soil1\nnoise ramp=soil weights=1,4,2 seed=5'],
      ['pond', 'new tile pond 24x24 bg=pool'],
      ['imp', 'new sprite imp 24x24\nellipse 6,4 12x16 c=moss2 fill\noutline c=ink\npivot 12,20'],
      ['bank', 'new family bank 24x24 scheme=blob47-round\nfamily texture inside from=soil\nfamily texture outside from=pond\nfamily band 3:outside 1:stone4 2:stone2 radius=2'],
    ];
    for (const [asset, commands] of setup) {
      const r = await call('run', { asset, commands });
      expect(r.isError, texts(r.content)).toBeFalsy();
    }
    const h = await call('history', { asset: 'bank', last: 50 });
    expect(texts(h.content)).toMatch(/new family bank 24x24 scheme=blob47-round def="/);
    const f = await call('run', { asset: 'imp2x', commands: 'fork imp imp2x\nscale 2\ndensity of=imp d=2\nframe 1\npx 20,10 21,10 20,11 21,11 c=ink' });
    expect(f.isError, texts(f.content)).toBeFalsy();
    const c = await call('check', { asset: 'imp2x', checks: ['density'] });
    expect(texts(c.content)).toMatch(/density/);
    const v = await call('view', { asset: 'imp2x', mode: 'density' });
    expect(texts(v.content)).toMatch(/2x reduced by 2 with ink-vote: 1 pixels differ from imp/);
  }, 30000);

  it('exports through the sample profile into a game folder and reads it back exactly', async () => {
    const game = join(s.root, 'game', 'art');
    const x = await call('export', { profile: 'bramble', dest: game });
    expect(texts(x.content), texts(x.content)).toMatch(/bramble: \d+ images, wrote 7 files/);
    for (const f of ['bramble.png', 'bramble.csv', 'bramble@2x.png', 'bramble@2x.csv', 'bramble@4x.png', 'bramble-entries.txt']) expect(existsSync(join(game, f)), f).toBe(true);
    expect(readFileSync(join(game, 'bramble.csv'), 'utf8').split('\n')[0]).toBe('sprite,x,y,w,h,cropX,cropY,frameW,frameH,pivotX,pivotY');
    const back = await call('import', { path: game, profile: 'bramble' });
    expect(texts(back.content)).toMatch(/read back exactly: bank, imp, imp2x, pond, soil/);
  }, 30000);

  it('imports a PNG sheet sliced into frames, and an .aseprite file, as new assets', async () => {
    // A sheet of two 8x8 frames in the project palette's colours, one with a colour off the palette.
    const pal = JSON.parse(readFileSync(join(s.proj, 'palettes', 'mossy-ruins.json'), 'utf8')) as { entries: { hex: string }[] };
    const [a, b] = [pal.entries[3]!.hex, pal.entries[5]!.hex].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
    const data = new Uint8Array(16 * 8 * 4);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) {
      if ((x % 8) < 2 || (x % 8) > 5) continue;
      const c = x < 8 ? a! : b!;
      data.set([c[0]! + (x === 10 && y === 3 ? 3 : 0), c[1]!, c[2]!, 255], (y * 16 + x) * 4);
    }
    const png = join(s.root, 'sheet.png');
    writeFileSync(png, encodePng({ width: 16, height: 8, data }));
    const r = await call('import', { path: png, as: 'sheet_imp', grid: '8x8' });
    expect(texts(r.content)).toMatch(/created sheet_imp \(sprite 8x8\), 1 pixels quantised to the nearest palette colour: /);
    const h = await call('history', { asset: 'sheet_imp' });
    expect(texts(h.content)).toMatch(/import 0,0 from="sheet.png" blob=[0-9a-f]{64} <</);
    expect(existsSync(join(s.proj, 'blobs'))).toBe(true);
    // An .aseprite file from a document with two layers, three frames and a tag.
    const palettes: PaletteSource = { get: () => undefined };
    const doc = runBatch({ doc: null, entries: [] }, 'new sprite blink 8x8 palette=p <<\n  0 ink #101010\n  1 lid #c08040\n>>\nrect 1,1 6x6 c=lid fill\nlayer add top\npx 3,3 c=ink\nframe add copy=1\nframe add copy=1\npx 4,4 c=ink\nframe set 2 ticks=20\ntag add blink 1-3 loop=pingpong', { by: 't', palettes });
    if (!doc.ok) throw new Error(doc.errors.map((e) => e.message).join());
    const ase = join(s.root, 'blink.aseprite');
    writeFileSync(ase, writeAseprite(doc.state.doc!, 60));
    const r2 = await call('import', { path: ase, build: true });
    expect(texts(r2.content)).toMatch(/created blink \(sprite 8x8\): (all \d+ checks pass|failing )/);
    const h2 = texts((await call('history', { asset: 'blink', last: 40 })).content);
    expect(h2).toMatch(/layer add top/);
    expect(h2).toMatch(/frame set 2 ticks=20/);
    expect(h2).toMatch(/tag add blink 1-3 loop=pingpong/);
  }, 30000);

  it('the CLI refuses to export while the server owns the project; MCP exports; every tape verifies', async () => {
    const out = join(s.root, 'atlas-out');
    expect(() => execFileSync(process.execPath, [BIN, 'export', s.proj, 'imp', '--profile', 'atlas', '--out', out], { encoding: 'utf8', stdio: 'pipe' })).toThrow(/a pixelclaw server \(pid \d+\) owns/);
    expect(texts((await call('export', { profile: 'atlas', assets: ['imp'], dest: out })).content)).toMatch(/atlas: 1 images/);
    expect(JSON.parse(readFileSync(join(out, 'atlas.json'), 'utf8')).sprites.map((x: { sprite: string }) => x.sprite)).toEqual(['imp']);
    expect(execFileSync(process.execPath, [BIN, 'verify', s.proj], { encoding: 'utf8' })).toMatch(/7 assets verified/);
  });
});
