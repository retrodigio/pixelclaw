// G10 through MCP, HTTP and the CLI: the plan tool writes a manifest only
// when it is valid and reports each asset's status; a planned asset's `new` takes its size from the
// manifest; marks, checks and an export move it up the ladder (exported.json), a change sends it
// back; the review bundle of a manifest set carries the brief and names no author or method; the
// flat templates; the dashboard's /api/plan and previews; `pixelclaw skill install`.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BIN, openPage, spawnServer, texts, wsUrl, type Served } from './spawn.ts';

let s: Served;
const call = (name: string, args: Record<string, unknown>) => s.call(name, args);

const MANIFEST = {
  format: 'pixelclaw-manifest', version: 1,
  theme: 'Old stone half taken back by moss, under a soft light from the top left.',
  sets: { ground: { description: 'floors' }, props: { description: 'things that stand' } },
  export: { profile: 'png' },
  assets: [
    { name: 'turf', kind: 'tile', size: '24x24', set: 'ground', description: 'short moss over soil' },
    { name: 'flags', kind: 'tile', size: '24x24', set: 'ground', description: 'laid flagstones', flat: 'stone2' },
    { name: 'urn', kind: 'sprite', size: '16x16', set: 'props', description: 'a squat stone urn', height: 12 },
    { name: 'urn_moss', kind: 'sprite', size: '16x16', set: 'props', recolourOf: 'urn', height: 12, description: 'the urn, mossed over' },
    { name: 'post', kind: 'sprite', size: '16x16', set: 'props', height: 14, description: 'a waymark post' },
    { name: 'bank', kind: 'family', size: '24x24', set: 'ground', scheme: 'blob47', inside: 'turf', outside: 'flags', band: '1:ink 2:stone1 radius=2' },
  ],
};

const URN = `rect 4,4 8x10 c=stone2 fill
line 4,4 11,4 c=stone4
line 4,4 4,13 c=stone4
line 5,13 11,13 c=stone1
outline c=ink`;

beforeAll(async () => {
  s = await spawnServer('pixelclaw-g10-');
  await call('project', { path: s.proj });
}, 20000);

afterAll(async () => {
  await s?.close();
});

describe('the plan', () => {
  it('writes a manifest only when it is valid', async () => {
    const none = texts((await call('plan', {})).content);
    expect(none).toContain('has no manifest.json yet');
    const bad = await call('plan', { manifest: { ...MANIFEST, assets: [...MANIFEST.assets, { name: 'urn', kind: 'statue', size: '9' }] } });
    expect(bad.isError).toBe(true);
    expect(texts(bad.content)).toContain(`assets[6].name: 'urn' is already assets[2]`);
    expect(texts(bad.content)).toContain('assets[6].kind:');
    expect(existsSync(join(s.proj, 'manifest.json'))).toBe(false);
    const ok = texts((await call('plan', { manifest: MANIFEST })).content);
    expect(ok).toContain('wrote manifest.json: 6 assets');
    expect(ok).toContain('6 planned: 6 planned · 0 drafted');
    expect(ok).toMatch(/planned +urn \(sprite 16x16\) → draw it/);
    expect(ok).toContain('&tab=dashboard');
  });

  it('a planned asset takes its size from the manifest and climbs the ladder', async () => {
    const r = await call('run', { asset: 'urn', commands: `new sprite urn palette=mossy-ruins\n${URN}` });
    expect(r.isError, texts(r.content)).toBeFalsy();
    const tape = readFileSync(join(s.proj, 'assets', 'urn', 'tape.jsonl'), 'utf8');
    expect(tape).toContain('new sprite urn 16x16 palette=mossy-ruins');
    const status = async () => JSON.parse(execFileSync(process.execPath, [BIN, 'plan', s.proj, '--json'], { encoding: 'utf8' }).toString()) as { assets: { name: string; status: string; flags: string[]; failing: string[] }[] };
    // The CLI reads the project while the server holds it (reading is allowed).
    let urn = (await status()).assets.find((a) => a.name === 'urn')!;
    expect(urn.failing).toEqual([]);
    expect(urn.status).toBe('checked');
    await call('run', { asset: 'urn', commands: 'mark reviewed "blind review: reads as an urn"' });
    expect((await status()).assets.find((a) => a.name === 'urn')!.status).toBe('reviewed');
    const page = await openPage(wsUrl(s.url));
    const ap = await page.run('urn', 'mark approved "good"', 'human:pat');
    expect(ap.ok).toBe(true);
    expect((await status()).assets.find((a) => a.name === 'urn')!.status).toBe('approved');
    const ex = texts((await call('export', { profile: 'png', assets: ['urn'] })).content);
    expect(ex).toContain('png:');
    const rec = JSON.parse(readFileSync(join(s.proj, 'exported.json'), 'utf8'));
    expect(rec.urn).toMatchObject({ profile: 'png', dir: 'exports/png' });
    expect(page.messages.some((m) => m.type === 'plan')).toBe(true);
    page.ws.close();
    expect((await status()).assets.find((a) => a.name === 'urn')!.status).toBe('exported');
    // A change to the art sends it back to checked, and says why.
    await call('run', { asset: 'urn', commands: 'px 7,7 c=stone3' });
    urn = (await status()).assets.find((a) => a.name === 'urn')!;
    expect(urn.status).toBe('checked');
    expect(urn.flags.join(' ')).toContain('changed since it was reviewed');
    await call('run', { asset: 'urn', commands: 'undo' });
    expect((await status()).assets.find((a) => a.name === 'urn')!.status).toBe('exported');
  });

  it('consistency holds a set to the plan, and a recolour is not compared with its source', async () => {
    await call('run', { asset: 'urn_moss', commands: `fork urn urn_moss\npalette set stone2 hex=#4f7a3c\npalette set stone4 hex=#7fa860\npalette set stone1 hex=#3a5a2c` });
    await call('run', { asset: 'post', commands: 'new sprite post palette=mossy-ruins\nrect 6,2 4x12 c=soil1 fill\nline 6,2 9,2 c=soil2\nline 6,2 6,13 c=soil2\noutline c=ink' });
    const c = texts((await call('check', { asset: 'urn_moss', checks: ['consistency', 'readability'] })).content);
    expect(c).toContain('recolours of each other, not compared: urn');
    const p = texts((await call('check', { asset: 'post', checks: ['consistency'] })).content);
    expect(p).toMatch(/consistency +0/);
    // The post is drawn 14 tall as planned; plan it at 10 and the check finds it.
    const m = JSON.parse(JSON.stringify(MANIFEST));
    m.assets.find((a: { name: string }) => a.name === 'post').height = 10;
    await call('plan', { manifest: m });
    const p2 = texts((await call('check', { asset: 'post', checks: ['consistency'] })).content);
    expect(p2).toContain('height the drawn shape is 14 px tall');
    await call('plan', { manifest: MANIFEST });
  });

  it('a review of a manifest set carries the brief and names no author or method', async () => {
    const r = texts((await call('review', { set: 'props' })).content);
    const dir = /review bundle: (\S+)/.exec(r)![1]!;
    expect(dir).toMatch(/reviews\/\d{4}-\d\d-\d\d-props$/);
    const files = readdirSync(dir, { recursive: true }).map(String).sort();
    expect(files).toEqual(expect.arrayContaining(['brief.md', 'rubric.md', 'assets/urn.png', 'assets/post.png', 'scenes/urn_moss.png']));
    expect(files.some((f) => f.includes('turf') || f.includes('flags'))).toBe(false);
    const brief = readFileSync(join(dir, 'brief.md'), 'utf8');
    expect(brief).toContain('**urn** (sprite, 16x16, about 12 px tall): a squat stone urn');
    for (const f of files.filter((x) => x.includes('.'))) {
      const body = readFileSync(join(dir, f));
      if (/\.(md|txt|json)$/.test(f)) expect(body.toString('utf8'), f).not.toMatch(/claude|human:|pixelclaw|anthropic|agent|model|tape|command|\bmark (reviewed|approved|rejected)|manifest|generat|prompt/i);
      // Images carry no text chunks (no software or author names).
      if (f.endsWith('.png')) expect(body.includes(Buffer.from('tEXt')) || body.includes(Buffer.from('iTXt')), f).toBe(false);
    }
  });

  it('draws the flat templates from the manifest', async () => {
    const r = await call('plan', { templates: true, set: 'ground' });
    const t = texts(r.content);
    expect(t).toContain('mockup.png');
    expect(t).toContain('bank.coverage.png');
    expect(r.content.some((c) => c.type === 'image')).toBe(true);
    expect(readFileSync(join(s.proj, 'templates', 'bank.coverage.txt'), 'utf8')).toMatch(/^blob47: \d+x\d+ tiles of 24 px, 47 of 47 variants/);
    expect(t).toMatch(/ground \(floors\):\n {2}planned +turf/);
    expect(t).not.toContain('urn (sprite');
  });

  it('serves the plan and previews to the dashboard', async () => {
    const base = s.url.replace(/\/\?token=.*/, '');
    const token = /token=([^&]+)/.exec(s.url)![1]!;
    expect((await fetch(`${base}/api/plan`)).status).toBe(401);
    const plan = await (await fetch(`${base}/api/plan?token=${token}`)).json() as { assets: { name: string; status: string }[]; counts: Record<string, number> };
    expect(plan.assets.map((a) => a.name)).toEqual(expect.arrayContaining(['turf', 'urn', 'bank']));
    expect(plan.counts.exported).toBe(1);
    const png = await fetch(`${base}/api/preview/urn.png?token=${token}`);
    expect(png.headers.get('content-type')).toBe('image/png');
    expect((await fetch(`${base}/api/preview/turf.png?token=${token}`)).status).toBe(404);
  });
});

describe('the skill', () => {
  it('installs into a folder with its workflows', () => {
    const dest = mkdtempSync(join(tmpdir(), 'pixelclaw-skill-'));
    try {
      const out = execFileSync(process.execPath, [BIN, 'skill', 'install', '--dest', join(dest, 'pixelclaw')], { encoding: 'utf8' });
      expect(out).toContain('installed the PixelClaw skill');
      const skill = readFileSync(join(dest, 'pixelclaw', 'SKILL.md'), 'utf8');
      expect(skill).toMatch(/^---\nname: pixelclaw\ndescription: /);
      for (const w of ['blind review', 'manifest', 'mark reviewed', 'changes']) expect(skill).toContain(w);
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });
});
