// A stand-in for the agent in the G7 demo (examples/demo-g7.md). It starts `pixelclaw serve` over
// stdio exactly as Claude Code would and gives you the watch link. It sets the stage quickly (the
// water tile from G6, rebuilt from its script), then works as G7 asks: a seamless sand tile; a
// shore family of 47 variants from a band profile (water, foam, wet sand, sand), its textures
// copied from the sand and, frame by frame, from the shimmering water; three pieces detailed by
// hand, which every variant built from them follows; a glint overlay; the family on a random
// island with the seam score over it (at most 0.5); and a blind review round on the island (the
// findings a fresh reviewer gave are in examples/mossy-ruins.pclaw/reviews/2026-10-28-g7/findings.md),
// brought back as notes and fixed. Then it lingers, so you can look at the variants and the map in
// the watch view.
//
//   node examples/demo-g7-agent.ts [--project <dir>] [--pause <ms>] [--linger <seconds>]

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const REPO = join(import.meta.dirname, '..');
const EXAMPLE = join(REPO, 'examples', 'mossy-ruins.pclaw');
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
const project = opt('--project', join(REPO, 'out', 'demo-g7.pclaw'));
const pause = Number(opt('--pause', '1500'));
const linger = Number(opt('--linger', '600')) * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The project starts with the example's palette and style guide (project.json `style`, style.md).
if (existsSync(join(project, 'project.json'))) rmSync(project, { recursive: true, force: true });
mkdirSync(join(project, 'palettes'), { recursive: true });
mkdirSync(join(project, 'assets'), { recursive: true });
copyFileSync(join(EXAMPLE, 'project.json'), join(project, 'project.json'));
copyFileSync(join(EXAMPLE, 'style.md'), join(project, 'style.md'));
copyFileSync(join(EXAMPLE, 'palettes', 'mossy-ruins.json'), join(project, 'palettes', 'mossy-ruins.json'));
copyFileSync(join(EXAMPLE, 'palettes', 'ruins-water.json'), join(project, 'palettes', 'ruins-water.json'));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(REPO, 'cli', 'bin', 'pixelclaw.js'), 'serve', '--project', project],
  stderr: 'pipe',
});
(transport.stderr as PassThrough).resume();
const client = new Client({ name: 'demo-g7-agent', version: '1.0.0' });
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
/** The comment lines of a piece: what the agent means to do. */
const intent = (s: string) => s.split('\n').filter((l) => l.startsWith('#')).map((l) => l.slice(2)).join(' ');

/** Run a script piece by piece; show what each piece is for and the check summary after it. */
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

/** The failing lines of a check table, with their coordinates. */
const failing = (table: string) => table.split('\n').filter((l, i) => i === 0 || /^\s+✗/.test(l) || /^\s{7}\S/.test(l)).join('\n');

const info = await call('project', {});
const url = /watch live: (\S+)/.exec(info)![1]!;
console.log(`Watch the agent work:\n\n  ${url}\n`);
await sleep(pause * 2);

console.log('0. The stage: the shimmering water tile from G6, rebuilt from its script');
await apply('water', 'water.pclaw', { quiet: true, wait: 0 });

console.log('1. A seamless sand tile (the shore\'s inside texture)');
await apply('sand', 'sand.pclaw');
console.log(indent((await call('view', { asset: 'sand', mode: 'tile3x3' })).split('\n').at(-1)!, 2));

console.log('\n2. The shore: a blob47 family from a band profile, three pieces detailed by hand');
await apply('shore', 'shore.pclaw');
console.log(indent(await call('view', { asset: 'shore', mode: 'family' }), 2));

console.log('\n3. A glint overlay for the water');
await apply('glint', 'glint.pclaw');

const SEED = 6;
console.log(`\n4. The shore on a random island (16x12, seed ${SEED}), the glints playing over it`);
console.log(indent(await call('view', { asset: 'shore', mode: 'map', size: '16x12', seed: SEED, with: ['glint'] }), 2));
const seam = Number(/seam ([\d.]+)/.exec(await call('view', { asset: 'shore', mode: 'map', size: '16x12', seed: SEED }))![1]);
console.log(`  seam over the island: ${seam} (the demo asks for at most 0.5: ${seam <= 0.5 ? 'met' : 'NOT met'})`);

console.log('\n5. A blind review bundle with the island, for a fresh reviewer with no other context');
console.log(indent(await call('review', { assets: ['shore', 'sand', 'water', 'glint'], name: 'g7', size: '16x12', seed: SEED }), 2));

if (existsSync(join(REPO, 'examples', 'scripts', 'shore_review.pclaw'))) {
  console.log('\n6. The reviewer\'s findings (reviews/2026-10-28-g7/findings.md), back as notes on the pixels, and fixed');
  for (const name of ['sand', 'shore', 'glint']) {
    if (existsSync(join(REPO, 'examples', 'scripts', `${name}_review.pclaw`))) await apply(name, `${name}_review.pclaw`);
  }
  console.log(indent((await call('view', { asset: 'shore', mode: 'map', size: '16x12', seed: SEED })).split('\n').slice(0, 2).join('\n'), 2));
}

console.log('\n7. Every check on the new assets');
for (const a of ['sand', 'shore', 'glint']) console.log(indent((await call('check', { asset: a })).split('\n')[0]!, 2));

console.log(`\nDone. The project is ${project}. In the watch view, pick shore and switch the toolbar from sheet to variants or map.`);
if (linger) {
  console.log(`The server stops in ${linger / 1000} s (or press Ctrl-C).`);
  await Promise.race([sleep(linger), new Promise((r) => process.once('SIGINT', r))]);
}
await client.close();
