// Worker discipline: `done` refused while a check fails, the stall watchdog, and the spend ledger
// across runs.

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


describe('worker discipline', () => {
  let root: string, dir: string, s: Served, c: Client;
  const call = async (name: string, args: Record<string, unknown> = {}) => (await c.callTool({ name, arguments: args })) as { content: Content; isError?: boolean };
  beforeAll(async () => {
    ({ root, dir } = scratch());
    ask(dir, ['jar', 'post', 'turf']);
    s = await serve({ project: dir, port: 0, mcp: false, log: () => undefined });
    c = new Client({ name: 'agent', version: '1' });
    await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${s.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${s.token}` } } }));
  }, 30_000);
  afterAll(async () => { await c?.close(); await s?.close(); rmSync(root, { recursive: true, force: true }); });

  it('work done is refused while the asset fails a check (the reply lists them); blocked stays open; fixed, done is taken', async () => {
    expect(texts((await call('work')).content)).toMatch(/claimed r1/);
    let r = await call('work', { action: 'done', text: 'drew it' });
    expect(r.isError).toBe(true);
    expect(texts(r.content)).toMatch(/r1 is not done: jar is not drawn yet/);
    expect((await call('run', { asset: 'jar', commands: 'new sprite jar\nellipse 3,3 10x10 c=stone3 fill' })).isError).toBeFalsy();
    r = await call('work', { action: 'done', text: 'drew it' });
    expect(r.isError).toBe(true);
    expect(texts(r.content)).toMatch(/r1 is not done: jar fails \d checks?:\n {2}outline 0 \(limit ≥ 0\.85\): 0 of \d+ silhouette edge px are ink/);
    expect(texts(r.content)).toMatch(/work\(action="blocked"/);
    expect(readRequestRecords(loadProject(dir)).filter((x) => x.id === 'r1').map((x) => x.type)).toEqual(['request', 'claim']);
    expect((await call('run', { asset: 'jar', commands: 'outline c=ink' })).isError).toBeFalsy();
    r = await call('work', { action: 'done', text: 'drew it, outlined' });
    expect(r.isError).toBeFalsy();
    // blocked is always open to it, failing or not.
    expect(texts((await call('work')).content)).toMatch(/claimed r2/);
    expect((await call('run', { asset: 'post', commands: 'new sprite post\nrect 6,2 4x12 c=soil1 fill' })).isError).toBeFalsy();
    expect((await call('work', { action: 'blocked', text: 'Wood or stone?' })).isError).toBeFalsy();
  });
});



describe('the stall watchdog and the spend ledger', () => {
  const run = async (dir: string, opts: string[], worker: Record<string, unknown> = {}) => {
    const pj = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'));
    writeFileSync(join(dir, 'project.json'), JSON.stringify({ ...pj, worker: { enabled: true, cap: 1, command: [process.execPath, FAKE, ...opts], ...worker } }, null, 2));
    const s = await serve({ project: dir, port: 0, mcp: false, log: () => undefined });
    try { return await s.worker.start('human:ana'); } finally { await s.close(); }
  };

  it('a session with no tool call for `stall` minutes is stopped and resumed once; it finishes', async () => {
    const { root, dir } = scratch();
    const rec = join(root, 'argv.jsonl');
    try {
      ask(dir, ['urn']);
      process.env.FAKE_CLAUDE_RECORD = rec;
      const why = await run(dir, ['--fake-mode', 'stall'], { stall: 0.05 });
      expect(why).toBe('the queue is empty');
      const log = readFileSync(join(dir, 'logs', 'worker.log'), 'utf8');
      expect(log).toMatch(/watchdog: no tool call for 0\.05 min; stopping the session/);
      expect(log).toMatch(/session 1: no tool call for 0\.05 min; stopped it; resuming it once/);
      const argvs = records(rec).map((r) => r.argv!);
      expect(argvs).toHaveLength(2);
      expect(after(argvs[1]!, '--resume')).toMatch(/^fake-\d+$/);
      expect(after(argvs[1]!, '-p')).toMatch(/You made no tool call for 0\.05 minutes/);
      expect(after(argvs[1]!, '--tools')).toBe('');
      expect(readRequestRecords(loadProject(dir)).filter((x) => x.type === 'done').map((x) => x.id)).toEqual(['r1']);
      // The stopped session reported no cost: its tokens are charged at the dearest rates (an upper bound).
      const spend = readSpend(dir);
      expect(spend.map((x) => [x.session, x.estimated ?? false])).toEqual([[1, true], [1, false]]);
      expect(spend[0]!.cost).toBeCloseTo((2 * 1000 * 15 + 2 * 100 * 75) / 1e6, 6); // plan and work, 1000 tokens in and 100 out each
    } finally { delete process.env.FAKE_CLAUDE_RECORD; rmSync(root, { recursive: true, force: true }); }
  }, 60_000);

  it('stalling again after the resume marks the request blocked, with why', async () => {
    const { root, dir } = scratch();
    try {
      ask(dir, ['urn']);
      expect(await run(dir, ['--fake-mode', 'stall', '--fake-stall-again'], { stall: 0.05 })).toBe('the queue is empty');
      const blocked = readRequestRecords(loadProject(dir)).filter((x) => x.type === 'blocked');
      expect(blocked).toEqual([expect.objectContaining({ id: 'r1', by: 'claude', text: expect.stringMatching(/The worker stalled on this \(no tool call for 0\.05 min, twice\)/) })]);
      expect(readFileSync(join(dir, 'logs', 'worker.log'), 'utf8')).toMatch(/stalled again; r1 marked blocked/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 60_000);

  it('the cap is a total over every run (worker-spend.jsonl), and a spent cap refuses to start', async () => {
    const { root, dir } = scratch();
    try {
      ask(dir, ['urn']);
      expect(await run(dir, ['--fake-cost', '0.4'])).toBe('the queue is empty');
      expect(workerSpent(dir)).toBe(0.4);
      ask(dir, ['jar']);
      expect(await run(dir, ['--fake-cost', '0.4'])).toBe('the queue is empty');
      let log = readFileSync(join(dir, "logs", "worker.log"), "utf8");
      expect(log).toMatch(/cap \$1\.00 \(\$0\.40 spent before\)/);
      expect(log).toMatch(/session 1: budget \$0\.60/);
      expect(workerSpent(dir)).toBe(0.8);
      ask(dir, ['post', 'turf']);
      expect(await run(dir, ['--fake-cost', '0.4'])).toBe('the budget cap was reached ($1.00 of $1.00)');
      log = readFileSync(join(dir, 'logs', 'worker.log'), 'utf8');
      expect(log).toMatch(/session 1: budget \$0\.20/);
      expect(readSpend(dir).map((x) => x.cost)).toEqual([0.4, 0.4, 0.2]);
      expect(readFileSync(join(dir, WORKER_SPEND), 'utf8').trim().split('\n')).toHaveLength(3);
      await expect(run(dir, ['--fake-cost', '0.4'])).rejects.toThrow(/has spent \$1\.00 of its \$1\.00 cap on this project \(worker-spend\.jsonl\); raise worker\.cap/);
      // Raised, it goes on from the total.
      expect(await run(dir, ['--fake-cost', '0.4'], { cap: 2 })).toBe('the queue is empty');
      expect(workerSpent(dir)).toBe(1.4);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 90_000);

  it('the command reference is every registered command', () => {
    const ref = commandReference().split('\n');
    expect(ref).toHaveLength(COMMANDS.size);
    expect(ref).toContain(COMMANDS.get('px')!.summary);
  });
});

// Wait helper kept for later items' tests.
void until;
