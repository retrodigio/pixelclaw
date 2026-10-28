// Export and import through profiles (plan §4.9, §7): the project's own profiles (profiles/*.json,
// or paths listed in project.json `profiles`) beside the built-in ones, written into a folder (a
// game's folder, or <project>/exports/<profile>/); and importing images back: a profile's export
// read into the assets it came from, or a PNG, a sheet sliced by a grid, or an `.aseprite` file
// made into a new asset whose tape starts with the `import` commands. Imported files are kept as
// content-addressed blobs (blobs/<sha256>.<ext>).

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  BUILTIN_PROFILES, TRANSPARENT, artHash, aseParts, autoKeys, blockText, cropRgba, decodePng, exportProfile, importProfile, importRows, loadProfile,
  mapWorld, msToTicks, paletteFromImages, paletteRows, quantise, readAseprite, roundTripDiffs, validatePalette,
  type AssetDoc, type Doc, type Palette, type ProfileJson, type Rgba, type SchemeJson,
} from '@pixelclaw/core';
import { ProjectError, sha256, type Project } from './project.ts';

/** The project's own schemes (schemes/*.json). */
export function projectSchemes(dir: string): Map<string, SchemeJson> {
  const out = new Map<string, SchemeJson>();
  const d = join(dir, 'schemes');
  if (!existsSync(d)) return out;
  for (const f of readdirSync(d).filter((x) => x.endsWith('.json')).sort()) {
    try {
      const s = JSON.parse(readFileSync(join(d, f), 'utf8')) as SchemeJson;
      out.set(s.name, s);
    } catch (e) {
      throw new ProjectError(`schemes/${f}: ${(e as Error).message}`);
    }
  }
  return out;
}

/** Every profile the project can use: built-in, then profiles/*.json, then project.json `profiles` (paths). */
export function projectProfiles(p: Project): Map<string, ProfileJson> {
  const out = new Map<string, ProfileJson>(BUILTIN_PROFILES);
  const files: string[] = [];
  const d = join(p.dir, 'profiles');
  if (existsSync(d)) files.push(...readdirSync(d).filter((x) => x.endsWith('.json')).sort().map((f) => join(d, f)));
  for (const f of p.json.profiles ?? []) files.push(isAbsolute(f) ? f : join(p.dir, f));
  for (const f of files) {
    try {
      const j = loadProfile(JSON.parse(readFileSync(f, 'utf8')) as ProfileJson);
      out.set(j.name, j);
    } catch (e) {
      throw new ProjectError(`${relative(p.dir, f) || f}: ${(e as Error).message}`);
    }
  }
  return out;
}

/** A profile by name, or a profile file's path. */
export function profileNamed(p: Project, name: string): ProfileJson {
  if (name.endsWith('.json') && existsSync(resolve(name))) return loadProfile(JSON.parse(readFileSync(resolve(name), 'utf8')) as ProfileJson);
  const all = projectProfiles(p);
  const prof = all.get(name);
  if (!prof) throw new ProjectError(`no profile '${name}' (profiles: ${[...all.keys()].join(', ')})`);
  return prof;
}

/** The assets an export of these needs: maps bring what they draw; every asset brings its texture variants and density copies. */
export function exportSet(assets: AssetDoc[], names: string[] | undefined): Doc[] {
  if (!names?.length) return assets.map((a) => a.doc);
  const by = new Map(assets.map((a) => [a.name, a.doc]));
  const want = new Set<string>();
  const add = (n: string) => {
    if (want.has(n) || !by.has(n)) return;
    want.add(n);
    const d = by.get(n)!;
    if (d.map) {
      for (const e of d.map.entries) add(e.name);
      for (const l of d.layers) if (l.map?.kind === 'terrain') add(l.map.family); else if (l.map?.kind === 'overlay') add(l.map.overlay);
    }
    for (const a of assets) if (a.doc.variantOf === n || a.doc.densityOf?.of === n) add(a.name);
  };
  for (const n of names) {
    if (!by.has(n)) throw new ProjectError(`no asset '${n}'`);
    add(n);
  }
  return assets.filter((a) => want.has(a.name)).map((a) => a.doc);
}

export interface ExportReport {
  dir: string;
  files: string[];
  images: number;
  notes: string[];
}

export const EXPORTED_FILE = 'exported.json';

// --- exported.json: the last export of each asset (plan §7.3 "exported")

export interface ExportRecord {
  profile: string;
  /** The folder, relative to the project when it is inside it. */
  dir: string;
  at: string;
  /** The art's hash when it was exported: a later change makes the export stale. */
  art: string;
}

export function readExported(p: Project): Record<string, ExportRecord> {
  try {
    return JSON.parse(readFileSync(join(p.dir, EXPORTED_FILE), 'utf8')) as Record<string, ExportRecord>;
  } catch {
    return {};
  }
}

/** Record an export of these documents (called by every profile export). */
export function recordExport(p: Project, docs: Doc[], profile: string, dir: string, at: string): void {
  const all = readExported(p);
  const rel = relative(p.dir, dir);
  const shown = rel && !rel.startsWith('..') ? rel : dir;
  for (const d of docs) all[d.name] = { profile, dir: shown, at, art: artHash(d) };
  const sorted = Object.fromEntries(Object.keys(all).sort().map((k) => [k, all[k]!]));
  writeFileSync(join(p.dir, EXPORTED_FILE), JSON.stringify(sorted, null, 2) + '\n');
}

/** Export assets through a profile into a folder (and record it in exported.json when `at` is given). */
export function exportWithProfile(p: Project, assets: AssetDoc[], profile: string, o: { names?: string[]; dest?: string; at?: string } = {}): ExportReport {
  const prof = profileNamed(p, profile);
  const docs = exportSet(assets, o.names);
  const r = exportProfile(prof, docs, { tickRate: p.json.tickRate, world: mapWorld(assets) });
  const dir = o.dest ?? join(p.dir, 'exports', prof.name);
  const files: string[] = [];
  for (const [f, b] of r.files) {
    const path = join(dir, f);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, b);
    files.push(path);
  }
  if (o.at) recordExport(p, docs, prof.name, dir, o.at);
  return { dir, files, images: r.items.length, notes: r.notes };
}

/** Every file under a folder, by path relative to it. */
function readTree(dir: string): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const walk = (d: string) => {
    for (const f of readdirSync(d).sort()) {
      const full = join(d, f);
      if (statSync(full).isDirectory()) walk(full);
      else out.set(relative(dir, full).split('\\').join('/'), readFileSync(full));
    }
  };
  walk(dir);
  return out;
}

/** Keep an imported file as a blob; returns its sha256. */
export function saveBlob(p: Project, bytes: Uint8Array, ext: string): string {
  const h = sha256(bytes);
  const d = join(p.dir, 'blobs');
  mkdirSync(d, { recursive: true });
  const f = join(d, `${h}${ext}`);
  if (!existsSync(f)) writeFileSync(f, bytes);
  return h;
}

const ident = (s: string, dflt: string) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^[^a-z]+/, '') || dflt;

/** The tape of a new asset made from imported layers × frames of indices. */
export function importTape(o: {
  name: string; kind: string; palette: Palette; width: number; height: number; cell?: [number, number] | null;
  layers: { name: string; hidden?: boolean; reference?: boolean }[]; cels: (Uint16Array | null)[][]; ticks?: number[];
  tags?: { name: string; from: number; to: number; loop: string }[]; views?: { name: string; from: number; to: number; mirror: string | null }[];
  from: string; blob: string;
}): string {
  const keys = o.palette.entries.map((e) => e.key);
  const frames = o.cels[0]?.length ?? 1;
  const cell = o.cell ? ` cell=${o.cell[0]}x${o.cell[1]}` : '';
  const lines: string[] = [`new ${o.kind} ${o.name} ${o.width}x${o.height} palette=${o.palette.name}${o.kind === 'tile' ? ' wrap=off' : ''}${cell} bg=none <<\n${blockText(paletteRows(o.palette))}>>`];
  const names: string[] = [];
  o.layers.forEach((l, i) => {
    let n = ident(l.name, `layer${i + 1}`);
    while (names.includes(n)) n += '_';
    names.push(n);
    if (i === 0) { if (n !== 'main') lines.push(`layer rename main ${n}`); } else lines.push(`layer add ${n} above=${names[i - 1]}`);
  });
  for (let f = 1; f < frames; f++) lines.push(`frame add empty`);
  (o.ticks ?? []).forEach((t, f) => { if (t !== 10) lines.push(`frame set ${f + 1} ticks=${t}`); });
  const src = o.from.replace(/"/g, '');
  for (let f = 0; f < frames; f++) {
    o.layers.forEach((_, li) => {
      const px = o.cels[li]?.[f];
      if (!px || px.every((v) => v === TRANSPARENT)) return;
      lines.push(`layer ${names[li]}`, `frame ${f + 1}`, `import 0,0 from="${src}" blob=${o.blob} <<\n${blockText(importRows(px, o.width, o.height, keys))}>>`);
    });
  }
  o.layers.forEach((l, li) => {
    if (l.reference) lines.push(`layer set ${names[li]} reference=on`);
    if (l.hidden) lines.push(`layer set ${names[li]} hidden=on`);
  });
  for (const t of o.tags ?? []) lines.push(`tag add ${ident(t.name, 'tag')} ${t.from + 1}-${t.to + 1} loop=${t.loop}`);
  for (const v of (o.views ?? []).filter((x) => !x.mirror)) lines.push(`view ${v.name} frames=${v.from + 1}-${v.to + 1}`);
  for (const v of (o.views ?? []).filter((x) => x.mirror)) lines.push(`view ${v.name} frames=${v.from + 1}-${v.to + 1}`, `view ${v.name} mirror=${v.mirror}`);
  return lines.join('\n');
}

export interface ImportRequest {
  /** A PNG, an .aseprite file, or (with a profile) the folder an export wrote. */
  path: string;
  profile?: string;
  /** The new asset's name (single files; default: the file's name). */
  as?: string;
  kind?: string;
  /** Quantise to this palette (default: the project's default); `build` makes one from the image instead. */
  palette?: string;
  build?: boolean;
  /** Slice a sheet into frames of this size (reading order), or with `cells` keep it one image with that cell grid. */
  grid?: [number, number];
  cells?: boolean;
}

export interface ImportPlan {
  /** New assets to create: their tapes. */
  create: { name: string; tape: string; inexact: number; worst: number }[];
  /** Profile imports: assets whose files read back exactly, and those that differ. */
  same: string[];
  differ: string[];
  notes: string[];
}

/** Read what an import brings in (the caller runs the tapes through the writer). */
export function planImport(p: Project, assets: AssetDoc[], req: ImportRequest): ImportPlan {
  const path = resolve(req.path);
  if (!existsSync(path)) throw new ProjectError(`no file or folder '${req.path}'`);
  const plan: ImportPlan = { create: [], same: [], differ: [], notes: [] };
  if (req.profile) {
    const prof = profileNamed(p, req.profile);
    const files = statSync(path).isDirectory() ? readTree(path) : new Map([[basename(path), readFileSync(path)]]);
    const docs = assets.map((a) => a.doc);
    const r = importProfile(prof, files, docs);
    plan.notes.push(...r.notes);
    const diffs = roundTripDiffs(r, docs);
    for (const name of [...r.assets.keys()].sort()) (diffs.some((d) => d.startsWith(`${name} `)) ? plan.differ : plan.same).push(name);
    plan.notes.push(...diffs);
    for (const u of r.unknown) {
      const pal = paletteFor(p, req, [u.img], u.name);
      const q = quantise(u.img, pal);
      const blob = saveBlob(p, files.get([...files.keys()].find((k) => k.includes(u.name)) ?? '') ?? new Uint8Array(), '.png');
      plan.create.push({ name: u.name, inexact: q.inexact, worst: q.worst, tape: importTape({ name: ident(u.name, 'imported'), kind: req.kind ?? 'sprite', palette: pal, width: u.img.width, height: u.img.height, layers: [{ name: 'main' }], cels: [[q.px]], from: u.name, blob }) });
    }
    return plan;
  }
  const bytes = readFileSync(path);
  const ext = extname(path).toLowerCase();
  const name = ident(req.as ?? basename(path, ext), 'imported');
  const blob = saveBlob(p, bytes, ext);
  if (ext === '.aseprite' || ext === '.ase') {
    const parts = aseParts(readAseprite(bytes));
    const imgs: Rgba[] = parts.rgba.flatMap((fr) => fr.flatMap((c) => (c ? [{ width: parts.width, height: parts.height, data: c }] : [])));
    const pal = paletteFor(p, req, imgs, name);
    let inexact = 0, worst = 0;
    const cels = parts.rgba.map((fr) => fr.map((c) => {
      if (!c) return null;
      const q = quantise({ width: parts.width, height: parts.height, data: c }, pal);
      inexact += q.inexact; worst = Math.max(worst, q.worst);
      return q.px;
    }));
    plan.create.push({
      name, inexact, worst, tape: importTape({
        name, kind: req.kind ?? 'sprite', palette: pal, width: parts.width, height: parts.height, layers: parts.layers, cels,
        ticks: parts.ms.map((m) => msToTicks(m, p.json.tickRate)), tags: parts.tags, views: parts.views, from: basename(path), blob,
      }),
    });
    return plan;
  }
  if (ext !== '.png') throw new ProjectError(`import reads .png and .aseprite files (or a folder with a profile), not '${ext}'`);
  const img = decodePng(bytes);
  const pal = paletteFor(p, req, [img], name);
  if (req.grid && !req.cells) {
    const [gw, gh] = req.grid;
    const cols = Math.floor(img.width / gw), rows = Math.floor(img.height / gh);
    if (!cols || !rows) throw new ProjectError(`a ${gw}x${gh} grid does not fit the ${img.width}x${img.height} image`);
    const frames: Uint16Array[] = [];
    let inexact = 0, worst = 0;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const q = quantise(cropRgba(img, x * gw, y * gh, gw, gh), pal);
      if (q.px.every((v) => v === TRANSPARENT)) continue;
      inexact += q.inexact; worst = Math.max(worst, q.worst);
      frames.push(q.px);
    }
    plan.create.push({ name, inexact, worst, tape: importTape({ name, kind: req.kind ?? 'sprite', palette: pal, width: gw, height: gh, layers: [{ name: 'main' }], cels: [frames], from: basename(path), blob }) });
    return plan;
  }
  const q = quantise(img, pal);
  plan.create.push({
    name, inexact: q.inexact, worst: q.worst,
    tape: importTape({ name, kind: req.kind ?? 'sprite', palette: pal, width: img.width, height: img.height, cell: req.grid ?? null, layers: [{ name: 'main' }], cels: [[q.px]], from: basename(path), blob }),
  });
  return plan;
}

function paletteFor(p: Project, req: ImportRequest, imgs: Rgba[], name: string): Palette {
  if (req.build) {
    const pal = paletteFromImages(name.replace(/_/g, '-'), imgs);
    return validatePalette({ ...pal, entries: pal.entries.map((e, i) => ({ ...e, key: autoKeys(pal.entries.length)[i]! })) });
  }
  const n = req.palette ?? p.json.defaultPalette;
  const pal = n ? p.palettes.get(n) : undefined;
  if (!pal) throw new ProjectError(n ? `no palette '${n}' in the project` : `say which palette to quantise to (palette), or build one from the image (build)`);
  return pal;
}

/** One line per imported asset for a report. */
export function importSummary(plan: ImportPlan, created: string[]): string {
  const out: string[] = [];
  if (plan.same.length) out.push(`read back exactly: ${plan.same.join(', ')}`);
  if (plan.differ.length) out.push(`differ from the project: ${plan.differ.join(', ')}`);
  for (const c of plan.create) {
    out.push(`${created.includes(c.name) ? 'created' : 'would create'} ${c.name}: ${c.inexact ? `${c.inexact} pixels were not palette colours (nearest taken; worst distance ${c.worst})` : 'every pixel a palette colour'}`);
  }
  out.push(...plan.notes);
  return out.join('\n');
}

