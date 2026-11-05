// Maps and oversized assets: terrain painting resolves the same
// variants as the scheme reference; footprints block overlapping placement; split then reassembly
// is identity; map replay is byte-identical; draw order, roofs and the map checks; texture
// variants; Tiled export; map gen.
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_PROFILES, BUILTIN_SCHEMES, TRANSPARENT, composeMapDoc, decodePng, exportProfile, flatten, layoutOf, mapChecks, mapDocText, mapWorld, reassemble, replay, resolveVariant,
  runBatch, runChecks, serializeDoc, deserializeDoc, splitAsset, variantMatch, type AssetState, type Doc,
} from '../src/index.ts';
import { EMPTY, palettes, run } from './helpers.ts';

const T = 8;
/** A blob47 family whose every variant is a flat colour by its key, so a map's pixels say which variant each cell got. */
const FAMILY = `new family land ${T}x${T} scheme=blob47
rect @cell(inside) 0,0 ${T}x${T} c=leaf fill
rect @cell(outside) 0,0 ${T}x${T} c=sky fill
family band 1:outside 1:moss`;

function world(docs: Record<string, Doc>) {
  return mapWorld(Object.entries(docs).map(([name, doc]) => ({ name, doc })));
}

function runMap(state: AssetState, text: string, docs: Record<string, Doc>, by = 'test'): AssetState {
  const r = runBatch(state, text, { by, palettes, assets: (n) => docs[n] });
  if (!r.ok) throw new Error(r.errors.map((e) => `${e.line}:${e.col}: ${e.message}`).join('\n'));
  return r.state;
}

function errs(state: AssetState, text: string, docs: Record<string, Doc>): string[] {
  const r = runBatch(state, text, { by: 'test', palettes, assets: (n) => docs[n] });
  return r.ok ? [] : r.errors.map((e) => `${e.line}:${e.col} ${e.message}`);
}

const HOUSE = `new object house 16x16 cell=${T}x${T}
rect 0,0 16x8 c=rust fill
rect 0,8 16x8 c=stone fill
footprint 2x1 anchor=0,0 <<
  rr
  bb
>>`;
const TREE = `new object tree 8x16 cell=${T}x${T}
rect 2,0 4x8 c=moss fill
rect 3,8 2x8 c=ink fill
footprint 1x1`;

describe('map documents', () => {
  const land = run(EMPTY, FAMILY).doc!;

  it('terrain painting resolves every cell to the variant the scheme reference gives (random terrains)', () => {
    const s = BUILTIN_SCHEMES.get('blob47')!;
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 16) & 1;
    for (let round = 0; round < 6; round++) {
      const W = 12, H = 9;
      const rows = Array.from({ length: H }, () => Array.from({ length: W }, () => (rnd() ? '#' : '-')).join(''));
      // Past the map's edge a cell counts as its own, or as terrain or not when the layer says so.
      const border = (['same', 'not', 'terrain'] as const)[round % 3]!;
      const st = runMap(EMPTY, `new map m ${W}x${H} tile=${T}\nlayer add ground terrain=land outside=on border=${border}\nterrain ground paint 0,0 <<\n${rows.map((r) => `  ${r}\n`).join('')}>>`, { land });
      const c = composeMapDoc(st.doc!, world({ land }));
      const L = layoutOf(land.family!);
      const flat = flatten(land, 0);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const at = (i: number, j: number) => (i >= 0 && j >= 0 && i < W && j < H ? rows[j]![i] === '#'
          : border === 'same' ? rows[Math.min(H - 1, Math.max(0, j))]![Math.min(W - 1, Math.max(0, i))] === '#' : border === 'terrain');
        const dirs: [number, number, number][] = [[1, 0, -1], [2, 1, -1], [4, 1, 0], [8, 1, 1], [16, 0, 1], [32, -1, 1], [64, -1, 0], [128, -1, -1]];
        let bits = 0;
        for (const [b, dx, dy] of dirs) if (at(x + dx, y + dy)) bits |= b;
        const v = resolveVariant(s, at(x, y), bits);
        const [cx, cy] = v === null ? L.outside : L.cells[v]!;
        // The cell's pixels are exactly that variant's tile from the family's sheet.
        for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
          expect(c.px[(y * T + j) * c.w + x * T + i]).toBe(c.palette.findIndex((e) => e.name === land.palette.entries[flat[(cy * T + j) * land.width + cx * T + i]!]!.name));
        }
        expect(c.top[y * W + x]!.variant).toBe(v === null ? 'outside' : s.variants[v]!.name);
      }
    }
  });

  it('footprints block overlapping placement, on every objects layer, and keep things on the map', () => {
    const house = run(EMPTY, HOUSE).doc!, tree = run(EMPTY, TREE).doc!;
    const docs = { land, house, tree };
    let st = runMap(EMPTY, `new map m 10x8 tile=${T}\nlayer add props objects\nlayer add more objects\nplace house 3,4 layer=props`, docs);
    expect(st.entries.at(-1)!.cmd).toBe('place house 3,4 layer=props cells=2x1 anchor=0,0');
    // The house covers 3,4 and 4,4.
    expect(errs(st, 'place tree 4,4 layer=props', docs)).toEqual([`1:12 4,4 is taken by house at 3,4 (on layer props)`]);
    expect(errs(st, 'place tree 4,4 layer=more', docs)).toEqual([`1:12 4,4 is taken by house at 3,4 (on layer props)`]);
    expect(errs(st, 'place house 9,1 layer=props', docs)).toEqual([`1:13 the 2x1 footprint at 9,1 runs off the 10x8 map`]);
    st = runMap(st, 'place tree 5,4 layer=more', docs);
    expect(errs(st, 'move 3,4 4,4', docs)[0]).toMatch(/5,4 is taken by tree at 5,4/);
    st = runMap(st, 'move 4,4 2,6', docs);
    expect(st.entries.at(-1)!.cmd).toBe('move 3,4 2,6 layer=props');
    st = runMap(st, 'place tree 3,4 layer=props', docs);
    st = runMap(st, 'remove 3,6', docs);
    expect(st.entries.at(-1)!.cmd).toBe('remove 2,6 layer=props');
    // The lines carry the footprints: replay needs no other asset.
    const r = replay(st.entries, palettes);
    expect(r.problems).toEqual([]);
    expect(serializeDoc(r.doc!)).toEqual(serializeDoc(st.doc!));
  });

  it('objects draw by their base row, roofs last; overhangs and hidden fronts are draw-order problems', () => {
    const house = run(EMPTY, HOUSE).doc!, tree = run(EMPTY, TREE).doc!;
    const docs = { land, house, tree };
    const st = runMap(EMPTY, `new map m 8x6 tile=${T}\nlayer add ground terrain=land outside=on\nterrain ground rect 0,0 8x6\nlayer add props objects\nplace house 2,3 layer=props\nplace tree 5,3 layer=props`, docs);
    const w = world(docs);
    const c = composeMapDoc(st.doc!, w);
    const ink = c.palette.findIndex((e) => e.name === 'ink');
    // The tree's trunk (cell 5,3) is drawn; its crown hangs into cell 5,2.
    expect(c.px[(3 * T + 1) * c.w + 5 * T + 3]).toBe(ink);
    const checks = mapChecks(st.doc!, w);
    const dor = checks.find((x) => x.id === 'draworder')!;
    expect(dor.pass).toBe(false);
    expect(dor.groups.map((g) => g.label)).toEqual(['tree at 5,3: art outside its footprint is not a roof (an actor walking behind would be drawn over it)']);
    expect(dor.groups[0]!.cells).toEqual([[5, 2]]);
    // A tall pole in front of the house reaching up into its roof row: the roof hides its top.
    const pole = run(EMPTY, `new object pole 8x24 cell=${T}x${T}\nrect 3,0 2x24 c=rust fill\nfootprint 1x1`).doc!;
    const docs2 = { ...docs, pole };
    const w2 = world(docs2);
    const st2 = runMap(st, 'place pole 3,4 layer=props', docs2);
    const d2 = mapChecks(st2.doc!, w2).find((x) => x.id === 'draworder')!;
    expect(d2.groups.map((g) => g.label)).toContain('house at 2,3: its roof hides pole at 3,4, which stands in front of it');
    expect(d2.groups.find((g) => g.label.startsWith('house'))!.cells).toEqual([[3, 2]]);
    const fp = mapChecks(st2.doc!, w2).find((x) => x.id === 'footprint')!;
    expect(fp.pass).toBe(true);
  });

  it('the map checks find a straight edge repeating and a tile over and over; variants fix both', () => {
    const docs: Record<string, Doc> = { land };
    const st = runMap(EMPTY, `new map m 14x8 tile=${T}\nlayer add ground terrain=land outside=on\nterrain ground rect 0,3 14x5`, docs);
    let rep = mapChecks(st.doc!, world(docs)).find((x) => x.id === 'repetition')!;
    expect(rep.pass).toBe(false);
    // The edge runs the whole width: past the map's edge the terrain goes on, so no corner at either end.
    expect(rep.groups[0]!.label).toMatch(/^14 land\.\w+ in a row at 0,3 14x1$/);
    // Variants with different band detail on the straight edge: the map picks among them cell by cell.
    const b = run(EMPTY, `${FAMILY.replace('land', 'land_b')}\nvariant of=land\npx @cell(ew) 2,0 2,7 c=stone`).doc!;
    const c2 = run(EMPTY, `${FAMILY.replace('land', 'land_c')}\nvariant of=land\npx @cell(ew) 5,0 5,7 c=stone`).doc!;
    expect(b.variantOf).toBe('land');
    const more = { land, land_b: b, land_c: c2 };
    rep = mapChecks(st.doc!, world(more)).find((x) => x.id === 'repetition')!;
    expect(rep.parts![0]!.value).toBeLessThanOrEqual(4);
    // The variant check: same colour mix as the base.
    const vr = runChecks(b, ['variant'], { world: world(more) })[0]!;
    expect(vr.status).toBe('pass');
  });

  it('a map tape replays byte for byte (map gen, road, scatter, overlays)', () => {
    const house = run(EMPTY, HOUSE).doc!, tree = run(EMPTY, TREE).doc!;
    const docs = { land, house, tree };
    const st = runMap(EMPTY, [
      `new map v 30x20 tile=${T}`,
      'layer add sea terrain=land outside=on', 'layer add lane terrain=land', 'layer add props objects',
      'map gen island layers=sea seed=5', 'road lane 4,4 20,4 20,12', 'scatter tree,house count=12 on=sea minDist=2 layer=props seed=9',
      'note 3,3 "a cove here"',
    ].join('\n'), docs);
    expect(st.entries.find((e) => e.cmd.startsWith('scatter'))!.cmd).toMatch(/fp=1x1:0,0\/2x1:0,0 seed=9$/);
    const r = replay(st.entries, palettes);
    expect(r.problems).toEqual([]);
    expect(serializeDoc(r.doc!)).toEqual(serializeDoc(st.doc!));
    expect(serializeDoc(deserializeDoc(serializeDoc(st.doc!)))).toEqual(serializeDoc(st.doc!));
    expect(mapDocText(st.doc!, world(docs))).toMatch(/^v: a map of 30x20 cells of 8 px/);
  });

  it('map gen smooths the land (no one-cell spits) and keeps the edge clear', () => {
    const st = runMap(EMPTY, `new map m 24x18 tile=${T}\nlayer add sea terrain=land outside=on\nmap gen island seed=3`, { land });
    const cel = st.doc!.cels[1]![0]!;
    const W = 24, H = 18;
    const on = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && cel[y * W + x] === 1;
    let land1 = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!on(x, y)) continue;
      land1++;
      expect(x > 0 && y > 0 && x < W - 1 && y < H - 1).toBe(true);
      expect([on(x + 1, y), on(x - 1, y), on(x, y + 1), on(x, y - 1)].filter(Boolean).length).toBeGreaterThanOrEqual(2);
    }
    expect(land1).toBeGreaterThan(40);
  });
});

describe('oversized assets', () => {
  it('split then reassembly is identity, with the cells\' flags on the stamp', () => {
    for (const text of [HOUSE, TREE, `new object big 24x16 cell=${T}x${T}\nnoise 0,0 24x16 ramp=green seed=4\nfootprint 3x1 anchor=1,0`]) {
      const d = run(EMPTY, text).doc!;
      const { pieces, stamp } = splitAsset(d);
      expect(pieces.length).toBe((d.width / T) * (d.height / T));
      expect(pieces.every((p) => p.px.length === T * T && /_\d+_\d+$/.test(p.name))).toBe(true);
      expect(reassemble(stamp, pieces)).toEqual(flatten(d, 0));
    }
    const { stamp } = splitAsset(run(EMPTY, HOUSE).doc!);
    expect(stamp.pieces.map((p) => [p.name, p.roof, p.block])).toEqual([['house_0_0', true, false], ['house_1_0', true, false], ['house_0_1', false, true], ['house_1_1', false, true]]);
  });

  it('footprint normal form; fit flags an empty footprint cell and an overhang that is not a roof', () => {
    const t = run(EMPTY, TREE).doc!;
    expect(t.footprint).toEqual({ cols: 1, rows: 1, at: [0, 1], anchor: [0, 0], flags: ['.', 'b'] });
    const fit = runChecks(t, ['fit'])[0]!;
    expect(fit.status).toBe('fail');
    expect(fit.detail).toMatch(/cell 0,0 overhangs the footprint but is not a roof/);
    const ok = run(EMPTY, `${TREE} <<\n  r\n  b\n>>`).doc!;
    expect(runChecks(ok, ['fit'])[0]!.status).toBe('pass');
  });

  it('a variant\'s colour mix against its base', () => {
    const a = run(EMPTY, `new tile a 8x8\nrect 0,0 8x8 c=leaf fill\npx 3,3 c=moss`).doc!;
    const b = run(EMPTY, `new tile b 8x8\nrect 0,0 8x8 c=leaf fill\npx 5,4 c=moss`).doc!;
    const far = run(EMPTY, `new tile c 8x8\nrect 0,0 8x8 c=ink fill`).doc!;
    expect(variantMatch(a, b)).toMatchObject({ l1: 0, ok: true, border: [] });
    expect(variantMatch(a, far).ok).toBe(false);
  });

  it('Tiled export (the tiled profile): a tile layer per ground layer through the family\'s .tsx, objects as tile objects with their footprint', () => {
    const house = run(EMPTY, HOUSE).doc!, tree = run(EMPTY, TREE).doc!, land = run(EMPTY, FAMILY).doc!;
    const docs = { land, house, tree };
    const st = runMap(EMPTY, `new map m 6x5 tile=${T}\nlayer add ground terrain=land outside=on\nterrain ground rect 1,1 4x3\nlayer add props objects\nplace house 1,3 layer=props`, docs);
    const ex = exportProfile(BUILTIN_PROFILES.get('tiled')!, [land, house, tree, st.doc!], { world: world(docs) });
    const tmx = new TextDecoder().decode(ex.files.get('m.tmx')!);
    expect(tmx).toMatch(/<map version="1.10"[^>]* width="6" height="5" tilewidth="8" tileheight="8"/);
    expect(tmx).toMatch(/<layer id="\d+" name="ground" width="6" height="5">/);
    expect(tmx).toMatch(/<object id="1" name="house" gid="\d+" x="8" y="32" width="16" height="16">/);
    expect(tmx).toMatch(/name="footprint" value="2x1"/);
    // Every gid of the ground layer is the family's tile for the cell's variant: its pixels are the composed cell's.
    const csv = /name="ground"[^>]*>\n   <data encoding="csv">\n([\s\S]*?)\n<\/data>/.exec(tmx)![1]!.split(/,\s*/).map(Number);
    expect(csv.length).toBe(30);
    const cols = Number(/columns="(\d+)"/.exec(new TextDecoder().decode(ex.files.get('land.tsx')!))![1]);
    const sheet = decodePng(ex.files.get('land.png')!);
    const c = composeMapDoc({ ...st.doc!, layers: st.doc!.layers.map((l) => ({ ...l, hidden: l.name !== 'ground' })) }, world(docs));
    for (let i = 0; i < 30; i++) {
      const g = csv[i]! - 1, cx = i % 6, cy = Math.floor(i / 6);
      const tx = (g % cols) * T, ty = Math.floor(g / cols) * T;
      for (let j = 0; j < T; j++) for (let k = 0; k < T; k++) {
        const o = ((ty + j) * sheet.width + tx + k) * 4, b = c.px[(cy * T + j) * c.w + cx * T + k]!;
        const hex = sheet.data[o + 3] ? '#' + [0, 1, 2].map((q) => sheet.data[o + q]!.toString(16).padStart(2, '0')).join('') : null;
        expect(hex).toBe(b === TRANSPARENT ? null : c.palette[b]!.hex);
      }
    }
  });
});
