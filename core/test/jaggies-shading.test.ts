// The jaggies check leaves ramp shading out: steps between neighbouring entries of one ramp are
// shading, not a line.
import { describe, expect, it } from 'vitest';
import { charText, exportColours, exportProfile, fontBmfont, fontStrip, glyphCell, glyphs, iconModeOf, materialMatch, Pcg32, createRgba, readStrip, runChecks, snapImage, artHash, deserializeDoc, replay, runBatch, serializeDoc, type Rgba, type CheckId, type CheckResult, type Doc } from '../src/index.ts';
import { EMPTY, TEST_PALETTE, palettes, run } from './helpers.ts';

const doc = (text: string): Doc => run(EMPTY, text).doc!;
const check = (d: Doc, id: CheckId, ctx: Parameters<typeof runChecks>[2] = {}): CheckResult => runChecks(d, [id], ctx)[0]!;

// A round form with an ink outline and three shading bands of one ramp (moss, leaf, lime) that
// step with the curve: the band edges make doubled L-corners in each colour.
const BALL = [
  '....0000....',
  '..00555500..',
  '.0555552220.',
  '.0552222210.',
  '055222221110',
  '052222211110',
  '052222111110',
  '022221111110',
  '.0222111110.',
  '.0211111110.',
  '..00111100..',
  '....0000....',
];
const ball = (rows: string[], ramp = 'ramp green = moss leaf lime') => doc([
  'new sprite s 12x12',
  'palette add lime hex=#c4e070 key=5',
  ramp,
  `paint 0,0 <<\n${rows.join('\n')}\n>>`,
].join('\n'));

describe('jaggies on ramp shading', () => {
  it('steps between neighbouring entries of one ramp inside a shape are shading', () => {
    const r = check(ball(BALL), 'jaggies');
    expect(r).toMatchObject({ status: 'pass', score: 0 });
    expect(r.detail).toMatch(/steps between neighbouring entries of one ramp are shading/);
  });

  it('the same bands in colours of no shared ramp are judged as lines', () => {
    // Without the ramp, lime, leaf and moss are three unrelated colours: their stepped edges count.
    const r = check(ball(BALL, 'ramp green = moss leaf'), 'jaggies');
    expect(r.status).toBe('fail');
    expect(r.score).toBeGreaterThan(0);
  });

  it('two ramp steps apart is not shading', () => {
    // Lime next to moss (two steps) where leaf should be between them.
    const rows = BALL.map((s) => s.replace(/2/g, '1'));
    const r = check(ball(rows), 'jaggies');
    expect(r.score).toBeGreaterThan(0);
  });

  it('an outline with a doubled corner still fails inside shaded art', () => {
    const rows = [...BALL];
    rows[0] = '...00000....'; // ink drawn as a doubled L at the top left
    rows[1] = '..0055500...';
    const r = check(ball(rows), 'jaggies');
    expect(r.status).toBe('fail');
    expect(r.groups.map((g) => g.label)).toContain('doubled L-corner');
  });
});

// A tiny font: four glyphs of a 5x7 cell, ink '0' (the test palette's ink), baseline row 6.
const FONT = [
  'new font tiny 5x7 chars="AB1 ." cols=3 baseline=6 line=8',
  'glyph A <<\n.00.\n0..0\n0..0\n0000\n0..0\n0..0\n0..0\n>>',
  'glyph B <<\n000.\n0..0\n0..0\n000.\n0..0\n0..0\n000.\n>>',
  'glyph 1 <<\n.0\n00\n.0\n.0\n.0\n.0\n.0\n>>',
  'glyph U+0020 advance=3',
  'glyph U+002E <<\n.\n.\n.\n.\n.\n.\n0\n>>',
].join('\n');



// --- snap: a synthetic grid with known pitch and offset

/** Random art of `cols` x `rows` palette indices drawn at a pitch and offset, blurred and with noise: a stand-in for a generated draft. */
function synthetic(cols: number, rows: number, pitch: number, ox: number, oy: number, seed: number): { art: Uint16Array; img: Rgba } {
  const g = new Pcg32(seed);
  const colours = TEST_PALETTE.entries.map((e) => [parseInt(e.hex.slice(1, 3), 16), parseInt(e.hex.slice(3, 5), 16), parseInt(e.hex.slice(5, 7), 16)]);
  // Clustered art (runs of 1-3 pixels), as pixel art has.
  const art = new Uint16Array(cols * rows);
  for (let i = 0; i < art.length; i++) art[i] = i > 0 && g.nextInt(3) === 0 ? art[i - 1]! : g.nextInt(colours.length);
  const W = Math.floor(ox + cols * pitch), H = Math.floor(oy + rows * pitch);
  const raw = new Float64Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = Math.min(cols - 1, Math.max(0, Math.floor((x + 0.5 - ox) / pitch)));
    const j = Math.min(rows - 1, Math.max(0, Math.floor((y + 0.5 - oy) / pitch)));
    for (let c = 0; c < 3; c++) raw[(y * W + x) * 3 + c] = colours[art[j * cols + i]!]![c]!;
  }
  const img = createRgba(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      s += raw[(yy * W + xx) * 3 + c]!; n++;
    }
    img.data[(y * W + x) * 4 + c] = Math.max(0, Math.min(255, Math.round(s / n + g.nextInt(25) - 12)));
    img.data[(y * W + x) * 4 + 3] = 255;
  }
  return { art, img };
}
