// Glyph sheets: a font document is a grid of cells, one per code point. This module
// reads glyphs out of the sheet (each drawn from its cell's left edge), works out advances and
// metrics, and writes the two export formats:
//
// - The glyph strip: one row of glyphs, as tall as a cell, each glyph its advance wide, with a
//   separator column before the first glyph, between every two and after the last. The separator
//   colour is whatever the top-left pixel is (default #ff0000), every pixel of a separator column
//   is that colour and no glyph pixel is; everything else not drawn is transparent. A reader takes
//   the top-left pixel's colour and splits the strip at the columns of that colour; the glyphs are
//   the code points in the sheet's order (written beside the strip as UTF-8 text).
// - BMFont (the AngelCode text format): a `.fnt` file of `info`, `common`, `page`, `chars` and one
//   `char` line per glyph (its ink box on the page, the offsets from the cell's top-left, the
//   advance plus spacing), and one page PNG of the ink boxes packed in rows with a pixel between.

import { TRANSPARENT, flatten, type Doc, type FontState } from './doc.ts';
import { rgbOf } from './palette.ts';
import { createRgba, type Rgba } from './png.ts';

export const STRIP_SEPARATOR = '#ff0000';

/** A code point as the tape writes it: letters and digits as themselves, anything else as U+XXXX. */
export function charText(cp: number): string {
  const s = String.fromCodePoint(cp);
  return /^[A-Za-z0-9]$/.test(s) ? s : `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** Code points as ranges: "32-126,160". */
export function charsText(chars: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < chars.length;) {
    let j = i;
    while (j + 1 < chars.length && chars[j + 1] === chars[j]! + 1) j++;
    out.push(j > i ? `${chars[i]}-${chars[j]}` : String(chars[i]));
    i = j + 1;
  }
  return out.join(',');
}

/**
 * Parse a chars= value: comma-separated code points (decimal or U+hex) and ranges a-b of them; or,
 * quoted, the characters of the text themselves. Returns an error message when it is not one.
 */
export function parseChars(v: string, quoted: boolean): number[] | string {
  if (quoted) {
    const cps = [...v].map((c) => c.codePointAt(0)!);
    return cps.length ? cps : 'chars= is empty';
  }
  const one = (s: string): number | null => {
    if (/^\d+$/.test(s)) return Number(s);
    const m = /^U\+([0-9A-Fa-f]{1,6})$/.exec(s);
    return m ? parseInt(m[1]!, 16) : null;
  };
  const out: number[] = [];
  for (const part of v.split(',')) {
    const r = /^([^-]+)-([^-]+)$/.exec(part);
    const a = one(r ? r[1]! : part), b = r ? one(r[2]!) : a;
    if (a === null || b === null || b < a || b > 0x10ffff) return `chars=: '${part}' is not a code point or a range a-b (decimal or U+hex)`;
    for (let c = a; c <= b; c++) out.push(c);
  }
  if (new Set(out).size !== out.length) return 'chars=: a code point is listed twice';
  if (out.length > 4096) return 'chars=: at most 4096 glyphs';
  return out;
}

/** The cell of the glyph at position i (in chars order). */
export function glyphCell(d: Doc, i: number): [number, number] {
  const cols = d.font!.cols;
  return [(i % cols) * d.cellW, Math.floor(i / cols) * d.cellH];
}

/** The glyph's flat pixels (cellW x cellH). */
export function glyphPixels(d: Doc, i: number, frame = 0, flat?: Uint16Array): Uint16Array {
  const px = flat ?? flatten(d, frame);
  const [x0, y0] = glyphCell(d, i);
  const out = new Uint16Array(d.cellW * d.cellH);
  for (let y = 0; y < d.cellH; y++) for (let x = 0; x < d.cellW; x++) out[y * d.cellW + x] = px[(y0 + y) * d.width + x0 + x]!;
  return out;
}

/** The drawn pixels' box [x0, y0, x1, y1] (inclusive), or null when nothing is drawn. */
export function inkBox(px: Uint16Array, w: number, h: number): [number, number, number, number] | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (px[y * w + x] === TRANSPARENT) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : [x0, y0, x1, y1];
}

/** A glyph's advance: its own, else its ink width (the rightmost drawn column + 1), else half a cell. */
export function advanceOf(d: Doc, i: number, flat?: Uint16Array): number {
  const f = d.font!;
  const cp = f.chars[i]!;
  if (f.advances[cp] !== undefined) return f.advances[cp]!;
  const box = inkBox(glyphPixels(d, i, 0, flat), d.cellW, d.cellH);
  return box ? box[2] + 1 : Math.ceil(d.cellW / 2);
}

export interface GlyphInfo {
  cp: number;
  cell: [number, number];
  advance: number;
  box: [number, number, number, number] | null;
}

export function glyphs(d: Doc): GlyphInfo[] {
  const flat = flatten(d, 0);
  return d.font!.chars.map((cp, i) => ({ cp, cell: glyphCell(d, i), advance: advanceOf(d, i, flat), box: inkBox(glyphPixels(d, i, 0, flat), d.cellW, d.cellH) }));
}

export class FontExportError extends Error {}

/** The glyph strip (see the top of this file), with each glyph's colours through `colours`. */
export function fontStrip(d: Doc, colours: string[], separator = STRIP_SEPARATOR): { img: Rgba; chars: string } {
  if (!d.font) throw new FontExportError(`'${d.name}' is not a font`);
  const sep = rgbOf(separator);
  const rgb = colours.map(rgbOf);
  const gs = glyphs(d);
  const flat = flatten(d, 0);
  const W = 1 + gs.reduce((s, g) => s + g.advance + 1, 0), H = d.cellH;
  const img = createRgba(W, H);
  const column = (x: number) => { for (let y = 0; y < H; y++) img.data.set([sep[0], sep[1], sep[2], 255], (y * W + x) * 4); };
  column(0);
  let x = 1;
  gs.forEach((g, i) => {
    const px = glyphPixels(d, i, 0, flat);
    for (let y = 0; y < H; y++) for (let gx = 0; gx < Math.min(g.advance, d.cellW); gx++) {
      const v = px[y * d.cellW + gx]!;
      if (v === TRANSPARENT) continue;
      const c = rgb[v]!;
      if (c[0] === sep[0] && c[1] === sep[1] && c[2] === sep[2]) throw new FontExportError(`${d.name}: glyph ${charText(g.cp)} uses the separator colour ${separator} at ${g.cell[0] + gx},${g.cell[1] + y}`);
      img.data.set([c[0], c[1], c[2], 255], (y * W + x + gx) * 4);
    }
    x += g.advance;
    column(x);
    x++;
  });
  return { img, chars: d.font.chars.map((c) => String.fromCodePoint(c)).join('') };
}

/** Read a glyph strip back: the separator colour (the top-left pixel) and each glyph's columns [from, to). */
export function readStrip(img: Rgba): { separator: string; glyphs: [number, number][] } {
  const at = (x: number, y: number) => img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4);
  const s = at(0, 0);
  const isSep = (x: number) => { const p = at(x, 0); return p[3] === 255 && p[0] === s[0] && p[1] === s[1] && p[2] === s[2]; };
  const out: [number, number][] = [];
  let start = -1;
  for (let x = 0; x < img.width; x++) {
    if (isSep(x)) { if (start >= 0) out.push([start, x]); start = x + 1; }
  }
  const hex = '#' + [s[0]!, s[1]!, s[2]!].map((v) => v.toString(16).padStart(2, '0')).join('');
  return { separator: hex, glyphs: out };
}

/** BMFont text and its page (see the top of this file). `page` is the page file's name. */
export function fontBmfont(d: Doc, colours: string[], page: string, width = 256): { fnt: string; img: Rgba } {
  if (!d.font) throw new FontExportError(`'${d.name}' is not a font`);
  const f: FontState = d.font;
  const rgb = colours.map(rgbOf);
  const gs = glyphs(d);
  const flat = flatten(d, 0);
  // Shelf packing of the ink boxes, a pixel apart.
  const pos: ([number, number] | null)[] = [];
  let x = 0, y = 0, rowH = 0, W = 0;
  for (const g of gs) {
    if (!g.box) { pos.push(null); continue; }
    const w = g.box[2] - g.box[0] + 1, h = g.box[3] - g.box[1] + 1;
    if (x > 0 && x + w > width) { x = 0; y += rowH + 1; rowH = 0; }
    pos.push([x, y]);
    x += w + 1; rowH = Math.max(rowH, h); W = Math.max(W, x - 1);
  }
  const H = y + rowH;
  const pw = Math.max(1, W), ph = Math.max(1, H);
  const img = createRgba(pw, ph);
  const lines = [
    `info face="${d.name}" size=${d.cellH} bold=0 italic=0 charset="" unicode=1 stretchH=100 smooth=0 aa=1 padding=0,0,0,0 spacing=1,1 outline=0`,
    `common lineHeight=${f.line} base=${f.baseline + 1} scaleW=${pw} scaleH=${ph} pages=1 packed=0 alphaChnl=0 redChnl=0 greenChnl=0 blueChnl=0`,
    `page id=0 file="${page}"`,
    `chars count=${gs.length}`,
  ];
  gs.forEach((g, i) => {
    const p = pos[i];
    if (!p || !g.box) {
      lines.push(`char id=${g.cp} x=0 y=0 width=0 height=0 xoffset=0 yoffset=0 xadvance=${g.advance + f.spacing} page=0 chnl=15`);
      return;
    }
    const [bx0, by0, bx1, by1] = g.box;
    const px = glyphPixels(d, i, 0, flat);
    for (let yy = by0; yy <= by1; yy++) for (let xx = bx0; xx <= bx1; xx++) {
      const v = px[yy * d.cellW + xx]!;
      if (v === TRANSPARENT) continue;
      const c = rgb[v]!;
      img.data.set([c[0], c[1], c[2], 255], ((p[1] + yy - by0) * pw + p[0] + xx - bx0) * 4);
    }
    lines.push(`char id=${g.cp} x=${p[0]} y=${p[1]} width=${bx1 - bx0 + 1} height=${by1 - by0 + 1} xoffset=${bx0} yoffset=${by0} xadvance=${g.advance + f.spacing} page=0 chnl=15`);
  });
  lines.push('kernings count=0');
  return { fnt: lines.join('\n') + '\n', img };
}

/** Text set in the font (for previews): each glyph its advance plus spacing; unknown characters as blanks. */
export function setText(d: Doc, text: string, colours: string[]): Rgba {
  const f = d.font!;
  const gs = glyphs(d);
  const flat = flatten(d, 0);
  const index = new Map(f.chars.map((c, i) => [c, i]));
  const lines = text.split('\n');
  const widthOf = (s: string) => [...s].reduce((w, ch) => { const i = index.get(ch.codePointAt(0)!); return w + (i === undefined ? Math.ceil(d.cellW / 2) : gs[i]!.advance) + f.spacing; }, 0);
  const W = Math.max(1, ...lines.map(widthOf));
  const H = Math.max(1, (lines.length - 1) * f.line + d.cellH);
  const img = createRgba(W, H);
  const rgb = colours.map(rgbOf);
  lines.forEach((s, li) => {
    let x = 0;
    for (const ch of s) {
      const i = index.get(ch.codePointAt(0)!);
      if (i === undefined) { x += Math.ceil(d.cellW / 2) + f.spacing; continue; }
      const px = glyphPixels(d, i, 0, flat);
      for (let y = 0; y < d.cellH; y++) for (let gx = 0; gx < d.cellW; gx++) {
        const v = px[y * d.cellW + gx]!;
        if (v === TRANSPARENT || x + gx >= W) continue;
        const c = rgb[v]!;
        img.data.set([c[0], c[1], c[2], 255], ((li * f.line + y) * W + x + gx) * 4);
      }
      x += gs[i]!.advance + f.spacing;
    }
  });
  return img;
}
