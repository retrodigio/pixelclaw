// The views of plan §2 that exist so far: the scaled render, the text index grid, the 3x3 tile
// preview, the diff (before / after with the changed pixels marked, plus the list of changes),
// and the in-context previews `game` (sprites on their ground at 1x and the draw scale) and
// `recolour` (role art under preview themes). Render and tile3x3 can circle the pixels checks
// flagged. Each is rendered from a document and saved under <project>/views/ (or another folder).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  diffPixels, diffText, encodePng, renderDiff, renderGame, renderGrid, renderRecolour, renderScaled, renderTile3x3, type Doc, type Pt, type Region,
  type Theme,
} from '@pixelclaw/core';
import { ProjectError } from './project.ts';

export const VIEW_MODES = ['render', 'grid', 'tile3x3', 'diff', 'game', 'recolour'] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

export interface ViewOptions {
  scale?: number;
  region?: Region;
  /** diff only: compare with the document after this command (default: before the last group). */
  since?: number;
  /** The frame to show, 0-based (default the first). */
  frame?: number;
  /** render, tile3x3, game: pixels to circle in magenta (from checks). */
  marks?: readonly Pt[];
  /** render, tile3x3, game: the preview theme for role entries. */
  theme?: Theme | null;
  /** game: the ground tile, the neighbours shown beside the asset, and the draw scale. */
  game?: { ground: Doc | null; with: Doc[]; scale: number };
  /** recolour: the themes to show. */
  themes?: Theme[];
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
  const img = mode === 'render' ? renderScaled(doc, { scale: o.scale, frame: o.frame, marks: o.marks, theme: o.theme })
    : mode === 'tile3x3' ? renderTile3x3(doc, o.frame, { marks: o.marks, theme: o.theme })
    : mode === 'game' ? renderGame([{ doc, frame: o.frame }, ...(o.game?.with ?? []).map((d) => ({ doc: d }))], { ground: o.game?.ground, scale: o.game?.scale ?? 2, theme: o.theme, marks: o.marks })
    : renderRecolour(doc, o.themes ?? [], { scale: o.scale, frame: o.frame });
  const png = encodePng(img);
  const path = join(outDir, `${doc.name}.${mode}.png`);
  writeFileSync(path, png);
  return { mode, kind: 'image', png, width: img.width, height: img.height, path };
}
