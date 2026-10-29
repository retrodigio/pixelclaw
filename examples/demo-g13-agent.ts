// A stand-in for the agent in the G13 demo (examples/demo-g13.md): a small original set, Fern
// Ledge (a mossy ledge over a stream bed), drawn through `pixelclaw serve` over stdio as Claude
// does, to show G13's fixes one by one:
//   1. a seed search on a calm tile (`seeds`), a pebble tried with `run dry=true`, and the
//      repetition check's limit raised by the band's own spread (one mark is not a stripe);
//   2. a cliff family whose faces are drawn on a map layer that leaves the outside to the floor;
//   3. an underlay asked for in the shape of the area it is placed on;
//   4. snap on the placement's grid, and the seam warning after a `family cut` (in a dry run);
//   5. a floor filled with one command (`tiles … fill`), and walkable ground for footprints;
//   6. an export profile with a corner order, path shapes and a per-colour output map (tones);
//   7. the cliff's band jittered, so its edge is not ruler-straight;
//   8. a texture variant that inherits the band and follows a later fix to it.
// No API key: the underlay uses the offline `fake` provider.
//
//   node examples/demo-g13-agent.ts [--project <dir>] [--keep]

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { decodePng } from '../core/src/index.ts';

const REPO = join(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
const project = opt('--project', join(REPO, 'out', 'demo-g13.pclaw'));
const T = 16;

if (existsSync(project)) rmSync(project, { recursive: true, force: true });
mkdirSync(join(project, 'profiles'), { recursive: true });
// The export profile (item 6): an engine that draws in five tones and names its tiles its own way.
const PROFILE = {
  format: 'pixelclaw-profile', version: 1, name: 'ledge-engine', layout: 'loose', variants: 'names',
  description: 'An invented engine for the Fern Ledge demo: five tones, corners nw first, path pieces by shape.',
  autotile: {
    face: { template: '{asset}_{sides}{corners}', corners: 'nw,ne,se,sw', names: { face_o: '{asset}_face', face_e: '{asset}_face_e', face_w: '{asset}_face_w', face_ew: '{asset}_face_ew' } },
    path: { template: '{asset}_{sides}', shapes: { lone: '{asset}_dot', end: '{asset}_end_{sides}', straight: '{asset}_run_{sides}', corner: '{asset}_turn_{sides}', tee: '{asset}_tee_{sides}', cross: '{asset}_cross' } },
  },
  roles: { black: '#000000', darkest: '#404040', dark: '#808080', light: '#c0c0c0', white: '#ffffff' },
  colours: {
    ink: 'black', stone0: 'darkest', stone1: 'darkest', stone2: 'dark', stone3: 'dark', stone4: 'light', stone5: 'white',
    moss0: 'darkest', moss1: 'dark', moss2: 'dark', moss3: 'light', lichen: 'white', soil0: 'darkest', soil1: 'dark', soil2: 'light', pool: 'dark',
  },
};
writeFileSync(join(project, 'profiles', 'ledge-engine.json'), JSON.stringify(PROFILE, null, 2) + '\n');

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(REPO, 'cli', 'bin', 'pixelclaw.js'), 'serve', '--project', project],
  stderr: 'pipe',
});
(transport.stderr as PassThrough).resume();
const client = new Client({ name: 'demo-g13-agent', version: '1.0.0' });
await client.connect(transport);

type Content = { type: string; text?: string }[];
async function call(name: string, a: Record<string, unknown>, ok = true): Promise<string> {
  const r = (await client.callTool({ name, arguments: a })) as { content: Content; isError?: boolean };
  const text = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  if (r.isError && ok) throw new Error(text);
  return text;
}
const run = (asset: string, commands: string, extra: Record<string, unknown> = {}) => call('run', { asset, commands, ...extra });
const indent = (s: string, n = 4) => s.split('\n').map((l) => ' '.repeat(n) + l).join('\n');
const pick = (s: string, re: RegExp) => s.split('\n').filter((l) => re.test(l)).join('\n');
const head = (s: string) => s.split('\n')[0]!;
const short = (s: string, n = 160) => (s.length > n ? s.slice(0, n) + '…' : s);

await call('project', { palettes: [join(REPO, 'examples', 'src', 'mossy-ruins.json')] });
console.log(`Fern Ledge: a mossy ledge over a stream bed, at ${T} px. Project: ${relative(REPO, project)}\n`);

// --- 1. A calm tile: a seed search, then a pebble tried before it is kept.
console.log('1. The stream bed, a calm tile: which seed of the noise?');
await run('bed', `new tile bed ${T}x${T} bg=soil1`);
const line = 'noise ramp=soil weights=1,6,3 density=0.25 cluster=1..2';
const seeds = await call('seeds', { asset: 'bed', line, count: 8, apply: true });
console.log(indent(seeds.split('\n').filter((l) => !/^checks:/.test(l)).join('\n')));
console.log('   A pebble, tried first with run dry=true (nothing kept):');
const pebble = 'rect 6,9 3x2 c=stone3 fill\npx 6,9 c=stone4\npx 8,10 c=stone2';
// The same dry run under G5's rule (project.json style: repetition contrast 0), then under G13's.
const pj = join(project, 'project.json');
const pjText = readFileSync(pj, 'utf8');
const style = (o: unknown) => { const j = JSON.parse(pjText); j.style = { ...(j.style ?? {}), ...(o as object) }; writeFileSync(pj, JSON.stringify(j, null, 2) + '\n'); };
style({ checks: { repetition: { contrast: 0 } } });
await new Promise((r) => setTimeout(r, 20));
console.log(indent(`under G5's rule (contrast 0): ${pick(await run('bed', pebble, { dry: true }), /^checks:/).replace(/.*(repetition [^·(]+).*/, '$1').trim()}`, 5));
writeFileSync(pj, pjText);
await new Promise((r) => setTimeout(r, 20));
const dry = await run('bed', pebble, { dry: true });
console.log(indent(pick(dry, /dry run/), 5));
console.log(indent(`under G13's: ${pick(dry, /^checks:/).replace(/.*(repetition [^·(]+).*/, '$1').trim()}`, 5));
await run('bed', pebble);
console.log(indent(pick(await call('check', { asset: 'bed', checks: ['repetition'], image: false }), /repetition/).trim(), 5));
console.log('   (the rows through the pebble are lighter on average, but all of it is in three pixels: the limit');
console.log('    rises with the band\'s own spread, so one mark on a calm tile is not a stripe)\n');

// --- 2, 7. The ledge: a cliff family (face scheme), its band jittered; faces painted.
console.log('2, 7. The ledge: a cliff family with faces; its band edge jittered, the seed chosen by the checks');
// The moss and the stream bed's second look (a texture variant, so maps mix them), each by a seed search.
console.log('    the textures, each by a seed search (moss, and second looks of the moss and the bed):');
await run('moss', `new tile moss ${T}x${T} bg=moss2`);
console.log(indent(pick(await call('seeds', { asset: 'moss', line: 'noise ramp=moss weights=0,2,6,2,0 density=0.25 cluster=1..2', count: 12, apply: true }), /^best|^applied/)));
await run('moss_b', `new tile moss_b ${T}x${T} bg=moss2\nvariant of=moss`);
console.log(indent(pick(await call('seeds', { asset: 'moss_b', line: 'noise ramp=moss weights=0,3,6,1,0 density=0.25 cluster=1..2', count: 12, from: 20, apply: true }), /^best|^applied/)));
await run('bed_b', `new tile bed_b ${T}x${T} bg=soil1\nvariant of=bed`);
console.log(indent(pick(await call('seeds', { asset: 'bed_b', line, count: 12, from: 30, apply: true }), /^best|^applied/)));
await run('ledge', [
  `new family ledge ${T}x${T} scheme=face`,
  'family texture inside from=moss', 'family texture outside from=bed',
].join('\n'));
const band = 'family band 1:outside 1:ink 1:moss1 jitter=2';
const bs = await call('seeds', { asset: 'ledge', line: band, count: 6, checks: ['seam', 'coverage'], apply: true });
console.log(indent(pick(bs, /seed|best|applied|^[0-9]/)));
await run('ledge', [
  'layer band',
  `rect @cell(face_o) 0,0 ${T}x9 c=stone2 fill`, `line @cell(face_o) 0,8 ${T - 1},8 c=ink`, `line @cell(face_o) 0,3 ${T - 1},3 c=stone3`,
  `px @cell(face_o) 3,5 11,6 c=stone1`,
  `rect @cell(face_ew) 0,0 ${T}x9 c=stone2 fill`, `line @cell(face_ew) 0,8 ${T - 1},8 c=ink`, `line @cell(face_ew) 0,3 ${T - 1},3 c=stone3`,
  `px @cell(face_ew) 6,5 13,6 c=stone1`,
].join('\n'));
console.log(indent(pick(await call('check', { asset: 'ledge', checks: ['seam', 'coverage'], image: false }), /✓|✗/)));
await call('view', { asset: 'ledge', mode: 'map', size: '10x8', seed: 3 });
console.log('');

// --- 8. A texture variant of the ledge that inherits its band.
console.log('8. ledge_b: a texture variant that keeps only its own moss and inherits the band');
await run('ledge_b', 'fork ledge ledge_b\nvariant of=ledge band=inherit\nlayer ground\nfamily texture inside from=moss_b');
const own = await call('run', { asset: 'ledge_b', commands: 'family band 1:outside 1:ink' }, false);
console.log(indent(`its own band edit is refused: ${short(head(own).replace(/^\d+:\d+: error: /, ''), 150)}`));
const fix = await run('ledge', `family band 1:outside 1:ink 2:moss1 jitter=2 seed=${/seed=(\d+)/.exec(pick(bs, /^best/))![1]}`);
console.log(indent(`a later fix to the ledge's band (two moss rows): ${pick(fix, /^variants that inherit/)}`));
console.log('');

// --- 6 (paths). A trail: a path family, its dead ends named apart from its straights on export.
// A gravel trail across the stream bed (its outside is the bed, so the strip sits in it).
console.log('6 (paths). A gravel trail across the bed, by a seed search; a variant of it on the other bed');
await run('gravel', `new tile gravel ${T}x${T} bg=stone3`);
console.log(indent(pick(await call('seeds', { asset: 'gravel', line: 'noise ramp=stone weights=0,0,2,6,3,1 density=0.3 cluster=1..2', count: 12, from: 50, apply: true }), /^best|^applied/)));
await run('trail', [
  `new family trail ${T}x${T} scheme=path`, 'family texture inside from=gravel', 'family texture outside from=bed',
  'family band 1:outside 1:soil0 jitter=1 seed=5',
].join('\n'));
// Its variant with the other bed: the ground a trail runs through mixes the two cell by cell.
await run('trail_b', 'fork trail trail_b\nvariant of=trail band=inherit\nlayer ground\nfamily texture outside from=bed_b');
console.log('');

// --- 5. The map: a floor filled at once, the ledge over it with its faces on the floor.
console.log('5, 2. The map: the floor filled with one command; the ledge on a layer that leaves the rest to the floor');
await run('rock', `new object rock ${T}x${T}\nellipse 3,6 10x9 c=stone2 fill\nellipse 4,7 5x4 c=stone3 fill\noutline c=ink\nfootprint 1x1`);
const map = await run('fern_ledge', [
  'new map fern_ledge 12x8 tile=16',
  'tiles floor fill bed',
  'layer add cliff terrain=ledge outside=off above=floor',
  'terrain cliff paint 0,0 <<', '  ##########..', '  #######.....', '  ####........', '>>',
  'layer add path terrain=trail outside=off above=cliff',
  'road path 1,6 5,6', 'road path 5,6 5,5', 'road path 5,5 9,5', 'road path 9,5 9,3',
  'layer add props objects above=path',
  'place rock 4,4 layer=props', 'place rock 2,1 layer=props',
].join('\n'));
console.log(indent(pick(map, /^#\d+ .*tiles floor fill/).replace(/^#\d+ \S+ \S+\s+/, '')));
console.log(indent(pick(map, /^checks:/)));
await call('view', { asset: 'fern_ledge', mode: 'map', region: '0,0 12x8' });

// The glade: the stream bed filled by the trail layer's outside ground, walkable, with rocks on it.
await run('glade', ['new map glade 8x6 tile=16', 'layer add ground terrain=trail outside=on walkable=on above=floor', 'road ground 0,4 3,4', 'road ground 3,4 3,3', 'road ground 3,3 7,3', 'layer add props objects above=ground', 'place rock 2,1 layer=props', 'place rock 5,5 layer=props'].join('\n'));
const notWalk = await run('glade', 'layer set ground walkable=off', { dry: true });
console.log(indent(`the glade's ground is the trail layer's outside (filled); walkable=off (a dry run): ${pick(notWalk, /^checks:/).replace(/.*(footprint [^·]+).*/, '$1')}`));
console.log(indent(`walkable=on (as it is): ${pick(await call('check', { asset: 'glade', checks: ['footprint'], image: false }), /footprint/).trim()}`));
console.log('');

// --- 3, 4. An underlay in the shape of the area it covers, snapped on the placement's grid.
console.log('3, 4. A draft of a rock pillar: the underlay asked for in the placed area\'s shape, snapped on its grid');
await run('pillar', `new sheet pillar 48x32 cell=16x16\nlayer add plan reference\nlayer plan\nrect 18,2 12x26 c=stone2 fill\nrect 16,26 16x6 c=moss2 fill\nrect 21,4 4x20 c=stone3 fill`);
const u = await run('pillar', 'underlay generate "a rock pillar with moss at its foot, pixel art" layout=plan provider=fake at=16,0 size=16x32\nsnap');
console.log(indent(pick(u, /underlay mockup|snap from/).split('\n').map((l) => short(l.replace(/^#\d+ \S+ \S+\s+/, ''), 150)).join('\n')));
// A cut from a coverage map whose cells have a dark line along their tops (a dry run: nothing kept).
const cut = await run('scratch', [
  `new family scratch ${T}x${T} scheme=blob47 map=14x12`,
  `rect @cell(inside) 0,0 ${T}x${T} c=moss2 fill`, `rect @cell(outside) 0,0 ${T}x${T} c=soil1 fill`,
  'family band 1:outside 1:ink 1:moss1 draw=off', 'family coverage seed=7 copies=1 fill=on', 'layer ground',
  ...Array.from({ length: 12 }, (_, j) => `line 0,${7 * T + j * T} ${14 * T - 1},${7 * T + j * T} c=ink`),
  'family cut textures=on',
].join('\n'), { dry: true });
console.log(indent(`family cut from a map painted with a dark line on every cell (dry run): ${short(pick(cut, /^warnings:/).replace(/^warnings: /, ''), 200)}`));
console.log('');

// --- 6. Export through the profile.
console.log('6. Export through ledge-engine: corners nw first, the trail\'s pieces by shape, five tones');
const ex = await call('export', { profile: 'ledge-engine', assets: ['ledge', 'trail', 'rock'] });
const files = readdirSync(join(project, 'exports', 'ledge-engine')).filter((f) => f.endsWith('.png')).map((f) => f.replace(/\.png$/, '')).sort();
console.log(indent(`${head(ex).replace(/ into .*/, '')}`));
console.log(indent(`ledge (corners nw, ne, se, sw): ${files.filter((f) => /^ledge_(nesw_nw_ne_se_sw|nesw_ne_se_sw|nes_ne_se|face_ew|face)$/.test(f)).join(' ')} …`));
console.log(indent(`trail (by shape): ${files.filter((f) => /^trail_(?!b_)/.test(f)).join(' ')}`));
const rock = decodePng(readFileSync(join(project, 'exports', 'ledge-engine', 'rock.png')));
const tones = new Set<string>();
for (let i = 0; i < rock.data.length; i += 4) if (rock.data[i + 3]) tones.add('#' + [...rock.data.subarray(i, i + 3)].map((v) => v.toString(16).padStart(2, '0')).join(''));
console.log(indent(`rock.png is drawn in the tones only: ${[...tones].sort().join(' ')}`));

console.log('\nEvery check:');
console.log(indent((await call('check', {})).split('\n').filter((l) => !/^(scratch|pillar):/.test(l)).join('\n')));
console.log('    (pillar is a draft: its snapped layer is still to be cleaned)');
await client.close();
if (!args.includes('--keep')) console.log(`\n(the project is in ${relative(REPO, project)})`);
