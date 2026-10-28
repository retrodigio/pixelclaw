// G11: jaggies on ramp shading (plan §19), icons (§4.5), fonts (§4.6), underlays and snap (§6).
import { describe, expect, it } from 'vitest';
import { charText, exportColours, exportProfile, fontBmfont, fontStrip, glyphCell, glyphs, iconModeOf, readStrip, runChecks, type CheckId, type CheckResult, type Doc } from '../src/index.ts';
import { EMPTY, run } from './helpers.ts';

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

describe('jaggies on ramp shading (§19)', () => {
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

describe('fonts (§4.6)', () => {
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

describe('icons (§4.5)', () => {
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
