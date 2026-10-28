// G6 renders: the GIF encoder (decoded back by a small reader here), the `anim` contact sheet and
// GIF goldens, and their timing at the game's tick rate.
import { describe, expect, it } from 'vitest';
import { animGifFrames, animText, createRgba, encodeGif, encodePng, renderAnimSheet, type Doc, type Rgba } from '../src/index.ts';
import { EMPTY, golden, run } from './helpers.ts';

const doc = (text: string): Doc => run(EMPTY, text).doc!;

/** A minimal GIF reader for tests: the global table, each frame's delay and RGB pixels. */
function decodeGif(b: Uint8Array): { width: number; height: number; frames: { delay: number; rgb: number[] }[]; loops: boolean } {
  expect(String.fromCharCode(...b.subarray(0, 6))).toBe('GIF89a');
  const width = b[6]! | (b[7]! << 8), height = b[8]! | (b[9]! << 8);
  const size = 2 << (b[10]! & 7);
  const table = b.subarray(13, 13 + size * 3);
  let o = 13 + size * 3;
  const frames: { delay: number; rgb: number[] }[] = [];
  let delay = 0, loops = false;
  while (b[o] !== 0x3b) {
    if (b[o] === 0x21) {
      const label = b[o + 1]!;
      if (label === 0xf9) delay = b[o + 4]! | (b[o + 5]! << 8);
      if (label === 0xff) loops = String.fromCharCode(...b.subarray(o + 3, o + 14)) === 'NETSCAPE2.0';
      o += 2;
      while (b[o] !== 0) o += b[o]! + 1;
      o++;
      continue;
    }
    expect(b[o]).toBe(0x2c);
    const [fx, fy, fw] = [b[o + 1]! | (b[o + 2]! << 8), b[o + 3]! | (b[o + 4]! << 8), b[o + 5]! | (b[o + 6]! << 8)];
    o += 10;
    const min = b[o++]!;
    const data: number[] = [];
    while (b[o] !== 0) { data.push(...b.subarray(o + 1, o + 1 + b[o]!)); o += b[o]! + 1; }
    o++;
    // LZW decode.
    const clear = 1 << min, eoi = clear + 1;
    let sizeBits = min + 1, dict: number[][] = [], prev: number[] | null = null, bit = 0;
    const reset = () => { dict = Array.from({ length: eoi + 1 }, (_, i) => [i]); sizeBits = min + 1; prev = null; };
    reset();
    const out: number[] = [];
    for (;;) {
      let code = 0;
      for (let i = 0; i < sizeBits; i++, bit++) code |= ((data[bit >> 3]! >> (bit & 7)) & 1) << i;
      if (code === clear) { reset(); continue; }
      if (code === eoi) break;
      const entry: number[] = code < dict.length ? dict[code]! : [...prev!, prev![0]!];
      out.push(...entry);
      if (prev) dict.push([...prev, entry[0]!]);
      prev = entry;
      if (dict.length === 1 << sizeBits && sizeBits < 12) sizeBits++;
    }
    // A frame covers its box; the rest of the picture is the frame before (frames are left in place).
    const rgb = frames.length ? [...frames.at(-1)!.rgb] : new Array<number>(width * height).fill(0);
    out.forEach((k, i) => { rgb[(fy + Math.floor(i / fw)) * width + fx + (i % fw)] = (table[k * 3]! << 16) | (table[k * 3 + 1]! << 8) | table[k * 3 + 2]!; });
    frames.push({ delay, rgb });
  }
  return { width, height, frames, loops };
}

const rgbOfImg = (img: Rgba) => Array.from({ length: img.width * img.height }, (_, i) => (img.data[i * 4]! << 16) | (img.data[i * 4 + 1]! << 8) | img.data[i * 4 + 2]!);

describe('the GIF encoder', () => {
  it('with delta, writes only the changed box of each frame and decodes to the same pictures', () => {
    const imgs = [0, 1, 2].map((k) => {
      const img = createRgba(40, 30);
      for (let i = 0; i < 40 * 30; i++) img.data.set([i % 7 ? 30 : 90, 60, 90, 255], i * 4);
      if (k) for (let y = 5 + k; y < 9 + k; y++) for (let x = 10 * k; x < 10 * k + 3; x++) img.data.set([250, 250, 250, 255], (y * 40 + x) * 4);
      return { img, delay: 5 };
    });
    const full = encodeGif(imgs), delta = encodeGif(imgs, { delta: true });
    expect(delta.length).toBeLessThan(full.length);
    expect(decodeGif(delta).frames.map((f) => f.rgb)).toEqual(decodeGif(full).frames.map((f) => f.rgb));
    expect(decodeGif(delta).frames[2]!.rgb).toEqual(rgbOfImg(imgs[2]!.img));
  });

  it('round-trips frames, delays and the loop, including long runs that fill the code table', () => {
    const a = createRgba(70, 70);
    const b = createRgba(70, 70);
    let x = 12345;
    for (let i = 0; i < 70 * 70; i++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      a.data.set([(x >> 8) & 0xff, (x >> 4) & 0x7, 0, 255], i * 4); // many colours, little repetition
      b.data.set([i % 3 ? 10 : 200, 20, 30, 255], i * 4);
    }
    const a2 = createRgba(70, 70);
    for (let i = 0; i < 70 * 70; i++) a2.data.set([(a.data[i * 4]! & 0x0f) * 16, a.data[i * 4 + 1]!, 0, 255], i * 4);
    const g = decodeGif(encodeGif([{ img: a2, delay: 17 }, { img: b, delay: 3 }]));
    expect([g.width, g.height, g.loops]).toEqual([70, 70, true]);
    expect(g.frames.map((f) => f.delay)).toEqual([17, 3]);
    expect(g.frames[0]!.rgb).toEqual(rgbOfImg(a2));
    expect(g.frames[1]!.rgb).toEqual(rgbOfImg(b));
  });
});

// A 4-direction fixture: S and N drawn, E drawn, W a live mirror of E; 2 frames each.
const WALKER = `new sprite walker 8x8
frame add empty
frame add empty
frame add empty
frame add empty
frame add empty
view S frames=1-2
view N frames=3-4
view E frames=5-6
view W mirror=E
pivot 3,7
ground 7
frame 1
paint 2,1 <<
  .00.
  0110
  0110
  .00.
  0..0
  0..0
>>
frame 2
paint 2,1 <<
  .00.
  0110
  0110
  .00.
  .00.
  0..0
>>
frame 3
paint 2,1 <<
  .00.
  0000
  0000
  .00.
  0..0
  0..0
>>
frame 4
paint 2,1 <<
  .00.
  0000
  0000
  .00.
  .00.
  0..0
>>
frame 5
paint 2,1 <<
  .00.
  .0r1
  .011
  .00.
  .0.0
  0..0
>>
frame 6
paint 2,1 <<
  .00.
  .0r1
  .011
  .00.
  .00.
  .0.0
>>
frame set 1-6 ticks=12`;

const SHIMMER = `new tile water 6x6 bg=sky
frame add
frame add
frame add
frame 1
px 1,1 4,4 c=leaf
frame 2
px 2,1 5,4 c=leaf
frame 3
px 3,1 0,4 c=leaf
frame 4
px 4,1 1,4 c=leaf
frame set all ticks=8`;

describe('the anim view', () => {
  it('contact sheet goldens: a 4-direction walker (onion skin, pivot, ground line, diffs) and a 4-frame tile', () => {
    golden('g6/anim-walker.png', encodePng(renderAnimSheet(doc(WALKER))));
    golden('g6/anim-water.png', encodePng(renderAnimSheet(doc(SHIMMER))));
  });

  it('GIF goldens, decoded: the frames at the game\'s speed', () => {
    const w = doc(WALKER);
    const frames = animGifFrames(w, { tickRate: 60 });
    // 4 views side by side, each 2 frames of 12 ticks: 20 hundredths each at 60 ticks/s.
    expect(frames.map((f) => f.delay)).toEqual([20, 20]);
    const gif = encodeGif(frames);
    golden('g6/anim-walker.gif', gif);
    const g = decodeGif(gif);
    expect(g.frames.map((f) => f.rgb)).toEqual(frames.map((f) => rgbOfImg(f.img)));
    const t = animGifFrames(doc(SHIMMER), { tickRate: 60 });
    expect(t.map((f) => f.delay)).toEqual([13, 14, 13, 13]); // 8 ticks = 13.3 hundredths, rounded at each boundary
    golden('g6/anim-water.gif', encodeGif(t));
    // Sequences of different lengths share one loop: 3 and 2 frames of 10 ticks loop together every 60.
    const mixed = doc('new sprite m 4x4\nframe add\nframe add\nframe add\nframe add\ntag add a 1-3\ntag add b 4-5\nframe 1\npx 0,0 c=ink\nframe 4\npx 1,1 c=ink\nframe 5\npx 2,2 c=ink');
    expect(animGifFrames(mixed).reduce((n, f) => n + f.delay, 0)).toBe(100);
  });

  it('the text names each sequence, its ticks, loop time and changes', () => {
    expect(animText(doc(WALKER), { tickRate: 60 }).split('\n')).toEqual([
      'walker: 8 frames at 60 ticks/s; pivot 3,7; ground 7',
      '  S: cycle, frames 1,2, ticks 12,12 (a loop is 24 ticks, 400 ms); changed 1→2 22%, 2→1 22%',
      '  N: cycle, frames 3,4, ticks 12,12 (a loop is 24 ticks, 400 ms); changed 3→4 22%, 4→3 22%',
      '  E: cycle, frames 5,6, ticks 12,12 (a loop is 24 ticks, 400 ms); changed 5→6 25%, 6→5 25%',
      '  W: mirror of E, cycle, frames 7,8, ticks 12,12 (a loop is 24 ticks, 400 ms); changed 7→8 25%, 8→7 25%',
    ]);
  });
});
