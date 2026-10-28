// PCG32 (XSH RR), the generator from pcg-random.org. Deterministic across platforms: the 64-bit
// state uses BigInt, and every output is an unsigned 32-bit integer. All randomness in core
// comes from here, always seeded explicitly.

const MASK64 = (1n << 64n) - 1n;
const MULT = 6364136223846793005n;

export class Pcg32 {
  private state = 0n;
  private inc = 1n;

  constructor(seed: number | bigint, stream: number | bigint = 54) {
    this.inc = ((BigInt(stream) << 1n) | 1n) & MASK64;
    this.state = 0n;
    this.nextU32();
    this.state = (this.state + (BigInt(seed) & MASK64)) & MASK64;
    this.nextU32();
  }

  /** Next unsigned 32-bit value. */
  nextU32(): number {
    const old = this.state;
    this.state = (old * MULT + this.inc) & MASK64;
    const xorshifted = Number((((old >> 18n) ^ old) >> 27n) & 0xffffffffn);
    const rot = Number(old >> 59n);
    return ((xorshifted >>> rot) | (xorshifted << ((32 - rot) & 31))) >>> 0;
  }

  /** Uniform integer in [0, n), without modulo bias. */
  nextInt(n: number): number {
    if (!Number.isInteger(n) || n <= 0 || n > 0x100000000) throw new RangeError(`nextInt: bad bound ${n}`);
    const threshold = (0x100000000 - n) % n;
    for (;;) {
      const r = this.nextU32();
      if (r >= threshold) return r % n;
    }
  }

  /** Uniform integer in [lo, hi] inclusive. */
  range(lo: number, hi: number): number {
    return lo + this.nextInt(hi - lo + 1);
  }
}

/** A seed in the range the normaliser writes into command lines (1..2^31-1). */
export function seedFrom(rng: Pcg32): number {
  return (rng.nextU32() % 0x7fffffff) + 1;
}

/** FNV-1a over a string's UTF-16 code units: a cheap stable hash for deriving seed streams. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
