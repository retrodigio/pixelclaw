// The MCP tools (plan §8.2): project, run, view, history and changes. Few tools; the command
// language carries the rest. Every call goes through the writer's queue, in the order it arrives.

import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { BUILTIN_SCHEMES, CHECK_IDS, checkSummary, ctxOf, diffPixels, diffText, type CheckResult, type Note, type TapeEntry } from '@pixelclaw/core';
import { ProjectError, listAssets, readPaletteFile } from './project.ts';
import { formatChecks } from './report.ts';
import { writeReview } from './review.ts';
import { EXPORT_FORMATS, exportAsset } from './export.ts';
import { exportWithProfile, importIntoProject, importSummary, planImport, projectProfiles, projectSchemes } from './io.ts';
import { agentWork, readRequests } from './requests.ts';
import { openRequests, type WorkRequest } from '@pixelclaw/core';
import { manifestEntry, planReport, planText, readManifest, writeManifest, writeTemplates } from './plan.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VIEW_MODES, parseRegion, type View, type ViewMode } from './views.ts';
import { SUMMARY_BUDGET, type AssetChanges, type Writer } from './writer.ts';

/** The author name every MCP batch is written with, and whose read position `changes` keeps. */
export const AGENT = 'claude';

export const SERVER_NAME = 'pixelclaw';

export const INSTRUCTIONS = `PixelClaw is a pixel art editor you drive with a small command language. All art is indexed colour (every pixel is a palette entry).

Start with the \`project\` tool: it lists palettes and assets, and gives a watch link (http://127.0.0.1:…/?token=…). Give the person that link so they can watch you draw live, and edit too.

Draw with \`run\` (one batch = one undo group; any error applies nothing); every result ends with a one-line check summary. Look with \`view\` (render: scaled PNG with grid and rulers; tile3x3: seams and repetition; grid: exact palette keys per pixel; diff: what the last group changed; game: a sprite on its ground at 1x and the draw scale beside its set; recolour: role art under preview themes; map: a family on a random island with the seam score; family: every variant among its neighbours; marks: "failing" circles flagged pixels in magenta). \`check\` gives the full table: each check's score against the style guide's threshold and the exact pixels it flags; fix them by coordinates. Read the tape with \`history\`. \`review\` writes a blind review bundle: hand its folder to a fresh agent with no context, and bring its findings back as notes on the pixels.

People edit in the watch view too. Their edits are commands on the same tape, written by human:<name>. Call \`changes\` at the start of each turn while someone is watching, and whenever they say they changed something: it returns their commands and notes since you last looked, with a before/after diff image. Carry on from what they did; never silently redo their pixels. Close a note you have dealt with: note done <id>.

Commands (one per line, or ';' between them; '#' comments). Full reference: docs/commands.md in the PixelClaw repo.
  new tile|sprite|sheet|icon|object|font <name> <W>x<H> [palette=<p>] [wrap=on|off] [cell=WxH] [bg=<colour>]
  px <x,y> [<x,y>...] c=<colour>
  line <x,y> <x,y> [<x,y>...] c=<colour> [pp=on|off]      pixel-perfect lines and polylines
  curve <x,y> <ctrl> [<ctrl>] <x,y> c=<colour>           quadratic or cubic Bezier, pixel-perfect
  rect <x,y> <W>x<H> c=<colour> [outline|fill]   ellipse <cx,cy> r=<RX>x<RY> ...   polygon <x,y> <x,y> <x,y>... c= [outline|fill]
  fill <x,y> c=<colour> [mode=contiguous|global] [conn=4|8]
  paint <x,y> <<            rows of palette keys; '.' leaves a pixel, a space clears it
    ..kk..
  >>
  stroke pencil c=<colour> [pp=on|off] <x,y> <x,y>...    a freehand drag; stroke eraser <x,y>...
  layer add <name> [above=|below=<layer>] [reference] | layer <name> (draw on it) | layer set <name> hidden=|locked=|reference=on|off | layer move|merge|rename|remove
  frame add [<n>] [copy=<m>|link=<m>|empty] | frame <n> (draw on it, from 1) | frame remove|move | frame set <n>|<a>-<b>|all ticks=<t>
  tag add <name> <a>-<b> [loop=cycle|pingpong] | view S|N|E|W frames=<a>-<b> | view W mirror=E (live mirror) | cel link|unlink <a>-<b> | pivot <x,y> | ground <y>
  select rect|ellipse|lasso|wand|colour|layer|all|none|invert ... [add|sub|and]; deselect   your selection clips your drawing
  clear | shift <dx,dy> [wrap] | flip h|v | rotate 90|180|270       the selection, or your whole layer
  mirror x=11.5 [y=..] live (later strokes mirrored) | mirror off | mirror x=11.5 from=left (copy once)
  dither <x,y> <W>x<H> a= b= [pattern=checker|bayer2|bayer4|bayer8|hlines|vlines] [level=0.25]
  gradient <x,y> <W>x<H> ramp=<ramp> [dir=down|up|right|left|radial] [steps=n] [pattern=none|checker|bayer4..]
  ramp <name> = <darkest> ... <lightest>   |   palette lock|unlock   |   palette save as=<new palette>
  outline c=<colour> [mode=outer|inner] [corners=on|off] [from=<layer>]    shade light=nw [ramp=<r>|all] [edge=1]    clean orphans [size=1] [keep=texture]
  noise [<x,y> <W>x<H>] ramp=<r> [weights=6,2,1] [cluster=1..3] [density=0.15] [base=<c>|keep] [seed=n]
  scatter [box] stamp=<s>[,<s>]|c=<colour> count=<n> [minDist=<n>] [flip=on] [seed=n]
  voronoi [box] cells=<n> ramp=<r> [gap=<colour>] [relax=1] [seed=n]     bricks [box] size=8x4 ramp=<r> [gap=<colour>] [seed=n]
  stamp save <name> <x,y> <W>x<H> (or a << block >>) | stamp <name> <x,y> [flip=h|v|hv]    brush square|circle <n> | brush stamp <name> | brush off
  def tuft(x,y) { px $x,$y $x+1,$y-1 c=moss2 }   call tuft 5,18
  palette set <entry> hex=#rrggbb [role=<r>|none] | palette add [<name>] hex=#rrggbb|role=<r> [key=<k>]   this asset's palette; roles black|white|light|dark|darkest for recolourable art
  note <x,y> [<W>x<H>] "text"   |   note done <id>
  undo [group=<g>] [by=<author>]   |   redo [group=<undo group>]
  fork <from> <to> [at=<n>]  (as the first command of a run on a new asset: a branch of <from>)
Underlays (an image under the art, never exported) and snap:
  underlay generate "<prompt>" [layout=templates/mockup.png|<layer>] [image=1536x1024] [provider=openai|fake] [model=] [quality=low|medium|high] [cap=<usd>] [layer=mockup]
      calls the image provider (the key is the server's OPENAI_API_KEY; a cost cap per call, logged in logs/underlay-costs.jsonl); the tape gets underlay <layer> blob=<sha256> …
  underlay import <file.png> [layout=<template.png|layer>] [layer=underlay] [at=x,y] [size=WxH]    any image (a sketch, a photo of a drawing) as an underlay
  snap [from=<underlay layer>] [into=draft]   fits the image's pixel grid and quantises it to the palette on a new draft layer; reports block R² and the material match against the layout (below 0.8 / 0.85: reroll)
  import <x,y> asset=<name> region=<x,y,WxH> [layer=<layer>]   copy a region of another asset (cut a tile from a snapped scene)
Fonts and icons:
  new font <name> <W>x<H> chars="ABC…"|32-126 [cols=16] [baseline=<row>] [line=<px>] [spacing=1]   a glyph sheet: one W x H cell per character
  glyph A [advance=<n>|auto] <<  rows  >>    (letters and digits as themselves; other characters as U+0021 or "!")   font set baseline= line= spacing=
  icon mode=tone|full|channel   how an icon is exported (tone: roles recoloured by the game; full: as drawn; channel: pure-RGB masks)
Autotile families (a sheet of every variant of a scheme: blob47, wang16-corner, path, bridge8, single, face):
  new family <name> <T>x<T> scheme=<scheme> [map=<C>x<R>]   layers ground (the textures, laid by the band) and band (the band's art)
  family texture inside|outside from=<tile asset> [frame=<n>]    copy a seamless tile into the inside or outside texture
  family band <w>:<colour|outside|inside>... [radius=<r>] [inset=<n>] [draw=on|off]   the band from the edge in (3:outside 1:foam 2:sand1); draws it on the pieces
  layer band ; paint @cell(o) 0,0 << ... >>   hand-detail a piece (cells by name: @cell(inside), @cell(nesw)); every other variant is built from the pieces' quadrants, live
  family detach|attach <variant>|all   draw a variant by hand instead   |   family coverage [seed=] [copies=] [fill=on] (a coverage map to paint)   |   family cut [textures=on]
  new overlay <name> <W>x<H> ; overlay set mode=cycle|pingpong|wave|sparkle on=outside|inside|all [anchor=x,y] [spread=4x2] [every=3]   sub-tile sprites over a map (view map with=)
Oversized tiles and objects (48x48, 24x48, …; cell= the grid): new object house 48x48 cell=24x24 ; footprint 2x1 [at=<cx,cy>] [anchor=<x,y>] << a row per art cell row: . b (blocks) r (roof, drawn above actors) x (both) >>
  variant of=<asset>   this asset is a texture variant of another (fork it, change the inside, keep the border): maps pick among them cell by cell
Maps (plan §4.11: cells of tile px holding names; a map redraws itself when a tile changes):
  new map <name> <C>x<R> tile=24   layer add <name> terrain=<family> [outside=on] | tiles | objects | overlay=<overlay> on=<terrain layer>[:out]|all
  terrain <layer> rect <x,y> <W>x<H> | ellipse … | brush <x,y>... [size=n] | fill <x,y> | paint <x,y> << # terrain, - not, . leave >> | clear   [erase]   the scheme picks the edge tiles
  place <asset>|<family>.<variant> <x,y> [layer=]   by its anchor cell; footprints may not overlap   |   move <x,y> <x,y>   |   remove <x,y>
  road <terrain layer> <x,y> <x,y>... [width=n]   |   scatter <asset>[,<asset>] count=<n> [on=<terrain layer>] [minDist=n] [layer=] [seed=]   |   map gen island|village|dungeon [layers=a,b,c] [seed=]
  view map: the whole map at 1x; region="x,y WxH" (cells) or camera="x,y" (the engine's screen around a cell) at game scale; marks="failing" outlines hot spots. export: tmx (Tiled), split (one-cell pieces + stamp), png.
Colours: an entry name (c=stone3), its key (c=3), its exact hex, or none. Coordinates wrap on wrap=on documents (tiles by default). @cell(cx,cy) after a command name offsets it to a cell of the cell grid. Generators write their seed into the tape line; give seed= to choose one (another seed is another variant). Your layer, frame, selection, symmetry and brush are yours alone: people in the watch view have their own.

The project pipeline: \`plan\` shows the asset plan (manifest.json) and each asset's status (planned → drafted → checked → reviewed → approved → exported) by set; plan(manifest=…) writes a manifest (schema-checked), plan(templates=true) draws a flat mockup screen and coverage maps. A planned asset's \`new\` may leave out its size, palette and scheme. After a blind review's findings are dealt with: mark reviewed "…". A person approves in the dashboard (the watch link with &tab=dashboard), writing mark approved, or asks for changes (mark rejected "…"): read it with \`changes\`. The consistency check holds each asset to its set and to its planned height. docs/pipeline.md.

Requests: people ask for work in the dashboard (Draw this, Ask for changes, Add an asset); \`plan\` lists open requests first. Take them before planned work: \`work\` claims the next open request and says what is asked; post progress with work(action="progress", text=…); finish with work(action="done", text=<what changed>) or, when you need the person, work(action="blocked", text=<one clear question>). Call \`plan\` at the start of a session and after each finished asset.

Habits: after each meaningful batch, look once at an image (render or tile3x3), and use the grid to check exact pixels. Never judge a tile alone when it will be seen tiled; judge a sprite in the game view, on its ground. Keep the checks green, but do not stop at green: look at the 3x3 or the game view and judge it as a player would.

Map checks: seam (over the composed ground), repetition (hot spots: the same edge tile in a long straight run, one textured tile filling a 4x4 window; fix with texture variants), footprint (overlaps, off the map, standing on an edge or the outside ground), draworder (overhangs not marked roof, roofs hiding what stands in front), coverage (missing assets or undrawn variants). Assets: fit (footprint cells drawn, overhangs are roofs), variant (colour mix against the base).

Checks: palette (colours in the style palettes; role art uses only roles), orphans (stray pixels per 100), jaggies (doubled L-corners, irregular step runs, spikes, notches on outlines and one-colour lines; steps between neighbouring entries of one ramp are shading), banding (pillow shading), outline (share of the silhouette edge in ink), seam (tiles: the border vs the interior; families: over a random island map; about 1 or less reads as no seam), coverage (sizes, empty frames or cells; families: every variant and texture drawn), readability (edge contrast against the ground in ΔL*, silhouette distinct from the set, lightness spread), revert (share copied from a reference: ref=), repetition (tiles: the most visible stripe when tiled, ΔL*·√width), consistency (against the set; icons: stroke weight, box fill, optical centre), font (cap height, x-height, baseline, advances, line height). Thresholds come from project.json style.checks.`;

const text = (t: string) => ({ type: 'text' as const, text: t });
const fail = (t: string): CallToolResult => ({ content: [text(t)], isError: true });

function errorResult(e: unknown): CallToolResult {
  if (e instanceof ProjectError || e instanceof SyntaxError) return fail(`error: ${e.message}`);
  throw e;
}

/** A tape entry as one line (multi-line paint blocks keep their rows, indented). */
export function formatEntry(e: TapeEntry, note = ''): string {
  const [head, ...rest] = e.cmd.split('\n');
  return [`#${e.seq} ${e.by} ${e.group}  ${head}${note}`, ...rest.map((r) => `      ${r}`)].join('\n');
}

function viewContent(v: View): CallToolResult['content'] {
  if (v.kind === 'text') return [text(v.text), text(`saved ${v.path}`)];
  return [
    ...(v.text ? [text(v.text)] : []),
    { type: 'image', data: Buffer.from(v.png).toString('base64'), mimeType: 'image/png' },
    text(`${v.mode}: ${v.width}x${v.height} px, saved ${v.path}`),
  ];
}

export function projectSummary(w: Writer, url: string): string {
  const p = w.project;
  const lines = [`project '${p.json.name}' at ${p.dir}`, `watch live: ${url}  (give this link to the person watching)`, ''];
  if (p.palettes.size === 0) lines.push('palettes: none yet. Add one with project(palettes: ["/path/to/palette.json|.hex|.gpl"]).');
  for (const pal of p.palettes.values()) {
    lines.push(`palette ${pal.name}${pal.name === p.json.defaultPalette ? ' (default)' : ''}: ${pal.entries.length} colours`);
    lines.push('  ' + pal.entries.map((e) => `${e.key}=${e.name}`).join(' '));
    const ramps = Object.entries(pal.ramps);
    if (ramps.length) lines.push('  ramps: ' + ramps.map(([k, v]) => `${k} [${v.join(' ')}]`).join('; '));
  }
  lines.push(`autotile schemes: ${[...BUILTIN_SCHEMES.values()].map((x) => `${x.name} (${x.variants.length})`).join(', ')}`);
  const own = projectSchemes(p.dir);
  if (own.size) lines.push(`project schemes (copied into a family's tape): ${[...own.values()].map((x) => `${x.name} (${x.variants.length})`).join(', ')}`);
  try {
    lines.push(`export profiles: ${[...projectProfiles(p).values()].map((x) => `${x.name} (${x.layout})`).join(', ')}`);
  } catch (e) {
    lines.push(`export profiles: ${(e as Error).message}`);
  }
  const assets = listAssets(p);
  lines.push('', assets.length ? `assets (${assets.length}):` : `assets: none yet. Create one with run(asset, "new tile <name> 24x24 ...").`);
  for (const a of assets) {
    try {
      const { doc, entries } = w.state(a);
      const groups = new Set(entries.map((e) => e.group)).size;
      const notes = doc?.notes.length ? `; open notes: ${doc.notes.map((n) => n.id).join(', ')}` : '';
      const extra = doc ? [
        doc.layers.length > 1 ? `layers ${doc.layers.map((l) => l.name + (l.reference ? ' (ref)' : '') + (l.hidden ? ' (hidden)' : '') + (l.locked ? ' (locked)' : '')).join(', ')}` : '',
        doc.frameCount > 1 ? `${doc.frameCount} frames` : '',
        doc.paletteLocked ? 'palette locked' : '',
        Object.keys(doc.stamps).length ? `stamps ${Object.keys(doc.stamps).sort().join(', ')}` : '',
        Object.keys(doc.macros).length ? `macros ${Object.keys(doc.macros).sort().join(', ')}` : '',
        doc.family ? `family ${doc.family.scheme} of ${doc.family.tile}px tiles` : '',
        doc.overlay ? `overlay (${doc.overlay.mode} on ${doc.overlay.on})` : '',
      ].filter(Boolean).map((x) => `; ${x}`).join('') : '';
      lines.push(`  ${a}: ${doc ? `${doc.kind} ${doc.width}x${doc.height}${doc.wrap ? ' wrap' : ''}${doc.cellW < doc.width || doc.cellH < doc.height ? ` cell ${doc.cellW}x${doc.cellH}` : ''}, palette ${doc.palette.name}, ` : ''}${entries.length} commands in ${groups} groups${extra}${notes}`);
    } catch (e) {
      lines.push(`  ${a}: cannot load: ${(e as Error).message}`);
    }
  }
  return lines.join('\n');
}

export function formatNote(n: Note, fresh = false): string {
  const where = n.w === 1 && n.h === 1 ? `${n.x},${n.y}` : `${n.x},${n.y} ${n.w}x${n.h}`;
  return `  ${n.id} at ${where}: ${JSON.stringify(n.text)}${fresh ? '  (new)' : ''}`;
}

/** One asset's changes as text: the lines grouped by author, the notes, and the pixel diff. */
export function formatChanges(c: AssetChanges): string {
  const authors = new Map<string, number>();
  for (const e of c.lines) authors.set(e.by, (authors.get(e.by) ?? 0) + 1);
  const who = [...authors].map(([a, n]) => `${n} by ${a}`).join(', ');
  const out = [`${c.asset}: ${c.lines.length} command${c.lines.length === 1 ? '' : 's'} (${who}) ${c.from > 0 ? `since #${c.from}` : 'on a tape you have not read yet'}; now at #${c.to}`];
  out.push(...c.lines.map((e) => formatEntry(e)));
  if (c.own) out.push(`(${c.own} of your own command${c.own === 1 ? '' : 's'} in the same range are not listed; the diff includes them)`);
  const fresh = new Set(c.newNotes);
  out.push(c.notes.length ? `open notes (${c.notes.length}):` : 'open notes: none');
  out.push(...c.notes.map((n) => formatNote(n, fresh.has(n.id))));
  out.push(`diff ${c.from > 0 ? `#${c.from}` : '(nothing)'} → #${c.to}: ${diffText(c.before, c.after, diffPixels(c.before, c.after))}`);
  return out.join('\n');
}

export interface McpHost {
  writer: Writer;
  /** The watch view's URL, with its token. */
  url(): string;
  /** Open (or create) another project folder and make it the current one. */
  open(dir: string, o: { create: boolean; name?: string }): void;
}

export function createMcpServer(host: McpHost, version: string): McpServer {
  const w = host.writer;
  const server = new McpServer({ name: SERVER_NAME, version }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });

  server.registerTool('project', {
    title: 'Project',
    description: 'Show the open project: its palettes (keys and names), its assets, and the live watch link for the person. ' +
      'With path, open another project folder (create: true makes a new one). With palettes, add palette files (.json, Lospec .json, .hex, .gpl) to the project.',
    inputSchema: z.object({
      path: z.string().optional().describe('A project folder to open (conventionally named *.pclaw)'),
      create: z.boolean().optional().describe('Create the project at path if it does not exist'),
      name: z.string().optional().describe('The new project\'s name (with create)'),
      palettes: z.array(z.string()).optional().describe('Palette files to add to the project'),
    }),
  }, (a) => w.enqueue(() => {
    try {
      if (a.path) host.open(a.path, { create: a.create ?? false, name: a.name });
      if (a.palettes?.length) w.addPalettes(a.palettes.map(readPaletteFile));
      return { content: [text(projectSummary(w, host.url()))] };
    } catch (e) {
      return errorResult(e);
    }
  }));

  server.registerTool('run', {
    title: 'Run commands',
    description: 'Apply command text to an asset as one undo group. Returns the commands as written to the tape (normal form), ' +
      'the pixels changed, warnings, and an optional view. Any parse or semantic error is reported with its line and column, and nothing is applied. ' +
      'To create an asset, start the commands with `new <kind> <name> <W>x<H> ...`. The person watching sees each command play on the canvas.',
    inputSchema: z.object({
      asset: z.string().describe('The asset to draw on (or to create, with a leading `new` command)'),
      commands: z.string().describe('One or more lines of the command language'),
      view: z.enum(VIEW_MODES).optional().describe('Also return this view of the result'),
      replace: z.boolean().optional().describe('With a leading `new` for an existing asset: start its tape again'),
    }),
  }, (a) => w.enqueue(async () => {
    try {
      const r = await w.runAsync({ asset: a.asset, commands: a.commands, by: AGENT, replace: a.replace });
      if (!r.ok) {
        return fail(r.errors.map((e) => `${e.line}:${e.col}: error: ${e.message}`).join('\n') +
          `\n${r.errors.length} error${r.errors.length === 1 ? '' : 's'}; nothing was applied.`);
      }
      const out: string[] = [];
      if (r.added.length === 0) out.push(`${r.asset}: no commands`);
      else {
        out.push(`${r.asset}: applied ${r.added.length} command${r.added.length === 1 ? '' : 's'} as group ${r.group}; ${r.changed} px changed`);
        out.push(...r.added.map((e) => formatEntry(e)));
        out.push(`tape: ${r.commands} commands in ${r.groups} groups`);
      }
      out.push(r.warnings.length ? `warnings: ${r.warnings.join('; ')}` : 'warnings: none');
      // Every frame, unless the canvas is large: then the frame being drawn on (`check` covers all).
      if (r.doc) out.push(checkSummary(w.checks(r.asset, { budget: SUMMARY_BUDGET, focus: ctxOf(r.doc, AGENT).frame }).results));
      const content: CallToolResult['content'] = [text(out.join('\n'))];
      if (a.view && r.doc) {
        const v = w.view(r.asset, a.view, { frame: ctxOf(r.doc, AGENT).frame });
        w.showEye(r.asset, v);
        content.push(...viewContent(v));
      }
      return { content };
    } catch (e) {
      return errorResult(e);
    }
  }));

  server.registerTool('view', {
    title: 'View an asset',
    description: 'Look at an asset. render: a scaled PNG (about 192 px, faint pixel grid, rulers every 8 px). ' +
      'tile3x3: the asset repeated 3x3 at 1x and 4x, for seams and repetition. grid: text, one palette key per pixel, with coordinates and a legend. ' +
      'diff: before and after the latest group (or since a command number) with changed pixels outlined in magenta and notes in yellow, plus the changed pixels as text (up to 60; per frame on animated assets). ' +
      'game: the asset on its ground tile at 1x and at the engine\'s draw scale, beside its other directions (views) and the rest of its set. recolour: role art under several preview themes. ' +
      'anim: a contact sheet of every sequence (tags, views): each frame with its ticks, the frame before it as a tinted onion skin, the pivot and ground line, and the share of pixels changed from the frame before; plus an animated GIF at the game\'s speed saved for the person, and the numbers as text. ' +
      'map: a sample map built with a family\'s autotile scheme (a random island; size and seed choose another), at the game\'s draw scale, with the seam score over it and the variants it used; overlays given in with= play over it (a GIF when anything moves). ' +
      'family: every variant of a family in the middle of the 3x3 map that resolves to it, plus where each cell is on the sheet (for @cell(<name>)). ' +
      'map of a map document: the whole map at 1x (its layers and placements as text), a region of cells or the camera (the engine\'s screen around a cell) at the game\'s draw scale; marks="failing" outlines the cells the map checks flag. ' +
      'map of an object: it stands on its ground among plain tiles at game scale, with its footprint in words. ' +
      'marks="failing" circles every pixel a failing check flags. ' +
      'Images come back inline and are also saved as files; the person watching sees the last image you were shown.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      asset: z.string(),
      mode: z.enum(VIEW_MODES).default('render'),
      scale: z.number().int().min(1).max(64).optional().describe('render only: pixels per pixel'),
      region: z.string().optional().describe('grid: part of the canvas, "x,y WxH" (e.g. "8,0 12x10"); map of a map document: cells to show at game scale'),
      camera: z.string().regex(/^\d+,\d+$/).optional().describe('map of a map document: the camera\'s view around this cell, "x,y" (the screen size is project.json style.camera, default 384x216)'),
      since: z.number().int().min(0).optional().describe('diff only: compare with the document after this command number (default: before the latest group)'),
      frame: z.number().int().min(1).optional().describe('render, grid, tile3x3, game, recolour: the frame to show (default: the frame you are drawing on)'),
      marks: z.string().optional().describe('render, tile3x3, game: circle the pixels checks flag in magenta: "failing", or check names ("orphans,jaggies")'),
      theme: z.string().optional().describe('render, tile3x3, game: show role entries under this preview theme'),
      themes: z.array(z.string()).optional().describe('recolour: the themes to show (default: the first six)'),
      ground: z.string().optional().describe('game: the ground tile (default: the style guide\'s, else the first tile)'),
      with: z.array(z.string()).optional().describe('game: the assets shown beside this one (default: its set: same kind and size). map: overlays to play over the map'),
      size: z.string().optional().describe('map: the map\'s size in tiles, "16x12" (default 12x10)'),
      seed: z.number().int().min(1).optional().describe('map: the random island\'s seed (default 1)'),
    }),
  }, (a) => w.enqueue(() => {
    try {
      const region = a.region ? parseRegion(a.region) : undefined;
      if (region === null) return fail(`error: region must look like "8,0 12x10"`);
      const frame = a.frame !== undefined ? a.frame - 1 : ctxOf(w.doc(a.asset), AGENT).frame;
      const marks = parseMarks(a.marks);
      if (marks === null) return fail(`error: marks must be "failing" or check names (${CHECK_IDS.join(', ')})`);
      const sz = a.size ? /^(\d+)x(\d+)$/.exec(a.size) : null;
      if (a.size && (!sz || Number(sz[1]) < 1 || Number(sz[2]) < 1 || Number(sz[1]) > 128 || Number(sz[2]) > 128)) return fail(`error: size must look like "16x12" (tiles, up to 128 each way)`);
      const size = sz ? { cols: Number(sz[1]), rows: Number(sz[2]) } : undefined;
      const camera = a.camera ? (a.camera.split(',').map(Number) as [number, number]) : undefined;
      const v = w.view(a.asset, a.mode as ViewMode, { scale: a.scale, region, since: a.since, frame, marks, theme: a.theme, themes: a.themes, ground: a.ground, with: a.with, size, seed: a.seed, camera });
      w.showEye(a.asset, v);
      return { content: viewContent(v) };
    } catch (e) {
      return errorResult(e);
    }
  }));

  server.registerTool('history', {
    title: 'Read the tape',
    description: 'Read an asset\'s tape: every command in order with its number, author and undo group. Undone groups are marked. ' +
      'By default the last 50 commands; from/to select by command number. Undo is a command (`undo` or `undo group=g4` through run).',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      asset: z.string(),
      from: z.number().int().optional().describe('First command number'),
      to: z.number().int().optional().describe('Last command number'),
      last: z.number().int().min(1).optional().describe('Only the last N commands of the selection (default 50 when from/to are not given)'),
    }),
  }, (a) => w.enqueue(() => {
    try {
      const last = a.last ?? (a.from === undefined && a.to === undefined ? 50 : undefined);
      const h = w.history({ asset: a.asset, from: a.from, to: a.to, last });
      const undone = new Set(h.undone);
      const head = `${h.asset}: ${h.total} commands in ${h.groups} groups${h.undone.length ? `; undone: ${h.undone.join(', ')}` : ''}` +
        (h.entries.length < h.total ? `; showing ${h.entries.length} (#${h.entries[0]?.seq ?? '-'}..#${h.entries.at(-1)?.seq ?? '-'})` : '');
      return { content: [text([head, ...h.entries.map((e) => formatEntry(e, undone.has(e.group) ? '   (undone)' : ''))].join('\n'))] };
    } catch (e) {
      return errorResult(e);
    }
  }));

  server.registerTool('changes', {
    title: 'What people changed',
    description: 'What people did in the watch view since you last called this: their commands per asset (with author and undo group), ' +
      'the open notes they pinned to pixels or regions, and a diff image per asset (before / after, changed pixels outlined in magenta, notes in yellow) plus its saved path. ' +
      'Your read position then moves to the end, so a second call returns only what is new. Call it at the start of each turn while someone is watching.',
    inputSchema: z.object({
      asset: z.string().optional().describe('Only this asset (default: every asset)'),
      since: z.number().int().min(0).optional().describe('Read from after this command number instead of where you last stopped'),
    }),
  }, (a) => w.enqueue(() => {
    try {
      const all = w.changes(AGENT, { asset: a.asset, since: a.since });
      if (all.length === 0) return { content: [text(`No changes since you last looked${a.asset ? ` at ${a.asset}` : ''}.`)] };
      const content: CallToolResult['content'] = [
        text(`Changes since you last looked: ${all.length} asset${all.length === 1 ? '' : 's'} (${all.map((c) => c.asset).join(', ')}).`),
      ];
      for (const c of all) {
        const v = w.view(c.asset, 'diff', {}, undefined, c.before);
        // A map's diff is of the map as drawn (its cells hold names, not pixels).
        content.push(text(c.after.map && v.kind === 'image' ? formatChanges(c).replace(/\ndiff [^\n]*$/, `\ndiff ${c.from > 0 ? `#${c.from}` : '(nothing)'} → #${c.to}: ${v.text ?? ''}`) : formatChanges(c)));
        w.showEye(c.asset, v);
        if (v.kind === 'image') {
          content.push({ type: 'image', data: Buffer.from(v.png).toString('base64'), mimeType: 'image/png' });
          content.push(text(`diff image: ${v.width}x${v.height} px, saved ${v.path}`));
        }
      }
      return { content };
    } catch (e) {
      return errorResult(e);
    }
  }));

  server.registerTool('check', {
    title: 'Check an asset',
    description: 'Run the quality checks on an asset against the project\'s style guide: each check\'s score, pass or fail, and the exact pixel coordinates it flags. ' +
      'With one asset, also returns its render (tile3x3 for tiles) with the flagged pixels of failing checks circled in magenta. Without an asset, one line per asset. ' +
      `Checks: ${CHECK_IDS.join(', ')}.`,
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      asset: z.string().optional().describe('The asset to check (default: every asset, one summary line each)'),
      checks: z.array(z.enum(CHECK_IDS)).optional().describe('Only these checks (default: all)'),
      frame: z.number().int().min(1).optional().describe('Only this frame (default: every frame; flagged pixels name their frame)'),
      ground: z.string().optional().describe('readability: the ground tile (default: the style guide\'s, else the first tile)'),
      ref: z.string().optional().describe('revert: the reference asset the art must not simply copy'),
      set: z.array(z.string()).optional().describe('readability: the assets its silhouette must differ from (default: same kind and size)'),
      image: z.boolean().optional().describe('Return the image with the flagged pixels (default: true when something fails)'),
    }),
  }, (a) => w.enqueue(() => {
    try {
      if (!a.asset) {
        const lines = w.assets().map((n) => {
          try {
            return `${n}: ${checkSummary(w.checks(n, { checks: a.checks }).results).replace(/^checks: /, '')}`;
          } catch (e) {
            return `${n}: cannot check: ${(e as Error).message}`;
          }
        });
        return { content: [text(lines.length ? lines.join('\n') : 'no assets yet')] };
      }
      const only = a.frame !== undefined ? a.frame - 1 : undefined;
      const { results, problems } = w.checks(a.asset, { checks: a.checks, frame: only, ground: a.ground, ref: a.ref, set: a.set });
      const content: CallToolResult['content'] = [text(formatChecks(a.asset, results, problems, w.doc(a.asset).frameCount > 1 ? only : undefined))];
      const failing = results.filter((r) => r.status === 'fail').map((r) => r.id);
      if (a.image ?? failing.length > 0) {
        // The image shows the frame of the first failing check (or the one asked for).
        const frame = only ?? results.find((r) => r.status === 'fail')?.frame ?? ctxOf(w.doc(a.asset), AGENT).frame;
        const v = w.view(a.asset, w.doc(a.asset).wrap ? 'tile3x3' : 'render', { frame, marks: failing.length ? failing : undefined });
        w.showEye(a.asset, v);
        content.push(...viewContent(v));
      }
      return { content };
    } catch (e) {
      return errorResult(e);
    }
  }));

  server.registerTool('export', {
    title: 'Export through a profile',
    description: 'Write assets out through an export profile (plan §4.9): built-in png (loose PNGs), atlas (a page plus JSON records), tiled (.tsx wang sets per family, .tmx per map), ' +
      'godot (a TileSet with terrains per family), aseprite-json (Aseprite sheets), aseprite (.aseprite files), or the project\'s own (profiles/*.json: naming templates, numbered sets, density pages, role colours, CSV, snippets; docs/profiles.md). ' +
      'Without assets, every asset; a map brings what it draws, an asset its texture variants and density copies. format=split|png|strip|bmfont instead writes one asset on its own (one-cell pieces plus a stamp, a PNG, or a font as a glyph strip or BMFont).',
    inputSchema: z.object({
      profile: z.string().optional().describe('A profile name (see project) or a profile .json path (default png)'),
      assets: z.array(z.string()).optional().describe('The assets to export (default: all)'),
      asset: z.string().optional().describe('With format: the asset'),
      format: z.enum(EXPORT_FORMATS).optional(),
      dest: z.string().optional().describe('The folder to write into, e.g. a game folder (default: <project>/exports/<profile>)'),
    }),
  }, (a) => w.enqueue(() => {
    try {
      if (a.format) {
        if (!a.asset) throw new ProjectError('format= exports one asset: give asset');
        const files = exportAsset(w.doc(a.asset), w.assetDocs(), a.format, a.dest ?? join(w.project.dir, 'exports', a.format));
        return { content: [text(`${a.format}: wrote ${files.length} files\n${files.map((f) => `  ${f}`).join('\n')}`)] };
      }
      const r = exportWithProfile(w.project, w.assetDocs(), a.profile ?? 'png', { names: a.assets ?? (a.asset ? [a.asset] : undefined), dest: a.dest, at: w.stamp() });
      w.planChanged();
      const shown = r.files.length > 24 ? [...r.files.slice(0, 24), `… ${r.files.length - 24} more`] : r.files;
      return { content: [text(`${a.profile ?? 'png'}: ${r.images} images, wrote ${r.files.length} files into ${r.dir}\n${shown.map((f) => `  ${f}`).join('\n')}${r.notes.length ? `\nnotes:\n${r.notes.map((n) => `  ${n}`).join('\n')}` : ''}`)] };
    } catch (e) {
      return errorResult(e);
    }
  }));

  server.registerTool('import', {
    title: 'Import images',
    description: 'Bring art in (plan §4.9, §21). A PNG becomes a new asset quantised to a palette (palette=, default the project\'s; build=true makes one from the image); grid="24x24" slices a sheet into frames ' +
      '(cells=true keeps it one image with that cell grid); slice="24x24" instead cuts a sheet into separate assets, one per non-empty cell (offset="x,y", gap="x,y"), named by pattern ("{name}_{n}", "{name}_{col}_{row}"), names (a list, in reading order), or namesFrom="manifest" (the planned, undrawn entries of set=, in order). ' +
      'A folder (without profile) imports every .png and .aseprite in it. An .aseprite file keeps its layers, frames, durations, tags and views. New assets the manifest does not plan get entries (in set=; manifest=false leaves the manifest alone), and every check is run on each. ' +
      'With profile=, path is a folder a profile wrote: each image is read back by name into the asset it came from and the result says which match the project exactly; images no asset exports become new assets. The new tapes start with import commands; the files are kept under blobs/.',
    inputSchema: z.object({
      path: z.string().describe('A .png or .aseprite file, a folder of them, or (with profile) the folder an export wrote'),
      profile: z.string().optional(),
      as: z.string().regex(/^[a-z][a-z0-9_-]*$/).optional().describe('The new asset\'s name (one file; default: the file\'s)'),
      kind: z.enum(['sprite', 'tile', 'object', 'icon', 'sheet']).optional(),
      palette: z.string().optional(),
      build: z.boolean().optional(),
      grid: z.string().regex(/^\d+x\d+$/).optional(),
      cells: z.boolean().optional(),
      slice: z.string().regex(/^\d+x\d+$/).optional().describe('Cut the sheet into assets of this cell size'),
      offset: z.string().regex(/^\d+,\d+$/).optional(),
      gap: z.string().regex(/^\d+,\d+$/).optional(),
      pattern: z.string().optional(),
      names: z.array(z.string().regex(/^[a-z][a-z0-9_-]*$/)).optional(),
      namesFrom: z.enum(['manifest']).optional(),
      set: z.string().optional().describe('The manifest set for new entries (and for namesFrom)'),
      wrap: z.boolean().optional().describe('Tiles: on a wrapping canvas'),
      manifest: z.boolean().optional().describe('Add manifest entries for the new assets (default: when there is a manifest)'),
      replace: z.boolean().optional().describe('Start an existing asset\'s tape again'),
    }),
  }, (a) => w.enqueue(() => {
    try {
      const pair = (v: string | undefined, sep: string) => (v ? (v.split(sep).map(Number) as [number, number]) : undefined);
      if (!a.profile) {
        const r = importIntoProject(w, {
          ...a, grid: pair(a.grid, 'x'), slice: a.slice ? { cell: pair(a.slice, 'x')!, offset: pair(a.offset, ','), gap: pair(a.gap, ',') } : undefined,
        }, AGENT);
        return { content: [text(r.text || 'nothing to import')] };
      }
      const plan = planImport(w.project, w.assetDocs(), { ...a, grid: pair(a.grid, 'x'), slice: undefined });
      const created: string[] = [];
      for (const c of plan.create) {
        const r = w.run({ asset: c.name, commands: c.tape, by: AGENT, replace: a.replace });
        if (!r.ok) throw new ProjectError(`${c.name}: ${r.errors.map((e) => `${e.line}:${e.col} ${e.message}`).join('; ')}`);
        created.push(c.name);
      }
      return { content: [text(importSummary(plan, created) || 'nothing to import')] };
    } catch (e) {
      return errorResult(e);
    }
  }));

  server.registerTool('work', {
    title: 'Work on requests',
    description: 'The request queue (plan §21): what people asked for in the dashboard (draw a planned asset, change a drawn one, a new asset). ' +
      'With no action (or action "next"), claim the next open request (or the one named by id) and get what is asked, with the asset\'s plan entry and status. ' +
      'action "progress" posts a short note the person sees; "done" finishes it with what changed; "blocked" stops it with one clear question for the person (they answer in the dashboard and it opens again). ' +
      '"list" shows every request still open, claimed or blocked. Take requests before planned work; call plan after each one.',
    inputSchema: z.object({
      action: z.enum(['next', 'progress', 'done', 'blocked', 'list']).optional(),
      id: z.string().regex(/^r\d+$/).optional().describe('A request id (default: the next open one, or the one you claimed)'),
      text: z.string().optional().describe('progress: a short note; done: what changed; blocked: the question'),
    }),
  }, (a) => w.enqueue(() => {
    try {
      const action = a.action ?? 'next';
      if (action === 'list') {
        const active = openRequests(readRequests(w.project));
        return { content: [text(active.length ? active.map((q) => requestLine(q)).join('\n') : 'no open requests')] };
      }
      const r = action === 'next' ? agentWork(w, AGENT, { action, id: a.id }) : agentWork(w, AGENT, { action, id: a.id, text: a.text ?? '' });
      w.requestsChanged();
      if (!r.request) return { content: [text(`${r.message}. Carry on with the plan (call plan for what is left).`)] };
      const q = r.request;
      if (action !== 'next') {
        const left = openRequests(readRequests(w.project)).filter((x) => x.state === 'open').length;
        return { content: [text(`${r.message}${action === 'progress' ? '' : `. ${left ? `${left} open request${left === 1 ? '' : 's'} left: call work for the next.` : 'No open requests left.'}`}`)] };
      }
      return { content: [text(`${r.message}\n${requestBrief(w, q)}`)] };
    } catch (e) {
      return errorResult(e);
    }
  }));

  server.registerTool('review', {
    title: 'Write a blind review bundle',
    description: 'Write a review bundle for a fresh-context reviewer (plan §5): each asset at game scale and with rulers for coordinates, tiles repeated 3x3, ' +
      'sprites on their ground beside their set, autotile families on a map (size and seed choose it) and every variant among its neighbours, the palette, the style guide and a rubric (readability, cohesion, seams, style-guide fit, defects with coordinates). ' +
      'It names no method and no author, so the reviewer judges blind. Hand the folder to a new agent with no other context, ask it to follow rubric.md, ' +
      'then pin its findings on the pixels with note commands.',
    inputSchema: z.object({
      assets: z.array(z.string()).optional().describe('The assets to review (default: all, or the set\'s)'),
      set: z.string().optional().describe('A set from the manifest: its assets (drawn so far) are reviewed'),
      name: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/).optional().describe('A name for the set, used in the folder name (default: the set, else all)'),
      size: z.string().regex(/^\d+x\d+$/).optional().describe('Families: the map\'s size in tiles (default 16x12)'),
      seed: z.number().int().min(1).optional().describe('Families: the random island\'s seed (default 1)'),
    }),
  }, (a) => w.enqueue(() => {
    try {
      const [cols, rows] = a.size ? a.size.split('x').map(Number) : [undefined, undefined];
      const r = writeReview(w, { assets: a.assets, set: a.set, name: a.name, map: { cols, rows, seed: a.seed } });
      return { content: [text(`review bundle: ${r.dir}\n${r.files.length} files: ${r.files.join(', ')}\nGive the folder to a fresh agent: "Review the art in ${r.dir} by following rubric.md in it."`)] };
    } catch (e) {
      return errorResult(e);
    }
  }));

  server.registerTool('plan', {
    title: 'The plan: manifest and statuses',
    description: 'The project\'s asset plan (plan §7.3) and where each asset stands: planned → drafted (exists) → checked (every check passes) → reviewed (`mark reviewed` after a blind review\'s findings are dealt with) → ' +
      'approved (a person, in the dashboard) → exported (through a profile, with the art as it is now). Lists what is left and what is failing, by set. ' +
      'manifest= writes manifest.json (checked against its schema first; nothing is written if it has problems): { "format": "pixelclaw-manifest", "version": 1, "theme": "…", "sets": {…}, "export": { "profile": "…" }, ' +
      '"assets": [{ "name", "kind", "size", "set", "description", "palette", "scheme", "inside", "outside", "band", "frames", "ticks", "views", "mirror", "cells", "height", "variantOf", "recolourOf", "uses", "flat" }] } (docs/pipeline.md). ' +
      'A planned asset\'s `new` line may leave out its size, palette and scheme: the manifest fills them in. templates=true draws the flat templates (a mockup screen and a coverage map per family) into templates/.',
    inputSchema: z.object({
      set: z.string().optional().describe('Only this set'),
      manifest: z.record(z.string(), z.unknown()).optional().describe('Write this manifest (validated)'),
      templates: z.boolean().optional().describe('Draw the flat templates from the manifest'),
      seed: z.number().int().min(1).optional().describe('Templates: the layout\'s seed (default 1)'),
      order: z.enum(['set', 'scene']).optional().describe('List the work by set (default) or scene by scene (what each scene still needs)'),
    }),
  }, (a) => w.enqueue(() => {
    try {
      const content: CallToolResult['content'] = [];
      if (a.manifest) {
        const r = writeManifest(w.project, a.manifest);
        if (!r.manifest) return fail(`the manifest was not written; ${r.errors.length} problem${r.errors.length === 1 ? '' : 's'}:\n${r.errors.map((e) => `  ${e.path || '(top)'}: ${e.message}`).join('\n')}`);
        content.push(text(`wrote manifest.json: ${r.manifest.assets.length} assets`));
        w.planChanged();
      }
      if (a.templates) {
        const t = writeTemplates(w, { seed: a.seed });
        content.push(text(`templates in ${t.dir}: ${t.files.join(', ')}`));
        content.push({ type: 'image', data: readFileSync(`${t.dir}/mockup@2x.png`).toString('base64'), mimeType: 'image/png' });
        content.push(text(readFileSync(`${t.dir}/mockup.txt`, 'utf8')));
      }
      content.push(text(planText(planReport(w, { set: a.set }), { order: a.order })));
      content.push(text(`the dashboard (for the person): ${host.url()}&tab=dashboard`));
      return { content };
    } catch (e) {
      return errorResult(e);
    }
  }));

  return server;
}

function requestLine(q: WorkRequest): string {
  const what = q.kind === 'draw' ? `draw ${q.asset}` : q.kind === 'change' ? `change ${q.asset}` : `new asset ${q.asset}`;
  const state = q.state === 'claimed' ? `claimed by ${q.claimedBy}` : q.state === 'blocked' ? `blocked: "${q.question}"` : q.state;
  return `${q.id} ${what}${q.note ? `: "${q.note}"` : ''} (from ${q.by} at ${q.at}; ${state})`;
}

/** What a claimed request asks, with what the project knows about its asset. */
function requestBrief(w: Writer, q: WorkRequest): string {
  const out = [requestLine(q)];
  const e = manifestEntry(readManifest(w.project).manifest, q.asset);
  if (e) out.push(`plan: ${q.asset} is a ${e.kind} ${e.size}${e.set ? ` in set ${e.set}` : ''}${e.description ? `: ${e.description}` : ''}${e.height ? ` (drawn height ${e.height} px)` : ''}`);
  const a = planReport(w).assets.find((x) => x.name === q.asset);
  if (a) out.push(`status: ${a.status} → ${a.next}${a.failing.length ? `; failing: ${a.failing.join(', ')}` : ''}${a.flags.length ? `; ${a.flags.join('; ')}` : ''}`);
  if (q.kind === 'draw' || q.kind === 'new') out.push(`Draw it: run with \`new ${e?.kind ?? 'sprite'} ${q.asset}\` (the manifest fills in its size and palette), look, check, fix; then work(action="done", text=<what you drew>).`);
  else out.push(`Change it as asked (the request is also a \`mark rejected\` on its tape${q.mark ? ` at #${q.mark}` : ''}; \`changes\` shows the person's edits and notes); then work(action="done", text=<what changed>).`);
  if (q.events.some((x) => x.type === 'reply')) out.push(`The person answered: "${q.events.filter((x) => x.type === 'reply').at(-1)!.text}"`);
  out.push('If you cannot go on without the person, work(action="blocked", text=<one clear question>).');
  return out.join('\n');
}

/** "failing" or a comma list of check names; undefined for none, null when something is not a check. */
function parseMarks(s: string | undefined): CheckResult['id'][] | 'failing' | undefined | null {
  if (!s) return undefined;
  if (s.trim() === 'failing') return 'failing';
  const ids = s.split(',').map((x) => x.trim()).filter(Boolean);
  return ids.every((x) => (CHECK_IDS as readonly string[]).includes(x)) ? (ids as CheckResult['id'][]) : null;
}
