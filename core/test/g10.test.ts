// G10 in core: the manifest's schema, statuses from marks, style-guide defaults written into
// the line, the consistency check (with palette-swap recolours recognised) and the flat
// templates (coverage maps for every scheme, blob47-round included, and the mockup screen).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_SCHEMES, artHash, consistencyOf, coverageTemplate, encodePng, isRecolour, loadScheme, mockupScreen, reachable, replay, runBatch, runChecks,
  serializeDoc, statusOf, validateManifest, variantCounts, type Doc, type Manifest, type StyleDefaults,
} from '../src/index.ts';
import { EMPTY, TEST_PALETTE, golden, palettes, run } from './helpers.ts';

const MANIFEST: Manifest = {
  format: 'pixelclaw-manifest', version: 1,
  theme: 'A quiet hill village of potters, in warm clay and green.',
  sets: { ground: { description: 'floors' }, props: {} },
  export: { profile: 'png' },
  assets: [
    { name: 'clay', kind: 'tile', size: '24x24', set: 'ground', flat: '#b0704a' },
    { name: 'grass', kind: 'tile', size: '24x24', set: 'ground' },
    { name: 'bank', kind: 'family', size: '24x24', set: 'ground', scheme: 'blob47', inside: 'clay', outside: 'grass', band: '1:ink 2:stone radius=2' },
    { name: 'urn', kind: 'sprite', size: '24x24', set: 'props', height: 14 },
    { name: 'urn_blue', kind: 'sprite', size: '24x24', set: 'props', recolourOf: 'urn', height: 14 },
    { name: 'potter', kind: 'sprite', size: '24x24', set: 'props', frames: 2, views: ['S', 'N', 'E', 'W'], mirror: { W: 'E' }, height: 21 },
    { name: 'kiln', kind: 'object', size: '48x48', set: 'props', cells: '2x1' },
    { name: 'hill', kind: 'map', size: '40x30', uses: ['bank', 'kiln'] },
  ],
};

describe('manifest schema', () => {
  it('accepts a good manifest', () => {
    const r = validateManifest(MANIFEST, { palettes: ['test'], schemes: ['blob47'], profiles: ['png'] });
    expect(r.errors).toEqual([]);
    expect(r.manifest?.assets).toHaveLength(8);
  });

  it('reports every problem with its path', () => {
    const bad = JSON.parse(JSON.stringify(MANIFEST)) as Record<string, unknown> & { assets: Record<string, unknown>[] };
    bad.format = 'other';
    bad.colour = 'red';
    bad.assets[0]!.size = '24';
    bad.assets[1]!.name = 'Grass';
    bad.assets[2]!.scheme = 'blob99';
    bad.assets[3]!.kind = 'statue';
    bad.assets[3]!.height = 0;
    bad.assets[4]!.recolourOf = 'nothing';
    bad.assets[5]!.mirror = { W: 'X' };
    bad.assets[5]!.frames = 0;
    bad.assets[6]!.cells = 'two';
    bad.assets[7]!.uses = ['bank', 'castle'];
    bad.assets.push({ name: 'clay', kind: 'tile', size: '24x24', scheme: 'blob47', set: 'nowhere' });
    const r = validateManifest(bad, { schemes: ['blob47'] });
    expect(r.manifest).toBeNull();
    const paths = r.errors.map((e) => e.path);
    for (const p of ['format', 'colour', 'assets[0].size', 'assets[1].name', 'assets[2].scheme', 'assets[3].kind', 'assets[3].height', 'assets[4].recolourOf',
      'assets[5].mirror.W', 'assets[5].frames', 'assets[6].cells', 'assets[7].uses', 'assets[8].name', 'assets[8].scheme', 'assets[8].set']) {
      expect(paths, p).toContain(p);
    }
    expect(r.errors.find((e) => e.path === 'assets[8].name')!.message).toBe(`'clay' is already assets[0]`);
    expect(r.errors.find((e) => e.path === 'assets[2].scheme')!.message).toContain(`no scheme 'blob99'`);
    expect(validateManifest([]).errors[0]!.message).toBe('a manifest is a JSON object');
    expect(validateManifest({ ...MANIFEST, assets: 3 }).errors.map((e) => e.path)).toEqual(['assets']);
  });
});

describe('marks and statuses', () => {
  const base = () => run(run(EMPTY, 'new sprite urn 8x8\nrect 2,2 4x4 c=moss fill'), 'mark reviewed "blind review: fine"', 'claude');

  it('a mark is a tape command in normal form that replays, undoes and keeps the art hash', () => {
    const s = base();
    expect(s.entries.at(-1)!.cmd).toBe('mark reviewed "blind review: fine"');
    expect(s.doc!.marks).toEqual([{ name: 'reviewed', seq: 3, by: 'claude', text: 'blind review: fine', art: artHash(s.doc!) }]);
    const r = replay(s.entries, palettes);
    expect(r.problems).toEqual([]);
    expect(serializeDoc(r.doc!)).toEqual(serializeDoc(s.doc!));
    expect(run(s, 'undo', 'claude').doc!.marks).toEqual([]);
    expect(runBatch(s, 'mark Approved', { by: 'x', palettes }).ok).toBe(false);
    // Notes and marks leave the art hash alone; pixels change it.
    const noted = run(s, 'note 1,1 "hm"');
    expect(artHash(noted.doc!)).toBe(artHash(s.doc!));
    expect(artHash(run(s, 'px 0,0 c=ink').doc!)).not.toBe(artHash(s.doc!));
  });

  it('statuses climb the ladder and fall back when the art changes', () => {
    const s = base();
    const facts = (d: Doc, o: { pass?: boolean; exported?: string | null } = {}) => ({ exists: true, checksPass: o.pass ?? true, marks: d.marks, art: artHash(d), exportedArt: o.exported ?? null });
    expect(statusOf({ exists: false, checksPass: null, marks: [], art: null }).status).toBe('planned');
    expect(statusOf(facts(s.doc!, { pass: false })).status).toBe('drafted');
    expect(statusOf(facts(s.doc!)).status).toBe('reviewed');
    const ok = run(s, 'mark approved "good"', 'human:pat');
    expect(statusOf(facts(ok.doc!)).status).toBe('approved');
    expect(statusOf(facts(ok.doc!, { exported: artHash(ok.doc!) })).status).toBe('exported');
    const changed = run(ok, 'px 0,0 c=ink');
    const st = statusOf(facts(changed.doc!, { exported: artHash(ok.doc!) }));
    expect(st.status).toBe('checked');
    expect(st.flags[0]).toContain('changed since it was reviewed');
    const rejected = run(ok, 'mark rejected "rim too dark"', 'human:pat');
    const rj = statusOf(facts(rejected.doc!));
    expect(rj.status).toBe('reviewed');
    expect(rj.flags).toContain('changes asked for (#5: rim too dark)');
  });
});

describe('style-guide defaults', () => {
  const defaults: StyleDefaults = {
    asset: (kind, name) => (name === 'kiln' ? { size: [48, 48], cell: [24, 24] } : kind === 'family' ? { size: [24, 24], scheme: 'blob47' } : { size: [16, 16] }),
    light: 'ne', outline: ['nothing', 'ink'],
  };
  it('fills what a command leaves out and writes it into the line; replay needs no defaults', () => {
    const r = runBatch(EMPTY, 'new object kiln\nrect 4,4 20x20 c=stone fill\noutline\nshade', { by: 'claude', palettes, defaults });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.added.map((e) => e.cmd.split('\n')[0])).toEqual([
      'new object kiln 48x48 palette=test wrap=off cell=24x24 bg=none <<', 'rect 4,4 20x20 c=stone fill', 'outline c=ink mode=outer corners=off', 'shade light=ne ramp=all edge=1',
    ]);
    expect(serializeDoc(replay(r.state.entries, palettes).doc!)).toEqual(serializeDoc(r.state.doc!));
    const f = runBatch(EMPTY, 'new family bank', { by: 'claude', palettes, defaults });
    expect(f.ok && f.added[0]!.cmd.split('\n')[0]).toBe('new family bank 24x24 scheme=blob47 palette=test wrap=off cell=24x24 bg=none <<');
    // Given options win, and without defaults the old errors stand.
    const g = runBatch(EMPTY, 'new sprite urn 8x8\nshade light=s', { by: 'claude', palettes, defaults });
    expect(g.ok && g.added.map((e) => e.cmd.split('\n')[0])).toEqual(['new sprite urn 8x8 palette=test wrap=off cell=8x8 bg=none <<', 'shade light=s ramp=all edge=1']);
    const none = runBatch(EMPTY, 'new sprite urn\n', { by: 'claude', palettes });
    expect(!none.ok && none.errors[0]!.message).toContain('expected a size like 24x24');
  });
});

/** A 16x16 figure: a block in the green ramp lit along two sides (shade's way), with an ink outline. */
function ball(name: string, light: 'nw' | 'se', o: { h?: number; pal?: typeof TEST_PALETTE } = {}): Doc {
  const h = o.h ?? 10;
  const top = 15 - h;
  const lit = light === 'nw' ? `line 3,${top} 12,${top} c=leaf\nline 3,${top} 3,14 c=leaf` : `line 3,14 12,14 c=leaf\nline 12,${top} 12,14 c=leaf`;
  const pal = o.pal ?? TEST_PALETTE;
  const src = { get: () => pal, defaultName: pal.name };
  const r = runBatch(EMPTY, `new sprite ${name} 16x16 palette=${pal.name}\nrect 3,${top} 10x${h} c=moss fill\n${lit}\noutline c=ink`, { by: 'test', palettes: src });
  if (!r.ok) throw new Error(r.errors[0]!.message);
  return r.state.doc!;
}

const OPTS = { ink: ['ink'], maxL: 18, maxOutline: 0.3, maxAngle: 90, maxCluster: 3, maxSteps: 1.5, heightTol: 2 };

describe('consistency', () => {
  it('flags the one lit from the wrong side, and a height off the plan', () => {
    const set = ['a', 'b', 'c'].map((n) => ({ name: n, doc: ball(n, 'nw') }));
    const odd = ball('odd', 'se');
    const r = consistencyOf(odd, set, { ...OPTS, light: 'nw', height: 6 });
    const light = r.parts.find((p) => p.name === 'light')!;
    expect(light.pass).toBe(false);
    expect(light.detail).toMatch(/^lit from the se/);
    const height = r.parts.find((p) => p.name === 'height')!;
    expect(height).toMatchObject({ value: 12, pass: false });
    expect(consistencyOf(set[0]!.doc, [...set.slice(1), { name: 'odd', doc: odd }], { ...OPTS, light: 'nw', height: 12 }).parts.every((p) => p.pass !== false)).toBe(true);
    // As a check: the style guide's light and the manifest's height through the context.
    const res = runChecks(odd, ['consistency'], { style: { light: 'nw', outline: ['ink'] }, peers: set, expect: { height: 12 } })[0]!;
    expect(res.status).toBe('fail');
    expect(res.score).toBe(1);
    expect(res.detail).toContain('light lit from the se');
  });

  it('recognises a palette-swap recolour, here and in readability', () => {
    const swap = { ...TEST_PALETTE, name: 'swap', entries: TEST_PALETTE.entries.map((e) => (e.name === 'moss' ? { ...e, hex: '#3a4f8a' } : e.name === 'leaf' ? { ...e, hex: '#6f8fd0' } : e)) };
    const a = ball('urn', 'nw');
    const b = ball('urn_blue', 'nw', { pal: swap });
    expect(isRecolour(a, b)).toBe(true);
    expect(isRecolour(a, a)).toBe(false); // the same colours: a copy, not a recolour
    expect(isRecolour(a, ball('other', 'se'))).toBe(false); // two colours swapped places: not one mapping
    expect(isRecolour(a, ball('short', 'nw', { h: 8 }))).toBe(false);
    const r = consistencyOf(b, [{ name: 'urn', doc: a }, { name: 'x', doc: ball('x', 'se') }], OPTS);
    expect(r.recolours).toEqual(['urn']);
    expect(r.peers).toEqual(['x']);
    // G9's sheet: a recolour had IoU 1 with its source and failed readability.
    const rd = runChecks(b, ['readability'], { set: [{ name: 'urn', doc: a }] })[0]!;
    expect(rd.parts!.find((p) => p.name === 'distinct silhouette')!.detail).toContain('only recolours to compare with (urn)');
    expect(rd.parts!.some((p) => p.pass === false && p.name === 'distinct silhouette')).toBe(false);
  });
});

describe('flat templates', () => {
  const round = loadScheme(JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'examples', 'mossy-ruins.pclaw', 'schemes', 'blob47-round.json'), 'utf8')));

  it('a coverage map holds every variant of every scheme, blob47-round included', () => {
    for (const s of [...BUILTIN_SCHEMES.values(), round]) {
      const t = coverageTemplate(s, { tile: 12, inside: [200, 160, 100], outside: [80, 140, 80], band: '1:ink 1:stone' });
      expect(t, s.name).not.toBeNull();
      const n = variantCounts(s, t!.terrain);
      expect(reachable(s).filter((v) => !n[v]), s.name).toEqual([]);
      expect(t!.img.width).toBe(t!.cols * 12);
    }
    const t = coverageTemplate(round, { tile: 24, inside: [200, 160, 100], outside: [80, 140, 80], band: '2:outside 1:foam 2:sand radius=3' })!;
    expect(t.text).toMatch(/^blob47-round: \d+x\d+ tiles of 24 px, 176 of 176 variants/);
    golden('g10/coverage-blob47-round.png', encodePng(t.img));
  });

  it('a mockup screen lays out the manifest, the same way for the same seed', () => {
    const o = {
      cols: 16, rows: 9, tile: 24, seed: 3, colour: (_: unknown, i: number) => [40 + i * 20, 120, 200 - i * 15] as [number, number, number],
      scheme: (n: string) => BUILTIN_SCHEMES.get(n),
    };
    const m = mockupScreen(MANIFEST, o);
    expect(m.placed.map((p) => p.name).sort()).toEqual(['kiln', 'potter', 'urn']);
    const urn = m.placed.find((p) => p.name === 'urn')!;
    expect(urn.h).toBe(14);
    expect(m.text).toMatch(/[A-Z] {2}kiln stands here/);
    expect(encodePng(mockupScreen(MANIFEST, o).img)).toEqual(encodePng(m.img));
    expect(encodePng(mockupScreen(MANIFEST, { ...o, seed: 4 }).img)).not.toEqual(encodePng(m.img));
    golden('g10/mockup.png', encodePng(m.labelled));
  });
});
