// Families follow the tiles their textures came from, frame by frame.

import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { COMMANDS, commandReference, encodePng, createRgba, flatten, layoutOf } from '@pixelclaw/core';
import { serve, type Served } from '../src/serve.ts';
import { BUILTIN_TOOLS, SANDBOX_FLAGS, WORKER_SPEND, Writer, loadProject, readRequestRecords, readSpend, workerSettings, workerSettingsProblem, workerSpent } from '../src/index.ts';
import { BIN, PALETTE, texts, until, type Content } from './spawn.ts';
import { fakeModelEnv, startFakeModel } from './fake-model-api.ts';

const FAKE = join(import.meta.dirname, 'fake-claude.ts');

const MANIFEST = {
  format: 'pixelclaw-manifest', version: 1, theme: 'Old stone under moss, lit from the top left.',
  sets: { ground: { description: 'floors' }, props: { description: 'things that stand' } },
  assets: [
    { name: 'turf', kind: 'tile', size: '24x24', set: 'ground', description: 'short moss' },
    { name: 'urn', kind: 'sprite', size: '16x16', set: 'props', height: 12, description: 'a squat stone urn' },
    { name: 'jar', kind: 'sprite', size: '16x16', set: 'props', height: 12, description: 'a clay jar' },
    { name: 'post', kind: 'sprite', size: '16x16', set: 'props', height: 14, description: 'a waymark post' },
  ],
};

/** A temporary root holding a project (with the manifest) and whatever a test puts beside it. */
function scratch(worker?: Record<string, unknown>): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), 'pixelclaw-g15-'));
  const dir = join(root, 'ruins.pclaw');
  execFileSync(process.execPath, [BIN, 'new', dir, '--palette', PALETTE]);
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(MANIFEST));
  execFileSync(process.execPath, [BIN, 'plan', dir, '--manifest', join(root, 'manifest.json')]);
  if (worker) {
    const pj = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'));
    writeFileSync(join(dir, 'project.json'), JSON.stringify({ ...pj, worker }, null, 2));
  }
  return { root, dir };
}

/** Requests to draw planned assets, as a person's records. */
function ask(dir: string, assets: string[]): void {
  const have = readRequestRecords(loadProject(dir)).filter((r) => r.type === 'request').length;
  writeFileSync(join(dir, 'requests.jsonl'), (existsSync(join(dir, 'requests.jsonl')) ? readFileSync(join(dir, 'requests.jsonl'), 'utf8') : '') +
    assets.map((a, i) => JSON.stringify({ type: 'request', id: `r${have + i + 1}`, asset: a, kind: 'draw', note: '', by: 'human:ana', at: '2026-10-29T10:00:00Z' }) + '\n').join(''));
}

/** `pixelclaw work <dir>` as a person runs it, with a bin folder first on the PATH. */
function work(dir: string, env: Record<string, string> = {}): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, 'work', dir], { env: { ...process.env, ...env }, timeout: 90_000 }, (err, _out, stderr) => {
      resolve({ code: err ? Number((err as { code?: number }).code ?? 1) : 0, stderr: String(stderr) });
    });
  });
}

/** A folder with an executable `claude` that runs the fake with these options. */
function fakeOnPath(root: string, opts: string[] = []): string {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" ${opts.map((o) => `'${o}'`).join(' ')} "$@"\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  return bin;
}

const records = (f: string) => readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { argv?: string[]; probe?: { tool: string; error: boolean; text: string }[] });
const after = (argv: string[], flag: string) => argv[argv.indexOf(flag) + 1];




describe('family textures follow their source tiles', () => {
  it('a change to a tile is copied into the families whose textures came from it, frame by frame; a texture drawn from rows is left alone', () => {
    const { root, dir } = scratch();
    try {
      const w = new Writer(loadProject(dir), { now: () => '2026-10-29T12:00:00Z' });
      const ok = (asset: string, commands: string, by = 'claude') => { const r = w.run({ asset, commands, by }); if (!r.ok) throw new Error(r.errors.map((e) => e.message).join('; ')); return r; };
      ok('sand', 'new tile sand 8x8\nfill 0,0 c=soil2');
      ok('water', 'new tile water 8x8\nfill 0,0 c=pool\nframe add copy=1\nframe 2\npx 1,1 c=stone5\nframe 1');
      ok('shore', 'new family shore 8x8 scheme=blob47\nframe add\nframe 1\nfamily texture inside from=sand\nfamily texture outside from=water frame=1\nframe 2\nfamily texture inside from=sand\nfamily texture outside from=water frame=2\nframe 1\nfamily band 2:outside 1:soil0');
      ok('beach', 'new family beach 8x8 scheme=blob47\nfamily texture inside from=sand\nfamily texture inside <<\n' + '  hhhhhhhh\n'.repeat(8) + '>>');
      const cell = (name: string, which: 'inside' | 'outside', frame: number) => {
        const d = w.doc(name);
        const [cx, cy] = layoutOf(d.family!)[which === 'inside' ? 'inside' : 'outside'] as [number, number];
        const px = flatten(d, frame);
        return Array.from({ length: 64 }, (_, k) => d.palette.entries[px[(cy * 8 + (k >> 3)) * d.width + cx * 8 + (k & 7)]!]!.name).join(' ');
      };
      const tile = (name: string, frame: number) => { const d = w.doc(name); const px = flatten(d, frame); return Array.from(px, (v) => d.palette.entries[v]!.name).join(' '); };
      expect(cell('shore', 'inside', 0)).toBe(tile('sand', 0));
      // The sand changes: shore's inside follows on both its frames, beach's own rows stay.
      const beachBefore = w.state('beach').entries.length;
      const r = ok('sand', 'px 2,2 c=ink', 'human:ana');
      expect(r.followed).toEqual(['shore']);
      expect(cell('shore', 'inside', 0)).toBe(tile('sand', 0));
      expect(cell('shore', 'inside', 1)).toBe(tile('sand', 0));
      expect(cell('shore', 'inside', 0)).toContain('ink');
      const added = w.state('shore').entries.slice(-4).map((e) => [e.by, e.cmd.split('\n')[0]]);
      expect(added).toEqual([['human:ana', 'family texture inside from=sand frame=1 <<'], ['human:ana', 'frame 2'], ['human:ana', 'family texture inside from=sand frame=1 <<'], ['human:ana', 'frame 1']]);
      expect(new Set(w.state('shore').entries.slice(-4).map((e) => e.group)).size).toBe(1);
      expect(w.state('beach').entries.length).toBe(beachBefore);
      // The water's second frame changes: only shore's second frame's outside is copied again.
      const r2 = ok('water', 'frame 2\npx 5,5 c=ink\nframe 1');
      expect(r2.followed).toEqual(['shore']);
      expect(cell('shore', 'outside', 1)).toBe(tile('water', 1));
      expect(cell('shore', 'outside', 0)).toBe(tile('water', 0));
      expect(w.state('shore').entries.slice(-3).map((e) => e.cmd.split('\n')[0])).toEqual(['frame 2', 'family texture outside from=water frame=2 <<', 'frame 1']);
      // A change that leaves the tile's pixels as they were writes nothing.
      const n = w.state('shore').entries.length;
      expect(ok('sand', 'note 1,1 "nice"').followed).toBeUndefined();
      expect(w.state('shore').entries.length).toBe(n);
      // The tapes still replay to the same state.
      expect(execFileSync(process.execPath, [BIN, 'verify', dir], { encoding: 'utf8' })).toMatch(/verified/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 30_000);
});


// Wait helper kept for later items' tests.
void until;
