// Export profiles (plan §4.9, §7, §17): game-specific knowledge as data. A profile names every image
// it writes from templates (single sprites, numbered sets `<name>_<n>`, directional views, autotile
// variants through a per-scheme naming table, split pieces), lays them out (loose PNGs, an atlas page
// with CSV or JSON records, one sheet per asset, Tiled `.tsx` wang sets and `.tmx` maps, Godot
// terrains, Aseprite JSON sheets or `.aseprite` files), writes density pages (each level exactly d
// times the base frame: an authored copy, or reduced from a higher one, or scaled up), encodes role
// entries as fixed colours, bakes or flags mirror views, numbers texture variants as frames of their
// base, exports oversized assets as one sprite with its footprint or as one-cell pieces, and writes
// animation snippets from templates. Import reads the same files back: images are sliced by name
// and frame and quantised to each asset's palette (role colours decoded), so exporting and then
// importing gives the same indices. Everything here is pure: files are a map of paths to bytes.

import { aseParts, readAseprite, ticksToMs, writeAseprite } from './aseprite.ts';
import { TRANSPARENT, flatten, type Doc } from './doc.ts';
import { cropRgba, decodePng, encodedColours, indicesToRgba, quantise } from './decode.ts';
import { reduceIndices, remapByName, scaleIndices, type ReducerOptions } from './density.ts';
import { layoutOf, schemeOf } from './family.ts';
import { artGrid, composeMapDoc, footprintOf, type MapWorld } from './map.ts';
import { ROLES, rgbOf, type Role } from './palette.ts';
import { encodePng, type Rgba } from './png.ts';
import { NB } from './schemes.ts';
import pAseprite from '../profiles/aseprite.json' with { type: 'json' };
import pAsepriteJson from '../profiles/aseprite-json.json' with { type: 'json' };
import pAtlas from '../profiles/atlas.json' with { type: 'json' };
import pGodot from '../profiles/godot.json' with { type: 'json' };
import pPng from '../profiles/png.json' with { type: 'json' };
import pTiled from '../profiles/tiled.json' with { type: 'json' };

export type Layout = 'loose' | 'atlas' | 'sheet' | 'tiled' | 'godot' | 'aseprite-json' | 'aseprite';
export const LAYOUTS: readonly Layout[] = ['loose', 'atlas', 'sheet', 'tiled', 'godot', 'aseprite-json', 'aseprite'];

export interface ProfileJson {
  format?: 'pixelclaw-profile';
  version?: 1;
  name: string;
  description?: string;
  layout: Layout;
  /** Asset names or kinds to export (default: every asset; maps only where the layout writes maps). */
  include?: string[];
  exclude?: string[];
  /** Naming templates: {asset}, {n}, {view}, {cx}, {cy}. */
  names?: { single?: string; frame?: string; view?: string; piece?: string; start?: number };
  /** Per scheme (or "*"): names by variant, else a template with {asset}, {variant}, {sides}, {corners}; `sides` orders the side letters. */
  autotile?: Record<string, { names?: Record<string, string>; template?: string; sides?: string }>;
  /** Texture variants (`variant of=`): numbered frames of their base ("frames"), or under their own names. */
  variants?: 'frames' | 'names';
  /** Mirror views: written as flipped frames ("bake"), or left out with the source marked ("flag"). */
  mirrors?: 'bake' | 'flag';
  /** Oversized assets: one sprite with its footprint ("sprite"), or one-cell pieces ("split"). */
  oversized?: 'sprite' | 'split';
  /** Role entries are written as these colours. */
  roles?: Partial<Record<Role, string>>;
  /** Density levels (1, 2, 4): file names carry `suffix` except at `plain`; lower levels may be reduced from a higher authored copy. */
  density?: { levels: number[]; plain?: number; suffix?: string; reduce?: boolean; reducer?: string } & ReducerOptions;
  /** Atlas and sheet pages: name, file, width (at 1x), padding, trim, sheet columns. */
  page?: { name?: string; file?: string; width?: number; padding?: number; trim?: boolean; columns?: number };
  /** Records beside a page or sheet. */
  records?: { format: 'csv' | 'json'; file?: string; columns?: string[]; header?: boolean };
  /** Loose and sheet image file names: {name} (loose) or {asset} (sheet). */
  image?: string;
  /** Animation snippets: one text file, a template per asset kind (or "default"). */
  snippets?: { file: string; header?: string; footer?: string; join?: string; templates: Record<string, string> };
}

export class ProfileError extends Error {}

export const RECORD_COLUMNS = ['sprite', 'x', 'y', 'w', 'h', 'cropX', 'cropY', 'frameW', 'frameH', 'pivotX', 'pivotY', 'page', 'asset', 'frame', 'n', 'view', 'mirror', 'ticks', 'ms', 'd', 'cols', 'rows', 'anchorX', 'anchorY', 'flags', 'variant', 'kind'] as const;
export const DEFAULT_COLUMNS = ['sprite', 'x', 'y', 'w', 'h', 'cropX', 'cropY', 'frameW', 'frameH', 'pivotX', 'pivotY'];
const SNIPPET_VARS = ['asset', 'name', 'kind', 'frames', 'names', 'first', 'ticks', 'ms', 'frameTicks', 'loop', 'tags', 'views', 'directions', 'mirror', 'w', 'h', 'cols', 'rows', 'anchorX', 'anchorY', 'pivotX', 'pivotY', 'variants', 'scheme'];
const ITEM_VARS = ['asset', 'n', 'view', 'cx', 'cy', 'variant', 'sides', 'corners', 'name', 'd', 'page', 'stem'];

/** Fill `{var}` placeholders; `{{` and `}}` are literal braces; any other `{` is literal. */
export function fillTemplate(t: string, vars: Record<string, string | number>, allowed?: readonly string[]): string {
  return t.replace(/\{\{|\}\}|\{([A-Za-z][A-Za-z0-9]*)\}/g, (m, k: string | undefined) => {
    if (m === '{{') return '{';
    if (m === '}}') return '}';
    if (allowed && !allowed.includes(k!)) throw new ProfileError(`unknown placeholder {${k}} (known: ${allowed.join(', ')})`);
    const v = vars[k!];
    if (v === undefined) throw new ProfileError(`placeholder {${k}} has no value here`);
    return String(v);
  });
}

/** Check a profile's data; returns it with nothing missing that the engine needs. */
export function loadProfile(j: ProfileJson): ProfileJson {
  const where = `profile '${j?.name ?? '?'}'`;
  if (!j || typeof j !== 'object') throw new ProfileError('a profile is a JSON object');
  if (!/^[a-z][a-z0-9_-]*$/.test(j.name ?? '')) throw new ProfileError(`${where}: name uses a-z, 0-9, _ and -`);
  if (!LAYOUTS.includes(j.layout)) throw new ProfileError(`${where}: layout must be one of ${LAYOUTS.join(', ')}`);
  const names = j.names ?? {};
  for (const [k, t] of Object.entries(names)) if (k !== 'start') fillTemplate(String(t), Object.fromEntries(ITEM_VARS.map((v) => [v, ''])), ITEM_VARS);
  for (const [s, a] of Object.entries(j.autotile ?? {})) {
    for (const t of [a.template, ...Object.values(a.names ?? {})]) if (t) fillTemplate(t, Object.fromEntries(ITEM_VARS.map((v) => [v, ''])), ITEM_VARS);
    if (a.sides && !/^(?=.*n)(?=.*e)(?=.*s)(?=.*w)[nesw]{4}$/.test(a.sides)) throw new ProfileError(`${where}: autotile.${s}.sides orders the letters n, e, s and w`);
  }
  for (const r of Object.keys(j.roles ?? {})) if (!(ROLES as readonly string[]).includes(r)) throw new ProfileError(`${where}: roles.${r} is not a role (${ROLES.join(', ')})`);
  for (const [r, h] of Object.entries(j.roles ?? {})) if (!/^#[0-9a-fA-F]{6}$/.test(String(h))) throw new ProfileError(`${where}: roles.${r} must be #rrggbb`);
  if (j.density) {
    if (!Array.isArray(j.density.levels) || !j.density.levels.length || j.density.levels.some((d) => ![1, 2, 3, 4, 6, 8].includes(d))) throw new ProfileError(`${where}: density.levels lists sizes like 1, 2, 4`);
  }
  for (const c of j.records?.columns ?? []) if (!(RECORD_COLUMNS as readonly string[]).includes(c)) throw new ProfileError(`${where}: records.columns: '${c}' is not a column (${RECORD_COLUMNS.join(', ')})`);
  if (j.snippets) for (const t of Object.values(j.snippets.templates ?? {})) fillTemplate(t, Object.fromEntries(SNIPPET_VARS.map((v) => [v, ''])), SNIPPET_VARS);
  return j;
}

/** The generic profiles the tool ships (a game's own profile lives with the game, plan §7.4). */
export const BUILTIN_PROFILES: ReadonlyMap<string, ProfileJson> = new Map(
  ([pPng, pAtlas, pTiled, pGodot, pAsepriteJson, pAseprite] as ProfileJson[]).map((x) => [x.name, loadProfile(x)]),
);

// --- the items an export writes

export interface Item {
  /** The image's name in the game. */
  name: string;
  /** The document the pixels come from, and its frame. */
  doc: Doc;
  frame: number;
  /** The region of that frame at 1x. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The numbered set's member (null: a single image). */
  n: number | null;
  view: string | null;
  /** A source view whose mirror the engine draws (mirrors: flag). */
  mirror: string | null;
  /** A family's cell (`inside`, `outside` or a variant) or a split piece `cx_cy`. */
  cell: string | null;
  ticks: number;
  /** The asset group this item exports under (the base of texture variants). */
  group: string;
}

const lc = (s: string) => s.toLowerCase();
const flipView = (d: Doc, name: string) => d.views.find((v) => v.mirror === name)?.name ?? null;

/** Side letters and corner suffixes of a generic variant name (`nes_ne` → `nes`, `_ne`), or null. */
function sidesCorners(v: string, order = 'nesw'): { sides: string; corners: string } | null {
  const [first, ...rest] = v.split('_');
  if (!/^(o|[nesw]+)$/.test(first!) || rest.some((r) => !/^(ne|se|sw|nw)$/.test(r))) {
    if (/^(ne|se|sw|nw)$/.test(first!) && rest.every((r) => /^(ne|se|sw|nw)$/.test(r))) return { sides: '', corners: [first!, ...rest].map((r) => `_${r}`).join('') };
    return null;
  }
  const sides = first === 'o' ? '' : [...order].filter((c) => first!.includes(c)).join('');
  return { sides, corners: rest.map((r) => `_${r}`).join('') };
}

function variantName(p: ProfileJson, d: Doc, cell: string): string {
  const scheme = d.family!.def?.name ?? d.family!.scheme;
  const spec = p.autotile?.[scheme] ?? p.autotile?.['*'];
  const base = { asset: d.name, variant: cell, sides: '', corners: '' };
  const named = spec?.names?.[cell];
  if (named) return fillTemplate(named, base);
  if (cell === 'inside' || cell === 'outside') return `${d.name}_${cell}`;
  if (spec?.template) {
    const sc = sidesCorners(cell, spec.sides);
    if (sc) return fillTemplate(spec.template, { ...base, ...sc });
  }
  return `${d.name}_${cell}`;
}

const isOversized = (d: Doc) => !d.family && !d.map && (d.kind === 'object' || d.kind === 'tile') && (d.width > d.cellW || d.height > d.cellH || !!d.footprint);

function included(p: ProfileJson, d: Doc): boolean {
  if (d.densityOf) return false;
  const hit = (list: string[]) => list.includes(d.name) || list.includes(d.kind);
  if (p.exclude && hit(p.exclude)) return false;
  if (p.include) return hit(p.include);
  if (d.map) return p.layout === 'tiled';
  if (d.kind === 'overlay' && p.layout === 'godot') return false;
  return p.layout !== 'godot' || !!d.family;
}

/** Every image an export writes (at 1x), named by the profile, in a fixed order. */
export function exportItems(p: ProfileJson, docs: Doc[]): Item[] {
  const byName = new Map(docs.map((d) => [d.name, d]));
  const asFrames = (p.variants ?? 'frames') === 'frames';
  // Groups: an asset and its texture variants (numbered together), or each on its own.
  const groups: Doc[][] = [];
  const sorted = [...docs].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const d of sorted) {
    if (!included(p, d) || d.map) continue;
    if (asFrames && d.variantOf && byName.has(d.variantOf) && included(p, byName.get(d.variantOf)!)) continue;
    groups.push([d, ...(asFrames ? sorted.filter((v) => v.variantOf === d.name && included(p, v) && v.width === d.width && v.height === d.height) : [])]);
  }
  const start = p.names?.start ?? 0;
  const tpl = { single: '{asset}', frame: '{asset}_{n}', view: '{asset}_{view}_{n}', piece: '{asset}_{cx}_{cy}', ...p.names };
  const items: Item[] = [];
  for (const g of groups) {
    const root = g[0]!;
    const numbered = (count: number) => g.length > 1 || count > 1;
    g.forEach((d, gi) => {
      const per = d.frameCount;
      const nOf = (f: number) => start + gi * per + f;
      const push = (stem: string, f: number, x: number, y: number, w: number, h: number, extra: Partial<Item> = {}) => {
        const n = numbered(per) ? nOf(f) : null;
        const name = n === null ? stem : fillTemplate(tpl.frame, { asset: stem, n, stem });
        items.push({ name, doc: d, frame: f, x, y, w, h, n, view: null, mirror: null, cell: null, ticks: d.ticks[f]!, group: root.name, ...extra });
      };
      if (d.family) {
        const L = layoutOf(d.family);
        const s = schemeOf(d.family);
        const t = d.family.tile;
        const cells: [string, [number, number]][] = [['inside', L.inside], ['outside', L.outside], ...s.variants.map((v, i): [string, [number, number]] => [v.name, L.cells[i]!])];
        for (let f = 0; f < per; f++) for (const [c, [cx, cy]] of cells) push(variantName(p, root, c), f, cx * t, cy * t, t, t, { cell: c });
        return;
      }
      if (isOversized(d) && p.oversized === 'split') {
        const [ac, ar] = artGrid(d);
        for (let f = 0; f < per; f++) for (let cy = 0; cy < ar; cy++) for (let cx = 0; cx < ac; cx++) {
          push(fillTemplate(tpl.piece, { asset: root.name, cx, cy }), f, cx * d.cellW, cy * d.cellH, d.cellW, d.cellH, { cell: `${cx}_${cy}` });
        }
        return;
      }
      if (d.views.length && p.layout !== 'aseprite-json') {
        const flag = p.mirrors === 'flag';
        for (let f = 0; f < per; f++) {
          const v = d.views.find((x) => x.from <= f && f <= x.to);
          if (!v) { push(root.name, f, 0, 0, d.width, d.height); continue; }
          if (v.mirror && flag) continue;
          const k = f - v.from;
          const n = start + (g.length > 1 ? gi * per : 0) + k;
          items.push({
            name: fillTemplate(tpl.view, { asset: root.name, view: lc(v.name), n }), doc: d, frame: f, x: 0, y: 0, w: d.width, h: d.height,
            n, view: v.name, mirror: flag ? flipView(d, v.name) : null, cell: null, ticks: d.ticks[f]!, group: root.name,
          });
        }
        return;
      }
      for (let f = 0; f < per; f++) push(fillTemplate(tpl.single, { asset: root.name }), f, 0, 0, d.width, d.height);
    });
  }
  const seen = new Map<string, Item>();
  for (const it of items) {
    const o = seen.get(it.name);
    if (o) throw new ProfileError(`profile '${p.name}': two images are named '${it.name}' (${o.doc.name} frame ${o.frame + 1} and ${it.doc.name} frame ${it.frame + 1}); change a template`);
    seen.set(it.name, it);
  }
  return items;
}

// --- pixels at a density level

/** An item's pixels at level d (d times its size): an authored copy, reduced from a higher one, or scaled up. */
export function itemPixels(p: ProfileJson, it: Item, d: number, docs: Doc[]): { px: Uint16Array; how: 'authored' | 'reduced' | 'scaled' } {
  const copies = docs.filter((x) => x.densityOf?.of === it.doc.name);
  const region = (src: Uint16Array, sw: number, k: number) => {
    const w = it.w * k, h = it.h * k, out = new Uint16Array(w * h);
    for (let y = 0; y < h; y++) out.set(src.subarray((it.y * k + y) * sw + it.x * k, (it.y * k + y) * sw + it.x * k + w), y * w);
    return out;
  };
  const from = (c: Doc) => remapByName(flatten(c, Math.min(it.frame, c.frameCount - 1)), c.palette, it.doc.palette);
  if (d === 1) return { px: region(flatten(it.doc, it.frame), it.doc.width, 1), how: 'authored' };
  const exact = copies.find((c) => c.densityOf!.d === d);
  if (exact) return { px: region(from(exact), exact.width, d), how: 'authored' };
  const higher = copies.filter((c) => c.densityOf!.d > d && c.densityOf!.d % d === 0).sort((a, b) => b.densityOf!.d - a.densityOf!.d)[0];
  if (higher && p.density?.reduce !== false) {
    const k = higher.densityOf!.d;
    const px = region(from(higher), higher.width, k);
    const { reducer = 'ink-vote', ...o } = p.density ?? { levels: [1] };
    return { px: reduceIndices(px, it.w * k, it.h * k, k / d, it.doc.palette, reducer, o), how: 'reduced' };
  }
  return { px: scaleIndices(region(flatten(it.doc, it.frame), it.doc.width, 1), it.w, it.h, d), how: 'scaled' };
}

// --- export

export interface ExportResult {
  /** Paths (relative to the destination) and their bytes. */
  files: Map<string, Uint8Array>;
  items: Item[];
  notes: string[];
}

const enc = (s: string): Uint8Array => {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
};
const dec = (b: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < b.length;) {
    const c = b[i]!;
    let cp: number;
    if (c < 0x80) { cp = c; i += 1; } else if (c < 0xe0) { cp = ((c & 31) << 6) | (b[i + 1]! & 63); i += 2; } else if (c < 0xf0) { cp = ((c & 15) << 12) | ((b[i + 1]! & 63) << 6) | (b[i + 2]! & 63); i += 3; } else { cp = ((c & 7) << 18) | ((b[i + 1]! & 63) << 12) | ((b[i + 2]! & 63) << 6) | (b[i + 3]! & 63); i += 4; }
    s += String.fromCodePoint(cp);
  }
  return s;
};

const levelsOf = (p: ProfileJson) => p.density?.levels ?? [1];
/** A file stem at a level: the suffix (default `@{d}x`) except at the plain level. */
function levelStem(p: ProfileJson, stem: string, d: number): string {
  const plain = p.density?.plain ?? 1;
  return d === plain ? stem : stem + fillTemplate(p.density?.suffix ?? '@{d}x', { d });
}
const splitExt = (f: string): [string, string] => { const m = /^(.*?)(\.[^./]+)$/.exec(f); return m ? [m[1]!, m[2]!] : [f, '']; };
const levelFile = (p: ProfileJson, file: string, d: number) => { const [s, e] = splitExt(file); return levelStem(p, s, d) + e; };

function trimBox(px: Uint16Array, w: number, h: number): [number, number, number, number] {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[y * w + x] !== TRANSPARENT) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? [0, 0, 0, 0] : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

interface Placed { it: Item; px: Uint16Array; x: number; y: number; w: number; h: number; cropX: number; cropY: number; frameW: number; frameH: number }

function blitIdx(dst: Uint16Array, dw: number, src: Uint16Array, sw: number, sx: number, sy: number, w: number, h: number, dx: number, dy: number): void {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) dst[(dy + y) * dw + dx + x] = src[(sy + y) * sw + sx + x]!;
}

/** A record's value for a column. */
function recordValue(c: string, pl: Placed, page: string, d: number, ms: (t: number) => number): string | number | null {
  const it = pl.it, doc = it.doc;
  const fp = isOversized(doc) ? footprintOf(doc) : null;
  const piv = doc.pivot && !it.cell ? [doc.pivot[0] * d + (d >> 1), doc.pivot[1] * d + d - 1] : null;
  switch (c) {
    case 'sprite': return it.name;
    case 'x': return pl.x; case 'y': return pl.y; case 'w': return pl.w; case 'h': return pl.h;
    case 'cropX': return pl.cropX; case 'cropY': return pl.cropY; case 'frameW': return pl.frameW; case 'frameH': return pl.frameH;
    case 'pivotX': return piv?.[0] ?? null; case 'pivotY': return piv?.[1] ?? null;
    case 'page': return page; case 'asset': return doc.name; case 'frame': return it.frame + 1; case 'n': return it.n;
    case 'view': return it.view; case 'mirror': return it.mirror; case 'ticks': return it.ticks; case 'ms': return ms(it.ticks); case 'd': return d;
    case 'cols': return fp?.cols ?? null; case 'rows': return fp?.rows ?? null;
    case 'anchorX': return fp ? fp.at[0] + fp.anchor[0] : null; case 'anchorY': return fp ? fp.at[1] + fp.anchor[1] : null;
    case 'flags': return fp ? fp.flags.join('/') : null;
    case 'variant': return it.cell; case 'kind': return doc.kind;
  }
  return null;
}

const csvCell = (v: string | number | null) => (v === null ? '' : typeof v === 'number' ? String(v) : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function recordsText(p: ProfileJson, placed: Placed[], page: string, d: number, size: [number, number], ms: (t: number) => number): string {
  const r = p.records!;
  const cols = r.columns ?? DEFAULT_COLUMNS;
  if (r.format === 'csv') {
    const rows = placed.map((pl) => cols.map((c) => csvCell(recordValue(c, pl, page, d, ms))).join(','));
    return [...(r.header === false ? [] : [cols.join(',')]), ...rows].join('\n') + '\n';
  }
  const sprites = placed.map((pl) => Object.fromEntries(cols.flatMap((c) => { const v = recordValue(c, pl, page, d, ms); return v === null ? [] : [[c, v]]; })));
  return JSON.stringify({ page, size, d, sprites }, null, 1) + '\n';
}

/** Shelf-pack images (tallest first, then widest, then by name) into a page `width` wide. */
function pack(list: Placed[], width: number, pad: number): [number, number] {
  const order = [...list].filter((q) => q.w && q.h).sort((a, b) => b.h - a.h || b.w - a.w || (a.it.name < b.it.name ? -1 : 1));
  const W = Math.max(width, ...order.map((q) => q.w + 2 * pad));
  let x = pad, y = pad, shelf = 0;
  for (const q of order) {
    if (x + q.w + pad > W) { x = pad; y += shelf + pad; shelf = 0; }
    q.x = x; q.y = y; x += q.w + pad; shelf = Math.max(shelf, q.h);
  }
  return [W, Math.max(1, y + shelf + pad)];
}

export interface ExportOptions {
  tickRate?: number;
  /** For maps (tiled): the project's assets as maps read them. */
  world?: MapWorld;
}

/** Export documents through a profile. */
export function exportProfile(prof: ProfileJson, docs: Doc[], o: ExportOptions = {}): ExportResult {
  const p = loadProfile(prof);
  const rate = o.tickRate ?? 60;
  const ms = (t: number) => ticksToMs(t, rate);
  const files = new Map<string, Uint8Array>();
  const notes: string[] = [];
  const put = (f: string, b: Uint8Array | string) => files.set(f, typeof b === 'string' ? enc(b) : b);
  const items = exportItems(p, docs);
  const colours = new Map<Doc, string[]>();
  const coloursOf = (d: Doc) => {
    let c = colours.get(d);
    if (!c) {
      c = encodedColours(d.palette, p.roles);
      const seen = new Map<string, string>();
      d.palette.entries.forEach((e, i) => {
        const k = c![i]!.toLowerCase(), was = seen.get(k);
        if (was) notes.push(`${d.name}: ${was} and ${e.name} are both written as ${k}; an import reads it back as ${was}`);
        else seen.set(k, e.name);
      });
      colours.set(d, c);
    }
    return c;
  };
  const png = (px: Uint16Array, w: number, h: number, d: Doc) => encodePng(indicesToRgba(px, w, h, coloursOf(d)));
  const levels = levelsOf(p);
  const how = new Map<string, number>();
  const pixels = (it: Item, d: number) => { const r = itemPixels(p, it, d, docs); if (d > 1) how.set(r.how, (how.get(r.how) ?? 0) + 1); return r.px; };
  const placeAll = (list: Item[], d: number, trim: boolean): Placed[] => list.map((it) => {
    const px = pixels(it, d);
    const W = it.w * d, H = it.h * d;
    const [bx, by, bw, bh] = trim ? trimBox(px, W, H) : [0, 0, W, H];
    return { it, px, x: 0, y: 0, w: bw, h: bh, cropX: bx, cropY: by, frameW: W, frameH: H };
  });

  if (p.layout === 'loose') {
    for (const d of levels) {
      const placed = placeAll(items, d, false);
      for (const pl of placed) put(levelFile(p, fillTemplate(p.image ?? '{name}.png', { name: pl.it.name, asset: pl.it.group }), d), png(pl.px, pl.frameW, pl.frameH, pl.it.doc));
      if (p.records) put(levelFile(p, p.records.file ?? `sprites.${p.records.format}`, d), recordsText(p, placed, '', d, [0, 0], ms));
    }
  } else if (p.layout === 'atlas') {
    const pad = p.page?.padding ?? 1;
    const pageName = p.page?.name ?? 'atlas';
    for (const d of levels) {
      const placed = placeAll(items, d, p.page?.trim !== false);
      const [W, H] = pack(placed, (p.page?.width ?? 256) * d, pad);
      const sheet = new Uint16Array(W * H).fill(TRANSPARENT);
      // One page holds every asset: its colours are each item's own, written as RGBA.
      const rgba = indicesToRgba(sheet, W, H, []);
      for (const pl of placed) {
        if (!pl.w) continue;
        const img = indicesToRgba(pl.px, pl.frameW, pl.frameH, coloursOf(pl.it.doc));
        for (let y = 0; y < pl.h; y++) rgba.data.set(img.data.subarray(((pl.cropY + y) * pl.frameW + pl.cropX) * 4, ((pl.cropY + y) * pl.frameW + pl.cropX + pl.w) * 4), ((pl.y + y) * W + pl.x) * 4);
      }
      const file = levelFile(p, fillTemplate(p.page?.file ?? '{page}.png', { page: pageName }), d);
      put(file, encodePng(rgba));
      const rec = p.records ?? { format: 'csv' as const };
      put(levelFile(p, fillTemplate(rec.file ?? `{page}.${rec.format}`, { page: pageName }), d), recordsText({ ...p, records: rec }, placed, file, d, [W, H], ms));
    }
  } else if (p.layout === 'sheet' || p.layout === 'aseprite-json') {
    const groups = [...new Set(items.map((i) => i.group))];
    for (const g of groups) {
      const list = items.filter((i) => i.group === g);
      const first = list[0]!.doc;
      const cols = p.layout === 'sheet' && first.family && !p.page?.columns ? layoutOf(first.family).cols : Math.max(1, Math.min(p.page?.columns ?? list.length, list.length));
      for (const d of levels) {
        const placed = placeAll(list, d, false);
        const cw = Math.max(...placed.map((q) => q.frameW)), ch = Math.max(...placed.map((q) => q.frameH));
        const pad = p.page?.padding ?? 0;
        let cells = placed.map((_, i) => i);
        if (p.layout === 'sheet' && first.family && !p.page?.columns) {
          // A family's sheet keeps the family's own layout (a frame below the last).
          const L = layoutOf(first.family);
          const rowsPer = L.rows - (first.family.mapRows ? first.family.mapRows : 0);
          cells = placed.map((q) => (Math.floor(q.it.y / first.family!.tile) + q.it.frame * rowsPer) * cols + Math.floor(q.it.x / first.family!.tile));
        }
        const rows = Math.max(...cells.map((c) => Math.floor(c / cols))) + 1;
        const W = cols * (cw + pad) - pad || 1, H = rows * (ch + pad) - pad || 1;
        const sheet = new Uint16Array(W * H).fill(TRANSPARENT);
        placed.forEach((q, i) => { q.x = (cells[i]! % cols) * (cw + pad); q.y = Math.floor(cells[i]! / cols) * (ch + pad); q.w = q.frameW; q.h = q.frameH; blitIdx(sheet, W, q.px, q.frameW, 0, 0, q.frameW, q.frameH, q.x, q.y); });
        const file = levelFile(p, fillTemplate(p.image ?? '{asset}.png', { asset: g, name: g }), d);
        put(file, png(sheet, W, H, first));
        if (p.layout === 'aseprite-json') {
          const doc = first;
          const json = {
            frames: placed.map((q) => ({
              filename: q.it.name, frame: { x: q.x, y: q.y, w: q.w, h: q.h }, rotated: false, trimmed: false,
              spriteSourceSize: { x: 0, y: 0, w: q.w, h: q.h }, sourceSize: { w: q.w, h: q.h }, duration: ms(q.it.ticks),
            })),
            meta: {
              app: 'https://github.com/pixelclaw', version: '1', image: file.split('/').pop(), format: 'RGBA8888', size: { w: W, h: H }, scale: String(d),
              frameTags: doc.family || list.length !== doc.frameCount ? [] : [
                ...doc.tags.map((t) => ({ name: t.name, from: t.from, to: t.to, direction: t.loop === 'pingpong' ? 'pingpong' : 'forward' })),
                ...doc.views.map((v) => ({ name: v.mirror ? `view ${v.name} mirror ${v.mirror}` : `view ${v.name}`, from: v.from, to: v.to, direction: 'forward' })),
              ],
              layers: [], slices: [],
            },
          };
          put(levelFile(p, `${g}.json`, d), JSON.stringify(json, null, 1) + '\n');
        } else if (p.records) put(levelFile(p, fillTemplate(p.records.file ?? `{asset}.${p.records.format}`, { asset: g, page: g }), d), recordsText(p, placed, file, d, [W, H], ms));
      }
    }
  } else if (p.layout === 'aseprite') {
    for (const doc of docs.filter((d) => included(p, d) && !d.map)) {
      put(`${doc.name}.aseprite`, writeAseprite(doc, rate, coloursOf(doc)));
      for (const c of docs.filter((x) => x.densityOf?.of === doc.name)) put(`${levelStem(p, doc.name, c.densityOf!.d)}.aseprite`, writeAseprite(c, rate, encodedColours(c.palette, p.roles)));
    }
  } else if (p.layout === 'tiled') exportTiled(p, docs, items, put, png, ms, o.world, notes);
  else exportGodot(p, docs, items, put, png, rate, notes);

  if (p.snippets) put(p.snippets.file, snippetText(p, docs, items, ms));
  for (const [k, n] of how) if (k !== 'authored') notes.push(`${n} images at a higher density were ${k} (no authored copy at that level)`);
  return { files, items, notes };
}

// --- animation snippets

function snippetText(p: ProfileJson, docs: Doc[], items: Item[], ms: (t: number) => number): string {
  const s = p.snippets!;
  const out: string[] = [];
  for (const g of [...new Set(items.map((i) => i.group))]) {
    const list = items.filter((i) => i.group === g);
    const doc = list[0]!.doc;
    const t = s.templates[doc.family ? 'family' : doc.kind] ?? s.templates.default;
    if (!t) continue;
    const fp = footprintOf(doc);
    const ticks = list.map((i) => i.ticks);
    out.push(fillTemplate(t, {
      asset: g, name: list[0]!.name, kind: doc.kind, frames: list.length, names: list.map((i) => `"${i.name}"`).join(', '), first: list[0]!.name,
      ticks: ticks.join(', '), ms: ticks.map(ms).join(', '), frameTicks: ticks[0] ?? 10,
      loop: doc.tags[0]?.loop ?? 'cycle', tags: doc.tags.map((x) => x.name).join(', '), views: doc.views.map((v) => v.name).join(', '),
      directions: doc.views.length || 1, mirror: doc.views.filter((v) => v.mirror).map((v) => `${v.name}=${v.mirror}`).join(', '),
      w: doc.width, h: doc.height, cols: fp.cols, rows: fp.rows, anchorX: fp.at[0] + fp.anchor[0], anchorY: fp.at[1] + fp.anchor[1],
      pivotX: doc.pivot?.[0] ?? '', pivotY: doc.pivot?.[1] ?? '', variants: docs.filter((v) => v.variantOf === g).length + 1,
      scheme: doc.family ? doc.family.def?.name ?? doc.family.scheme : '',
    }, SNIPPET_VARS));
  }
  return (s.header ? s.header + '\n' : '') + out.join(s.join ?? '\n') + (s.footer ? '\n' + s.footer : '') + '\n';
}

// --- Tiled: a .tsx per family (its sheet, wang set and frames), a collection for other tiles, .tmx maps

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A wang set's ids for a variant: [top, top-right, right, bottom-right, bottom, bottom-left, left, top-left] (1: the terrain). */
function wangId(neigh: string, key: number): number[] {
  const { N, NE, E, SE, S, SW, W, NW } = NB;
  const b = (m: number) => (key & m ? 1 : 0);
  if (neigh === 'corners') return [0, b(NE), 0, b(SE), 0, b(SW), 0, b(NW)];
  if (neigh === '4') return [b(N), 0, b(E), 0, b(S), 0, b(W), 0];
  return [b(N), b(NE), b(E), b(SE), b(S), b(SW), b(W), b(NW)];
}

/** A family's sheet with its frames stacked (each frame's tiles below the last), and the tile id of every item. */
function stackedSheet(items: Item[], doc: Doc): { px: Uint16Array; w: number; h: number; cols: number; perFrame: number; id: Map<Item, number> } {
  const t = doc.family!.tile, L = layoutOf(doc.family!);
  const rowsPer = L.rows - doc.family!.mapRows;
  const w = L.cols * t, h = rowsPer * t * doc.frameCount;
  const px = new Uint16Array(w * h).fill(TRANSPARENT);
  const id = new Map<Item, number>();
  for (const it of items) {
    const cx = it.x / t, cy = it.y / t + it.frame * rowsPer;
    blitIdx(px, w, flatten(it.doc, it.frame), it.doc.width, it.x, it.y, t, t, cx * t, cy * t);
    id.set(it, cy * L.cols + cx);
  }
  return { px, w, h, cols: L.cols, perFrame: rowsPer * L.cols, id };
}

function exportTiled(p: ProfileJson, docs: Doc[], items: Item[], put: (f: string, b: Uint8Array | string) => void, png: (px: Uint16Array, w: number, h: number, d: Doc) => Uint8Array, ms: (t: number) => number, world: MapWorld | undefined, notes: string[]): void {
  const famDocs = [...new Set(items.filter((i) => i.doc.family).map((i) => i.doc))];
  const tsxIds = new Map<string, Map<string, number>>(); // doc name → item cell@frame → tile id
  for (const doc of famDocs) {
    const list = items.filter((i) => i.doc === doc);
    const sh = stackedSheet(list, doc);
    const s = schemeOf(doc.family!), t = doc.family!.tile;
    put(`${doc.name}.png`, png(sh.px, sh.w, sh.h, doc));
    const ids = new Map<string, number>();
    const tiles: string[] = [];
    for (const it of list) {
      ids.set(`${it.cell}@${it.frame}`, sh.id.get(it)!);
      if (it.frame) continue;
      const anim = doc.frameCount > 1 ? [`   <animation>`, ...Array.from({ length: doc.frameCount }, (_, f) => `    <frame tileid="${sh.id.get(it)! + f * sh.perFrame}" duration="${ms(doc.ticks[f]!)}"/>`), `   </animation>`] : [];
      tiles.push(`  <tile id="${sh.id.get(it)}">`, `   <properties>`, `    <property name="name" value="${xmlEsc(it.name)}"/>`, `    <property name="variant" value="${xmlEsc(it.cell!)}"/>`, `   </properties>`, ...anim, `  </tile>`);
    }
    for (const it of list.filter((i) => i.frame > 0)) tiles.push(`  <tile id="${sh.id.get(it)}">`, `   <properties>`, `    <property name="name" value="${xmlEsc(it.name)}"/>`, `   </properties>`, `  </tile>`);
    tsxIds.set(doc.name, ids);
    const type = s.neighbours === 'corners' ? 'corner' : s.neighbours === '4' ? 'edge' : s.neighbours === '8' ? 'mixed' : null;
    const wang = type ? [
      ` <wangsets>`, `  <wangset name="${xmlEsc(doc.name)}" type="${type}" tile="-1">`, `   <wangcolor name="${xmlEsc(doc.name)}" color="#ff0000" tile="-1" probability="1"/>`,
      ...s.variants.flatMap((v, i) => (v.key === null || v.on ? [] : [`   <wangtile tileid="${sh.id.get(list.find((x) => x.cell === v.name && x.frame === 0)!)}" wangid="${wangId(s.neighbours, v.key).join(',')}"/>`])).filter((_, i) => i >= 0),
      `  </wangset>`, ` </wangsets>`,
    ] : [];
    put(`${doc.name}.tsx`, [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<tileset version="1.10" tiledversion="1.10.2" name="${xmlEsc(doc.name)}" tilewidth="${t}" tileheight="${t}" tilecount="${sh.cols * (sh.h / t)}" columns="${sh.cols}">`,
      ` <image source="${xmlEsc(doc.name)}.png" width="${sh.w}" height="${sh.h}"/>`, ...tiles, ...wang, `</tileset>`, '',
    ].join('\n'));
  }
  // Every other image: a collection of single images.
  const loose = items.filter((i) => !i.doc.family);
  if (loose.length) {
    const tiles = loose.flatMap((it, k) => {
      put(`tiles/${it.name}.png`, png(itemPixels(p, it, 1, docs).px, it.w, it.h, it.doc));
      return [`  <tile id="${k}">`, `   <properties>`, `    <property name="name" value="${xmlEsc(it.name)}"/>`, `   </properties>`, `   <image width="${it.w}" height="${it.h}" source="tiles/${xmlEsc(it.name)}.png"/>`, `  </tile>`];
    });
    put(`tiles.tsx`, [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<tileset version="1.10" tiledversion="1.10.2" name="tiles" tilewidth="${Math.max(...loose.map((i) => i.w))}" tileheight="${Math.max(...loose.map((i) => i.h))}" tilecount="${loose.length}" columns="0">`,
      ` <grid orientation="orthogonal" width="1" height="1"/>`, ...tiles, `</tileset>`, '',
    ].join('\n'));
  }
  // Maps: tile layers of the families' and tiles' gids, objects as tile objects.
  for (const m of docs.filter((d) => d.map && included(p, d))) {
    if (!world) { notes.push(`${m.name}: maps need the project's assets`); continue; }
    const sets: { source: string; first: number; count: number; name: string }[] = [];
    let next = 1;
    for (const doc of famDocs) { const L = layoutOf(doc.family!); const count = L.cols * (L.rows - doc.family!.mapRows) * doc.frameCount; sets.push({ source: `${doc.name}.tsx`, first: next, count, name: doc.name }); next += count; }
    const looseFirst = next;
    if (loose.length) sets.push({ source: 'tiles.tsx', first: next, count: loose.length, name: 'tiles' });
    const firstOf = (n: string) => sets.find((s) => s.name === n)?.first;
    const looseGid = (asset: string, frame = 0) => { const k = loose.findIndex((i) => i.doc.name === asset && i.frame === frame); return k < 0 ? 0 : looseFirst + k; };
    const t = m.map!.tile, cols = m.width, rows = m.height;
    const layersXml: string[] = [];
    let nextObj = 1;
    m.layers.forEach((l, li) => {
      const info = l.map;
      if (!info || info.kind === 'overlay') return;
      const solo: Doc = { ...m, layers: m.layers.map((x, j) => ({ ...x, hidden: j !== li })) };
      const c = composeMapDoc(solo, world);
      if (info.kind === 'objects') {
        layersXml.push(`  <objectgroup id="${li + 1}" name="${xmlEsc(l.name)}"${l.hidden ? ' visible="0"' : ''}>`);
        for (const o of c.objects.filter((q) => q.layer === li && q.doc)) {
          const e = m.map!.entries[o.entry]!;
          layersXml.push(`   <object id="${nextObj++}" name="${xmlEsc(e.name)}" gid="${looseGid(o.doc!.name)}" x="${o.px}" y="${o.py + o.doc!.height}" width="${o.doc!.width}" height="${o.doc!.height}">`,
            `    <properties>`, `     <property name="cell" value="${o.x},${o.y}"/>`, `     <property name="footprint" value="${e.cols}x${e.rows}"/>`,
            `     <property name="anchor" value="${e.anchor.join(',')}"/>`, `     <property name="flags" value="${xmlEsc(o.fp.flags.join('/'))}"/>`, `    </properties>`, `   </object>`);
        }
        layersXml.push(`  </objectgroup>`);
        return;
      }
      const gids = c.top.map((ct) => {
        if (!ct) return 0;
        const ids = tsxIds.get(ct.asset);
        if (ids) { const k = ids.get(`${ct.variant}@0`); return k === undefined ? 0 : firstOf(ct.asset)! + k; }
        return looseGid(ct.asset);
      });
      const csv = Array.from({ length: rows }, (_, y) => gids.slice(y * cols, y * cols + cols).join(',')).join(',\n');
      layersXml.push(`  <layer id="${li + 1}" name="${xmlEsc(l.name)}" width="${cols}" height="${rows}"${l.hidden ? ' visible="0"' : ''}>\n   <data encoding="csv">\n${csv}\n</data>\n  </layer>`);
    });
    put(`${m.name}.tmx`, [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<map version="1.10" tiledversion="1.10.2" orientation="orthogonal" renderorder="right-down" width="${cols}" height="${rows}" tilewidth="${t}" tileheight="${t}" infinite="0" nextlayerid="${m.layers.length + 1}" nextobjectid="${nextObj}">`,
      ...sets.map((s) => ` <tileset firstgid="${s.first}" source="${xmlEsc(s.source)}"/>`), ...layersXml, `</map>`, '',
    ].join('\n'));
  }
}

// --- Godot 4: a TileSet resource per family with a terrain set (matching sides, corners or both)

const GODOT_BITS: [number, string][] = [[NB.E, 'right_side'], [NB.SE, 'bottom_right_corner'], [NB.S, 'bottom_side'], [NB.SW, 'bottom_left_corner'], [NB.W, 'left_side'], [NB.NW, 'top_left_corner'], [NB.N, 'top_side'], [NB.NE, 'top_right_corner']];

function exportGodot(p: ProfileJson, docs: Doc[], items: Item[], put: (f: string, b: Uint8Array | string) => void, png: (px: Uint16Array, w: number, h: number, d: Doc) => Uint8Array, rate: number, notes: string[]): void {
  const famDocs = [...new Set(items.filter((i) => i.doc.family).map((i) => i.doc))];
  const skipped = items.filter((i) => !i.doc.family).map((i) => i.doc.name);
  if (skipped.length) notes.push(`godot: only families are written (terrains); left out ${[...new Set(skipped)].join(', ')}`);
  for (const doc of famDocs) {
    const list = items.filter((i) => i.doc === doc);
    const s = schemeOf(doc.family!), t = doc.family!.tile, L = layoutOf(doc.family!);
    const rowsPer = L.rows - doc.family!.mapRows;
    // Frames side by side: frame f of a tile is f sheets to the right (animation_separation).
    const w = L.cols * t * doc.frameCount, h = rowsPer * t;
    const px = new Uint16Array(w * h).fill(TRANSPARENT);
    for (const it of list) blitIdx(px, w, flatten(doc, it.frame), doc.width, it.x, it.y, t, t, it.x + it.frame * L.cols * t, it.y);
    put(`${doc.name}.png`, png(px, w, h, doc));
    const mode = s.neighbours === 'corners' ? 1 : s.neighbours === '4' ? 2 : 0;
    const lines: string[] = [];
    for (const it of list.filter((i) => i.frame === 0)) {
      const k = `${it.x / t}:${it.y / t}/0`;
      const base = k.slice(0, -2);
      if (doc.frameCount > 1) {
        lines.push(`${base}/animation_separation = Vector2i(${L.cols - 1}, 0)`);
        for (let f = 0; f < doc.frameCount; f++) lines.push(`${base}/animation_frame_${f}/duration = ${(doc.ticks[f]! / rate).toFixed(4)}`);
      }
      lines.push(`${k} = 0`, `${k}/custom_data_0 = "${it.name}"`);
      const vi = s.byName.get(it.cell!);
      const v = vi === undefined ? null : s.variants[vi]!;
      if (v && v.key !== null && !v.on) {
        lines.push(`${k}/terrain_set = 0`, `${k}/terrain = 0`);
        const want = mode === 1 ? GODOT_BITS.filter(([b]) => b & (NB.NE | NB.SE | NB.SW | NB.NW)) : mode === 2 ? GODOT_BITS.filter(([b]) => b & (NB.N | NB.E | NB.S | NB.W)) : GODOT_BITS;
        for (const [b, nm] of want) if (v.key & b) lines.push(`${k}/terrains_peering_bit/${nm} = 0`);
      }
    }
    const [r, g, b] = rgbOf(doc.palette.entries[0]?.hex ?? '#808080');
    put(`${doc.name}.tres`, [
      `[gd_resource type="TileSet" load_steps=3 format=3]`, '',
      `[ext_resource type="Texture2D" path="res://${doc.name}.png" id="1_tex"]`, '',
      `[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_1"]`, `texture = ExtResource("1_tex")`, `texture_region_size = Vector2i(${t}, ${t})`, ...lines, '',
      `[resource]`, `tile_size = Vector2i(${t}, ${t})`, `terrain_set_0/mode = ${mode}`, `terrain_set_0/terrain_0/name = "${doc.name}"`,
      `terrain_set_0/terrain_0/color = Color(${(r / 255).toFixed(3)}, ${(g / 255).toFixed(3)}, ${(b / 255).toFixed(3)}, 1)`,
      `custom_data_layer_0/name = "name"`, `custom_data_layer_0/type = 4`, `sources/0 = SubResource("TileSetAtlasSource_1")`, '',
    ].join('\n'));
  }
}

// --- import

export interface ImportedImage {
  name: string;
  d: number;
  img: Rgba;
}

export interface ImportedAssetFrames {
  /** The asset's frames at 1x (or the authored density copy's at its level), flattened, as palette indices. */
  frames: Uint16Array[];
  /** Pixels that were not exactly a palette colour. */
  inexact: number;
  images: number;
}

export interface ImportResult {
  /** By asset (density copies under their own names). */
  assets: Map<string, ImportedAssetFrames>;
  /** Images whose names no known asset exports (new art). */
  unknown: ImportedImage[];
  notes: string[];
}

const textOf = (files: Map<string, Uint8Array>, f: string) => { const b = files.get(f); if (!b) throw new ProfileError(`no file '${f}'`); return dec(b); };
const pngOf = (files: Map<string, Uint8Array>, f: string) => { const b = files.get(f); if (!b) throw new ProfileError(`no image '${f}'`); return decodePng(b); };
const dirOf = (f: string) => (f.includes('/') ? f.slice(0, f.lastIndexOf('/') + 1) : '');

/** Parse CSV (quoted cells with "" escapes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

/** Records back as objects (CSV with or without a header, or the JSON records file). */
function readRecords(p: ProfileJson, text: string): Record<string, string | number>[] {
  const r = p.records ?? { format: 'csv' };
  if (r.format === 'json') return (JSON.parse(text) as { sprites: Record<string, string | number>[] }).sprites;
  const rows = parseCsv(text);
  const cols = r.header === false ? r.columns ?? DEFAULT_COLUMNS : rows.shift() ?? [];
  return rows.map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i] ?? ''])));
}

/** Where an image sits in a record: its trimmed box on the page and its place in the full frame. */
function fromRecord(page: Rgba, r: Record<string, string | number>): Rgba {
  const n = (k: string, dflt = 0) => (r[k] === undefined || r[k] === '' ? dflt : Number(r[k]));
  const w = n('w'), h = n('h');
  const fw = n('frameW', w), fh = n('frameH', h);
  const out = { width: fw, height: fh, data: new Uint8Array(fw * fh * 4) };
  const part = cropRgba(page, n('x'), n('y'), w, h);
  for (let y = 0; y < h; y++) out.data.set(part.data.subarray(y * w * 4, (y + 1) * w * 4), ((n('cropY') + y) * fw + n('cropX')) * 4);
  return out;
}

/** Find a file of an export by its level-free name at level d. */
const fileAt = (p: ProfileJson, files: Map<string, Uint8Array>, f: string, d: number) => { const k = levelFile(p, f, d); return files.has(k) ? k : null; };

/** The images a profile wrote, read back by name and level. Needs the documents it exported (for sheets and the item names). */
export function readProfileImages(prof: ProfileJson, files: Map<string, Uint8Array>, docs: Doc[]): { images: ImportedImage[]; notes: string[] } {
  const p = loadProfile(prof);
  const images: ImportedImage[] = [];
  const notes: string[] = [];
  const levels = levelsOf(p);
  const items = exportItems(p, docs);
  if (p.layout === 'loose') {
    const tpl = p.image ?? '{name}.png';
    for (const d of levels) for (const it of items) {
      const f = fileAt(p, files, fillTemplate(tpl, { name: it.name, asset: it.group }), d);
      if (f) images.push({ name: it.name, d, img: pngOf(files, f) });
    }
    // Files no item names: new art, by file stem.
    const known = new Set(levels.flatMap((d) => items.map((it) => levelFile(p, fillTemplate(tpl, { name: it.name, asset: it.group }), d))));
    for (const f of [...files.keys()].sort()) if (f.endsWith('.png') && !known.has(f)) {
      const m = /^(.*?)(?:@(\d)x)?\.png$/.exec(f.split('/').pop()!)!;
      images.push({ name: m[1]!, d: Number(m[2] ?? 1), img: pngOf(files, f) });
    }
  } else if (p.layout === 'atlas') {
    const pageName = p.page?.name ?? 'atlas';
    const rec = p.records ?? { format: 'csv' as const };
    for (const d of levels) {
      const rf = fileAt(p, files, fillTemplate(rec.file ?? `{page}.${rec.format}`, { page: pageName }), d);
      const pf = fileAt(p, files, fillTemplate(p.page?.file ?? '{page}.png', { page: pageName }), d);
      if (!rf || !pf) continue;
      const page = pngOf(files, pf);
      for (const r of readRecords({ ...p, records: rec }, textOf(files, rf))) images.push({ name: String(r.sprite), d, img: fromRecord(page, r) });
    }
  } else if (p.layout === 'sheet') {
    // Sheets are read through the same layout as they were written.
    for (const g of [...new Set(items.map((i) => i.group))]) for (const d of levels) {
      const f = fileAt(p, files, fillTemplate(p.image ?? '{asset}.png', { asset: g, name: g }), d);
      if (!f) continue;
      const sheet = pngOf(files, f);
      for (const pl of sheetPlaces(p, items.filter((i) => i.group === g), d)) images.push({ name: pl.name, d, img: cropRgba(sheet, pl.x, pl.y, pl.w, pl.h) });
    }
  } else if (p.layout === 'aseprite-json') {
    for (const f of [...files.keys()].sort()) {
      if (!f.endsWith('.json')) continue;
      const j = JSON.parse(textOf(files, f)) as { frames: { filename: string; frame: { x: number; y: number; w: number; h: number } }[]; meta: { image: string; scale?: string } };
      if (!j.meta?.image) continue;
      const sheet = pngOf(files, dirOf(f) + j.meta.image);
      const d = Number(j.meta.scale ?? 1) || 1;
      for (const fr of j.frames) images.push({ name: fr.filename, d, img: cropRgba(sheet, fr.frame.x, fr.frame.y, fr.frame.w, fr.frame.h) });
    }
  } else if (p.layout === 'tiled') {
    for (const f of [...files.keys()].sort()) {
      if (!f.endsWith('.tsx')) continue;
      const x = textOf(files, f);
      const tw = Number(/tilewidth="(\d+)"/.exec(x)?.[1]), th = Number(/tileheight="(\d+)"/.exec(x)?.[1]);
      const cols = Number(/columns="(\d+)"/.exec(x)?.[1]);
      const sheetSrc = /<tileset[^>]*>\s*<image source="([^"]+)"/.exec(x)?.[1];
      const sheet = sheetSrc ? pngOf(files, dirOf(f) + sheetSrc) : null;
      for (const m of x.matchAll(/<tile id="(\d+)">([\s\S]*?)<\/tile>/g)) {
        const id = Number(m[1]);
        const name = /<property name="name" value="([^"]*)"/.exec(m[2]!)?.[1];
        if (!name) continue;
        const own = /<image width="\d+" height="\d+" source="([^"]+)"/.exec(m[2]!)?.[1];
        const img = own ? pngOf(files, dirOf(f) + own) : sheet ? cropRgba(sheet, (id % cols) * tw, Math.floor(id / cols) * th, tw, th) : null;
        if (img) images.push({ name: unXml(name), d: 1, img });
      }
    }
  } else if (p.layout === 'godot') {
    for (const f of [...files.keys()].sort()) {
      if (!f.endsWith('.tres')) continue;
      const x = textOf(files, f);
      const tex = /path="res:\/\/([^"]+)"/.exec(x)?.[1];
      const size = /texture_region_size = Vector2i\((\d+), (\d+)\)/.exec(x);
      if (!tex || !size) continue;
      const sheet = pngOf(files, dirOf(f) + tex);
      const t = Number(size[1]);
      for (const m of x.matchAll(/^(\d+):(\d+)\/0\/custom_data_0 = "([^"]*)"$/gm)) {
        const cx = Number(m[1]), cy = Number(m[2]);
        const sep = new RegExp(`^${cx}:${cy}/animation_separation = Vector2i\\((\\d+), 0\\)$`, 'm').exec(x);
        const frames = [...x.matchAll(new RegExp(`^${cx}:${cy}/animation_frame_(\\d+)/duration`, 'gm'))].length || 1;
        const first = items.find((i) => i.name === m[3]);
        for (let fr = 0; fr < frames; fr++) {
          const name = fr === 0 ? m[3]! : items.find((i) => first && i.doc === first.doc && i.cell === first.cell && i.frame === fr)?.name;
          if (name) images.push({ name, d: 1, img: cropRgba(sheet, (cx + fr * (Number(sep?.[1] ?? 0) + 1)) * t, cy * t, t, t) });
        }
      }
    }
  }
  return { images, notes };
}

const unXml = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Where a sheet's images are (as `exportProfile` lays them out). */
function sheetPlaces(p: ProfileJson, list: Item[], d: number): { name: string; x: number; y: number; w: number; h: number }[] {
  const first = list[0]!.doc;
  const fam = first.family && !p.page?.columns ? first.family : null;
  const cols = fam ? layoutOf(fam).cols : Math.max(1, Math.min(p.page?.columns ?? list.length, list.length));
  const cw = Math.max(...list.map((i) => i.w * d)), ch = Math.max(...list.map((i) => i.h * d));
  const pad = p.page?.padding ?? 0;
  const rowsPer = fam ? layoutOf(fam).rows - fam.mapRows : 0;
  return list.map((it, i) => {
    const c = fam ? (Math.floor(it.y / fam.tile) + it.frame * rowsPer) * cols + Math.floor(it.x / fam.tile) : i;
    return { name: it.name, x: (c % cols) * (cw + pad), y: Math.floor(c / cols) * (ch + pad), w: it.w * d, h: it.h * d };
  });
}

/**
 * Import a profile's files back into the documents they came from: every image is sliced by name
 * and level, quantised to its asset's palette (role colours decoded through the profile) and put
 * where it belongs in its frame. Images no known asset exports come back as `unknown`.
 */
export function importProfile(prof: ProfileJson, files: Map<string, Uint8Array>, docs: Doc[]): ImportResult {
  const p = loadProfile(prof);
  const assets = new Map<string, ImportedAssetFrames>();
  const notes: string[] = [];
  if (p.layout === 'aseprite') {
    for (const f of [...files.keys()].sort()) {
      if (!/\.(aseprite|ase)$/.test(f)) continue;
      const stem = f.split('/').pop()!.replace(/\.(aseprite|ase)$/, '');
      const doc = docs.find((d) => d.name === stem) ?? docs.find((d) => levelStem(p, d.densityOf?.of ?? '', d.densityOf?.d ?? 0) === stem);
      if (!doc) { notes.push(`${f}: no asset named '${stem}'`); continue; }
      const parts = aseParts(readAseprite(files.get(f)!));
      const cols = encodedColours(doc.palette, p.roles);
      let inexact = 0;
      const frames = parts.ms.map((_, fr) => {
        const flat = new Uint16Array(parts.width * parts.height).fill(TRANSPARENT);
        parts.layers.forEach((l, li) => {
          if (l.hidden || l.reference) return;
          const img = parts.rgba[li]![fr];
          if (!img) return;
          const q = quantise({ width: parts.width, height: parts.height, data: img }, doc.palette, cols);
          inexact += q.inexact;
          for (let i = 0; i < flat.length; i++) if (q.px[i] !== TRANSPARENT) flat[i] = q.px[i]!;
        });
        return flat;
      });
      assets.set(doc.name, { frames, inexact, images: frames.length });
    }
    return { assets, unknown: [], notes };
  }
  const { images, notes: n2 } = readProfileImages(p, files, docs);
  notes.push(...n2);
  const items = exportItems(p, docs);
  const byName = new Map(items.map((i) => [i.name, i]));
  const unknown: ImportedImage[] = [];
  for (const im of images) {
    const it = byName.get(im.name);
    if (!it) { unknown.push(im); continue; }
    const target = im.d === 1 ? it.doc : docs.find((x) => x.densityOf?.of === it.doc.name && x.densityOf.d === im.d);
    if (!target) continue; // a reduced or scaled level: derived, not authored
    const d = im.d;
    let a = assets.get(target.name);
    if (!a) assets.set(target.name, (a = { frames: Array.from({ length: target.frameCount }, () => new Uint16Array(target.width * target.height).fill(TRANSPARENT)), inexact: 0, images: 0 }));
    const q = quantise(im.img, it.doc.palette, encodedColours(it.doc.palette, p.roles));
    a.inexact += q.inexact;
    a.images++;
    const px = target === it.doc ? q.px : remapByName(q.px, it.doc.palette, target.palette);
    const fr = a.frames[Math.min(it.frame, target.frameCount - 1)]!;
    blitIdx(fr, target.width, px, im.img.width, 0, 0, Math.min(im.img.width, it.w * d), Math.min(im.img.height, it.h * d), it.x * d, it.y * d);
    // A mirror view left out (flag) is the engine's to draw: fill it from its source.
    if (it.mirror) {
      const mv = it.doc.views.find((v) => v.name === it.mirror)!;
      const sv = it.doc.views.find((v) => v.name === it.view)!;
      const mf = mv.from + (it.frame - sv.from);
      if (mf <= mv.to) {
        const dst = a.frames[mf]!;
        for (let y = 0; y < target.height; y++) for (let x = 0; x < target.width; x++) dst[y * target.width + x] = fr[y * target.width + target.width - 1 - x]!;
      }
    }
  }
  return { assets, unknown, notes };
}

/** Do the imported frames equal the documents' own (each asset's flattened frames)? Lists the ones that differ. */
export function roundTripDiffs(r: ImportResult, docs: Doc[]): string[] {
  const out: string[] = [];
  for (const [name, a] of r.assets) {
    const d = docs.find((x) => x.name === name)!;
    a.frames.forEach((px, f) => {
      const want = flatten(d, f);
      let n = 0;
      for (let i = 0; i < px.length; i++) if (px[i] !== want[i]) n++;
      if (n) out.push(`${name} frame ${f + 1}: ${n} pixels differ`);
    });
  }
  return out;
}

export function filesFromText(o: Record<string, string>): Map<string, Uint8Array> {
  return new Map(Object.entries(o).map(([k, v]) => [k, enc(v)]));
}

