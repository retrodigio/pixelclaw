// G11: jaggies on ramp shading, icons, fonts, underlays and snap.
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

describe('fonts', () => {
  it('a glyph sheet: cells in chars order, normal forms, advances', () => {
    const s = run(EMPTY, FONT);
    const d = s.doc!;
    expect(d.kind).toBe('font');
    expect([d.width, d.height, d.cellW, d.cellH]).toEqual([15, 14, 5, 7]);
    expect(s.entries[0]!.cmd.split('\n')[0]).toBe('new font tiny 5x7 palette=test wrap=off cell=5x7 bg=none chars=65-66,49,32,46 cols=3 baseline=6 line=8 spacing=1 <<');
    expect(s.entries.map((e) => e.cmd.split('\n')[0])).toContain('glyph U+0020 advance=3');
    expect(glyphs(d).map((g) => [charText(g.cp), g.advance])).toEqual([['A', 4], ['B', 4], ['1', 2], ['U+0020', 3], ['U+002E', 1]]);
  });

  it('the glyph strip matches the format spec', () => {
    const d = run(EMPTY, FONT).doc!;
    const { img, chars } = fontStrip(d, d.palette.entries.map((e) => e.hex));
    expect(chars).toBe('AB1 .');
    const advances = [4, 4, 2, 3, 1];
    // One separator column before, between and after: 1 + Σ(advance + 1).
    expect(img.width).toBe(1 + advances.reduce((s, a) => s + a + 1, 0));
    expect(img.height).toBe(7);
    const px = (x: number, y: number) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
    expect(px(0, 0)).toEqual([255, 0, 0, 255]);
    const r = readStrip(img);
    expect(r.separator).toBe('#ff0000');
    expect(r.glyphs.map(([a, b]) => b - a)).toEqual(advances);
    // Every pixel of a separator column is the separator colour; no glyph pixel is.
    const sepCols = [0, ...r.glyphs.map(([, b]) => b)];
    for (const x of sepCols) for (let y = 0; y < 7; y++) expect(px(x, y)).toEqual([255, 0, 0, 255]);
    const ink = [0x14, 0x16, 0x1c, 255];
    r.glyphs.forEach(([a, b], i) => {
      const cell = glyphCell(d, i);
      for (let y = 0; y < 7; y++) for (let x = a; x < b; x++) {
        const drawn = d.cels[0]![0]![(cell[1] + y) * d.width + cell[0] + x - a] !== 0xffff;
        expect(px(x, y)).toEqual(drawn ? ink : [0, 0, 0, 0]);
      }
    });
    // A glyph in the separator colour is refused.
    const red = run(run(EMPTY, FONT), 'palette add red hex=#ff0000 key=R\nglyph A <<\nR\n>>').doc!;
    expect(() => fontStrip(red, red.palette.entries.map((e) => e.hex))).toThrow(/separator colour/);
  });

  it('BMFont: one char line per glyph with its box, offsets and advance', () => {
    const d = run(EMPTY, FONT).doc!;
    const { fnt, img } = fontBmfont(d, d.palette.entries.map((e) => e.hex), 'tiny_0.png');
    const lines = fnt.trim().split('\n');
    expect(lines[0]).toMatch(/^info face="tiny" size=7 /);
    expect(lines[1]).toMatch(/^common lineHeight=8 base=7 scaleW=\d+ scaleH=\d+ pages=1 /);
    expect(lines[2]).toBe('page id=0 file="tiny_0.png"');
    expect(lines[3]).toBe('chars count=5');
    const chars = lines.filter((l) => l.startsWith('char ')).map((l) => Object.fromEntries(l.split(' ').slice(1).map((kv) => kv.split('=')).map(([k, v]) => [k, Number(v)])));
    expect(chars.map((c) => c.id)).toEqual([65, 66, 49, 32, 46]);
    expect(chars.map((c) => c.xadvance)).toEqual([5, 5, 3, 4, 2]);
    expect(chars[4]).toMatchObject({ width: 1, height: 1, xoffset: 0, yoffset: 6 });
    expect(chars[3]).toMatchObject({ width: 0, height: 0 });
    // The page holds each box where its char line says.
    const a = chars[0]!;
    expect(img.data[((a.y + 0) * img.width + a.x + 1) * 4 + 3]).toBe(255); // A's top row .00.
    expect(img.data[((a.y + 0) * img.width + a.x) * 4 + 3]).toBe(0);
    expect(lines.at(-1)).toBe('kernings count=0');
  });

  it('the font check: cap height, baseline, advances, line height', () => {
    expect(check(run(EMPTY, FONT).doc!, 'font')).toMatchObject({ status: 'pass', score: 0 });
    // B one row short (cap height 6) and sitting a row up; 1 drawn past an advance of 1; a line of 6.
    const bad = run(run(EMPTY, FONT), 'glyph B <<\n.\n000.\n0..0\n000.\n0..0\n000.\n>>\nglyph 1 advance=1\nfont set line=6').doc!;
    const r = check(bad, 'font');
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/cap height 7: B 6/);
    expect(r.detail).toMatch(/off the baseline \(row 6\): B ends on row 5/);
    expect(r.detail).toMatch(/drawn past the advance: 1/);
    expect(r.detail).toMatch(/line height 6 is less than the glyphs' 7 rows/);
    expect(check(run(EMPTY, FONT).doc!, 'font', { style: { checks: { font: { maxLine: 7 } } } }).detail).toMatch(/over the limit 7/);
    // The sprite checks that read letters as defects are off on a sheet.
    expect(check(bad, 'orphans').status).toBe('skip');
  });

  it('export through a profile: strip and BMFont files', () => {
    const d = run(EMPTY, FONT).doc!;
    const r = exportProfile({ name: 'f', layout: 'loose', fonts: { format: 'both', maxLine: 7 } }, [d]);
    expect([...r.files.keys()].sort()).toEqual(['tiny.fnt', 'tiny.png', 'tiny.txt', 'tiny_0.png']);
    expect(new TextDecoder().decode(r.files.get('tiny.txt'))).toBe('AB1 .\n');
    expect(r.notes.join()).toMatch(/line height 8 is over the profile's limit 7/);
  });
});

describe('icons', () => {
  const icon = (mode: string, body: string, name = 'i') => doc(`new icon ${name} 8x8\n${mode}\n${body}`);
  it('export modes: tone through roles, full and channel as drawn', () => {
    const tone = icon('palette add hi role=light\nicon mode=tone', 'rect 2,2 4x4 c=hi fill');
    const full = icon('palette add hi role=light\nicon mode=full', 'rect 2,2 4x4 c=hi fill', 'k');
    const roles = { light: '#cccccc' };
    const hi = tone.palette.entries.findIndex((e) => e.name === 'hi');
    expect(exportColours(tone, roles)[hi]).toBe('#cccccc');
    expect(exportColours(full, roles)[hi]).toBe(full.palette.entries[hi]!.hex);
    // Tone art must be roles; full art must not; channel art is pure channels.
    expect(check(icon('icon mode=tone', 'rect 2,2 4x4 c=moss fill'), 'palette').detail).toMatch(/fixed colour in a tone icon/);
    expect(check(full, 'palette').detail).toMatch(/role in a full-colour icon/);
    const ch = icon('palette add r hex=#ff0000 key=R\npalette add g hex=#00ff00 key=G\nicon mode=channel', 'rect 1,1 3x3 c=r fill\nrect 4,4 3x3 c=g fill');
    expect(check(ch, 'palette')).toMatchObject({ status: 'pass', detail: 'all 18 px are pure channel colours' });
    expect(check(icon('icon mode=channel', 'px 1,1 c=moss'), 'palette').detail).toMatch(/not a pure channel colour/);
    expect(iconModeOf(doc('new icon j 8x8'))).toBe('full');
    expect(() => run(EMPTY, 'new sprite s 8x8\nicon mode=tone')).toThrow(/not an icon/);
    const r = exportProfile({ name: 'a', layout: 'atlas', records: { format: 'csv', columns: ['sprite', 'mode'] } }, [tone, full]);
    expect(new TextDecoder().decode(r.files.get('atlas.csv'))).toBe('sprite,mode\ni,tone\nk,full\n');
  });

  it('the icon-set checks: stroke weight, box fill, optical centre', () => {
    const ring = (x: number, y: number, n: number, w = 1) => `rect ${x},${y} ${n}x${n} c=ink outline${w > 1 ? `\nrect ${x + 1},${y + 1} ${n - 2}x${n - 2} c=ink outline` : ''}`;
    const set = [
      { name: 'a', doc: doc(`new icon a 12x12\n${ring(2, 2, 8)}`) },
      { name: 'b', doc: doc(`new icon b 12x12\n${ring(2, 2, 8)}\npx 5,5 6,6 c=ink`) },
      { name: 'c', doc: doc(`new icon c 12x12\n${ring(3, 2, 7)}\npx 3,9 c=ink`) },
    ];
    const ok = check(set[0]!.doc, 'consistency', { peers: set });
    expect(ok.status).toBe('pass');
    expect(ok.parts!.map((p) => p.name)).toEqual(expect.arrayContaining(['stroke weight', 'box fill', 'optical centre']));
    // A thick ring, small and pushed into a corner: every icon measure is off.
    const odd = doc(`new icon d 12x12\n${ring(0, 0, 5, 2)}`);
    const r = check(odd, 'consistency', { peers: set });
    expect(r.status).toBe('fail');
    const bad = r.parts!.filter((p) => p.pass === false).map((p) => p.name);
    expect(bad).toEqual(expect.arrayContaining(['stroke weight', 'box fill', 'optical centre']));
    expect(r.groups.at(-1)!.label).toMatch(/the drawn box/);
    // On its own, an icon is still held to the canvas centre.
    expect(check(odd, 'consistency').parts!.map((p) => p.name)).toEqual(['optical centre']);
  });
});

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
