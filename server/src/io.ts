// Export and import through profiles (plan §4.9, §7): the project's own profiles (profiles/*.json,
// or paths listed in project.json `profiles`) beside the built-in ones, written into a folder (a
// game's folder, or <project>/exports/<profile>/); and importing images back: a profile's export
// read into the assets it came from, or a PNG, a sheet sliced by a grid, or an `.aseprite` file
// made into a new asset whose tape starts with the `import` commands. Imported files are kept as
// content-addressed blobs (blobs/<sha256>.<ext>).

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  BUILTIN_PROFILES, TRANSPARENT, artHash, assetIdent, sliceCells, sliceNames, validateManifest, type ManifestAsset, type SliceGrid, aseParts, autoKeys, blockText, cropRgba, decodePng, exportProfile, importProfile, importRows, loadProfile,
  mapWorld, msToTicks, paletteFromImages, paletteRows, quantise, readAseprite, roundTripDiffs, validatePalette,
  type AssetDoc, type Doc, type Palette, type ProfileJson, type Rgba, type SchemeJson,
} from '@pixelclaw/core';
import { ProjectError, sha256, type Project } from './project.ts';
import type { ExportRecord } from './protocol.ts';
import { knownFor, manifestEntry, readManifest, writeManifest } from './plan.ts';
import type { Writer } from './writer.ts';

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

export type { ExportRecord } from './protocol.ts';

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
  /** Files given as bytes (a page's upload) instead of a path: each becomes an asset, or is sliced. */
  files?: { name: string; bytes: Uint8Array }[];
  /** Slice each PNG into separate assets, one per non-empty cell (plan §21). */
  slice?: SliceGrid;
  /** Names for the new assets: a pattern ({name}, {n}, {col}, {row}), or a list in order. */
  pattern?: string;
  names?: string[];
  /** `manifest`: name them after the manifest's planned, undrawn entries (of `set`, when given), in order. */
  namesFrom?: 'manifest';
  /** The manifest set for the new entries. */
  set?: string;
  /** Tiles: draw on a wrapping canvas (seamless tiles). */
  wrap?: boolean;
}

export interface ImportPlan {
  /** New assets to create: their tapes, kind and size, and where they came from. */
  create: { name: string; tape: string; inexact: number; worst: number; kind?: string; size?: string; from?: string }[];
  /** Profile imports: assets whose files read back exactly, and those that differ. */
  same: string[];
  differ: string[];
  notes: string[];
}

/** Read what an import brings in (the caller runs the tapes through the writer). */
export function planImport(p: Project, assets: AssetDoc[], req: ImportRequest): ImportPlan {
  if (req.files) return planImportFiles(p, req, req.files);
  const path = resolve(req.path);
  if (!existsSync(path)) throw new ProjectError(`no file or folder '${req.path}'`);
  const plan: ImportPlan = { create: [], same: [], differ: [], notes: [] };
  if (!req.profile && statSync(path).isDirectory()) {
    const files = readdirSync(path).filter((f) => /\.(png|aseprite|ase)$/i.test(f)).sort().map((f) => ({ name: f, bytes: new Uint8Array(readFileSync(join(path, f))) }));
    if (!files.length) throw new ProjectError(`no .png or .aseprite files in ${req.path}`);
    return planImportFiles(p, req, files);
  }
  if (req.slice) return planImportFiles(p, req, [{ name: basename(path), bytes: new Uint8Array(readFileSync(path)) }]);
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
      name, inexact, worst, kind: req.kind ?? 'sprite', size: `${parts.width}x${parts.height}`, from: basename(path), tape: importTape({
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
    plan.create.push({ name, inexact, worst, kind: req.kind ?? 'sprite', size: `${gw}x${gh}`, from: basename(path), tape: importTape({ name, kind: req.kind ?? 'sprite', palette: pal, width: gw, height: gh, layers: [{ name: 'main' }], cels: [frames], from: basename(path), blob }) });
    return plan;
  }
  const q = quantise(img, pal);
  plan.create.push({
    name, inexact: q.inexact, worst: q.worst, kind: req.kind ?? 'sprite', size: `${img.width}x${img.height}`, from: basename(path),
    tape: importTape({ name, kind: req.kind ?? 'sprite', palette: pal, width: img.width, height: img.height, cell: req.grid ?? null, layers: [{ name: 'main' }], cels: [[q.px]], from: basename(path), blob }),
  });
  return plan;
}

/**
 * Several files (a folder, a page's drop) or a sheet to slice: each .aseprite file one asset, each
 * PNG one asset, or with `slice` one asset per non-empty cell. Names come from `names`, the
 * manifest's planned entries (`namesFrom`), or the pattern (default {name}_{n} for cells, the
 * file's name for whole files).
 */
function planImportFiles(p: Project, req: ImportRequest, files: { name: string; bytes: Uint8Array }[]): ImportPlan {
  const plan: ImportPlan = { create: [], same: [], differ: [], notes: [] };
  type Piece = { file: string; img?: Rgba; ase?: Uint8Array; from: string; base: string; col?: number; row?: number; blob: string };
  const pieces: Piece[] = [];
  for (const f of files) {
    const ext = extname(f.name).toLowerCase();
    const base = assetIdent(basename(f.name, extname(f.name)));
    const blob = saveBlob(p, f.bytes, ext);
    if (ext === '.aseprite' || ext === '.ase') { pieces.push({ file: f.name, ase: f.bytes, from: basename(f.name), base, blob }); continue; }
    if (ext !== '.png') throw new ProjectError(`import reads .png and .aseprite files, not '${f.name}'`);
    const img = decodePng(f.bytes);
    if (!req.slice) { pieces.push({ file: f.name, img, from: basename(f.name), base, blob }); continue; }
    const cells = sliceCells(img.width, img.height, req.slice);
    if (!cells.length) throw new ProjectError(`a ${req.slice.cell.join('x')} grid does not fit the ${img.width}x${img.height} image ${f.name}`);
    let kept = 0;
    for (const c of cells) {
      const cut = cropRgba(img, c.x, c.y, req.slice.cell[0], req.slice.cell[1]);
      let empty = true;
      for (let i = 3; i < cut.data.length; i += 4) if (cut.data[i]! >= 128) { empty = false; break; }
      if (empty) continue;
      kept++;
      pieces.push({ file: f.name, img: cut, from: `${basename(f.name)} cell ${c.col},${c.row}`, base, col: c.col, row: c.row, blob });
    }
    if (!kept) plan.notes.push(`${f.name}: every cell is empty`);
  }
  // Names, in the order the pieces were read.
  let names: string[];
  if (req.names?.length || req.namesFrom === 'manifest') {
    let list = req.names ?? [];
    if (req.namesFrom === 'manifest') {
      const m = readManifest(p).manifest;
      if (!m) throw new ProjectError('no valid manifest.json to take names from');
      list = m.assets.filter((a) => (!req.set || (a.set ?? a.kind) === req.set) && !existsSync(join(p.dir, 'assets', a.name))).map((a) => a.name);
    }
    const r = sliceNames(pieces.map((x, i) => ({ col: x.col ?? i, row: x.row ?? 0, x: 0, y: 0 })), { base: 'imported', names: list });
    if (typeof r === 'string') throw new ProjectError(`names: ${r}`);
    names = r;
  } else {
    names = [];
    const perFile = new Map<string, number>();
    for (const x of pieces) {
      const n = (perFile.get(x.file) ?? 0) + 1;
      perFile.set(x.file, n);
      const pattern = req.pattern ?? (x.col !== undefined ? '{name}_{n}' : '{name}');
      names.push(assetIdent(pattern.replace(/\{name\}/g, x.base).replace(/\{n\}/g, String(n)).replace(/\{col\}/g, String(x.col ?? 0)).replace(/\{row\}/g, String(x.row ?? 0)), x.base));
    }
    if (files.length === 1 && pieces.length === 1 && req.as) names[0] = assetIdent(req.as);
    const dup = names.find((n, i) => names.indexOf(n) !== i);
    if (dup) throw new ProjectError(`names: '${dup}' comes out twice (put {n}, or {col} and {row}, in the pattern)`);
  }
  const m = readManifest(p).manifest;
  pieces.forEach((x, i) => {
    const name = names[i]!;
    const entryKind = manifestEntry(m, name)?.kind;
    const kind = req.kind ?? (entryKind && ['sprite', 'tile', 'object', 'icon', 'sheet'].includes(entryKind) ? entryKind : 'sprite');
    if (x.ase) {
      const parts = aseParts(readAseprite(x.ase));
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
        name, inexact, worst, kind, size: `${parts.width}x${parts.height}`, from: x.from, tape: importTape({
          name, kind, palette: pal, width: parts.width, height: parts.height, layers: parts.layers, cels,
          ticks: parts.ms.map((ms) => msToTicks(ms, p.json.tickRate)), tags: parts.tags, views: parts.views, from: x.from, blob: x.blob,
        }),
      });
      return;
    }
    const img = x.img!;
    const pal = paletteFor(p, req, [img], name);
    const q = quantise(img, pal);
    let tape = importTape({ name, kind, palette: pal, width: img.width, height: img.height, layers: [{ name: 'main' }], cels: [[q.px]], from: x.from, blob: x.blob });
    if (kind === 'tile' && req.wrap) tape = tape.replace(/ wrap=off /, ' wrap=on ');
    plan.create.push({ name, inexact: q.inexact, worst: q.worst, kind, size: `${img.width}x${img.height}`, from: x.from, tape });
  });
  return plan;
}

/** What a page, MCP or the CLI may ask of an import into the gallery. */
export type ImportOptions = Omit<ImportRequest, 'path'> & { path?: string; /** Add manifest entries for the new assets (default true when there is a manifest). */ manifest?: boolean; replace?: boolean };

export interface ImportResult {
  created: { name: string; kind: string; size: string; inexact: number; failing: string[]; checks: number; planned: boolean }[];
  /** Manifest entries added. */
  added: string[];
  notes: string[];
  text: string;
}

/**
 * An import into the project (plan §21 item 4): the assets made (their tapes start with
 * `import`), manifest entries added for the ones it does not plan yet (the manifest checked
 * first; nothing is made if it would have problems), and every check run on each. Run inside the
 * writer's queue.
 */
export function importIntoProject(w: Writer, o: ImportOptions, by: string): ImportResult {
  const p = w.project;
  if (!o.path && !o.files) throw new ProjectError('import: give a path or files');
  const plan = planImport(p, w.assetDocs(), { ...o, path: o.path ?? '' });
  if (o.profile) throw new ProjectError('importIntoProject takes images, not a profile export');
  for (const c of plan.create) if (existsSync(join(p.dir, 'assets', c.name)) && !o.replace) throw new ProjectError(`an asset '${c.name}' already exists (choose other names, or replace)`);
  const mr = readManifest(p);
  const added: ManifestAsset[] = [];
  const notes = [...plan.notes];
  if (o.manifest !== false) {
    if (mr.manifest) {
      for (const c of plan.create) {
        if (manifestEntry(mr.manifest, c.name)) continue;
        added.push({ name: c.name, kind: (c.kind ?? 'sprite') as ManifestAsset['kind'], size: c.size ?? '', ...(o.set ? { set: o.set } : {}), description: `imported from ${c.from ?? 'a file'}` });
      }
      if (added.length) {
        const next = { ...mr.manifest, assets: [...mr.manifest.assets, ...added] };
        const v = validateManifest(next, knownFor(p));
        if (!v.manifest) throw new ProjectError(`the manifest entries would have problems: ${v.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
      }
    } else if (o.manifest === true || mr.exists) {
      throw new ProjectError(mr.exists ? `manifest.json has problems; fix it before importing into it` : 'there is no manifest to add entries to (import with manifest: false, or plan first)');
    } else notes.push('no manifest.json: the assets are not planned (the dashboard lists them as unplanned)');
  }
  const created: ImportResult['created'] = [];
  for (const c of plan.create) {
    const r = w.run({ asset: c.name, commands: c.tape, by, replace: o.replace });
    if (!r.ok) throw new ProjectError(`${c.name}: ${r.errors.map((e) => `${e.line}:${e.col} ${e.message}`).join('; ')}`);
  }
  if (added.length) writeManifest(p, { ...mr.manifest!, assets: [...mr.manifest!.assets, ...added] });
  for (const c of plan.create) {
    const rs = w.checks(c.name).results.filter((x) => x.status !== 'skip');
    created.push({ name: c.name, kind: c.kind ?? 'sprite', size: c.size ?? '', inexact: c.inexact, failing: rs.filter((x) => x.status === 'fail').map((x) => x.id), checks: rs.length, planned: !!manifestEntry(readManifest(p).manifest, c.name) });
  }
  w.planChanged();
  const text = [
    ...created.map((c) => `created ${c.name} (${c.kind} ${c.size})${c.inexact ? `, ${c.inexact} pixels quantised to the nearest palette colour` : ''}: ${c.failing.length ? `failing ${c.failing.join(', ')}` : `all ${c.checks} checks pass`}`),
    ...(added.length ? [`manifest: added ${added.map((a) => a.name).join(', ')}${o.set ? ` to set ${o.set}` : ''}`] : []),
    ...notes,
  ].join('\n');
  return { created, added: added.map((a) => a.name), notes, text };
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

