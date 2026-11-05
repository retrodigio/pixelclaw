// Requests filed, answered and withdrawn over MCP, as the dashboard does.

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



describe('requests from MCP', () => {
  it('an agent files, answers and withdraws requests as the dashboard does; the worker\'s own connection has no request tool', async () => {
    const { root, dir } = scratch({ enabled: true, cap: 1 });
    const s = await serve({ project: dir, port: 0, mcp: false, log: () => undefined });
    const c = new Client({ name: 'agent', version: '1' });
    try {
      await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${s.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${s.token}` } } }));
      const call = async (args: Record<string, unknown>) => (await c.callTool({ name: 'request', arguments: args })) as { content: Content; isError?: boolean };
      expect(texts((await call({ kind: 'draw', asset: 'urn', note: 'squat' })).content)).toMatch(/^r1 draw urn: "squat" \(from claude at .*; open\)$/);
      expect((await c.callTool({ name: 'run', arguments: { asset: 'turf', commands: 'new tile turf\nfill 0,0 c=moss1' } }) as { isError?: boolean }).isError).toBeFalsy();
      expect(texts((await call({ kind: 'change', asset: 'turf', note: 'more tufts' })).content)).toMatch(/^r2 change turf: "more tufts"/);
      expect(readFileSync(join(dir, 'assets', 'turf', 'tape.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1)).toMatchObject({ by: 'claude', cmd: 'mark rejected "more tufts"' });
      expect(texts((await call({ kind: 'add', entry: { name: 'crate', kind: 'sprite', size: '16x16', set: 'props' } })).content)).toMatch(/^r3 new asset crate/);
      let r = await call({ kind: 'add', entry: { name: 'crate2', kind: 'sprite' } });
      expect(r.isError).toBe(true);
      expect(texts(r.content)).toMatch(/the new entry has problems/);
      r = await call({ kind: 'change', asset: 'turf' });
      expect(texts(r.content)).toMatch(/say what should change/);
      expect(texts((await call({ action: 'cancel', id: 'r3', text: 'later' })).content)).toMatch(/cancelled\)$/);
      expect(texts((await call({ action: 'reply', id: 'r1', text: 'x' })).content)).toMatch(/only a blocked request takes a reply/);
      expect(readRequestRecords(loadProject(dir)).map((x) => `${x.type} ${x.id}`)).toEqual(['request r1', 'request r2', 'request r3', 'cancel r3']);
      // The worker's connection (its own token, fenced) does not offer the tool.
      const rec = join(root, 'probe.jsonl');
      process.env.FAKE_CLAUDE_RECORD = rec;
      process.env.FAKE_CLAUDE_PROBE = JSON.stringify([['request', { kind: 'draw', asset: 'jar' }]]);
      const pj = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'));
      writeFileSync(join(dir, 'project.json'), JSON.stringify({ ...pj, worker: { ...pj.worker, command: [process.execPath, FAKE, '--fake-mode', 'probe'] } }));
      await s.worker.start('human:ana');
      expect(records(rec).find((x) => x.probe)!.probe![0]).toMatchObject({ error: true, text: expect.stringMatching(/Tool request not found/i) });
    } finally {
      delete process.env.FAKE_CLAUDE_RECORD;
      delete process.env.FAKE_CLAUDE_PROBE;
      await c.close();
      await s.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});



// Wait helper kept for later items' tests.
void until;
