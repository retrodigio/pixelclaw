// G11 in the server (plan §6, §19): underlays from a provider (a fake HTTP client stands in for
// OpenAI) and from files, the cost cap and log, the key never written anywhere, snap through the
// writer with its reroll warning, the underlay in the render view, fonts exported, and the MCP path.
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pcg32, createRgba, decodePng, encodePng, type Palette } from '@pixelclaw/core';
import { ProjectError, Writer, createProject, exportAsset, fakeDraft, readCostLog, type FetchLike, type Project } from '../src/index.ts';
import { spawnServer, texts, type Served } from './spawn.ts';

const PAL: Palette = {
  name: 'moss',
  entries: [
    { key: '0', name: 'ink', hex: '#1b1d22' },
    { key: '1', name: 'moss0', hex: '#2f5a33' },
    { key: '2', name: 'moss1', hex: '#4f8a43' },
    { key: '3', name: 'stone0', hex: '#6b6e73' },
    { key: '4', name: 'stone1', hex: '#a3a6a0' },
    { key: '5', name: 'pool', hex: '#3d6f9e' },
  ],
  ramps: { moss: ['moss0', 'moss1'], stone: ['stone0', 'stone1'] },
};

const KEY = 'sk-test-PLANTED-0123456789abcdefFAKEKEY';
const dirs: string[] = [];
function project(): Project {
  const dir = mkdtempSync(join(tmpdir(), 'pixelclaw-g11-'));
  dirs.push(dir);
  return createProject(join(dir, 'p.pclaw'), { palettes: [PAL] });
}
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

/** Every file under a folder, as bytes. */
function files(dir: string): [string, Buffer][] {
  const out: [string, Buffer][] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else out.push([p, readFileSync(p)]);
  }
  return out;
}
const leaks = (dir: string, extra: string[] = []) => [
  ...files(dir).filter(([, b]) => b.includes(KEY) || b.includes(Buffer.from(KEY).toString('base64'))).map(([p]) => p),
  ...extra.filter((t) => t.includes(KEY)),
];

/** A flat layout: moss on the left, stone on the right, a pool in the middle. */
function layoutPng(): Uint8Array {
  const img = createRgba(24, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) {
    const c = x >= 9 && x < 15 && y >= 5 && y < 11 ? [0x3d, 0x6f, 0x9e] : x < 12 ? [0x2f, 0x5a, 0x33] : [0x6b, 0x6e, 0x73];
    img.data.set([...c, 255], (y * 24 + x) * 4);
  }
  return encodePng(img);
}

/** A fake OpenAI: answers with a draft of the layout; records what it was sent. */
function fakeOpenAi(o: { status?: number; body?: string; throws?: string } = {}) {
  const sent: { url: string; headers: Record<string, string>; body: string }[] = [];
  const f: FetchLike = async (url, init) => {
    let body = '';
    if (typeof init.body === 'string') body = init.body;
    else for (const [k, v] of init.body.entries()) body += `${k}=${typeof v === 'string' ? v : `<file ${v.size} bytes>`}\n`;
    sent.push({ url, headers: init.headers, body });
    if (o.throws) throw new Error(o.throws);
    if (o.status) return { ok: false, status: o.status, json: async () => JSON.parse(o.body ?? '{}'), text: async () => o.body ?? '' };
    const png = encodePng(fakeDraft({ prompt: 'x', size: [1536, 1024], layout: null, model: 'm', quality: 'q', grid: [24, 16], palette: PAL, layoutImage: decodePng(layoutPng()) }));
    const payload = { data: [{ b64_json: Buffer.from(png).toString('base64') }], usage: { input_tokens: 400, input_tokens_details: { text_tokens: 40, image_tokens: 360 }, output_tokens: 1056 } };
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
  };
  return { f, sent };
}

function scene(p: Project): Writer {
  const w = new Writer(p, { now: () => '2026-10-28T09:00:00Z' });
  writeFileSync(join(p.dir, 'layout.png'), layoutPng());
  const r = w.run({ commands: 'new sheet ruin 24x16 cell=8x8', by: 'claude' });
  expect(r.ok).toBe(true);
  return w;
}

describe('underlay generate through the OpenAI provider (a fake client)', () => {
  it('makes a blob, writes the line, logs the cost; the key is only in the request header', async () => {
    const p = project();
    const w = scene(p);
    const { f, sent } = fakeOpenAi();
    const r = await w.runAsync({ asset: 'ruin', commands: 'underlay generate "mossy ruins around a pool, a pixel art draft" layout=layout.png', by: 'claude' }, { env: { OPENAI_API_KEY: KEY }, fetch: f });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const line = r.added[0]!.cmd;
    expect(line).toMatch(/^underlay mockup blob=[0-9a-f]{64} image=1536x1024 at=0,0 size=24x16 layout=[0-9a-f]{64} prompt="mossy ruins around a pool, a pixel art draft" provider=openai model=gpt-image-1\.5 quality=medium cost=0\.0369$/);
    // An edit of the layout, sent to the edits endpoint with the key in the header only.
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('https://api.openai.com/v1/images/edits');
    expect(sent[0]!.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(sent[0]!.body).not.toContain(KEY);
    expect(sent[0]!.body).toMatch(/model=gpt-image-1\.5\nprompt=mossy ruins/);
    const log = readCostLog(p);
    expect(log).toHaveLength(1);
    // G13: the estimate adds the layout's input image tokens (1105 at $8 a million) and the prompt's;
    // the line's cost is the usage as billed (40 text, 360 image in, 1056 out at $5, $8, $32).
    expect(log[0]).toMatchObject({ ok: true, provider: 'openai', model: 'gpt-image-1.5', quality: 'medium', size: '1536x1024', cap: 0.25, actual: (40 * 5 + 360 * 8 + 1056 * 32) / 1e6 });
    expect(log[0]!.estimate).toBeCloseTo(0.05 + (1105 * 8 + 11 * 5) / 1e6, 9);
    expect(log[0]!.usage).toBeTruthy();
    expect(leaks(p.dir, [JSON.stringify(r), line])).toEqual([]);
    // Usage priced by tokens when the table has token prices (gpt-image-1: $5 text, $10 image in, $40 out per million).
    const r2 = await w.runAsync({ asset: 'ruin', commands: 'underlay generate "again" model=gpt-image-1 quality=low layer=second', by: 'claude' }, { env: { OPENAI_API_KEY: KEY }, fetch: f });
    expect(r2.ok && r2.added[0]!.cmd).toMatch(/model=gpt-image-1 quality=low cost=0\.046$/);
    expect(sent[1]!.url).toBe('https://api.openai.com/v1/images/generations');
    expect(JSON.parse(sent[1]!.body)).toEqual({ model: 'gpt-image-1', prompt: 'again', size: '1536x1024', quality: 'low', n: 1 });
    expect(readCostLog(p)[1]).toMatchObject({ ok: true, actual: (40 * 5 + 360 * 10 + 1056 * 40) / 1e6 });
    expect(leaks(p.dir)).toEqual([]);
  });

  it('errors that echo the key are scrubbed, in the message and the log', async () => {
    const p = project();
    const w = scene(p);
    for (const o of [{ status: 401, body: JSON.stringify({ error: { message: `Incorrect API key provided: ${KEY}.` } }) }, { throws: `connect failed for Bearer ${KEY}` }]) {
      const { f } = fakeOpenAi(o);
      const err = await w.runAsync({ asset: 'ruin', commands: 'underlay generate "a draft"', by: 'claude' }, { env: { OPENAI_API_KEY: KEY }, fetch: f }).catch((e: Error) => e);
      expect(err).toBeInstanceOf(ProjectError);
      expect((err as Error).message).toContain('[key]');
      expect((err as Error).message).not.toContain(KEY);
    }
    expect(readCostLog(p).map((l) => l.ok)).toEqual([false, false]);
    expect(leaks(p.dir)).toEqual([]);
    // Without a key: refused before any request.
    const { f, sent } = fakeOpenAi();
    await expect(w.runAsync({ asset: 'ruin', commands: 'underlay generate "a draft"', by: 'claude' }, { env: {}, fetch: f })).rejects.toThrow(/OPENAI_API_KEY is not set/);
    expect(sent).toHaveLength(0);
  });

  it('the cost cap: over it, or with no price, nothing is requested', async () => {
    const p = project();
    const w = scene(p);
    const { f, sent } = fakeOpenAi();
    const env = { env: { OPENAI_API_KEY: KEY }, fetch: f };
    await expect(w.runAsync({ asset: 'ruin', commands: 'underlay generate "big" quality=high cap=0.1', by: 'claude' }, env)).rejects.toThrow(/about \$0\.200, over the cap of \$0\.10/);
    await expect(w.runAsync({ asset: 'ruin', commands: 'underlay generate "x" model=gpt-image-9', by: 'claude' }, env)).rejects.toThrow(/no price for gpt-image-9/);
    expect(sent).toHaveLength(0);
    expect(readCostLog(p).map((l) => l.error)).toEqual(['over the cap', 'no price for this model, quality and size']);
    // project.json can raise the cap and add prices.
    p.json = { ...p.json, underlay: { cap: 1, prices: { 'gpt-image-9': { image: { medium: { '1536x1024': 0.5 } } } } } } as typeof p.json;
    const r = await w.runAsync({ asset: 'ruin', commands: 'underlay generate "x" model=gpt-image-9', by: 'claude' }, env);
    expect(r.ok).toBe(true);
    expect(sent).toHaveLength(1);
  });
});

describe('the fake provider, import, snap and the view', () => {
  it('a fake draft of the layout snaps back into the layout\'s materials', async () => {
    const p = project();
    const w = scene(p);
    const r = await w.runAsync({ asset: 'ruin', commands: 'underlay generate "ruins" layout=layout.png provider=fake\nsnap', by: 'claude' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.added[0]!.cmd).toMatch(/provider=fake model=draft quality=medium cost=0$/);
    const snap = r.added[1]!.cmd.split('\n')[0]!;
    expect(snap).toMatch(/^snap from=mockup into=draft at=0,0 grid=24x16 pitch=64\.\d+x64\.\d+ offset=[\d.]+,[\d.]+ r2=0\.\d\d material=(0\.\d\d|1\.00) <<$/);
    expect(Number(/material=([\d.]+)/.exec(snap)![1])).toBeGreaterThanOrEqual(0.85);
    expect(r.warnings).toEqual([]);
    // The draft's middle is the pool, its corners moss and stone.
    const d = w.doc('ruin');
    const draft = d.cels[d.layers.findIndex((l) => l.name === 'draft')]![0]!;
    const name = (x: number, y: number) => d.palette.entries[draft[y * 24 + x]!]!.name;
    expect(name(12, 8)).toBe('pool');
    expect(name(1, 1)).toMatch(/^moss/);
    expect(name(22, 14)).toMatch(/^stone/);
    // The render view shows the underlay under transparent pixels.
    const withU = w.view('ruin', 'render', { scale: 8 });
    w.run({ asset: 'ruin', commands: 'layer set mockup hidden=on\nlayer set draft hidden=on', by: 'claude' });
    const without = w.view('ruin', 'render', { scale: 8 });
    expect(withU.kind === 'image' && without.kind === 'image' && Buffer.compare(Buffer.from(withU.png), Buffer.from(without.png))).not.toBe(0);
    // Replay from the tape alone (no blobs needed for the art).
    rmSync(join(p.dir, 'blobs'), { recursive: true });
    const fresh = new Writer(p);
    expect(fresh.doc('ruin').layers.map((l) => l.name)).toEqual(['mockup', 'main', 'draft']);
  });

  it('underlay import, and a noisy image gets the reroll warning', async () => {
    const p = project();
    const w = scene(p);
    const g = new Pcg32(9);
    const img = createRgba(240, 160);
    for (let i = 0; i < 240 * 160; i++) img.data.set([g.nextInt(256), g.nextInt(256), g.nextInt(256), 255], i * 4);
    writeFileSync(join(p.dir, 'photo.png'), encodePng(img));
    const r = await w.runAsync({ asset: 'ruin', commands: 'underlay import photo.png\nsnap', by: 'claude' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.added[0]!.cmd).toMatch(/^underlay underlay blob=[0-9a-f]{64} image=240x160 at=0,0 size=24x16 from="photo\.png"$/);
    expect(r.warnings.join()).toMatch(/snap: block R² 0\.\d\d < 0\.8; the draft is unreliable: reroll/);
    await expect(w.runAsync({ asset: 'ruin', commands: 'underlay import nope.png', by: 'claude' })).rejects.toThrow(/no file nope\.png/);
  });

  it('fonts export as a strip and BMFont', () => {
    const p = project();
    const w = new Writer(p);
    const r = w.run({ commands: 'new font mini 3x5 chars="AB"\nglyph A <<\n.0.\n0.0\n000\n0.0\n0.0\n>>\nglyph B <<\n00.\n0.0\n00.\n0.0\n00.\n>>', by: 'claude' });
    expect(r.ok).toBe(true);
    const out = join(p.dir, 'out');
    expect(exportAsset(w.doc('mini'), w.assetDocs(), 'strip', out).map((f) => f.slice(out.length + 1))).toEqual(['mini.png', 'mini.txt']);
    expect(decodePng(readFileSync(join(out, 'mini.png')))).toMatchObject({ width: 1 + 4 + 4, height: 5 });
    expect(exportAsset(w.doc('mini'), w.assetDocs(), 'bmfont', out).map((f) => f.slice(out.length + 1))).toEqual(['mini.fnt', 'mini_0.png']);
    expect(readFileSync(join(out, 'mini.fnt'), 'utf8')).toMatch(/char id=65 x=0 y=0 width=3 height=5 xoffset=0 yoffset=0 xadvance=4/);
  });
});

describe('through MCP', () => {
  let s: Served;
  beforeAll(async () => {
    s = await spawnServer('pixelclaw-g11-');
    await s.call('project', { path: s.proj });
  }, 20000);
  afterAll(async () => { await s?.close(); });

  it('run with underlay generate (fake) and snap', async () => {
    const r = await s.call('run', { asset: 'ruin', commands: 'new sheet ruin 24x16 cell=8x8\nunderlay generate "a ruin" provider=fake\nsnap' });
    const t = texts(r!.content);
    expect(r!.isError, t).toBeFalsy();
    expect(t).toMatch(/underlay mockup blob=[0-9a-f]{64} image=1536x1024/);
    expect(t).toMatch(/snap from=mockup into=draft/);
  });
});
