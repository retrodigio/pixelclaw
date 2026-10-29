// A stand-in for the people and the agent in the G15 demo (examples/demo-g15.md):
//   1. Requests filed from the CLI (`pixelclaw request … draw|add`, and the list).
//   2. The worker: `pixelclaw work` runs the real Claude Code with the worker's command line against
//      a stand-in model (a local fake of the model API, so nothing is spent and no account is used;
//      without `claude` installed, the fake `claude` of the tests stands in instead). The model draws
//      each request without an outline, has `work done` refused while the outline check fails,
//      outlines it and finishes; then asks for a shell and a file, which Claude Code refuses.
//   3. A terrain map through MCP (`pixelclaw serve` over stdio, as Claude drives it): a meadow
//      running off every edge round a pond, first with G14's rules (a band along the map's border,
//      one inside tile everywhere), then with G15's (no band along the border, the inside a mix).
//
//   node examples/demo-g15-agent.ts [--project <dir>]

import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fakeModelEnv, startFakeModel } from '../server/test/fake-model-api.ts';

const REPO = join(import.meta.dirname, '..');
const BIN = join(REPO, 'cli', 'bin', 'pixelclaw.js');
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
const project = opt('--project', join(REPO, 'out', 'demo-g15.pclaw'));
const indent = (s: string, n = 4) => s.trimEnd().split('\n').map((l) => ' '.repeat(n) + l).join('\n');
const pc = (...a: string[]) => {
  const r = spawnSync(process.execPath, [BIN, ...a], { encoding: 'utf8' });
  return (r.stdout + r.stderr).trimEnd();
};
const show = (a: string[]) => { console.log(indent(`$ pixelclaw ${a.map((x) => (/[\s"]/.test(x) ? JSON.stringify(x) : x)).join(' ').replace(project, relative(REPO, project))}`)); console.log(indent(pc(...a), 6)); };

if (existsSync(project)) rmSync(project, { recursive: true, force: true });
pc('new', project, '--palette', join(REPO, 'examples', 'src', 'mossy-ruins.json'), '--name', 'reed-hollow');
const manifest = {
  format: 'pixelclaw-manifest', version: 1, theme: 'A reedy hollow round a still pond, lit from the top left.',
  sets: { ground: { description: 'meadow and water' }, props: { description: 'things by the pond' } },
  assets: [
    { name: 'meadow', kind: 'tile', size: '24x24', set: 'ground', description: 'short grass' },
    { name: 'urn', kind: 'sprite', size: '16x16', set: 'props', height: 12, description: 'a squat stone urn' },
    { name: 'post', kind: 'sprite', size: '16x16', set: 'props', height: 12, description: 'a mooring post' },
  ],
};
const tmp = mkdtempSync(join(tmpdir(), 'demo-g15-'));
writeFileSync(join(tmp, 'manifest.json'), JSON.stringify(manifest));
pc('plan', project, '--manifest', join(tmp, 'manifest.json'));

console.log(`G15: the worker, requests and maps. Project: ${relative(REPO, project)}\n`);

// --- 1. Requests from the CLI.
console.log('1. Requests filed from the CLI, checked as the dashboard checks them');
show(['request', project, 'draw', 'urn', '--note', 'squat, with a lip', '--by', 'human:chris']);
show(['request', project, 'add', 'lantern', '--kind', 'sprite', '--size', '16x16', '--set', 'props', '--description', 'an iron lantern on a hook', '--height', '12', '--by', 'human:chris']);
show(['request', project, 'draw', 'well', '--by', 'human:chris']);
show(['request', project]);

// --- 2. The worker, with a stand-in model.
console.log('\n2. The worker (`pixelclaw work`), with a stand-in model');
const hasClaude = spawnSync('claude', ['--version'], { encoding: 'utf8' }).status === 0;
const pj = JSON.parse(readFileSync(join(project, 'project.json'), 'utf8'));
let model: Awaited<ReturnType<typeof startFakeModel>> | null = null;
let env: Record<string, string> = {};
if (hasClaude) {
  // The model's side: take each request, draw it without an outline, try to finish, outline it when
  // done is refused, finish; then try a shell and a file outside the project; then stop.
  const shapes = ['ellipse 3,3 10x10', 'ellipse 4,2 8x12', 'rect 5,2 6x12'];
  let drawn = 0;
  model = await startFakeModel((results) => {
    const last = results.at(-1) ?? '';
    const req = [...results].reverse().find((r) => /claimed r\d+/.test(r));
    const m = req ? /claimed (r\d+)\n\1 (?:draw|new asset) ([a-z][a-z0-9_-]*)/.exec(req) : null;
    if (!results.length || /: done\. /.test(last) || /No open requests left/.test(last)) return ['mcp__pixelclaw__work', {}];
    if (results.some((r) => /no open requests/.test(r))) {
      if (!results.some((r) => /No such tool available: Bash/.test(r))) return ['Bash', { command: 'find / -maxdepth 1', description: 'look around' }];
      if (!results.some((r) => /No such tool available: Read/.test(r))) return ['Read', { file_path: join(REPO, 'package.json') }];
      return null;
    }
    if (/^claimed r\d+/.test(last) && m) return ['mcp__pixelclaw__run', { asset: m[2], commands: `new sprite ${m[2]}\n${shapes[drawn++ % 3]} c=stone3 fill` }];
    if (/applied \d+ commands? as group/.test(last) && /is not done/.test(results.at(-3) ?? '')) return ['mcp__pixelclaw__work', { action: 'done', text: `drew ${m?.[2]}, outlined` }];
    if (/applied \d+ commands? as group/.test(last)) return ['mcp__pixelclaw__work', { action: 'done', text: `drew ${m?.[2]}` }];
    if (/is not done: .* fails/.test(last)) return ['mcp__pixelclaw__run', { asset: m?.[2], commands: 'outline c=ink' }];
    return null;
  });
  const home = join(tmp, 'home');
  mkdirSync(home);
  env = fakeModelEnv(model.url, home);
  pj.worker = { enabled: true, cap: 2 };
  console.log('    (the real Claude Code, its model a local stand-in; worker: { "enabled": true, "cap": 2 })');
} else {
  pj.worker = { enabled: true, cap: 2, command: [process.execPath, join(REPO, 'server', 'test', 'fake-claude.ts'), '--fake-mode', 'fix', '--fake-cost', '0.3'] };
  console.log('    (Claude Code is not installed here: the tests\' fake `claude` stands in, in its fix mode)');
}
writeFileSync(join(project, 'project.json'), JSON.stringify(pj, null, 2) + '\n');
// Not spawnSync: the stand-in model answers from this process, so it must keep running.
const workErr = await new Promise<string>((resolve) => {
  const c = spawn(process.execPath, [BIN, 'work', project], { env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  c.stderr.on('data', (d) => { err += d; });
  c.on('close', () => resolve(err));
});
console.log(indent(`$ pixelclaw work ${relative(REPO, project)}`));
console.log(indent(workErr.split('\n').filter((l) => /worker stopped/.test(l)).join('\n'), 6));
await model?.close();
const log = readFileSync(join(project, 'logs', 'worker.log'), 'utf8').split('\n').map((l) => l.replace(/^\S+ /, ''));
const keepLine = (l: string) => /^(run started|session \d|session started|→ (work|run|Bash|Read)|← error|run stopped|watchdog)/.test(l);
console.log('    logs/worker.log:');
console.log(indent(log.filter(keepLine).map((l) => (l.length > 190 ? `${l.slice(0, 189)}…` : l)).join('\n'), 6));
console.log('    worker-spend.jsonl:');
console.log(indent(readFileSync(join(project, 'worker-spend.jsonl'), 'utf8'), 6));
show(['request', project]);
show(['check', project, 'urn', 'lantern', '--checks', 'outline']);
// A setting that would hand the worker a shell is refused before anything runs.
pj.worker = { ...pj.worker, args: ['--allowedTools', 'Bash'] };
writeFileSync(join(project, 'project.json'), JSON.stringify(pj, null, 2) + '\n');
show(['work', project]);
delete pj.worker.args;
pj.worker.enabled = false;
writeFileSync(join(project, 'project.json'), JSON.stringify(pj, null, 2) + '\n');

// --- 3. A terrain map: a clean border and a mixed inside.
console.log('\n3. A terrain map through MCP: a meadow running off every edge round a pond');
const transport = new StdioClientTransport({ command: process.execPath, args: [BIN, 'serve', '--project', project], stderr: 'pipe' });
(transport.stderr as PassThrough).resume();
const client = new Client({ name: 'demo-g15-agent', version: '1.0.0' });
await client.connect(transport);
type Content = { type: string; text?: string }[];
async function call(name: string, a: Record<string, unknown>): Promise<string> {
  const r = (await client.callTool({ name, arguments: a })) as { content: Content; isError?: boolean };
  const text = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  if (r.isError) throw new Error(text);
  return text;
}
const pick = (s: string, re: RegExp) => s.split('\n').filter((l) => re.test(l)).join('\n');
const checkLine = (s: string, id: string) => pick(s, new RegExp(`^\\s*[✓✗]\\s+${id}\\b`)).trim();
const keep = (text: string, name: string) => copyFileSync(/saved (\S+\.png)/.exec(text)![1]!, join(project, 'views', `${name}.png`));
try {
  // The meadow, a look forked from it (border kept, inside changed), clover (another fork), the water, and the bank between them.
  const steps: [string, string][] = [
    ['meadow', 'new tile meadow 24x24 bg=moss1\nnoise ramp=moss weights=0,6,3,1,0 density=0.3 seed=11\nstamp save tuft <<\n  .c.\n  cdc\n>>\nstamp tuft 9,11'],
    ['meadow_b', 'fork meadow meadow_b\nvariant of=meadow\nrect 3,3 18x18 c=moss1 fill\nnoise 3,3 18x18 ramp=moss weights=0,6,3,1,0 density=0.3 seed=12\nstamp tuft 15,5'],
    ['clover', 'fork meadow clover\nrect 3,3 18x18 c=moss1 fill\nnoise 3,3 18x18 ramp=moss weights=0,6,3,1,0 density=0.3 seed=13\npx 7,8 12,15 17,9 c=lichen'],
    ['pondwater', 'new tile pondwater 24x24 bg=pool\nnoise ramp=stone weights=0,0,1,0,0,0 density=0.04 base=pool seed=5'],
    ['bank', 'new family bank 24x24 scheme=blob47\nfamily texture inside from=meadow\nfamily texture outside from=pondwater\nfamily band 1:outside 1:soil0 2:soil1 radius=3'],
  ];
  for (const [asset, commands] of steps) await call('run', { asset, commands });
  // The land runs off every edge; a pond in the middle.
  await call('run', { asset: 'hollow', commands: 'new map hollow 16x10 tile=24\nlayer add land terrain=bank outside=on border=not above=floor\nterrain land rect 0,0 16x10\nterrain land ellipse 6,3 4x3 erase' });
  console.log('   With G14\'s rules (`border=not`, the family\'s own inside): a bank runs round the map\'s edge, and one meadow tile fills the land');
  const before = await call('check', { asset: 'hollow', checks: ['seam', 'repetition', 'lattice'] });
  for (const id of ['seam', 'repetition', 'lattice']) console.log(indent(checkLine(before, id)));
  keep(await call('view', { asset: 'hollow', mode: 'map' }), 'g15-hollow-before');
  const after = await call('run', { asset: 'hollow', commands: 'layer set land border=same mix=meadow:2,clover:1 seed=3' });
  console.log('   G15: past the map\'s edge the land goes on (border=same, the default now), and the inside is a mix of meadow, its fork and clover');
  console.log(indent(pick(after, /layer set land/).trim()));
  const fixed = await call('check', { asset: 'hollow', checks: ['seam', 'repetition', 'lattice'] });
  for (const id of ['seam', 'repetition', 'lattice']) console.log(indent(checkLine(fixed, id)));
  console.log(indent(pick(await call('view', { asset: 'hollow', mode: 'map' }), /^layer land/)));
  keep(await call('view', { asset: 'hollow', mode: 'map' }), 'g15-hollow-after');
  // The bank's inside came from the meadow: fix the meadow, and the bank follows.
  const fix = await call('run', { asset: 'meadow', commands: 'stamp tuft 3,17' });
  console.log('   The meadow gains a tuft; the bank, whose inside was copied from it, follows:');
  console.log(indent(pick(fix, /brought up to date/).trim()));
  console.log(indent(pick(await call('history', { asset: 'bank', last: 1 }), /family texture/).split('<<')[0]!.trim()));
}
finally {
  await client.close();
}
rmSync(tmp, { recursive: true, force: true });
