// The worker with a fake `claude`: never without being enabled, works the queue, stops at the cap,
// one per project, and ends when a request is blocked.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { encodePng, createRgba, foldRequests, type RequestRecord } from '@pixelclaw/core';
import { serve, type Served } from '../src/serve.ts';
import { Writer, loadProject, planReport, workerLockHolder, readRequestRecords, WORKER_LOCK } from '../src/index.ts';
import { BIN, PALETTE, REPO, openPage, until, wsUrl, type Content, type Page } from './spawn.ts';

const FAKE = join(import.meta.dirname, 'fake-claude.ts');
const texts = (c: Content) => c.filter((x) => x.type === 'text').map((x) => x.text).join('\n');

const MANIFEST = {
  format: 'pixelclaw-manifest', version: 1, theme: 'Old stone under moss, lit from the top left.',
  sets: { ground: { description: 'floors' }, props: { description: 'things that stand' }, scenes: { description: 'places' } },
  assets: [
    { name: 'turf', kind: 'tile', size: '24x24', set: 'ground', description: 'short moss' },
    { name: 'urn', kind: 'sprite', size: '16x16', set: 'props', height: 12, description: 'a squat stone urn' },
    { name: 'post', kind: 'sprite', size: '16x16', set: 'props', height: 14, description: 'a waymark post' },
    { name: 'well', kind: 'object', size: '24x24', set: 'props', cells: '1x1', description: 'a stone well' },
    { name: 'court', kind: 'map', size: '16x12', set: 'scenes', uses: ['well', 'post'] },
  ],
  scenes: [{ name: 'courtyard', description: 'the well court', uses: ['turf', 'urn'], map: 'court' }],
};

interface Box { root: string; dir: string; s: Served; mcp: Client; call(name: string, args?: Record<string, unknown>): Promise<{ content: Content; isError?: boolean }>; close(): Promise<void> }

async function start(o: { worker?: Record<string, unknown> } = {}): Promise<Box> {
  const root = mkdtempSync(join(tmpdir(), 'pixelclaw-g12-'));
  const dir = join(root, 'ruins.pclaw');
  execFileSync(process.execPath, [BIN, 'new', dir, '--palette', PALETTE]);
  if (o.worker) {
    const pj = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'));
    writeFileSync(join(dir, 'project.json'), JSON.stringify({ ...pj, worker: o.worker }, null, 2));
  }
  const s = await serve({ project: dir, port: 0, mcp: false, log: () => undefined });
  const mcp = new Client({ name: 'g12-test', version: '1.0.0' });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${s.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${s.token}` } } }));
  return {
    root, dir, s, mcp,
    call: async (name, args = {}) => (await mcp.callTool({ name, arguments: args })) as { content: Content; isError?: boolean },
    close: async () => { await mcp.close(); await s.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

/** A page's request message, answered. */
async function ask(page: Page, by: string, body: unknown): Promise<{ ok: boolean; error?: string; request?: { id: string; state: string } }> {
  const id = 1000 + page.messages.length + Math.floor(Math.random() * 1e6);
  page.ws.send(JSON.stringify({ type: 'request', id, by, body }));
  await until(() => page.messages.some((m) => m.type === 'answer' && m.id === id));
  return page.messages.find((m) => m.type === 'answer' && m.id === id) as never;
}


describe('the worker with a fake claude', () => {
  const fake = (opts: string[] = []) => ({ enabled: true, command: [process.execPath, FAKE, ...opts], cap: 1 });
  const seed = async (b: Box, n: number) => {
    expect((await b.call('plan', { manifest: { ...MANIFEST, scenes: undefined, assets: MANIFEST.assets.filter((a) => a.kind !== 'map') } })).isError).toBeFalsy();
    const page = await openPage(wsUrl(b.s.url));
    for (const a of ['turf', 'urn', 'post', 'well'].slice(0, n)) expect((await ask(page, 'human:ana', { action: 'request', kind: 'draw', asset: a })).ok).toBe(true);
    return page;
  };

  it('never runs unless enabled (button and CLI)', async () => {
    const b = await start();
    try {
      const page = await seed(b, 1);
      expect(() => b.s.worker.start('human:ana')).toThrow(/worker is off/);
      const id = 77;
      page.ws.send(JSON.stringify({ type: 'worker', id, by: 'human:ana', action: 'start' }));
      await until(() => page.messages.some((m) => m.type === 'answer' && m.id === id));
      expect(page.messages.find((m) => m.type === 'answer' && m.id === id)).toMatchObject({ ok: false, error: expect.stringMatching(/worker is off/) });
      expect((page.messages.find((m) => m.type === 'hello') as unknown as { snapshot: { worker: { enabled: boolean } } }).snapshot.worker.enabled).toBe(false);
      // The CLI refuses too (and would refuse a project a server holds).
      let out = '';
      try { execFileSync(process.execPath, [BIN, 'work', b.dir], { stdio: 'pipe' }); } catch (e) { out = String((e as { stderr: Buffer }).stderr); }
      expect(out).toMatch(/the worker is off/);
      expect(readRequestRecords(loadProject(b.dir)).filter((r) => r.type !== 'request')).toEqual([]);
      page.ws.close();
    } finally { await b.close(); }
  }, 30000);

  it('enabled: works the queue through MCP until it is empty; the log reaches the page', async () => {
    const b = await start({ worker: fake() });
    try {
      const page = await seed(b, 2);
      const why = await b.s.worker.start('human:ana');
      expect(why).toBe('the queue is empty');
      const recs = readRequestRecords(loadProject(b.dir)) as RequestRecord[];
      expect(recs.filter((r) => r.type === 'done').map((r) => [r.id, r.by])).toEqual([['r1', 'claude'], ['r2', 'claude']]);
      expect(existsSync(join(b.dir, 'assets', 'turf', 'tape.jsonl'))).toBe(true);
      const log = readFileSync(join(b.dir, 'logs', 'worker.log'), 'utf8');
      expect(log).toMatch(/run started by human:ana: cap \$1\.00/);
      expect(log).toMatch(/→ work \{\}/);
      expect(log).toMatch(/session 1: \$0\.40; \$0\.40 of \$1\.00 spent/);
      expect(log).toMatch(/run stopped: the queue is empty/);
      await until(() => page.messages.some((m) => m.type === 'workerLog' && (m.lines as string[]).some((l) => l.includes('run stopped'))));
      expect(page.messages.filter((m) => m.type === 'worker').at(-1)).toMatchObject({ status: { enabled: true, running: false, spent: 0.4, sessions: 1, stopped: 'the queue is empty' } });
      const api = await (await fetch(b.s.url.replace('/?token', '/api/worker?token'))).json() as { log: string[] };
      expect(api.log.at(-1)).toMatch(/run stopped/);
      expect(existsSync(join(b.dir, WORKER_LOCK))).toBe(false);
      page.ws.close();
    } finally { await b.close(); }
  }, 30000);

  it('stops at the cap: each session gets what is left, and the run stops when it is spent', async () => {
    const b = await start({ worker: fake(['--fake-per-session', '1', '--fake-cost', '0.4']) });
    try {
      const page = await seed(b, 4);
      const why = await b.s.worker.start('human:ana');
      expect(why).toBe('the budget cap was reached ($1.00 of $1.00)');
      const log = readFileSync(join(b.dir, 'logs', 'worker.log'), 'utf8');
      expect(log).toMatch(/session 3: budget \$0\.20/);
      expect(log).not.toMatch(/session 4/);
      const done = readRequestRecords(loadProject(b.dir)).filter((r) => r.type === 'done');
      expect(done).toHaveLength(2); // the third session could not afford a request
      expect(b.s.writer.workerStatus()).toMatchObject({ running: false, spent: 1, sessions: 3 });
      page.ws.close();
    } finally { await b.close(); }
  }, 30000);

  it('one worker per project: a second start is refused while one runs; stop ends it', async () => {
    const b = await start({ worker: fake(['--fake-mode', 'idle', '--fake-sleep', '20000']) });
    try {
      const page = await seed(b, 1);
      const run = b.s.worker.start('human:ana');
      await until(() => existsSync(join(b.dir, WORKER_LOCK)));
      expect(workerLockHolder(b.dir)).toMatchObject({ pid: process.pid, by: 'human:ana' });
      expect(() => b.s.worker.start('human:bo')).toThrow(/already running/);
      // Another process (the CLI) refuses as well: the server holds the project.
      let out = '';
      try { execFileSync(process.execPath, [BIN, 'work', b.dir], { stdio: 'pipe' }); } catch (e) { out = String((e as { stderr: Buffer }).stderr); }
      expect(out).toMatch(/owns .*Start Claude/);
      await until(() => readFileSync(join(b.dir, 'logs', 'worker.log'), 'utf8').includes('session started'), 10000);
      b.s.worker.stop('human:ana');
      expect(await run).toBe('stopped by human:ana');
      expect(existsSync(join(b.dir, WORKER_LOCK))).toBe(false);
      page.ws.close();
    } finally { await b.close(); }
  }, 40000);

  it('a blocked request ends the run (the queue has nothing open), and the question reaches the plan', async () => {
    const b = await start({ worker: fake(['--fake-mode', 'block']) });
    try {
      const page = await seed(b, 1);
      expect(await b.s.worker.start('human:ana')).toBe('the queue is empty');
      expect(texts((await b.call('plan')).content)).toContain('r1 draw turf (from human:ana; blocked, waiting for human:ana: "Should turf face left or right?")');
      page.ws.close();
    } finally { await b.close(); }
  }, 30000);
});
