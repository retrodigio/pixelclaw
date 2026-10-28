import { describe, expect, it } from 'vitest';
import { Pcg32, TRANSPARENT, activeCel, hashString, parse, plot, registerCommand, replay, runBatch, seedFrom, Args, resolveColour } from '../src/index.ts';
import { EMPTY, palettes, run } from './helpers.ts';

const base = run(EMPTY, 'new sprite s 16x16');

function normal(text: string, state = base): string[] {
  const r = runBatch(state, text, { by: 't', palettes });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.added.map((e) => e.cmd);
}

describe('normaliser', () => {
  it('fills in defaults and canonical forms', () => {
    expect(normal('new tile floor 24x24', EMPTY)).toEqual(['new tile floor 24x24 palette=test wrap=on cell=24x24 bg=none']);
    expect(normal('new sheet set 48x24 cell=24x24 bg=sky wrap=off', EMPTY)).toEqual(['new sheet set 48x24 palette=test wrap=off cell=24x24 bg=sky']);
    expect(normal([
      'px 3,4 4,4 c=0', 'line 0,0 5,2 c=#7FAE4C', 'rect 1,1 3x3 c=moss', 'rect fill 1,1 3x3 c=moss',
      'ellipse 8,8 r=3 c=ink', 'ellipse 2,2 6x4 fill c=leaf', 'fill 0,0 c=sky', 'fill 0,0 c=none mode=global conn=8',
      'px @cell(0,0) 1,1 c=rust',
    ].join('\n'))).toEqual([
      'px 3,4 4,4 c=ink', 'line 0,0 5,2 c=leaf pp=on', 'rect 1,1 3x3 c=moss outline', 'rect 1,1 3x3 c=moss fill',
      'ellipse 8,8 r=3x3 c=ink outline', 'ellipse 2,2 6x4 c=leaf fill', 'fill 0,0 c=sky mode=contiguous conn=4',
      'fill 0,0 c=none mode=global conn=8', 'px @cell(0,0) 1,1 c=rust',
    ]);
  });

  it('writes paint blocks with a two-space indent, or | margins when edge spaces matter', () => {
    expect(normal('paint 1,1 <<\n      0.0\n\n      .1.\n>>')).toEqual(['paint 1,1 <<\n  0.0\n\n  .1.\n>>']);
    expect(normal('paint 1,1 <<\n  | 0 |\n  |.1.|\n>>')).toEqual(['paint 1,1 <<\n  | 0 |\n  |.1.|\n>>']);
  });

  it('is idempotent: a normalised line normalises to itself', () => {
    const lines = normal('px 3,4 c=0\nline 0,0 5,2 9,9 c=leaf pp=off\nrect 2,2 4x4 c=1 fill\nellipse 8,8 r=2x5 c=ink\nfill 3,3 c=sky\npaint 0,0 <<\n  | 0 |\n>>\npaint 4,4 <<\n  r.r\n>>');
    const again = normal(lines.join('\n'));
    expect(again).toEqual(lines);
  });

  it('resolves colours by name, key, exact hex or none', () => {
    const p = base.doc!.palette;
    expect(resolveColour('leaf', p, 1, 1)).toEqual({ index: 2, name: 'leaf' });
    expect(resolveColour('r', p, 1, 1)).toEqual({ index: 5, name: 'rust' });
    expect(resolveColour('#9CC7E6', p, 1, 1)).toEqual({ index: 4, name: 'sky' });
    expect(resolveColour('none', p, 1, 1)).toEqual({ index: TRANSPARENT, name: 'none' });
  });

  it('gives errors that point at the bad token', () => {
    const errs = (text: string, state = base) => {
      const r = runBatch(state, text, { by: 't', palettes });
      return r.ok ? [] : r.errors.map((e) => `${e.line}:${e.col} ${e.message}`);
    };
    expect(errs('px 1,1 c=#ff00ff')).toEqual([`1:10 c=#ff00ff is not in palette 'test'`]);
    expect(errs('px 1,1 c=sand9')).toEqual([`1:10 unknown colour 'sand9' (palette 'test': ink, moss, leaf, stone, sky, rust, none)`]);
    expect(errs('rect 1,1 c=ink')).toEqual(['1:10 rect: expected a size WxH']);
    expect(errs('px 1,1')).toEqual(['1:1 px: missing c=<colour>']);
    expect(errs('px 1,1 c=ink size=3')).toEqual(['1:14 px has no option \'size\' (options: c)']);
    expect(errs('line 1,1 c=ink')).toEqual(['1:10 line: expected an end point x,y']);
    expect(errs('rect 1,1 2x2 c=ink fill outline')).toEqual(['1:25 choose one of outline or fill']);
    expect(errs('fill 20,0 c=ink')).toEqual(['1:6 fill: 20,0 is outside the 16x16 canvas']);
    expect(errs('paint 0,0 <<\n  0x0\n>>')).toEqual([`2:4 paint: 'x' is not a key in palette 'test'`]);
    expect(errs('frobnicate 1,1')[0]).toMatch(/^1:1 unknown command 'frobnicate'/);
    expect(errs('new tile a 8x8')).toEqual(['1:1 new must be the first command of a tape (this document already exists)']);
    expect(errs('px 1,1 c=ink', EMPTY)).toEqual([`1:1 there is no document yet: start with 'new'`]);
    expect(errs('new blob a 8x8', EMPTY)).toEqual([`1:5 unknown kind 'blob' (kinds: tile, sprite, sheet, icon)`]);
    expect(errs('new tile a 8x8 palette=nope', EMPTY)).toEqual([`1:24 unknown palette 'nope'`]);
    expect(errs('px @cell(1,0) 0,0 c=ink')).toEqual(['1:4 @cell(1,0) is outside the 1x1 cell grid']);
  });

  it('chooses a seed for a command that needs one, writes it into the line, and replay reuses it', () => {
    // A test-only generator: proves the seed plumbing later generators (noise, scatter) will use.
    registerCommand({
      name: 'speckle',
      summary: 'speckle c=<colour> n=<count> [seed=<n>]',
      normalise(cmd, ctx) {
        const doc = ctx.doc!;
        const a = new Args(cmd, ['c', 'n', 'seed']);
        a.done();
        const c = resolveColour(a.opts.get('c')!.value, doc.palette, 1, 1);
        const n = Number(a.opts.get('n')!.value);
        const seed = a.opts.has('seed') ? Number(a.opts.get('seed')!.value) : ctx.newSeed();
        const rng = new Pcg32(seed);
        const pts: [number, number][] = Array.from({ length: n }, () => [rng.nextInt(doc.width), rng.nextInt(doc.height)]);
        return { text: `speckle c=${c.name} n=${n} seed=${seed}`, op: { k: 'pixels', pts, c: c.index } };
      },
    });
    const s1 = run(base, 'speckle c=ink n=20');
    const line = s1.entries.at(-1)!.cmd;
    const seed = seedFrom(new Pcg32(2, hashString('s')));
    expect(line).toBe(`speckle c=ink n=20 seed=${seed}`);
    const r = replay(s1.entries, palettes);
    expect(r.problems).toEqual([]);
    expect(activeCel(r.doc!)).toEqual(activeCel(s1.doc!));
    const s2 = run(base, 'speckle c=ink n=20 seed=99');
    expect(activeCel(s2.doc!)).not.toEqual(activeCel(s1.doc!));
    expect(activeCel(run(base, 'speckle c=ink n=20 seed=99').doc!)).toEqual(activeCel(s2.doc!));
  });

  it('wraps on wrap documents and clips on others', () => {
    const t = run(EMPTY, 'new tile t 8x8\nrect 6,6 4x4 c=ink fill');
    const cel = activeCel(t.doc!);
    for (const [x, y] of [[6, 6], [7, 7], [0, 0], [1, 1], [0, 7], [7, 0]]) expect(cel[y! * 8 + x!]).toBe(0);
    expect(cel[2 * 8 + 2]).toBe(TRANSPARENT);
    const s = run(EMPTY, 'new sprite s 8x8\nrect 6,6 4x4 c=ink fill');
    expect(activeCel(s.doc!).filter((v) => v === 0).length).toBe(4);
    const t2 = { width: 4, height: 4, wrap: false, pixels: new Uint16Array(16) };
    plot(t2, -1, 2, 5);
    expect([...t2.pixels].every((v) => v === 0)).toBe(true);
    expect(parse('').commands).toEqual([]);
  });
});
