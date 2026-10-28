import { describe, expect, it } from 'vitest';
import { PaletteError, autoKeys, importPalette, paletteToJson, parsePaletteJson } from '../src/index.ts';
import { TEST_PALETTE } from './helpers.ts';

describe('palette import', () => {
  it('reads the JSON format with keys, names, hex and ramps', () => {
    const p = importPalette('mossy.json', paletteToJson(TEST_PALETTE));
    expect(p).toEqual(TEST_PALETTE);
  });

  it('normalises hex case and the missing #', () => {
    const p = parsePaletteJson('{"name":"x","entries":[{"key":"a","name":"one","hex":"AABBCC"}]}');
    expect(p.entries[0]!.hex).toBe('#aabbcc');
    expect(p.ramps).toEqual({});
  });

  it('reads a Lospec JSON export', () => {
    const p = importPalette('dusk.json', '{"name":"dusk-four","author":"","colors":["1a1c2c","5d275d","b13e53","ef7d57"]}');
    expect(p.name).toBe('dusk-four');
    expect(p.entries.map((e) => [e.key, e.name, e.hex])).toEqual([
      ['0', 'c0', '#1a1c2c'], ['1', 'c1', '#5d275d'], ['2', 'c2', '#b13e53'], ['3', 'c3', '#ef7d57'],
    ]);
  });

  it('reads .hex (one colour per line, blank lines ignored)', () => {
    const p = importPalette('Cave Moss.hex', '102018\n#304830\n\n58784a\r\n');
    expect(p.name).toBe('cave-moss');
    expect(p.entries.map((e) => e.hex)).toEqual(['#102018', '#304830', '#58784a']);
    expect(p.entries.map((e) => e.key)).toEqual(['0', '1', '2']);
  });

  it('reads .gpl with a Name, comments and entry names (sanitised and de-duplicated)', () => {
    const gpl = 'GIMP Palette\nName: Old Ruins\nColumns: 4\n# a comment\n  0   0   0\tDeep Shadow\n255 255 255\tLight!\n 12  34  56\tLight!\n 1 2 3\n';
    const p = importPalette('ruins.gpl', gpl);
    expect(p.name).toBe('old-ruins');
    expect(p.entries).toEqual([
      { key: '0', name: 'deep_shadow', hex: '#000000' },
      { key: '1', name: 'light', hex: '#ffffff' },
      { key: '2', name: 'light_2', hex: '#0c2238' },
      { key: '3', name: 'c3', hex: '#010203' },
    ]);
  });

  it('rejects bad files with clear messages', () => {
    expect(() => importPalette('a.gpl', 'not a palette')).toThrow(/GIMP Palette/);
    expect(() => importPalette('a.hex', '12345g')).toThrow(/line 1/);
    expect(() => importPalette('a.png', '')).toThrow(/unknown palette format/);
    const bad = (entries: unknown, ramps: unknown = {}) => () => parsePaletteJson(JSON.stringify({ name: 'x', entries, ramps }));
    expect(bad([{ key: '.', name: 'a', hex: '#000000' }])).toThrow(/reserved/);
    expect(bad([{ key: 'ab', name: 'a', hex: '#000000' }])).toThrow(/one character/);
    expect(bad([{ key: 'a', name: 'a', hex: '#000000' }, { key: 'a', name: 'b', hex: '#000000' }])).toThrow(/duplicate key/);
    expect(bad([{ key: 'a', name: 'none', hex: '#000000' }])).toThrow(PaletteError);
    expect(bad([{ key: 'a', name: 'a', hex: '#000000' }], { r: ['zz'] })).toThrow(/unknown entry 'zz'/);
  });

  it('hands out 256 distinct keys, none reserved', () => {
    const k = autoKeys(256);
    expect(new Set(k).size).toBe(256);
    for (const c of ['.', ' ', '|']) expect(k).not.toContain(c);
  });
});
