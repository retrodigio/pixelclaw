// A stand-in for the agent in the G8 demo (examples/demo-g8.md). It starts `pixelclaw serve` over
// stdio exactly as Claude Code would and gives you the watch link. It sets the stage quickly (the
// G4 grass and its variants, the G6 water and the G7 sand, shore and glint, rebuilt from their
// scripts), then works as G8 asks: a 48x48 house, a 24x48 tree and a well with footprints; a
// meadow and a lane family; a 40x30 coastal village painted from them; the village at game scale;
// the map checks' repetition hot spots, fixed with texture variants; then a person (played here by
// a headless browser, unless you pass --person no and do it yourself) moves the well in the watch
// view and the agent reads the change through `changes`; a blind review round of the village at
// game scale (the findings a fresh reviewer gave are in reviews/2026-10-28-g8/findings.md), brought
// back as notes and fixed; and a Tiled export.
//
//   node examples/demo-g8-agent.ts [--project <dir>] [--pause <ms>] [--person browser|no] [--linger <seconds>]

import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { chromium } from '@playwright/test';

const REPO = join(import.meta.dirname, '..');
const EXAMPLE = join(REPO, 'examples', 'mossy-ruins.pclaw');
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
const project = opt('--project', join(REPO, 'out', 'demo-g8.pclaw'));
const pause = Number(opt('--pause', '1200'));
const person = opt('--person', 'browser');
const linger = Number(opt('--linger', person === 'browser' ? '0' : '600')) * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The project starts with the example's palettes and style guide.
if (existsSync(join(project, 'project.json'))) rmSync(project, { recursive: true, force: true });
mkdirSync(join(project, 'palettes'), { recursive: true });
mkdirSync(join(project, 'assets'), { recursive: true });
copyFileSync(join(EXAMPLE, 'project.json'), join(project, 'project.json'));
copyFileSync(join(EXAMPLE, 'style.md'), join(project, 'style.md'));
// The shore and the meadow use the project's own scheme blob47-round (since G9).
cpSync(join(EXAMPLE, 'schemes'), join(project, 'schemes'), { recursive: true });
for (const p of ['mossy-ruins', 'ruins-water', 'ruins-props']) copyFileSync(join(EXAMPLE, 'palettes', `${p}.json`), join(project, 'palettes', `${p}.json`));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(REPO, 'cli', 'bin', 'pixelclaw.js'), 'serve', '--project', project],
  stderr: 'pipe',
});
(transport.stderr as PassThrough).resume();
const client = new Client({ name: 'demo-g8-agent', version: '1.0.0' });
await client.connect(transport);

type Content = { type: string; text?: string }[];
async function call(name: string, a: Record<string, unknown>): Promise<string> {
  const r = (await client.callTool({ name, arguments: a })) as { content: Content; isError?: boolean };
  const text = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  if (r.isError) throw new Error(text);
  return text;
}

/** A script in pieces: a new piece starts at each comment that follows a command. */
function sections(file: string): string[] {
  const out: string[][] = [[]];
  let prevCommand = false;
  for (const line of readFileSync(join(REPO, 'examples', 'scripts', file), 'utf8').split('\n')) {
    const comment = line.startsWith('#');
    if (comment && prevCommand) out.push([]);
    out.at(-1)!.push(line);
    if (line.trim()) prevCommand = !comment;
  }
  return out.map((s) => s.join('\n').trim()).filter((s) => s.split('\n').some((l) => l.trim() && !l.startsWith('#')));
}

const indent = (s: string, n = 4) => s.split('\n').map((l) => ' '.repeat(n) + l).join('\n');
const intent = (s: string) => s.split('\n').filter((l) => l.startsWith('#')).map((l) => l.slice(2)).join(' ');

async function apply(asset: string, file: string, o: { quiet?: boolean; wait?: number } = {}): Promise<void> {
  for (const s of sections(file)) {
    const out = await call('run', { asset, commands: s });
    if (!o.quiet) {
      console.log(indent(`- ${intent(s)}`, 2));
      console.log(indent(out.split('\n').at(-1)!, 4));
    }
    await sleep(o.wait ?? pause);
  }
}

/** A check table's failing lines, with their details. */
const failing = (table: string) => table.split('\n').filter((l, i) => i === 0 || /^\s+✗/.test(l) || /^\s{7}\S/.test(l)).join('\n');

const info = await call('project', {});
const url = /watch live: (\S+)/.exec(info)![1]!;
console.log(`Watch the agent work:\n\n  ${url}\n`);
await sleep(pause * 2);

console.log('0. The stage: the grass and its variants, the water, the sand, the shore and the glints, rebuilt from their scripts');
for (const a of ['grass', 'grass_b', 'grass_c', 'water', 'sand', 'glint', 'shore']) {
  await apply(a, `${a}.pclaw`, { quiet: true, wait: 0 });
  for (const step of ['fix', 'review']) if (existsSync(join(REPO, 'examples', 'scripts', `${a}_${step}.pclaw`))) await apply(a, `${a}_${step}.pclaw`, { quiet: true, wait: 0 });
}

console.log('\n1. Objects bigger than a cell: a 48x48 house, a 24x48 tree, a well; each with its footprint');
for (const a of ['house', 'tree', 'well']) await apply(a, `${a}.pclaw`);
console.log(indent((await call('view', { asset: 'house', mode: 'map' })).split('\n')[0]!, 2));
console.log(indent((await call('view', { asset: 'tree', mode: 'map' })).split('\n')[0]!, 2));

console.log('\n2. Two families for the village: a meadow (grass on sand) and a lane (a sand path through grass)');
await apply('meadow', 'meadow.pclaw');
await apply('lane', 'lane.pclaw');

console.log('\n3. The village: a 40x30 map, painted from the families, with the houses, the well and trees');
await apply('village', 'village.pclaw');
console.log(indent((await call('view', { asset: 'village', mode: 'map' })).split('\n').slice(0, 8).join('\n'), 2));
console.log(indent((await call('view', { asset: 'village', mode: 'map', camera: '19,15' })).split('\n').filter((l) => l.startsWith('showing')).join('\n'), 2));

console.log('\n4. The map checks: where does it repeat?');
console.log(indent(failing(await call('check', { asset: 'village', checks: ['seam', 'repetition', 'footprint', 'draworder', 'coverage'] })).split('\n').slice(0, 12).join('\n'), 2));
await call('view', { asset: 'village', mode: 'map', marks: 'failing' });

console.log('\n5. The fix: texture variants. The lane, the meadow and the shore each get variants (forked, the band drawn again,');
console.log('   detail moved; the meadow\'s from the grass variants); the map picks among them cell by cell');
for (const a of ['lane_b', 'lane_c', 'meadow_b', 'meadow_c', 'shore_b']) await apply(a, `${a}.pclaw`);
console.log(indent((await call('check', { asset: 'village', checks: ['seam', 'repetition'] })).split('\n').slice(0, 3).join('\n'), 2));
console.log(indent((await call('view', { asset: 'village', mode: 'map', camera: '19,15' })).split('\n').filter((l) => l.startsWith('showing')).join('\n'), 2));

console.log('\n6. A person moves the well in the watch view; the agent reads the change');
if (person === 'browser') {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${url}&name=chris`);
    await page.getByTestId('status').getByText('live').waitFor();
    await page.locator('.follow input').uncheck();
    await page.locator('.assets li').filter({ has: page.locator('.name', { hasText: /^village$/ }) }).click();
    await page.getByTestId('map-editor').waitFor();
    await page.locator('[data-tool="move"]').click();
    const box = (await page.getByTestId('map-edit-canvas').boundingBox())!;
    const at = (x: number, y: number) => [box.x + (x + 0.5) * 24, box.y + (y + 0.5) * 24] as const;
    // The well stands at 20,15; the person drags it two cells down, beside the crossroads.
    await page.mouse.move(...at(20, 15));
    await page.mouse.down();
    await page.mouse.move(...at(20, 16), { steps: 4 });
    await page.mouse.move(...at(20, 18), { steps: 4 });
    await page.mouse.up();
    await sleep(800);
    console.log('  (human:chris dragged the well in the watch view)');
  } finally {
    await browser.close();
  }
} else {
  console.log(`  Open ${url}, pick the village, choose move and drag the well (the stone ring at 20,15). Press Enter when done.`);
  await new Promise((r) => process.stdin.once('data', r));
}
console.log(indent((await call('changes', {})).split('\n').filter((l) => !l.startsWith('saved') && l.trim()).slice(0, 6).join('\n'), 2));
console.log(indent(failing(await call('check', { asset: 'village', checks: ['footprint', 'draworder'] })), 2));

console.log('\n7. A blind review bundle with the village at game scale, for a fresh reviewer with no other context');
console.log(indent(await call('review', { assets: ['village', 'house', 'tree', 'well', 'meadow', 'lane', 'shore'], name: 'g8' }), 2));
console.log('\n8. The reviewer\'s findings (reviews/2026-10-28-g8/findings.md), back as notes and fixed: the house\'s strays and roof,');
console.log('   the tree\'s shading and painted shadow, the well\'s basin, the meadow\'s rim; a second tree, a variant of the first;');
console.log('   on the village a tree moved off a house and paths to two doors (the sea\'s, the sand\'s and the corners\' notes stay open)');
await apply('tree_b', 'tree_b.pclaw');
for (const a of ['house', 'tree', 'well', 'meadow', 'village']) await apply(a, `${a}_review.pclaw`);
console.log(indent((await call('view', { asset: 'village', mode: 'map', camera: '19,13' })).split('\n').filter((l) => l.startsWith('showing')).join('\n'), 2));

console.log('\n9. Every check on the new assets, and a Tiled export of the village');
for (const a of ['house', 'tree', 'tree_b', 'well', 'meadow', 'lane', 'village']) console.log(indent((await call('check', { asset: a })).split('\n')[0]!, 2));
console.log(indent((await call('export', { asset: 'village', format: 'tmx' })).split('\n')[0]!, 2));
console.log(indent((await call('export', { asset: 'house', format: 'split' })).split('\n')[0]!, 2));

console.log(`\nDone. The project is ${project}. In the watch view, pick the village: paint, place, move, or stand the camera somewhere.`);
if (linger) {
  console.log(`The server stops in ${linger / 1000} s (or press Ctrl-C).`);
  await Promise.race([sleep(linger), new Promise((r) => process.once('SIGINT', r))]);
}
await client.close();
