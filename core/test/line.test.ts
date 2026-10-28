import { describe, expect, it } from 'vitest';
import { polyline, segment, type Pt } from '../src/index.ts';

const runs = (pts: Pt[], axis: 0 | 1): number[] => {
  // Lengths of runs of equal minor coordinate along the path.
  const out: number[] = [];
  let n = 0;
  for (let i = 0; i < pts.length; i++) {
    n++;
    if (i === pts.length - 1 || pts[i + 1]![axis] !== pts[i]![axis]) { out.push(n); n = 0; }
  }
  return out;
};

function hasLCorner(path: Pt[]): number {
  for (let i = 1; i < path.length - 1; i++) {
    const [p, c, n] = [path[i - 1]!, path[i]!, path[i + 1]!];
    if (Math.abs(p[0] - n[0]) === 1 && Math.abs(p[1] - n[1]) === 1) return i;
  }
  return -1;
}

describe('pixel-perfect lines', () => {
  it('every segment is 8-connected, hits both endpoints, has no L-corners, and does not depend on direction', () => {
    for (let ax = -5; ax <= 5; ax++) for (let ay = -5; ay <= 5; ay++) for (let bx = -5; bx <= 5; bx++) for (let by = -5; by <= 5; by++) {
      const s = segment([ax, ay], [bx, by]);
      expect(s[0]).toEqual([ax, ay]);
      expect(s.at(-1)).toEqual([bx, by]);
      expect(s.length).toBe(Math.max(Math.abs(bx - ax), Math.abs(by - ay)) + 1);
      for (let i = 1; i < s.length; i++) expect(Math.max(Math.abs(s[i]![0] - s[i - 1]![0]), Math.abs(s[i]![1] - s[i - 1]![1]))).toBe(1);
      expect(hasLCorner(s)).toBe(-1);
      expect(segment([bx, by], [ax, ay])).toEqual([...s].reverse());
    }
  });

  it('gives even step runs for whole-number slopes', () => {
    expect(runs(segment([0, 0], [8, 2]), 1)).toEqual([3, 3, 3]);
    expect(runs(segment([0, 0], [9, 4]), 1)).toEqual([2, 2, 2, 2, 2]);
    expect(runs(segment([0, 0], [11, 3]), 1)).toEqual([3, 3, 3, 3]);
    expect(runs(segment([0, 0], [2, 8]), 0)).toEqual([3, 3, 3]);
    expect(runs(segment([0, 0], [7, 7]), 1)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('keeps the runs symmetric about the middle where the slope allows', () => {
    for (const [dx, dy] of [[8, 2], [10, 4], [12, 2], [6, 2], [14, 4]] as const) {
      const r = runs(segment([0, 0], [dx, dy]), 1);
      expect(r).toEqual([...r].reverse());
    }
  });

  it('removes doubled L-corners where polyline segments join', () => {
    const raw = polyline([[0, 0], [4, 1], [6, 5]], false);
    expect(hasLCorner(raw)).toBeGreaterThan(-1);
    const pp = polyline([[0, 0], [4, 1], [6, 5]], true);
    expect(hasLCorner(pp)).toBe(-1);
    expect(pp.length).toBe(raw.length - 1);
    expect(pp[0]).toEqual([0, 0]);
    expect(pp.at(-1)).toEqual([6, 5]);
  });

  it('keeps a right angle between straight horizontal and vertical segments', () => {
    const p = polyline([[0, 0], [4, 0], [4, 4]], true);
    expect(p).toContainEqual([4, 0]);
    expect(p.length).toBe(9);
  });

  it('does not repeat the joint pixel, and a zero-length line is one pixel', () => {
    expect(polyline([[0, 0], [3, 3], [6, 0]], true).length).toBe(7);
    expect(polyline([[2, 2], [2, 2]], true)).toEqual([[2, 2]]);
  });
});
