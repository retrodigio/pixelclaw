// G13 through the server: `run dry=true` applies to a copy, checks it and keeps
// nothing; `seeds` tries a generator line with several seeds and ranks them by the checks.

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

describe('snap on the placement grid; a high seam after family cut', () => {
  it('snap keeps one block per placed pixel even when the image has a stronger nearby period', () => {
    const p = createProject(join(root, 's4.pclaw'), { palettes: [JSON.parse(readFileSync(PALETTE, 'utf8'))] });
    const w = new Writer(p, { now: () => '2026-10-29T09:00:00Z' });
    expect(w.run({ commands: 'new sheet yard 24x16', by: 'claude' }).ok).toBe(true);
    // 240x160 for a 24x16 placement (10 px a pixel), but painted in stripes 11 px wide: a free
    // fit takes the stripes' period and makes a draft of the wrong size.
    const img = createRgba(240, 160);
    for (let y = 0; y < 160; y++) for (let x = 0; x < 240; x++) {
      const c = Math.floor(x / 11) % 2 ? [0x48, 0x6a, 0x32] : [0x6c, 0x75, 0x70];
      img.data.set([...c, 255], (y * 240 + x) * 4);
    }
    writeFileSync(join(p.dir, 'stripes.png'), encodePng(img));
    const imp = w.run({ asset: 'yard', commands: 'underlay import stripes.png', by: 'claude' });
    expect(imp.ok).toBe(false); // underlay import is resolved by runAsync
    return w.runAsync({ asset: 'yard', commands: 'underlay import stripes.png', by: 'claude' }).then((u) => {
      expect(u.ok).toBe(true);
      const free = w.dry({ asset: 'yard', commands: 'snap fit=free', by: 'claude' });
      expect(free.ok && free.added[0]!.cmd).not.toMatch(/ grid=24x16 /);
      const r = w.run({ asset: 'yard', commands: 'snap', by: 'claude' });
      expect(r.ok && r.added[0]!.cmd).toMatch(/^snap from=underlay into=draft at=0,0 grid=24x16 pitch=10\.000x10\.000 /);
    });
  });

  it('warns when the cut family does not join', () => {
    const p = createProject(join(root, 'c4.pclaw'), { palettes: [JSON.parse(readFileSync(PALETTE, 'utf8'))] });
    const w = new Writer(p, { now: () => '2026-10-29T09:00:00Z' });
    const T = 12;
    const base = `new family f ${T}x${T} scheme=blob47 map=14x12
rect @cell(inside) 0,0 ${T}x${T} c=moss2 fill
rect @cell(outside) 0,0 ${T}x${T} c=soil1 fill
family band 1:outside 1:ink 1:moss1 draw=off
family coverage seed=7 copies=1 fill=on`;
    expect(w.run({ commands: base, by: 'claude' }).ok).toBe(true);
    const clean = w.dry({ asset: 'f', commands: 'family cut textures=on', by: 'claude' });
    expect(clean.ok && clean.warnings.join(' ')).not.toContain('family cut:');
    // A map painted with a dark line along every cell's top: the cut tiles carry it, a seam.
    const top = w.doc('f').height - 12 * T; // the coverage map is under the sheet
    const lines = Array.from({ length: 12 }, (_, j) => `line 0,${top + j * T} ${14 * T - 1},${top + j * T} c=ink`).join('\n');
    const r = w.run({ asset: 'f', commands: `layer ground\n${lines}\nfamily cut textures=on`, by: 'claude' });
    expect(r.ok && r.warnings.join(' ')).toMatch(/family cut: the cut family's seam is [\d.]+ \(limit ≤ 1\)/);
  });
});

describe('variants inherit the band and override only the texture', () => {
  it('a band=inherit variant follows every later fix to its base; its textures stay its own', () => {
    const p = createProject(join(root, 'v8.pclaw'), { palettes: [JSON.parse(readFileSync(PALETTE, 'utf8'))] });
    const w = new Writer(p, { now: () => '2026-10-29T09:00:00Z' });
    const T = 12;
    const ok = (r: ReturnType<Writer['run']>) => { if (!r.ok) throw new Error(r.errors.map((e) => e.message).join('; ')); return r; };
    ok(w.run({ commands: `new family shore ${T}x${T} scheme=blob47
rect @cell(inside) 0,0 ${T}x${T} c=soil2 fill
rect @cell(outside) 0,0 ${T}x${T} c=pool fill
family band 1:outside 1:stone5 1:soil1`, by: 'claude' }));
    ok(w.run({ commands: `fork shore shore_b\nvariant of=shore band=inherit\nlayer ground\nrect @cell(inside) 0,0 ${T}x${T} c=soil1 fill`, by: 'claude' }));
    const band = (n: string) => { const d = w.doc(n); return Array.from(d.cels[d.layers.findIndex((l) => l.name === BAND_LAYER)]![0]!); };
    // The textures: the inside cell of the ground layer (the rest of it is laid out by the band).
    const ground = (n: string) => {
      const d = w.doc(n), [cx, cy] = layoutOf(d.family!).inside, cel = d.cels[d.layers.findIndex((l) => l.name === GROUND_LAYER)]![0]!;
      return Array.from({ length: T * T }, (_, i) => cel[(cy * T + Math.floor(i / T)) * d.width + cx * T + (i % T)]);
    };
    const before = ground('shore_b');
    // A fix to the base's band (wider, and a pixel by hand on a piece) reaches the variant.
    const fix = ok(w.run({ asset: 'shore', commands: `family band 1:outside 1:ink 2:soil1 radius=1\nlayer band\npx @cell(o) 5,1 c=stone5`, by: 'claude' }));
    expect(fix.followed).toEqual(['shore_b']);
    expect(band('shore_b')).toEqual(band('shore'));
    expect(w.doc('shore_b').family!.geometry).toEqual(w.doc('shore').family!.geometry);
    expect(ground('shore_b')).toEqual(before);
    expect(ground('shore_b')).not.toEqual(ground('shore'));
    const last = w.history({ asset: 'shore_b', last: 1 }).entries[0]!;
    expect(last.cmd).toMatch(/^family band from=shore 1:outside 1:ink 2:soil1 radius=1 inset=0 detached=none frames=1 cells=\S+ <<\n/);
    // The variant's tape replays alone (the band is in the line).
    const r = replay(w.state('shore_b').entries, _ps(p));
    expect(r.problems).toEqual([]);
    expect(serializeDoc(r.doc!)).toEqual(serializeDoc(w.doc('shore_b')));
    // A change that leaves the band alone writes nothing to the variant.
    expect(ok(w.run({ asset: 'shore', commands: `layer ground\nrect @cell(inside) 0,0 ${T}x${T} c=soil0 fill`, by: 'claude' })).followed).toBeUndefined();
    // The variant's own band edits are refused; band=own makes it its own again.
    const own = w.run({ asset: 'shore_b', commands: 'family band 1:outside 1:ink', by: 'claude' });
    expect(own.ok).toBe(false);
    expect(!own.ok && own.errors[0]!.message).toMatch(/inherits its band from 'shore'/);
    expect(w.run({ asset: 'shore_b', commands: 'layer band\npx @cell(o) 1,1 c=ink', by: 'claude' }).ok).toBe(false);
    ok(w.run({ asset: 'shore_b', commands: 'variant of=shore band=own\nfamily band 1:outside 1:ink', by: 'claude' }));
    expect(ok(w.run({ asset: 'shore', commands: 'family band 1:outside 1:stone5 1:soil1', by: 'claude' })).followed).toBeUndefined();
  });
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
