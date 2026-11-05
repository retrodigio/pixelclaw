// Requests from a page as records in requests.jsonl, and the MCP `work` tool: claim, progress,
// done and blocked; `plan` lists requests first; scenes; map gen with the manifest's objects.

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

describe('requests and the work tool', () => {
  let b: Box;
  let page: Page;
  beforeAll(async () => {
    b = await start();
    expect((await b.call('plan', { manifest: MANIFEST })).isError).toBeFalsy();
    expect((await b.call('run', { asset: 'post', commands: 'new sprite post\nrect 6,2 4x12 c=soil1 fill\noutline c=ink' })).isError).toBeFalsy();
    page = await openPage(wsUrl(b.s.url));
  }, 20000);
  afterAll(async () => { page?.ws.close(); await b?.close(); });

  it('a page asks: draw a planned asset, change a drawn one, add a new one (the manifest entry validated)', async () => {
    expect(await ask(page, 'human:ana', { action: 'request', kind: 'draw', asset: 'urn', note: 'squat, with a lip' })).toMatchObject({ ok: true, request: { id: 'r1', state: 'open' } });
    expect(await ask(page, 'human:ana', { action: 'request', kind: 'change', asset: 'post', note: 'make it taller' })).toMatchObject({ ok: true, request: { id: 'r2' } });
    // The change is also a mark on the tape, by the person.
    const tape = readFileSync(join(b.dir, 'assets', 'post', 'tape.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(tape.at(-1)).toMatchObject({ by: 'human:ana', cmd: 'mark rejected "make it taller"' });
    // A bad entry writes nothing.
    const bad = await ask(page, 'human:ana', { action: 'request', kind: 'new', entry: { name: 'lamp', kind: 'sprite', size: '16' } });
    expect(bad).toMatchObject({ ok: false });
    expect(bad.error).toMatch(/assets\[5\]\.size/);
    expect(await ask(page, 'human:ana', { action: 'request', kind: 'new', entry: { name: 'lamp', kind: 'sprite', size: '16x16', set: 'props', description: 'a lantern on a pole' }, note: 'for the gate' })).toMatchObject({ ok: true, request: { id: 'r3' } });
    expect(JSON.parse(readFileSync(join(b.dir, 'manifest.json'), 'utf8')).assets.at(-1)).toMatchObject({ name: 'lamp', size: '16x16' });
    // Refused: drawing what is drawn, changing what is not, a duplicate, a non-person.
    expect((await ask(page, 'human:ana', { action: 'request', kind: 'draw', asset: 'post' })).error).toMatch(/drawn already/);
    expect((await ask(page, 'human:ana', { action: 'request', kind: 'change', asset: 'urn', note: 'x' })).error).toMatch(/not drawn yet/);
    expect((await ask(page, 'human:ana', { action: 'request', kind: 'draw', asset: 'urn' })).error).toMatch(/r1 already asks/);
    expect((await ask(page, 'claude', { action: 'request', kind: 'draw', asset: 'turf' })).error).toMatch(/human:/);
    // Every page hears the requests as they stand.
    await until(() => page.messages.some((m) => m.type === 'requests' && (m.requests as unknown[]).length === 3));
    const recs = readRequestRecords(loadProject(b.dir));
    expect(recs.map((r) => [r.type, r.id])).toEqual([['request', 'r1'], ['request', 'r2'], ['request', 'r3']]);
    expect(recs[1]).toMatchObject({ kind: 'change', mark: tape.at(-1).seq, by: 'human:ana' });
  });

  it('plan lists requests first; work claims, posts progress, finishes, blocks', async () => {
    const plan = texts((await b.call('plan')).content);
    expect(plan.split('\n')[0]).toBe('Requests from people (3): take these before planned work, with `work` (it claims the next open one):');
    expect(plan).toContain('r1 draw urn: "squat, with a lip" (from human:ana; open)');
    const w1 = texts((await b.call('work')).content);
    expect(w1).toMatch(/^claimed r1\nr1 draw urn/);
    expect(w1).toContain('plan: urn is a sprite 16x16 in set props: a squat stone urn (drawn height 12 px)');
    // One at a time: the next call says to finish r1 first.
    expect(texts((await b.call('work')).content)).toMatch(/you already have r1/);
    expect(texts((await b.call('work', { action: 'progress', text: 'blocking in the body' })).content)).toBe('r1: progress');
    expect((await b.call('run', { asset: 'urn', commands: 'new sprite urn\nrect 4,4 8x10 c=stone2 fill\noutline c=ink' })).isError).toBeFalsy();
    expect(texts((await b.call('work', { action: 'done', text: 'drew the urn: body, lip, ink outline' })).content)).toBe('r1: done. 2 open requests left: call work for the next.');
    const w2 = texts((await b.call('work')).content);
    expect(w2).toMatch(/^claimed r2\nr2 change post: "make it taller"/);
    expect(w2).toMatch(/mark rejected` on its tape at #\d+/);
    expect(texts((await b.call('work', { action: 'blocked', text: 'Taller by how much: 2 px or 4 px?' })).content)).toMatch(/^r2: blocked/);
    expect((await b.call('work', { action: 'done', id: 'r2', text: 'x' })).isError).toBe(true);
    const list = texts((await b.call('work', { action: 'list' })).content);
    expect(list).toContain('r2 change post: "make it taller"');
    expect(list).toContain('blocked: "Taller by how much: 2 px or 4 px?"');
    // The person answers in the dashboard: open again, and the agent sees the answer.
    expect(await ask(page, 'human:ana', { action: 'reply', id: 'r2', text: '4 px' })).toMatchObject({ ok: true, request: { state: 'open' } });
    const again = texts((await b.call('work', { id: 'r2' })).content);
    expect(again).toContain('The person answered: "4 px"');
    const { requests, problems } = foldRequests(readRequestRecords(loadProject(b.dir)));
    expect(problems).toEqual([]);
    expect([...requests.values()].map((q) => [q.id, q.state])).toEqual([['r1', 'done'], ['r2', 'claimed'], ['r3', 'open']]);
    expect(requests.get('r1')!.events.map((e) => e.type)).toEqual(['claim', 'progress', 'done']);
    // The plan report carries every request for the dashboard.
    const report = await (await fetch(b.s.url.replace('/?token', '/api/plan?token'))).json() as { requests: { id: string; state: string }[] };
    expect(report.requests.map((q) => q.state)).toEqual(['done', 'claimed', 'open']);
    expect(await ask(page, 'human:ana', { action: 'cancel', id: 'r3' })).toMatchObject({ ok: true, request: { state: 'cancelled' } });
  });

  it('scenes: what each still needs, and plan scene by scene', async () => {
    const r = planReport(b.s.writer);
    expect(r.scenes).toEqual([{ name: 'courtyard', description: 'the well court', map: 'court', needs: ['turf', 'urn', 'well', 'post', 'court'], missing: ['turf', 'well', 'court'], unfinished: expect.any(Array) }]);
    const t = texts((await b.call('plan', { order: 'scene' })).content);
    expect(t).toMatch(/scene courtyard \(the well court\), built by the map court: missing turf, well, court/);
    expect(t.indexOf('scene courtyard')).toBeLessThan(t.indexOf('in no scene:'));
    expect(t.slice(t.indexOf('in no scene:'))).toContain('lamp');
  });

  it('map gen stands the manifest\'s objects (written into the line)', async () => {
    expect((await b.call('run', { asset: 'well', commands: 'new object well\nrect 4,8 16x14 c=stone2 fill\noutline c=ink\nfootprint 1x1' })).isError).toBeFalsy();
    expect((await b.call('run', { asset: 'turf', commands: 'new tile turf bg=moss2' })).isError).toBeFalsy();
    const fam = 'new family meadow 24x24 scheme=blob47\nfamily texture inside from=turf\nfamily texture outside from=turf';
    expect((await b.call('run', { asset: 'meadow', commands: fam })).isError).toBeFalsy();
    const r = await b.call('run', { asset: 'court', commands: 'new map court tile=24\nlayer add ground terrain=meadow outside=on\nlayer add props objects\nmap gen island layers=ground seed=3' });
    expect(texts(r.content)).toMatch(/map gen island layers=ground objects=well,post layer=props fp=1x1:0,0\/1x1:0,0 seed=3/);
  });
});
