// An animated GIF encoder (GIF89a, LZW, one global colour table, looping forever). Frames are RGBA
// images of one size; their colours (at most 256 across all frames) make the table in the order
// they first appear, so the output is a pure function of the frames.

import type { Rgba } from './png.ts';

export interface GifFrame {
  img: Rgba;
  /** How long the frame shows, in hundredths of a second (at least 1). */
  delay: number;
}

class Bytes {
  private buf = new Uint8Array(1024);
  length = 0;
  push(...bs: number[]): void {
    for (const b of bs) {
      if (this.length === this.buf.length) { const n = new Uint8Array(this.buf.length * 2); n.set(this.buf); this.buf = n; }
      this.buf[this.length++] = b & 255;
    }
  }
  u16(v: number): void { this.push(v & 255, v >> 8); }
  ascii(s: string): void { for (const ch of s) this.push(ch.charCodeAt(0)); }
  done(): Uint8Array { return this.buf.slice(0, this.length); }
}

/** LZW-compress palette indices as GIF image data: the minimum code size, then sub-blocks. */
function lzw(out: Bytes, indices: Uint8Array, minSize: number): void {
  out.push(minSize);
  const clear = 1 << minSize;
  const eoi = clear + 1;
  let size = minSize + 1;
  let next = eoi + 1;
  let table = new Map<number, number>();
  let acc = 0;
  let bits = 0;
  let block: number[] = [];
  const flushBlock = () => { if (block.length) { out.push(block.length, ...block); block = []; } };
  const emit = (code: number) => {
    acc |= code << bits;
    bits += size;
    while (bits >= 8) {
      block.push(acc & 255);
      if (block.length === 255) flushBlock();
      acc >>>= 8;
      bits -= 8;
    }
  };
  emit(clear);
  let prefix = indices[0]!;
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i]!;
    const key = (prefix << 8) | k;
    const hit = table.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      table = new Map();
      next = eoi + 1;
      size = minSize + 1;
    } else {
      // The decoder grows its code size one code later than the encoder adds the entry.
      if (next >= 1 << size) size++;
      table.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) { block.push(acc & 255); if (block.length === 255) flushBlock(); }
  flushBlock();
  out.push(0);
}

/** Encode frames as a looping animated GIF. */
export function encodeGif(frames: GifFrame[]): Uint8Array {
  if (!frames.length) throw new Error('encodeGif: no frames');
  const { width, height } = frames[0]!.img;
  const colours: number[] = [];
  const index = new Map<number, number>();
  const indexed = frames.map(({ img }) => {
    if (img.width !== width || img.height !== height) throw new Error('encodeGif: frames differ in size');
    const out = new Uint8Array(width * height);
    for (let i = 0; i < out.length; i++) {
      const rgb = (img.data[i * 4]! << 16) | (img.data[i * 4 + 1]! << 8) | img.data[i * 4 + 2]!;
      let k = index.get(rgb);
      if (k === undefined) {
        if (colours.length === 256) throw new Error('encodeGif: more than 256 colours');
        index.set(rgb, (k = colours.length));
        colours.push(rgb);
      }
      out[i] = k;
    }
    return out;
  });
  let bitsPer = 1;
  while (1 << bitsPer < colours.length) bitsPer++;
  const out = new Bytes();
  out.ascii('GIF89a');
  out.u16(width);
  out.u16(height);
  out.push(0x80 | ((bitsPer - 1) << 4) | (bitsPer - 1), 0, 0);
  for (let i = 0; i < 1 << bitsPer; i++) {
    const c = colours[i] ?? 0;
    out.push(c >> 16, c >> 8, c);
  }
  // Loop forever (the NETSCAPE2.0 application extension).
  out.push(0x21, 0xff, 11);
  out.ascii('NETSCAPE2.0');
  out.push(3, 1, 0, 0, 0);
  frames.forEach((f, n) => {
    out.push(0x21, 0xf9, 4, 0);
    out.u16(Math.max(1, Math.min(65535, Math.round(f.delay))));
    out.push(0, 0);
    out.push(0x2c);
    out.u16(0); out.u16(0); out.u16(width); out.u16(height);
    out.push(0);
    lzw(out, indexed[n]!, Math.max(2, bitsPer));
  });
  out.push(0x3b);
  return out.done();
}
