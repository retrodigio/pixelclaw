// A stand-in for the agent in the G10 demo (examples/demo-g10.md). From a one-paragraph theme
// (examples/kiln-hollow/theme.md) it does what Claude does with the PixelClaw skill: starts
// `pixelclaw serve` over stdio on a new project, writes the palette, the style guide and a
// 20-asset manifest, draws the flat templates, then takes three assets end to end (the clay
// tile, the urn and the kiln): drawn, checked, reviewed blind (the findings of a real
// fresh-context reviewer, kept in examples/kiln-hollow/findings.md, pinned as notes and fixed by
// coordinates), approved by a person in the dashboard (a headless browser plays the person
// unless you pass --person no), and exported through the atlas profile.
//
//   node examples/demo-g10-agent.ts [--project <dir>] [--pause <ms>] [--person browser|no] [--linger <seconds>]

import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { chromium } from '@playwright/test';

const REPO = join(import.meta.dirname, '..');
const SRC = join(REPO, 'examples', 'kiln-hollow');
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
const project = opt('--project', join(REPO, 'out', 'demo-g10.pclaw'));
const pause = Number(opt('--pause', '600'));
const person = opt('--person', 'browser');
const linger = Number(opt('--linger', person === 'browser' ? '0' : '600')) * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const script = (f: string) => readFileSync(join(SRC, 'scripts', f), 'utf8');

if (existsSync(project)) rmSync(project, { recursive: true, force: true });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(REPO, 'cli', 'bin', 'pixelclaw.js'), 'serve', '--project', project],
  stderr: 'pipe',
});
(transport.stderr as PassThrough).resume();
const client = new Client({ name: 'demo-g10-agent', version: '1.0.0' });
await client.connect(transport);

type Content = { type: string; text?: string }[];
async function call(name: string, a: Record<string, unknown>): Promise<string> {
  const r = (await client.callTool({ name, arguments: a })) as { content: Content; isError?: boolean };
  const text = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  if (r.isError) throw new Error(text);
  return text;
}
const indent = (s: string, n = 4) => s.split('\n').map((l) => ' '.repeat(n) + l).join('\n');
const pick = (s: string, re: RegExp) => s.split('\n').filter((l) => re.test(l)).join('\n');
const summary = (s: string) => pick(s, /^checks:/).trim();

console.log('1. The theme (examples/kiln-hollow/theme.md):\n');
console.log(indent(readFileSync(join(SRC, 'theme.md'), 'utf8').trim(), 2));
const info = await call('project', { palettes: [join(SRC, 'kiln-hollow.json')] });
const url = /watch live: (\S+)/.exec(info)![1]!;
console.log(`\n   Watch the agent work, and the plan: ${url}&tab=dashboard\n`);

console.log('2. The style guide (style.md, and its settings in project.json) and the palette (kiln-hollow: 29 colours, 7 ramps)');
// The agent writes these files with its own file tools, as Claude Code does.
copyFileSync(join(SRC, 'style.md'), join(project, 'style.md'));
const pj = JSON.parse(readFileSync(join(project, 'project.json'), 'utf8'));
pj.name = 'kiln-hollow';
pj.style = JSON.parse(readFileSync(join(SRC, 'style.json'), 'utf8'));
writeFileSync(join(project, 'project.json'), JSON.stringify(pj, null, 2) + '\n');
// The stream's rounded bank uses the rounder-corner scheme from the mossy-ruins example.
mkdirSync(join(project, 'schemes'), { recursive: true });
copyFileSync(join(REPO, 'examples', 'mossy-ruins.pclaw', 'schemes', 'blob47-round.json'), join(project, 'schemes', 'blob47-round.json'));
console.log(indent(readFileSync(join(SRC, 'style.md'), 'utf8').split('\n').filter((l) => l.startsWith('- **')).map((l) => l.replace(/^- \*\*(.*?)\.?\*\*.*/, '$1')).join(' · '), 2));
await sleep(pause);

console.log('\n3. The manifest: 20 assets in five sets, written through the plan tool (checked against its schema first)');
const manifest = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8'));
const broken = { ...manifest, assets: [...manifest.assets, { name: 'kiln', kind: 'object', size: '24' }] };
try {
  await call('plan', { manifest: broken });
} catch (e) {
  console.log(indent((e as Error).message, 2));
}
const plan0 = await call('plan', { manifest });
console.log(indent(pick(plan0, /^(wrote|\d+ planned)/), 2));
await sleep(pause);

console.log('\n4. The flat templates: a mockup screen and a coverage map per family (templates/)');
const tpl = await call('plan', { templates: true, set: 'ground' });
console.log(indent(pick(tpl, /^templates in/).replace(project, relative(REPO, project)), 2));
console.log(indent(readFileSync(join(project, 'templates', 'mockup.txt'), 'utf8').trim(), 2));
console.log(indent(pick(readFileSync(join(project, 'templates', 'bank.coverage.txt'), 'utf8'), /variants$/), 2));
await sleep(pause);

console.log('\n5. Three assets drawn; their `new` lines leave the size to the manifest');
for (const a of ['clay', 'urn', 'kiln']) {
  const r = await call('run', { asset: a, commands: script(`${a}.pclaw`) });
  console.log(`  ${a}: ${summary(r)}`);
}
console.log(indent(JSON.parse(readFileSync(join(project, 'assets', 'kiln', 'tape.jsonl'), 'utf8').split('\n')[1]!).cmd.split('\n')[0], 2));
console.log(indent(pick(await call('check', { asset: 'kiln', checks: ['consistency', 'readability', 'fit'] }), /^ {2}[✓✗]/), 2));
await sleep(pause);

console.log('\n6. A blind review bundle, handed to a fresh agent with no other context');
const rv = await call('review', { assets: ['clay', 'urn', 'kiln'], name: 'g10' });
const bundle = /review bundle: (\S+)/.exec(rv)![1]!;
console.log(indent(`${relative(REPO, bundle)}: ${pick(rv, /files:/).replace(/^\d+ files: /, '')}`, 2));
console.log('  The reviewer\'s report (a real one, kept in examples/kiln-hollow/findings.md) goes in the bundle as findings.md:');
copyFileSync(join(SRC, 'findings.md'), join(bundle, 'findings.md'));
const findings = readFileSync(join(SRC, 'findings.md'), 'utf8');
console.log(indent(pick(findings, /^\*\*\d\./).replace(/\*\*/g, '').split('\n').map((l) => l.replace(/^(.{0,110}).*$/, '$1…')).join('\n'), 2));

console.log('\n7. The findings pinned on their pixels, fixed by coordinates, the notes closed, then `mark reviewed`');
for (const a of ['clay', 'urn', 'kiln']) {
  const notes = await call('run', { asset: a, commands: script(`${a}_review.pclaw`) });
  const fixed = await call('run', { asset: a, commands: script(`${a}_fix.pclaw`) });
  await call('run', { asset: a, commands: `mark reviewed "blind review g10: ${a === 'clay' ? 5 : a === 'urn' ? 7 : 5} findings fixed by coordinates"` });
  console.log(`  ${pick(notes, /applied/).replace(/ as group.*/, '')} (notes); after the fixes ${summary(fixed)}`);
}
console.log(indent(pick(await call('plan', { set: 'props' }), /^ {2}\S/).split('\n').slice(0, 2).join('\n'), 2));
await sleep(pause);

console.log('\n8. A person approves the three in the dashboard (each approval is `mark approved` on the tape, by them)');
if (person === 'browser') {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${url}&name=chris&tab=dashboard`);
    for (const a of ['clay', 'urn', 'kiln']) {
      const card = page.getByTestId(`card-${a}`);
      await card.getByTestId('approve').click();
      await card.and(page.locator('[data-status=approved]')).waitFor();
    }
    console.log('  (human:chris pressed Approve on clay, urn and kiln)');
  } finally {
    await browser.close();
  }
} else {
  console.log(`  Open ${url}&tab=dashboard and press Approve on clay, urn and kiln. Press Enter when done.`);
  await new Promise((r) => process.stdin.once('data', r));
}
console.log(indent(pick(await call('changes', {}), /mark approved|^\w+: \d+ command/), 2));

console.log('\n9. Exported through the manifest\'s profile (atlas), recorded in exported.json');
const ex = await call('export', { profile: manifest.export.profile, assets: ['clay', 'urn', 'kiln'] });
console.log(indent(pick(ex, /^atlas:/).replace(project + '/', ''), 2));

console.log('\n10. The plan now');
const plan1 = await call('plan', {});
console.log(indent(pick(plan1, /^\d+ planned|exported|of \d+ still/), 2));

if (linger) {
  console.log(`\nThe server stays up for ${linger / 1000} s: ${url}&tab=dashboard`);
  await sleep(linger);
}
await client.close();
// Keep a copy of the result as the example project (without the cache).
if (args.includes('--keep')) {
  const dest = join(REPO, 'examples', 'kiln-hollow.pclaw');
  rmSync(dest, { recursive: true, force: true });
  cpSync(project, dest, { recursive: true, filter: (f) => !f.includes(`${project}/.cache`) && !f.endsWith('.pixelclaw.lock') && !f.endsWith('reads.json') });
  console.log(`\nkept the project as ${relative(REPO, dest)}`);
}
