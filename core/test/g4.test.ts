// G4, the drawing toolkit (plan §10 G4): a golden render and grid per command and generator; a
// seed changes a generator's output while the same seed reproduces it; every tape replays in
// normal form, and its state survives serialisation (checkpoint bodies).

import { describe, expect, it } from 'vitest';
import {
  ReplayCache, ctxOf, deserializeDoc, encodePng, flatten, renderGrid, renderScaled, replay, runBatch, serializeDoc,
  type AssetState,
} from '../src/index.ts';
import { EMPTY, golden, palettes, run } from './helpers.ts';

const BASE = 'new sprite s 16x16\nramp grey = ink stone sky\nramp warm = moss leaf rust';
const TILE = 'new tile t 16x16\nramp grey = ink stone sky\nramp green = moss leaf\nramp warm = moss leaf rust';
const SHAPE = 'rect 3,3 10x8 c=stone fill\nrect 6,1 4x2 c=leaf fill';

/** Golden cases: name → script. Each is rendered at 8x (PNG) and as the text grid. */
const CASES: Record<string, string> = {
  // Layers and frames
  'layers': `${BASE}\nrect 0,0 10x10 c=stone fill\nlayer add top\nlayer top\nellipse 4,4 r=4 c=rust fill\nlayer add guide below=main reference\nlayer guide\nrect 0,0 16x16 c=sky fill\nlayer add hide above=top\nlayer hide\npx 15,15 c=ink\nlayer set hide hidden=on`,
  'layers-move-merge': `${BASE}\nrect 0,0 8x8 c=stone fill\nlayer add a\nlayer a\nrect 4,4 8x8 c=rust fill\nlayer move a below=main\nlayer add b above=main\nlayer b\nline 0,15 15,0 c=ink\nlayer merge b`,
  'frames': `${BASE}\nrect 2,2 4x4 c=rust fill\nframe add 2 copy=1\nframe 2\nshift 6,6\nframe add 3 empty\nframe 3\npx 8,8 c=ink`,
  // Selections
  'select-ellipse': `${BASE}\nselect ellipse 8,8 r=6x4\nrect 0,0 16x16 c=leaf fill\ndeselect`,
  'select-lasso': `${BASE}\nselect lasso 1,1 14,3 9,14 2,9\nrect 0,0 16x16 c=moss fill`,
  'select-wand': `${BASE}\nrect 0,0 16x16 c=stone fill\nline 0,8 15,8 c=ink\nline 8,0 8,15 c=ink\nselect wand 2,2\nfill 2,2 c=sky\nselect wand 12,12 mode=global\nrect 0,0 16x16 c=rust fill`,
  'select-colour-layer': `${BASE}\n${SHAPE}\nselect colour c=leaf\nclear\nselect layer main\nselect rect 0,0 8x16 sub\nfill 10,5 c=rust`,
  'select-combine': `${BASE}\nselect rect 1,1 8x8\nselect rect 7,7 8x8 add\nselect ellipse 8,8 r=3 sub\nrect 0,0 16x16 c=moss fill\nselect rect 0,0 16x4 and\nrect 0,0 16x16 c=rust fill\nselect invert\nselect rect 0,10 16x6 and\nrect 0,0 16x16 c=ink fill`,
  // Transforms and symmetry
  'transforms': `${BASE}\npaint 1,1 <<\n  000\n  0r.\n  0..\n>>\nselect rect 1,1 3x3\nshift 4,0\nflip h\nshift 4,0\nrotate 90\nshift 4,0\nrotate 180\ndeselect\nrect 0,8 16x8 c=moss fill\npx 2,9 3,10 c=rust\nselect rect 0,8 8x8\nflip v sel\nselect none\nrect 9,9 3x5 c=leaf fill\nselect rect 8,8 8x8\nrotate 270 sel`,
  'shift-wrap': `${BASE}\nrect 0,0 6x16 c=moss fill\npx 0,0 c=ink\nshift 13,3 wrap\nselect rect 8,8 6x6\nrect 8,8 3x3 c=rust fill\nshift 4,4 sel wrap`,
  'mirror-live': `${BASE}\nmirror x=7.5 live\nline 0,0 6,6 c=ink\npx 2,10 c=rust\nmirror x=7.5 y=7.5 live\nellipse 3,12 r=2 c=leaf\nmirror off\npx 0,15 c=stone`,
  'mirror-once': `${BASE}\npaint 0,2 <<\n  rr00\n  .r003\n  ..033\n>>\nmirror x=7.5 from=left\nmirror y=7.5 from=top`,
  // Curves and polygons
  'curve': `${BASE}\ncurve 0,15 2,0 15,2 c=ink\ncurve 0,8 4,16 10,0 15,15 c=rust\ncurve 2,14 14,14 8,6 c=leaf pp=off`,
  'polygon': `${BASE}\npolygon 1,1 14,4 10,14 c=moss fill\npolygon 1,1 14,4 10,14 c=ink\npolygon 2,10 5,15 0,15 c=rust fill\npolygon 11,0 15,0 15,3 c=leaf`,
  // Dithering, gradients, ramps
  'dither': `${BASE}\ndither 0,0 8x8 a=ink b=sky pattern=checker\ndither 8,0 8x8 a=ink b=sky pattern=bayer4 level=0.25\ndither 0,8 8x8 a=moss b=leaf pattern=bayer8 level=3/16\ndither 8,8 8x4 a=stone b=rust pattern=hlines\ndither 8,12 8x4 a=stone b=rust pattern=vlines level=75%`,
  'gradient': `${BASE}\ngradient 0,0 8x16 ramp=grey dir=down\ngradient 8,0 8x8 ramp=grey dir=right pattern=checker\ngradient 8,8 8x8 ramp=ink,moss,leaf,sky dir=up steps=4 pattern=bayer4`,
  'gradient-radial': `${BASE}\ngradient 0,0 16x16 ramp=warm dir=radial pattern=bayer2`,
  // Helpers
  'outline': `${BASE}\n${SHAPE}\noutline c=ink\nlayer add rim below=main\nlayer rim\noutline c=rust corners=on from=main`,
  'outline-inner': `${BASE}\nellipse 8,8 r=6x5 c=leaf fill\noutline c=moss mode=inner corners=on\nellipse 8,8 r=3 c=sky fill\noutline c=ink mode=inner`,
  'shade': `${BASE}\nrect 1,1 6x6 c=stone fill\nrect 0,0 8x8 c=moss\nellipse 11,11 r=4 c=leaf fill\nshade light=nw ramp=all\nrect 9,1 6x6 c=stone fill\nselect rect 9,1 6x6\nshade light=se ramp=grey edge=2`,
  'clean': `${BASE}\nrect 0,0 16x16 c=stone fill\npx 2,2 5,5 9,3 c=rust\npx 6,5 c=rust\npx 12,12 c=sky\npx 3,12 c=ink\nrect 10,8 2x1 c=moss fill\nclean orphans keep=texture\npx 14,1 c=rust\nrect 0,14 2x2 c=rust fill\nselect rect 8,0 8x16\nclean orphans size=2`,
  // Generators
  'noise': `${TILE}\nnoise ramp=green weights=6,2 cluster=1..3 density=0.2 seed=7`,
  'noise-keep': `${BASE}\nrect 0,0 16x8 c=stone fill\nnoise 0,0 16x8 ramp=grey weights=1,0,2 cluster=2..4 density=0.3 base=keep seed=3\nnoise 0,8 16x8 ramp=warm cluster=1 density=1/2 base=ink seed=11`,
  'scatter': `${TILE}\nrect 0,0 16x16 c=moss fill\nstamp save tuft <<\n  .2.\n  2.2\n>>\nscatter stamp=tuft count=6 minDist=5 flip=on seed=3\nscatter c=sky count=5 minDist=3 seed=9`,
  'voronoi': `${TILE}\nvoronoi cells=7 ramp=grey weights=1,3,1 gap=ink seed=5`,
  'voronoi-nogap': `${BASE}\nvoronoi 0,0 16x8 cells=4 ramp=warm relax=0 wrap=off seed=1\nvoronoi 0,8 16x8 cells=6 ramp=grey gap=moss relax=2 seed=2`,
  'bricks': `${TILE}\nbricks size=8x4 ramp=warm weights=3,2,1 gap=ink seed=4`,
  'bricks-small': `${BASE}\nbricks 1,1 14x14 size=5x3 ramp=grey offset=1 seed=8\nbricks 0,12 16x4 size=4x2 ramp=warm gap=none seed=2`,
  // Stamps, brushes, macros
  'stamps': `${BASE}\npaint 0,0 <<\n  rr0\n  r..\n>>\nstamp save corner 0,0 3x2\nstamp corner 5,5\nstamp corner 10,5 flip=h\nstamp corner 5,10 flip=v\nstamp corner 10,10 flip=hv\nstamp save dot <<\n  3\n>>\nstamp dot 15,15`,
  'brush': `${BASE}\nbrush square 2\nline 1,1 14,1 c=ink\nbrush circle 3\nline 2,5 13,8 c=rust\nbrush circle 5\npx 4,12 c=leaf\nstamp save x <<\n  0.0\n  .0.\n  0.0\n>>\nbrush stamp x\npx 12,12 c=moss\nbrush off\npx 15,15 c=sky`,
  'macro': `${BASE}\ndef tuft(x,y) { px $x,$y $x+1,$y-1 c=leaf ; px $x+2,$y c=moss }\ndef row(y,c) {\n  line 0,$y 15,$y c=$c\n  call tuft 2,$(y+3)\n}\ncall tuft 5,4\ncall tuft 10,8\ncall row 10 rust\ncall row 13 ink`,
};

function build(script: string): AssetState {
  return run(EMPTY, script);
}

describe('G4 golden renders per command and generator', () => {
  for (const [name, script] of Object.entries(CASES)) {
    it(name, () => {
      const s = build(script);
      const doc = s.doc!;
      const frames = name === 'frames' ? doc.frameCount : 1;
      for (let f = 0; f < frames; f++) {
        const suffix = frames > 1 ? `.f${f + 1}` : '';
        golden(`g4/${name}${suffix}.png`, encodePng(renderScaled(doc, { scale: 8, frame: f })));
        golden(`g4/${name}${suffix}.txt`, renderGrid(doc, undefined, f));
      }
      // Every line replays in normal form to the same state, and the state round-trips.
      const r = replay(s.entries, palettes);
      expect(r.problems).toEqual([]);
      expect(serializeDoc(r.doc!)).toEqual(serializeDoc(doc));
      expect(serializeDoc(deserializeDoc(serializeDoc(doc)))).toEqual(serializeDoc(doc));
    });
  }
});

const GENERATORS: Record<string, (seed: number) => string> = {
  noise: (s) => `noise ramp=green weights=3,1 density=0.3 seed=${s}`,
  scatter: (s) => `scatter c=sky count=8 minDist=3 seed=${s}`,
  voronoi: (s) => `voronoi cells=6 ramp=grey gap=ink seed=${s}`,
  bricks: (s) => `bricks size=6x4 ramp=grey seed=${s}`,
  macro: (s) => `def spot() { scatter c=rust count=4 }\ncall spot seed=${s}`,
};

describe('seeds', () => {
  for (const [name, line] of Object.entries(GENERATORS)) {
    it(`${name}: the same seed reproduces the output, another seed changes it`, () => {
      const a = flatten(build(`${TILE}\n${line(42)}`).doc!);
      const again = flatten(build(`${TILE}\n${line(42)}`).doc!);
      const b = flatten(build(`${TILE}\n${line(43)}`).doc!);
      expect(again).toEqual(a);
      expect(b).not.toEqual(a);
    });
  }

  it('a generator without seed= gets one written into its line, and replay uses it', () => {
    const s = build(`${TILE}\nnoise ramp=green\nvoronoi cells=4 ramp=grey\ndef spot() { scatter c=rust count=4 }\ncall spot`);
    const lines = s.entries.map((e) => e.cmd);
    expect(lines[4]).toMatch(/^noise 0,0 16x16 ramp=green weights=1,1 cluster=1\.\.3 density=0\.15 base=moss wrap=on seed=\d+$/);
    expect(lines[5]).toMatch(/^voronoi 0,0 16x16 cells=4 ramp=grey weights=1,1,1 gap=none relax=1 wrap=on seed=\d+$/);
    expect(lines[7]).toMatch(/^call spot seed=\d+$/);
    expect(lines[4]!.match(/seed=(\d+)/)![1]).not.toBe(lines[5]!.match(/seed=(\d+)/)![1]);
    expect(serializeDoc(replay(s.entries, palettes).doc!)).toEqual(serializeDoc(s.doc!));
  });

  it('a wrap=on texture is seamless: it continues across the edges', () => {
    const doc = build(`${TILE}\nvoronoi cells=5 ramp=grey gap=ink seed=12`).doc!;
    // Gap pixels separate cells across the right and bottom edges just as inside.
    const px = flatten(doc);
    const across = [...Array(16).keys()].some((y) => px[y * 16 + 15] === 0 || px[y * 16] === 0);
    expect(across).toBe(true);
  });
});

describe('authors each have their own selection, layer, frame, symmetry and brush', () => {
  it("one author's selection does not clip another's drawing", () => {
    let s = run(EMPTY, `${BASE}\nselect rect 0,0 2x2`, 'claude');
    s = run(s, 'rect 0,0 16x16 c=leaf fill', 'human:chris');
    expect(flatten(s.doc!).every((v) => v === 2)).toBe(true);
    s = run(s, 'rect 0,0 16x16 c=ink fill', 'claude');
    expect(flatten(s.doc!).filter((v) => v === 0).length).toBe(4);
    expect(ctxOf(s.doc!, 'claude').sel).not.toBeNull();
    expect(ctxOf(s.doc!, 'human:chris').sel).toBeNull();
    expect(serializeDoc(replay(s.entries, palettes).doc!)).toEqual(serializeDoc(s.doc!));
  });

  it('layer, frame, mirror and brush are per author', () => {
    let s = run(EMPTY, `${BASE}\nlayer add top\nlayer top\nframe add\nframe 2\nmirror live\nbrush square 3`, 'claude');
    s = run(s, 'px 0,0 c=ink', 'human:chris');
    expect(s.doc!.cels[0]![0]![0]).toBe(0);
    expect(s.doc!.cels[0]![0]!.filter((v) => v === 0).length).toBe(1);
    s = run(s, 'px 0,0 c=rust', 'claude');
    expect(s.doc!.cels[1]![1]![0]).toBe(5);
    expect(s.doc!.cels[1]![1]![15]).toBe(5);
    expect(s.doc!.cels[1]![1]![17]).toBe(5);
    expect(ctxOf(s.doc!, 'claude')).toMatchObject({ layer: 1, frame: 1, mirror: { x2: 15, y2: null }, brush: { shape: 'square', size: 3 } });
  });
});

describe('layers', () => {
  it('a locked layer refuses drawing; hidden and reference layers are not in the flat art', () => {
    const s = build(`${BASE}\nrect 0,0 4x4 c=ink fill\nlayer set main locked=on`);
    const r = runBatch(s, 'px 1,1 c=rust', { by: 'test', palettes });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.message).toContain("layer 'main' is locked");
    const hid = run(s, 'layer set main hidden=on locked=off');
    expect(flatten(hid.doc!).every((v) => v === 0xffff)).toBe(true);
    const ref = run(s, 'layer set main reference=on');
    expect(flatten(ref.doc!).every((v) => v === 0xffff)).toBe(true);
  });

  it('authors without a context stay on their layer and frame when others are added below or before', () => {
    let s = build(`${BASE}\nlayer add guide below=main reference\nframe add 1 empty\npx 0,0 c=ink`);
    expect(s.doc!.layers.map((l) => l.name)).toEqual(['guide', 'main']);
    expect(s.doc!.home).toEqual({ layer: 1, frame: 1 });
    expect(s.doc!.cels[1]![1]![0]).toBe(0);
    s = run(s, 'px 1,0 c=rust', 'human:new');
    expect(s.doc!.cels[1]![1]![1]).toBe(5);
    s = run(s, 'layer remove guide');
    expect(s.doc!.home).toEqual({ layer: 0, frame: 1 });
  });

  it('errors: names, the last layer, merge at the bottom', () => {
    const s = build(BASE);
    const err = (t: string) => { const r = runBatch(s, t, { by: 'test', palettes }); return r.ok ? '' : r.errors[0]!.message; };
    expect(err('layer add main')).toContain("already a layer 'main'");
    expect(err('layer add add')).toContain('not a usable layer name');
    expect(err('layer remove main')).toContain('only layer');
    expect(err('layer merge main')).toContain('bottom layer');
    expect(err('layer nope')).toContain("no layer 'nope'");
    expect(err('frame 2')).toContain('frame 2 does not exist');
    expect(err('frame remove 1')).toContain('only frame');
  });

  it('frames: add, move and remove keep each author on their frame', () => {
    let s = build(`${BASE}\npx 0,0 c=ink\nframe add\nframe 2\npx 1,0 c=rust\nframe add 1 empty`);
    expect(s.doc!.frameCount).toBe(3);
    expect(ctxOf(s.doc!, 'test').frame).toBe(2);
    expect(s.entries.at(-1)!.cmd).toBe('frame add 1 empty');
    s = run(s, 'frame move 3 to=1');
    expect(ctxOf(s.doc!, 'test').frame).toBe(0);
    s = run(s, 'frame remove 2');
    expect(s.doc!.frameCount).toBe(2);
    expect(serializeDoc(replay(s.entries, palettes).doc!)).toEqual(serializeDoc(s.doc!));
  });
});

describe('palette locking and ramps', () => {
  it('a locked palette refuses edits and ramp changes; colours outside it are refused as always', () => {
    const s = build(`${BASE}\npalette lock`);
    const err = (t: string) => { const r = runBatch(s, t, { by: 'test', palettes }); return r.ok ? '' : r.errors[0]!.message; };
    expect(err('palette add hex=#ff00ff')).toBe("palette 'test' is locked (palette unlock to change it)");
    expect(err('palette set ink hex=#000000')).toContain('locked');
    expect(err('ramp x = ink sky')).toContain('locked');
    expect(err('px 1,1 c=#ff00ff')).toBe("c=#ff00ff is not in palette 'test'");
    const open = run(s, 'palette unlock\npalette add gold hex=#e0b040\nramp hot = rust gold\npalette save as=test2');
    expect(open.doc!.palette.ramps.hot).toEqual(['rust', 'gold']);
    expect(open.entries.at(-1)!.cmd).toBe('palette save as=test2');
  });
});

describe('macros', () => {
  it('def is logged in normal form; call expands the body with arithmetic', () => {
    const s = build(`${BASE}\ndef dot(x,y,c) {   px $x,$y c=$c ; px $(x*2+1),$y+1*2 c=$c   }\ncall dot 3,4 rust`);
    expect(s.entries.at(-2)!.cmd).toBe('def dot(x,y,c) { px $x,$y c=$c ; px $(x*2+1),$y+1*2 c=$c }');
    expect(s.entries.at(-1)!.cmd).toBe('call dot 3,4 rust');
    const px = flatten(s.doc!);
    expect(px[4 * 16 + 3]).toBe(5);
    expect(px[10 * 16 + 7]).toBe(5);
  });

  it('errors point at the call; forbidden commands and recursion are refused', () => {
    const s = build(`${BASE}\ndef bad(x) { px $x,0 c=gold }\ndef loop(x) { call loop $x }`);
    const err = (t: string) => { const r = runBatch(s, t, { by: 'test', palettes }); return r.ok ? '' : `${r.errors[0]!.line}:${r.errors[0]!.col}: ${r.errors[0]!.message}`; };
    expect(err('call bad 1')).toContain("1:1: call bad: body line 1: unknown colour 'gold'");
    expect(err('call loop 1')).toContain('more than 8 deep');
    expect(err('call bad')).toContain('takes 1 value(s) (x), got 0');
    expect(err('def u() { undo }')).toContain("'undo' cannot be used in a macro");
    expect(err('def px() { px 0,0 c=ink }')).toContain("'px' is a command name");
  });
});

describe('undo replays from snapshots', () => {
  it('undoing a group on a long tape equals a full replay, and uses the snapshots kept while writing', () => {
    let s = build(BASE);
    for (let i = 0; i < 30; i++) {
      s = run(s, Array.from({ length: 10 }, (_, k) => `px ${(i + k) % 16},${(i * 3 + k) % 16} c=${['ink', 'leaf', 'rust'][(i + k) % 3]}`).join('\n'));
    }
    expect(s.cache!.size).toBeGreaterThan(0);
    const u = run(s, 'undo group=g5\nundo group=g28');
    expect(serializeDoc(u.doc!)).toEqual(serializeDoc(replay(u.entries, palettes).doc!));
    const fresh = new ReplayCache();
    const t0 = performance.now();
    fresh.replay(u.entries, palettes);
    const full = performance.now() - t0;
    const t1 = performance.now();
    const r = run(u, 'redo group=g32');
    const cached = performance.now() - t1;
    expect(serializeDoc(r.doc!)).toEqual(serializeDoc(replay(r.entries, palettes).doc!));
    expect(cached).toBeLessThan(full * 3 + 20);
  });
});
