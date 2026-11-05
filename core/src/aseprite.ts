// `.aseprite` files: read and write, so people can round-trip
// with Aseprite. Written files are indexed (8 bits a pixel): file index 0 is transparent and palette
// entry i is file index i + 1, so a palette may have 255 entries. Layers bottom to top as here
// (hidden, reference), every frame's duration (ticks at the project's tick rate, as milliseconds),
// linked cels, tags (forward or ping-pong), and views as tags named `view S` or `view W mirror E`.
// Read: indexed, RGBA and greyscale files; group and tilemap layers are skipped.
// Format: https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md

import { TRANSPARENT, flatten, utf8, utf8Decode, type Doc, type Loop, type Tag, type View } from './doc.ts';
import { DecodeError, inflate } from './decode.ts';
import { rgbOf } from './palette.ts';
import { zlibCompress } from './png.ts';

export interface AseLayer {
  name: string;
  visible: boolean;
  reference: boolean;
  /** 0 normal, 1 group, 2 tilemap. */
  type: number;
}

export interface AseCel {
  layer: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Indexed files: indices (the transparent index as TRANSPARENT); others: RGBA bytes. */
  px: Uint16Array | Uint8Array;
  /** A linked cel: the frame whose cel it shares. */
  link?: number;
}

export interface AseFile {
  width: number;
  height: number;
  /** 8 indexed, 16 greyscale, 32 RGBA. */
  depth: 8 | 16 | 32;
  transparent: number;
  /** RGBA per palette index (indexed files). */
  palette: { r: number; g: number; b: number; a: number; name?: string }[];
  layers: AseLayer[];
  frames: { ms: number; cels: AseCel[] }[];
  tags: { name: string; from: number; to: number; dir: number }[];
}

class Out {
  private buf = new Uint8Array(4096);
  n = 0;
  private room(k: number) {
    if (this.n + k <= this.buf.length) return;
    let m = this.buf.length * 2;
    while (m < this.n + k) m *= 2;
    const b = new Uint8Array(m); b.set(this.buf.subarray(0, this.n)); this.buf = b;
  }
  u8(v: number) { this.room(1); this.buf[this.n++] = v & 255; }
  u16(v: number) { this.u8(v); this.u8(v >> 8); }
  u32(v: number) { this.u16(v & 0xffff); this.u16((v >>> 16) & 0xffff); }
  zeros(k: number) { for (let i = 0; i < k; i++) this.u8(0); }
  bytes(b: Uint8Array) { this.room(b.length); this.buf.set(b, this.n); this.n += b.length; }
  str(s: string) { const b = utf8(s); this.u16(b.length); this.bytes(b); }
  setU32(at: number, v: number) { this.buf[at] = v & 255; this.buf[at + 1] = (v >> 8) & 255; this.buf[at + 2] = (v >> 16) & 255; this.buf[at + 3] = (v >>> 24) & 255; }
  setU16(at: number, v: number) { this.buf[at] = v & 255; this.buf[at + 1] = (v >> 8) & 255; }
  done() { return this.buf.slice(0, this.n); }
}

/** Ticks to milliseconds and back at a tick rate (rounded, so 10 ticks at 60/s is 167 ms and back to 10). */
export const ticksToMs = (t: number, rate: number) => Math.max(1, Math.round((t * 1000) / rate));
export const msToTicks = (ms: number, rate: number) => Math.max(1, Math.round((ms * rate) / 1000));

/** A document as an `.aseprite` file (its palette at most 255 entries). */
export function writeAseprite(d: Doc, tickRate = 60, colours?: string[]): Uint8Array {
  if (d.palette.entries.length > 255) throw new Error(`an .aseprite file holds 255 colours besides transparent; '${d.palette.name}' has ${d.palette.entries.length}`);
  const o = new Out();
  o.u32(0); o.u16(0xa5e0); o.u16(d.frameCount); o.u16(d.width); o.u16(d.height); o.u16(8);
  o.u32(1); o.u16(100); o.u32(0); o.u32(0);
  o.u8(0); o.zeros(3); o.u16(d.palette.entries.length + 1); o.u8(1); o.u8(1);
  o.u16(0); o.u16(0); o.u16(d.cellW); o.u16(d.cellH); o.zeros(84);
  const chunk = (type: number, body: (x: Out) => void) => {
    const at = o.n;
    o.u32(0); o.u16(type); body(o);
    o.setU32(at, o.n - at);
  };
  const tagList: { name: string; from: number; to: number; dir: number }[] = [
    ...d.tags.map((t) => ({ name: t.name, from: t.from, to: t.to, dir: t.loop === 'pingpong' ? 2 : 0 })),
    ...d.views.map((v) => ({ name: v.mirror ? `view ${v.name} mirror ${v.mirror}` : `view ${v.name}`, from: v.from, to: v.to, dir: 0 })),
  ];
  for (let f = 0; f < d.frameCount; f++) {
    const fstart = o.n;
    o.u32(0); o.u16(0xf1fa); o.u16(0); o.u16(ticksToMs(d.ticks[f]!, tickRate)); o.zeros(2); o.u32(0);
    let chunks = 0;
    if (f === 0) {
      chunk(0x2007, (x) => { x.u16(1); x.u16(0); x.u32(0); x.zeros(8); }); chunks++;
      const n = d.palette.entries.length + 1;
      chunk(0x2019, (x) => {
        x.u32(n); x.u32(0); x.u32(n - 1); x.zeros(8);
        x.u16(0); x.u8(0); x.u8(0); x.u8(0); x.u8(0);
        for (const [i, e] of d.palette.entries.entries()) { const [r, g, b] = rgbOf(colours?.[i] ?? e.hex); x.u16(1); x.u8(r); x.u8(g); x.u8(b); x.u8(255); x.str(e.name); }
      });
      chunks++;
      for (const l of d.layers) {
        chunk(0x2004, (x) => {
          x.u16((l.hidden ? 0 : 1) | 2 | (l.reference ? 64 : 0)); x.u16(0); x.u16(0); x.u16(0); x.u16(0); x.u16(0); x.u8(255); x.zeros(3); x.str(l.name);
        });
        chunks++;
      }
      if (tagList.length) {
        chunk(0x2018, (x) => {
          x.u16(tagList.length); x.zeros(8);
          for (const t of tagList) { x.u16(t.from); x.u16(t.to); x.u8(t.dir); x.u16(0); x.zeros(6); x.zeros(3); x.u8(0); x.str(t.name); }
        });
        chunks++;
      }
    }
    d.layers.forEach((_, li) => {
      const cels = d.cels[li]!;
      const cel = cels[f]!;
      const first = cels.indexOf(cel);
      if (first !== f) { chunk(0x2005, (x) => { x.u16(li); x.u16(0); x.u16(0); x.u8(255); x.u16(1); x.u16(0); x.zeros(5); x.u16(first); }); chunks++; return; }
      if (cel.every((v) => v === TRANSPARENT)) return;
      const raw = new Uint8Array(d.width * d.height);
      for (let i = 0; i < raw.length; i++) raw[i] = cel[i] === TRANSPARENT ? 0 : cel[i]! + 1;
      chunk(0x2005, (x) => { x.u16(li); x.u16(0); x.u16(0); x.u8(255); x.u16(2); x.u16(0); x.zeros(5); x.u16(d.width); x.u16(d.height); x.bytes(zlibCompress(raw)); });
      chunks++;
    });
    o.setU32(fstart, o.n - fstart);
    o.setU16(fstart + 6, Math.min(chunks, 0xffff));
    o.setU32(fstart + 12, chunks);
  }
  o.setU32(0, o.n);
  return o.done();
}

/** Read an `.aseprite` (or `.ase`) file. */
export function readAseprite(b: Uint8Array): AseFile {
  if (b.length < 128) throw new DecodeError('not an .aseprite file (too short)');
  let p = 0;
  const u8 = () => b[p++]!;
  const u16 = () => { const v = b[p]! | (b[p + 1]! << 8); p += 2; return v; };
  const s16 = () => { const v = u16(); return v >= 0x8000 ? v - 0x10000 : v; };
  const u32 = () => { const v = (b[p]! | (b[p + 1]! << 8) | (b[p + 2]! << 16) | (b[p + 3]! << 24)) >>> 0; p += 4; return v; };
  const str = () => { const n = u16(); const s = utf8Decode(b.subarray(p, p + n)); p += n; return s; };
  u32();
  if (u16() !== 0xa5e0) throw new DecodeError('not an .aseprite file (bad magic number)');
  const nframes = u16(), width = u16(), height = u16(), depth = u16();
  if (depth !== 8 && depth !== 16 && depth !== 32) throw new DecodeError(`colour depth ${depth} is not known`);
  p = 28;
  const transparent = u8();
  p = 128;
  const file: AseFile = { width, height, depth: depth as 8 | 16 | 32, transparent, palette: [], layers: [], frames: [], tags: [] };
  const bpp = depth / 8;
  for (let f = 0; f < nframes; f++) {
    const fstart = p;
    const fsize = u32();
    if (u16() !== 0xf1fa) throw new DecodeError(`frame ${f + 1}: bad frame magic number`);
    const old = u16();
    const ms = u16();
    p += 2;
    const nnew = u32();
    const nchunks = nnew || old;
    const frame = { ms, cels: [] as AseCel[] };
    for (let c = 0; c < nchunks; c++) {
      const cstart = p;
      const csize = u32();
      const type = u16();
      if (type === 0x2004) {
        const lf = u16(), lt = u16();
        u16(); u16(); u16(); u16(); u8(); p += 3;
        const name = str();
        file.layers.push({ name, visible: !!(lf & 1), reference: !!(lf & 64), type: lt });
        if (lt === 2) u32();
      } else if (type === 0x2005) {
        const layer = u16(), x = s16(), y = s16();
        u8();
        const ct = u16();
        s16(); p += 5;
        if (ct === 1) frame.cels.push({ layer, x, y, w: 0, h: 0, px: new Uint16Array(0), link: u16() });
        else if (ct === 0 || ct === 2) {
          const w = u16(), h = u16();
          const data = ct === 0 ? b.subarray(p, p + w * h * bpp) : inflate(b.subarray(p, cstart + csize));
          if (data.length < w * h * bpp) throw new DecodeError(`frame ${f + 1}: a cel's pixels are cut short`);
          let px: Uint16Array | Uint8Array;
          if (depth === 8) {
            px = new Uint16Array(w * h);
            for (let i = 0; i < w * h; i++) px[i] = data[i] === transparent ? TRANSPARENT : data[i]!;
          } else if (depth === 16) {
            px = new Uint8Array(w * h * 4);
            for (let i = 0; i < w * h; i++) { const v = data[i * 2]!; px[i * 4] = v; px[i * 4 + 1] = v; px[i * 4 + 2] = v; px[i * 4 + 3] = data[i * 2 + 1]!; }
          } else px = data.slice(0, w * h * 4);
          frame.cels.push({ layer, x, y, w, h, px });
        }
      } else if (type === 0x2019) {
        const size = u32(), first = u32(), last = u32();
        p += 8;
        while (file.palette.length < size) file.palette.push({ r: 0, g: 0, b: 0, a: 255 });
        for (let i = first; i <= last; i++) {
          const ef = u16();
          const e: AseFile['palette'][number] = { r: u8(), g: u8(), b: u8(), a: u8() };
          if (ef & 1) e.name = str();
          file.palette[i] = e;
        }
      } else if ((type === 0x0004 || type === 0x0011) && !file.palette.length) {
        const packets = u16();
        let i = 0;
        for (let k = 0; k < packets; k++) {
          i += u8();
          let n = u8();
          if (n === 0) n = 256;
          for (let j = 0; j < n; j++, i++) {
            const m = type === 0x0011 ? 4 : 1;
            file.palette[i] = { r: Math.min(255, u8() * m), g: Math.min(255, u8() * m), b: Math.min(255, u8() * m), a: 255 };
          }
        }
      } else if (type === 0x2018) {
        const n = u16();
        p += 8;
        for (let k = 0; k < n; k++) {
          const from = u16(), to = u16(), dir = u8();
          p += 2 + 6 + 3 + 1;
          file.tags.push({ name: str(), from, to, dir });
        }
      }
      p = cstart + csize;
    }
    file.frames.push(frame);
    p = fstart + fsize;
  }
  return file;
}

/** What an `.aseprite` file holds, as a document's parts: layers × frames of full-canvas cels (RGBA or indices). */
export interface AseDocParts {
  width: number;
  height: number;
  cell: [number, number] | null;
  layers: { name: string; hidden: boolean; reference: boolean }[];
  /** cels[layer][frame]: RGBA bytes (width*height*4); null when empty. */
  rgba: (Uint8Array | null)[][];
  /** Indexed files: cels as file indices (TRANSPARENT where empty). */
  indices: (Uint16Array | null)[][] | null;
  links: [number, number, number][];
  ms: number[];
  tags: Tag[];
  views: View[];
}

/** Lay an `.aseprite` file's cels out on full canvases, normal layers only. */
export function aseParts(a: AseFile): AseDocParts {
  const keep = a.layers.flatMap((l, i) => (l.type === 0 ? [i] : []));
  const W = a.width, H = a.height;
  const rgba: (Uint8Array | null)[][] = keep.map(() => a.frames.map(() => null));
  const indices = a.depth === 8 ? keep.map(() => a.frames.map((): Uint16Array | null => null)) : null;
  const links: [number, number, number][] = [];
  a.frames.forEach((fr, f) => {
    for (const c of fr.cels) {
      const li = keep.indexOf(c.layer);
      if (li < 0) continue;
      if (c.link !== undefined) { links.push([li, f, c.link]); continue; }
      const out = new Uint8Array(W * H * 4);
      const idx = indices ? new Uint16Array(W * H).fill(TRANSPARENT) : null;
      for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
        const X = c.x + x, Y = c.y + y;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const k = Y * W + X;
        if (a.depth === 8) {
          const v = (c.px as Uint16Array)[y * c.w + x]!;
          if (v === TRANSPARENT || v === a.transparent) continue;
          idx![k] = v;
          const e = a.palette[v] ?? { r: 0, g: 0, b: 0, a: 255 };
          out[k * 4] = e.r; out[k * 4 + 1] = e.g; out[k * 4 + 2] = e.b; out[k * 4 + 3] = e.a;
        } else out.set((c.px as Uint8Array).subarray((y * c.w + x) * 4, (y * c.w + x) * 4 + 4), k * 4);
      }
      rgba[li]![f] = out;
      if (indices) indices[li]![f] = idx;
    }
  });
  for (const [l, f, g] of links) { rgba[l]![f] = rgba[l]![g] ?? null; if (indices) indices[l]![f] = indices[l]![g] ?? null; }
  const tags: Tag[] = [];
  const views: View[] = [];
  for (const t of a.tags) {
    const m = /^view (\S+)(?: mirror (\S+))?$/.exec(t.name);
    if (m) views.push({ name: m[1]!, from: t.from, to: t.to, mirror: m[2] ?? null });
    else tags.push({ name: t.name.replace(/[^A-Za-z0-9_-]/g, '_') || 'tag', from: t.from, to: t.to, loop: (t.dir === 2 || t.dir === 3 ? 'pingpong' : 'cycle') as Loop });
  }
  return {
    width: W, height: H, cell: null, layers: keep.map((i) => ({ name: a.layers[i]!.name, hidden: !a.layers[i]!.visible, reference: a.layers[i]!.reference })),
    rgba, indices, links, ms: a.frames.map((f) => f.ms), tags, views,
  };
}

/** The flat art of every frame of a document (for comparing a round trip). */
export function flatFrames(d: Doc): Uint16Array[] {
  return Array.from({ length: d.frameCount }, (_, f) => flatten(d, f));
}
