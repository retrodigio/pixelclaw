// The views of plan §2 that exist so far: the scaled render, the text index grid and the 3x3 tile
// preview. Each is rendered from a document and saved under <project>/views/ (or another folder).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng, renderGrid, renderScaled, renderTile3x3, type Doc, type Region } from '@pixelclaw/core';
import { ProjectError } from './project.ts';

export const VIEW_MODES = ['render', 'grid', 'tile3x3'] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

export interface ViewOptions {
  scale?: number;
  region?: Region;
}

export type View =
  | { mode: ViewMode; kind: 'image'; png: Uint8Array; width: number; height: number; path: string }
  | { mode: ViewMode; kind: 'text'; text: string; path: string };

export function isViewMode(s: string): s is ViewMode {
  return (VIEW_MODES as readonly string[]).includes(s);
}

/** "8,0 12x10" or "8,0,12x10" or "8,0,12,10"; null if it doesn't look like a region. */
export function parseRegion(s: string): Region | null {
  const t = s.trim();
  const m = /^(\d+),(\d+)[ ,](\d+)x(\d+)$/.exec(t) ?? /^(\d+),(\d+),(\d+),(\d+)$/.exec(t);
  if (!m) return null;
  const [x, y, w, h] = m.slice(1).map(Number) as [number, number, number, number];
  return { x, y, w, h };
}

export function checkViewOptions(doc: Doc, o: ViewOptions): void {
  if (o.scale !== undefined && (!Number.isInteger(o.scale) || o.scale < 1 || o.scale > 64)) {
    throw new ProjectError('scale must be an integer 1..64');
  }
  const r = o.region;
  if (r) {
    if (r.w < 1 || r.h < 1) throw new ProjectError('region size must be at least 1x1');
    if (!doc.wrap && (r.x + r.w > doc.width || r.y + r.h > doc.height)) {
      throw new ProjectError(`region runs past the ${doc.width}x${doc.height} canvas`);
    }
  }
}

/** Render one view and write it to outDir (views/<asset>.<mode>.png|txt, overwritten each time). */
export function makeView(doc: Doc, mode: ViewMode, o: ViewOptions, outDir: string): View {
  checkViewOptions(doc, o);
  mkdirSync(outDir, { recursive: true });
  if (mode === 'grid') {
    const r = o.region;
    const text = renderGrid(doc, r);
    const path = join(outDir, `${doc.name}.grid${r ? `.${r.x}-${r.y}-${r.w}x${r.h}` : ''}.txt`);
    writeFileSync(path, text);
    return { mode, kind: 'text', text, path };
  }
  const img = mode === 'render' ? renderScaled(doc, { scale: o.scale }) : renderTile3x3(doc);
  const png = encodePng(img);
  const path = join(outDir, `${doc.name}.${mode}.png`);
  writeFileSync(path, png);
  return { mode, kind: 'image', png, width: img.width, height: img.height, path };
}
