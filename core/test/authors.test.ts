// Authors: groups per author (h<N> for people), undo and redo per author, forks, and the timeline's
// snapshots.

import { describe, expect, it } from 'vitest';
import {
  Timeline, activeGroups, findRedo, findUndo, nextGroupId, replay, runBatch, serializeDoc, type AssetState, type TapeEntry,
} from '../src/index.ts';
import { EMPTY, palettes, run } from './helpers.ts';

const errorOf = (state: AssetState, text: string, by = 'claude'): string => {
  const r = runBatch(state, text, { by, palettes });
  return r.ok ? 'ok' : r.errors[0]!.message;
};
const last = (s: AssetState) => s.entries.at(-1)!;
const CHRIS = 'human:chris';
const ANA = 'human:ana';

describe('groups per author', () => {
  it('people get their own h<N> counter; agents keep g<N>', () => {
    let s = run(EMPTY, 'new sprite s 8x8', 'claude');
    s = run(s, 'px 1,1 c=ink', CHRIS);
    s = run(s, 'px 2,2 c=ink', 'claude');
    s = run(s, 'px 3,3 c=ink', ANA);
    expect(s.entries.map((e) => e.group)).toEqual(['g1', 'h1', 'g2', 'h2']);
    expect(nextGroupId(s.entries, 'h')).toBe('h3');
    expect(nextGroupId(s.entries, 'g')).toBe('g3');
  });
});

describe('undo and redo by author', () => {
  let s = run(EMPTY, 'new sprite s 8x8', 'claude');
  s = run(s, 'px 0,0 c=ink', CHRIS); // h1
  s = run(s, 'px 1,0 c=ink', 'claude'); // g2
  s = run(s, 'px 2,0 c=ink', CHRIS); // h2
  s = run(s, 'px 3,0 c=ink', ANA); // h3
  const drawn = s;

  it('undo by=<author> takes back that author\'s latest group still in effect', () => {
    const u = run(drawn, `undo by=${CHRIS}`, CHRIS);
    expect(last(u).cmd).toBe('undo group=h2');
    const u2 = run(u, `undo by=${CHRIS}`, CHRIS);
    expect(last(u2).cmd).toBe('undo group=h1');
    expect(errorOf(u2, `undo by=${CHRIS}`, CHRIS)).toBe(`nothing of ${CHRIS}'s to undo`);
    // The others' groups stay.
    expect([...activeGroups(u2.entries)].filter((g) => !g.startsWith('h4') && !g.startsWith('h5')).sort()).toEqual(['g1', 'g2', 'h3']);
  });

  it('redo by=<author> takes back that author\'s undos, latest first, and is written as redo group=', () => {
    const u = run(run(drawn, `undo by=${CHRIS}`, CHRIS), `undo by=${CHRIS}`, CHRIS); // h4 undoes h2, h5 undoes h1
    const r1 = run(u, `redo by=${CHRIS}`, CHRIS);
    expect(last(r1).cmd).toBe('redo group=h5');
    const r2 = run(r1, `redo by=${CHRIS}`, CHRIS);
    expect(last(r2).cmd).toBe('redo group=h4');
    expect(serializeDoc(r2.doc!)).toEqual(serializeDoc(drawn.doc!));
    expect(errorOf(r2, `redo by=${CHRIS}`, CHRIS)).toBe(`nothing of ${CHRIS}'s to redo`);
    // Undo after a redo takes back the redone group again.
    expect(last(run(r2, `undo by=${CHRIS}`, CHRIS)).cmd).toBe('undo group=h2');
    expect(replay(r2.entries, palettes).problems).toEqual([]);
  });

  it('new drawing by the same author ends the redo chain; another author\'s does not', () => {
    const u = run(drawn, `undo by=${CHRIS}`, CHRIS);
    const other = run(u, 'px 5,5 c=moss', ANA);
    expect(last(run(other, `redo by=${CHRIS}`, CHRIS)).cmd).toBe('redo group=h4');
    const mine = run(u, 'px 5,5 c=moss', CHRIS);
    expect(errorOf(mine, `redo by=${CHRIS}`, CHRIS)).toBe(`nothing of ${CHRIS}'s to redo`);
  });

  it("the agent's plain undo is as before: the latest group in effect, whoever wrote it", () => {
    expect(last(run(drawn, 'undo', 'claude')).cmd).toBe('undo group=h3');
    expect(findUndo(drawn.entries, null, 'claude')).toEqual({ group: 'g2' });
    expect(findRedo(drawn.entries, null)).toEqual({ error: 'nothing to redo' });
    expect(errorOf(drawn, 'redo group=h2')).toBe("group 'h2' is not an undo, so there is nothing to redo");
    expect(errorOf(drawn, 'undo group=g1 by=claude')).toBe('undo: give group= or by=, not both');
  });
});

describe('fork', () => {
  const src = run(run(run(EMPTY, 'new sprite chest 8x8 bg=stone'), 'rect 1,1 6x6 c=rust fill'), 'px 3,3 c=ink', CHRIS);
  // The branch tape: the source's entries up to the fork point, then the fork line.
  const prefix = src.entries.filter((e) => e.seq <= 2);
  const atTwo = replay(prefix, palettes).doc!;

  it('starts a branch from a copied prefix; the fork line names the doc and replays', () => {
    const b = run({ doc: atTwo, entries: prefix }, 'fork chest chest_b\npx 0,0 c=leaf', CHRIS);
    expect(b.entries.slice(2).map((e) => [e.seq, e.group, e.cmd])).toEqual([
      [3, 'h1', 'fork chest chest_b at=2'], [4, 'h1', 'px 0,0 c=leaf'],
    ]);
    expect(b.doc!.name).toBe('chest_b');
    const r = replay(b.entries, palettes);
    expect(r.problems).toEqual([]);
    expect(serializeDoc(r.doc!)).toEqual(serializeDoc(b.doc!));
  });

  it('the fork group cannot be undone; earlier groups can', () => {
    const b = run({ doc: atTwo, entries: prefix }, 'fork chest chest_b', CHRIS);
    expect(errorOf(b, 'undo group=h1')).toBe("group 'h1' created the document and cannot be undone");
    expect(last(run(b, 'undo')).cmd).toBe('undo group=g2');
    const u = run(b, 'undo group=g2');
    expect(u.doc!.name).toBe('chest_b');
  });

  it('checks the source name and the fork point', () => {
    const st = { doc: atTwo, entries: prefix };
    expect(errorOf(st, 'fork crate chest_b')).toBe("fork: this tape is 'chest', not 'crate'");
    expect(errorOf(st, 'fork chest chest_b at=1')).toBe('fork: at=1 must be the command just before this one (#2)');
    expect(errorOf(st, 'fork chest chest')).toBe('fork: the new asset needs another name');
  });
});

describe('timeline', () => {
  it('gives the same documents as a replay from the start, from its snapshots', () => {
    let s = run(EMPTY, 'new tile t 16x16 bg=stone');
    for (let i = 0; i < 60; i++) s = run(s, `px ${i % 16},${(i * 7) % 16} c=${['ink', 'moss', 'leaf'][i % 3]}`, i % 2 ? CHRIS : 'claude');
    s = run(s, 'undo group=g5');
    s = run(s, `undo by=${CHRIS}`, CHRIS);
    const tl = new Timeline(palettes, 10);
    const tape: TapeEntry[] = s.entries;
    for (const n of [63, 5, 0, 31, 40, 62, 1]) {
      const want = replay(tape.slice(0, n), palettes).doc;
      const got = tl.docAt(tape, n);
      expect(got.problem).toBeNull();
      expect(got.doc && serializeDoc(got.doc)).toEqual(want && serializeDoc(want));
    }
    expect(tl.size).toBe(6);
    // A grown tape keeps the snapshots; a new tape drops them.
    const grown = run(s, 'px 0,0 c=ink').entries;
    expect(serializeDoc(tl.docAt(grown, grown.length).doc!)).toEqual(serializeDoc(replay(grown, palettes).doc!));
    expect(tl.size).toBe(6);
    const other = run(EMPTY, 'new tile u 4x4').entries;
    expect(tl.docAt(other, 1).doc!.name).toBe('u');
    expect(tl.size).toBe(0);
    expect(serializeDoc(tl.docAfter(tape, 30).doc!)).toEqual(serializeDoc(replay(tape.filter((e) => e.seq <= 30), palettes).doc!));
  });
});
