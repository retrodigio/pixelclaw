// A stand-in for the agent in the export-import walkthrough demo (examples/export-import.md). It starts `pixelclaw serve` over
// stdio on a copy of the example project (the animation, tile-set and map art), exactly as Claude Code would, and
// gives you the watch link. Then: the village with its five open notes closed (rounder corners, the
// open sea and the beach mixing variants, the lanes reaching the beach); the house at 2x and the
// density check; the animation, tile-set and map art exported through the sample profile (an invented engine,
// "Bramble") into a scratch game folder (out/game-g9/), and read back exactly; the village for
// Tiled; and a sheet re-imported from Aseprite's sheet export, then edited.
//
//   node examples/export-agent.ts [--project <dir>] [--game <dir>] [--pause <ms>] [--linger <seconds>]

import { cpSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const REPO = join(import.meta.dirname, '..');
const EXAMPLE = join(REPO, 'examples', 'mossy-ruins.pclaw');
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
const project = opt('--project', join(REPO, 'out', 'export.pclaw'));
const game = opt('--game', join(REPO, 'out', 'game-g9'));
const pause = Number(opt('--pause', '800'));
const linger = Number(opt('--linger', '0')) * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The project is a copy of the example (its art, palettes, schemes, the sample profile, the style guide).
for (const d of [project, game]) if (existsSync(d)) rmSync(d, { recursive: true, force: true });
cpSync(EXAMPLE, project, { recursive: true });
for (const d of ['views', 'exports', 'reviews']) rmSync(join(project, d), { recursive: true, force: true });

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(REPO, 'cli', 'bin', 'pixelclaw.js'), 'serve', '--project', project],
  stderr: 'pipe',
});
(transport.stderr as PassThrough).resume();
const client = new Client({ name: 'export-agent', version: '1.0.0' });
await client.connect(transport);

type Content = { type: string; text?: string }[];
async function call(name: string, a: Record<string, unknown>): Promise<string> {
  const r = (await client.callTool({ name, arguments: a })) as { content: Content; isError?: boolean };
  const text = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  if (r.isError) throw new Error(text);
  return text;
}
const indent = (s: string, n = 4) => s.split('\n').map((l) => ' '.repeat(n) + l).join('\n');
const first = (s: string, n = 1) => s.split('\n').slice(0, n).join('\n');
const pick = (s: string, re: RegExp) => s.split('\n').filter((l) => re.test(l)).join('\n');
const tree = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tree(join(dir, e.name)) : [join(dir, e.name)]));

const info = await call('project', {});
const url = /watch live: (\S+)/.exec(info)![1]!;
console.log(`Watch the agent work:\n\n  ${url}\n`);
console.log(indent(pick(info, /^(export profiles|project schemes)/), 2));
await sleep(pause * 2);

console.log('\n1. The village, its five open notes closed: the shore and the meadow on blob47-round (rounder inner corners),');
console.log('   the open sea and the beach mixing four waters and three sands, the lanes running on to the beach');
console.log(indent(pick(info, /^ {2}village:/).replace(/^ +/, ''), 2));
console.log(indent(first(await call('view', { asset: 'village', mode: 'map' }), 3), 2));
console.log(indent(pick(await call('view', { asset: 'village', mode: 'map', camera: '18,20' }), /^(showing|wrote)/), 2));
console.log(indent(pick(await call('check', { asset: 'village', checks: ['seam', 'repetition'] }), /seam|repetition/), 2));
await sleep(pause);

console.log('\n2. The house at twice the density: a scale-up of the 1x house, detailed; the density check reduces it back');
console.log(indent(pick(await call('check', { asset: 'house_2x', checks: ['density', 'coverage', 'fit'] }), /density|coverage|fit/), 2));
console.log(indent(first(await call('view', { asset: 'house_2x', mode: 'density' }), 4), 2));
await sleep(pause);

console.log(`\n3. The animation, tile-set and map art through the sample profile into a scratch game folder (${relative(REPO, game)}/art)`);
const art = join(game, 'art');
const assets = ['walker', 'water', 'stone_floor', 'sand', 'shore', 'glint', 'house', 'tree', 'well', 'meadow', 'lane'];
console.log(indent(pick(await call('export', { profile: 'bramble', assets, dest: art }), /^bramble|note|^ {2}\S/).split('\n').filter((l) => !l.startsWith('    /')).join('\n'), 2));
for (const f of tree(art).sort()) console.log(`    ${relative(game, f)}`);
console.log('  the 1x page\'s records (the first lines):');
console.log(indent(readFileSync(join(art, 'bramble.csv'), 'utf8').split('\n').slice(0, 6).join('\n'), 4));
console.log('  the entries for the engine (bramble-entries.txt):');
console.log(indent(readFileSync(join(art, 'bramble-entries.txt'), 'utf8').split('\n').filter((l) => /^(sprite "walker"|tile "water"|terrain "shore"|object "house"|overlay "glint")/.test(l)).join('\n'), 4));
await sleep(pause);

console.log('\n4. Read back: every image sliced by name from the pages, quantised to its asset\'s palette (roles decoded)');
console.log(indent(await call('import', { path: art, profile: 'bramble' }), 2));
await sleep(pause);

console.log('\n5. The village for Tiled: a .tsx with a wang set per family, a collection of the other tiles, the .tmx');
console.log(indent(first(await call('export', { profile: 'tiled', assets: ['village'], dest: join(game, 'tiled') })), 2));
console.log(indent(readFileSync(join(game, 'tiled', 'village.tmx'), 'utf8').split('\n').filter((l) => /<tileset /.test(l)).join('\n'), 2));
await sleep(pause);

console.log('\n6. A sheet comes back from someone else\'s tool: the walker as Aseprite\'s sheet export, re-imported by a 24x24 grid');
console.log(indent(first(await call('export', { profile: 'aseprite-json', assets: ['walker'], dest: join(game, 'sheets') })), 2));
console.log(indent(await call('import', { path: join(game, 'sheets', 'walker.png'), as: 'walker_sheet', grid: '24x24', palette: 'ruins-folk' }), 2));
console.log(indent(first(await call('history', { asset: 'walker_sheet', last: 3 }), 4).replace(/<<[\s\S]*/, '<< …'), 2));
console.log('   and edited: a PNG sheet has no directions or timing, so the agent gives them back; then a grey cloak for a');
console.log('   second villager (the tunic\'s three shades swapped for stone shades on every frame)');
const views = 'view S frames=1-2\nview N frames=3-4\nview E frames=5-6\nview W frames=7-8\nframe set all ticks=12\npivot 11,22\nground 22';
const swap = (c: string, to: string) => `select colour c=${c}\nrect 0,0 24x24 c=${to} fill`;
const cloak = Array.from({ length: 8 }, (_, f) => `frame ${f + 1}\n${swap('cloth2', 'stone3')}\n${swap('cloth1', 'stone2')}\n${swap('cloth0', 'stone1')}\ndeselect`).join('\n');
console.log(indent(pick(await call('run', { asset: 'walker_sheet', commands: `${views}\n${cloak}\nframe 1` }), /applied|checks/), 2));
console.log(indent(pick(await call('view', { asset: 'walker_sheet', mode: 'anim' }), /^(anim|wrote|animated)/), 2));

console.log(`\nDone. The project is ${relative(REPO, project)}, the game folder ${relative(REPO, game)}. In the watch view pick house_2x and`);
console.log('open the density tab, or walker_sheet to see its tape start from the import.');
if (linger) {
  console.log(`The server stops in ${linger / 1000} s (or press Ctrl-C).`);
  await Promise.race([sleep(linger), new Promise((r) => process.once('SIGINT', r))]);
}
await client.close();
