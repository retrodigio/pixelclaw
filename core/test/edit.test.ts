// G3 commands: what the UI's tools write. Strokes (pixel-perfect pencil, eraser), rectangle
// selections that clip drawing, shift (move), palette edits, notes. Each replays to the same bytes.

import { describe, expect, it } from 'vitest';
import {
  TRANSPARENT, activeCel, ctxOf, serializeDocV1, freehand, renderGrid, replay, runBatch, serializeDoc, type AssetState, type Pt,
} from '../src/index.ts';
import { EMPTY, palettes, run } from './helpers.ts';

const errorOf = (state: AssetState, text: string): string => {
  const r = runBatch(state, text, { by: 't', palettes });
  return r.ok ? 'ok' : r.errors.map((e) => `${e.line}:${e.col}: ${e.message}`).join('\n');
};
const rows = (s: AssetState) => {
  const lines = renderGrid(s.doc!).split('\n');
  return lines.slice(0, lines.indexOf('')).filter((l) => /^\s*\d+  /.test(l)).map((l) => l.replace(/^\s*\d+  /, ''));
};
const replays = (s: AssetState) => {
  const r = replay(s.entries, palettes);
  expect(r.problems).toEqual([]);
  expect(serializeDoc(r.doc!)).toEqual(serializeDoc(s.doc!));
};

const base = run(EMPTY, 'new sprite s 8x6');

describe('stroke', () => {
  it('a pencil drag is one line on the tape, in normal form', () => {
    const s = run(base, 'stroke pencil 1,1 2,1 3,2 c=ink');
    expect(s.entries.at(-1)!.cmd).toBe('stroke pencil c=ink pp=on 1,1 2,1 3,2');
    expect(run(s, s.entries.at(-1)!.cmd).entries.at(-1)!.cmd).toBe('stroke pencil c=ink pp=on 1,1 2,1 3,2');
    replays(s);
  });

  it('is pixel-perfect: a step right then down is a diagonal, with no doubled L-corner', () => {
    const pts: Pt[] = [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [3, 2]];
    expect(freehand(pts, true)).toEqual([[0, 0], [1, 1], [2, 2], [3, 2]]);
    expect(freehand(pts, false)).toEqual(pts);
    const s = run(base, 'stroke pencil c=ink 0,0 1,0 1,1 2,1 2,2 3,2');
    expect(rows(s).slice(0, 3)).toEqual(['0.......', '.0......', '..00....']);
    const off = run(base, 'stroke pencil c=ink pp=off 0,0 1,0 1,1 2,1 2,2 3,2');
    expect(rows(off).slice(0, 3)).toEqual(['00......', '.00.....', '..00....']);
  });

  it('joins samples that jump several pixels with pixel-perfect segments', () => {
    const s = run(base, 'stroke pencil c=moss 0,5 7,5');
    expect(rows(s)[5]).toBe('11111111');
    const one = run(base, 'stroke pencil c=leaf 4,4');
    expect(activeCel(one.doc!)[4 * 8 + 4]).toBe(2);
  });

  it('the eraser clears to transparent and takes no colour', () => {
    const filled = run(base, 'rect 0,0 8x6 c=stone fill');
    const s = run(filled, 'stroke eraser 0,0 3,0');
    expect(s.entries.at(-1)!.cmd).toBe('stroke eraser 0,0 3,0');
    expect(rows(s)[0]).toBe('....3333');
    expect(errorOf(filled, 'stroke eraser 1,1 c=ink')).toBe('1:19: stroke eraser takes no c=');
    expect(errorOf(filled, 'stroke brush 1,1')).toContain("unknown tool 'brush'");
    expect(errorOf(filled, 'stroke pencil c=ink')).toBe('1:15: stroke: expected a point x,y');
  });
});

describe('select and shift', () => {
  const art = run(base, 'rect 1,1 3x2 c=rust fill');

  it('a rectangle selection clips drawing until deselect', () => {
    const s = run(art, 'select rect 0,0 2x6\nrect 0,0 8x6 c=ink fill\ndeselect\npx 7,5 c=leaf');
    expect(rows(s)).toEqual(['00......', '00rr....', '00rr....', '00......', '00......', '00.....2']);
    expect(ctxOf(s.doc!, 'test').sel).toBeNull();
    replays(s);
  });

  it('fill stays inside the selection', () => {
    const s = run(art, 'select rect 0,0 3x6 ; fill 0,0 c=sky ; fill 1,1 c=moss mode=global');
    expect(rows(s)[0]).toBe('444.....');
    expect(rows(s)[1]).toBe('411r....');
  });

  it('shift moves the selected pixels and the selection, leaving transparent pixels', () => {
    const s = run(art, 'select rect 1,1 3x2 ; shift 3,2 ; deselect');
    expect(s.entries.slice(-3).map((e) => e.cmd)).toEqual(['select rect 1,1 3x2', 'shift 3,2', 'deselect']);
    expect(rows(s)).toEqual(['........', '........', '........', '....rrr.', '....rrr.', '........']);
    const kept = run(art, 'select rect 1,1 3x2 ; shift 1,0');
    expect([...ctxOf(kept.doc!, 'test').sel!].map((v, i) => (v ? i : -1)).filter((i) => i >= 0)).toEqual([10, 11, 12, 18, 19, 20]);
    replays(kept);
  });

  it('shift without a selection moves the whole canvas; past an edge it clips, or wraps on wrap documents', () => {
    const clip = run(art, 'shift 6,0');
    expect(rows(clip)[1]).toBe('.......r');
    const tile = run(run(EMPTY, 'new tile t 8x6'), 'rect 1,1 3x2 c=rust fill ; shift 6,0');
    expect(rows(tile)[1]).toBe('rr.....r');
  });

  it('select all and select none', () => {
    const s = run(art, 'select all');
    expect(ctxOf(s.doc!, 'test').sel!.every((v) => v === 1)).toBe(true);
    expect(ctxOf(run(s, 'select none').doc!, 'test').sel).toBeNull();
    expect(errorOf(art, 'select blob 1,1')).toContain("'blob' is not a selection");
  });
});

describe('palette edits', () => {
  it('palette set changes a colour of this document only; the names on the tape stay', () => {
    const s = run(base, 'px 0,0 c=ink\npalette set ink hex=#202428\npalette set 1 hex=#3F6B3B');
    expect(s.entries.slice(-2).map((e) => e.cmd)).toEqual(['palette set ink hex=#202428', 'palette set moss hex=#3f6b3b']);
    expect(s.doc!.palette.entries[0]!.hex).toBe('#202428');
    expect(palettes.get('test')!.entries[0]!.hex).toBe('#14161c');
    expect(base.doc!.palette.entries[0]!.hex).toBe('#14161c');
    replays(s);
  });

  it('palette add appends an entry, naming it and choosing a free key when not given', () => {
    const s = run(base, 'palette add hex=#d4a83a\npalette add gold hex=#e8c860 key=g\npx 1,1 c=gold ; px 2,2 c=c6');
    expect(s.entries.slice(1, 3).map((e) => e.cmd)).toEqual(['palette add c6 hex=#d4a83a key=5', 'palette add gold hex=#e8c860 key=g']);
    expect(s.doc!.palette.entries.map((e) => e.key).join('')).toBe('01234r5g');
    replays(s);
    expect(errorOf(base, 'palette add hex=#000000 key=0')).toContain("key '0' is taken");
    expect(errorOf(base, 'palette add ink hex=#000000')).toContain("already has an entry 'ink'");
    expect(errorOf(base, 'palette set gold hex=#000000')).toContain("no entry 'gold'");
    expect(errorOf(base, 'palette set ink hex=red')).toContain('hex= must be a colour');
  });

  it('undoing a palette edit restores the colour', () => {
    const s = run(run(base, 'palette set ink hex=#ffffff'), 'undo');
    expect(s.doc!.palette.entries[0]!.hex).toBe('#14161c');
  });
});

describe('notes', () => {
  it('pins notes to a pixel or a region with ids written into the line', () => {
    const s = run(base, 'note 3,2 "too dark here"\nnote 0,0 4x2 "keep this \\"clean\\""');
    expect(s.entries.slice(-2).map((e) => e.cmd)).toEqual(['note 3,2 "too dark here" id=n1', 'note 0,0 4x2 "keep this \\"clean\\"" id=n2']);
    expect(s.doc!.notes).toEqual([
      { id: 'n1', x: 3, y: 2, w: 1, h: 1, text: 'too dark here' },
      { id: 'n2', x: 0, y: 0, w: 4, h: 2, text: 'keep this "clean"' },
    ]);
    replays(s);
  });

  it('note done closes a note; ids are never reused, even after an undo', () => {
    const s = run(base, 'note 1,1 "a"');
    const done = run(s, 'note done n1');
    expect(done.doc!.notes).toEqual([]);
    const undone = run(run(s, 'undo'), 'note 2,2 "b"');
    expect(undone.entries.at(-1)!.cmd).toBe('note 2,2 "b" id=n2');
    expect(errorOf(done, 'note done n1')).toContain("no open note 'n1'");
    expect(errorOf(base, 'note 8,0 "x"')).toContain('outside the 8x6 canvas');
    expect(errorOf(base, 'note 1,1 ""')).toContain('the text is empty');
  });

  it('notes and selections change the state bytes; documents without them keep their G1-G3 bytes too', () => {
    const plain = serializeDoc(base.doc!);
    expect(serializeDoc(run(base, 'note 1,1 "a"').doc!)).not.toEqual(plain);
    expect(serializeDoc(run(base, 'select all').doc!).length).toBe(plain.length + 48 + '["test",0,0,true,null,null]'.length);
    const v1 = new TextDecoder().decode(serializeDocV1(base.doc!)!);
    expect(v1).toContain('PCLAWDOC 1');
    expect(v1).not.toContain('notes');
    expect(serializeDocV1(run(base, 'layer add top').doc!)).toBeNull();
  });
});

describe('transparent', () => {
  it('pencil with c=none clears', () => {
    const s = run(run(base, 'rect 0,0 8x6 c=ink fill'), 'stroke pencil c=none 0,0 1,0');
    expect(activeCel(s.doc!)[0]).toBe(TRANSPARENT);
  });
});
