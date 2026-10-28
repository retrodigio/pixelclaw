// The views of plan §2 that exist so far: the scaled render, the text index grid, the 3x3 tile
// preview and the diff (before / after with the changed pixels marked, plus the list of changes).
// Each is rendered from a document and saved under <project>/views/ (or another folder).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  diffPixels, diffText, encodePng, renderDiff, renderGrid, renderScaled, renderTile3x3, type Doc, type Region,
} from '@pixelclaw/core';
import { ProjectError } from './project.ts';

export const VIEW_MODES = ['render', 'grid', 'tile3x3', 'diff'] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

export interface ViewOptions {
  scale?: number;
  region?: Region;
  /** diff only: compare with the document after this command (default: before the last group). */
  since?: number;
  /** The frame to show, 0-based (default the first). */
  frame?: number;
}

export type View =
  | { mode: ViewMode; kind: 'image'; png: Uint8Array; width: number; height: number; path: string; text?: string }
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
  if (o.frame !== undefined && (!Number.isInteger(o.frame) || o.frame < 0 || o.frame >= doc.frameCount)) {
    throw new ProjectError(`frame ${o.frame + 1} does not exist (frames 1..${doc.frameCount})`);
  }
  const r = o.region;
  if (r) {
    if (r.w < 1 || r.h < 1) throw new ProjectError('region size must be at least 1x1');
    if (!doc.wrap && (r.x + r.w > doc.width || r.y + r.h > doc.height)) {
      throw new ProjectError(`region runs past the ${doc.width}x${doc.height} canvas`);
    }
  }
}

/**
 * Render one view and write it to outDir (views/<asset>.<mode>.png|txt, overwritten each time).
 * The diff compares `before` (null: nothing yet) with `doc`.
 */
export function makeView(doc: Doc, mode: ViewMode, o: ViewOptions, outDir: string, before?: Doc | null): View {
  checkViewOptions(doc, o);
  mkdirSync(outDir, { recursive: true });
  if (mode === 'diff') {
    const img = renderDiff(before ?? null, doc, { scale: o.scale });
    const png = encodePng(img);
    const path = join(outDir, `${doc.name}.diff.png`);
    writeFileSync(path, png);
    const text = diffText(before ?? null, doc, diffPixels(before ?? null, doc));
    return { mode, kind: 'image', png, width: img.width, height: img.height, path, text };
  }
  if (mode === 'grid') {
    const r = o.region;
    const text = renderGrid(doc, r, o.frame);
    const path = join(outDir, `${doc.name}.grid${r ? `.${r.x}-${r.y}-${r.w}x${r.h}` : ''}.txt`);
    writeFileSync(path, text);
    return { mode, kind: 'text', text, path };
  }
  const img = mode === 'render' ? renderScaled(doc, { scale: o.scale, frame: o.frame }) : renderTile3x3(doc, o.frame);
  const png = encodePng(img);
  const path = join(outDir, `${doc.name}.${mode}.png`);
  writeFileSync(path, png);
  return { mode, kind: 'image', png, width: img.width, height: img.height, path };
}
