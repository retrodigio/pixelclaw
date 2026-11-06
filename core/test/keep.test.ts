// `keep`: pixels that are meant to stand alone (an eye, a mouth) are not strays for the orphans check.

import { describe, expect, it } from 'vitest';
import { deserializeDoc, replay, runChecks, serializeDoc, runBatch } from '../src/index.ts';
import { EMPTY, palettes, run } from './helpers.ts';

const BASE = 'new sprite face 12x12\nellipse 1,1 10x10 c=stone fill\npx 4,4 c=ink\npx 7,4 c=ink\npx 5,8 c=moss';
const orphans = (text: string) => runChecks(run(EMPTY, text).doc!, ['orphans'], {})[0]!;

describe('keep', () => {
  it('the orphans check counts lone pixels until they are kept', () => {
    expect(orphans(BASE).detail).toContain('3 stray px');
    const kept = orphans(`${BASE}\nkeep 4,4\nkeep 7,4\nkeep 5,8`);
    expect(kept.detail).toContain('0 stray px');
    expect(kept.detail).toContain('3 kept on purpose');
    expect(kept.status).toBe('pass');
  });
  it('a region keeps every pixel inside it, and nothing outside', () => {
    const r = orphans(`${BASE}\nkeep 4,4 4x1`);
    expect(r.detail).toContain('1 stray px');
    expect(r.groups[0]!.pts).toEqual([[5, 8]]);
  });
  it('remove and clear forget them; the line replays exactly and survives the state bytes', () => {
    const s = run(EMPTY, `${BASE}\nkeep 4,4\nkeep 7,4\nkeep 5,8\nkeep remove 7,4`);
    expect(s.doc!.keeps).toEqual([{ x: 4, y: 4, w: 1, h: 1 }, { x: 5, y: 8, w: 1, h: 1 }]);
    expect(deserializeDoc(serializeDoc(s.doc!)).keeps).toEqual(s.doc!.keeps);
    expect(serializeDoc(replay(s.entries, palettes).doc!)).toEqual(serializeDoc(s.doc!));
    expect(run(s, 'keep clear').doc!.keeps).toEqual([]);
  });
  it('documents without keeps serialise as they did before', () => {
    const s = run(EMPTY, BASE);
    expect(new TextDecoder().decode(serializeDoc(s.doc!))).not.toContain('keeps');
  });
  it('is refused outside the canvas, for a missing target, and when repeated it records once', () => {
    expect(runBatch(EMPTY, `${BASE}\nkeep 12,4`, { by: 't', palettes }).ok).toBe(false);
    expect(runBatch(EMPTY, `${BASE}\nkeep remove 1,1`, { by: 't', palettes }).ok).toBe(false);
    expect(run(EMPTY, `${BASE}\nkeep 4,4\nkeep 4,4`).doc!.keeps).toHaveLength(1);
  });
});
