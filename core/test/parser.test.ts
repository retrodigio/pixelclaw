import { describe, expect, it } from 'vitest';
import { parse } from '../src/index.ts';

describe('parser', () => {
  it('reads tokens with positions, comments and ; separators', () => {
    const r = parse('px 3,4 c=ink   # a comment\nline 0,0 5,5 c=#14161c ; rect 1,1 4x4 c=moss fill');
    expect(r.errors).toEqual([]);
    expect(r.commands.map((c) => [c.name, c.line, c.col])).toEqual([['px', 1, 1], ['line', 2, 1], ['rect', 2, 26]]);
    expect(r.commands[0]!.args).toEqual([
      { t: 'point', x: 3, y: 4, line: 1, col: 4 },
      { t: 'kv', key: 'c', value: 'ink', quoted: false, vcol: 10, line: 1, col: 8 },
    ]);
    expect(r.commands[1]!.args[2]).toMatchObject({ t: 'kv', key: 'c', value: '#14161c' });
    expect(r.commands[2]!.args.map((a) => a.t)).toEqual(['point', 'size', 'kv', 'word']);
  });

  it('reads negative points, @cell, strings and quoted values', () => {
    const r = parse('px @cell(2,1) -1,-2 note="a b" "hi \\"x\\""');
    expect(r.errors).toEqual([]);
    expect(r.commands[0]!.args).toMatchObject([
      { t: 'cell', cx: 2, cy: 1 }, { t: 'point', x: -1, y: -2 }, { t: 'kv', key: 'note', value: 'a b', quoted: true }, { t: 'string', v: 'hi "x"' },
    ]);
  });

  it('reads blocks: common indent removed, | margins kept verbatim, # not a comment', () => {
    const r = parse('paint 1,2 <<  # rows follow\n    ..0#\n    .11.\n\n>>\npaint 0,0 <<\n  | 0 |\n  |   |\n>>\npx 0,0 c=ink');
    expect(r.errors).toEqual([]);
    expect(r.commands.map((c) => c.name)).toEqual(['paint', 'paint', 'px']);
    const b1 = r.commands[0]!.args[1]!;
    expect(b1.t === 'block' && b1.rows.map((x) => [x.text, x.line, x.col])).toEqual([['..0#', 2, 5], ['.11.', 3, 5], ['', 4, 1]]);
    const b2 = r.commands[1]!.args[1]!;
    expect(b2.t === 'block' && b2.rows.map((x) => x.text)).toEqual([' 0 ', '   ']);
    expect(r.commands[2]!.line).toBe(10);
  });

  it('reports errors with line and column', () => {
    expect(parse('px 1,1 c=ink\n  3,4 c=ink').errors).toEqual([{ line: 2, col: 3, message: 'expected a command name' }]);
    expect(parse('px 1,1 note="open').errors).toEqual([{ line: 1, col: 13, message: 'unterminated string' }]);
    expect(parse('px 0,0 c=ink\npaint 0,0 <<\n  00\n').errors).toEqual([{ line: 2, col: 11, message: "block opened here is never closed with '>>'" }]);
    expect(parse('paint 0,0 << 00\n>>').errors[0]).toMatchObject({ line: 1, col: 14 });
    expect(parse('px 99999999,0 c=ink').errors[0]).toMatchObject({ line: 1, col: 4, message: 'number 99999999 is out of range' });
  });

  it('keeps going after an error so every bad line is reported', () => {
    const r = parse('px 1,1 c=ink\n7 0,0\npx 2,2 c=ink\nQ\n');
    expect(r.errors.map((e) => e.line)).toEqual([2, 4]);
    expect(r.commands.length).toBe(2);
  });
});
