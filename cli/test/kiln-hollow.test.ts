// The G10 demo project (examples/kiln-hollow.pclaw): a manifest of 20 assets from a one-paragraph
// theme, three of them taken end to end. Every tape replays; running the scripts again (the
// drawing with sizes left to the manifest, the review's notes and fixes, the marks) gives the
// same tape commands and the same state; the plan says 3 exported and 17 planned; every check
// passes on what is drawn.
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Writer, loadProject } from '@pixelclaw/server';
import { main, type Io } from '../src/index.ts';

const ROOT = join(import.meta.dirname, '..', '..', 'examples');
const PROJECT = join(ROOT, 'kiln-hollow.pclaw');
const SRC = join(ROOT, 'kiln-hollow');
const ASSETS = ['clay', 'urn', 'kiln'];
const FINDINGS = { clay: 5, urn: 7, kiln: 5 } as Record<string, number>;

function cli(args: string[]): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const io: Io = { out: (s) => { out += s; }, err: (s) => { err += s; }, stdin: () => '', now: () => '2026-10-28T00:00:00Z' };
  return { code: main(args, io), out, err };
}

const tape = (dir: string, a: string) => readFileSync(join(dir, 'assets', a, 'tape.jsonl'), 'utf8').trim().split('\n').slice(1).map((l) => JSON.parse(l) as { by: string; cmd: string });

describe('examples/kiln-hollow.pclaw', () => {
  it('verifies, and every check passes on the drawn assets', () => {
    const v = cli(['verify', PROJECT]);
    for (const a of ASSETS) expect(v.out).toContain(`ok   ${a}`);
    expect(v.code).toBe(0);
    const c = cli(['check', PROJECT]);
    for (const a of ASSETS) expect(c.out).toMatch(new RegExp(`^${a}: all \\d+ checks pass$`, 'm'));
  });

  it('the plan: a valid manifest of 20, three exported', () => {
    const r = cli(['plan', PROJECT, '--json']);
    expect(r.code).toBe(0);
    const plan = JSON.parse(r.out) as { manifest: { errors: unknown[] }; counts: Record<string, number>; assets: { name: string; status: string }[] };
    expect(plan.manifest.errors).toEqual([]);
    expect(plan.counts).toEqual({ planned: 17, drafted: 0, checked: 0, reviewed: 0, approved: 0, exported: 3 });
    expect(plan.assets.filter((a) => a.status === 'exported').map((a) => a.name).sort()).toEqual(['clay', 'kiln', 'urn']);
  });

  it('the scripts rebuild the same tapes and states', () => {
    const root = mkdtempSync(join(tmpdir(), 'pixelclaw-kiln-'));
    try {
      const dir = join(root, 'k.pclaw');
      cpSync(PROJECT, dir, { recursive: true, filter: (f) => !/[\\/](assets|exports|reviews|views|templates|\.cache)([\\/]|$)/.test(f.slice(PROJECT.length)) && !f.endsWith('exported.json') });
      const w = new Writer(loadProject(dir), { now: () => '2026-10-28T00:00:00Z' });
      const run = (asset: string, commands: string, by = 'claude') => {
        const r = w.run({ asset, commands, by });
        if (!r.ok) throw new Error(`${asset}: ${r.errors.map((e) => `${e.line}:${e.col} ${e.message}`).join('; ')}`);
      };
      const script = (f: string) => readFileSync(join(SRC, 'scripts', f), 'utf8');
      for (const a of ASSETS) run(a, script(`${a}.pclaw`));
      for (const a of ASSETS) {
        run(a, script(`${a}_review.pclaw`));
        run(a, script(`${a}_fix.pclaw`));
        run(a, `mark reviewed "blind review g10: ${FINDINGS[a]} findings fixed by coordinates"`);
      }
      for (const a of ASSETS) run(a, 'mark approved', 'human:chris');
      for (const a of ASSETS) {
        expect(tape(dir, a).map((e) => [e.by, e.cmd]), a).toEqual(tape(PROJECT, a).map((e) => [e.by, e.cmd]));
        const state = (d: string) => JSON.parse(readFileSync(join(d, 'assets', a, 'asset.json'), 'utf8')).state.sha256;
        expect(state(dir), a).toBe(state(PROJECT));
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
