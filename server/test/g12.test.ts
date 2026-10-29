// G12 (plan §21) through the server: requests from a page (Draw this, Ask for changes, Add an
// asset) as records in requests.jsonl; the MCP `work` tool over the HTTP endpoint claims,
// progresses, finishes and blocks them, and `plan` lists them first; the worker with a fake
// `claude` (enabled, disabled, the cap, one at a time); a sheet imported into assets with
// manifest entries and every check run; scenes and their gaps; `map gen` standing the manifest's
// objects; the plan from cached check results equals the plan without them.

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

describe('requests and the work tool (§21 items 1, 2)', () => {
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
    // The change is also the G10 mark on the tape, by the person.
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

describe('the worker with a fake claude (§21 item 2)', () => {
  const fake = (args: string[] = []) => ({ enabled: true, command: [process.execPath, FAKE], args, cap: 1 });
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

describe('import into the gallery (§21 item 4)', () => {
  it('a sheet sliced into assets, with manifest entries and every check run', async () => {
    const b = await start();
    try {
      expect((await b.call('plan', { manifest: { ...MANIFEST, scenes: undefined } })).isError).toBeFalsy();
      // A 3x2 sheet of 24x24 cells: four drawn in palette colours, the fifth empty, the sixth one off-palette pixel.
      const img = createRgba(72, 48);
      const put = (x: number, y: number, c: [number, number, number]) => img.data.set([...c, 255], (y * 72 + x) * 4);
      const pal = JSON.parse(readFileSync(PALETTE, 'utf8')) as { entries?: { hex: string }[]; colors?: string[] };
      const hexes = (pal.entries?.map((e) => e.hex) ?? pal.colors!.map((c) => `#${c}`)).map((h) => [1, 3, 5].map((i) => parseInt(h.replace('#', '').slice(i - 1, i + 1), 16)) as [number, number, number]);
      const cells = [[0, 0], [24, 0], [48, 0], [0, 24], [48, 24]];
      cells.forEach(([cx, cy], k) => { for (let y = 2; y < 22; y++) for (let x = 2; x < 22; x++) put(cx! + x, cy! + y, hexes[(k + x + y) % 4 + 2]!); });
      put(50, 30, [255, 0, 255]);
      const sheet = join(b.root, 'stones.png');
      writeFileSync(sheet, encodePng(img));
      const r = await b.call('import', { path: sheet, slice: '24x24', kind: 'tile', set: 'ground' });
      expect(r.isError).toBeFalsy();
      const t = texts(r.content);
      for (const n of ['stones_1', 'stones_2', 'stones_3', 'stones_4', 'stones_5']) expect(t).toMatch(new RegExp(`created ${n} \\(tile 24x24\\)`));
      expect(t).toMatch(/created stones_5 \(tile 24x24\), 1 pixels quantised to the nearest palette colour: /);
      expect(t).toMatch(/: (failing [a-z, ]+|all \d+ checks pass)/);
      expect(t).toContain('manifest: added stones_1, stones_2, stones_3, stones_4, stones_5 to set ground');
      const m = JSON.parse(readFileSync(join(b.dir, 'manifest.json'), 'utf8')) as { assets: { name: string; description?: string }[] };
      expect(m.assets.find((a) => a.name === 'stones_4')).toEqual({ name: 'stones_4', kind: 'tile', size: '24x24', set: 'ground', description: 'imported from stones.png cell 0,1' });
      const tape = readFileSync(join(b.dir, 'assets', 'stones_2', 'tape.jsonl'), 'utf8').trim().split('\n').slice(1).map((l) => JSON.parse(l).cmd as string);
      expect(tape[0]).toMatch(/^new tile stones_2 24x24 .*palette=mossy-ruins/);
      expect(tape[0]).not.toMatch(/wrap=on/);
      expect(tape.at(-1)).toMatch(/^import 0,0 from="stones.png cell 1,0" blob=[0-9a-f]{64} <</);
      // Each is on the plan with its checks; drafted or checked by what they found.
      const plan = planReport(b.s.writer);
      for (const n of ['stones_1', 'stones_5']) {
        const a = plan.assets.find((x) => x.name === n)!;
        expect(a.planned).toBe(true);
        expect(a.checks.length).toBeGreaterThan(5);
        expect(['drafted', 'checked']).toContain(a.status);
      }
      // Names from the manifest's planned entries; a clash is refused before anything is made.
      const two = createRgba(48, 24);
      two.data.fill(255);
      writeFileSync(join(b.root, 'two.png'), encodePng(two));
      const named = texts((await b.call('import', { path: join(b.root, 'two.png'), slice: '24x24', namesFrom: 'manifest', set: 'props', palette: 'mossy-ruins' })).content);
      expect(named).toMatch(/^created urn \(sprite 24x24\).*\ncreated post \(sprite 24x24\)/);
      expect(named).not.toContain('manifest: added');
      expect(planReport(b.s.writer).assets.find((a) => a.name === 'urn')!.flags).toContain('planned 16x16, drawn 24x24');
      expect((await b.call('import', { path: join(b.root, 'two.png'), slice: '24x24', names: ['stones_1', 'fresh'] })).isError).toBe(true);
      expect(existsSync(join(b.dir, 'assets', 'fresh'))).toBe(false);
    } finally { await b.close(); }
  }, 30000);
});

describe('plan from cached check results (§21 item 6)', () => {
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
