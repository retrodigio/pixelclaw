// Underlays and snap as commands (plan §6). `underlay <layer> blob=<sha256> …` puts an image (a
// blob in the project: a generated mockup or an imported file) on a reference layer, stretched
// over a rectangle of the document; it is never part of the art. The server turns
// `underlay generate "<prompt>" …` and `underlay import <file>` into this form (after calling the
// provider or reading the file), so the tape only ever holds the blob's hash and where it was
// placed, with where it came from for the record. `snap` reads the underlay back into palette
// indices on a new draft layer (see snap.ts); its line records the result rows, so replay never
// needs the image.

import { Args, blockText, needDoc, fn, registerCommand, type CommandSpec } from './commands.ts';
import { TRANSPARENT, newLayer, remapCtx, type Doc, type Underlay } from './doc.ts';
import { DiagError, quote, type ParsedCommand } from './parser.ts';
import { snapImage } from './snap.ts';

const LAYER_RE = /^[a-z][a-z0-9_-]*$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const SIZE_RE = /^(\d+)x(\d+)$/;
const RECORD = ['from', 'prompt', 'provider', 'model', 'quality', 'cost'] as const;

/** Add a layer at index `at` with transparent cels; authors keep their layer. */
function insertLayer(d: Doc, at: number, name: string, o: Partial<Doc['layers'][number]>): void {
  d.layers.splice(at, 0, newLayer(name, o));
  d.cels.splice(at, 0, Array.from({ length: d.frameCount }, () => new Uint16Array(d.width * d.height).fill(TRANSPARENT)));
  remapCtx(d, (i) => (i >= at ? i + 1 : i), (f) => f);
}

function sizeOf(v: { value: string; line: number; vcol: number }, what: string): [number, number] {
  const m = SIZE_RE.exec(v.value);
  if (!m || Number(m[1]) < 1 || Number(m[2]) < 1 || Number(m[1]) > 16384 || Number(m[2]) > 16384) throw new DiagError(v.line, v.vcol, `${what} is a size like 1536x1024`);
  return [Number(m[1]), Number(m[2])];
}

function pointOf(v: { value: string; line: number; vcol: number }): [number, number] {
  const m = /^(-?\d+),(-?\d+)$/.exec(v.value);
  if (!m) throw new DiagError(v.line, v.vcol, `at= is a point x,y`);
  return [Number(m[1]), Number(m[2])];
}

function serverOnly(cmd: ParsedCommand, what: string): never {
  throw new DiagError(cmd.line, cmd.col, `underlay ${what} runs through the server (the MCP run tool, the watch view or pixelclaw run), which writes the image into blobs/ and this line as underlay <layer> blob=…`);
}

const underlayCmd: CommandSpec = {
  name: 'underlay',
  summary: 'underlay generate "<prompt>" [layer=<name>] [layout=<template.png|layer>] [size=<W>x<H>] [provider=openai|fake] [model=] [quality=] [cap=<usd>] | underlay import <file.png> [layer=<name>] [layout=<template.png|layer>] | underlay <layer> blob=<sha256> image=<W>x<H> [at=<x,y>] [size=<W>x<H>] [layout=<sha256>]   (an image under the art on a reference layer, never exported; the first two forms run through the server and are written as the third)',
  normalise(cmd, ctx) {
    const doc = needDoc(cmd, ctx);
    const first = cmd.args[0];
    if (first?.t === 'word' && first.v === 'generate') serverOnly(cmd, 'generate');
    if (first?.t === 'word' && first.v === 'import') serverOnly(cmd, 'import');
    const a = new Args(cmd, ['blob', 'image', 'at', 'size', 'layout', ...RECORD]);
    const name = a.take('word', 'a layer name (or generate / import)');
    a.done();
    if (!LAYER_RE.test(name.v)) throw new DiagError(name.line, name.col, `'${name.v}' is not a usable layer name`);
    if (doc.map) throw new DiagError(cmd.line, cmd.col, `underlay: a map shows its tiles; put the underlay on a sheet of the same size in pixels`);
    const blob = a.opts.get('blob');
    if (!blob) throw new DiagError(cmd.line, cmd.col, `underlay: give blob=<sha256> (or underlay generate / underlay import)`);
    if (!SHA_RE.test(blob.value)) throw new DiagError(blob.line, blob.vcol, `blob= is the image's sha256 (64 hex digits)`);
    const imgOpt = a.opts.get('image');
    let iw: number, ih: number;
    if (imgOpt) [iw, ih] = sizeOf(imgOpt, 'image=');
    else {
      const im = ctx.image?.(blob.value);
      if (!im) throw new DiagError(blob.line, blob.vcol, `underlay: give image=<W>x<H> (the blob's size); the image is not readable here`);
      iw = im.width; ih = im.height;
    }
    const [x, y] = a.opts.get('at') ? pointOf(a.opts.get('at')!) : [0, 0];
    const [w, h] = a.opts.get('size') ? sizeOf(a.opts.get('size')!, 'size=') : [doc.width, doc.height];
    const layout = a.opts.get('layout');
    if (layout && !SHA_RE.test(layout.value)) throw new DiagError(layout.line, layout.vcol, `layout= is the flat template's sha256 here (the server reads a file or layer and writes its hash)`);
    const i = doc.layers.findIndex((l) => l.name === name.v);
    if (i >= 0 && !doc.layers[i]!.reference) throw new DiagError(name.line, name.col, `layer '${name.v}' is an art layer; an underlay goes on a reference layer (a new name makes one)`);
    if (i >= 0 && doc.cels[i]!.some((c) => c.some((v) => v !== TRANSPARENT))) throw new DiagError(name.line, name.col, `layer '${name.v}' has pixels; an underlay goes on its own reference layer`);
    const u: Underlay = { blob: blob.value, iw, ih, x, y, w, h, layout: layout?.value ?? null };
    const rec = RECORD.flatMap((k) => {
      const o = a.opts.get(k);
      if (!o) return [];
      if (k === 'cost' && !/^\d+(\.\d+)?$/.test(o.value)) throw new DiagError(o.line, o.vcol, `cost= is in US dollars, like 0.05`);
      return [` ${k}=${o.quoted || /[\s";#]/.test(o.value) || !o.value ? quote(o.value) : o.value}`];
    }).join('');
    return {
      text: `underlay ${name.v} blob=${u.blob} image=${iw}x${ih} at=${x},${y} size=${w}x${h}${u.layout ? ` layout=${u.layout}` : ''}${rec}`,
      op: fn((d) => {
        let k = d.layers.findIndex((l) => l.name === name.v);
        if (k < 0) { insertLayer(d, 0, name.v, { reference: true }); k = 0; }
        d.layers[k] = { ...d.layers[k]!, underlay: u };
      }),
    };
  },
};

const snapCmd: CommandSpec = {
  name: 'snap',
  summary: 'snap [from=<underlay layer>] [into=<new layer>]   (fits the underlay\'s pixel grid, quantises each block to the palette into a new draft layer, and reports block R² and, with the layout it was made from, the material match; below 0.8 or 0.85 it suggests a reroll)',
  normalise(cmd, ctx) {
    const doc = needDoc(cmd, ctx);
    if (doc.map) throw new DiagError(cmd.line, cmd.col, `snap: a map holds cells by name`);
    const a = new Args(cmd, ['from', 'into', 'at', 'grid', 'pitch', 'offset', 'r2', 'material']);
    const block = a.peek()?.t === 'block' ? a.take('block', 'rows') : null;
    a.done();
    const fromOpt = a.opts.get('from');
    const unders = doc.layers.filter((l) => l.underlay);
    const src = fromOpt ? doc.layers.find((l) => l.name === fromOpt.value) : unders.length === 1 ? unders[0] : undefined;
    if (!src?.underlay) {
      throw new DiagError(fromOpt?.line ?? cmd.line, fromOpt?.vcol ?? cmd.col, fromOpt ? `snap: layer '${fromOpt.value}' has no underlay` : unders.length ? `snap: give from=<layer> (underlays: ${unders.map((l) => l.name).join(', ')})` : `snap: there is no underlay (underlay generate / import first)`);
    }
    const intoOpt = a.opts.get('into');
    const into = intoOpt?.value ?? 'draft';
    if (!LAYER_RE.test(into)) throw new DiagError(intoOpt!.line, intoOpt!.vcol, `'${into}' is not a usable layer name`);
    if (doc.layers.some((l) => l.name === into)) throw new DiagError(intoOpt?.line ?? cmd.line, intoOpt?.vcol ?? cmd.col, `snap: there is already a layer '${into}' (snap makes a new draft layer; give into=<name>)`);
    const u = src.underlay;
    const keyIndex = new Map(doc.palette.entries.map((e, k) => [e.key, k]));
    let rows: string[], at: [number, number], stats: string;
    if (block) {
      // A recorded snap: the rows are the result.
      rows = block.rows.map((r) => r.text);
      block.rows.forEach((r) => [...r.text].forEach((ch, k) => {
        if (ch !== '.' && !keyIndex.has(ch)) throw new DiagError(r.line, r.col + k, `snap: '${ch}' is not a key in palette '${doc.palette.name}'`);
      }));
      at = a.opts.get('at') ? pointOf(a.opts.get('at')!) : [u.x, u.y];
      stats = ['grid', 'pitch', 'offset', 'r2', 'material'].flatMap((k) => (a.opts.get(k) ? [` ${k}=${a.opts.get(k)!.value}`] : [])).join('');
    } else {
      const img = ctx.image?.(u.blob);
      if (!img) throw new DiagError(cmd.line, cmd.col, `snap: the underlay image (blobs/${u.blob}.png) is not readable here; run snap through the server`);
      if (img.width !== u.iw || img.height !== u.ih) throw new DiagError(cmd.line, cmd.col, `snap: the blob is ${img.width}x${img.height}, the underlay says ${u.iw}x${u.ih}`);
      const layout = u.layout ? ctx.image?.(u.layout) ?? null : null;
      const r = snapImage(img, doc.palette, { hint: { x: u.iw / u.w, y: u.ih / u.h }, layout });
      const keys = doc.palette.entries.map((e) => e.key);
      rows = Array.from({ length: r.fit.rows }, (_, j) => Array.from({ length: r.fit.cols }, (_, i) => {
        const v = r.px[j * r.fit.cols + i]!;
        return v === TRANSPARENT ? '.' : keys[v]!;
      }).join(''));
      // The first block's top-left in document pixels.
      at = [
        u.x + Math.round(((r.fit.x.offset + r.fit.i0 * r.fit.x.pitch) * u.w) / u.iw),
        u.y + Math.round(((r.fit.y.offset + r.fit.j0 * r.fit.y.pitch) * u.h) / u.ih),
      ];
      const f2 = (n: number) => n.toFixed(2), f3 = (n: number) => n.toFixed(3);
      stats = ` grid=${r.fit.cols}x${r.fit.rows} pitch=${f3(r.fit.x.pitch)}x${f3(r.fit.y.pitch)} offset=${f2(r.fit.x.offset)},${f2(r.fit.y.offset)} r2=${f2(r.r2)} material=${r.material === null ? 'none' : f2(r.material)}`;
    }
    const px = rows.map((row) => [...row].map((ch) => (ch === '.' ? TRANSPARENT : keyIndex.get(ch)!)));
    return {
      text: `snap from=${src.name} into=${into} at=${at[0]},${at[1]}${stats} <<\n${blockText(rows)}>>`,
      op: fn((d) => {
        insertLayer(d, d.layers.length, into, {});
        const fr = d.cels[d.layers.length - 1]!;
        for (const cel of fr) {
          px.forEach((row, j) => row.forEach((v, i) => {
            const x = at[0] + i, y = at[1] + j;
            if (x >= 0 && y >= 0 && x < d.width && y < d.height) cel[y * d.width + x] = v;
          }));
        }
      }),
    };
  },
};

for (const c of [underlayCmd, snapCmd]) registerCommand(c);
