// The manifest (plan §7.3): the asset plan a project is built from, written by the agent from the
// game's description. Every asset has a name, a kind, a size and a set, and as its kind needs a
// scheme and band (families), frames and views (sprites), a footprint (objects) and the expected
// height of its drawn shape (the consistency check's size measure). Its status is worked out from
// the project, never written by hand:
//
//   planned   in the manifest, not drawn yet
//   drafted   the asset exists
//   checked   every check passes
//   reviewed  a `mark reviewed` on its tape, with the art unchanged since (the blind review's
//             findings brought back and dealt with)
//   approved  a `mark approved` (a person, in the dashboard), the art unchanged since
//   exported  written through a profile (exported.json) with the art as it is now
//
// Each stage needs the ones before it; a later `mark rejected` sends an approval back.

import { parseChars } from './font.ts';
import { DOC_KINDS, type DocKind, type Mark } from './doc.ts';

export const MANIFEST_FORMAT = 'pixelclaw-manifest';
export const STATUSES = ['planned', 'drafted', 'checked', 'reviewed', 'approved', 'exported'] as const;
export type Status = (typeof STATUSES)[number];
export const VIEW_DIRS = ['S', 'N', 'E', 'W'] as const;

export interface ManifestAsset {
  name: string;
  kind: DocKind;
  /** Pixels "WxH" (a family: its tile; a map: cells "CxR"). */
  size: string;
  /** The group it is judged, reviewed and shown with (default: its kind). */
  set?: string;
  description?: string;
  palette?: string;
  /** Families: the autotile scheme, the inside and outside tiles, and the band profile (`3:outside 1:foam 2:sand0 radius=3`). */
  scheme?: string;
  inside?: string;
  outside?: string;
  band?: string;
  /** Animation: frames per view (or in all), ticks per frame. */
  frames?: number;
  ticks?: number;
  /** Sprites: the directions it faces, and which are mirrors (`{ "W": "E" }`). */
  views?: string[];
  mirror?: Record<string, string>;
  /** Objects: the footprint in cells "CxR". */
  cells?: string;
  /** The height of the drawn shape in pixels (the consistency check holds the art to it). */
  height?: number;
  /** A texture variant or recolour of another asset of the manifest. */
  variantOf?: string;
  recolourOf?: string;
  /** Maps: the assets they are built from. */
  uses?: string[];
  /** The flat colour templates draw it in (a palette entry name or #rrggbb). */
  flat?: string;
  /** Fonts: the characters, as `new font … chars=` takes them ("32-126", "U+0041-U+005A", or the characters themselves). */
  chars?: string;
}

export interface Manifest {
  format: typeof MANIFEST_FORMAT;
  version: 1;
  /** The game's theme, in a paragraph. */
  theme: string;
  sets?: Record<string, { description?: string }>;
  /** The export profile (and folder) the project ships through. */
  export?: { profile: string; dest?: string };
  assets: ManifestAsset[];
}

export interface ManifestError {
  /** Where: `assets[3].size`. */
  path: string;
  message: string;
}

/** What the project offers that a manifest may name; unknown names are errors only when a list is given. */
export interface ManifestKnown {
  palettes?: string[];
  schemes?: string[];
  profiles?: string[];
}

const NAME_RE = /^[a-z][a-z0-9_-]*$/;
const SIZE_RE = /^(\d+)x(\d+)$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const ASSET_KEYS = new Set([
  'name', 'kind', 'size', 'set', 'description', 'palette', 'scheme', 'inside', 'outside', 'band', 'frames', 'ticks', 'views', 'mirror', 'cells',
  'height', 'variantOf', 'recolourOf', 'uses', 'flat', 'chars',
]);
const TOP_KEYS = new Set(['format', 'version', 'theme', 'sets', 'export', 'assets']);

export function parseSize(s: string): [number, number] | null {
  const m = SIZE_RE.exec(s);
  return m && Number(m[1]) > 0 && Number(m[2]) > 0 ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * Check a manifest against its schema and against itself (unique names, references to assets it
 * plans) and, when given, what the project has. Returns the manifest (when the shape is right) and
 * every error with its path.
 */
export function validateManifest(json: unknown, known: ManifestKnown = {}): { manifest: Manifest | null; errors: ManifestError[] } {
  const errors: ManifestError[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { manifest: null, errors: [{ path: '', message: 'a manifest is a JSON object' }] };
  const m = json as Record<string, unknown>;
  for (const k of Object.keys(m)) if (!TOP_KEYS.has(k)) err(k, `unknown field '${k}' (fields: ${[...TOP_KEYS].join(', ')})`);
  if (m.format !== MANIFEST_FORMAT) err('format', `must be "${MANIFEST_FORMAT}"`);
  if (m.version !== 1) err('version', 'must be 1');
  if (typeof m.theme !== 'string' || !m.theme.trim()) err('theme', 'the theme is a paragraph of text');
  const sets = m.sets;
  if (sets !== undefined) {
    if (!sets || typeof sets !== 'object' || Array.isArray(sets)) err('sets', 'an object of set names');
    else for (const [k, v] of Object.entries(sets)) {
      if (!NAME_RE.test(k)) err(`sets.${k}`, 'set names use a-z, 0-9, _ and -, starting with a letter');
      if (!v || typeof v !== 'object' || (v as { description?: unknown }).description !== undefined && typeof (v as { description?: unknown }).description !== 'string') err(`sets.${k}`, 'a set is { "description": "…" }');
    }
  }
  const ex = m.export as Record<string, unknown> | undefined;
  if (ex !== undefined) {
    if (!ex || typeof ex !== 'object' || typeof ex.profile !== 'string') err('export', 'export is { "profile": "<name>", "dest": "<folder>" }');
    else {
      if (known.profiles && !known.profiles.includes(ex.profile)) err('export.profile', `no profile '${ex.profile}' (profiles: ${known.profiles.join(', ')})`);
      if (ex.dest !== undefined && typeof ex.dest !== 'string') err('export.dest', 'a folder path');
    }
  }
  if (!Array.isArray(m.assets)) {
    err('assets', 'a list of assets');
    return { manifest: null, errors };
  }
  const names = new Map<string, number>();
  const list = m.assets as unknown[];
  list.forEach((x, i) => {
    const n = (x as { name?: unknown })?.name;
    if (typeof n === 'string') {
      if (names.has(n)) err(`assets[${i}].name`, `'${n}' is already assets[${names.get(n)}]`);
      else names.set(n, i);
    }
  });
  const kindOf = (n: string) => (list[names.get(n) ?? -1] as { kind?: string } | undefined)?.kind;
  list.forEach((x, i) => {
    const at = (k: string) => `assets[${i}].${k}`;
    if (!x || typeof x !== 'object' || Array.isArray(x)) { err(`assets[${i}]`, 'an asset is an object'); return; }
    const a = x as Record<string, unknown>;
    for (const k of Object.keys(a)) if (!ASSET_KEYS.has(k)) err(at(k), `unknown field '${k}'`);
    if (typeof a.name !== 'string' || !NAME_RE.test(a.name)) err(at('name'), 'a name uses a-z, 0-9, _ and -, starting with a letter');
    const kind = a.kind as DocKind;
    if (!DOC_KINDS.includes(kind)) err(at('kind'), `one of ${DOC_KINDS.join(', ')}`);
    const size = typeof a.size === 'string' ? parseSize(a.size) : null;
    if (!size) err(at('size'), kind === 'map' ? 'cells like "40x30"' : 'pixels like "24x24"');
    else if (kind === 'family' && (size[0] !== size[1] || size[0] % 2)) err(at('size'), `a family's tiles are square and even (${a.size})`);
    else if (kind !== 'map' && (size[0] > 4096 || size[1] > 4096)) err(at('size'), 'at most 4096 px a side');
    const str = (k: string) => { if (a[k] !== undefined && typeof a[k] !== 'string') err(at(k), 'text'); };
    for (const k of ['set', 'description', 'palette', 'scheme', 'inside', 'outside', 'band', 'cells', 'variantOf', 'recolourOf', 'flat']) str(k);
    if (typeof a.set === 'string' && !NAME_RE.test(a.set)) err(at('set'), 'set names use a-z, 0-9, _ and -, starting with a letter');
    if (typeof a.palette === 'string' && known.palettes && !known.palettes.includes(a.palette)) err(at('palette'), `no palette '${a.palette}' in the project`);
    if (kind === 'family') {
      if (typeof a.scheme !== 'string') err(at('scheme'), 'a family needs a scheme');
      else if (known.schemes && !known.schemes.includes(a.scheme)) err(at('scheme'), `no scheme '${a.scheme}' (schemes: ${known.schemes.join(', ')})`);
      if (typeof a.band === 'string' && !/^(\d+:[A-Za-z0-9_-]+\s*)+(\s+(radius|inset|fillet)=\d+)*$/.test(a.band.trim())) err(at('band'), 'a band profile like "3:outside 1:foam 2:sand0 radius=3"');
    } else {
      for (const k of ['scheme', 'inside', 'outside', 'band']) if (a[k] !== undefined) err(at(k), `${k} is for families`);
    }
    for (const k of ['inside', 'outside'] as const) {
      const v = a[k];
      if (typeof v === 'string' && v !== 'none' && names.has(v) && !['tile', 'family'].includes(kindOf(v) ?? '')) err(at(k), `'${v}' is not a tile`);
    }
    const int = (k: string, lo: number, hi: number) => {
      if (a[k] !== undefined && (!Number.isInteger(a[k]) || (a[k] as number) < lo || (a[k] as number) > hi)) err(at(k), `a whole number ${lo}..${hi}`);
    };
    int('frames', 1, 256);
    int('ticks', 1, 600);
    if (a.height !== undefined) {
      int('height', 1, 4096);
      if (size && Number.isInteger(a.height) && (a.height as number) > size[1]) err(at('height'), `taller than its size (${a.size})`);
    }
    if (a.views !== undefined) {
      if (!Array.isArray(a.views) || !a.views.every((v) => (VIEW_DIRS as readonly unknown[]).includes(v)) || new Set(a.views).size !== a.views.length) err(at('views'), `directions from ${VIEW_DIRS.join(', ')}, each once`);
      if (!['sprite', 'object', 'sheet'].includes(kind)) err(at('views'), 'views are for sprites and objects');
    }
    if (a.mirror !== undefined) {
      const views = Array.isArray(a.views) ? (a.views as string[]) : [];
      if (!a.mirror || typeof a.mirror !== 'object' || Array.isArray(a.mirror)) err(at('mirror'), 'an object like { "W": "E" }');
      else for (const [k, v] of Object.entries(a.mirror)) {
        if (!views.includes(k) || typeof v !== 'string' || !views.includes(v) || k === v) err(at(`mirror.${k}`), `a mirror pairs two of the asset's views (${views.join(', ') || 'none'})`);
      }
    }
    if (a.cells !== undefined) {
      if (typeof a.cells !== 'string' || !parseSize(a.cells)) err(at('cells'), 'cells like "2x2"');
      if (kind !== 'object') err(at('cells'), 'a footprint is for objects');
    }
    for (const k of ['variantOf', 'recolourOf'] as const) {
      const v = a[k];
      if (typeof v !== 'string') continue;
      if (!names.has(v)) err(at(k), `no asset '${v}' in the manifest`);
      else if (v === a.name) err(at(k), 'not itself');
      else if (kindOf(v) !== kind) err(at(k), `'${v}' is a ${kindOf(v)}, not a ${kind}`);
    }
    if (a.uses !== undefined) {
      if (!Array.isArray(a.uses) || !a.uses.every((u) => typeof u === 'string')) err(at('uses'), 'a list of asset names');
      else for (const u of a.uses as string[]) if (!names.has(u)) err(at('uses'), `no asset '${u}' in the manifest`);
      if (kind !== 'map') err(at('uses'), 'uses is for maps');
    }
    if (a.chars !== undefined) {
      if (kind !== 'font') err(at('chars'), 'chars is for fonts');
      else if (typeof a.chars !== 'string' || typeof parseChars(a.chars, !/^[0-9U+,\-]+$/.test(a.chars)) === 'string') err(at('chars'), 'code points and ranges like "32-126", or the characters themselves');
    }
    if (typeof a.flat === 'string' && !HEX_RE.test(a.flat) && !NAME_RE.test(a.flat.toLowerCase())) err(at('flat'), 'a palette entry name or #rrggbb');
    if (typeof a.set === 'string' && sets && typeof sets === 'object' && !(a.set in (sets as object))) err(at('set'), `no set '${a.set}' in sets`);
  });
  return { manifest: errors.length ? null : (m as unknown as Manifest), errors };
}

/** The set an asset belongs to (default: its kind). */
export function setName(a: ManifestAsset): string {
  return a.set ?? a.kind;
}

/** What the project knows about one planned asset when its status is worked out. */
export interface StatusFacts {
  exists: boolean;
  /** Every check passes (null: not run). */
  checksPass: boolean | null;
  marks: Mark[];
  /** The asset's art hash now. */
  art: string | null;
  /** The art hash recorded by its last export, if any. */
  exportedArt?: string | null;
}

export interface StatusReport {
  status: Status;
  /** Why it is not further on: the first stage it has not reached, in words. */
  next: string;
  /** Things the agent should know: a stale mark, a stale export, a request for changes. */
  flags: string[];
}

/** The latest mark among these names that is still in effect (a `rejected` after an approval sends it back). */
function latest(marks: Mark[], names: string[]): Mark | null {
  for (let i = marks.length - 1; i >= 0; i--) if (names.includes(marks[i]!.name)) return marks[i]!;
  return null;
}

/** The status of one planned asset (plan §7.3), from what the project knows. */
export function statusOf(f: StatusFacts): StatusReport {
  const flags: string[] = [];
  if (!f.exists) return { status: 'planned', next: 'draw it', flags };
  if (f.checksPass !== true) return { status: 'drafted', next: f.checksPass === null ? 'run the checks' : 'make every check pass', flags };
  const rev = latest(f.marks, ['reviewed']);
  if (rev && rev.art !== f.art) flags.push(`the art changed since it was reviewed (#${rev.seq})`);
  if (!rev || rev.art !== f.art) return { status: 'checked', next: 'a blind review, then `mark reviewed`', flags };
  const verdict = latest(f.marks, ['approved', 'rejected']);
  if (verdict?.name === 'rejected') flags.push(`changes asked for (#${verdict.seq}${verdict.text ? `: ${verdict.text}` : ''})`);
  if (verdict?.name === 'approved' && verdict.art !== f.art) flags.push(`the art changed since it was approved (#${verdict.seq})`);
  if (!verdict || verdict.name !== 'approved' || verdict.art !== f.art || verdict.seq < rev.seq) {
    return { status: 'reviewed', next: verdict?.name === 'rejected' ? 'make the changes asked for, then review again' : 'a person approves it in the dashboard', flags };
  }
  if (f.exportedArt && f.exportedArt !== f.art) flags.push('exported before its last change: export again');
  if (f.exportedArt !== f.art) return { status: 'approved', next: 'export it through the profile', flags };
  return { status: 'exported', next: 'done', flags };
}
