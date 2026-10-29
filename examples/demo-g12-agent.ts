// A stand-in for the G12 demo (examples/demo-g12.md): a person in the browser (Playwright, as
// human:chris) and the agent (MCP over stdio, as Claude does) on Kiln Hollow, carried on from G11.
// The agent adds two scenes to the manifest. The person imports a sheet of pot shards into the
// gallery through the slice dialog, asks for two planned assets (Draw this on urn_blue and goat)
// and for a change on a drawn one (jar_icon). The agent hears them through `plan` and takes them
// with `work`: it draws urn_blue (a palette swap of the urn) and finishes that request, blocks the
// goat on a question, and starts on the jar (the card says Claude is working on it). The dashboard
// and the gallery are photographed at each step.
//
//   node examples/demo-g12-agent.ts [--project <dir>] [--port 7431] [--shots] [--keep]
//
// --shots writes docs/screenshots/g12-*.png; --keep copies the result over examples/kiln-hollow.pclaw.

import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { chromium, type Page } from '@playwright/test';
import { createRgba, decodePng, encodePng } from '../core/src/index.ts';

const REPO = join(import.meta.dirname, '..');
const SRC = join(REPO, 'examples', 'kiln-hollow');
const EXAMPLE = join(REPO, 'examples', 'kiln-hollow.pclaw');
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
const project = opt('--project', join(REPO, 'out', 'demo-g12.pclaw'));
const port = opt('--port', '7431');
const shots = args.includes('--shots');
const script = (f: string) => readFileSync(join(SRC, 'scripts', f), 'utf8');
const shot = async (page: Page, name: string, o: { clip?: { x: number; y: number; width: number; height: number }; locator?: string } = {}) => {
  if (!shots) return;
  const path = join(REPO, 'docs', 'screenshots', `g12-${name}.png`);
  if (o.locator) await page.locator(o.locator).screenshot({ path });
  else await page.screenshot({ path, clip: o.clip });
};

/** Element screenshots side by side on the page's background, as one PNG. */
async function stitch(page: Page, selectors: string[], name: string): Promise<void> {
  if (!shots) return;
  const imgs = [];
  for (const sel of selectors) {
    await page.locator(sel).evaluate((el) => el.scrollIntoView({ block: 'center' }));
    imgs.push(decodePng(await page.locator(sel).screenshot()));
  }
  const pad = 12;
  const out = createRgba(imgs.reduce((n, i) => n + i.width + pad, pad), Math.max(...imgs.map((i) => i.height)) + 2 * pad);
  for (let i = 0; i < out.data.length; i += 4) out.data.set([0x16, 0x17, 0x1b, 255], i);
  let x0 = pad;
  for (const im of imgs) {
    for (let y = 0; y < im.height; y++) out.data.set(im.data.subarray(y * im.width * 4, (y + 1) * im.width * 4), ((y + pad) * out.width + x0) * 4);
    x0 += im.width + pad;
  }
  writeFileSync(join(REPO, 'docs', 'screenshots', `g12-${name}.png`), encodePng(out));
}

// The G11 project: without G12's assets, requests, scenes and the G12 lines on jar_icon.
const G12 = /^(shards_\d+|urn_blue)$/;
if (existsSync(project)) rmSync(project, { recursive: true, force: true });
cpSync(EXAMPLE, project, {
  recursive: true,
  filter: (f) => {
    const rel = relative(EXAMPLE, f);
    const parts = rel.split(/[\\/]/);
    if (parts[0] === 'assets' && parts[1] && G12.test(parts[1])) return false;
    return !['.cache', 'logs', 'requests.jsonl', 'reads.json', '.pixelclaw.lock'].includes(parts[0]!);
  },
});
const jar = join(project, 'assets', 'jar_icon', 'tape.jsonl');
const kept = readFileSync(jar, 'utf8').trim().split('\n').filter((l, i) => i === 0 || (JSON.parse(l) as { at?: string }).at! < '2026-10-29');
writeFileSync(jar, kept.join('\n') + '\n');
const m0 = JSON.parse(readFileSync(join(project, 'manifest.json'), 'utf8')) as { assets: { name: string }[]; scenes?: unknown; sets: Record<string, unknown> };
delete m0.scenes;
m0.assets = m0.assets.filter((a) => !G12.test(a.name) || a.name === 'urn_blue');
writeFileSync(join(project, 'manifest.json'), JSON.stringify(m0, null, 2) + '\n');

const transport = new StdioClientTransport({ command: process.execPath, args: [join(REPO, 'cli', 'bin', 'pixelclaw.js'), 'serve', '--project', project, '--port', port], stderr: 'pipe' });
(transport.stderr as PassThrough).resume();
const client = new Client({ name: 'demo-g12-agent', version: '1.0.0' });
await client.connect(transport);
type Content = { type: string; text?: string }[];
async function call(name: string, a: Record<string, unknown> = {}): Promise<string> {
  const r = (await client.callTool({ name, arguments: a })) as { content: Content; isError?: boolean };
  const text = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  if (r.isError) throw new Error(text);
  return text;
}
const indent = (s: string, n = 4) => s.split('\n').map((l) => ' '.repeat(n) + l).join('\n');
const pick = (s: string, re: RegExp) => s.split('\n').filter((l) => re.test(l)).join('\n');

const info = await call('project');
const url = /watch live: (\S+)/.exec(info)![1]!;
console.log(`Kiln Hollow, carried on from G11. Watch: ${url}\n`);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log('1. The agent adds scenes to the manifest: the places the game shows, and what each needs');
  const manifest = JSON.parse(readFileSync(join(project, 'manifest.json'), 'utf8'));
  manifest.sets.clutter = { description: 'small things scattered on the ground' };
  manifest.scenes = [
    { name: 'kiln_yard', description: 'the yard below the kilns', uses: ['clay', 'yard_clay', 'kiln', 'rack', 'urn', 'urn_blue', 'cistern', 'potter'], map: 'hollow' },
    { name: 'stream_bank', description: 'where the goat grazes by the water', uses: ['sage', 'shallows', 'stream', 'reeds', 'goat'] },
    { name: 'trade_menu', description: 'the glaze-seller\'s screen', uses: ['jar_icon', 'hearth_icon', 'drop_icon', 'bowl_icon', 'hollow_type'] },
  ];
  console.log(indent(pick(await call('plan', { manifest }), /^wrote/), 2));
  console.log(indent(pick(await call('plan', { order: 'scene' }), /^scene /), 2));

  console.log('\n2. The person imports a sheet of pot shards into the gallery (the slice dialog)');
  await page.goto(`${url}&name=chris&tab=gallery`);
  await page.getByTestId('g-urn').waitFor();
  await page.getByTestId('import-input').setInputFiles(join(SRC, 'shards.png'));
  await page.getByTestId('import-dialog').waitFor();
  await page.getByTestId('import-kind').selectOption('sprite');
  await page.getByTestId('import-set').selectOption('clutter');
  await page.getByTestId('pattern').fill('shards_{n}');
  await page.getByTestId('import-names').filter({ hasText: 'shards_1, shards_2, shards_3' }).waitFor();
  await shot(page, 'import-dialog', { locator: '[data-testid=import-dialog]' });
  await page.getByTestId('import-go').click();
  await page.getByTestId('import-result').waitFor();
  console.log(indent((await page.getByTestId('import-result').innerText()).replace(/\n(Close|Show in the gallery)/g, '').trim(), 2));
  await shot(page, 'import-result', { locator: '[data-testid=import-dialog]' });
  await page.getByTestId('import-close').click();
  await page.getByTestId('g-shards_3').waitFor();
  await page.getByTestId('g-set').selectOption('clutter');
  await page.waitForTimeout(400);
  await shot(page, 'gallery-clutter');
  await page.getByTestId('g-set').selectOption('all');

  console.log('\n3. The person asks: Draw this on urn_blue and goat, Ask for changes on jar_icon');
  await page.getByTestId('tabs').locator('[data-tab=dashboard]').click();
  const card = (n: string) => page.getByTestId(`card-${n}`);
  const ask = async (n: string, button: 'draw' | 'reject', note: string) => {
    await card(n).getByTestId(button).click();
    await card(n).getByTestId('reject-text').fill(note);
    await card(n).getByTestId('reject-send').click();
    await card(n).locator('[data-state=open]').waitFor();
  };
  await ask('urn_blue', 'draw', 'the deep blue glaze; keep the rim dark');
  await ask('goat', 'draw', 'she grazes by the stream');
  await ask('jar_icon', 'reject', 'a wider mouth, so it reads as a jar at 1x');
  await stitch(page, ['urn_blue', 'goat', 'jar_icon'].map((n) => `[data-testid=card-${n}]`), 'requests');

  console.log('\n4. The agent: plan lists the requests first');
  console.log(indent(pick(await call('plan'), /^(Requests|  r\d)/), 2));

  console.log('\n5. work: urn_blue (a palette swap of the urn: clay to glaze, the highlight to smoke)');
  console.log(indent((await call('work')).split('\n').slice(0, 3).join('\n'), 2));
  await call('work', { action: 'progress', text: 'swapping the clay ramp for the glaze ramp' });
  const r1 = await call('run', { asset: 'urn_blue', commands: script('urn_blue.pclaw') });
  console.log(indent(pick(r1, /^(urn_blue: applied|checks:)/), 2));
  console.log(indent((await call('work', { action: 'done', text: 'urn_blue drawn: the urn with clay0-3 as glaze0-3 and its highlight as smoke; rim and ink unchanged; every check passes' })).split('\n')[0]!, 2));

  console.log('\n6. work: the goat. A choice only the person can make: blocked with a question');
  console.log(indent((await call('work')).split('\n').slice(0, 2).join('\n'), 2));
  console.log(indent(await call('work', { action: 'blocked', text: 'Horns or none? A nanny with short horns reads best at 24 px; a billy needs a beard too. And white, or the pale stone grey of the plan?' }), 2));

  console.log('\n7. work: the jar. Claimed, a note pinned where the rim will widen; the card says Claude is working on it');
  console.log(indent((await call('work')).split('\n').slice(0, 2).join('\n'), 2));
  await call('work', { action: 'progress', text: 'widening the rim by a pixel each side' });
  console.log(indent(pick(await call('run', { asset: 'jar_icon', commands: script('jar_icon_g12.pclaw') }), /^(jar_icon: applied|checks:)/), 2));

  await page.waitForTimeout(600);
  await card('urn_blue').locator('[data-state=done]').waitFor();
  await card('goat').locator('[data-state=blocked]').waitFor();
  await card('jar_icon').getByTestId('working').waitFor();
  console.log('\n8. The dashboard shows each state:');
  for (const n of ['urn_blue', 'goat', 'jar_icon']) console.log(`  ${n}: ${(await card(n).locator('.req').first().innerText()).replace(/\s+/g, ' ').replace(/ withdraw$/, '')}`);
  await stitch(page, ['urn_blue', 'goat', 'jar_icon'].map((n) => `[data-testid=card-${n}]`), 'states');
  await page.evaluate(() => document.querySelector('.dashboard')!.scrollTo(0, 0));
  await shot(page, 'scenes', { clip: { x: 0, y: 0, width: 1440, height: 330 } });

  console.log('\n9. The gallery: the urn and its blue glaze compared at game scale; the map and what it uses');
  await page.getByTestId('tabs').locator('[data-tab=gallery]').click();
  await page.getByTestId('pick-urn').check();
  await page.getByTestId('pick-urn_blue').check();
  await page.getByTestId('pick-shards_2').check();
  await page.getByTestId('compare').click();
  await page.getByTestId('compare-view').waitFor();
  await page.getByTestId('compare-view').getByRole('button', { name: '×2' }).click();
  await page.waitForTimeout(400);
  await shot(page, 'gallery-compare');
  await page.getByTestId('compare').click();
  await page.getByTestId('g-sort').selectOption('recent');
  await page.waitForTimeout(400);
  await shot(page, 'gallery');

  console.log('\n10. The plan now');
  console.log(indent(pick(await call('plan', { order: 'scene' }), /^(Requests|  r\d|scene |\d+ planned)/), 2));
} finally {
  await browser.close();
  await client.close();
}
if (args.includes('--keep')) {
  rmSync(EXAMPLE, { recursive: true, force: true });
  cpSync(project, EXAMPLE, { recursive: true, filter: (f) => !f.includes(`${project}/.cache`) && !f.endsWith('.pixelclaw.lock') && !f.endsWith('reads.json') && !f.includes(`${project}/logs`) });
  for (const d of readdirSync(join(EXAMPLE, 'views')).filter((f) => f.startsWith('shards'))) rmSync(join(EXAMPLE, 'views', d), { force: true });
  console.log(`\nkept the project as ${relative(REPO, EXAMPLE)}`);
}
