// G6 checks: `anim` (frame diff share, loop seam, pivot drift, ground drift, area jumps) and `views`
// (distinct directions) on fixtures with known answers; and every other check over every frame.
import { describe, expect, it } from 'vitest';
import { flaggedOn, runChecks, type CheckResult, type Doc } from '../src/index.ts';
import { EMPTY, run } from './helpers.ts';

const doc = (text: string): Doc => run(EMPTY, text).doc!;
const check = (d: Doc, id: 'anim' | 'views' | 'orphans', o = {}): CheckResult => runChecks(d, [id], o)[0]!;
const part = (r: CheckResult, name: string) => r.parts!.find((p) => p.name === name)!;

// A 6x8 figure: a 4x5 body on two 1-px legs; the frames move its legs.
const BODY = '  .0000.\n  .0110.\n  .0110.\n  .0110.\n  .0000.';
const fig = (legs: string[], dx = 0, dy = 0) => `paint ${dx},${dy} <<\n${BODY}\n  ${legs[0]}\n  ${legs[1]}\n>>`;
const STAND = ['.0..0.', '.0..0.'];
const STEP = ['0...0.', '0....0'];

describe('anim: frame diff share', () => {
  it('a small step passes; identical frames and a jump fail, with the changed pixels flagged', () => {
    const good = doc(`new sprite f 8x8\n${fig(STAND)}\nframe add empty\nframe 2\n${fig(STEP)}`);
    const r = check(good, 'anim');
    // 6 pixels of the legs change; the union of both silhouettes is 27: 22 %.
    expect(r.status).toBe('pass');
    expect(r.score).toBeCloseTo(6 / 27, 9);
    const same = check(doc(`new sprite f 8x8\n${fig(STAND)}\nframe add`), 'anim');
    expect(same.status).toBe('fail');
    expect(same.groups[0]!.label).toMatch(/the frames are the same/);
    const jump = check(doc(`new sprite f 8x8\n${fig(STAND)}\nframe add empty\nframe 2\n${fig(STAND, 2)}`), 'anim');
    expect(jump.status).toBe('fail');
    expect(jump.groups.find((g) => /too much changes/.test(g.label))!.frame).toBe(1);
  });

  it('the loop seam of a cycle: the last frame back to the first', () => {
    const d = doc(`new sprite f 8x8\n${fig(STAND)}\nframe add empty\nframe 2\n${fig(STEP)}\nframe add empty\nframe 3\n${fig(['0...0.', '0...0.'])}\nframe set 1-3 ticks=8`);
    // 1→2 changes 6 of 27 px, 2→3 2 of 25 (the band's floor, 8 %); the seam 3→1 changes 4 of 26.
    const r = check(d, 'anim');
    expect(r.status).toBe('pass');
    expect(part(r, 'frame diff').detail).toBe('pairs change 8%..22.2% of their pixels');
    expect(part(r, 'loop seam')).toMatchObject({ value: 4 / 26, pass: true, detail: 'all 3→1 changes 15.4%' });
    // A stricter style floor fails the 2→3 pair but not the seam.
    const strict = runChecks(d, ['anim'], { style: { checks: { anim: { minDiff: 0.1 } } } })[0]!;
    expect([part(strict, 'frame diff').pass, part(strict, 'loop seam').pass]).toEqual([false, true]);
    // As a ping-pong there is no seam.
    expect(check(run({ doc: d, entries: [] }, 'tag add bob 1-3 loop=pingpong').doc!, 'anim').parts!.some((p) => p.name === 'loop seam')).toBe(false);
  });
});

describe('anim: pivot and ground drift', () => {
  it('a figure sliding 2 px drifts 2 px from frame to frame', () => {
    const d = doc(`new sprite f 10x8\n${fig(STAND)}\nframe add empty\nframe 2\n${fig(STEP, 2)}\nanim_off_placeholder`.replace('\nanim_off_placeholder', ''));
    const r = check(d, 'anim');
    const p = part(r, 'pivot drift');
    expect(p.pass).toBe(false);
    // The centre column goes from 60/24 to 107/24.
    expect(p.value).toBeCloseTo(47 / 24, 9);
    const g = r.groups.find((x) => /slides/.test(x.label))!;
    expect(g.frame).toBeDefined();
  });

  it('a frame lifted off the ground line floats', () => {
    const d = doc(`new sprite f 8x9\n${fig(STAND, 0, 1)}\nground 7\nframe add empty\nframe 2\n${fig(STEP)}`);
    const r = check(d, 'anim');
    expect(part(r, 'ground drift')).toMatchObject({ value: 1, pass: false });
    const g = r.groups.find((x) => /floats/.test(x.label))!;
    expect(g.frame).toBe(1);
    expect(g.pts).toEqual([[0, 6], [5, 6]]);
  });

  it('tiles have no pivot or ground; a still tile changes too little', () => {
    const r = check(doc('new tile t 4x4 bg=moss\nframe add\nframe 2\npx 1,1 c=leaf'), 'anim');
    expect(r.parts!.map((p) => p.name)).toEqual(['frame diff']);
    expect(r).toMatchObject({ status: 'pass', score: 1 / 16 }); // the tile floor is 3 %
    expect(check(doc('new tile t 4x4 bg=moss\nframe add'), 'anim').status).toBe('fail');
  });
});

describe('views: distinct directions', () => {
  const views = (n: string) => doc(`new sprite c 8x8\n${fig(STAND)}\nframe add\nframe add empty\nview S frames=1\nview N frames=2\nview E frames=3\nframe 3\n${fig(STEP, 2)}\n${n}`);
  it('a back view the same as the front fails; a different one passes; E and W are not compared', () => {
    const same = check(views(''), 'views');
    expect(same).toMatchObject({ status: 'fail', score: 0 });
    expect(same.detail).toMatch(/S and N look too alike/);
    const back = check(views('frame 2\nrect 2,1 2x3 c=rust fill'), 'views');
    expect(back.status).toBe('pass');
    const ew = doc(`new sprite c 8x8\n${fig(STAND)}\nview E frames=1\nview W mirror=E`);
    expect(check(ew, 'views').status).toBe('skip');
  });
});

describe('checks over every frame', () => {
  it('a stray pixel on frame 2 is found and named by its frame', () => {
    const d = doc(`new sprite f 8x8\n${fig(STAND)}\nframe add\nframe 2\npx 7,0 c=rust`);
    const r = check(d, 'orphans');
    expect(r.status).toBe('fail');
    expect(r.frame).toBe(1);
    expect(r.detail).toMatch(/^frame 2: /);
    expect(flaggedOn(r, 0)).toEqual([]);
    expect(flaggedOn(r, 1)).toEqual([[7, 0]]);
    // One frame asked for: only that one.
    expect(check(d, 'orphans', { frame: 0 }).status).toBe('pass');
  });

  it('over the budget, only the focus frame is checked, and the summary says so', () => {
    const d = doc(`new sprite f 64x64\n${fig(STAND)}\nframe add\nframe 2\npx 60,0 c=rust`);
    const r = check(d, 'orphans', { budget: 4096, focus: 0 });
    expect(r.status).toBe('pass');
    expect(r.detail).toMatch(/frame 1 of 2 only/);
    expect(check(d, 'orphans', { budget: 4096, focus: 1 }).status).toBe('fail');
  });
});
