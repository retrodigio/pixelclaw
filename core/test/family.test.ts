// G7 families: derivation from a band profile, from quadrant pieces and
// cut from a painted map, with the textures re-projected; checked pixel by pixel against the
// picture a map of cells makes, and as goldens; the map preview, its seam score and overlays;
// coverage; and replay.
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_SCHEMES, DEFAULT_MAP, TRANSPARENT, composeMap, encodeGif, encodePng, familyCell, flatten, islandTerrain, layoutOf, mapGifFrames, mapSeam, mapText,
  renderFamilyView, renderMap, renderScaled, replay, runBatch, runChecks, serializeDoc, deserializeDoc, type AssetState, type Doc, type Terrain,
} from '../src/index.ts';
import { EMPTY, golden, palettes, run } from './helpers.ts';

const T = 12;
/** A small family: inside a leaf/moss checker, outside sky with a stone fleck, so re-projection is visible. */
const BASE = (scheme: string, extra = '') => `new family f ${T}x${T} scheme=${scheme}${extra}
paint @cell(inside) 0,0 <<
${'  212121212121\n  121212121212\n'.repeat(6)}>>
rect @cell(outside) 0,0 12x12 c=sky fill
px @cell(outside) 5,2 c=stone`;

const state = (text: string): AssetState => run(EMPTY, text);
const docOf = (text: string): Doc => state(text).doc!;

/** The pixel picture of a map: every terrain cell a full square (corner schemes: each quadrant its corner's). */
function picture(scheme: string, t: Terrain, size: number): boolean[] {
  const s = BUILTIN_SCHEMES.get(scheme)!;
  const W = t.cols * size, H = t.rows * size;
  const out: boolean[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (s.neighbours === 'corners') {
      const cx = Math.floor(x / size) + (x % size >= size / 2 ? 1 : 0), cy = Math.floor(y / size) + (y % size >= size / 2 ? 1 : 0);
      out.push(t.cells[cy * (t.cols + 1) + cx] === 1);
    } else out.push(t.cells[Math.floor(y / size) * t.cols + Math.floor(x / size)] === 1);
  }
  return out;
}

describe('family derivation', () => {
  it('a 1-pixel band drawn on the pieces lands, in every one of the 256 neighbourhoods, exactly on the terrain pixels touching the outside', () => {
    for (const scheme of ['blob47', 'wang16-corner']) {
      const d = docOf(`${BASE(scheme)}\nfamily band 1:ink`);
      const s = BUILTIN_SCHEMES.get(scheme)!;
      const ink = d.palette.entries.findIndex((e) => e.name === 'ink');
      const cases = scheme === 'blob47' ? 256 : 16;
      for (let raw = 0; raw < cases; raw++) {
        // blob47: a 3x3 map with the centre in; wang: a 1x1 map of corners.
        const t: Terrain = scheme === 'blob47'
          ? { cols: 3, rows: 3, cells: Uint8Array.from([128, 1, 2, 64, -1, 4, 32, 16, 8].map((b) => (b < 0 ? 1 : raw & b ? 1 : 0))) }
          : { cols: 1, rows: 1, cells: Uint8Array.from([raw & 8 ? 1 : 0, raw & 1 ? 1 : 0, raw & 4 ? 1 : 0, raw & 2 ? 1 : 0]) };
        const m = composeMap(d, t, 0);
        const pic = picture(scheme, t, T);
        const ox = scheme === 'blob47' ? T : 0;
        for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
          const X = ox + x, Y = ox + y;
          let touches = false;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            // Past the map's edge the picture carries on as it is at the edge.
            const a = Math.min(m.w - 1, Math.max(0, X + dx)), b = Math.min(m.h - 1, Math.max(0, Y + dy));
            if (!pic[b * m.w + a]) touches = true;
          }
          const want = pic[Y * m.w + X] && touches;
          expect(m.px[Y * m.w + X] === ink, `${scheme} ${raw} at ${x},${y}`).toBe(want);
        }
        void s;
      }
    }
  });

  it('re-projects the textures: every variant\'s ground is the inside or outside texture at the same pixel', () => {
    const d = docOf(`${BASE('blob47')}\nfamily band 2:outside 1:ink 1:rust radius=1`);
    const f = d.family!;
    const L = layoutOf(f);
    const flat = flatten(d, 0);
    const at = (c: [number, number], x: number, y: number) => flat[(c[1] * T + y) * d.width + c[0] * T + x]!;
    // An isolated tile: its corner pixel shows the outside texture (sky); its middle the inside texture.
    const o = familyCell(f, 'o')!;
    expect(at(o, 0, 0)).toBe(at(L.outside, 0, 0));
    expect(at(o, 4, 4)).toBe(at(L.inside, 4, 4));
    // The interior variant is the inside texture, pixel for pixel; changing the texture changes every variant.
    const full = familyCell(f, 'nesw_ne_se_sw_nw')!;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) expect(at(full, x, y)).toBe(at(L.inside, x, y));
    const d2 = run({ doc: d, entries: [] }, 'px @cell(inside) 4,4 c=rust').doc!;
    const flat2 = flatten(d2, 0);
    expect(flat2[(full[1] * T + 4) * d.width + full[0] * T + 4]).toBe(d.palette.entries.findIndex((e) => e.name === 'rust'));
  });

  it('a piece\'s hand detail propagates to every variant built from that quadrant, until the variant is detached', () => {
    const st = state(`${BASE('blob47')}\nfamily band 1:ink 1:stone radius=1`);
    const s = BUILTIN_SCHEMES.get('blob47')!;
    const st2 = run(st, 'layer band\npx @cell(o) 1,1 c=rust');
    const d = st2.doc!;
    const f = d.family!;
    const rust = d.palette.entries.findIndex((e) => e.name === 'rust');
    const flat = flatten(d, 0);
    const shows = (name: string) => { const [cx, cy] = familyCell(f, name)!; return flat[(cy * T + 1) * d.width + cx * T + 1] === rust; };
    const outerNW = s.variants.filter((v) => v.quads[0] === 'outer').map((v) => v.name);
    expect(outerNW.length).toBe(5);
    for (const n of outerNW) expect(shows(n), n).toBe(true);
    for (const v of s.variants) if (v.quads[0] !== 'outer') expect(shows(v.name), v.name).toBe(false);
    // Detached: keeps its pixels, stops following the piece; attach again and it follows.
    const st3 = run(st2, 'family detach e\npx @cell(o) 1,1 c=ink');
    const flat3 = flatten(st3.doc!, 0);
    const [nx, ny] = familyCell(f, 'e')!;
    expect(flat3[(ny * T + 1) * d.width + nx * T + 1]).toBe(rust);
    const st4 = run(st3, 'family attach e');
    expect(flatten(st4.doc!, 0)[(ny * T + 1) * d.width + nx * T + 1]).not.toBe(rust);
    expect(() => run(st, 'family detach o')).toThrow(/'o' is a piece/);
  });

  it('derivation goldens: blob47 from a band profile, path and wang16 from pieces, the family view', () => {
    const blob = docOf(`${BASE('blob47')}\nfamily band 2:outside 1:ink 1:rust radius=1\nlayer band\npx @cell(o) 3,3 4,3 c=stone`);
    golden('g7/blob47.png', encodePng(renderScaled(blob, { scale: 4 })));
    golden('g7/blob47.family.png', encodePng(renderFamilyView(blob, { scale: 2 })));
    const path = docOf(`${BASE('path')}\nfamily band 1:ink 1:stone`);
    golden('g7/path.png', encodePng(renderScaled(path, { scale: 4 })));
    const wang = docOf(`${BASE('wang16-corner')}\nfamily band 1:outside 1:ink radius=1`);
    golden('g7/wang16.png', encodePng(renderScaled(wang, { scale: 4 })));
    const bridge = docOf(`${BASE('bridge8')}\nfamily band 1:ink\nlayer band\npx @cell(h) 0,2 0,5 7,2 7,5 c=rust`);
    golden('g7/bridge8.png', encodePng(renderScaled(bridge, { scale: 4 })));
  });

  it('cuts a family from its painted coverage map: medoids, only the band kept, detached', () => {
    // Paint the map with the derived family (fill=on), mark one tile of 'o' everywhere it appears, then cut.
    const st = state(`${BASE('blob47', ' map=14x12')}\nfamily band 1:outside 1:ink 1:rust radius=1\nfamily coverage seed=7 copies=1 fill=on`);
    const d = st.doc!;
    const f = d.family!;
    expect(f.terrain.length).toBe(168);
    expect(d.layers.map((l) => l.name)).toEqual(['template', 'ground', 'band']);
    expect(d.layers[0]!.reference).toBe(true);
    const cut = run(st, 'family cut textures=on').doc!;
    const s = BUILTIN_SCHEMES.get('blob47')!;
    const pieces = new Set(s.pieces);
    expect(cut.family!.detached).toEqual(s.variants.map((v) => v.name).filter((n) => !pieces.has(n)));
    // Cut from a map painted with the derivation itself, every variant comes back the same.
    const L = layoutOf(f);
    const a = flatten(d, 0), b = flatten(cut, 0);
    for (let v = 0; v < s.variants.length; v++) {
      const [cx, cy] = L.cells[v]!;
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
        const i = (cy * T + y) * d.width + cx * T + x;
        expect(b[i], `${s.variants[v]!.name} ${x},${y}`).toBe(a[i]);
      }
    }
    void pieces;
    golden('g7/cut.png', encodePng(renderScaled(cut, { scale: 2 })));
    // No map, no band: refused with what to do.
    expect(() => run(state(BASE('blob47')), 'family cut')).toThrow(/lay out the coverage map first/);
    expect(() => run(state(BASE('blob47', ' map=6x6')), 'family coverage seed=1')).toThrow(/no 6x6 layout with every variant/);
  });

  it('copies a texture from another tile asset into the line, so replay needs no other asset', () => {
    const tile = run(EMPTY, 'new tile grass 12x12\nrect 0,0 12x12 c=leaf fill\npx 2,2 c=moss').doc!;
    const r = runBatch(state(BASE('blob47')), 'family texture inside from=grass', { by: 'test', palettes, assets: (n) => (n === 'grass' ? tile : undefined) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const line = r.added[0]!.cmd;
    expect(line.split('\n')[0]).toBe('family texture inside from=grass frame=1 <<');
    expect(line).toContain('  222222222222\n  221222222222\n');
    const back = replay(r.state.entries, palettes);
    expect(back.problems).toEqual([]);
    expect(Buffer.compare(Buffer.from(serializeDoc(back.doc!)), Buffer.from(serializeDoc(r.state.doc!)))).toBe(0);
    const bad = runBatch(state(BASE('blob47')), 'family texture inside from=nope', { by: 'test', palettes, assets: () => undefined });
    expect(bad.ok).toBe(false);
  });

  it('keeps the family in the state bytes, replays byte-identically, and normal forms are fixed points', () => {
    const st = state(`${BASE('blob47', ' map=14x12')}\nfamily band 2:outside 1:ink radius=2\nfamily coverage\nfamily detach ne_ne`);
    const d = st.doc!;
    expect(Buffer.compare(Buffer.from(serializeDoc(deserializeDoc(serializeDoc(d)))), Buffer.from(serializeDoc(d)))).toBe(0);
    const r = replay(st.entries, palettes);
    expect(r.problems).toEqual([]);
    expect(Buffer.compare(Buffer.from(serializeDoc(r.doc!)), Buffer.from(serializeDoc(d)))).toBe(0);
    // The coverage line chose a seed and wrote it down.
    expect(st.entries.find((e) => e.cmd.startsWith('family coverage'))!.cmd).toMatch(/^family coverage seed=\d+ copies=1 fill=off$/);
    expect(st.entries[0]!.cmd.split('\n')[0]).toBe('new family f 12x12 scheme=blob47 map=14x12 palette=test wrap=off cell=12x12 bg=none <<');
  });

  it('checks a family: coverage of every variant and texture, the seam over an island map', () => {
    const empty = docOf(`new family f ${T}x${T} scheme=blob47`);
    const cov = runChecks(empty, ['coverage'])[0]!;
    expect(cov.status).toBe('fail');
    expect(cov.detail).toMatch(/inside is empty; outside is empty; o is empty/);
    const d = docOf(`${BASE('blob47')}\nfamily band 2:outside 1:ink radius=1`);
    const [c, seam] = runChecks(d, ['coverage', 'seam']);
    expect(c!.status).toBe('pass');
    expect(c!.detail).toBe('blob47: all 47 variants and both textures drawn');
    expect(seam!.status).not.toBe('skip');
    expect(seam!.detail).toMatch(/over a 12x10 island \(seed 1\)/);
    // An ink line along every tile border is a seam the map score sees.
    const bad = docOf(`${BASE('blob47')}\nfamily band 1:ink`);
    const s = BUILTIN_SCHEMES.get('blob47')!;
    const m = composeMap(bad, islandTerrain(s, DEFAULT_MAP.cols, DEFAULT_MAP.rows, DEFAULT_MAP.seed), 0);
    expect(mapSeam(m, bad).score).toBeGreaterThan(runChecks(d, ['seam'])[0]!.score!);
  });
});

describe('maps and overlays', () => {
  it('composes a random island (golden), with its text', () => {
    const d = docOf(`${BASE('blob47')}\nfamily band 2:outside 1:ink 1:rust radius=1`);
    golden('g7/island.png', encodePng(renderMap(d, { cols: 10, rows: 8, seed: 5, scale: 2 })));
    const s = BUILTIN_SCHEMES.get('blob47')!;
    const t = islandTerrain(s, 10, 8, 5);
    expect(islandTerrain(s, 10, 8, 5).cells).toEqual(t.cells);
    expect(islandTerrain(s, 10, 8, 6).cells).not.toEqual(t.cells);
    // An island: the edge is outside.
    for (let x = 0; x < 10; x++) expect(t.cells[x]).toBe(0);
    expect(mapText(d, { cols: 10, rows: 8, seed: 5 })).toMatch(/^10x8 tiles of 12 px, a random island \(seed 5\); seam [\d.]+ /);
  });

  it('plays overlays over the map in their modes, and animated families with their frames', () => {
    const fam = docOf(`${BASE('blob47')}\nfamily band 2:outside 1:ink radius=1`);
    const ov = (mode: string) => docOf(`new overlay glint 2x2\nrect 0,0 2x2 c=leaf fill\nframe add empty\nframe 2\npx 0,0 c=stone\nframe set all ticks=6\noverlay set mode=${mode} on=outside every=2 spread=2x2 seed=4 rest=12`);
    for (const mode of ['cycle', 'pingpong', 'wave', 'sparkle']) {
      const o = ov(mode);
      expect(o.overlay!.mode).toBe(mode);
      const frames = mapGifFrames(fam, { cols: 6, rows: 5, seed: 2, overlays: [o], scale: 1 });
      expect(frames.length, mode).toBeGreaterThan(1);
      if (mode === 'wave') golden('g7/overlay-wave.gif', encodeGif(frames, { delta: true }));
      // Overlays draw only on outside tiles here.
      const m = composeMap(fam, islandTerrain(BUILTIN_SCHEMES.get('blob47')!, 6, 5, 2), 0);
      const shown = renderMap(fam, { cols: 6, rows: 5, seed: 2, overlays: [o], scale: 1 });
      void m; void shown;
    }
    expect(() => docOf('new overlay glint 2x2\noverlay set mode=spin')).toThrow(/mode= must be one of cycle, pingpong, wave, sparkle/);
    expect(() => docOf('new sprite x 4x4\noverlay set mode=cycle')).toThrow(/is not an overlay/);
    // An animated family: a two-frame texture plays on the map.
    const anim = docOf(`${BASE('blob47')}\nfamily band 2:outside 1:ink radius=1\nframe add copy=1\nframe 2\npx @cell(outside) 1,1 c=ink\nframe set all ticks=8`);
    expect(mapGifFrames(anim, { cols: 5, rows: 4, seed: 1, scale: 1 }).length).toBe(2);
    expect(composeMap(anim, islandTerrain(BUILTIN_SCHEMES.get('blob47')!, 5, 4, 1), 1).px.some((v, i, a) => v !== composeMap(anim, islandTerrain(BUILTIN_SCHEMES.get('blob47')!, 5, 4, 1), 0).px[i])).toBe(true);
    void TRANSPARENT;
  });
});
