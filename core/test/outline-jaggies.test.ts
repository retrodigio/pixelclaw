// `outline mode=outer corners=off` around diagonal strokes passes the jaggies check on its own
// output: the ring wraps round the stroke's tips without those tips counting as spikes, and
// leaves no doubled L-corners. A stray nub on a flat edge is still a spike.

import { describe, expect, it } from 'vitest';
import { runChecks } from '../src/index.ts';
import { EMPTY, run } from './helpers.ts';

const jaggies = (text: string) => runChecks(run(EMPTY, `new sprite d 16x16\n${text}`).doc!, ['jaggies'], {})[0]!;

describe('outline corners=off and the jaggies check', () => {
  it.each([['2,2', '12,12'], ['2,12', '12,3'], ['2,3', '13,8'], ['3,2', '8,13'], ['4,2', '5,13']])('a diagonal stroke %s to %s', (a, b) => {
    const r = jaggies(`line ${a} ${b} c=stone\noutline c=ink mode=outer corners=off`);
    expect(r.detail).toBe('lines and outlines step evenly');
    expect(r.status).toBe('pass');
  });
  it('crossing strokes and a curve', () => {
    expect(jaggies('line 2,2 12,12 c=stone\nline 12,2 2,12 c=stone\noutline c=ink corners=off').groups.map((g) => g.label)).not.toContain('doubled L-corner');
    expect(jaggies('curve 2,12 8,2 14,12 c=stone\noutline c=ink corners=off').status).toBe('pass');
  });
  it('a nub on a flat edge is still a spike', () => {
    const r = jaggies('rect 3,3 8x8 c=stone fill\noutline c=ink\npx 6,1 c=ink');
    expect(r.groups.find((g) => g.label === 'spike on the outline')?.pts).toContainEqual([6, 1]);
  });
});
