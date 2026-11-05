// The margin and pieces checks, palette reservations, size-scaled jaggies allowances and
// consistency's ramp steps.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_SCHEMES, composeMapDoc, coverageTemplate, deserializeDoc, flatten, serializeDoc, mapWorld, parsePaletteJson, resolveVariant, runBatch, runChecks, type AssetState, type Doc, type PaletteSource, type StyleDefaults } from '../src/index.ts';
import { pebbleShape, tuftShape } from '../src/cmd-structure.ts';

const MOSSY = parsePaletteJson(readFileSync(join(import.meta.dirname, '..', '..', 'examples', 'src', 'mossy-ruins.json'), 'utf8'));
const pals: PaletteSource = { get: (n) => (n === MOSSY.name ? MOSSY : undefined), defaultName: MOSSY.name };
const EMPTY: AssetState = { doc: null, entries: [] };
function run(state: AssetState, text: string, docs: Record<string, Doc> = {}, defaults: StyleDefaults = { light: 'nw' }): AssetState {
  const r = runBatch(state, text, { by: 'test', palettes: pals, assets: (n) => docs[n], assetNames: () => Object.keys(docs), defaults });
  if (!r.ok) throw new Error(r.errors.map((e) => `${e.line}:${e.col}: ${e.message}`).join('\n'));
  return r.state;
}
const ix = (n: string) => MOSSY.entries.findIndex((e) => e.name === n);
const lastCmd = (st: AssetState) => st.entries.at(-1)!.cmd;




describe('the check changes', () => {
  const one = (d: Doc, id: Parameters<typeof runChecks>[1][number], ctx: Parameters<typeof runChecks>[2] = {}) => runChecks(d, [id], ctx)[0]!;

  it('a sprite\'s jaggies allowance grows with its size: none at 24 px, 2 at 48, 8 at 96', () => {
    // The same three doubled corners, on sprites of three sizes.
    const art = (S: number) => run(EMPTY, `new sprite s ${S}x${S}\npx 4,4 5,4 5,5 6,5 6,6 7,6 c=ink\npx 12,4 13,4 13,5 14,5 14,6 15,6 c=ink\npx 4,12 5,12 5,13 6,13 6,14 7,14 c=ink`).doc!;
    const j24 = one(art(24), 'jaggies'), j48 = one(art(48), 'jaggies'), j96 = one(art(96), 'jaggies');
    expect(j24.score).toBe(j48.score);
    expect([j24.limit, j48.limit, j96.limit]).toEqual(['≤ 0', '≤ 2', '≤ 8']);
    expect(j24.status).toBe('fail');
    expect(j48.score!).toBeGreaterThan(2);
    // An object's art is one piece over its cells: a 48x96 object has 4.
    expect(one(run(EMPTY, 'new object o 48x96 cell=48x48\nrect 4,4 8x8 c=ink fill').doc!, 'jaggies').limit).toBe('≤ 4');
  });

  it('consistency\'s ramp steps: lone accent pixels are not steps, and one more member does not flip it', () => {
    // Three stones of two moss steps (one pixel of lichen on one of them: an accent) and a gem of five.
    const stone = (n: string, accent: boolean) => run(EMPTY, `new sprite ${n} 24x24\nrect 4,4 16x16 c=moss1 fill\nrect 4,4 16x8 c=moss2 fill${accent ? '\npx 10,10 c=lichen' : ''}\noutline c=ink`).doc!;
    const steps = (d: Doc, peers: Doc[]) => one(d, 'consistency', { peers: peers.map((x, i) => ({ name: `p${i}`, doc: x })) }).parts!.find((x) => x.name === 'ramp steps')!;
    const a = stone('a', true), b = stone('b', false), c = stone('c', false);
    // The lichen pixel used to count as a step of a second ramp... of the same ramp: 3 steps, not 2.
    expect(steps(a, [b, c]).value).toBe(2);
    // A set that grows: a three-step asset among two-step ones passes with its band, and goes on passing as more two-step assets join.
    const three = run(EMPTY, 'new sprite t 24x24\nrect 4,4 16x16 c=moss1 fill\nrect 4,4 16x8 c=moss2 fill\nrect 4,4 16x4 c=moss3 fill\noutline c=ink').doc!;
    const five = run(EMPTY, 'new sprite f 24x24\nrect 4,4 16x16 c=moss0 fill\nrect 4,4 16x13 c=moss1 fill\nrect 4,4 16x10 c=moss2 fill\nrect 4,4 16x7 c=moss3 fill\nrect 4,4 16x4 c=lichen fill\noutline c=ink').doc!;
    const set = [b, c, three, five];
    const verdicts = [2, 3, 4].map((k) => steps(five, [...set.slice(0, k), ...Array.from({ length: k }, (_, i) => stone(`x${i}`, false))].filter((x) => x !== five)).pass);
    expect(new Set(verdicts).size).toBe(1);
    expect(steps(three, [b, c, five]).detail).toMatch(/middle half/);
  });

  it('margin: art on an edge of a sprite\'s cell fails (the bottom, where it stands, is allowed)', () => {
    const ok = run(EMPTY, 'new sprite s 24x24\nrect 6,4 12x20 c=stone3 fill').doc!;
    expect(one(ok, 'margin').status).toBe('pass');
    const cut = run(EMPTY, 'new sprite s 24x24\nrect 0,4 12x12 c=stone3 fill\npx 20,0 c=ink').doc!;
    const m = one(cut, 'margin');
    expect(m.status).toBe('fail');
    expect(m.score).toBe(13);
    expect(m.detail).toMatch(/13 px on the edge \(top 1, left 12\)/);
    // The style guide can hold the bottom too; objects are off unless turned on.
    expect(one(ok, 'margin', { style: { checks: { margin: { bottom: false } } } }).status).toBe('fail');
    expect(one(run(EMPTY, 'new object o 48x48 cell=24x24\nrect 0,0 48x48 c=stone3 fill').doc!, 'margin').status).toBe('skip');
    expect(one(run(EMPTY, 'new tile t 24x24 bg=moss2').doc!, 'margin').status).toBe('skip');
  });

  it('pieces: a part floating apart from the rest fails; specks are left to orphans', () => {
    const tower = 'new object lighthouse 24x48 cell=24x24\nrect 8,10 8x36 c=stone3 fill';
    expect(one(run(EMPTY, tower).doc!, 'pieces').status).toBe('pass');
    const floating = one(run(EMPTY, `${tower}\nrect 6,2 12x6 c=stone4 fill`).doc!, 'pieces');
    expect(floating.status).toBe('fail');
    expect(floating.detail).toMatch(/^1 part not touching the rest \(72 px at 6,2 12x6\)/);
    expect(one(run(EMPTY, `${tower}\npx 2,2 c=ink`).doc!, 'pieces').status).toBe('pass');
    expect(one(run(EMPTY, `${tower}\nrect 6,2 12x6 c=stone4 fill`).doc!, 'pieces', { style: { assets: { lighthouse: { checks: { pieces: { off: true } } } } } }).status).toBe('skip');
  });

  it('palette reservations: a colour the style guide keeps for some assets fails anywhere else', () => {
    const lamp = (n: string) => run(EMPTY, `new sprite ${n} 24x24\nrect 8,8 8x8 c=lichen fill`).doc!;
    const style = { reserved: { lichen: ['lamp'] } };
    expect(runChecks(lamp('lamp'), ['palette'], { style })[0]!.status).toBe('pass');
    const r = runChecks(lamp('rock'), ['palette'], { style })[0]!;
    expect(r.status).toBe('fail');
    expect(r.score).toBe(64);
    expect(r.detail).toMatch(/lichen is reserved for lamp \(style\.reserved\) \(64\)/);
  });
});
