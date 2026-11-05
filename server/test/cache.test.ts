// G10: the state cache. A fresh writer reads each asset's state from
// .cache/state/<asset>.gwc when its key matches the tape, and that state is byte-identical to a
// full replay; a changed tape, a changed palette (language 1) or a broken file falls back to the
// replay; `pixelclaw verify` compares the cache with the replay.

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { replay, serializeDoc, tapeLang } from '@pixelclaw/core';
import { main, type Io } from '../../cli/src/index.ts';
import {
  Writer, engineStamp, listAssets, loadProject, paletteSource, readStateCacheRaw, readTape, readTapeFile, stateCacheFile, stateKey, writeStateCache, type Project,
} from '../src/index.ts';

const EXAMPLE = join(import.meta.dirname, '..', '..', 'examples', 'mossy-ruins.pclaw');
let root: string;
let proj: Project;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'pixelclaw-cache-'));
  cpSync(EXAMPLE, join(root, 'p.pclaw'), { recursive: true, filter: (f) => !f.includes('.cache') && !f.includes('/views') && !f.includes('/exports') });
  proj = loadProject(join(root, 'p.pclaw'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function verify(...names: string[]): { code: number; out: string } {
  let out = '';
  const io: Io = { out: (s) => { out += s; }, err: (s) => { out += s; }, stdin: () => '', now: () => '2026-10-28T00:00:00Z' };
  return { code: main(['verify', proj.dir, ...names], io), out };
}

describe('the state cache', () => {
  it('gives every asset of the example byte-identical to a full replay', () => {
    new Writer(proj).assetDocs(); // replays and writes the cache
    expect(readFileSync(join(proj.dir, '.cache', '.gitignore'), 'utf8')).toBe('*\n');
    const names = listAssets(proj);
    expect(names.length).toBeGreaterThan(30);
    const cached = new Writer(loadProject(proj.dir));
    for (const name of names) {
      const { bytes, entries } = readTapeFile(proj, name);
      const raw = readStateCacheRaw(proj, name)!;
      expect(raw.key, name).toBe(stateKey(proj, bytes, tapeLang(entries)));
      const full = replay(entries, paletteSource(proj));
      expect(full.problems, name).toEqual([]);
      const want = Buffer.from(serializeDoc(full.doc!));
      expect(Buffer.compare(Buffer.from(raw.body), want), name).toBe(0);
      expect(Buffer.compare(Buffer.from(serializeDoc(cached.doc(name))), want), name).toBe(0);
    }
    const v = verify('chest', 'shore', 'village');
    expect(v.out).toContain('cache checked');
    expect(v.code).toBe(0);
  });

  it('is written as a tape grows, and a stale or broken entry is replayed instead', () => {
    const w = new Writer(proj);
    const r = w.run({ asset: 'chest', commands: 'px 1,1 c=ink', by: 'claude' });
    expect(r.ok).toBe(true);
    const after = Buffer.from(serializeDoc(w.doc('chest')));
    const raw = readStateCacheRaw(proj, 'chest')!;
    expect(Buffer.compare(Buffer.from(raw.body), after)).toBe(0);
    // A tape changed behind the cache's back (a git checkout): the key no longer matches.
    const tapeFile = join(proj.dir, 'assets', 'chest', 'tape.jsonl');
    const lines = readFileSync(tapeFile, 'utf8').trimEnd().split('\n');
    writeFileSync(tapeFile, lines.slice(0, -1).join('\n') + '\n');
    const shorter = replay(readTape(proj, 'chest'), paletteSource(proj)).doc!;
    expect(Buffer.compare(Buffer.from(serializeDoc(new Writer(loadProject(proj.dir)).doc('chest'))), Buffer.from(serializeDoc(shorter)))).toBe(0);
    // A broken file under the right key is ignored too.
    const { bytes, entries } = readTapeFile(proj, 'chest');
    writeStateCache(proj, 'chest', stateKey(proj, bytes, tapeLang(entries)), new Uint8Array([1, 2, 3]));
    expect(Buffer.compare(Buffer.from(serializeDoc(new Writer(loadProject(proj.dir)).doc('chest'))), Buffer.from(serializeDoc(shorter)))).toBe(0);
  });

  it('is keyed by the engine, and verify catches a cache that differs from the replay', () => {
    expect(engineStamp()).toMatch(/^[0-9a-f]{64}$/);
    const { bytes, entries } = readTapeFile(proj, 'grass');
    const key = stateKey(proj, bytes, tapeLang(entries));
    // Another asset's state under grass's key: only verify can tell.
    new Writer(proj).doc('sand');
    writeStateCache(proj, 'grass', key, readStateCacheRaw(proj, 'sand')!.body);
    const v = verify('grass');
    expect(v.out).toContain('the state cache differs from the replay');
    expect(v.code).toBe(1);
    rmSync(stateCacheFile(proj, 'grass'));
    expect(existsSync(stateCacheFile(proj, 'grass'))).toBe(false);
    expect(verify('grass').code).toBe(0);
  });
});
