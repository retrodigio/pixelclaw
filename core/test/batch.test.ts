import { describe, expect, it } from 'vitest';
import { runBatch, serializeDoc } from '../src/index.ts';
import { EMPTY, palettes, run } from './helpers.ts';

describe('batches', () => {
  const base = run(EMPTY, 'new sprite s 12x12\nrect 0,0 12x12 c=moss fill');

  it('apply nothing when any line has an error, and report every error with line and column', () => {
    const before = serializeDoc(base.doc!);
    const r = runBatch(base, 'px 1,1 c=ink\nline 0,0 c=ink\npx 2,2 c=ink\nrect 0,0 3x3 c=nope\n  9', { by: 't', palettes });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual([
      { line: 2, col: 10, message: 'line: expected an end point x,y' },
      { line: 4, col: 16, message: `unknown colour 'nope' (palette 'test': ink, moss, leaf, stone, sky, rust, none)` },
      { line: 5, col: 3, message: 'expected a command name' },
    ]);
    expect(serializeDoc(base.doc!)).toEqual(before);
    expect(base.entries.length).toBe(2);
  });

  it('log a successful batch as one group with consecutive seqs, author and time', () => {
    const r = runBatch(base, 'px 1,1 c=ink ; px 2,2 c=ink\npx 3,3 c=ink', { by: 'claude', at: '2026-10-27T12:00:00Z', palettes });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.group).toBe('g2');
    expect(r.changed).toBe(3);
    expect(r.added).toEqual([
      { seq: 3, by: 'claude', at: '2026-10-27T12:00:00Z', group: 'g2', cmd: 'px 1,1 c=ink' },
      { seq: 4, by: 'claude', at: '2026-10-27T12:00:00Z', group: 'g2', cmd: 'px 2,2 c=ink' },
      { seq: 5, by: 'claude', at: '2026-10-27T12:00:00Z', group: 'g2', cmd: 'px 3,3 c=ink' },
    ]);
  });

  it('do not mutate the input state', () => {
    const before = serializeDoc(base.doc!);
    run(base, 'fill 0,0 c=ink');
    expect(serializeDoc(base.doc!)).toEqual(before);
  });

  it('treat an empty batch as a no-op', () => {
    const r = runBatch(base, '# nothing\n\n', { by: 't', palettes });
    expect(r.ok && r.added.length === 0 && r.group === null && r.changed === 0).toBe(true);
  });
});
