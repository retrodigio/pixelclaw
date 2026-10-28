// A stand-in for the agent in the G2 demo (examples/demo-g2.md): it starts `pixelclaw serve`
// over stdio exactly as Claude Code would, prints the watch link, waits for you to open it, and
// then draws the mossy-ruins stone floor tile in batches through the MCP tools, looking at the
// result between batches.
//
//   node examples/demo-g2-agent.ts [--project <dir>] [--pause <seconds>] [--linger <seconds>] [--no-wait]

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const REPO = join(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
const project = opt('--project', join(REPO, 'out', 'demo-g2.pclaw'));
const pause = Number(opt('--pause', '2')) * 1000;
const linger = Number(opt('--linger', '120')) * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Start again each time, so the tile is drawn from nothing.
if (existsSync(join(project, 'project.json'))) rmSync(project, { recursive: true, force: true });

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(REPO, 'cli', 'bin', 'pixelclaw.js'), 'serve', '--project', project],
  stderr: 'pipe',
});
// The server logs to stderr; this script prints the link itself.
(transport.stderr as PassThrough).resume();
const client = new Client({ name: 'demo-g2-agent', version: '1.0.0' });
await client.connect(transport);

type Content = { type: string; text?: string }[];
async function call(name: string, a: Record<string, unknown>): Promise<string> {
  const r = (await client.callTool({ name, arguments: a })) as { content: Content; isError?: boolean };
  const text = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  if (r.isError) throw new Error(text);
  return text;
}

const info = await call('project', { palettes: [join(REPO, 'examples', 'src', 'mossy-ruins.json')] });
const url = /watch live: (\S+)/.exec(info)![1]!;
console.log(`\nOpen the watch view:\n\n  ${url}\n`);
if (!args.includes('--no-wait')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question('Press Enter when the page is open, and the agent starts drawing… ');
  rl.close();
}

// The G1 script, one section (a "# ---" heading) per batch, as an agent would send it.
const script = readFileSync(join(REPO, 'examples', 'scripts', 'stone_floor.pclaw'), 'utf8');
const sections = script.split(/\n(?=# --- )/).map((s) => s.trim());
for (const [i, batch] of sections.entries()) {
  const title = batch.startsWith('# --- ') ? batch.split('\n')[0]!.slice(6) : 'a new 24x24 tile';
  const out = await call('run', { asset: 'stone_floor', commands: batch, ...(i === 1 || i === sections.length - 1 ? { view: 'render' } : {}) });
  console.log(`batch ${i + 1}/${sections.length} (${title}): ${out.split('\n')[0]}`);
  await sleep(pause);
}
console.log((await call('view', { asset: 'stone_floor', mode: 'tile3x3' })).split('\n').at(-1));
console.log(`\nDone. The server stops in ${linger / 1000} s (or press Ctrl-C).`);
await Promise.race([sleep(linger), new Promise((r) => process.once('SIGINT', r))]);
await client.close();
