// Mixes of one-cell tiles by weight (`tiles fill mix=`, and a terrain layer's inside):
// parsing `mix=<tile>:<weight>,...` and sharing each tile's weight with its texture variants. No
// command registers here, so both command modules can import it.

import type { Args, NormaliseContext } from './commands.ts';
import { DiagError, type Token } from './parser.ts';

type Kv = Extract<Token, { t: 'kv' }>;

/** One tile of a `fill mix=` and its weight. */
export interface MixItem { name: string; weight: number }

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/**
 * A mix's tiles, each tile's weight spread evenly over it and its texture variants that the mix
 * does not name itself (unless `variants=named`): whole-number weights, in lowest terms.
 */
export function spreadMix(items: MixItem[], ctx: NormaliseContext): MixItem[] {
  const named = new Set(items.map((x) => x.name));
  const names = ctx.assetNames?.() ?? [];
  const groups = items.map((x) => [x.name, ...names.filter((n) => n !== x.name && !named.has(n) && ctx.asset?.(n)?.variantOf === x.name && ctx.asset?.(n)?.kind === 'tile').sort()]);
  // A variant of two named tiles (it cannot be) or of none: each name once, in the order given.
  const lcm = groups.reduce((m, g) => (m * g.length) / gcd(m, g.length), 1);
  const out: MixItem[] = [];
  groups.forEach((g, k) => { for (const n of g) if (!out.some((o) => o.name === n)) out.push({ name: n, weight: (items[k]!.weight * lcm) / g.length }); });
  const d = out.reduce((m, o) => gcd(m, o.weight), 0) || 1;
  return out.map((o) => ({ name: o.name, weight: o.weight / d }));
}

export function parseMix(o: Kv): MixItem[] {
  const out: MixItem[] = [];
  for (const part of o.value.split(',')) {
    const m = /^([a-z][a-z0-9_-]*)(?::(\d+))?$/.exec(part);
    if (!m) throw new DiagError(o.line, o.vcol, `mix= is a list of one-cell tiles with weights: mix=<tile>:<weight>,<tile>:<weight>,... ('${part}' is not <tile> or <tile>:<weight>)`);
    const w = m[2] === undefined ? 1 : Number(m[2]);
    if (w < 1 || w > 1000) throw new DiagError(o.line, o.vcol, `mix=: ${m[1]}'s weight must be 1..1000`);
    if (out.some((x) => x.name === m[1])) throw new DiagError(o.line, o.vcol, `mix=: ${m[1]} is named twice`);
    out.push({ name: m[1]!, weight: w });
  }
  if (out.length > 64) throw new DiagError(o.line, o.vcol, `mix=: at most 64 tiles`);
  return out;
}


/** seed= (1..2^31-1), or a new seed from the context. */
export function mixSeed(a: Args, ctx: NormaliseContext): number {
  const o = a.opts.get('seed');
  if (!o) return ctx.newSeed();
  if (!/^\d+$/.test(o.value) || Number(o.value) < 1 || Number(o.value) > 0x7fffffff) throw new DiagError(o.line, o.vcol, `seed= must be a whole number 1..2147483647`);
  return Number(o.value);
}
