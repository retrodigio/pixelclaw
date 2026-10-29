// The state cache (plan §18): each asset's document after its whole tape, kept as state bytes in
// <project>/.cache/state/<asset>.gwc so a CLI call or a fresh server reads it instead of
// replaying every tape. A cache file is used only when its key matches: the SHA-256 of the tape
// file, of the engine that made it (core's sources, or the bundle) and, for a language 1 tape
// (which reads the project's palettes), of those palettes. Anything else replays and rewrites it.
// The folder holds its own .gitignore: the cache is never committed. `pixelclaw verify` replays
// every tape and compares the cache with the replay byte for byte.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deserializeDoc, paletteToJson, type Doc } from '@pixelclaw/core';
import { sha256, type Project } from './project.ts';

const MAGIC = 'PCLAWSTATE 1';
export const CACHE_DIR = '.cache';

let stamp: string | null = null;

/**
 * What the replay code is: a hash of core's sources and built-in schemes when running from the
 * repo, else of the bundle this code is in. A change to either makes every cache entry stale.
 */
export function engineStamp(): string {
  if (stamp) return stamp;
  const here = fileURLToPath(import.meta.url);
  const core = join(dirname(here), '..', '..', 'core');
  const files: string[] = [];
  if (here.endsWith('.ts') && existsSync(join(core, 'src'))) {
    for (const d of ['src', 'schemes']) {
      const dir = join(core, d);
      if (existsSync(dir)) for (const f of readdirSync(dir).sort()) if (/\.(ts|json)$/.test(f)) files.push(join(dir, f));
    }
  } else files.push(here);
  const parts = files.map((f) => `${f.slice(core.length)}\n${sha256(readFileSync(f))}`);
  return (stamp = sha256(Buffer.from(parts.join('\n'), 'utf8')));
}

/** The key a cached state must carry for this tape (its file's bytes). */
export function stateKey(p: Project, tapeBytes: Uint8Array, lang: number): string {
  const pals = lang === 1 ? [...p.palettes.values()].map(paletteToJson).join('\n') : '';
  return sha256(Buffer.concat([Buffer.from(`${engineStamp()}\n${pals}\n`, 'utf8'), tapeBytes]));
}

export function stateCacheFile(p: Project, name: string): string {
  return join(p.dir, CACHE_DIR, 'state', `${name}.gwc`);
}

/** The cached document for this key, or null (missing, stale or unreadable). */
export function readStateCache(p: Project, name: string, key: string): Doc | null {
  const f = stateCacheFile(p, name);
  if (!existsSync(f)) return null;
  try {
    const b = readFileSync(f);
    const nl = b.indexOf(10);
    if (nl < 0 || b.subarray(0, nl).toString('utf8') !== `${MAGIC} ${key}`) return null;
    return deserializeDoc(b.subarray(nl + 1));
  } catch {
    return null;
  }
}

/** The cached state bytes (for verify), whatever their key. */
export function readStateCacheRaw(p: Project, name: string): { key: string; body: Uint8Array } | null {
  const f = stateCacheFile(p, name);
  if (!existsSync(f)) return null;
  const b = readFileSync(f);
  const nl = b.indexOf(10);
  const m = nl > 0 ? new RegExp(`^${MAGIC} ([0-9a-f]{64})$`).exec(b.subarray(0, nl).toString('utf8')) : null;
  return m ? { key: m[1]!, body: b.subarray(nl + 1) } : null;
}

/** Keep the state bytes under this key (written to a temporary file, then renamed into place). */
export function writeStateCache(p: Project, name: string, key: string, body: Uint8Array): void {
  const f = stateCacheFile(p, name);
  try {
    const root = join(p.dir, CACHE_DIR);
    mkdirSync(dirname(f), { recursive: true });
    if (!existsSync(join(root, '.gitignore'))) writeFileSync(join(root, '.gitignore'), '*\n');
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, Buffer.concat([Buffer.from(`${MAGIC} ${key}\n`, 'utf8'), body]));
    renameSync(tmp, f);
  } catch {
    // a read-only project: every call replays, as before
  }
}

export function dropStateCache(p: Project, name: string): void {
  rmSync(stateCacheFile(p, name), { force: true });
}

// Check results (plan §21 item 6): each asset's plain check run (every check, every frame) kept in
// .cache/checks/<asset>.json under a key made of the engine, the style guide, the manifest, the
// palettes and the state keys of every asset the checks read (the asset, its ground, its set and
// peers, or every asset for map checks). `plan` in a fresh process reads them instead of running
// every check on every asset again.

export function checkCacheFile(p: Project, name: string): string {
  return join(p.dir, CACHE_DIR, 'checks', `${name}.json`);
}

export function checkCacheKey(parts: unknown): string {
  return sha256(Buffer.from(JSON.stringify([engineStamp(), parts]), 'utf8'));
}

export function readCheckCache<T>(p: Project, name: string, key: string): T | null {
  try {
    const j = JSON.parse(readFileSync(checkCacheFile(p, name), 'utf8')) as { key: string; out: T };
    return j.key === key ? j.out : null;
  } catch {
    return null;
  }
}

export function writeCheckCache(p: Project, name: string, key: string, out: unknown): void {
  const f = checkCacheFile(p, name);
  try {
    const root = join(p.dir, CACHE_DIR);
    mkdirSync(dirname(f), { recursive: true });
    if (!existsSync(join(root, '.gitignore'))) writeFileSync(join(root, '.gitignore'), '*\n');
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ key, out }));
    renameSync(tmp, f);
  } catch {
    // a read-only project: checks run every time
  }
}
