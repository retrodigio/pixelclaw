// `run dry=true` applies to a copy, checks it and keeps nothing; `seeds` tries a generator line
// with several seeds and ranks them by the checks.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { BAND_LAYER, GROUND_LAYER, layoutOf, createRgba, encodePng, replay, serializeDoc } from '@pixelclaw/core';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { serve, type Served } from '../src/serve.ts';
import { ProjectError, Writer, createProject, loadProject, paletteSource as _ps, readCostLog, scrub, type FetchLike } from '../src/index.ts';
import { BIN, PALETTE, type Content } from './spawn.ts';

const texts = (c: Content) => c.filter((x) => x.type === 'text').map((x) => x.text).join('\n');

let root: string;
let dir: string;
let s: Served;
let mcp: Client;
const call = async (name: string, args: Record<string, unknown> = {}) => (await mcp.callTool({ name, arguments: args })) as { content: Content; isError?: boolean };

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'pixelclaw-g13-'));
  dir = join(root, 'ruins.pclaw');
  execFileSync(process.execPath, [BIN, 'new', dir, '--palette', PALETTE]);
  s = await serve({ project: dir, port: 0, mcp: false, log: () => undefined });
  mcp = new Client({ name: 'g13-test', version: '1.0.0' });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${s.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${s.token}` } } }));
  const r = await call('run', { asset: 'turf', commands: 'new tile turf 24x24 bg=moss2' });
  expect(r.isError).toBeFalsy();
});

afterAll(async () => {
  await mcp.close();
  await s.close();
  rmSync(root, { recursive: true, force: true });
});

describe('run dry=true', () => {
  it('applies to a copy, checks it, and keeps nothing', async () => {
    const tape = () => readFileSync(join(dir, 'assets', 'turf', 'tape.jsonl'), 'utf8');
    const before = tape();
    const r = await call('run', { asset: 'turf', commands: 'line 0,5 23,5 c=ink', dry: true, view: 'tile3x3' });
    expect(r.isError).toBeFalsy();
    const t = texts(r.content);
    expect(t).toContain('turf: dry run of 1 command; 24 px would change; nothing was kept');
    expect(t).toMatch(/checks: .*repetition [\d.]+ ✗/);
    expect(r.content.some((x) => x.type === 'image')).toBe(true);
    expect(tape()).toBe(before);
    const h = texts((await call('history', { asset: 'turf' })).content);
    expect(h).not.toContain('line 0,5');
    // An error applies nothing, as a real run.
    const bad = await call('run', { asset: 'turf', commands: 'line 0,5 c=ink', dry: true });
    expect(bad.isError).toBe(true);
  });
});

describe('seeds', () => {
  it('ranks seeds of a generator line by the checks, and applies the best when asked', async () => {
    const line = 'noise ramp=moss density=0.2 cluster=1..2';
    const r = await call('seeds', { asset: 'turf', line, count: 6 });
    expect(r.isError).toBeFalsy();
    const t = texts(r.content);
    expect(t).toContain('turf: 6 seeds ranked by the checks');
    expect(t).toMatch(/best: noise .*seed=\d+/);
    expect(t).toContain('nothing was kept');
    // The ranking agrees with dry runs one by one.
    const w = new Writer(loadProject(dir));
    const ranked = w.seeds({ asset: 'turf', line, by: 'claude', count: 6 });
    if (!ranked.ok) throw new Error('seeds failed');
    const fails = ranked.trials.map((x) => x.failing.length);
    expect(fails).toEqual([...fails].sort((a, b) => a - b));
    for (const tr of ranked.trials) {
      const d = w.dry({ asset: 'turf', commands: `${line} seed=${tr.seed}`, by: 'claude' });
      if (!d.ok) throw new Error('dry failed');
      expect(d.results.filter((x) => x.status === 'fail').map((x) => x.id)).toEqual(tr.failing);
    }
    const best = ranked.trials[0]!;
    expect(t).toContain(`best: ${best.line}`);
    // A command without a seed is refused.
    const no = await call('seeds', { asset: 'turf', line: 'rect 0,0 4x4 c=ink' });
    expect(no.isError).toBe(true);
    expect(texts(no.content)).toContain('takes no seed');
    const ap = await call('seeds', { asset: 'turf', line, count: 6, apply: true });
    expect(texts(ap.content)).toContain(`applied seed ${best.seed} as group`);
    expect(texts((await call('history', { asset: 'turf', last: 1 })).content)).toContain(`seed=${best.seed}`);
  });
});
