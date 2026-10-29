// The project folder (plan §7.1): project.json, palettes/, assets/<name>/{asset.json, tape.jsonl,
// preview.png, checkpoints/}. Everything here is plain files so a project diffs well in git.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import {
  deserializeDoc, tapeLang, encodePng, entryToJson, importPalette, paletteToJson, parseTape, renderFlat, serializeDoc, tapeToJsonl,
  type AssetState, type Doc, type Layer, type Note, type Palette, type PaletteSource, type SchemeJson, type StyleJson, type TapeEntry,
} from '@pixelclaw/core';

export const PROJECT_FORMAT = 'pixelclaw-project';
/** A checkpoint (the document's state bytes) is written every this many commands. */
export const CHECKPOINT_EVERY = 200;

export interface ProjectJson {
  format: typeof PROJECT_FORMAT;
  version: 1;
  name: string;
  tickRate: number;
  defaultPalette: string | null;
  grid: number;
  /** The style guide's settings for checks and previews (see core's style.ts). */
  style: StyleJson;
  /** Preview themes for role art, by name: `{ "light": "#…", "dark": "#…", "darkest": "#…" }`. */
  themes?: Record<string, unknown>;
  profiles: string[];
}

export interface AssetJson {
  name: string;
  kind: string;
  size: [number, number];
  cell: [number, number];
  wrap: boolean;
  palette: string;
  layers: Layer[];
  frames: number;
  paletteLocked: boolean;
  stamps: string[];
  macros: string[];
  tags: unknown[];
  views: unknown[];
  /** `{ "fork": { "from": <asset>, "at": <seq> } }` for a branch. */
  links: unknown[];
  /** The open notes (plan §1.3): pinned to a pixel (1x1) or a region. */
  notes: Note[];
  tape: { lang: number; commands: number; groups: number };
  state: { sha256: string };
  checkpoints: { every: number; files: string[] };
}

export class ProjectError extends Error {}

export interface Project {
  dir: string;
  json: ProjectJson;
  palettes: Map<string, Palette>;
}

export function sha256(b: Uint8Array): string {
  return createHash('sha256').update(b).digest('hex');
}

function writeJson(path: string, v: unknown): void {
  writeFileSync(path, JSON.stringify(v, null, 2) + '\n');
}

export function createProject(dir: string, o: { name?: string; palettes: Palette[]; grid?: number }): Project {
  if (existsSync(join(dir, 'project.json'))) throw new ProjectError(`${dir} is already a project`);
  const base = dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop()!.replace(/\.pclaw$/, '');
  const json: ProjectJson = {
    format: PROJECT_FORMAT, version: 1, name: o.name ?? base, tickRate: 60,
    defaultPalette: o.palettes[0]?.name ?? null, grid: o.grid ?? 24, style: {}, profiles: [],
  };
  mkdirSync(join(dir, 'palettes'), { recursive: true });
  mkdirSync(join(dir, 'assets'), { recursive: true });
  for (const p of o.palettes) writeFileSync(join(dir, 'palettes', `${p.name}.json`), paletteToJson(p));
  writeJson(join(dir, 'project.json'), json);
  return loadProject(dir);
}

export function loadProject(dir: string): Project {
  const pj = join(dir, 'project.json');
  if (!existsSync(pj)) throw new ProjectError(`${dir} is not a PixelClaw project (no project.json); create one with 'pixelclaw new ${dir}'`);
  const json = JSON.parse(readFileSync(pj, 'utf8')) as ProjectJson;
  if (json.format !== PROJECT_FORMAT) throw new ProjectError(`${pj}: not a ${PROJECT_FORMAT} file`);
  const palettes = new Map<string, Palette>();
  const pdir = join(dir, 'palettes');
  if (existsSync(pdir)) {
    for (const f of readdirSync(pdir).sort()) {
      if (!/\.(json|hex|gpl)$/i.test(f)) continue;
      let p: Palette;
      try {
        p = importPalette(f, readFileSync(join(pdir, f), 'utf8'));
      } catch (e) {
        throw new ProjectError(`palettes/${f}: ${(e as Error).message}`);
      }
      if (palettes.has(p.name)) throw new ProjectError(`palettes/${f}: a palette named '${p.name}' is already loaded`);
      palettes.set(p.name, p);
    }
  }
  return { dir, json, palettes };
}

export function paletteSource(p: Project): PaletteSource {
  return { get: (n) => p.palettes.get(n), defaultName: p.json.defaultPalette ?? undefined, scheme: (n) => projectScheme(p.dir, n) };
}

/** A project scheme (schemes/<name>.json, or any file there naming it), read when a `new family` line asks for it. */
function projectScheme(dir: string, name: string): SchemeJson | undefined {
  const d = join(dir, 'schemes');
  if (!existsSync(d)) return undefined;
  for (const f of readdirSync(d).filter((x) => x.endsWith('.json')).sort()) {
    try {
      const s = JSON.parse(readFileSync(join(d, f), 'utf8')) as SchemeJson;
      if (s.name === name) return s;
    } catch {
      // a broken file: the family line reports the scheme as unknown
    }
  }
  return undefined;
}

export function assetDir(p: Project, name: string): string {
  // A name is one folder under assets/: never a path out of it.
  if (!name || /[\\/]/.test(name) || name.startsWith('.')) throw new ProjectError(`'${name}' is not an asset name`);
  return join(p.dir, 'assets', name);
}

/** A path with its symlinks followed, as far as it exists (the rest appended as written). */
function realish(f: string): string {
  const rest: string[] = [];
  let cur = f;
  for (;;) {
    try {
      return join(realpathSync(cur), ...rest.reverse());
    } catch {
      const up = dirname(cur);
      if (up === cur) return f;
      rest.push(basename(cur));
      cur = up;
    }
  }
}

/** Is this path (absolute, or relative to the process) inside the project folder, symlinks followed? */
export function isInsideProject(p: Project, path: string): boolean {
  const root = realish(resolve(p.dir)), r = realish(resolve(path));
  return r === root || r.startsWith(root + sep);
}

/** The worker's fence (plan §26 item 1): a ProjectError unless the path is inside the project folder. */
export function needInsideProject(p: Project, path: string, what: string): void {
  if (!isInsideProject(p, path)) throw new ProjectError(`${what}: '${path}' is outside the project folder, and the worker stays inside it`);
}

export function listAssets(p: Project): string[] {
  const d = join(p.dir, 'assets');
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((n) => existsSync(join(d, n, 'tape.jsonl'))).sort();
}

export function assetExists(p: Project, name: string): boolean {
  return existsSync(join(assetDir(p, name), 'tape.jsonl'));
}

export function readTape(p: Project, name: string): TapeEntry[] {
  return readTapeFile(p, name).entries;
}

/** An asset's tape file: its bytes (the state cache's key) and its entries. */
export function readTapeFile(p: Project, name: string): { bytes: Uint8Array; entries: TapeEntry[] } {
  const f = join(assetDir(p, name), 'tape.jsonl');
  if (!existsSync(f)) throw new ProjectError(`no asset '${name}' in ${p.dir}`);
  const bytes = readFileSync(f);
  return { bytes, entries: parseTape(bytes.toString('utf8')) };
}

export function readAssetJson(p: Project, name: string): AssetJson {
  return JSON.parse(readFileSync(join(assetDir(p, name), 'asset.json'), 'utf8')) as AssetJson;
}

const FORK_RE = /^fork (\S+) \S+ at=(\d+)$/;

/** Where a branch was forked from: its tape's fork line, if it has one. */
export function forkOf(entries: TapeEntry[]): { from: string; at: number } | null {
  for (const e of entries) {
    const m = FORK_RE.exec(e.cmd);
    if (m) return { from: m[1]!, at: Number(m[2]) };
  }
  return null;
}

export function assetJsonFor(doc: Doc, entries: TapeEntry[]): AssetJson {
  const fork = forkOf(entries);
  return {
    name: doc.name, kind: doc.kind, size: [doc.width, doc.height], cell: [doc.cellW, doc.cellH], wrap: doc.wrap,
    palette: doc.palette.name, layers: doc.layers.map((l) => ({ ...l })), frames: doc.frameCount, paletteLocked: doc.paletteLocked,
    stamps: Object.keys(doc.stamps).sort(), macros: Object.keys(doc.macros).sort(),
    tags: [], views: [], links: fork ? [{ fork }] : [], notes: doc.notes,
    tape: { lang: tapeLang(entries), commands: entries.length, groups: new Set(entries.map((e) => e.group)).size },
    state: { sha256: sha256(serializeDoc(doc)) },
    checkpoints: { every: CHECKPOINT_EVERY, files: checkpointNames(entries.length) },
  };
}

/** Read a palette file (.json, Lospec .json, .hex, .gpl), naming any error after the file. */
export function readPaletteFile(file: string): Palette {
  try {
    return importPalette(basename(file), readFileSync(file, 'utf8'));
  } catch (e) {
    throw new ProjectError(`${file}: ${(e as Error).message}`);
  }
}

/** The project's grid: the cell size in pixels that new maps, the camera and the draw scale default to (G14). */
export function setGrid(p: Project, grid: number): void {
  if (!Number.isInteger(grid) || grid < 4 || grid > 256) throw new ProjectError('grid must be the cell size in pixels, 4..256');
  p.json.grid = grid;
  writeJson(join(p.dir, 'project.json'), p.json);
}

/** Add palettes to a project (palettes/<name>.json); the first becomes the default if none is set. */
export function addPalettes(p: Project, palettes: Palette[]): void {
  for (const pal of palettes) {
    if (p.palettes.has(pal.name)) throw new ProjectError(`the project already has a palette named '${pal.name}'`);
  }
  mkdirSync(join(p.dir, 'palettes'), { recursive: true });
  for (const pal of palettes) {
    writeFileSync(join(p.dir, 'palettes', `${pal.name}.json`), paletteToJson(pal));
    p.palettes.set(pal.name, pal);
  }
  if (!p.json.defaultPalette && palettes[0]) {
    p.json.defaultPalette = palettes[0].name;
    writeJson(join(p.dir, 'project.json'), p.json);
  }
}

export function previewPng(doc: Doc): Uint8Array {
  return encodePng(renderFlat(doc));
}

// Checkpoints (plan §7.1): checkpoints/NNNNNN.gwc holds the document after the first N commands
// (N a multiple of CHECKPOINT_EVERY): a header line naming N and the SHA-256 of those N tape lines,
// then the state bytes (serializeDoc). Loading starts from the newest one whose tape prefix still
// matches; `pixelclaw verify` replays and compares every one byte for byte.

const CKPT_MAGIC = 'PCLAWCKPT 1';

/** The file names of the checkpoints a tape of n commands has. */
export function checkpointNames(n: number): string[] {
  const out: string[] = [];
  for (let k = CHECKPOINT_EVERY; k <= n; k += CHECKPOINT_EVERY) out.push(`${String(k).padStart(6, '0')}.gwc`);
  return out;
}

/** SHA-256 of the first n tape lines, as they are written in tape.jsonl. */
export function prefixHash(entries: TapeEntry[], n: number): string {
  return sha256(Buffer.from(entries.slice(0, n).map(entryToJson).join('\n'), 'utf8'));
}

export function checkpointBytes(entries: TapeEntry[], n: number, doc: Doc | null): Uint8Array {
  const head = Buffer.from(`${CKPT_MAGIC} ${n} ${prefixHash(entries, n)}\n`, 'utf8');
  const body = doc ? serializeDoc(doc) : new Uint8Array(0);
  return Buffer.concat([head, body]);
}

export interface Checkpoint {
  file: string;
  n: number;
  hash: string;
  body: Uint8Array;
}

export function readCheckpoints(p: Project, name: string): Checkpoint[] {
  const dir = join(assetDir(p, name), 'checkpoints');
  if (!existsSync(dir)) return [];
  const out: Checkpoint[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.gwc')).sort()) {
    const b = readFileSync(join(dir, f));
    const nl = b.indexOf(10);
    const m = nl > 0 ? /^PCLAWCKPT 1 (\d+) ([0-9a-f]{64})$/.exec(b.subarray(0, nl).toString('utf8')) : null;
    out.push(m ? { file: f, n: Number(m[1]), hash: m[2]!, body: b.subarray(nl + 1) } : { file: f, n: -1, hash: '', body: new Uint8Array(0) });
  }
  return out;
}

/** The newest checkpoint that matches the tape: the document after its first n commands. */
export function latestCheckpoint(p: Project, name: string, entries: TapeEntry[]): { n: number; doc: Doc } | null {
  const cps = readCheckpoints(p, name).filter((c) => c.n > 0 && c.n <= entries.length).sort((a, b) => b.n - a.n);
  for (const c of cps) {
    if (c.hash !== prefixHash(entries, c.n) || c.body.length === 0) continue;
    try {
      return { n: c.n, doc: deserializeDoc(c.body) };
    } catch {
      // unreadable: try an older one
    }
  }
  return null;
}

/**
 * Write an asset's tape, asset.json and preview.png, and its checkpoints: missing ones are written
 * with `docAt(n)`. A tape only grows, except when it is started again (`fresh`): then the old
 * checkpoints go.
 */
export function saveAsset(p: Project, state: AssetState, docAt?: (n: number) => Doc | null, fresh = false): string {
  const doc = state.doc;
  if (!doc) throw new ProjectError('nothing to save: the tape has no document');
  const dir = assetDir(p, doc.name);
  const cdir = join(dir, 'checkpoints');
  mkdirSync(cdir, { recursive: true });
  writeFileSync(join(dir, 'tape.jsonl'), tapeToJsonl(state.entries));
  writeJson(join(dir, 'asset.json'), assetJsonFor(doc, state.entries));
  writeFileSync(join(dir, 'preview.png'), previewPng(doc));
  const want = new Set(checkpointNames(state.entries.length));
  for (const f of readdirSync(cdir)) {
    if (f.endsWith('.gwc') && (fresh || !want.has(f))) rmSync(join(cdir, f), { force: true });
  }
  if (docAt) {
    for (const f of want) {
      if (existsSync(join(cdir, f))) continue;
      const n = Number(f.slice(0, 6));
      writeFileSync(join(cdir, f), checkpointBytes(state.entries, n, docAt(n)));
    }
  }
  return dir;
}

// Read positions (plan §8.2 `changes`): for each agent, the last tape position it has seen on each
// asset. Kept in <project>/reads.json so a restarted server still knows what the agent has seen.

export const READS_FILE = 'reads.json';
export type Reads = Record<string, Record<string, number>>;

export function readReads(p: Project): Reads {
  try {
    return JSON.parse(readFileSync(join(p.dir, READS_FILE), 'utf8')) as Reads;
  } catch {
    return {};
  }
}

export function writeReads(p: Project, r: Reads): void {
  writeJson(join(p.dir, READS_FILE), r);
}

// The server lock: a running server is the single writer for its project. It writes
// .pixelclaw.lock (pid and URL) and removes it on exit; other writers refuse while it is held.

export const LOCK_FILE = '.pixelclaw.lock';

export interface LockInfo {
  pid: number;
  url: string;
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The live server holding this project, if any (a lock left by a dead process is ignored). */
export function lockHolder(dir: string): LockInfo | null {
  const f = join(dir, LOCK_FILE);
  if (!existsSync(f)) return null;
  try {
    const info = JSON.parse(readFileSync(f, 'utf8')) as LockInfo;
    return info.pid !== process.pid && alive(info.pid) ? info : null;
  } catch {
    return null;
  }
}

export function acquireLock(dir: string, url: string): void {
  const held = lockHolder(dir);
  if (held) throw new ProjectError(`another pixelclaw server (pid ${held.pid}) owns ${dir}; watch it at ${held.url.replace(/\?.*$/, '')}`);
  // The URL is stored without its token: the lock file sits in the project folder.
  writeFileSync(join(dir, LOCK_FILE), JSON.stringify({ pid: process.pid, url: url.replace(/\?.*$/, '') }) + '\n');
}

export function releaseLock(dir: string): void {
  const f = join(dir, LOCK_FILE);
  try {
    const info = JSON.parse(readFileSync(f, 'utf8')) as LockInfo;
    if (info.pid === process.pid) rmSync(f, { force: true });
  } catch {
    // no lock, or not ours
  }
}
