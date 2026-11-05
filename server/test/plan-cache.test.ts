// The plan from cached check results equals the plan worked out from scratch.

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




describe('plan from cached check results', () => {
  it('equals the plan worked out from scratch, and is faster', () => {
    const root = mkdtempSync(join(tmpdir(), 'pixelclaw-g12-cache-'));
    try {
      const dir = join(root, 'kiln.pclaw');
      cpSync(join(REPO, 'examples', 'kiln-hollow.pclaw'), dir, { recursive: true });
      rmSync(join(dir, '.cache', 'checks'), { recursive: true, force: true });
      const now = () => '2026-10-29T00:00:00Z';
      const t0 = performance.now();
      const fresh = planReport(new Writer(loadProject(dir), { now, checkCache: false }));
      const t1 = performance.now();
      planReport(new Writer(loadProject(dir), { now })); // fills the cache
      expect(existsSync(join(dir, '.cache', 'checks', 'urn.json'))).toBe(true);
      const t2 = performance.now();
      const cached = planReport(new Writer(loadProject(dir), { now }));
      const t3 = performance.now();
      expect(cached).toEqual(fresh);
      expect(t3 - t2).toBeLessThan(t1 - t0);
      // A change to one asset's tape is a new key: its checks run again.
      const before = readFileSync(join(dir, '.cache', 'checks', 'urn.json'), 'utf8');
      const w = new Writer(loadProject(dir), { now });
      expect(w.run({ asset: 'urn', commands: 'px 0,0 c=ink', by: 'test' }).ok).toBe(true);
      expect(planReport(w).assets.find((a) => a.name === 'urn')).toEqual(planReport(new Writer(loadProject(dir), { now, checkCache: false })).assets.find((a) => a.name === 'urn'));
      expect(readFileSync(join(dir, '.cache', 'checks', 'urn.json'), 'utf8')).not.toBe(before);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 60000);
});
