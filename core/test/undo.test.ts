import { describe, expect, it } from 'vitest';
import { activeCel, activeGroups, runBatch, serializeDoc } from '../src/index.ts';
import { EMPTY, palettes, run } from './helpers.ts';

const errorOf = (state: Parameters<typeof runBatch>[0], text: string): string => {
  const r = runBatch(state, text, { by: 't', palettes });
  return r.ok ? 'ok' : r.errors[0]!.message;
};

describe('undo by group', () => {
  const g1 = run(EMPTY, 'new sprite s 8x8');
  const g2 = run(g1, 'px 1,1 c=ink\npx 2,2 c=ink');
  const g3 = run(g2, 'rect 0,0 8x8 c=moss');
  const g4 = run(g3, 'px 5,5 c=leaf');

  it('undoes the latest group in effect, and the group is written into the line', () => {
    const u = run(g4, 'undo');
    expect(u.entries.at(-1)!.cmd).toBe('undo group=g4');
    expect(serializeDoc(u.doc!)).toEqual(serializeDoc(g3.doc!));
    const u2 = run(u, 'undo');
    expect(u2.entries.at(-1)!.cmd).toBe('undo group=g3');
    expect(serializeDoc(u2.doc!)).toEqual(serializeDoc(g2.doc!));
  });

  it('can undo several groups in one batch, and an earlier group selectively', () => {
    const u = run(g4, 'undo ; undo');
    expect(u.entries.slice(-2).map((e) => e.cmd)).toEqual(['undo group=g4', 'undo group=g3']);
    expect(serializeDoc(u.doc!)).toEqual(serializeDoc(g2.doc!));
    const sel = run(g4, 'undo group=g2');
    const cel = activeCel(sel.doc!);
    expect(cel[1 * 8 + 1]).not.toBe(0); // g2's pixels are gone...
    expect(cel[5 * 8 + 5]).toBe(2); // ...g4's stay
  });

  it('redoes by undoing an undo group', () => {
    const u = run(g4, 'undo'); // g5 undoes g4
    const r = run(u, 'undo group=g5');
    expect(serializeDoc(r.doc!)).toEqual(serializeDoc(g4.doc!));
    expect([...activeGroups(r.entries)].sort()).toEqual(['g1', 'g2', 'g3', 'g4', 'g6']);
  });

  it('refuses what cannot be undone', () => {
    expect(errorOf(g1, 'undo')).toBe('nothing to undo');
    expect(errorOf(g4, 'undo group=g1')).toBe(`group 'g1' created the document and cannot be undone`);
    expect(errorOf(g4, 'undo group=g9')).toBe(`no group 'g9' on this tape`);
    expect(errorOf(g4, 'undo group=g5')).toBe('a batch cannot undo its own group');
    expect(errorOf(run(g4, 'undo group=g3'), 'undo group=g3')).toBe(`group 'g3' is already undone`);
  });
});
