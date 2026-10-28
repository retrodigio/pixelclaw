// G9 export, import and densities (plan §4.7, §4.9, §10 G9): round-trip identity (export, then
// import, gives the same indices) through every built-in profile and the sample profile; the CSV
// page layout docs/profiles.md defines; the reducer against hand-made fixtures; `.aseprite` round
// trip; the PNG reader; project schemes and fillets; `scale` and `density`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_PROFILES, TRANSPARENT, aseParts, decodePng, encodePng, exportItems, exportProfile, flatten, importProfile, inflate, loadScheme, mapWorld,
  msToTicks, readAseprite, reduceIndices, replay, resolveVariant, roundTripDiffs, runBatch, runChecks, schemeOf, serializeDoc, deserializeDoc,
  writeAseprite, NB, type Doc, type Palette, type ProfileJson, type SchemeJson,
} from '../src/index.ts';
import { EMPTY, TEST_PALETTE, palettes, run } from './helpers.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const BRAMBLE = JSON.parse(readFileSync(join(ROOT, 'examples', 'mossy-ruins.pclaw', 'profiles', 'bramble.json'), 'utf8')) as ProfileJson;
const ROUND = JSON.parse(readFileSync(join(ROOT, 'examples', 'mossy-ruins.pclaw', 'schemes', 'blob47-round.json'), 'utf8')) as SchemeJson;

const T = 8;
const hero = (name: string) => `new sprite ${name} 8x8
palette add skin role=light
rect 2,1 4x6 c=moss fill
px 3,2 c=skin
px 2,7 5,7 c=ink
frame add copy=1
px 4,3 c=leaf
frame add 2 copy=1
px 1,1 c=rr
frame add 3 copy=1
frame add 4 copy=1
frame add 5 copy=1
frame add 6 copy=1
frame add 7 copy=1
view S frames=1-2
view N frames=3-4
view E frames=5-6
frame 5
px 6,4 c=sky
view W frames=7-8
view W mirror=E
pivot 4,7
frame set 2 ticks=12`.replace('c=rr', 'c=rust');

function docs(): Doc[] {
  const out: Doc[] = [];
  const add = (text: string, assets?: Record<string, Doc>) => {
    const r = runBatch(EMPTY, text, { by: 't', palettes, ...(assets ? { assets: (n) => assets[n] } : {}) });
    if (!r.ok) throw new Error(r.errors.map((e) => `${e.line}:${e.col} ${e.message}`).join('\n'));
    out.push(r.state.doc!);
    return r.state.doc!;
  };
  add(`new tile moss ${T}x${T}\nnoise 0,0 ${T}x${T} ramp=green weights=3,2 density=0.5 seed=3\nframe add copy=1\nshift 1,0 wrap`);
  add(`new tile moss_b ${T}x${T}\nnoise 0,0 ${T}x${T} ramp=green weights=2,3 density=0.5 seed=4\nframe add copy=1\nvariant of=moss`);
  const h = add(hero('hero'));
  add(`${hero('hero2x')}\nscale 2\nframe 1\npx 0,0 c=ink\ndensity of=hero d=2`, { hero: h });
  add(`new family land ${T}x${T} scheme=blob47\nrect @cell(inside) 0,0 ${T}x${T} c=leaf fill\nrect @cell(outside) 0,0 ${T}x${T} c=sky fill\nfamily band 1:outside 1:moss\npx @cell(nesw) 3,3 c=ink`);
  add(`new family lane ${T}x${T} scheme=path\nrect @cell(inside) 0,0 ${T}x${T} c=stone fill\nrect @cell(outside) 0,0 ${T}x${T} c=leaf fill\nfamily band 1:inside`);
  add(`new object hut 16x16 cell=${T}x${T}\nrect 0,0 16x8 c=rust fill\nrect 0,8 16x8 c=stone fill\nfootprint 2x1 anchor=0,0 <<\n  rr\n  bb\n>>`);
  const m = runBatch(EMPTY, `new map vale 6x5 tile=${T} palette=test\nlayer add land terrain=land outside=on above=floor\nterrain land rect 1,1 4x3\nlayer add props objects above=land\nplace hut 2,2 layer=props`, {
    by: 't', palettes, assets: (n) => out.find((d) => d.name === n),
  });
  if (!m.ok) throw new Error(m.errors.map((e) => e.message).join('\n'));
  out.push(m.state.doc!);
  return out;
}

describe('round trip: export, then import, gives the same indices', () => {
  const all = docs();
  const world = mapWorld(all.map((d) => ({ name: d.name, doc: d })));
  for (const prof of [...BUILTIN_PROFILES.values(), BRAMBLE]) {
    it(`profile ${prof.name} (${prof.layout})`, () => {
      const ex = exportProfile(prof, all, { tickRate: 60, world });
      expect(ex.files.size).toBeGreaterThan(0);
      const im = importProfile(prof, ex.files, all);
      expect(roundTripDiffs(im, all)).toEqual([]);
      const want = prof.layout === 'godot' ? ['land', 'lane'] : ['hero', 'hut', 'land', 'lane', 'moss', 'moss_b'];
      for (const a of want) expect([...im.assets.keys()], a).toContain(a);
      if (prof.density?.levels.includes(2) || prof.layout === 'aseprite') expect([...im.assets.keys()]).toContain('hero2x');
      expect(im.unknown.map((u) => u.name)).toEqual([]);
      for (const a of im.assets.values()) expect(a.inexact).toBe(0);
    });
  }

  it('the sample profile names, numbers, flags mirrors, encodes roles, writes density pages and snippets', () => {
    const ex = exportProfile(BRAMBLE, all, { tickRate: 60, world });
    const names = exportItems(BRAMBLE, all).map((i) => i.name);
    // Numbered sets from 1; texture variants continue their base's numbers; views as <asset>_<view><n>.
    expect(names).toEqual(expect.arrayContaining(['moss_1', 'moss_2', 'moss_3', 'moss_4', 'hero_s1', 'hero_s2', 'hero_e1', 'hut', 'land_lone', 'land_full', 'land_nsew', 'land_ne_ne', 'land_fill', 'land_bare', 'lane_dot', 'lane_ns']));
    // The mirror view is left for the engine, and its source says so.
    expect(names.some((n) => n.startsWith('hero_w'))).toBe(false);
    expect([...ex.files.keys()].sort()).toEqual(['bramble-entries.txt', 'bramble.csv', 'bramble.png', 'bramble@2x.csv', 'bramble@2x.png', 'bramble@4x.csv', 'bramble@4x.png']);
    // The light role is written as the profile's colour.
    const page = decodePng(ex.files.get('bramble.png')!);
    const colours = new Set<string>();
    for (let i = 0; i < page.width * page.height; i++) if (page.data[i * 4 + 3]) colours.add([0, 1, 2].map((k) => page.data[i * 4 + k]!.toString(16).padStart(2, '0')).join(''));
    expect(colours.has('c8c8c8')).toBe(true);
    expect(colours.has('cccccc')).toBe(false);
    const snip = new TextDecoder().decode(ex.files.get('bramble-entries.txt')!);
    expect(snip).toContain('sprite "hero" { frames = { "hero_s1", "hero_s2", "hero_n1", "hero_n2", "hero_e1", "hero_e2" }, ticks = { 10, 12, 10, 10, 10, 10 }, directions = 4, mirror = "W=E", pivot = { 4, 7 } }');
    expect(snip).toContain('object "hut" { image = "hut", size = { 16, 16 }, footprint = { 2, 1 }, anchor = { 0, 1 }, variants = 1 }');
    expect(snip).toContain('terrain "land" { scheme = "blob47", first = "land_fill"');
    expect(ex.notes.join('\n')).toMatch(/at a higher density were (scaled|reduced)/);
  });

  it('Tiled: wang sets on the families, maps by gid through them', () => {
    const ex = exportProfile(BUILTIN_PROFILES.get('tiled')!, all, { world });
    const tsx = new TextDecoder().decode(ex.files.get('land.tsx')!);
    expect(tsx).toContain('<wangset name="land" type="mixed"');
    expect((tsx.match(/<wangtile /g) ?? []).length).toBe(47);
    expect(new TextDecoder().decode(ex.files.get('lane.tsx')!)).toContain('type="edge"');
    const tmx = new TextDecoder().decode(ex.files.get('vale.tmx')!);
    expect(tmx).toContain('<tileset firstgid="1" source="land.tsx"/>');
    expect(tmx).toContain('source="tiles.tsx"');
    expect(tmx).toMatch(/<object id="1" name="hut" gid="\d+"/);
  });

  it('a profile that names two images alike is refused', () => {
    expect(() => exportItems({ name: 'x', layout: 'loose', names: { frame: 'same' } }, all)).toThrow(/two images are named 'same'/);
  });
});

describe('CSV page layout (docs/profiles.md)', () => {
  it('sprite,x,y,w,h,cropX,cropY,frameW,frameH,pivotX,pivotY: trimmed, shelf-packed, one page per density', () => {
    const a = run(EMPTY, 'new sprite a 4x4\nrect 0,0 4x4 c=moss fill\npivot 2,3').doc!;
    const b = run(EMPTY, 'new sprite b 4x4\nrect 1,0 2x3 c=leaf fill').doc!;
    const prof: ProfileJson = { name: 'x', layout: 'atlas', page: { name: 'x' }, records: { format: 'csv' }, density: { levels: [1, 2] } };
    const ex = exportProfile(prof, [a, b]);
    const t = (f: string) => new TextDecoder().decode(ex.files.get(f)!);
    expect(t('x.csv')).toBe('sprite,x,y,w,h,cropX,cropY,frameW,frameH,pivotX,pivotY\na,1,1,4,4,0,0,4,4,2,3\nb,6,1,2,3,1,0,4,4,,\n');
    expect(t('x@2x.csv')).toBe('sprite,x,y,w,h,cropX,cropY,frameW,frameH,pivotX,pivotY\na,1,1,8,8,0,0,8,8,5,7\nb,10,1,4,6,2,0,8,8,,\n');
    const page = decodePng(ex.files.get('x.png')!);
    expect([page.width, page.height]).toEqual([256, 6]);
  });
});

describe('reducers (plan §4.7)', () => {
  const P: Palette = TEST_PALETTE;
  // Two 4x4 blocks, hand-made: A has 4 ink pixels in 16 (a quarter) on leaf; B has 3 ink, 7 moss, 6 leaf.
  const rows = [
    '0222' + '0111',
    '0222' + '1112',
    '0222' + '1022',
    '0222' + '1022',
  ];
  const px = Uint16Array.from(rows.join('').split('').map((c) => ({ '0': 0, '1': 1, '2': 2 })[c]!));
  it('ink-vote: ink wins at a quarter of the block, else the most common colour', () => {
    expect([...reduceIndices(px, 8, 4, 4, P, 'ink-vote')]).toEqual([0, 1]);
  });
  it('mode: the most common colour (A is leaf); ties go to the darker entry', () => {
    expect([...reduceIndices(px, 8, 4, 4, P, 'mode')]).toEqual([2, 1]);
    const tie = Uint16Array.from([1, 2, 2, 1]);
    expect([...reduceIndices(tie, 2, 2, 2, P, 'mode')]).toEqual([1]);
  });
  it('nearest: the pixel at the block centre', () => {
    expect([...reduceIndices(px, 8, 4, 4, P, 'nearest')]).toEqual([2, 2]);
  });
  it('the density check reduces the 2x copy and flags the blocks that differ from the base', () => {
    const all = docs();
    const hi = all.find((d) => d.name === 'hero2x')!;
    const world = mapWorld(all.map((d) => ({ name: d.name, doc: d })));
    const [r] = runChecks(hi, ['density'], { world, frame: 0, style: { density: { reducer: 'ink-vote' } } });
    // The scale-up reduces back exactly, except the one ink pixel drawn at 0,0 (a quarter of its block).
    expect(r!.score).toBeGreaterThan(0);
    expect(r!.groups[0]!.pts).toEqual([[0, 0], [1, 0], [0, 1], [1, 1]]);
    const [m] = runChecks(hi, ['density'], { world, frame: 0, style: { density: { reducer: 'mode' } } });
    expect(m!.flagged).toEqual([]);
  });
});

describe('.aseprite', () => {
  it('writes and reads back layers, frames, durations, linked cels, tags and views', () => {
    const d = run(EMPTY, `${hero('hero')}\nlayer add top\npx 0,0 c=ink\nframe add link=1\ntag add walk 1-2 loop=pingpong`).doc!;
    const f = readAseprite(writeAseprite(d, 60));
    expect([f.width, f.height, f.depth, f.frames.length]).toEqual([8, 8, 8, d.frameCount]);
    const parts = aseParts(f);
    expect(parts.layers.map((l) => l.name)).toEqual(d.layers.map((l) => l.name));
    d.layers.forEach((_, li) => {
      for (let fr = 0; fr < d.frameCount; fr++) {
        const got = parts.indices![li]![fr];
        const want = d.cels[li]![fr]!;
        const back = got ? got.map((v) => (v === TRANSPARENT ? v : v - 1)) : new Uint16Array(want.length).fill(TRANSPARENT);
        expect([...back], `layer ${li} frame ${fr + 1}`).toEqual([...want]);
      }
    });
    expect(parts.ms.map((m) => msToTicks(m, 60))).toEqual(d.ticks);
    expect(parts.tags).toEqual(d.tags);
    expect(parts.views).toEqual(d.views);
    expect(parts.links.length).toBeGreaterThan(0);
    expect(f.palette.slice(1).map((e) => e.name)).toEqual(d.palette.entries.map((e) => e.name));
  });
});

describe('PNG reader and inflate', () => {
  it('reads back what the encoder writes (indexed and truecolour)', () => {
    for (const n of [5, 300]) {
      const w = 20, h = 15, data = new Uint8Array(w * h * 4);
      for (let i = 0; i < w * h; i++) { data[i * 4] = (i * 7) % n; data[i * 4 + 1] = (i * 13) % 251; data[i * 4 + 2] = i % 3; data[i * 4 + 3] = i % 11 ? 255 : 0; }
      for (let i = 0; i < w * h; i++) if (!data[i * 4 + 3]) data.fill(0, i * 4, i * 4 + 3);
      const img = decodePng(encodePng({ width: w, height: h, data }));
      expect([img.width, img.height]).toEqual([w, h]);
      expect(Buffer.compare(Buffer.from(img.data), Buffer.from(data))).toBe(0);
    }
  });
  it('inflates dynamic-Huffman and stored blocks from zlib', () => {
    const text = Buffer.from('mossy ruins '.repeat(500) + Array.from({ length: 3000 }, (_, i) => String.fromCharCode(32 + ((i * 37) % 90))).join(''));
    for (const level of [0, 1, 9]) expect(Buffer.from(inflate(deflateSync(text, { level }))).equals(text)).toBe(true);
  });
});

describe('project schemes and fillets (plan §17)', () => {
  const fam = `new family coast ${T}x${T} scheme=blob47-round\nrect @cell(inside) 0,0 ${T}x${T} c=leaf fill\nrect @cell(outside) 0,0 ${T}x${T} c=sky fill\nfamily band 1:outside 1:moss fillet=3`;
  const withScheme = { ...palettes, scheme: (n: string) => (n === 'blob47-round' ? ROUND : undefined) };
  it('a new family line copies the project scheme (def=), so the tape replays without the file', () => {
    const r = runBatch(EMPTY, fam, { by: 't', palettes: withScheme });
    if (!r.ok) throw new Error(r.errors.map((e) => e.message).join());
    expect(r.state.entries[0]!.cmd).toMatch(/^new family coast 8x8 scheme=blob47-round def="\{\\"name\\":\\"blob47-round\\"/);
    const again = replay(r.state.entries, palettes);
    expect(again.problems).toEqual([]);
    expect(Buffer.compare(serializeDoc(again.doc!), serializeDoc(r.state.doc!))).toBe(0);
    expect(schemeOf(deserializeDoc(serializeDoc(r.state.doc!)).family!).variants.length).toBe(176);
    expect(runBatch(EMPTY, fam, { by: 't', palettes }).ok).toBe(false);
  });
  it('fillets: an outside cell gets one in each inner corner of the terrain around it', () => {
    const s = loadScheme(ROUND);
    const { N, NE, E, S, SW, W } = NB;
    expect(s.variants[resolveVariant(s, false, N | E | NE)!]!.name).toBe('f_ne');
    expect(s.variants[resolveVariant(s, false, N | E | NE | S | W | SW)!]!.name).toBe('f_ne_sw');
    expect(resolveVariant(s, false, N | E)).toBeNull();
  });
});

describe('scale and density commands', () => {
  it('scale doubles every cel, the cell grid and the pivot; density of= is state', () => {
    const s = run(EMPTY, `${hero('h')}\nscale 2\ndensity of=hero d=2`);
    const d = s.doc!;
    expect([d.width, d.height, d.cellW, d.pivot]).toEqual([16, 16, 16, [9, 15]]);
    expect(d.densityOf).toEqual({ of: 'hero', d: 2 });
    const base = run(EMPTY, hero('h')).doc!;
    expect([...reduceIndices(flatten(d, 0), 16, 16, 2, d.palette, 'nearest')]).toEqual([...flatten(base, 0)]);
    expect(deserializeDoc(serializeDoc(d)).densityOf).toEqual({ of: 'hero', d: 2 });
  });
});
