// A stand-in for the agent in the G6 demo (examples/demo-g6.md). It starts `pixelclaw serve` over
// stdio exactly as Claude Code would and gives you the watch link. It sets the stage quickly (the
// mossy ruins style guide and the G1-G5 art, rebuilt from their scripts), then works as G6 asks:
// a walking figure in four directions with two frames each (south, north and east drawn; west a
// live mirror of east), and a water tile that shimmers in four frames, each piece followed by its
// check summary over every frame; the anim views (contact sheet and GIF); the stone floor redrawn
// as flagstones; and a blind review bundle (the findings a fresh reviewer gave are in
// examples/mossy-ruins.pclaw/reviews/2026-10-28-g6/findings.md). Then it lingers, so you can play
// the animations in the watch view at the game's speed.
//
//   node examples/demo-g6-agent.ts [--project <dir>] [--pause <ms>] [--linger <seconds>]

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const REPO = join(import.meta.dirname, '..');
const EXAMPLE = join(REPO, 'examples', 'mossy-ruins.pclaw');
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
const project = opt('--project', join(REPO, 'out', 'demo-g6.pclaw'));
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

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(REPO, 'cli', 'bin', 'pixelclaw.js'), 'serve', '--project', project],
  stderr: 'pipe',
});
(transport.stderr as PassThrough).resume();
const client = new Client({ name: 'demo-g6-agent', version: '1.0.0' });
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

console.log('0. The stage: the G1-G5 art, rebuilt from their scripts');
for (const name of ['stone_floor', 'grass', 'grass_b', 'grass_c', 'chest', 'glowcap']) {
  await apply(name, `${name}.pclaw`, { quiet: true, wait: 0 });
  for (const step of ['fix', 'review']) if (existsSync(join(REPO, 'examples', 'scripts', `${name}_${step}.pclaw`))) await apply(name, `${name}_${step}.pclaw`, { quiet: true, wait: 0 });
}

console.log('1. A walking figure: south, north and east drawn; west a live mirror of east');
await apply('walker', 'walker.pclaw');
console.log(indent(await call('check', { asset: 'walker', checks: ['anim', 'views', 'orphans', 'jaggies', 'outline'] }), 2));
console.log(indent(await call('view', { asset: 'walker', mode: 'anim' }), 2));
console.log(indent((await call('view', { asset: 'walker', mode: 'game', frame: 1 })).split('\n').at(-1)!, 2));

console.log('\n2. A water tile that shimmers in four frames');
await apply('water', 'water.pclaw');
console.log(indent(await call('view', { asset: 'water', mode: 'anim' }), 2));

console.log('\n3. The stone floor, redrawn as flagstones');
await apply('stone_floor', 'stone_floor_redraw.pclaw');
console.log(indent((await call('view', { asset: 'stone_floor', mode: 'tile3x3' })).split('\n').at(-1)!, 2));

console.log('\n4. Every check, every asset (over every frame)');
console.log(indent(await call('check', {}), 2));

console.log('\n5. A blind review bundle, for a fresh reviewer with no other context');
console.log(indent(await call('review', { assets: ['stone_floor', 'walker', 'water', 'chest', 'grass'], name: 'g6' }), 2));

console.log('\n6. The reviewer\'s findings (reviews/2026-10-28-g6/findings.md), back as notes on the pixels; the boots, soil and moss fixed');
await apply('walker', 'walker_review.pclaw');
await apply('stone_floor', 'stone_floor_g6review.pclaw');
console.log(indent(await call('check', {}), 2));

console.log(`\nDone. The project is ${project}. In the watch view, pick walker or water and press ▶ (or Enter) to play at the game's speed.`);
if (linger) {
  console.log(`The server stops in ${linger / 1000} s (or press Ctrl-C).`);
  await Promise.race([sleep(linger), new Promise((r) => process.once('SIGINT', r))]);
}
await client.close();
