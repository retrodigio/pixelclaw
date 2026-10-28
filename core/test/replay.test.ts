import { describe, expect, it } from 'vitest';
import { parseTape, replay, serializeDoc, tapeToJsonl } from '../src/index.ts';
import { EMPTY, palettes, run } from './helpers.ts';

const SCRIPT = [
  'new tile t 16x16 bg=stone',
  'rect 2,2 12x12 c=moss fill\nline 0,0 15,7 c=ink\nellipse 8,8 r=5x3 c=leaf',
  'fill 0,15 c=sky\npaint 10,10 <<\n  0r0\n  r r\n  0r0\n>>\npx 15,15 0,0 c=rust',
  'undo',
  'line 15,0 0,15 3,3 c=rust pp=off ; fill 1,1 c=ink mode=global',
];

function build() {
  let s = EMPTY;
  for (const batch of SCRIPT) s = run(s, batch);
  return s;
}

describe('replay', () => {
  it('is byte-identical to the live document, through JSONL and back', () => {
    const live = build();
    const text = tapeToJsonl(live.entries);
    expect(text.split('\n')[0]).toBe('{"pclaw":"tape","lang":2}');
    const entries = parseTape(text);
    expect(entries).toEqual(live.entries);
    const r = replay(entries, palettes);
    expect(r.problems).toEqual([]);
    expect(Buffer.compare(Buffer.from(serializeDoc(r.doc!)), Buffer.from(serializeDoc(live.doc!)))).toBe(0);
  });

  it('gives the same bytes every time, and building again gives the same tape', () => {
    const a = serializeDoc(replay(build().entries, palettes).doc!);
    const b = serializeDoc(replay(build().entries, palettes).doc!);
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
    expect(tapeToJsonl(build().entries)).toBe(tapeToJsonl(build().entries));
  });

  it('reports a tape line that is not in normal form, or no longer applies', () => {
    const live = build();
    const tampered = live.entries.map((e) => (e.seq === 2 ? { ...e, cmd: 'rect 2,2 12x12 c=moss' } : e));
    expect(replay(tampered, palettes).problems).toEqual([{ seq: 2, message: `not in normal form: expected 'rect 2,2 12x12 c=moss outline'` }]);
    const bad = live.entries.map((e) => (e.seq === 3 ? { ...e, cmd: 'line 0,0 15,7 c=gold pp=on' } : e));
    expect(replay(bad, palettes).problems[0]!.message).toMatch(/unknown colour 'gold'/);
  });

  it('rejects tapes from another language version', () => {
    expect(() => parseTape('{"pclaw":"tape","lang":99}\n')).toThrow(/version 99/);
    expect(() => parseTape('')).toThrow(/empty/);
  });
});
