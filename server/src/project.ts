// The project folder (plan §7.1): project.json, palettes/, assets/<name>/{asset.json, tape.jsonl,
// preview.png, checkpoints/}. Everything here is plain files so a project diffs well in git.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  LANG_VERSION, encodePng, importPalette, paletteToJson, parseTape, renderFlat, serializeDoc, tapeToJsonl,
  type AssetState, type Doc, type Palette, type PaletteSource, type TapeEntry,
} from '@pixelclaw/core';

export const PROJECT_FORMAT = 'pixelclaw-project';
/** Checkpoints will be written every this many commands (from a later step; G1 writes none). */
export const CHECKPOINT_EVERY = 200;

export interface ProjectJson {
  format: typeof PROJECT_FORMAT;
  version: 1;
  name: string;
  tickRate: number;
  defaultPalette: string | null;
  grid: number;
  style: Record<string, unknown>;
  profiles: string[];
}

export interface AssetJson {
  name: string;
  kind: string;
  size: [number, number];
  cell: [number, number];
  wrap: boolean;
  palette: string;
  layers: { name: string }[];
  frames: number;
  tags: unknown[];
  views: unknown[];
  links: unknown[];
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

export function createProject(dir: string, o: { name?: string; palettes: Palette[] }): Project {
  if (existsSync(join(dir, 'project.json'))) throw new ProjectError(`${dir} is already a project`);
  const base = dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop()!.replace(/\.pclaw$/, '');
  const json: ProjectJson = {
    format: PROJECT_FORMAT, version: 1, name: o.name ?? base, tickRate: 60,
    defaultPalette: o.palettes[0]?.name ?? null, grid: 24, style: {}, profiles: [],
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
  return { get: (n) => p.palettes.get(n), defaultName: p.json.defaultPalette ?? undefined };
}

export function assetDir(p: Project, name: string): string {
  return join(p.dir, 'assets', name);
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
  const f = join(assetDir(p, name), 'tape.jsonl');
  if (!existsSync(f)) throw new ProjectError(`no asset '${name}' in ${p.dir}`);
  return parseTape(readFileSync(f, 'utf8'));
}

export function readAssetJson(p: Project, name: string): AssetJson {
  return JSON.parse(readFileSync(join(assetDir(p, name), 'asset.json'), 'utf8')) as AssetJson;
}

export function assetJsonFor(doc: Doc, entries: TapeEntry[]): AssetJson {
  return {
    name: doc.name, kind: doc.kind, size: [doc.width, doc.height], cell: [doc.cellW, doc.cellH], wrap: doc.wrap,
    palette: doc.palette.name, layers: doc.layers.map((l) => ({ name: l.name })), frames: doc.frameCount,
    tags: [], views: [], links: [],
    tape: { lang: LANG_VERSION, commands: entries.length, groups: new Set(entries.map((e) => e.group)).size },
    state: { sha256: sha256(serializeDoc(doc)) },
    checkpoints: { every: CHECKPOINT_EVERY, files: [] },
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

/** Write an asset's tape, asset.json and preview.png. */
export function saveAsset(p: Project, state: AssetState): string {
  const doc = state.doc;
  if (!doc) throw new ProjectError('nothing to save: the tape has no document');
  const dir = assetDir(p, doc.name);
  mkdirSync(join(dir, 'checkpoints'), { recursive: true });
  writeFileSync(join(dir, 'tape.jsonl'), tapeToJsonl(state.entries));
  writeJson(join(dir, 'asset.json'), assetJsonFor(doc, state.entries));
  writeFileSync(join(dir, 'preview.png'), previewPng(doc));
  return dir;
}

// The server lock: a running server is the single writer for its project. It writes
// .pixelclaw.lock (pid and URL) and removes it on exit; other writers refuse while it is held.

export const LOCK_FILE = '.pixelclaw.lock';

export interface LockInfo {
  pid: number;
  url: string;
}

function alive(pid: number): boolean {
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
