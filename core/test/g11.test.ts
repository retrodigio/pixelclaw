// G11: jaggies on ramp shading (plan §19), icons (§4.5), fonts (§4.6), underlays and snap (§6).
import { describe, expect, it } from 'vitest';
import { runChecks, type CheckId, type CheckResult, type Doc } from '../src/index.ts';
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
