// The checks of plan §5 on synthetic fixtures with known answers (G5). Coordinates and scores
// are worked out by hand in the comments.
import { describe, expect, it } from 'vitest';
import { lstar, luma601, repetitionScore, runChecks, seamScore, type CheckId, type CheckResult, type Doc } from '../src/index.ts';
import { EMPTY, TEST_PALETTE, run } from './helpers.ts';

const doc = (text: string): Doc => run(EMPTY, text).doc!;
const check = (d: Doc, id: CheckId, ctx: Parameters<typeof runChecks>[2] = {}): CheckResult => runChecks(d, [id], ctx)[0]!;
const pts = (r: CheckResult) => r.flagged.map(([x, y]) => `${x},${y}`).sort();
const hex = (name: string) => TEST_PALETTE.entries.find((e) => e.name === name)!.hex;

describe('palette', () => {
  it('flags pixels whose colour is not in the style palettes', () => {
    const d = doc('new sprite s 8x8\nrect 0,0 4x4 c=moss fill\npalette add neon hex=#ff00ff\npx 1,1 2,2 c=neon');
    expect(check(d, 'palette')).toMatchObject({ status: 'pass', score: 0 });
    const r = check(d, 'palette', { style: { palettes: [TEST_PALETTE] } });
    expect(r).toMatchObject({ status: 'fail', score: 2 });
    expect(pts(r)).toEqual(['1,1', '2,2']);
    expect(r.groups[0]!.label).toBe('neon #ff00ff is not in the style palettes');
  });

  it('in role art, flags fixed colours', () => {
    const d = doc('new sprite s 4x4\npalette add skin role=light\npalette add shade role=dark\nrect 0,0 4x2 c=skin fill\nrect 0,2 4x2 c=shade fill\npx 3,3 c=ink');
    const r = check(d, 'palette');
    expect(r.score).toBe(1);
    expect(pts(r)).toEqual(['3,3']);
  });
});

describe('orphans', () => {
  it('flags lone pixels and diagonal pairs, not diagonal lines or clusters', () => {
    const d = doc([
      'new sprite s 10x10',
      'rect 0,0 3x3 c=moss fill', // a cluster
      'px 8,0 c=ink', // lone: 1
      'px 0,8 1,9 c=leaf', // a diagonal pair: 2 near-orphans
      'px 5,5 6,6 7,7 c=stone', // a diagonal line of 3: fine
      'px 5,0 6,0 c=rust', // a pair side by side: fine
    ].join('\n'));
    const r = check(d, 'orphans');
    expect(pts(r)).toEqual(['0,8', '1,9', '8,0']);
    // 3 strays in 9 + 1 + 2 + 3 + 2 = 17 opaque px.
    expect(r.score).toBeCloseTo((100 * 3) / 17, 6);
    expect(r.status).toBe('fail');
    expect(r.groups.map((g) => g.label)).toEqual(['lone pixel (no neighbour shares its colour)', 'near-orphan (a diagonal pair)']);
  });

  it('on tiles, allows strays one ramp step from their surroundings', () => {
    // leaf is one step from moss on the green ramp; rust shares no ramp with moss.
    const d = doc('new tile t 8x8 bg=moss\npx 2,2 c=leaf\npx 5,5 c=rust');
    const r = check(d, 'orphans');
    expect(pts(r)).toEqual(['5,5']);
    expect(r.detail).toContain('1 one ramp step from their surroundings allowed as texture');
  });
});

describe('jaggies', () => {
  it('a pixel-perfect line, a box and an ellipse step evenly', () => {
    expect(check(doc('new sprite s 24x12\nline 0,0 20,6 c=ink'), 'jaggies').score).toBe(0);
    expect(check(doc('new sprite s 12x12\nrect 1,1 10x10 c=ink'), 'jaggies').score).toBe(0);
    expect(check(doc('new sprite s 24x24\nellipse 12,12 r=10x7 c=ink fill'), 'jaggies').score).toBe(0);
  });

  it('flags a doubled L-corner inside a line, not a right angle between straight arms', () => {
    // 0,0 1,0 | 1,1 2,1 3,1 | 3,2 4,2 5,2: two doubled corners, each a pair of elbow pixels
    // (1,0 and 1,1; 3,1 and 3,2) where a pixel-perfect line steps diagonally.
    const r = check(doc('new sprite s 8x4\npx 0,0 1,0 1,1 2,1 3,1 3,2 4,2 5,2 c=ink'), 'jaggies');
    expect(r.groups.find((g) => g.label === 'doubled L-corner')!.pts.map(String).sort()).toEqual(['1,0', '1,1', '3,1', '3,2']);
    expect(r.detail).toMatch(/^2 doubled L-corners/);
    // A hook (a line that turns and stops) and a bracket are meant: no zig-zag through the corner.
    expect(check(doc('new sprite s 8x8\npx 3,0 3,1 3,2 3,3 2,3 c=ink'), 'jaggies').score).toBe(0);
    expect(check(doc('new sprite s 8x8\npx 1,1 2,1 3,1 3,2 3,3 2,3 c=ink'), 'jaggies').score).toBe(0);
    // The same shape drawn as a pixel-perfect line has none.
    expect(check(doc('new sprite s 8x4\nline 0,0 5,2 c=ink'), 'jaggies').score).toBe(0);
  });

  it('flags the one irregular run in 3-3-3-1-3-3-3', () => {
    // Runs along x, each one row lower: x 0-2, 3-5, 6-8, 9, 10-12, 13-15, 16-18.
    const runs = [3, 3, 3, 1, 3, 3, 3];
    const px: string[] = [];
    let x = 0;
    runs.forEach((n, y) => { for (let i = 0; i < n; i++) px.push(`${x++},${y}`); });
    const r = check(doc(`new sprite s 20x8\npx ${px.join(' ')} c=ink`), 'jaggies');
    expect(r.score).toBe(1);
    expect(pts(r)).toEqual(['9,3']);
    expect(r.groups[0]!.label).toBe('irregular step run');
  });

  it('on a tile, the ground colour between marks is not a line', () => {
    // A staircase with doubled corners inside a block of marks: in the ground colour it is just
    // ground showing between marks; in a mark colour it is a jagged line.
    const stairs = 'px 1,1 2,1 2,2 3,2 3,3 4,3';
    expect(check(doc(`new tile t 12x12 bg=moss\nrect 0,0 6x6 c=leaf fill\n${stairs} c=moss`), 'jaggies').score).toBe(0);
    expect(check(doc(`new tile t 12x12 bg=moss\nrect 0,0 6x6 c=leaf fill\n${stairs} c=rust`), 'jaggies').score).toBeGreaterThan(0);
  });

  it('flags a spike and a notch on a silhouette', () => {
    const d = doc('new sprite s 12x12\nrect 2,2 8x8 c=moss fill\npx 5,1 c=moss\npx 9,6 c=none');
    const r = check(d, 'jaggies');
    expect(r.groups.find((g) => g.label === 'spike on the outline')!.pts).toEqual([[5, 1]]);
    expect(r.groups.find((g) => g.label === 'notch in the outline')!.pts).toEqual([[9, 6]]);
  });
});

describe('banding', () => {
  it('a square lighter inward on every side is pillow shaded', () => {
    const d = doc('new sprite s 16x16\nrect 2,2 12x12 c=moss fill\nrect 4,4 8x8 c=leaf fill');
    const r = check(d, 'banding');
    expect(r).toMatchObject({ status: 'fail', score: 1 });
    // The flagged pixels are the outer band's inner edge: 8 per side.
    expect(r.flagged.length).toBe(32);
  });

  it('a square lit from the top left is not', () => {
    const d = doc('new sprite s 16x16\nrect 2,2 12x12 c=moss fill\nrect 2,2 12x2 c=leaf fill\nrect 2,2 2x12 c=leaf fill');
    expect(check(d, 'banding')).toMatchObject({ status: 'pass', score: 0 });
  });

  it('is judged per material: a pillowed cap stays flagged beside a stem lit from one side', () => {
    const d = doc([
      'new sprite s 20x20', 'ramp stoneish = ink stone', // a second ramp for the stem
      'rect 1,1 12x8 c=moss fill', 'rect 3,3 8x4 c=leaf fill', // pillowed: lighter inward on every side
      'rect 14,1 5x16 c=ink fill', 'rect 14,1 2x16 c=stone fill', // lit from the left only
    ].join('\n'));
    const r = check(d, 'banding');
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/^ramp green:/);
  });

  it('flat colour has nothing to band', () => {
    expect(check(doc('new sprite s 8x8\nrect 1,1 6x6 c=moss fill'), 'banding')).toMatchObject({ status: 'pass', score: 0 });
  });
});

describe('outline', () => {
  it('is the share of the silhouette edge in ink; the gaps are flagged', () => {
    const d = doc('new sprite s 10x10\nrect 1,1 8x8 c=moss fill\nrect 1,1 8x8 c=ink');
    expect(check(d, 'outline')).toMatchObject({ status: 'pass', score: 1 });
    const g = run({ doc: d, entries: [] }, 'px 4,1 5,1 1,5 c=moss').doc!;
    const r = check(g, 'outline');
    // 28 edge pixels, 3 of them moss.
    expect(r.score).toBeCloseTo(25 / 28, 9);
    expect(r.status).toBe('pass');
    expect(pts(r)).toEqual(['1,5', '4,1', '5,1']);
    expect(check(g, 'outline', { style: { checks: { outline: { min: 0.95 } } } }).status).toBe('fail');
  });

  it('in role art, the black role is the outline', () => {
    const d = doc('new sprite s 8x8\npalette add rim role=black\npalette add body role=dark\nrect 1,1 6x6 c=body fill\noutline c=rim');
    expect(check(d, 'outline', { style: { outline: ['ink'] } })).toMatchObject({ status: 'pass', score: 1 });
  });
});

describe('seam (plan §13)', () => {
  it('a solid tile scores 0', () => {
    const d = doc('new tile t 8x8 bg=moss');
    expect(seamScore(d).score).toBe(0);
    expect(check(d, 'seam')).toMatchObject({ status: 'pass', score: 0 });
  });

  it('a one-pixel ink frame makes a large line score', () => {
    // 3x3 tiles of 8: columns 7, 8, 15, 16 touch a border and are all ink (grey Li); x = 0 and
    // 23 are ink too but not "touching"; the other 18 columns are 2/8 ink and 6/8 moss (grey c).
    // line = |Li - (0.1 Li + 0.9 c)| / (0.3 |Li - c| + 2) = 0.9 d / (0.3 d + 2), d = |Li - c|.
    const d = doc('new tile t 8x8 bg=moss\nrect 0,0 8x8 c=ink');
    const li = luma601(hex('ink'));
    const c = (2 * li + 6 * luma601(hex('moss'))) / 8;
    const dd = Math.abs(li - c);
    expect(dd).toBeCloseTo(49.629, 3);
    const s = seamScore(d);
    expect(s.lx).toBeCloseTo((0.9 * dd) / (0.3 * dd + 2), 9);
    expect(s.lx).toBeCloseTo(2.6447, 4);
    expect(s.ly).toBeCloseTo(s.lx, 9);
    // Border column pairs are both ink (no change); 6 of the other 21 pairs change in 6 of 8 rows.
    const m = (6 * 0.75) / 21;
    expect(s.jx).toBeCloseTo((0 - m) / (0.75 * Math.sqrt((6 / 21) * (15 / 21)) + 0.02), 9);
    expect(s.score).toBeCloseTo(2.6447, 4);
    const r = check(d, 'seam');
    expect(r.status).toBe('fail');
    expect(r.groups.map((g) => g.label)).toEqual([
      'left and right edge columns stand out (a line at the seam)', 'top and bottom edge rows stand out (a line at the seam)',
    ]);
  });

  it('a colour change at the left-right border makes a jump', () => {
    // Left half moss, right half leaf: every tile border (k = 7, 15) changes in every row, and
    // so do the middles (k = 3, 11, 19). jump = (1 - 1/7) / (sqrt(1/7 * 6/7) + 0.02).
    const s = seamScore(doc('new tile t 8x8 bg=moss\nrect 4,0 4x8 c=leaf fill'));
    expect(s.jx).toBeCloseTo((1 - 1 / 7) / (Math.sqrt((1 / 7) * (6 / 7)) + 0.02), 9);
    expect(s.jx).toBeCloseTo(2.3171, 4);
    expect(s.lx).toBeCloseTo(0, 9);
    expect(s.jy).toBeCloseTo(0, 9);
    expect(s.ly).toBeCloseTo(0, 9);
  });

  it('a random-noise tile reads as seamless', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const d = doc(`new tile t 24x24 bg=moss\nnoise ramp=green weights=1,1 cluster=1..1 density=0.5 seed=${seed}`);
      expect(seamScore(d).score).toBeLessThan(1);
    }
  });
});

describe('coverage', () => {
  it('flags an empty cell of a sheet and a size the style does not allow', () => {
    const d = doc('new sheet s 16x8 cell=8x8\nrect 1,1 4x4 c=moss fill');
    const r = check(d, 'coverage', { style: { sizes: { sheet: '24x24' } } });
    expect(r.score).toBe(2);
    expect(r.detail).toBe(`size 16x8 is not the style's 24x24 for a sheet; cell (1,0) is empty`);
    expect(r.flagged.length).toBe(28); // the empty cell's border
    expect(check(d, 'coverage', { style: { sizes: { sheet: '16x8|24x24' } } }).score).toBe(1);
  });

  it('flags an empty frame', () => {
    const d = doc('new sprite s 4x4\npx 1,1 c=ink\nframe add empty');
    expect(check(d, 'coverage').detail).toBe('frame 2 is empty');
  });
});

describe('readability', () => {
  const ground = doc('new tile g 8x8 bg=moss');
  it('edge contrast against the ground, in ΔL*', () => {
    const flat = doc('new sprite s 8x8\nrect 2,2 4x4 c=moss fill\nrect 3,3 2x2 c=leaf fill');
    const r = check(flat, 'readability', { ground });
    expect(r.parts![0]).toMatchObject({ name: 'edge contrast', value: 0, pass: false });
    expect(r.flagged.length).toBe(12);
    const inked = doc('new sprite s 8x8\nrect 2,2 4x4 c=sky fill\nrect 2,2 4x4 c=ink');
    expect(check(inked, 'readability', { ground }).parts![0]).toMatchObject({ value: 1, pass: true });
  });

  it('silhouettes too like another in the set, and a flat lightness spread', () => {
    const a = doc('new sprite a 8x8\nrect 2,2 4x4 c=ink fill');
    const b = doc('new sprite b 8x8\nrect 2,2 4x5 c=ink fill');
    const r = check(a, 'readability', { set: [{ name: 'b', doc: b }] });
    const iou = r.parts!.find((p) => p.name === 'distinct silhouette')!;
    expect(iou.value).toBeCloseTo(16 / 20, 9);
    expect(iou.pass).toBe(true);
    const spread = r.parts!.find((p) => p.name === 'lightness spread')!;
    expect(spread).toMatchObject({ value: 0, pass: false });
    expect(r.status).toBe('fail');
    const c = doc('new sprite c 8x8\nrect 2,2 4x4 c=ink fill');
    expect(check(a, 'readability', { set: [{ name: 'c', doc: c }] }).parts!.find((p) => p.name === 'distinct silhouette')).toMatchObject({ value: 1, pass: false });
    void lstar;
  });
});

describe('revert', () => {
  it('the share of pixels unchanged from a reference', () => {
    const ref = doc('new sprite r 4x4\nrect 0,0 4x4 c=moss fill');
    const same = doc('new sprite a 4x4\nrect 0,0 4x4 c=moss fill\npx 0,0 c=ink');
    const r = check(same, 'revert', { ref });
    expect(r.score).toBeCloseTo(15 / 16, 9);
    expect(r.status).toBe('fail');
    expect(r.flagged.length).toBe(15);
    const redone = doc('new sprite b 4x4\nrect 0,0 4x4 c=leaf fill\npx 1,1 2,2 c=moss');
    expect(check(redone, 'revert', { ref })).toMatchObject({ status: 'pass', score: 2 / 16 });
    expect(check(redone, 'revert').status).toBe('skip');
  });
});

describe('repetition', () => {
  it('one lighter row of an 8x8 tile is a stripe of 7/8 of its ΔL*', () => {
    const d = doc('new tile t 8x8 bg=moss\nline 0,3 7,3 c=leaf');
    const want = (7 / 8) * (lstar(hex('leaf')) - lstar(hex('moss')));
    const s = repetitionScore(d);
    expect(s).toMatchObject({ axis: 'rows', from: 3, width: 1 });
    expect(s.score).toBeCloseTo(want, 9);
    const r = check(d, 'repetition');
    expect(r.status).toBe('fail');
    expect(r.flagged.length).toBe(8);
  });

  it('noise on a calm ramp passes; the same noise in strong contrast makes stripes', () => {
    for (const seed of [1, 2, 3]) {
      const calm = doc(`new tile t 24x24 bg=moss\npalette add moss2 hex=#476f3f\nnoise ramp=moss,moss2 weights=3,1 cluster=1..2 density=0.15 seed=${seed}`);
      const loud = doc(`new tile t 24x24 bg=moss\nnoise ramp=moss,ink weights=3,1 cluster=1..2 density=0.15 seed=${seed}`);
      expect(check(calm, 'repetition').status).toBe('pass');
      expect(check(loud, 'repetition').status).toBe('fail');
    }
  });

  it('G13: one mark on a calm tile is not a stripe; the limit scales with the band\'s spread', () => {
    // A 3x3 ink pebble on calm noise: its rows are 1/8 ink, so they are darker on average
    // (score above 3), but the difference is all in three pixels of each row.
    for (const seed of [1, 2, 3]) {
      const calm = doc(`new tile t 24x24 bg=moss\npalette add moss2 hex=#476f3f\nnoise ramp=moss,moss2 weights=3,1 cluster=1..2 density=0.15 seed=${seed}\nrect 10,10 3x3 c=ink fill`);
      expect(check(calm, 'repetition', { style: { checks: { repetition: { contrast: 0 } } } }).status).toBe('fail');
      const r = check(calm, 'repetition');
      expect(r.status).toBe('pass');
    }
    // A line of ink across a third of the tile is a dashed stripe when tiled: it still fails.
    const dash = doc('new tile t 24x24 bg=moss\nrect 6,10 12x1 c=ink fill');
    expect(check(dash, 'repetition').status).toBe('fail');
    // contrast=0 is the old rule.
    const pebble = doc('new tile t 24x24 bg=moss\nrect 10,10 3x3 c=ink fill');
    const r = check(pebble, 'repetition');
    expect(r).toMatchObject({ status: 'pass' });
    expect(r.detail).toMatch(/(row|rows) 1[0-2](-1[0-2])?, darker .*limit raised from 3/);
    expect(check(pebble, 'repetition', { style: { checks: { repetition: { contrast: 0 } } } }).status).toBe('fail');
    const s = repetitionScore(pebble, 0, 3, 3);
    expect(s.limit).toBeCloseTo(3 * s.spread * Math.sqrt(s.width / 24), 9);
  });
});

describe('style and context', () => {
  it('turns checks off and overrides thresholds per kind and per asset', () => {
    const d = doc('new tile t 8x8 bg=moss\nline 0,3 7,3 c=leaf');
    expect(check(d, 'repetition', { style: { checks: { repetition: { off: true } } } }).status).toBe('skip');
    expect(check(d, 'repetition', { style: { checks: { repetition: { tile: { max: 99 } } } } }).status).toBe('pass');
    expect(check(d, 'repetition', { style: { assets: { t: { checks: { repetition: { max: 99 } } } } } }).status).toBe('pass');
  });

  it('skips what does not apply', () => {
    const tile = doc('new tile t 8x8 bg=moss');
    const sprite = doc('new sprite s 8x8\npx 1,1 c=ink');
    const st = (d: Doc) => Object.fromEntries(runChecks(d).map((r) => [r.id, r.status]));
    expect(st(tile)).toMatchObject({ banding: 'skip', outline: 'skip', readability: 'skip', revert: 'skip', seam: 'pass', repetition: 'pass' });
    expect(st(sprite)).toMatchObject({ seam: 'skip', repetition: 'skip', revert: 'skip' });
  });
});
