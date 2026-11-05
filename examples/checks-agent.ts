// A stand-in for the agent in the drawing-and-checks walkthrough demo (examples/drawing-and-checks.md). It starts `pixelclaw serve` over
// stdio exactly as Claude Code would and gives you the watch link. It sets the stage quickly (the
// mossy ruins style guide and the earlier art, rebuilt from their scripts), then:
// a test sprite with five deliberate defects is drawn, the checks flag each one with coordinates,
// and the fixes go in by those coordinates until every check is green; then the same for the
// weak spots the checks find in the drawing-and-checks walkthrough grass tiles, the chest and the stone floor, looking at
// the 3x3 and the game view on the way. Last, it writes a blind review bundle. A stand-in cannot
// hand that to a fresh agent, so it replays the findings a real blind reviewer gave on this art
// (the review's findings): pinned as notes on the pixels,
// fixed, and the notes closed.
//
//   node examples/checks-agent.ts [--project <dir>] [--pause <ms>] [--linger <seconds>]

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const REPO = join(import.meta.dirname, '..');
const EXAMPLE = join(REPO, 'examples', 'mossy-ruins.pclaw');
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
const project = opt('--project', join(REPO, 'out', 'checks.pclaw'));
const pause = Number(opt('--pause', '1500'));
const linger = Number(opt('--linger', '0')) * 1000;
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
const client = new Client({ name: 'checks-agent', version: '1.0.0' });
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

console.log('0. The stage: the stone floor and the grass tiles and chest, rebuilt from their scripts');
for (const [asset, file] of [['stone_floor', 'stone_floor.pclaw'], ['grass', 'grass.pclaw'], ['grass_b', 'grass_b.pclaw'], ['grass_c', 'grass_c.pclaw'], ['chest', 'chest.pclaw']]) {
  await apply(asset!, file!, { quiet: true, wait: 0 });
}
console.log(indent(await call('check', {}), 2));

console.log('\n1. A test sprite with five deliberate defects');
await apply('glowcap', 'glowcap.pclaw');
console.log(indent(failing(await call('check', { asset: 'glowcap' })), 2));
console.log('  Fixing it by those coordinates:');
await apply('glowcap', 'glowcap_fix.pclaw');
console.log(indent((await call('check', { asset: 'glowcap' })).split('\n')[0]!, 2));
console.log(indent((await call('view', { asset: 'glowcap', mode: 'game' })).split('\n').at(-1)!, 2));

for (const [asset, look] of [['chest', 'game'], ['grass', 'tile3x3'], ['grass_b', 'tile3x3'], ['grass_c', 'tile3x3'], ['stone_floor', 'tile3x3']] as const) {
  console.log(`\n2. ${asset}`);
  console.log(indent(failing(await call('check', { asset })), 2));
  await apply(asset, `${asset}_fix.pclaw`);
  console.log(indent((await call('view', { asset, mode: look })).split('\n').at(-1)!, 2));
}

console.log('\n3. Every check, every asset');
console.log(indent(await call('check', {}), 2));

console.log('\n4. A blind review bundle, for a fresh reviewer with no other context');
console.log(indent(await call('review', { name: 'checks' }), 2));

console.log('\n5. The reviewer\'s findings, back as notes on the pixels; fixed; the notes closed');
for (const asset of ['glowcap', 'grass', 'grass_b', 'grass_c', 'stone_floor']) {
  console.log(`  ${asset}`);
  await apply(asset, `${asset}_review.pclaw`);
}
console.log(indent(await call('check', {}), 2));
console.log(indent((await call('view', { asset: 'glowcap', mode: 'game' })).split('\n').at(-1)!, 2));

console.log(`\nDone. The project is ${project}.${linger ? ` The server stops in ${linger / 1000} s (or press Ctrl-C).` : ''}`);
if (linger) await Promise.race([sleep(linger), new Promise((r) => process.once('SIGINT', r))]);
await client.close();
