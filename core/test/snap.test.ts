// Underlays and snap: fitting an underlay's pixel grid and quantising it into a draft layer, and the
// underlay and snap commands on the tape.
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

describe('snap', () => {
  for (const [pitch, ox, oy, hinted] of [[7.3, 3.2, 1.7, true], [10.667, 5.5, 0.4, true], [6, 2, 4, false], [12.5, 9.1, 7.8, false]] as const) {
    it(`recovers pitch ${pitch} and offset ${ox},${oy}${hinted ? ' (with the expected pitch)' : ' (no hint)'}`, () => {
      const cols = 36, rows = 24;
      const { art, img } = synthetic(cols, rows, pitch, ox, oy, Math.round(pitch * 100));
      const r = snapImage(img, TEST_PALETTE, hinted ? { hint: { x: img.width / cols, y: img.height / rows } } : {});
      expect(Math.abs(r.fit.x.pitch - pitch)).toBeLessThan(0.03);
      expect(Math.abs(r.fit.y.pitch - pitch)).toBeLessThan(0.03);
      // The offset is the first grid line, modulo the pitch.
      const off = (got: number, want: number) => Math.min(Math.abs(got - want), pitch - Math.abs(got - want));
      expect(off(r.fit.x.offset, ox % pitch)).toBeLessThan(0.35);
      expect(off(r.fit.y.offset, oy % pitch)).toBeLessThan(0.35);
      // Every art pixel back (a partial cell before a large offset is the art's first, repeated).
      const lead = r.fit.i0 < 0 ? 1 : 0, top = r.fit.j0 < 0 ? 1 : 0;
      expect([r.fit.cols - lead, r.fit.rows - top]).toEqual([cols, rows]);
      let same = 0;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) if (r.px[(j + top) * r.fit.cols + i + lead] === art[j * cols + i]) same++;
      expect(same / (cols * rows)).toBeGreaterThan(0.99);
      expect(r.r2).toBeGreaterThan(0.8);
      expect(r.reroll).toEqual([]);
    });
  }

  it('noise with no grid gives a low block R² and suggests a reroll', () => {
    const g = new Pcg32(5);
    const img = createRgba(120, 80);
    for (let i = 0; i < 120 * 80; i++) img.data.set([g.nextInt(256), g.nextInt(256), g.nextInt(256), 255], i * 4);
    const r = snapImage(img, TEST_PALETTE, { hint: { x: 10, y: 10 } });
    expect(r.r2).toBeLessThan(0.8);
    expect(r.reroll.join()).toMatch(/block R²/);
  });

  it('the material match against the layout it was made from', () => {
    // Layout: left half one flat colour, right half another; the image puts moss left, sky right (a match), then swaps a third of it.
    const layout = createRgba(4, 2);
    for (let i = 0; i < 8; i++) layout.data.set(i % 4 < 2 ? [200, 0, 0, 255] : [0, 0, 200, 255], i * 4);
    const blocks = createRgba(12, 6);
    for (let j = 0; j < 6; j++) for (let i = 0; i < 12; i++) blocks.data.set(i < 6 ? [63, 107, 58, 255] : [156, 199, 230, 255], (j * 12 + i) * 4);
    expect(materialMatch(blocks, layout)).toBe(1);
    for (let j = 0; j < 6; j++) for (let i = 0; i < 2; i++) blocks.data.set([156, 199, 230, 255], (j * 12 + i) * 4);
    expect(materialMatch(blocks, layout)).toBeCloseTo(10 / 12, 6);
  });
});

describe('underlay and snap commands', () => {
  const SHA = 'ab'.repeat(32), LAYOUT = 'cd'.repeat(32);
  it('underlay: an image on a new reference layer at the bottom, never part of the art', () => {
    const s = run(EMPTY, `new sheet scene 24x16 cell=8x8\nrect 0,0 4x4 c=moss fill\nunderlay mock blob=${SHA} image=144x96 layout=${LAYOUT} prompt="mossy ruins, a draft" provider=fake cost=0`);
    const d = s.doc!;
    expect(d.layers.map((l) => [l.name, l.reference])).toEqual([['mock', true], ['main', false]]);
    expect(d.layers[0]!.underlay).toEqual({ blob: SHA, iw: 144, ih: 96, x: 0, y: 0, w: 24, h: 16, layout: LAYOUT });
    expect(s.entries.at(-1)!.cmd).toBe(`underlay mock blob=${SHA} image=144x96 at=0,0 size=24x16 layout=${LAYOUT} prompt="mossy ruins, a draft" provider=fake cost=0`);
    // The author keeps drawing on main; the state round-trips; the art hash ignores it.
    expect(run(s, 'px 5,5 c=ink').doc!.cels[1]![0]![5 * 24 + 5]).toBe(0);
    expect(deserializeDoc(serializeDoc(d)).layers[0]!.underlay).toEqual(d.layers[0]!.underlay);
    expect(artHash(d)).toBe(artHash(run(EMPTY, 'new sheet scene 24x16 cell=8x8\nrect 0,0 4x4 c=moss fill').doc!));
    expect(() => run(s, 'underlay generate "a draft"')).toThrow(/runs through the server/);
    expect(() => run(s, `underlay main blob=${SHA} image=10x10`)).toThrow(/art layer/);
  });

  it('snap: the underlay into a draft layer whose line holds the rows; replay needs no image', () => {
    const cols = 24, rows = 16;
    const { art, img } = synthetic(cols, rows, 6, 0, 0, 77);
    const images = (b: string) => (b === SHA ? img : undefined);
    const base = run(EMPTY, `new sheet scene ${cols}x${rows} cell=8x8\nunderlay mock blob=${SHA} image=${img.width}x${img.height}`);
    const r = runBatch(base, 'snap', { by: 'test', palettes, images });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const d = r.state.doc!;
    expect(d.layers.map((l) => l.name)).toEqual(['mock', 'main', 'draft']);
    const line = r.added[0]!.cmd;
    expect(line.split('\n')[0]).toMatch(/^snap from=mock into=draft at=0,0 grid=24x16 pitch=[56]\.\d{3}x[56]\.\d{3} offset=[\d.]+,[\d.]+ r2=0\.\d\d material=none <<$/);
    let same = 0;
    for (let i = 0; i < art.length; i++) if (d.cels[2]![0]![i] === art[i]) same++;
    expect(same / art.length).toBeGreaterThan(0.99);
    // Replayed without any image: the same document.
    const again = replay(r.state.entries, palettes);
    expect(again.problems).toEqual([]);
    expect(serializeDoc(again.doc!)).toEqual(serializeDoc(d));
    // Without the image it cannot run; a second snap into the same layer is refused.
    expect(() => run(base, 'snap')).toThrow(/not readable here/);
    expect(runBatch(r.state, 'snap', { by: 'test', palettes, images }).ok).toBe(false);
  });

  it('import asset= region=: a tile cut from another asset, its pixels in the line', () => {
    const scene = run(EMPTY, 'new sheet scene 16x8 cell=8x8\nrect 8,0 8x8 c=leaf fill\npx 9,1 c=ink').doc!;
    const r = runBatch(EMPTY, 'new tile cut 8x8\nimport 0,0 asset=scene region=8,0,8x8', { by: 'test', palettes, assets: (n) => (n === 'scene' ? scene : undefined) });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.added[1]!.cmd.split('\n')[0]).toBe('import 0,0 from="scene 8,0,8x8" <<');
    expect(r.state.doc!.cels[0]![0]![1 * 8 + 1]).toBe(0);
    expect(replay(r.state.entries, palettes).problems).toEqual([]);
  });
});
