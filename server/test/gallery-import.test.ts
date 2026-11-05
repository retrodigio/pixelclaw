// Importing a sheet into the gallery: sliced into assets, with manifest entries and every check run.

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



describe('import into the gallery', () => {
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
