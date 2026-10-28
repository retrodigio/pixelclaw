import { describe, expect, it } from 'vitest';
import { Pcg32, hashString, seedFrom } from '../src/index.ts';

describe('PCG32', () => {
  it('matches the reference pcg32 demo output (seed 42, stream 54)', () => {
    const r = new Pcg32(42, 54);
    const got = Array.from({ length: 6 }, () => r.nextU32().toString(16).padStart(8, '0'));
    expect(got).toEqual(['a15c02b7', '7b47f409', 'ba1d3330', '83d2f293', 'bfa4784b', 'cbed606e']);
  });

  it('is reproducible, and a different seed gives a different stream', () => {
    const a = new Pcg32(7);
    const b = new Pcg32(7);
    const c = new Pcg32(8);
    const sa = Array.from({ length: 50 }, () => a.nextU32());
    expect(Array.from({ length: 50 }, () => b.nextU32())).toEqual(sa);
    expect(Array.from({ length: 50 }, () => c.nextU32())).not.toEqual(sa);
  });

  it('gives bounded integers in range, covering the range', () => {
    const r = new Pcg32(1);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = r.range(-3, 3);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThanOrEqual(3);
      seen.add(v);
    }
    expect(seen.size).toBe(7);
    expect(() => r.nextInt(0)).toThrow();
  });

  it('derives seeds in 1..2^31-1 and hashes strings stably', () => {
    const s = seedFrom(new Pcg32(3));
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(2 ** 31);
    expect(hashString('stone_floor')).toBe(hashString('stone_floor'));
    expect(hashString('a')).not.toBe(hashString('b'));
  });
});
