// The underlay provider: the image size follows the placed area; no part of the key is written;
// input image tokens are priced against the cap.

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



describe('underlays sized from the placed area', () => {
  it('a portrait area of a landscape sheet asks for a portrait image', async () => {
    const p = createProject(join(root, 'u.pclaw'), { palettes: [JSON.parse(readFileSync(PALETTE, 'utf8'))] });
    const w = new Writer(p, { now: () => '2026-10-29T09:00:00Z' });
    expect(w.run({ commands: 'new sheet yard 96x48 cell=24x24', by: 'claude' }).ok).toBe(true);
    const r = await w.runAsync({ asset: 'yard', commands: 'underlay generate "a well" provider=fake at=24,0 size=24x48', by: 'claude' });
    expect(r.ok && r.added[0]!.cmd).toMatch(/image=1024x1536 at=24,0 size=24x48 /);
    const whole = await w.runAsync({ asset: 'yard', commands: 'underlay generate "the yard" provider=fake layer=all', by: 'claude' });
    expect(whole.ok && whole.added[0]!.cmd).toMatch(/image=1536x1024 /);
    const sq = await w.runAsync({ asset: 'yard', commands: 'underlay generate "a tile" provider=fake size=48x48 layer=sq', by: 'claude' });
    expect(sq.ok && sq.added[0]!.cmd).toMatch(/image=1024x1024 /);
    expect(readCostLog(p).map((l) => l.size)).toEqual(['1024x1536', '1536x1024', '1024x1024']);
  }, 60_000);
});



describe('no part of the key is written; input image tokens are priced', () => {
  const KEY = 'sk-proj-PLANTEDfake0123456789abcdefWXYZ';
  /** Every window of 4 characters of the key's start or end, and its middle runs of 6. */
  const parts = [...Array.from({ length: KEY.length - 3 }, (_, i) => KEY.slice(i, i + 6)).filter((x) => x.length === 6), KEY.slice(-4), KEY.slice(0, 8)];
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const q = join(dir, f); return statSync(q).isDirectory() ? files(q) : [q]; });
  const leaks = (dir: string, texts: string[]) => [
    ...files(dir).flatMap((f) => { const b = readFileSync(f, 'latin1'); return parts.filter((x) => b.includes(x)).map((x) => `${f}: ${x}`); }),
    ...texts.flatMap((t) => parts.filter((x) => t.includes(x)).map((x) => `message: ${x}`)),
  ];
  const answer = (status: number, body: string): FetchLike => async () => ({ ok: false, status, json: async () => JSON.parse(body), text: async () => body });

  it('a 401 that echoes the key masked (first and last characters) leaves nothing of it', async () => {
    const p = createProject(join(root, 'k9.pclaw'), { palettes: [JSON.parse(readFileSync(PALETTE, 'utf8'))] });
    const w = new Writer(p, { now: () => '2026-10-29T09:00:00Z' });
    expect(w.run({ commands: 'new sheet yard 24x16', by: 'claude' }).ok).toBe(true);
    const masked = `${KEY.slice(0, 8)}${'*'.repeat(24)}${KEY.slice(-4)}`;
    const bodies = [
      JSON.stringify({ error: { message: `Incorrect API key provided: ${masked}. You can find your API key at https://platform.openai.com/account/api-keys.`, type: 'invalid_request_error', code: 'invalid_api_key' } }),
      JSON.stringify({ error: { message: `The key ending in ${KEY.slice(-6)} was revoked` } }),
      `<html>401 for key ${KEY.slice(0, 12)}…</html>`,
    ];
    const messages: string[] = [];
    for (const b of bodies) {
      const err = await w.runAsync({ asset: 'yard', commands: 'underlay generate "a yard"', by: 'claude' }, { env: { OPENAI_API_KEY: KEY }, fetch: answer(401, b) }).catch((e: Error) => e);
      expect(err).toBeInstanceOf(ProjectError);
      messages.push((err as Error).message);
    }
    expect(messages[0]).toContain('OpenAI answered 401: Incorrect API key provided: [key]');
    expect(leaks(p.dir, messages)).toEqual([]);
    expect(readCostLog(p).map((l) => l.ok)).toEqual([false, false, false]);
    expect(scrub(`x ${KEY.slice(-5)} y`, KEY)).toBe('x [key] y');
  });

  it('an edit\'s estimate includes the layout image\'s input tokens, and the cap holds them', async () => {
    const p = createProject(join(root, 'c9.pclaw'), { palettes: [JSON.parse(readFileSync(PALETTE, 'utf8'))] });
    const w = new Writer(p, { now: () => '2026-10-29T09:00:00Z' });
    expect(w.run({ commands: 'new sheet yard 24x16\nlayer add plan\nrect 0,0 12x16 c=moss2 fill', by: 'claude' }).ok).toBe(true);
    let sent = 0;
    const f: FetchLike = async () => { sent++; return { ok: false, status: 500, json: async () => ({}), text: async () => '' }; };
    // 0.05 for the image alone would pass a 0.055 cap; with the layout's 1105 input tokens at $8 a million it does not.
    await expect(w.runAsync({ asset: 'yard', commands: 'underlay generate "a yard" layout=plan cap=0.055', by: 'claude' }, { env: { OPENAI_API_KEY: KEY }, fetch: f })).rejects.toThrow(/about \$0\.059, over the cap of \$0\.06|about \$0\.059, over the cap/);
    expect(sent).toBe(0);
    const log = readCostLog(p);
    expect(log[0]!.estimate).toBeCloseTo(0.05 + (1105 * 8 + 2 * 5) / 1e6, 9);
  });
});
