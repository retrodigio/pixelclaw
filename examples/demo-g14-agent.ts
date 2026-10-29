// A stand-in for the agent in the G14 demo (examples/demo-g14.md), through `pixelclaw serve` over
// stdio as Claude does:
//   1. Fern Ledge (examples/demo-g13's map, rebuilt by its stand-in): the floor passes every
//      per-tile check but shows a lattice of pebbles; the new map-scale `lattice` check fails it,
//      says where, and what to do; two more looks of the stream bed (forked, the pebble moved or
//      left out) and `tiles floor fill mix=` pass it.
//   2. The 48 px set (examples/ember-moor.pclaw): its grid, its map at 1x and a screen of it.
//
//   node examples/demo-g14-agent.ts [--project <dir>]

import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const REPO = join(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
const project = opt('--project', join(REPO, 'out', 'demo-g14.pclaw'));
const moor = join(REPO, 'out', 'demo-g14-moor.pclaw');

// Fern Ledge as examples/demo-g13 left it (its stand-in, run quietly).
execFileSync(process.execPath, [join(REPO, 'examples', 'demo-g13-agent.ts'), '--project', project, '--keep'], { stdio: 'ignore' });
// A copy as it stands, for the screenshots of the lattice before the fix.
const before = `${project.replace(/\.pclaw$/, '')}-before.pclaw`;
if (existsSync(before)) rmSync(before, { recursive: true, force: true });
cpSync(project, before, { recursive: true });
if (existsSync(moor)) rmSync(moor, { recursive: true, force: true });
cpSync(join(REPO, 'examples', 'ember-moor.pclaw'), moor, { recursive: true });

async function connect(dir: string): Promise<Client> {
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(REPO, 'cli', 'bin', 'pixelclaw.js'), 'serve', '--project', dir], stderr: 'pipe' });
  (transport.stderr as PassThrough).resume();
  const c = new Client({ name: 'demo-g14-agent', version: '1.0.0' });
  await c.connect(transport);
  return c;
}
type Content = { type: string; text?: string }[];
let client = await connect(project);
async function call(name: string, a: Record<string, unknown>): Promise<string> {
  const r = (await client.callTool({ name, arguments: a })) as { content: Content; isError?: boolean };
  const text = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  if (r.isError) throw new Error(text);
  return text;
}
const indent = (s: string, n = 4) => s.split('\n').map((l) => ' '.repeat(n) + l).join('\n');
const pick = (s: string, re: RegExp) => s.split('\n').filter((l) => re.test(l)).join('\n');
/** Keep a copy of a view's image under the name given (the next view of the asset overwrites the file). */
const keep = (text: string, dir: string, name: string) => copyFileSync(/saved (\S+\.png)/.exec(text)![1]!, join(dir, 'views', `${name}.png`));
const checkLine = (s: string, id: string) => pick(s, new RegExp(`^\\s*[✓✗]\\s+${id}\\b`)).trim();

console.log(`G14: map-scale variety and 48 px. Projects: ${relative(REPO, project)} (Fern Ledge), ${relative(REPO, moor)} (Ember Moor)\n`);

// --- 1. Fern Ledge's floor: a lattice the per-tile checks cannot see.
console.log('1. Fern Ledge as G13 left it: every tile passes, the map shows a lattice of pebbles');
console.log(indent(pick(await call('check', { asset: 'bed' }), /^bed:/)));
const lat0 = await call('check', { asset: 'fern_ledge', checks: ['repetition', 'lattice'] });
console.log(indent(checkLine(lat0, 'repetition')));
console.log(indent(checkLine(lat0, 'lattice')));
const cells = pick(lat0, /comes back on the tile pitch: \d+,\d+/).split(': ').pop()!.trim().split(' ');
console.log(indent(`the cells it flags (view map marks="failing" outlines them): ${cells.length}, ${cells.slice(0, 8).join(' ')} …`));
keep(await call('view', { asset: 'fern_ledge', mode: 'map', region: '0,0 12x8', marks: 'failing' }), project, 'g14-fern-before');
console.log('');

console.log('   Two more looks of the stream bed, forked from it (its border stays the bed\'s):');
console.log('   bed_c with the pebble moved, bed_d with none; then the floor laid again as a mix');
const erase = 'paint 6,9 <<\n  ggg\n  ggg\n>>';
for (const [name, extra] of [['bed_c', 'rect 12,12 3x2 c=stone3 fill\npx 12,12 c=stone4\npx 14,13 c=stone2'], ['bed_d', '']] as const) {
  const r = await call('run', { asset: name, commands: `fork bed ${name}\nvariant of=bed\n${erase}${extra ? `\n${extra}` : ''}` });
  console.log(indent(`${name}: ${pick(r, /^checks:/).replace(/^checks: /, '')}`, 5));
}
const mix = await call('run', { asset: 'fern_ledge', commands: 'tiles floor fill mix=bed:1,bed_b:2,bed_c:1,bed_d:1 replace' });
console.log(indent(pick(mix, /tiles floor fill mix/).replace(/^#\d+ \S+ \S+\s+/, ''), 5));
const after = await call('check', { asset: 'fern_ledge', checks: ['seam', 'repetition', 'lattice', 'coverage', 'footprint', 'draworder'] });
console.log(indent(checkLine(after, 'lattice'), 5));
console.log(indent(pick(after, /^fern_ledge:/), 5));
keep(await call('view', { asset: 'fern_ledge', mode: 'map', region: '0,0 12x8' }), project, 'g14-fern-after');
// The glade's ground is the trail family's outside (the bed, pebble and all): two more trail
// variants that inherit its band, their outside the new looks of the bed; the map picks among them.
console.log('   The glade: its ground is the trail\'s outside (the bed\'s look); two more trail variants');
console.log('   (band=inherit, outside from bed_c and bed_d) and the map mixes them cell by cell');
console.log(indent(checkLine(await call('check', { asset: 'glade', checks: ['lattice'] }), 'lattice').replace(/; give .*/, ''), 5));
for (const [name, from] of [['trail_c', 'bed_c'], ['trail_d', 'bed_d']] as const) {
  await call('run', { asset: name, commands: `fork trail ${name}\nvariant of=trail band=inherit\nlayer ground\nfamily texture outside from=${from}` });
}
console.log(indent(checkLine(await call('check', { asset: 'glade', checks: ['lattice'] }), 'lattice'), 5));
console.log(indent(pick(await call('check', { asset: 'glade' }), /^glade:/), 5));
console.log('');
await client.close();

// --- 2. The 48 px set.
client = await connect(moor);
console.log('2. Ember Moor, 48 px (examples/ember-moor.pclaw): the project\'s grid and what follows from it');
console.log(indent(pick(await call('project', {}), /^grid /)));
console.log(indent((await call('check', {})).split('\n').map((l) => l.replace(/ {2}\(.*$/, '')).join('\n')));
const whole = await call('view', { asset: 'moor_map', mode: 'map' });
keep(whole, moor, 'g14-moor-map');
console.log(indent(pick(whole, /^moor_map: a map|^showing/)));
const cam = await call('view', { asset: 'moor_map', mode: 'map', camera: '10,6' });
keep(cam, moor, 'g14-moor-camera');
keep(await call('view', { asset: 'pool', mode: 'map', seed: 2 }), moor, 'g14-pool-island');
console.log(indent(pick(cam, /^showing/)));
console.log(indent(pick(await call('view', { asset: 'waystone', mode: 'game' }), /^game:/).replace(/, saved .*/, ' (the scene once: the draw scale is 1)')));
await client.close();
console.log(`\n(the projects are in ${relative(REPO, project)} and ${relative(REPO, moor)})`);
