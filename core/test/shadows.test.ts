// Shadows: the shadow helper under sprites and objects, and objects layers casting shadows on a
// map's ground.
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



describe('shadows', () => {
  const style = { light: 'nw', shadow: { c: 'darker' } };
  it('the shadow helper: an ellipse under the art, away from the light, behind it; the style guide\'s colour and direction', () => {
    const base = 'new sprite s 24x24\nellipse 7,4 10x16 c=stone3 fill\noutline c=ink';
    const st = run(EMPTY, `${base}\nshadow`, {}, { light: 'nw', shadow: { c: 'soil0' } });
    expect(lastCmd(st)).toBe('shadow 8,20 12x4 c=soil0 dir=se');
    const before = flatten(run(EMPTY, base).doc!, 0), after = flatten(st.doc!, 0);
    const soil = ix('soil0');
    const changed = [...after].flatMap((v, i) => (v !== before[i] ? [i] : []));
    expect(changed.length).toBeGreaterThan(10);
    // Only empty pixels took the shadow, and it leans toward the south-east of the art's foot (column 12, row 19).
    expect(changed.every((i) => before[i] === 0xffff && after[i] === soil)).toBe(true);
    const mx = changed.reduce((a, i) => a + (i % 24), 0) / changed.length, my = changed.reduce((a, i) => a + Math.floor(i / 24), 0) / changed.length;
    expect(mx).toBeGreaterThan(12);
    expect(my).toBeGreaterThan(19);
    // Light from the north-east: the shadow falls south-west; dir= and c= given win.
    expect(lastCmd(run(EMPTY, `${base}\nshadow`, {}, { light: 'ne', shadow: { c: 'soil0' } }))).toMatch(/ dir=sw$/);
    expect(lastCmd(run(EMPTY, `${base}\nshadow c=ink dir=e`, {}, style))).toMatch(/^shadow \d+,\d+ 12x4 c=ink dir=e$/);
    // A darker shadow needs ground under it: a sprite is told so.
    expect(() => run(EMPTY, `${base}\nshadow`, {}, style)).toThrow(/give c=<colour> \(the style guide's shadow is darker/);
    expect(() => run(EMPTY, 'new sprite s 24x24\nshadow c=ink')).toThrow(/nothing is drawn yet/);
  });

  it('a map\'s objects cast shadows on the ground: a step down its ramps, before any object; the checks read the ground without them', () => {
    const stone = run(EMPTY, 'new object stone 24x48 cell=24x24\nellipse 6,4 12x40 c=stone3 fill\noutline c=ink\nfootprint 1x1 anchor=0,0 <<\n  r\n  b\n>>').doc!;
    const grass = run(EMPTY, 'new tile grass 24x24 bg=moss2\nnoise ramp=moss weights=0,2,6,2,0 density=0.2 seed=3').doc!;
    const docs = { stone, grass };
    const w = mapWorld(Object.entries(docs).map(([n, doc]) => ({ name: n, doc })));
    const st = run(EMPTY, 'new map m 6x4 tile=24\ntiles floor fill grass\nlayer add props objects\nplace stone 2,2 layer=props', docs, style);
    expect(st.entries[2]!.cmd).toBe('layer add props objects shadow=darker shadowdir=se above=floor');
    const lit = composeMapDoc(st.doc!, w);
    const off = composeMapDoc(run(st, 'layer set props shadow=off', docs, style).doc!, w);
    expect(run(st, 'layer set props shadow=off', docs, style).entries.at(-1)!.cmd).toBe('layer set props shadow=off');
    const name = (c: typeof lit, i: number) => c.palette[c.px[i]!]!.name;
    const step: Record<string, string> = { moss1: 'moss0', moss2: 'moss1', moss3: 'moss2', lichen: 'moss3' };
    const diff = [...lit.px.keys()].filter((i) => lit.px[i] !== off.px[i]);
    expect(diff.length).toBeGreaterThan(10);
    for (const i of diff) expect(name(lit, i), `pixel ${i % lit.w},${Math.floor(i / lit.w)}`).toBe(step[name(off, i)]);
    // South-east of the stone's foot (its art's column 12, row 43), on the ground.
    const ob = lit.objects[0]!;
    const mx = diff.reduce((a, i) => a + (i % lit.w), 0) / diff.length, my = diff.reduce((a, i) => a + Math.floor(i / lit.w), 0) / diff.length;
    expect(mx).toBeGreaterThan(ob.px + 12);
    expect(my).toBeGreaterThan(ob.py + 43);
    expect(lit.ground).toEqual(off.ground);
    // A colour instead, and the setting survives saving and loading.
    const ink = run(st, 'layer set props shadow=ink shadowdir=s', docs, style);
    expect(ink.entries.at(-1)!.cmd).toBe('layer set props shadow=ink shadowdir=s');
    expect(deserializeDoc(serializeDoc(ink.doc!)).layers.find((l) => l.name === 'props')!.map).toEqual({ kind: 'objects', shadow: { c: 'ink', dir: 's' } });
    // No style guide shadow: none.
    expect(run(EMPTY, 'new map m 6x4 tile=24\nlayer add props objects', docs, { light: 'nw' }).entries[1]!.cmd).toBe('layer add props objects above=floor');
    expect(() => run(st, 'layer set floor shadow=darker', docs, style)).toThrow(/shadow= goes with an objects layer/);
  });
});
