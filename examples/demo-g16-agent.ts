// A stand-in for the agent in the G16 demo (examples/demo-g16.md), through `pixelclaw serve` over
// stdio as Claude does, on a new 48 px project "Saltmere Heath" (Ember Moor's palette):
//   1. a shingle and a grass floor from the structure generators (pebbles, tufts): each a base and
//      two looks with the same edges= and their own seed, ranked by `seeds`; laid on a map as mixes;
//   2. a cliff plateau (the face scheme): south faces, side faces, inner corners and corners;
//   3. a lane (the lane scheme) three cells wide in one place, turning diagonally in others;
//   4. standing stones that cast shadows on the ground (the style guide's style.shadow);
//   5. each new check catching a planted fault: a floating lamp room (pieces), a crab cut by its
//      canvas (margin), the beacon's glint used on a pebble (palette, style.reserved); then fixed.
//
//   node examples/demo-g16-agent.ts [--project <dir>]

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const REPO = join(import.meta.dirname, '..');
const BIN = join(REPO, 'cli', 'bin', 'pixelclaw.js');
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
const project = opt('--project', join(REPO, 'out', 'demo-g16.pclaw'));

if (existsSync(project)) rmSync(project, { recursive: true, force: true });
mkdirSync(join(REPO, 'out'), { recursive: true });
execFileSync(process.execPath, [BIN, 'new', project, '--name', 'saltmere-heath', '--palette', join(REPO, 'examples', 'ember-moor.pclaw', 'palettes', 'ember-moor.json'), '--grid', '48'], { stdio: 'ignore' });
// The style guide: light from the north-west, objects' shadows a step down the ground's ramps, the
// glint kept for the beacon's lamp.
const pj = JSON.parse(readFileSync(join(project, 'project.json'), 'utf8'));
pj.style = { ground: 'grass', outline: ['ink'], light: 'nw', shadow: { c: 'darker' }, reserved: { glint: ['beacon'] } };
writeFileSync(join(project, 'project.json'), JSON.stringify(pj, null, 2) + '\n');
mkdirSync(join(project, 'views'), { recursive: true });

const transport = new StdioClientTransport({ command: process.execPath, args: [BIN, 'serve', '--project', project], stderr: 'pipe' });
(transport.stderr as PassThrough).resume();
const client = new Client({ name: 'demo-g16-agent', version: '1.0.0' });
await client.connect(transport);
type Content = { type: string; text?: string }[];
async function call(name: string, a: Record<string, unknown>): Promise<string> {
  const r = (await client.callTool({ name, arguments: a })) as { content: Content; isError?: boolean };
  const text = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  if (r.isError) throw new Error(text);
  return text;
}
const run = (asset: string, commands: string) => call('run', { asset, commands });
const indent = (s: string, n = 4) => s.split('\n').map((l) => ' '.repeat(n) + l).join('\n');
const pick = (s: string, re: RegExp) => s.split('\n').filter((l) => re.test(l)).join('\n');
const summary = (s: string) => pick(s, /^\s*checks:/).trim().replace(/^checks: /, '');
const checkLine = (s: string, id: string) => pick(s, new RegExp(`^\\s*[✓✗]\\s+${id}\\b`)).trim();
/** Keep a copy of a view's image (the next view of the asset overwrites the file). */
const keep = (text: string, name: string) => copyFileSync(/saved (\S+\.png)/.exec(text)![1]!, join(project, 'views', `${name}.png`));

console.log(`G16: art help. Project: ${relative(REPO, project)} (48 px, Ember Moor's palette; style: light nw, shadow darker, glint reserved for the beacon)\n`);

// --- 1. Structured floors from the generators.
console.log('1. A shingle and a grass floor from the generators, each a base and two looks');
const looks = async (base: string, ground: string, gen: string) => {
  await run(base, `new tile ${base} 48x48 ${ground.split('\n')[0]}\n${ground.split('\n').slice(1).join('\n')}`);
  await call('seeds', { asset: base, line: gen, count: 6, apply: true });
  const line = pick(await call('history', { asset: base }), new RegExp(`^#\\d+ .*${gen.split(' ')[0]} `)).replace(/^#\d+ \S+ \S+\s+/, '').trim();
  console.log(indent(`${base}: ${line}`));
  const edges = /edges=(\d+)/.exec(line)![1]!;
  console.log(indent(`  ${pick(await call('check', { asset: base }), /^\S+: /)}`));
  for (const v of ['b', 'c']) {
    const name = `${base}_${v}`;
    await run(name, `fork ${base} ${name}\nvariant of=${base}\n${ground.split('\n').slice(1).join('\n')}`);
    await call('seeds', { asset: name, line: `${gen} edges=${edges}`, count: 6, from: v === 'b' ? 11 : 21, apply: true });
    const own = pick(await call('history', { asset: name }), new RegExp(`${gen.split(' ')[0]} .*edges=${edges}`)).split('\n').at(-1)!;
    console.log(indent(`${name}: … edges=${edges} ${/seed=\d+/.exec(own)![0]} · ${pick(await call('check', { asset: name }), /^\S+: /)}`));
  }
  keep(await call('view', { asset: base, mode: 'tile3x3' }), `g16-${base}-3x3`);
};
await looks('shingle', 'bg=peat1\nnoise ramp=peat weights=0,6,2,0 density=0.15 seed=5', 'pebbles ramp=stone');
await looks('grass', 'bg=moor2\nnoise ramp=moor weights=0,2,8,2,0 density=0.25 seed=109', 'tufts ramp=moor0,moor1,moor3,moor4');
console.log('');

// --- 2. A cliff plateau: the face scheme's faces, drawn on the band layer of its pieces.
console.log('2. A cliff plateau (scheme=face): south faces, side faces, inner corners, corners; grass on top, shingle below');
const rock = (cell: string, x: number, w: number, h: number, edges: string) => [
  `rect @cell(${cell}) ${x},0 ${w}x${h} c=stone2 fill`, `line @cell(${cell}) ${x},0 ${x + w - 1},0 c=stone3`, `line @cell(${cell}) ${x},1 ${x + w - 1},1 c=stone3`,
  `line @cell(${cell}) ${x},${h - 1} ${x + w - 1},${h - 1} c=ink`, `line @cell(${cell}) ${x},${h - 2} ${x + w - 1},${h - 2} c=stone1`,
  ...edges.split('').map((e) => (e === 'l' ? `line @cell(${cell}) ${x},0 ${x},${h - 1} c=ink` : `line @cell(${cell}) ${x + w - 1},0 ${x + w - 1},${h - 1} c=ink`)),
];
const cracks = (cell: string, x: number) => [`line @cell(${cell}) ${x + 9},4 ${x + 7},10 c=stone1`, `line @cell(${cell}) ${x + 7},10 ${x + 9},15 c=stone1`, `line @cell(${cell}) ${x + 30},6 ${x + 32},13 c=stone1`];
const cliff = await run('cliff', [
  'new family cliff 48x48 scheme=face', 'family texture inside from=grass', 'family texture outside from=shingle',
  'family band 2:outside 1:ink 2:moor1 jitter=2 seed=4', 'layer band',
  ...rock('face_o', 0, 48, 22, 'lr'), ...cracks('face_o', 0),
  ...rock('face_ew', 0, 48, 22, ''), ...cracks('face_ew', 0),
  ...rock('face_ie_iw', 0, 48, 22, ''), 'rect @cell(face_ie_iw) 0,0 4x22 c=stone1 fill', 'rect @cell(face_ie_iw) 44,0 4x22 c=stone1 fill',
  'rect @cell(side_e) 0,0 10x48 c=stone2 fill', 'rect @cell(side_e) 0,0 3x48 c=stone3 fill', 'line @cell(side_e) 10,0 10,47 c=ink', 'line @cell(side_e) 0,47 10,47 c=ink', 'line @cell(side_e) 0,0 10,0 c=ink',
  'rect @cell(side_e_ns) 0,0 10x48 c=stone2 fill', 'rect @cell(side_e_ns) 0,0 3x48 c=stone3 fill', 'line @cell(side_e_ns) 10,0 10,47 c=ink', 'line @cell(side_e_ns) 6,10 5,22 c=stone1',
  'rect @cell(side_w) 38,0 10x48 c=stone1 fill', 'line @cell(side_w) 37,0 37,47 c=ink', 'line @cell(side_w) 37,47 47,47 c=ink', 'line @cell(side_w) 37,0 47,0 c=ink',
  'rect @cell(side_w_ns) 38,0 10x48 c=stone1 fill', 'line @cell(side_w_ns) 37,0 37,47 c=ink', 'line @cell(side_w_ns) 42,14 43,28 c=stone0',
  ...rock('corner_ew', 0, 11, 22, 'r'), ...rock('corner_ew', 37, 11, 22, 'l'),
].join('\n'));
console.log(indent(`cliff: ${summary(cliff)}`));
console.log('');

// --- 3. A lane that widens and turns diagonally.
console.log('3. A lane (scheme=lane): three cells wide by the stones, diagonal turns elsewhere');
await run('dirt', 'new tile dirt 48x48 bg=peat2\nnoise ramp=peat weights=0,2,6,2 density=0.2 seed=7');
const lane = await run('lane', 'new family lane 48x48 scheme=lane\nfamily texture inside from=dirt\nfamily texture outside from=grass\nfamily band 1:outside 2:peat0 2:peat1');
console.log(indent(`${pick(await call('check', { asset: 'dirt' }), /^\S+: /)} (the lane's inside)`));
console.log(indent(`lane: ${summary(lane)}`));
console.log('');

// --- 4. Standing stones; the beacon (with its planted fault); a crab; a pebble pile.
console.log('4. Objects with shadows (style.shadow darker: an objects layer casts them on the ground)');
await run('stone', [
  'new object stone 48x96 cell=48x48', 'ellipse 12,30 24x62 c=stone2 fill', 'ellipse 14,34 12x52 c=stone3 fill', 'ellipse 16,38 4x30 c=stone4 fill',
  'ellipse 27,44 5x40 c=stone1 fill', 'outline c=ink', 'footprint 1x1 anchor=0,0 <<\n  r\n  b\n>>',
].join('\n'));
console.log(indent(pick(await call('check', { asset: 'stone' }), /^\S+: /)));
console.log('');

console.log('5. The new checks, each on a planted fault');
const beacon = await run('beacon', [
  'new object beacon 48x96 cell=48x48', 'rect 16,40 16x54 c=stone2 fill', 'rect 18,40 4x54 c=stone3 fill', 'rect 28,40 4x54 c=stone1 fill',
  // The lamp room, two pixels above the tower: floating.
  'rect 14,12 20x24 c=stone1 fill', 'rect 18,16 12x12 c=glint fill', 'rect 12,8 24x4 c=heath1 fill',
  'outline c=ink', 'footprint 1x1 anchor=0,0 <<\n  r\n  b\n>>',
].join('\n'));
console.log(indent(`beacon: ${summary(beacon)}`));
console.log(indent(checkLine(await call('check', { asset: 'beacon', checks: ['pieces'] }), 'pieces'), 6));
const fixed = await run('beacon', 'rect 16,36 16x4 c=stone2 fill\nrect 18,36 4x4 c=stone3 fill\nrect 28,36 4x4 c=stone1 fill');
console.log(indent(`the tower carried up to the lamp room (rows 36-39): ${summary(fixed)}`, 6));
await run('crab', 'new sprite crab 24x24');
const crabArt = (x: number) => [`ellipse ${x},9 15x11 c=heath2 fill`, `ellipse ${x + 2},10 8x5 c=heath3 fill`, 'outline c=ink'].join('\n');
const crab = await run('crab', crabArt(0));
console.log(indent(`crab: ${summary(crab)}`));
console.log(indent(checkLine(await call('check', { asset: 'crab', checks: ['margin'] }), 'margin'), 6));
const crabFixed = await run('crab', `undo\n${crabArt(5)}`);
console.log(indent(`drawn again 5 px to the right (undo, then the same lines from x=5): ${summary(crabFixed)}`, 6));
const pile = await run('pile', 'new sprite pile 24x24\nellipse 4,12 16x9 c=stone2 fill\nellipse 7,13 6x4 c=stone3 fill\npx 9,14 c=glint\noutline c=ink');
console.log(indent(`pile: ${summary(pile)}`));
console.log(indent(checkLine(await call('check', { asset: 'pile', checks: ['palette'] }), 'palette'), 6));
console.log(indent(`the glint taken out (stone4): ${summary(await run('pile', 'px 9,14 c=stone4'))}`, 6));
console.log('');

// --- The map: the floors, the plateau, the lane, the stones and the beacon with their shadows.
console.log('6. The heath: 20x12 cells of 48 px');
const map = await run('heath', [
  'new map heath 20x12',
  'tiles floor fill mix=shingle:1,shingle_b:1,shingle_c:1 0,0 10x9',
  'tiles floor fill mix=shingle:1,shingle_b:1,shingle_c:1 0,9 20x3',
  'tiles floor fill mix=grass:2,grass_b:1,grass_c:1',
  'layer add cliff terrain=cliff mix=grass:2,grass_b:1,grass_c:1 above=floor',
  'terrain cliff paint 2,1 <<\n  ###.###\n  #######\n  ##...##\n  ##....#\n  ##.....\n>>',
  'layer add road terrain=lane above=cliff',
  'terrain road paint 9,0 <<\n  ..#........\n  ...#.......\n  ....#......\n  .....#.###.\n  ......####.\n  .......###.\n  ........#..\n  .......#...\n  ......#....\n>>',
  'layer add stones objects above=road',
  'place stone 16,2 layer=stones', 'place stone 18,7 layer=stones', 'place stone 1,8 layer=stones', 'place beacon 13,9 layer=stones',
].join('\n'));
console.log(indent(pick(await call('history', { asset: 'heath' }), /layer add stones/).replace(/^#\d+ \S+ \S+\s+/, '').trim()));
const checked = await call('check', { asset: 'heath' });
for (const id of ['seam', 'repetition', 'lattice', 'footprint', 'draworder', 'coverage']) if (checkLine(checked, id)) console.log(indent(checkLine(checked, id).replace(/\s{2,}/g, '  ')));
const whole = await call('view', { asset: 'heath', mode: 'map' });
keep(whole, 'g16-heath');
keep(await call('view', { asset: 'heath', mode: 'map', region: '0,0 9x7' }), 'g16-plateau');
keep(await call('view', { asset: 'heath', mode: 'map', region: '9,0 11x9' }), 'g16-lane');
keep(await call('view', { asset: 'heath', mode: 'map', region: '12,5 8x7' }), 'g16-shadows');
keep(await call('view', { asset: 'beacon', mode: 'render' }), 'g16-beacon');
console.log('');
console.log('7. Every asset');
console.log(indent((await call('check', {})).split('\n').filter((l) => /^\S+: /.test(l)).map((l) => l.replace(/ {2}\(.*$/, '')).join('\n')));
await client.close();
console.log(`\n(the project is in ${relative(REPO, project)}; views in ${relative(REPO, join(project, 'views'))})`);
