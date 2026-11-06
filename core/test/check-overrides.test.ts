// Per-asset overrides for the anim and margin checks (and any other): `style.assets.<name>.checks.<check>`.

import { describe, expect, it } from 'vitest';
import { runChecks, type CheckStyle } from '../src/index.ts';
import { EMPTY, run } from './helpers.ts';

const walk = () => run(EMPTY, 'new sprite walk 8x8\nrect 1,1 5x5 c=stone fill\nframe add copy=1\nframe 2\npx 3,3 c=ink').doc!;
const anim = (style?: CheckStyle) => runChecks(walk(), ['anim'], { style })[0]!;

describe('per-asset overrides', () => {
  it('anim: the asset can ask for less change between frames, or more, or be left out', () => {
    // Two frames differing by one pixel of 25: under the default minimum.
    expect(anim().status).toBe('fail');
    expect(anim({ checks: { anim: { minDiff: 0 } } }).status).toBe('pass');
    expect(anim({ assets: { walk: { checks: { anim: { minDiff: 0 } } } } }).status).toBe('pass');
    expect(anim({ assets: { other: { checks: { anim: { minDiff: 0 } } } } }).status).toBe('fail');
    expect(anim({ assets: { walk: { checks: { anim: { off: true } } } } }).status).toBe('skip');
    // the asset's own value wins over the project's
    expect(anim({ checks: { anim: { minDiff: 0 } }, assets: { walk: { checks: { anim: { minDiff: 0.9 } } } } }).status).toBe('fail');
  });
  it('margin: an object that fills its cells can have the check turned on, or its limit set', () => {
    const o = run(EMPTY, 'new object bld 16x16 cell=8x8\nrect 0,0 16x16 c=stone fill').doc!;
    const margin = (style?: CheckStyle) => runChecks(o, ['margin'], { style })[0]!;
    expect(margin().status).toBe('skip');
    expect(margin({ assets: { bld: { checks: { margin: { off: false } } } } }).status).toBe('fail');
    expect(margin({ assets: { bld: { checks: { margin: { off: false, max: 100 } } } } }).status).toBe('pass');
    const sprite = run(EMPTY, 'new sprite fill 8x8\nrect 0,0 8x8 c=stone fill').doc!;
    expect(runChecks(sprite, ['margin'], {})[0]!.status).toBe('fail');
    expect(runChecks(sprite, ['margin'], { style: { assets: { fill: { checks: { margin: { off: true } } } } } })[0]!.status).toBe('skip');
    expect(runChecks(sprite, ['margin'], { style: { assets: { fill: { checks: { margin: { bottom: true, max: 0 } } } } } })[0]!.status).toBe('fail');
  });
});
