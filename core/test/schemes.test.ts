// G7 schemes: the resolver against a reference table for all 256
// neighbourhoods, built here without the resolver (the blob list from the literature, keys by
// summing weights, quadrant kinds from the 2x2 cells meeting at each corner); every built-in scheme
// loads with pieces for every quadrant; corner, path and bridge keys; and coverage maps.
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_SCHEMES, coverageTerrain, loadScheme, reachable, resolveMap, resolveVariant, variantCounts, type SchemeJson,
} from '../src/index.ts';

// The 47 blob values (8-bit sums N=1 NE=2 E=4 SE=8 S=16 SW=32 W=64 NW=128 after the corner rule),
// as published for the "blob" tile set; typed in here, not computed.
const BLOB_47 = [0, 1, 4, 5, 7, 16, 17, 20, 21, 23, 28, 29, 31, 64, 65, 68, 69, 71, 80, 81, 84, 85, 87, 92, 93, 95, 112, 113, 116, 117, 119,
  124, 125, 127, 193, 197, 199, 209, 213, 215, 221, 223, 241, 245, 247, 253, 255];

/** The 3x3 neighbourhood of raw bits as a grid: g[y][x], the centre at [1][1] (always the terrain). */
function grid(raw: number): boolean[][] {
  const at: [number, number, number][] = [[0, -1, 1], [1, -1, 2], [1, 0, 4], [1, 1, 8], [0, 1, 16], [-1, 1, 32], [-1, 0, 64], [-1, -1, 128]];
  const g = [[false, false, false], [false, true, false], [false, false, false]];
  for (const [dx, dy, b] of at) g[1 + dy]![1 + dx] = (raw & b) !== 0;
  return g;
}

/** The expected blob key: sides count; a corner counts only with both sides beside it (summed by weights). */
function expectedKey(raw: number): number {
  const g = grid(raw);
  let k = 0;
  if (g[0]![1]) k += 1;
  if (g[1]![2]) k += 4;
  if (g[2]![1]) k += 16;
  if (g[1]![0]) k += 64;
  if (g[0]![2] && g[0]![1] && g[1]![2]) k += 2;
  if (g[2]![2] && g[2]![1] && g[1]![2]) k += 8;
  if (g[2]![0] && g[2]![1] && g[1]![0]) k += 32;
  if (g[0]![0] && g[0]![1] && g[1]![0]) k += 128;
  return k;
}

/** The kind of the centre tile's quadrant at a corner, from the 2x2 cells that meet there. */
function expectedQuad(raw: number, sx: number, sy: number): string {
  const g = grid(raw);
  const v = g[1 + sy]![1]!, h = g[1]![1 + sx]!, d = g[1 + sy]![1 + sx]!;
  if (v && h) return d ? 'in' : 'inner';
  if (!v && !h) return 'outer';
  return v ? 'vert' : 'horiz';
}

describe('schemes', () => {
  it('blob47 resolves all 256 neighbourhoods as the reference table says', () => {
    const s = BUILTIN_SCHEMES.get('blob47')!;
    const seen = new Set<number>();
    for (let raw = 0; raw < 256; raw++) {
      const v = resolveVariant(s, true, raw);
      expect(v, `neighbourhood ${raw}`).not.toBeNull();
      const x = s.variants[v!]!;
      expect(x.key, `neighbourhood ${raw}`).toBe(expectedKey(raw));
      expect(x.quads, `neighbourhood ${raw}`).toEqual([expectedQuad(raw, -1, -1), expectedQuad(raw, 1, -1), expectedQuad(raw, -1, 1), expectedQuad(raw, 1, 1)]);
      seen.add(x.key!);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual(BLOB_47);
    expect(s.variants.map((x) => x.key)).toEqual(BLOB_47);
    // Names: the sides, then the corners that count (the engine-style root_<letters>_<diagonals>).
    expect(s.variants[s.byKey.get(0)!]!.name).toBe('o');
    expect(s.variants[s.byKey.get(255)!]!.name).toBe('nesw_ne_se_sw_nw');
    expect(s.variants[s.byKey.get(1 + 4 + 2)!]!.name).toBe('ne_ne');
    // A cell that is not the terrain has no variant (except below a face).
    expect(resolveVariant(s, false, 255)).toBeNull();
  });

  it('the face scheme puts a face below the terrain, joined to the faces beside it', () => {
    const s = BUILTIN_SCHEMES.get('face')!;
    expect(s.variants.length).toBe(75); // G16: side faces, corners, inner corners and alternate looks (47 + 28)
    const name = (here: boolean, raw: number) => { const v = resolveVariant(s, here, raw); return v === null ? null : s.variants[v]!.name; };
    expect(name(false, 0)).toBeNull();
    expect(name(false, 1)).toBe('face_o');                // terrain above only
    expect(name(false, 1 | 2)).toBe('face_e');            // and above-right, with the right cell open: a face goes on east
    expect(name(false, 1 | 2 | 4)).toBe('face_ie');       // the right cell is terrain: an inner corner (G16; face_o before)
    expect(name(false, 1 | 2 | 128)).toBe('face_ew');
    expect(name(false, 1 | 128)).toBe('face_w');
    expect(name(true, 255)).toBe('nesw_ne_se_sw_nw');
  });

  it('path, bridge8, wang16-corner and single resolve their keys', () => {
    const name = (s: string, here: boolean, raw: number) => { const sc = BUILTIN_SCHEMES.get(s)!; const v = resolveVariant(sc, here, raw); return v === null ? null : sc.variants[v]!.name; };
    // path: 4 neighbours, diagonals ignored.
    expect(name('path', true, 0)).toBe('o');
    expect(name('path', true, 255)).toBe('nesw');
    expect(name('path', true, 1 | 16 | 2 | 8)).toBe('ns');
    expect(new Set(Array.from({ length: 256 }, (_, r) => name('path', true, r))).size).toBe(16);
    // bridge8: one axis, east-west first; no bridge beside it: the east-west single.
    expect(name('bridge8', true, 0)).toBe('h');
    expect(name('bridge8', true, 4)).toBe('h_e');
    expect(name('bridge8', true, 4 | 64 | 1)).toBe('h_ew');
    expect(name('bridge8', true, 1 | 16)).toBe('v_ns');
    expect(name('bridge8', true, 16)).toBe('v_s');
    expect(reachable(BUILTIN_SCHEMES.get('bridge8')!).length).toBe(7);
    // wang16-corner: the tile's own corners (NE=2, SE=8, SW=32, NW=128); all 16.
    expect(name('wang16-corner', true, 0)).toBe('o');
    expect(name('wang16-corner', true, 2 | 8)).toBe('ne_se');
    expect(new Set(Array.from({ length: 256 }, (_, r) => name('wang16-corner', true, r))).size).toBe(16);
    expect(name('single', true, 77)).toBe('o');
  });

  it('every built-in scheme loads, and its pieces supply every quadrant of the other variants', () => {
    expect([...BUILTIN_SCHEMES.keys()]).toEqual(['blob47', 'blob47-round', 'wang16-corner', 'path', 'bridge8', 'single', 'face', 'lane']);
    for (const s of BUILTIN_SCHEMES.values()) {
      s.variants.forEach((v, i) => {
        const src = s.sources[i];
        if (s.pieces.includes(v.name)) { expect(src).toBeNull(); return; }
        src!.forEach(([p, q], k) => {
          if (p < 0) return; // a fillet's plain outside quadrant: the outside texture, no piece
          expect(s.pieces).toContain(s.variants[p]!.name);
          expect(s.quadSpecs[p]![q]!.kind).toBe(s.quadSpecs[i]![k]!.kind);
          expect(s.quadSpecs[p]![q]!.face).toBe(s.quadSpecs[i]![k]!.face);
        });
      });
    }
    expect(BUILTIN_SCHEMES.get('blob47')!.pieces.length).toBe(5);
  });

  it('refuses a scheme whose pieces leave a quadrant without a source', () => {
    const bad: SchemeJson = {
      name: 'bad', description: '', neighbours: '4', columns: 2, pieces: ['o'],
      variants: [{ name: 'o', key: 0, quads: ['outer', 'outer', 'outer', 'outer'] }, { name: 'n', key: 1, quads: ['vert', 'vert', 'outer', 'outer'] }],
    };
    expect(() => loadScheme(bad)).toThrow(/no piece has the vert@nw quadrant variant 'n' needs/);
    expect(() => loadScheme({ ...bad, variants: [{ name: 'o', key: 0, quads: ['wobble', 'in', 'in', 'in'] }] })).toThrow(/unknown quadrant kind 'wobble'/);
  });

  it('coverage maps hold every variant the scheme can produce', () => {
    const cases: [string, number, number, number][] = [['blob47', 14, 12, 1], ['face', 14, 12, 1], ['wang16-corner', 6, 5, 1], ['path', 6, 5, 1], ['bridge8', 8, 6, 2], ['single', 3, 3, 1]];
    for (const [name, c, r, copies] of cases) {
      const s = BUILTIN_SCHEMES.get(name)!;
      const t = coverageTerrain(s, c, r, 7, copies);
      expect(t, name).not.toBeNull();
      const n = variantCounts(s, t!);
      for (const v of reachable(s)) expect(n[v], `${name}: ${s.variants[v]!.name}`).toBeGreaterThanOrEqual(copies);
      expect(resolveMap(s, t!).length).toBe(c * r);
      // The same seed gives the same map.
      expect(coverageTerrain(s, c, r, 7, copies)!.cells).toEqual(t!.cells);
    }
    expect(coverageTerrain(BUILTIN_SCHEMES.get('blob47')!, 3, 3, 1)).toBeNull();
  });
});
