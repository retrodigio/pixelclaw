// Shadows (G16, plan §26 item 3): a flat ellipse on the ground under a sprite or an object, pushed
// away from the light. The `shadow` helper draws one into a sprite's own art; a map's objects layer
// with shadow= draws one under every object it places, on the ground before the objects.

import { LIGHT_DIRS } from './consistency.ts';
import { TRANSPARENT } from './doc.ts';
import type { Palette } from './palette.ts';
import { ellipsePixels, type Pt } from './raster.ts';
import { lstar } from './checks.ts';

export const SHADOW_DIRS = Object.keys(LIGHT_DIRS);

/** The direction a shadow falls: away from the light (the style guide's light from the north-west: south-east). */
export function shadowDirOf(light: string | undefined): string {
  const l = light && LIGHT_DIRS[light] ? LIGHT_DIRS[light]! : LIGHT_DIRS.nw!;
  return Object.entries(LIGHT_DIRS).find(([, d]) => d[0] === -l[0] && d[1] === -l[1])![0];
}

export interface Box { x: number; y: number; w: number; h: number }

/**
 * The shadow's box for some art (w x h, flat palette indices): an ellipse as wide as the art's
 * bottom rows (a third of its height, at least one) and two pixels more, a third as tall, centred
 * on the bottom row and moved a sixth of its width toward `dir`. Null when nothing is drawn.
 */
export function shadowBox(px: Uint16Array, w: number, h: number, dir: string): Box | null {
  let y0 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[y * w + x] !== TRANSPARENT) { if (y0 < 0) y0 = y; y1 = y; }
  if (y1 < 0) return null;
  const k = Math.max(1, Math.floor((y1 - y0 + 1) / 3));
  let x0 = w, x1 = -1;
  for (let y = y1 - k + 1; y <= y1; y++) for (let x = 0; x < w; x++) if (px[y * w + x] !== TRANSPARENT) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
  const ew = x1 - x0 + 3;
  const eh = Math.max(2, Math.floor((ew + 1) / 3));
  const off = Math.max(1, Math.floor(ew / 6));
  const [dx, dy] = LIGHT_DIRS[dir] ?? [1, 1];
  return { x: x0 - 1 + dx * off, y: y1 - (eh >> 1) + dy * off, w: ew, h: eh };
}

/** The ellipse's pixels. */
export const shadowPixels = (b: Box): Pt[] => ellipsePixels(b.x, b.y, b.x + b.w - 1, b.y + b.h - 1, true);

/**
 * One step darker for each colour: the entry before it in a ramp of the palette it came from, else
 * the nearest entry at least 6 L* darker; the darkest stays. `entries` is the palette drawn in;
 * `sources` are the palettes (with each one's index map into `entries`) whose ramps say what is darker.
 */
export function darkerMap(entries: { name: string; hex: string }[], sources: { palette: Palette; map: number[] }[]): number[] {
  const out = entries.map((_, i) => i);
  const set = new Set<number>();
  for (const { palette, map } of sources) for (const names of Object.values(palette.ramps)) {
    const idx = names.map((n) => palette.entries.findIndex((e) => e.name === n));
    for (let i = 1; i < idx.length; i++) {
      const a = map[idx[i]!], b = map[idx[i - 1]!];
      if (a === undefined || b === undefined || set.has(a)) continue;
      out[a] = b;
      set.add(a);
    }
  }
  const L = entries.map((e) => lstar(e.hex));
  entries.forEach((_, i) => {
    if (set.has(i)) return;
    let best = -1;
    for (let j = 0; j < entries.length; j++) if (L[i]! - L[j]! >= 6 && (best < 0 || L[j]! > L[best]!)) best = j;
    if (best >= 0) out[i] = best;
  });
  return out;
}
