// Exports that G8 needs before G9's profiles (plan §4.10, §4.11): a map as a Tiled `.tmx` with its
// tileset image and one image per object, an oversized asset `split` into one-cell pieces plus the
// stamp that puts them back, and a plain PNG (a map composed at 1x, or any asset's first frame).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TRANSPARENT, composeMapDoc, encodePng, flatten, mapToTmx, mapWorld, splitAsset, type AssetDoc, type Doc, type Rgba,
} from '@pixelclaw/core';
import { ProjectError } from './project.ts';

export const EXPORT_FORMATS = ['tmx', 'split', 'png'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Palette indices as RGBA (transparent stays transparent). */
function rgbaOf(px: Uint16Array, w: number, h: number, palette: { hex: string }[]): Rgba {
  const data = new Uint8Array(w * h * 4);
  const rgb = palette.map((e) => [parseInt(e.hex.slice(1, 3), 16), parseInt(e.hex.slice(3, 5), 16), parseInt(e.hex.slice(5, 7), 16)]);
  for (let i = 0; i < px.length; i++) {
    const v = px[i]!;
    if (v === TRANSPARENT) continue;
    const c = rgb[v]!;
    data[i * 4] = c[0]!; data[i * 4 + 1] = c[1]!; data[i * 4 + 2] = c[2]!; data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}

/** Write an export of one asset into `dest`; returns the files written. */
export function exportAsset(doc: Doc, assets: AssetDoc[], format: ExportFormat, dest: string): string[] {
  mkdirSync(dest, { recursive: true });
  const files: string[] = [];
  const save = (rel: string, data: Uint8Array | string) => {
    const f = join(dest, rel);
    mkdirSync(join(f, '..'), { recursive: true });
    writeFileSync(f, data);
    files.push(f);
  };
  if (format === 'tmx') {
    if (!doc.map) throw new ProjectError(`'${doc.name}' is not a map (tmx exports map documents)`);
    const x = mapToTmx(doc, mapWorld(assets));
    save(`${doc.name}.tmx`, x.tmx);
    save(`${doc.name}.tiles.png`, encodePng(rgbaOf(x.tileset.px, x.tileset.width, x.tileset.height, x.palette)));
    for (const o of x.objects) save(`objects/${o.name}.png`, encodePng(rgbaOf(o.px, o.width, o.height, x.palette)));
    return files;
  }
  if (format === 'split') {
    if (doc.map || doc.family || doc.overlay) throw new ProjectError(`'${doc.name}' is a ${doc.kind}; split takes an oversized tile or object`);
    if (doc.width % doc.cellW || doc.height % doc.cellH) throw new ProjectError(`'${doc.name}' is ${doc.width}x${doc.height}, not whole ${doc.cellW}x${doc.cellH} cells (new … cell=<W>x<H>)`);
    const { pieces, stamp } = splitAsset(doc);
    for (const p of pieces) save(`${doc.name}/${p.name}.png`, encodePng(rgbaOf(p.px, doc.cellW, doc.cellH, doc.palette.entries)));
    save(`${doc.name}/${doc.name}.stamp.json`, JSON.stringify(stamp, null, 2) + '\n');
    return files;
  }
  if (doc.map) {
    const c = composeMapDoc(doc, mapWorld(assets));
    save(`${doc.name}.png`, encodePng(rgbaOf(c.px, c.w, c.h, c.palette)));
  } else save(`${doc.name}.png`, encodePng(rgbaOf(flatten(doc, 0), doc.width, doc.height, doc.palette.entries)));
  return files;
}
