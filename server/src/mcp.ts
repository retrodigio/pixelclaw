// The MCP tools (plan §8.2): project, run, view and history. Few tools; the command language
// carries the rest. Every call goes through the writer's queue, in the order it arrives.

import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { TapeEntry } from '@pixelclaw/core';
import { ProjectError, listAssets, readPaletteFile } from './project.ts';
import { VIEW_MODES, parseRegion, type View, type ViewMode } from './views.ts';
import type { Writer } from './writer.ts';

export const SERVER_NAME = 'pixelclaw';

export const INSTRUCTIONS = `Pixel Claw is a pixel art editor you drive with a small command language. All art is indexed colour (every pixel is a palette entry).

Start with the \`project\` tool: it lists palettes and assets, and gives a watch link (http://127.0.0.1:…/?token=…). Give the person that link so they can watch you draw live.

Draw with \`run\` (one batch = one undo group; any error applies nothing). Look with \`view\` (render: scaled PNG with grid and rulers; tile3x3: seams and repetition; grid: exact palette keys per pixel). Read the tape with \`history\`.

Commands (one per line, or ';' between them; '#' comments):
  new tile|sprite|sheet|icon <name> <W>x<H> [palette=<p>] [wrap=on|off] [cell=WxH] [bg=<colour>]
  px <x,y> [<x,y>...] c=<colour>
  line <x,y> <x,y> [<x,y>...] c=<colour> [pp=on|off]      pixel-perfect lines and polylines
  rect <x,y> <W>x<H> c=<colour> [outline|fill]
  ellipse <cx,cy> r=<RX>x<RY> c=<colour> [outline|fill]    or: ellipse <x,y> <W>x<H> ...
  fill <x,y> c=<colour> [mode=contiguous|global] [conn=4|8]
  paint <x,y> <<            rows of palette keys; '.' leaves a pixel, a space clears it
    ..kk..
  >>
  undo [group=<g>]
Colours: an entry name (c=stone3), its key (c=3), its exact hex, or none. Coordinates wrap on wrap=on documents (tiles by default). @cell(cx,cy) after a command name offsets it to a cell of the cell grid.

Habits: after each meaningful batch, look once at an image (render or tile3x3), and use the grid to check exact pixels. Never judge a tile alone when it will be seen tiled.`;

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
  const assets = listAssets(p);
  lines.push('', assets.length ? `assets (${assets.length}):` : `assets: none yet. Create one with run(asset, "new tile <name> 24x24 ...").`);
  for (const a of assets) {
    try {
      const { doc, entries } = w.state(a);
      const groups = new Set(entries.map((e) => e.group)).size;
      lines.push(`  ${a}: ${doc ? `${doc.kind} ${doc.width}x${doc.height}${doc.wrap ? ' wrap' : ''}${doc.cellW < doc.width || doc.cellH < doc.height ? ` cell ${doc.cellW}x${doc.cellH}` : ''}, palette ${doc.palette.name}, ` : ''}${entries.length} commands in ${groups} groups`);
    } catch (e) {
      lines.push(`  ${a}: cannot load: ${(e as Error).message}`);
    }
  }
  return lines.join('\n');
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
  }, (a) => w.enqueue(() => {
    try {
      const r = w.run({ asset: a.asset, commands: a.commands, by: 'claude', replace: a.replace });
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
      const content: CallToolResult['content'] = [text(out.join('\n'))];
      if (a.view && r.doc) {
        const v = w.view(r.asset, a.view);
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
      'Images come back inline and are also saved as files; the person watching sees the last image you were shown.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      asset: z.string(),
      mode: z.enum(VIEW_MODES).default('render'),
      scale: z.number().int().min(1).max(64).optional().describe('render only: pixels per pixel'),
      region: z.string().optional().describe('grid only: part of the canvas, "x,y WxH" (e.g. "8,0 12x10")'),
    }),
  }, (a) => w.enqueue(() => {
    try {
      const region = a.region ? parseRegion(a.region) : undefined;
      if (region === null) return fail(`error: region must look like "8,0 12x10"`);
      const v = w.view(a.asset, a.mode as ViewMode, { scale: a.scale, region });
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

  return server;
}
