// The palette written into the tape (language 2), role palettes and preview themes, check marks in
// images, the game and recolour previews, and diffs across frames.
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_THEMES, deserializeDoc, diffPixels, diffText, encodePng, paletteRows, parsePaletteRows, renderDiff, renderGame, renderRecolour,
  renderScaled, renderTile3x3, replay, runBatch, runChecks, serializeDoc, themeFromJson, themedPalette, type Doc,
} from '../src/index.ts';
import { EMPTY, TEST_PALETTE, decodePng, golden, palettes, run } from './helpers.ts';

const doc = (text: string): Doc => run(EMPTY, text).doc!;

describe('the palette in the tape (language 2)', () => {
  it('the new line carries every entry and ramp, and replays without the project palette', () => {
    const s = run(EMPTY, 'new sprite s 8x8\npx 1,1 c=leaf');
    const first = s.entries[0]!.cmd;
    expect(first.split('\n').slice(1, -1)).toEqual(paletteRows(TEST_PALETTE).map((r) => `  ${r}`));
    // No palette source at all: the tape alone is enough.
    const r = replay(s.entries, { get: () => undefined });
    expect(r.problems).toEqual([]);
    expect(serializeDoc(r.doc!)).toEqual(serializeDoc(s.doc!));
  });

  it('a script may give the block itself; it normalises to the same line', () => {
    const rows = paletteRows(TEST_PALETTE).map((x) => `    ${x}`).join('\n');
    const s = run(EMPTY, `new sprite s 8x8 palette=test <<\n${rows}\n>>`);
    expect(s.entries[0]!.cmd).toBe(run(EMPTY, 'new sprite s 8x8').entries[0]!.cmd);
  });

  it('errors in the block point at the row', () => {
    const r = runBatch(EMPTY, 'new sprite s 8x8 palette=p <<\n  0 ink #000000\n  1 moss green\n>>', { by: 't', palettes });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatchObject({ line: 3, col: 10, message: `palette row: 'green' is not a colour like #a4552e` });
  });

  it('rows round-trip, with roles', () => {
    const p = { name: 'r', entries: [{ key: 'a', name: 'skin', hex: '#cccccc', role: 'light' as const }, { key: '#', name: 'x', hex: '#010203' }], ramps: { r: ['skin', 'x'] } };
    expect(paletteRows(p)).toEqual(['a skin #cccccc role=light', '# x #010203', 'ramp r skin x']);
    expect(parsePaletteRows('r', paletteRows(p))).toEqual({ palette: p });
  });
});

describe('role palettes and themes', () => {
  it('palette add role= and palette set role= are tape commands; roles are state', () => {
    const s = run(EMPTY, 'new sprite s 4x4\npalette add skin role=light\npalette add hair hex=#553322 key=H\npalette set hair role=dark\npalette set skin role=none hex=#ddccbb');
    expect(s.entries.slice(1).map((e) => e.cmd)).toEqual([
      'palette add skin hex=#cccccc key=5 role=light', 'palette add hair hex=#553322 key=H', 'palette set hair role=dark', 'palette set skin hex=#ddccbb role=none',
    ]);
    const d = s.doc!;
    expect(d.palette.entries.slice(-2)).toEqual([{ key: '5', name: 'skin', hex: '#ddccbb' }, { key: 'H', name: 'hair', hex: '#553322', role: 'dark' }]);
    expect(deserializeDoc(serializeDoc(d))).toEqual(d);
    expect(replay(s.entries, palettes).problems).toEqual([]);
    const err = runBatch(s, 'palette set hair role=bright', { by: 't', palettes });
    expect(err.ok ? '' : err.errors[0]!.message).toBe('role= must be one of black, white, light, dark, darkest or none');
  });

  it('a theme recolours role entries only', () => {
    const d = doc('new sprite s 4x4\npalette add skin role=light\npalette add hair role=darkest');
    const t = themeFromJson('rust', { light: '#e0a070', darkest: '#301008' });
    const p = themedPalette(d.palette, t);
    expect(p.entries.find((e) => e.name === 'skin')!.hex).toBe('#e0a070');
    expect(p.entries.find((e) => e.name === 'hair')!.hex).toBe('#301008');
    expect(p.entries.find((e) => e.name === 'ink')!.hex).toBe('#14161c');
    expect(() => themeFromJson('x', { glow: '#fff000' })).toThrow(/unknown role 'glow'/);
    expect(BUILTIN_THEMES.map((x) => x.name)).toEqual(['grey', 'moss', 'ember', 'tide', 'dusk', 'sand']);
  });
});

/** A small sprite with role colours, an outline and a stray pixel. */
function figure(): Doc {
  return doc([
    'new sprite fig 12x12',
    'palette add body role=light', 'palette add shadow role=dark', 'palette add deep role=darkest',
    'ellipse 2,1 8x10 c=body fill', 'rect 6,3 3x7 c=shadow fill', 'px 7,9 8,9 c=deep',
    'outline c=ink', 'px 0,11 c=deep',
  ].join('\n'));
}

describe('previews and marks', () => {
  it('render circles the flagged pixels in magenta', () => {
    const d = figure();
    const marks = runChecks(d, ['orphans'])[0]!.flagged;
    expect(marks).toEqual([[0, 11]]);
    const img = renderScaled(d, { marks, scale: 8 });
    golden('previews/marks.png', encodePng(img));
    const png = decodePng(encodePng(img));
    const magenta = (x: number, y: number) => { const o = (y * png.width + x) * 4; return [png.rgba[o], png.rgba[o + 1], png.rgba[o + 2]].join(); };
    // The ring passes just left of the pixel's middle row... somewhere around it there is magenta.
    let n = 0;
    for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) if (magenta(x, y) === '255,0,200') n++;
    expect(n).toBeGreaterThan(20);
    golden('previews/tile3x3-marks.png', encodePng(renderTile3x3(doc('new tile t 8x8 bg=moss\npx 3,3 c=rust'), 0, { marks: [[3, 3]] })));
  });

  it('game: sprites on their ground at 1x and at the draw scale', () => {
    const ground = doc('new tile g 8x8 bg=moss\npx 2,2 5,6 c=leaf');
    const other = doc('new sprite other 8x10\nrect 1,1 6x9 c=rust fill\nrect 1,1 6x9 c=ink');
    const img = renderGame([{ doc: figure() }, { doc: other }], { ground, scale: 2 });
    // 8 + (8 + 12 + 8 + 8 + 8) + 8 wide at 2x; scenes 28 px tall at 1x and 56 at 2x.
    expect([img.width, img.height]).toEqual([8 + 2 * 44 + 8, 8 + 28 + 8 + 56 + 8]);
    golden('previews/game.png', encodePng(img));
  });

  it('recolour: the art under each theme, with its role colours', () => {
    const img = renderRecolour(figure(), BUILTIN_THEMES.slice(0, 4));
    expect([img.width, img.height]).toEqual([8 + 4 * (48 + 8), 8 + 48 + 4 + 6 + 8]);
    golden('previews/recolour.png', encodePng(img));
  });
});

describe('diffs across frames', () => {
  it('lists changes per frame and draws a row per changed frame', () => {
    const before = run(EMPTY, 'new sprite s 6x6\nrect 1,1 4x4 c=moss fill\nframe add 2 copy=1\nframe add 3 copy=1');
    const after = run(before, 'frame 2\npx 2,2 c=ink\nframe 3\npx 3,3 4,4 c=rust').doc!;
    const ch = diffPixels(before.doc, after);
    expect(ch).toEqual([{ x: 2, y: 2, from: 1, to: 0, f: 1 }, { x: 3, y: 3, from: 1, to: 5, f: 2 }, { x: 4, y: 4, from: 1, to: 5, f: 2 }]);
    expect(diffText(before.doc, after, ch)).toBe('3 px changed (frame 2: 1, frame 3: 2):\n  f2 2,2 moss→ink\n  f3 3,3 moss→rust\n  f3 4,4 moss→rust');
    golden('previews/diff-frames.png', encodePng(renderDiff(before.doc, after)));
  });

  it('a new frame copied from another changes nothing visible... but its pixels count as new', () => {
    const before = run(EMPTY, 'new sprite s 4x4\npx 1,1 c=ink');
    const after = run(before, 'frame add empty').doc!;
    expect(diffPixels(before.doc, after)).toEqual([]);
    const copy = run(before, 'frame add copy=1').doc!;
    expect(diffPixels(before.doc, copy)).toEqual([{ x: 1, y: 1, from: 0xffff, to: 0, f: 1 }]);
  });
});
