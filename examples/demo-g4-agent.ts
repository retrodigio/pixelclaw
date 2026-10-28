// A stand-in for the agent in the G4 demo (examples/demo-g4.md). It starts `pixelclaw serve` over
// stdio exactly as Claude Code would, gives you the watch link, and draws with the G4 toolkit:
// a seamless grass tile (noise, scatter of stamps, a macro) with two variants (forks that call the
// macro with other seeds), and a 24x24 chest sprite (palette edits and lock, shading, symmetry,
// a layer, the lock detail, an outline). After each piece it looks at the result in context and
// prints the grid view, the exact pixels, to check.
//
//   node examples/demo-g4-agent.ts [--project <dir>] [--pause <ms>] [--linger <seconds>]

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const REPO = join(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
const project = opt('--project', join(REPO, 'out', 'demo-g4.pclaw'));
const pause = Number(opt('--pause', '1500'));
const linger = Number(opt('--linger', '0')) * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (existsSync(join(project, 'project.json'))) rmSync(project, { recursive: true, force: true });

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(REPO, 'cli', 'bin', 'pixelclaw.js'), 'serve', '--project', project],
  stderr: 'pipe',
});
(transport.stderr as PassThrough).resume();
const client = new Client({ name: 'demo-g4-agent', version: '1.0.0' });
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

async function draw(asset: string, file: string): Promise<void> {
  for (const s of sections(file)) {
    const out = await call('run', { asset, commands: s });
    console.log(`  ${out.split('\n')[0]}`);
    await sleep(pause);
  }
}

/** The legend of a grid view: colour → pixel count. */
const mix = (grid: string) => Object.fromEntries([...grid.matchAll(/^ {2}\S {2}(\S+)\s+#[0-9a-f]{6}\s+(\d+) px$/gm)].map((m) => [m[1]!, Number(m[2])]));

const info = await call('project', { palettes: [join(REPO, 'examples', 'src', 'mossy-ruins.json')] });
const url = /watch live: (\S+)/.exec(info)![1]!;
console.log(`Watch the agent draw:\n\n  ${url}\n`);
await sleep(pause * 2);

console.log('1. The grass tile');
await draw('grass', 'grass.pclaw');
console.log(`  ${(await call('view', { asset: 'grass', mode: 'tile3x3' })).split('\n').at(-1)}`);
const grass = await call('view', { asset: 'grass', mode: 'grid' });
console.log(grass.split('\n').slice(0, 28).map((l) => `    ${l}`).join('\n'));

console.log('\n2. Two variants: forks of the tape before the texture, the same macro with other seeds');
for (const [v, file] of [['grass_b', 'grass_b.pclaw'], ['grass_c', 'grass_c.pclaw']]) await draw(v!, file!);
const mixes = await Promise.all(['grass', 'grass_b', 'grass_c'].map(async (a) => [a, mix(await call('view', { asset: a, mode: 'grid' }))] as const));
const colours = [...new Set(mixes.flatMap(([, m]) => Object.keys(m)))];
console.log(`    ${'colour'.padEnd(8)}${mixes.map(([a]) => a.padStart(9)).join('')}`);
for (const c of colours) console.log(`    ${c.padEnd(8)}${mixes.map(([, m]) => String(m[c] ?? 0).padStart(9)).join('')}`);
for (const v of ['grass_b', 'grass_c']) console.log(`  ${(await call('view', { asset: v, mode: 'tile3x3' })).split('\n').at(-1)}`);

console.log('\n3. The chest');
await draw('chest', 'chest.pclaw');
console.log(`  ${(await call('view', { asset: 'chest', mode: 'render' })).split('\n').at(-1)}`);
const chest = await call('view', { asset: 'chest', mode: 'grid' });
console.log(chest.split('\n').map((l) => `    ${l}`).join('\n'));

console.log(`Done. The project is ${project}.${linger ? ` The server stops in ${linger / 1000} s (or press Ctrl-C).` : ''}`);
if (linger) await Promise.race([sleep(linger), new Promise((r) => process.once('SIGINT', r))]);
await client.close();
