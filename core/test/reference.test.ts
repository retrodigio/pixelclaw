// Reference-only assets: a manifest's `reference: true` keeps a piece out of its set (checks that
// compare with the set's members skip it), though it is still checked itself.

import { describe, expect, it } from 'vitest';
import { checkContextFor, validateManifest } from '../src/index.ts';
import { EMPTY, run } from './helpers.ts';

const sprite = (name: string) => ({ name, doc: run(EMPTY, `new sprite ${name} 8x8\nrect 1,1 5x5 c=ink fill`).doc! });

describe('reference-only assets', () => {
  const all = [sprite('urn'), sprite('jar'), sprite('study')];
  const names = (xs: { name: string }[]) => xs.map((x) => x.name).sort();

  it('are neighbours and peers of the rest unless the manifest says reference', () => {
    const { ctx } = checkContextFor('urn', all[0]!.doc, all, undefined, () => undefined);
    expect(names(ctx.set ?? [])).toEqual(['jar', 'study']);
    expect(names(ctx.peers ?? [])).toEqual(['jar', 'study']);
  });
  it('are left out of the set and the peers when marked, and still checked themselves', () => {
    const { ctx } = checkContextFor('urn', all[0]!.doc, all, undefined, () => undefined, { reference: ['study'] });
    expect(names(ctx.set ?? [])).toEqual(['jar']);
    expect(names(ctx.peers ?? [])).toEqual(['jar']);
    const own = checkContextFor('study', all[2]!.doc, all, undefined, () => undefined, { reference: ['study'] });
    expect(names(own.ctx.set ?? [])).toEqual(['jar', 'urn']);
  });
  it('the manifest field is a boolean', () => {
    const base = { format: 'pixelclaw-manifest', version: 1, theme: 't' };
    expect(validateManifest({ ...base, assets: [{ name: 'study', kind: 'sprite', size: '8x8', reference: true }] }).errors).toEqual([]);
    expect(validateManifest({ ...base, assets: [{ name: 'study', kind: 'sprite', size: '8x8', reference: 'yes' }] }).errors[0]!.path).toBe('assets[0].reference');
  });
});
