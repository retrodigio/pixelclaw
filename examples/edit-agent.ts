// A stand-in for the agent in the watch-and-edit walkthrough demo (examples/watch-and-edit.md). It starts `pixelclaw serve` over
// stdio exactly as Claude Code would, draws the mossy-ruins stone floor, and gives you the watch
// link. You fix three pixels in the page and leave a note; the script then calls `changes`, prints
// what came back (your lines, your note, the diff image's path) and carries on from them: it does
// what the note asks along the region it marks, closes the note, and looks at the tile again.
//
//   node examples/edit-agent.ts [--project <dir>] [--simulate] [--linger <seconds>]
//
// --simulate plays the person too (over the page's WebSocket, as human:demo), so the whole demo
// runs without a browser.

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const REPO = join(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
const project = opt('--project', join(REPO, 'out', 'edit.pclaw'));
const simulate = args.includes('--simulate');
const linger = Number(opt('--linger', simulate ? '0' : '120')) * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (existsSync(join(project, 'project.json'))) rmSync(project, { recursive: true, force: true });

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(REPO, 'cli', 'bin', 'pixelclaw.js'), 'serve', '--project', project],
  stderr: 'pipe',
});
(transport.stderr as PassThrough).resume();
const client = new Client({ name: 'edit-agent', version: '1.0.0' });
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
await call('run', { asset: 'stone_floor', commands: readFileSync(join(REPO, 'examples', 'scripts', 'stone_floor.pclaw'), 'utf8') });
console.log((await call('view', { asset: 'stone_floor', mode: 'render' })).split('\n').at(-1));
console.log(`\nThe agent drew the stone floor. Open the watch view:\n\n  ${url}\n`);

if (simulate) {
  // The person, through the page's WebSocket: three pixels of moss along the joint, then a note.
  const ws = new WebSocket(url.replace('http', 'ws').replace('/?token', '/ws?token'));
  await new Promise((r) => { ws.onopen = r; });
  let id = 0;
  const send = (commands: string) => new Promise<void>((resolve, reject) => {
    const my = ++id;
    ws.addEventListener('message', function on(ev) {
      const m = JSON.parse(String(ev.data)) as { type: string; id?: number; ok?: boolean; errors?: unknown };
      if (m.type !== 'result' || m.id !== my) return;
      ws.removeEventListener('message', on);
      if (m.ok) resolve(); else reject(new Error(JSON.stringify(m.errors)));
    });
    ws.send(JSON.stringify({ type: 'run', id: my, asset: 'stone_floor', commands, by: 'human:demo' }));
  });
  for (const x of [12, 13, 14]) {
    await send(`stroke pencil c=moss1 pp=on ${x},8`);
    console.log(`(the person) clicks ${x},8 with the pencil in moss1`);
  }
  await send('note 9,8 3x1 "carry the moss on along this joint, a shade darker (moss0)"');
  console.log('(the person) pins a note on 9,8 3x1');
  ws.close();
} else {
  console.log('In the page: pick moss1, click 12,8, 13,8 and 14,8 with the pencil (B), then press N,');
  console.log('drag over 9,8 to 11,8 and pin a note such as "carry the moss on along this joint, a shade darker (moss0)".');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question('\nPress Enter when you are done, and the agent reads your changes… ');
  rl.close();
}

// The agent reads what changed.
const changes = await call('changes', {});
console.log(`\n--- changes ---\n${changes}\n---------------\n`);
console.log(`a second call: ${await call('changes', {})}`);

// …and carries on from it: for each new note on a region, do what it says there (in this stand-in,
// fill the region with the darker moss), then close the note.
const notes = [...changes.matchAll(/^ {2}(n\d+) at (\d+),(\d+)(?: (\d+)x(\d+))?: .*\(new\)$/gm)];
for (const [, id, x, y, w, h] of notes) {
  const out = await call('run', { asset: 'stone_floor', commands: `rect ${x},${y} ${w ?? 1}x${h ?? 1} c=moss0 fill\nnote done ${id}`, view: 'render' });
  console.log(`the agent: ${out.split('\n')[0]}`);
  console.log(out.split('\n').filter((l) => /^#\d+ /.test(l)).join('\n'));
}
console.log((await call('view', { asset: 'stone_floor', mode: 'tile3x3' })).split('\n').at(-1));
console.log(`\nDone.${linger ? ` The server stops in ${linger / 1000} s (or press Ctrl-C).` : ''}`);
if (linger) await Promise.race([sleep(linger), new Promise((r) => process.once('SIGINT', r))]);
await client.close();
