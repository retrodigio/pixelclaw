import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { Pcg32, crc32, createRgba, deflate, encodePng } from '../src/index.ts';
import { decodePng } from './helpers.ts';

describe('deflate', () => {
  it('round-trips through zlib for repetitive, random and empty input', () => {
    const r = new Pcg32(5);
    const inputs = [
      new Uint8Array(0),
      new Uint8Array(100000).fill(7),
      Uint8Array.from({ length: 70000 }, () => r.nextInt(256)),
      Uint8Array.from({ length: 50000 }, (_, i) => (i % 97) ^ ((i >> 9) & 3)),
    ];
    for (const inp of inputs) expect(Buffer.compare(inflateRawSync(deflate(inp)), Buffer.from(inp))).toBe(0);
  });

  it('compresses runs well', () => {
    expect(deflate(new Uint8Array(100000)).length).toBeLessThan(1000);
  });
});

describe('PNG encoder', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(Uint8Array.from('123456789', (c) => c.charCodeAt(0)))).toBe(0xcbf43926);
  });

  it('writes an indexed PNG (with tRNS) for few colours, and it decodes to the same pixels', () => {
    const img = createRgba(5, 3);
    for (let i = 0; i < 15; i++) img.data.set(i % 3 === 0 ? [0, 0, 0, 0] : i % 3 === 1 ? [255, 0, 0, 255] : [10, 20, 30, 255], i * 4);
    const png = encodePng(img);
    const d = decodePng(png);
    expect(d.colourType).toBe(3);
    expect([d.width, d.height]).toEqual([5, 3]);
    expect(Buffer.compare(Buffer.from(d.rgba), Buffer.from(img.data))).toBe(0);
  });

  it('writes truecolour RGBA for more than 256 colours, with filters that decode correctly', () => {
    const img = createRgba(40, 30);
    for (let y = 0; y < 30; y++) for (let x = 0; x < 40; x++) img.data.set([x * 6, y * 8, (x * y) & 255, 200 + (x % 50)], (y * 40 + x) * 4);
    const d = decodePng(encodePng(img));
    expect(d.colourType).toBe(6);
    expect(Buffer.compare(Buffer.from(d.rgba), Buffer.from(img.data))).toBe(0);
  });

  it('is deterministic', () => {
    const img = createRgba(16, 16, 0x336699ff);
    expect(Buffer.compare(Buffer.from(encodePng(img)), Buffer.from(encodePng(img)))).toBe(0);
  });
});
