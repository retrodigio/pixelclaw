// The G10 and G11 demo project (examples/kiln-hollow.pclaw): a manifest of 20 assets from a
// one-paragraph theme, three of them taken end to end (G10); then a HUD set and two tiles more,
// the yard's mockup underlay snapped into a draft, three tiles cut from it and cleaned, a 5x7 font
// and four icons (G11); scenes, a sheet of pot shards imported into the gallery, and three
// requests from the dashboard: urn_blue drawn (done), the goat blocked on a question, the jar's
// change claimed (G12). Every tape replays; running the scripts again gives the same tape commands
// and the same state; the plan says 3 exported, 9 checked, 3 drafted and 14 planned of 29; every
// check passes on what is drawn but the imported shards (drafted: jaggies, as imported).
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Writer, importIntoProject, loadProject, readRequestRecords } from '@pixelclaw/server';
import { foldRequests } from '@pixelclaw/core';
import { main, type Io } from '../src/index.ts';

const ROOT = join(import.meta.dirname, '..', '..', 'examples');
const PROJECT = join(ROOT, 'kiln-hollow.pclaw');
const SRC = join(ROOT, 'kiln-hollow');
const ASSETS = ['clay', 'urn', 'kiln'];
const G11 = ['yard', 'sage', 'yard_clay', 'shallows', 'hollow_type', 'jar_icon', 'hearth_icon', 'drop_icon', 'bowl_icon'];
const G12 = ['urn_blue', 'shards_1', 'shards_2', 'shards_3'];
const SHARDS = ['shards_1', 'shards_2', 'shards_3'];
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
    for (const a of [...ASSETS, ...G11, ...G12]) expect(v.out).toContain(`ok   ${a}`);
    expect(v.code).toBe(0);
    const c = cli(['check', PROJECT]);
    for (const a of [...ASSETS, ...G11, 'urn_blue']) expect(c.out).toMatch(new RegExp(`^${a}: all \\d+ checks pass$`, 'm'));
    // The imported shards are as the sheet drew them: drafted, with jaggies to fix.
    for (const a of SHARDS) expect(c.out).toMatch(new RegExp(`^${a}: 1 of \\d+ checks failing`, 'm'));
  });

  it('the plan: a valid manifest of 29 with scenes, three exported, nine checked, the shards drafted', () => {
    const r = cli(['plan', PROJECT, '--json']);
    expect(r.code).toBe(0);
    const plan = JSON.parse(r.out) as { manifest: { errors: unknown[] }; counts: Record<string, number>; assets: { name: string; status: string }[] };
    expect(plan.manifest.errors).toEqual([]);
    expect(plan.counts).toEqual({ planned: 14, drafted: 3, checked: 9, reviewed: 0, approved: 0, exported: 3 });
    expect(plan.assets.filter((a) => a.status === 'exported').map((a) => a.name).sort()).toEqual(['clay', 'kiln', 'urn']);
    expect(plan.assets.filter((a) => a.status === 'drafted').map((a) => a.name)).toEqual(SHARDS);
    const p = plan as unknown as { scenes: { name: string; missing: string[] }[] };
    expect(p.scenes.map((x) => [x.name, x.missing.length])).toEqual([['kiln_yard', 8], ['stream_bank', 3], ['trade_menu', 0]]);
  });

  it('the requests: urn_blue done, the goat blocked on a question, the jar claimed', () => {
    const { requests, problems } = foldRequests(readRequestRecords(loadProject(PROJECT)));
    expect(problems).toEqual([]);
    expect([...requests.values()].map((q) => [q.id, q.kind, q.asset, q.by, q.state])).toEqual([
      ['r1', 'draw', 'urn_blue', 'human:chris', 'done'], ['r2', 'draw', 'goat', 'human:chris', 'blocked'], ['r3', 'change', 'jar_icon', 'human:chris', 'claimed'],
    ]);
    expect(requests.get('r2')!.question).toMatch(/^Horns or none\?/);
  });

  it('the scripts rebuild the same tapes and states', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pixelclaw-kiln-'));
    try {
      const dir = join(root, 'k.pclaw');
      cpSync(PROJECT, dir, { recursive: true, filter: (f) => !/[\\/](assets|exports|reviews|views|templates|blobs|\.cache)([\\/]|$)/.test(f.slice(PROJECT.length)) && !f.endsWith('exported.json') });
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
      // G11: the yard's underlay from the checked-in mockup, snapped; tiles cut and cleaned; the font; the icons and their fixes.
      run('yard', script('yard.pclaw'));
      const u = await w.runAsync({ asset: 'yard', commands: `underlay import ${join(SRC, 'yard-mockup.png')} layout=${join(SRC, 'yard-layout.png')}`, by: 'claude' });
      expect(u.ok).toBe(true);
      run('yard', 'snap');
      for (const t of ['sage', 'yard_clay', 'shallows']) { run(t, script(`${t}.pclaw`)); run(t, script(`${t}_clean.pclaw`)); }
      run('yard', 'layer set draft reference=on');
      run('hollow_type', script('hollow_type.pclaw'));
      for (const i of ['jar_icon', 'hearth_icon', 'drop_icon', 'bowl_icon']) run(i, script(`${i}.pclaw`));
      for (const i of ['jar_icon', 'drop_icon', 'bowl_icon']) run(i, script(`${i}_fix.pclaw`));
      // G12: the person's import of the shards and their change request (its mark); the agent's urn_blue and its start on the jar.
      importIntoProject(w, { path: join(SRC, 'shards.png'), slice: { cell: [24, 24] }, pattern: 'shards_{n}', kind: 'sprite', set: 'clutter', palette: 'kiln-hollow' }, 'human:chris');
      run('jar_icon', 'mark rejected "a wider mouth, so it reads as a jar at 1x"', 'human:chris');
      run('urn_blue', script('urn_blue.pclaw'));
      run('jar_icon', script('jar_icon_g12.pclaw'));
      for (const a of [...ASSETS, ...G11, ...G12]) {
        expect(tape(dir, a).map((e) => [e.by, e.cmd]), a).toEqual(tape(PROJECT, a).map((e) => [e.by, e.cmd]));
        const state = (d: string) => JSON.parse(readFileSync(join(d, 'assets', a, 'asset.json'), 'utf8')).state.sha256;
        expect(state(dir), a).toBe(state(PROJECT));
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
