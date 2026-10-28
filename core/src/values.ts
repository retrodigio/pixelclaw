// Option values shared by the G4 commands: fractions (level=0.25, density=3/16), ranges (2..4),
// lists of weights, ramps (a palette ramp's name or an inline list of entries), and exact integer
// helpers (floor division, square root) so every generator stays in integer maths.

import { DiagError, type Token } from './parser.ts';
import type { Palette } from './palette.ts';

type Kv = Extract<Token, { t: 'kv' }>;

/** floor(a / b) for integers, exact while a and b are below 2^53. */
export function idiv(a: number, b: number): number {
  let q = Math.floor(a / b);
  if (q * b > a) q--;
  else if ((q + 1) * b <= a) q++;
  return q;
}

/** The nearest integer to a / b (halves away from zero... rounded up). */
export function iround(a: number, b: number): number {
  return idiv(2 * a + b, 2 * b);
}

/** floor(sqrt(n)) for a non-negative integer. */
export function isqrt(n: number): number {
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

/** An exact fraction num/den (den > 0), written back as it was given (decimal, p/q or a percentage as a decimal). */
export interface Fraction {
  num: number;
  den: number;
  text: string;
}

/** Parse 0.25, .5, 1, 3/16 or 25% into an exact fraction in [lo, hi]. */
export function fraction(o: Kv, lo = 0, hi = 1): Fraction {
  const v = o.value.trim();
  let f: Fraction | null = null;
  let m: RegExpExecArray | null;
  if ((m = /^(\d+)\/(\d+)$/.exec(v)) && Number(m[2]) > 0) {
    f = { num: Number(m[1]), den: Number(m[2]), text: `${Number(m[1])}/${Number(m[2])}` };
  } else if ((m = /^(\d*)(?:\.(\d{1,6}))?(%?)$/.exec(v)) && (m[1] || m[2])) {
    const frac = m[2] ?? '';
    let num = Number((m[1] || '0') + frac);
    let den = 10 ** frac.length;
    if (m[3]) den *= 100;
    // Written as a plain decimal, trailing zeros dropped.
    let digits = frac.length + (m[3] ? 2 : 0);
    while (digits > 0 && num % 10 === 0) { num /= 10; den /= 10; digits--; }
    const int = Math.floor(num / den);
    const rest = String(num - int * den).padStart(digits, '0');
    f = { num, den, text: digits ? `${int}.${rest}` : String(int) };
  }
  if (!f) throw new DiagError(o.line, o.vcol, `${o.key}= must be a number like 0.25, 3/16 or 25%`);
  if (f.num * 1 < lo * f.den || f.num > hi * f.den) throw new DiagError(o.line, o.vcol, `${o.key}= must be between ${lo} and ${hi}`);
  return f;
}

/** A whole number option in [lo, hi]. */
export function intOpt(o: Kv, lo: number, hi: number): number {
  if (!/^-?\d+$/.test(o.value)) throw new DiagError(o.line, o.vcol, `${o.key}= must be a whole number`);
  const n = Number(o.value);
  if (n < lo || n > hi) throw new DiagError(o.line, o.vcol, `${o.key}= must be ${lo}..${hi}`);
  return n;
}

/** A range a..b (or a single number a, meaning a..a) with lo <= a <= b <= hi. */
export function rangeOpt(o: Kv, lo: number, hi: number): [number, number] {
  const m = /^(\d+)(?:\.\.(\d+))?$/.exec(o.value);
  if (!m) throw new DiagError(o.line, o.vcol, `${o.key}= must be a range like 2..4`);
  const a = Number(m[1]);
  const b = Number(m[2] ?? m[1]);
  if (a < lo || b > hi || a > b) throw new DiagError(o.line, o.vcol, `${o.key}= must be within ${lo}..${hi}, smallest first`);
  return [a, b];
}

/** A list of whole-number weights (1,6,2), as many as `n`. */
export function weightsOpt(o: Kv, n: number): number[] {
  const parts = o.value.split(',');
  if (!parts.every((p) => /^\d+$/.test(p))) throw new DiagError(o.line, o.vcol, `${o.key}= must be whole numbers like 1,6,2`);
  const w = parts.map(Number);
  if (w.length !== n) throw new DiagError(o.line, o.vcol, `${o.key}= needs ${n} weights (one per colour), not ${w.length}`);
  if (w.every((x) => x === 0)) throw new DiagError(o.line, o.vcol, `${o.key}= needs a weight above 0`);
  if (w.some((x) => x > 10000)) throw new DiagError(o.line, o.vcol, `${o.key}= weights must be at most 10000`);
  return w;
}

export interface Ramp {
  /** The ramp's name, or null for an inline list. */
  name: string | null;
  /** Entry indices, darkest (first) to lightest, as the ramp lists them. */
  idx: number[];
  /** The normal form: the ramp's name, or the entries by name joined with commas. */
  text: string;
}

/** A palette ramp by name (ramp=moss), or an inline list of entries (ramp=moss1,moss2,lichen). */
export function rampOpt(o: Kv, p: Palette): Ramp {
  const v = o.value;
  const named = p.ramps[v];
  const idxOf = (n: string) => p.entries.findIndex((e) => e.name === n || ([...n].length === 1 && e.key === n));
  if (named) return { name: v, idx: named.map(idxOf), text: v };
  const parts = v.split(',');
  if (parts.length < 2) {
    const names = Object.keys(p.ramps);
    throw new DiagError(o.line, o.vcol, `unknown ramp '${v}' (palette '${p.name}' ramps: ${names.length ? names.join(', ') : 'none'}; or list entries: ramp=a,b,c)`);
  }
  const idx: number[] = [];
  for (const part of parts) {
    const i = idxOf(part);
    if (i < 0) throw new DiagError(o.line, o.vcol, `ramp: '${part}' is not an entry of palette '${p.name}'`);
    idx.push(i);
  }
  return { name: null, idx, text: idx.map((i) => p.entries[i]!.name).join(',') };
}

/** Every ramp an entry belongs to, with its position in it. */
export function rampsOf(p: Palette, entry: number): { ramp: number[]; at: number }[] {
  const name = p.entries[entry]?.name;
  const out: { ramp: number[]; at: number }[] = [];
  for (const members of Object.values(p.ramps)) {
    const at = members.indexOf(name ?? '');
    if (at >= 0) out.push({ ramp: members.map((m) => p.entries.findIndex((e) => e.name === m)), at });
  }
  return out;
}
