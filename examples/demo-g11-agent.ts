// A stand-in for the agent in the G11 demo (examples/demo-g11.md). It carries on from the G10
// project (examples/kiln-hollow.pclaw) through `pixelclaw serve` over stdio, as Claude does:
// plans a HUD set and a few tiles, puts an offline mockup under a 6x4-tile scene (the builder made
// it without an API key: examples/kiln-hollow/make-yard-mockup.ts), snaps it into a draft layer,
// cuts three tiles out of the draft and cleans them by coordinates until their checks pass, draws
// a 5x7 pixel font and exports it as a glyph strip and as BMFont, and draws four HUD icons that
// the icon-set check holds to each other (three are fixed after it flags them).
//
//   node examples/demo-g11-agent.ts [--project <dir>] [--pause <ms>] [--linger <seconds>] [--keep]

import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const REPO = join(import.meta.dirname, '..');
const SRC = join(REPO, 'examples', 'kiln-hollow');
const EXAMPLE = join(REPO, 'examples', 'kiln-hollow.pclaw');
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
const project = opt('--project', join(REPO, 'out', 'demo-g11.pclaw'));
const pause = Number(opt('--pause', '600'));
const linger = Number(opt('--linger', '0')) * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const script = (f: string) => readFileSync(join(SRC, 'scripts', f), 'utf8');

// The G10 project, without the G11 work if it was kept there before.
if (existsSync(project)) rmSync(project, { recursive: true, force: true });
const G11 = ['yard', 'sage', 'yard_clay', 'shallows', 'hollow_type', 'jar_icon', 'hearth_icon', 'drop_icon', 'bowl_icon'];
cpSync(EXAMPLE, project, { recursive: true, filter: (f) => !G11.some((a) => f.includes(`${EXAMPLE}/assets/${a}`)) && !f.includes(`${EXAMPLE}/.cache`) && !f.includes(`${EXAMPLE}/blobs`) && !f.includes(`${EXAMPLE}/logs`) });
const manifest = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8'));
writeFileSync(join(project, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(REPO, 'cli', 'bin', 'pixelclaw.js'), 'serve', '--project', project],
  stderr: 'pipe',
});
(transport.stderr as PassThrough).resume();
const client = new Client({ name: 'demo-g11-agent', version: '1.0.0' });
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
const short = (s: string, n = 150) => (s.length > n ? s.slice(0, n) + '…' : s);

const info = await call('project', {});
const url = /watch live: (\S+)/.exec(info)![1]!;
console.log(`Kiln Hollow, carried on from G10. Watch: ${url}\n`);

console.log('1. The plan grows: a HUD set (four icons and a 5x7 font) and two tiles from a mockup of the yard');
const hud = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,!?:-\'';
const m2 = {
  ...manifest,
  sets: { ...manifest.sets, hud: { description: 'icons and type on the screen' } },
  assets: [
    ...manifest.assets.map((a: { name: string }) => (a.name === 'jar_icon' ? { ...a, set: 'hud' } : a)),
    { name: 'hearth_icon', kind: 'icon', size: '16x16', set: 'hud', description: 'a bottle kiln with its fire lit, for the firing menu', flat: 'clay3' },
    { name: 'drop_icon', kind: 'icon', size: '16x16', set: 'hud', description: 'a drop of stream water, for the water meter', flat: 'stream2' },
    { name: 'bowl_icon', kind: 'icon', size: '16x16', set: 'hud', description: 'a clay bowl, for the food meter', flat: 'clay4' },
    { name: 'hollow_type', kind: 'font', size: '5x7', set: 'hud', chars: hud, description: 'the HUD lettering: capitals, digits and a little punctuation' },
    { name: 'yard_clay', kind: 'tile', size: '24x24', set: 'ground', description: 'trodden yard clay, from the yard mockup', flat: 'clay2' },
    { name: 'shallows', kind: 'tile', size: '24x24', set: 'ground', description: 'still silty water at the yard\'s edge, from the yard mockup', flat: 'stream1' },
  ],
};
console.log(indent(pick(await call('plan', { manifest: m2 }), /^(wrote|\d+ planned)/), 2));
// The yard is a working sheet: once its tiles are cut, its draft stays as a reference (no art), so
// its cells are not held to coverage. The agent writes this into the style guide with its file tools.
const pj = JSON.parse(readFileSync(join(project, 'project.json'), 'utf8'));
pj.style.assets = { ...(pj.style.assets ?? {}), yard: { checks: { coverage: { off: true } } } };
writeFileSync(join(project, 'project.json'), JSON.stringify(pj, null, 2) + '\n');
await sleep(pause);

console.log('\n2. A mockup underlay for the 6x4-tile yard (offline: made by examples/kiln-hollow/make-yard-mockup.ts, no key needed)');
await call('run', { asset: 'yard', commands: script('yard.pclaw') });
const imp = await call('run', { asset: 'yard', commands: `underlay import ${join(SRC, 'yard-mockup.png')} layout=${join(SRC, 'yard-layout.png')}` });
console.log(indent(short(pick(imp, /^#\d+ .*underlay/).replace(/^#\d+ \S+ \S+\s+/, ''), 200), 2));
await call('view', { asset: 'yard', mode: 'render', scale: 4 });
console.log(`  the render view shows it faded under the (empty) art: ${relative(REPO, join(project, 'views', 'yard.render.png'))}`);
await sleep(pause);

console.log('\n3. snap: the grid fitted, each block quantised to the palette on a new draft layer');
const sn = await call('run', { asset: 'yard', commands: 'snap' });
console.log(indent(pick(sn, /^#\d+ .*snap/).replace(/^#\d+ \S+ \S+\s+/, '').replace(/ <<$/, ''), 2));
console.log(indent(pick(sn, /^warnings/), 2));
await sleep(pause);

console.log('\n4. Three tiles cut from the draft (import … asset=yard region=… layer=draft), cleaned by coordinates');
for (const t of ['sage', 'yard_clay', 'shallows']) {
  const cut = await call('run', { asset: t, commands: script(`${t}.pclaw`) });
  const rep = pick(await call('check', { asset: t, checks: ['seam', 'repetition'] }), /^ {2}[✓✗] {2}(seam|repetition)/).replace(/\s+/g, ' ').trim();
  const clean = await call('run', { asset: t, commands: script(`${t}_clean.pclaw`) });
  console.log(`  ${t}: cut: ${summary(cut).replace('checks: ', '')}\n    ${short(rep, 160)}\n    after ${pick(clean, /applied/).replace(/^.*applied (\d+) commands?.*$/, '$1 commands')}: ${summary(clean).replace('checks: ', '')}`);
}
await call('run', { asset: 'yard', commands: 'layer set draft reference=on' });
await sleep(pause);

console.log('\n5. A 5x7 font (hollow_type): 44 glyphs, the size and characters from the manifest');
const ft = await call('run', { asset: 'hollow_type', commands: script('hollow_type.pclaw') });
console.log(`  ${summary(ft)}`);
console.log(indent(pick(await call('check', { asset: 'hollow_type', checks: ['font'] }), /^ {2}✓ {2}font/).replace(/\s+/g, ' ').trim(), 2));
for (const format of ['strip', 'bmfont']) {
  const ex = await call('export', { asset: 'hollow_type', format });
  console.log(`  ${format}: ${pick(ex, /\.(png|txt|fnt)/).split('\n').map((l) => relative(project, l.trim().replace(/^.*?(\/\S+)$/, '$1'))).join(', ')}`);
}
await sleep(pause);

console.log('\n6. Four HUD icons (icon mode=full), then the icon-set check (stroke weight, box fill, optical centre)');
for (const i of ['jar_icon', 'hearth_icon', 'drop_icon', 'bowl_icon']) {
  const r = await call('run', { asset: i, commands: script(`${i}.pclaw`) });
  console.log(`  ${i}: ${summary(r).replace('checks: ', '')}`);
}
const ck = await call('check', { asset: 'bowl_icon', checks: ['consistency'] });
console.log(indent(pick(ck, /^ {7}(box fill|optical centre)/).trim(), 2));
console.log('  Fixed: the jar\'s rim by coordinates; the drop drawn wider; the bowl larger and lower');
for (const i of ['jar_icon', 'drop_icon', 'bowl_icon']) {
  const r = await call('run', { asset: i, commands: script(`${i}_fix.pclaw`) });
  console.log(`  ${i}: ${summary(r).replace('checks: ', '')}`);
}
await sleep(pause);

console.log('\n7. The plan now');
console.log(indent(pick(await call('plan', { set: 'hud' }), /^ {2}\S|^\d+ planned/), 2));
console.log(indent(pick(await call('plan', {}), /^\d+ planned/), 2));

if (linger) {
  console.log(`\nThe server stays up for ${linger / 1000} s: ${url}`);
  await sleep(linger);
}
await client.close();
if (args.includes('--keep')) {
  rmSync(EXAMPLE, { recursive: true, force: true });
  cpSync(project, EXAMPLE, { recursive: true, filter: (f) => !f.includes(`${project}/.cache`) && !f.endsWith('.pixelclaw.lock') && !f.endsWith('reads.json') });
  console.log(`\nkept the project as ${relative(REPO, EXAMPLE)}`);
}
