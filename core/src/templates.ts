// Flat templates (plan §7.3 step 3): drawn by the tool from the manifest before any art exists,
// free to iterate. A coverage map per planned family (every variant its scheme can produce, laid
// out by `coverageTerrain` and drawn in flat colours with the band's shape, so `blob47-round`'s
// fillets and rounded corners show), and a mockup screen: one game screen laid out from the
// manifest's grounds, terrains, objects and figures as flat shapes. They are the layout a person
// approves, a reference to paint over (route 3 cuts a family from a painted coverage map) and,
// later, the layout an image model's mockup follows.

import { coverageTerrain, bandMaps, islandTerrain, variantCounts } from './family.ts';
import { createRgba, type Rgba } from './png.ts';
import { drawLabel } from './render.ts';
import { reachable, resolveMap, type Band, type Geometry, type Scheme, type Terrain } from './schemes.ts';
import { parseSize, setName, type Manifest, type ManifestAsset } from './manifest.ts';
import { Pcg32 } from './pcg.ts';

type RGB = [number, number, number];

/** Flat colours for assets that do not name one (`flat` in the manifest), in manifest order. */
export const FLAT_COLOURS: RGB[] = [
  [122, 158, 88], [84, 128, 168], [196, 170, 112], [150, 112, 84], [128, 128, 136], [176, 98, 82],
  [104, 150, 140], [190, 140, 70], [136, 104, 150], [92, 112, 72], [208, 196, 160], [70, 90, 120],
];

const darker = (c: RGB, k = 0.68): RGB => [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k)];

function fillRect(img: Rgba, x: number, y: number, w: number, h: number, c: RGB): void {
  for (let j = Math.max(0, y); j < Math.min(img.height, y + h); j++) for (let i = Math.max(0, x); i < Math.min(img.width, x + w); i++) {
    const o = (j * img.width + i) * 4;
    img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
  }
}

function frameRect(img: Rgba, x: number, y: number, w: number, h: number, c: RGB): void {
  fillRect(img, x, y, w, 1, c); fillRect(img, x, y + h - 1, w, 1, c);
  fillRect(img, x, y, 1, h, c); fillRect(img, x + w - 1, y, 1, h, c);
}

/** A band profile's widths ("3:outside 1:foam 2:sand0 radius=3") as a flat geometry: outside, then band colour, then inside. */
export function flatGeometry(band: string | undefined, tile: number, inset = 0): Geometry {
  const widths: { w: number; what: string }[] = [];
  let radius = 0;
  for (const part of (band ?? '').trim().split(/\s+/).filter(Boolean)) {
    const m = /^(\d+):(\S+)$/.exec(part);
    if (m) widths.push({ w: Number(m[1]), what: m[2]! });
    const r = /^radius=(\d+)$/.exec(part);
    if (r) radius = Number(r[1]);
  }
  if (!widths.length) widths.push({ w: Math.max(1, Math.floor(tile / 12)), what: 'edge' });
  // Flat: 'outside' stays outside, any colour is the band (fill 0), the rest is inside.
  const bands: Band[] = widths.map((x) => ({ w: x.w, fill: x.what === 'outside' ? 'outside' : x.what === 'inside' ? 'inside' : 0 }));
  const total = bands.reduce((s, b) => s + b.w, 0);
  return { inset, radius: Math.min(radius, Math.max(0, Math.floor(tile / 2) - inset - total)), bands };
}

/** Paint a terrain flat: inside, outside and the band, through the scheme's own quadrant geometry. */
function paintTerrain(img: Rgba, s: Scheme, terrain: Terrain, t: number, g: Geometry, c: { inside: RGB; outside: RGB | null; band: RGB }, ox = 0, oy = 0): (number | null)[] {
  const variants = resolveMap(s, terrain);
  const maps = bandMaps(s, t, g);
  variants.forEach((v, i) => {
    const mx = (i % terrain.cols) * t + ox, my = Math.floor(i / terrain.cols) * t + oy;
    for (let y = 0; y < t; y++) for (let x = 0; x < t; x++) {
      const b = v === null ? -1 : maps[v]![y * t + x]!;
      const fill = b >= 0 && b < g.bands.length ? g.bands[b]!.fill : null;
      const col = b < 0 || fill === 'outside' ? c.outside : typeof fill === 'number' ? c.band : c.inside;
      if (col) fillRect(img, mx + x, my + y, 1, 1, col);
    }
  });
  return variants;
}

/** A coverage map's size for a scheme: big enough that `coverageTerrain` places every variant on its first try. */
export function coverageSize(s: Scheme): [number, number] {
  const n = reachable(s).length;
  if (n <= 16) return [6, 6];
  const area = Math.ceil(n * 2.6);
  const rows = Math.max(6, Math.round(Math.sqrt((area * 3) / 4)));
  return [Math.max(8, Math.ceil(area / rows)), rows];
}

export interface CoverageTemplate {
  cols: number;
  rows: number;
  tile: number;
  terrain: Terrain;
  /** The variant at each cell (null: the plain outside). */
  variants: (number | null)[];
  img: Rgba;
  /** Each cell's variant name, row by row ('-' for the outside). */
  text: string;
}

/** A family's coverage map as a flat template: every variant at least once, in flat colours. */
export function coverageTemplate(s: Scheme, o: { tile: number; band?: string; inset?: number; seed?: number; inside: RGB; outside: RGB; size?: [number, number] }): CoverageTemplate | null {
  let [cols, rows] = o.size ?? coverageSize(s);
  let terrain: Terrain | null = null;
  for (let k = 0; k < 4 && !terrain; k++) {
    terrain = coverageTerrain(s, cols, rows, o.seed ?? 1);
    if (!terrain) { cols += 2; rows += 2; }
  }
  if (!terrain) return null;
  const img = createRgba(cols * o.tile, rows * o.tile);
  const g = flatGeometry(o.band, o.tile, o.inset ?? 0);
  const variants = paintTerrain(img, s, terrain, o.tile, g, { inside: o.inside, outside: o.outside, band: darker(o.inside) });
  const names = variants.map((v) => (v === null ? '-' : s.variants[v]!.name));
  const width = Math.max(...names.map((n) => n.length));
  const lines = Array.from({ length: rows }, (_, r) => `${String(r).padStart(3)}: ${names.slice(r * cols, r * cols + cols).map((n) => n.padEnd(width)).join(' ').trimEnd()}`);
  const counts = variantCounts(s, terrain);
  const missing = reachable(s).filter((v) => !counts[v]);
  return {
    cols, rows, tile: o.tile, terrain, variants, img,
    text: `${s.name}: ${cols}x${rows} tiles of ${o.tile} px, ${reachable(s).length - missing.length} of ${reachable(s).length} variants\n\n${lines.join('\n')}\n`,
  };
}

export interface MockupScreen {
  cols: number;
  rows: number;
  tile: number;
  /** The screen at 1x in flat colours. */
  img: Rgba;
  /** The same at `scale` with every object and figure named. */
  labelled: Rgba;
  /** The cells: a letter per ground or terrain, capitals for what stands there; then the legend. */
  text: string;
  placed: { name: string; x: number; y: number; w: number; h: number }[];
}

/**
 * One game screen from the manifest, in flat colours: the first plain tile as the ground, each
 * family's terrain laid over it (a road for path schemes, an island-like blob for the others),
 * then the objects and figures stood on the plain ground where they fit, each its own size.
 */
export function mockupScreen(m: Manifest, o: {
  cols: number; rows: number; tile: number; seed?: number; scale?: number;
  colour(a: ManifestAsset, i: number): RGB; scheme(name: string): Scheme | undefined;
}): MockupScreen {
  const { cols, rows, tile: t } = o;
  const rng = new Pcg32(o.seed ?? 1, 0x3c0);
  const img = createRgba(cols * t, rows * t);
  const col = new Map(m.assets.map((a, i) => [a.name, o.colour(a, i)]));
  const tiles = m.assets.filter((a) => a.kind === 'tile' && !a.variantOf && !a.recolourOf);
  const families = m.assets.filter((a) => a.kind === 'family' && !a.variantOf && !a.recolourOf);
  const ground = families.find((f) => f.outside && tiles.some((x) => x.name === f.outside))?.outside ?? tiles[0]?.name ?? null;
  const groundC = ground ? col.get(ground)! : ([60, 60, 60] as RGB);
  fillRect(img, 0, 0, img.width, img.height, groundC);
  const letter = new Map<string, string>();
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const letterOf = (n: string) => letter.get(n) ?? letter.set(n, letters[letter.size % 26]!).get(n)!;
  const cells: string[] = Array.from({ length: cols * rows }, () => (ground ? letterOf(ground) : '.'));
  const free = new Uint8Array(cols * rows).fill(1);
  families.slice(0, 4).forEach((f, k) => {
    const s = o.scheme(f.scheme ?? '');
    if (!s) return;
    const terrain: Terrain = { cols, rows, cells: new Uint8Array(s.neighbours === 'corners' ? (cols + 1) * (rows + 1) : cols * rows) };
    const tw = s.neighbours === 'corners' ? cols + 1 : cols;
    if (s.name === 'path' || s.name === 'bridge8') {
      // A road: across the screen with one bend.
      const y0 = 1 + rng.nextInt(Math.max(1, rows - 2)), y1 = 1 + rng.nextInt(Math.max(1, rows - 2)), xb = 2 + rng.nextInt(Math.max(1, cols - 4));
      for (let x = 0; x < tw; x++) terrain.cells[(x < xb ? y0 : y1) * tw + x] = 1;
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) terrain.cells[y * tw + xb] = 1;
    } else {
      // A blob in one part of the screen (each family its own corner).
      const isl = islandTerrain(s, Math.ceil(cols * 0.6), Math.ceil(rows * 0.7), (o.seed ?? 1) + k * 7);
      const iw = s.neighbours === 'corners' ? isl.cols + 1 : isl.cols;
      const dx = k % 2 ? cols - isl.cols : 0, dy = k >= 2 ? rows - isl.rows : 0;
      for (let y = 0; y < isl.cells.length / iw; y++) for (let x = 0; x < iw; x++) {
        if (isl.cells[y * iw + x] && y + dy < terrain.cells.length / tw && x + dx < tw) terrain.cells[(y + dy) * tw + x + dx] = 1;
      }
    }
    const inside = f.inside && col.has(f.inside) ? col.get(f.inside)! : col.get(f.name)!;
    const g = flatGeometry(f.band, t);
    const vs = paintTerrain(img, s, terrain, t, g, { inside, outside: null, band: darker(inside) });
    vs.forEach((v, i) => { if (v !== null) { cells[i] = letterOf(f.inside ?? f.name); free[i] = 0; } });
  });
  // Objects first (largest first), then figures, each on free plain cells.
  const standing = m.assets.filter((a) => (a.kind === 'object' || a.kind === 'sprite') && !a.variantOf && !a.recolourOf)
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'object' ? -1 : 1));
  const placed: MockupScreen['placed'] = [];
  for (const a of standing) {
    const [w, h] = parseSize(a.size) ?? [t, t];
    // The art's box in cells, standing on its footprint's bottom row; it must fit on screen and on free plain cells.
    const fc = Math.max(1, Math.ceil(w / t)), fr = Math.max(1, Math.ceil(h / t));
    const spots: number[] = [];
    for (let y = 0; y + fr <= rows; y++) for (let x = 0; x + fc <= cols; x++) {
      let ok = true;
      for (let j = -1; j <= fr && ok; j++) for (let i = -1; i <= fc && ok; i++) {
        const xx = x + i, yy = y + j;
        if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue;
        const inside = i >= 0 && j >= 0 && i < fc && j < fr;
        if (inside ? !free[yy * cols + xx] : free[yy * cols + xx] === 2) ok = false;
      }
      if (ok) spots.push(y * cols + x);
    }
    if (!spots.length) continue;
    const p = spots[rng.nextInt(spots.length)]!;
    const cx = p % cols, cy = Math.floor(p / cols);
    const fpr = a.cells ? Math.min(fr, parseSize(a.cells)![1]) : fr;
    for (let j = 0; j < fr; j++) for (let i = 0; i < fc; i++) {
      free[(cy + j) * cols + cx + i] = 2;
      if (j >= fr - fpr) cells[(cy + j) * cols + cx + i] = letterOf(a.name).toUpperCase();
    }
    // The shape: its own width, its drawn height (or its size), standing on the footprint's bottom row.
    const sh = Math.min(h, a.height ?? h), sw = a.kind === 'sprite' ? Math.max(4, Math.round((w * 2) / 3)) : w;
    const px = cx * t + Math.floor((fc * t - sw) / 2), py = (cy + fr) * t - sh - (a.kind === 'sprite' ? 1 : 0);
    const c = col.get(a.name)!;
    fillRect(img, px, py, sw, sh, c);
    frameRect(img, px, py, sw, sh, darker(c, 0.45));
    placed.push({ name: a.name, x: px, y: py, w: sw, h: sh });
  }
  const scale = o.scale ?? 2;
  const labelled = createRgba(img.width * scale, img.height * scale);
  for (let y = 0; y < labelled.height; y++) for (let x = 0; x < labelled.width; x++) {
    const s = ((Math.floor(y / scale) * img.width + Math.floor(x / scale)) * 4), d = (y * labelled.width + x) * 4;
    labelled.data.set(img.data.subarray(s, s + 4), d);
  }
  for (const pl of placed) {
    const k = Math.max(1, scale - 1), lw = pl.name.length * 4 * k - k;
    const lx = Math.max(k, Math.min(labelled.width - lw - 2 * k, pl.x * scale + Math.floor((pl.w * scale - lw) / 2))), ly = Math.max(k, pl.y * scale - 7 * k);
    fillRect(labelled, lx - k, ly - k, lw + 2 * k, 7 * k, [24, 24, 28]);
    drawLabel(labelled, lx, ly, pl.name, [236, 236, 236], k);
  }
  const legend = [...letter].map(([n, l]) => (standing.some((a) => a.name === n) ? `  ${l.toUpperCase()}  ${n} stands here` : `  ${l}  ${n}`));
  const rowsText = Array.from({ length: rows }, (_, r) => `${String(r).padStart(3)}: ${cells.slice(r * cols, r * cols + cols).join('')}`);
  const sets = [...new Set(m.assets.map(setName))];
  return {
    cols, rows, tile: t, img, labelled, placed,
    text: `A mockup screen, ${cols}x${rows} cells of ${t} px, laid out from the manifest (sets: ${sets.join(', ')}).\n\n${rowsText.join('\n')}\n\n${legend.join('\n')}\n`,
  };
}
