// The views of plan §2 that exist so far: the scaled render, the text index grid, the 3x3 tile
// preview, the diff (before / after with the changed pixels marked, plus the list of changes),
// and the in-context previews `game` (sprites on their ground at 1x and the draw scale) and
// `recolour` (role art under preview themes), and `anim` (a contact sheet of every sequence with
// an onion skin, plus an animated GIF at the game's speed). Render and tile3x3 can circle the
// pixels checks flagged. Each is rendered from a document and saved under <project>/views/ (or another folder).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  animGifFrames, animText, diffPixels, diffText, encodeGif, encodePng, mapGifFrames, mapText, renderAnimSheet, renderDiff, renderFamilyView, renderGame, renderGrid, renderMap,
  renderRecolour, renderScaled, renderTile3x3, layoutOf, schemeOf, cameraRegion, composeMapDoc, mapAscii, mapDocGifFrames, mapDocText, paintComposed,
  type Doc, type MapWorld, type Pt, type Region, type Theme,
} from '@pixelclaw/core';
import { ProjectError } from './project.ts';

export const VIEW_MODES = ['render', 'grid', 'tile3x3', 'diff', 'game', 'recolour', 'anim', 'map', 'family'] as const;
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
  game?: { ground: Doc | null; with: Doc[]; scale: number; frames?: number[] };
  /** anim: game ticks per second (the project's tick rate). */
  tickRate?: number;
  /** recolour: the themes to show. */
  themes?: Theme[];
  /** map: its size in tiles, the island's seed, overlays played over it, and (for an overlay) the tile or family under it. */
  map?: { cols?: number; rows?: number; seed?: number; overlays: Doc[]; ground: Doc | null };
  /**
   * map of a map document (or of an object, set on its ground): the assets it names, the cells to
   * show (a region, or the camera's screen around a cell), and the game's draw scale.
   */
  mapDoc?: { doc: Doc; world: MapWorld; region?: Region; camera?: [number, number]; screen: [number, number]; drawScale: number; note?: string };
}

export type View =
  | { mode: ViewMode; kind: 'image'; png: Uint8Array; width: number; height: number; path: string; text?: string; gif?: string }
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
  if (mode === 'map' && o.mapDoc) return mapDocView(doc, o, outDir);
  if (mode === 'map') {
    const mo = { cols: o.map?.cols, rows: o.map?.rows, seed: o.map?.seed, overlays: o.map?.overlays, ground: o.map?.ground, scale: o.scale, theme: o.theme, tickRate: o.tickRate };
    const img = renderMap(doc, mo);
    const png = encodePng(img);
    const path = join(outDir, `${doc.name}.map.png`);
    writeFileSync(path, png);
    let text = mapText(doc, mo);
    let gif: string | undefined;
    const frames = mapGifFrames(doc, mo);
    if (frames.length > 1) {
      gif = join(outDir, `${doc.name}.map.gif`);
      writeFileSync(gif, encodeGif(frames, { delta: true }));
      text += `\nanimated GIF at game speed: ${gif}`;
    }
    return { mode, kind: 'image', png, width: img.width, height: img.height, path, text, ...(gif ? { gif } : {}) };
  }
  if (mode === 'family') {
    if (!doc.family) throw new ProjectError(`'${doc.name}' is not a family (the family view shows each variant among its neighbours)`);
    const img = renderFamilyView(doc, { scale: o.scale, frame: o.frame, theme: o.theme });
    const png = encodePng(img);
    const path = join(outDir, `${doc.name}.family.png`);
    writeFileSync(path, png);
    return { mode, kind: 'image', png, width: img.width, height: img.height, path, text: familyText(doc) };
  }
  if (mode === 'anim') {
    const img = renderAnimSheet(doc, { scale: o.scale, theme: o.theme });
    const png = encodePng(img);
    const path = join(outDir, `${doc.name}.anim.png`);
    writeFileSync(path, png);
    const gif = join(outDir, `${doc.name}.anim.gif`);
    writeFileSync(gif, encodeGif(animGifFrames(doc, { theme: o.theme, tickRate: o.tickRate })));
    const text = `${animText(doc, { tickRate: o.tickRate })}\nanimated GIF (every sequence side by side, at game speed): ${gif}`;
    return { mode, kind: 'image', png, width: img.width, height: img.height, path, text, gif };
  }
  const img = mode === 'render' ? renderScaled(doc, { scale: o.scale, frame: o.frame, marks: o.marks, theme: o.theme })
    : mode === 'tile3x3' ? renderTile3x3(doc, o.frame, { marks: o.marks, theme: o.theme })
    : mode === 'game' ? renderGame([...(o.game?.frames ?? [o.frame ?? 0]).map((f) => ({ doc, frame: f })), ...(o.game?.with ?? []).map((d) => ({ doc: d }))], { ground: o.game?.ground, scale: o.game?.scale ?? 2, theme: o.theme, marks: o.marks })
    : renderRecolour(doc, o.themes ?? [], { scale: o.scale, frame: o.frame });
  const png = encodePng(img);
  const path = join(outDir, `${doc.name}.${mode}.png`);
  writeFileSync(path, png);
  return { mode, kind: 'image', png, width: img.width, height: img.height, path };
}

/**
 * A map document: the whole map at 1x, a region of cells or the camera's screen at the game's
 * draw scale, with cells the checks flag outlined in magenta; and a GIF when anything moves.
 */
function mapDocView(doc: Doc, o: ViewOptions, outDir: string): View {
  const md = o.mapDoc!;
  const m = md.doc;
  const c = composeMapDoc(m, md.world);
  let region = md.region ? { ...md.region } : undefined;
  let where = '';
  if (md.camera) {
    const r = cameraRegion(c, md.camera[0], md.camera[1], md.screen[0], md.screen[1]);
    region = { x: r.x, y: r.y, w: r.w, h: r.h };
    where = `the camera at ${md.camera[0]},${md.camera[1]}: a ${md.screen[0]}x${md.screen[1]} px screen, cells ${r.x},${r.y} ${r.w}x${r.h}`;
  } else if (region) {
    if (region.x + region.w > c.cols || region.y + region.h > c.rows) throw new ProjectError(`region runs past the ${c.cols}x${c.rows} cells of the map`);
    where = `cells ${region.x},${region.y} ${region.w}x${region.h}`;
  }
  const scale = o.scale ?? (region || md.note ? md.drawScale : 1);
  const vo = { scale, region, marks: o.marks };
  const img = paintComposed(c, vo);
  const png = encodePng(img);
  const tag = md.camera ? '.camera' : region ? `.${region.x}-${region.y}-${region.w}x${region.h}` : '';
  const path = join(outDir, `${doc.name}.map${tag}.png`);
  writeFileSync(path, png);
  let text = md.note ?? mapDocText(m, md.world, c);
  if (!md.note && m.width <= 80) text += `\n${mapAscii(m)}`;
  text += `
showing ${where || 'the whole map'} at ${scale}x${o.marks?.length ? `; ${o.marks.length} flagged cells outlined in magenta` : ''}`;
  let gif: string | undefined;
  // A GIF of what moves (families' frames, overlays), when the picture is not too big to play.
  if (img.width * img.height <= 1200 * 900) {
    const frames = mapDocGifFrames(m, md.world, { ...vo, tickRate: o.tickRate });
    if (frames.length > 1) {
      gif = join(outDir, `${doc.name}.map${tag}.gif`);
      writeFileSync(gif, encodeGif(frames, { delta: true }));
      text += `
animated GIF at game speed: ${gif}`;
    }
  }
  return { mode: 'map', kind: 'image', png, width: img.width, height: img.height, path, text, ...(gif ? { gif } : {}) };
}

/** A family's sheet in words: where every cell is (for @cell and coordinates), which are pieces and which detached. */
export function familyText(doc: Doc): string {
  const f = doc.family!;
  const s = schemeOf(f);
  const L = layoutOf(f);
  const t = f.tile;
  const pieces = new Set(s.pieces);
  const det = new Set(f.detached);
  const g = f.geometry;
  const lines = [
    `${doc.name}: ${s.name}, ${s.variants.length} variants of ${t}x${t}; band ${g.bands.length ? g.bands.map((b) => `${b.w}:${typeof b.fill === 'number' ? doc.palette.entries[b.fill]!.name : b.fill}`).join(' ') : 'none'} radius ${g.radius} inset ${g.inset}`,
    `textures: inside @cell(inside) at ${L.inside[0] * t},${L.inside[1] * t}; outside @cell(outside) at ${L.outside[0] * t},${L.outside[1] * t}`,
    `pieces (draw these on layer band; the others are built from their quadrants): ${s.pieces.join(', ')}`,
    'cells: ' + s.variants.map((v, i) => `${v.name} ${L.cells[i]![0] * t},${L.cells[i]![1] * t}${pieces.has(v.name) ? ' (piece)' : det.has(v.name) ? ' (detached)' : ''}`).join('; '),
  ];
  if (f.mapCols) lines.push(`coverage map: ${f.mapCols}x${f.mapRows} tiles from 0,${L.mapRow * t}${f.terrain.length ? '' : ' (not laid out yet: family coverage)'}`);
  return lines.join('\n');
}
