// pixelclaw: new | run | view | check | review | plan | request | reply | cancel | work (its actions) | export | import | verify | upgrade | skill (work start and serve: entry.ts). A thin layer over @pixelclaw/core and the project folder.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHECK_IDS, LANG_VERSION, TapeCursor, openRequests, tapeLang, Timeline, checkSummary, isCheckId, replay, serializeDoc, serializeDocV1, upgradeTape, type AssetState, type CheckId, type Doc,
  type TapeEntry,
} from '@pixelclaw/core';
import {
  AssetExistsError, NoAssetError, ProjectError, VIEW_MODES, Writer, assetDir, checkpointNames, createProject, formatChecks, isViewMode, listAssets,
  findServer, loadProject, lockHolder, paletteSource, parseRegion, prefixHash, previewPng, readAssetJson, readCheckpoints, readPaletteFile,
  needsUnderlay, resolveUnderlays, formatSeeds, readTape, readTapeFile, readStateCacheRaw, stateKey, saveAsset, sha256, writeReview, planReport, planText, writeManifest, writeTemplates, SUMMARY_BUDGET, EXPORT_FORMATS, exportAsset, exportWithProfile, importIntoProject, importSummary, planImport, personRequest, readRequests, requestLine, toPersonRequest, agentWork, cliSteps, requestBrief, shellArg, type ExportFormat, type Project, type ViewMode,
} from '@pixelclaw/server';

export interface Io {
  out(s: string): void;
  err(s: string): void;
  stdin(): string;
  now(): string;
  /** Set when the command runs inside a server (a CLI call sent to it): its writer is used instead of a new one. */
  writer?: Writer;
}

const nodeIo: Io = {
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
  stdin: () => readFileSync(0, 'utf8'),
  now: () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
};

export const USAGE = `pixelclaw: a pixel art editor driven by commands

  pixelclaw new <project> [--name <name>] [--palette <file.json|.hex|.gpl>]... [--grid <px>]
      Create a project folder. The first palette becomes the default. --grid is the tile size
      (default 24): new maps, the camera (16x9 cells) and the draw scale (1x from 48 px) follow it.
  pixelclaw new <project> <kind> <name> <W>x<H> [palette=..] [wrap=on|off] [cell=WxH] [bg=..] [--replace]
      Create an asset (kinds: tile, sprite, sheet, icon, object, map, …). Same as running a 'new' command.
  pixelclaw run <project> (<script.pclaw> | - | -e "<commands>") [--asset <name>] [--replace] [--by <author>] [--view <mode>]
      Apply commands as one undo group. Any error applies nothing. --dry applies them to a copy,
      prints the checks and keeps nothing.
      A script that starts with 'new' creates the asset (--replace starts its tape again).
      underlay generate|import lines are resolved first (an image provider, the key from
      OPENAI_API_KEY, a cost cap per call, logs/underlay-costs.jsonl; or a PNG file).
  pixelclaw seeds <project> <asset> <generator line> [--count 8] [--from 1 | --seeds 3,7,9] [--checks a,b] [--before "<commands>"] [--apply]
      Try the line (noise, scatter, voronoi, bricks, map gen, family coverage, …) with each seed as a
      dry run and rank the seeds by the checks; --apply runs the best one.
  pixelclaw view <project> <asset> [render|grid|tile3x3|diff|game|recolour|anim|map|family|density|all]... [--scale N] [--region x,y,WxH] [--frame N] [--out <dir>]
         [--marks failing|<check>,...] [--theme <name>] [--themes a,b,c] [--ground <tile>] [--with <asset>]... [--size CxR] [--seed N] [--camera x,y]
      Write views (default: <project>/views/<asset>.<mode>.png|txt). The grid is also printed.
      diff shows what the latest group changed; game shows a sprite on its ground at 1x and the
      draw scale beside its set; recolour shows role art under preview themes; map puts a family
      on a random island (--size, --seed; overlays --with) with the seam score; family shows each
      variant among its neighbours; all is render, grid and tile3x3. --marks circles the pixels
      checks flag. map of a map document: the whole map at 1x, --region x,y,WxH (cells) or
      --camera x,y (the engine's screen around a cell) at game scale; of an object: on its ground.
  pixelclaw check <project> [<asset>...] [--checks a,b] [--frame N] [--ground <tile>] [--ref <asset>] [--marks]
      Run the quality checks against the style guide (project.json style): scores, pass or fail,
      and the flagged pixels. Exits 1 if any check fails. --marks writes the render (tile3x3 for
      tiles) with the flagged pixels circled.
  pixelclaw review <project> [<asset>...] [--set <manifest set>] [--name <name>] [--size CxR] [--seed N]
      Write a blind review bundle under <project>/reviews/<date>-<name>/ (rubric.md inside; brief.md
      from the manifest). --set reviews a manifest set's drawn assets.
  pixelclaw plan <project> [--set <set>] [--order set|scene] [--json] [--manifest <file.json>] [--templates [--seed N]]
      The asset plan (manifest.json) and each asset's status: planned, drafted, checked, reviewed,
      approved, exported; requests from people first; what is left and what is failing (by set, or
      scene by scene with what each still needs). --manifest writes a manifest (checked first);
      --templates draws the flat templates (mockup screen, coverage maps) into templates/.
  pixelclaw request <project> [draw <asset> | change <asset> --note "<what>" | add <name> --kind <k> --size WxH [--set <s>] [--description "…"] [--height N]] [--note "…"] [--by <author>]
      Ask for work as the dashboard does: draw a planned asset, change a drawn one (also writes
      mark rejected "<note>" on its tape), or add a new asset (its manifest entry, validated first).
      Without a kind, lists the requests still open, claimed or blocked (open ones say seen by
      <agent> once an agent has been handed them). While a server runs it is sent to that server.
  pixelclaw reply <project> <id> "<answer>" [--by <author>]      answer a blocked request (it opens again)
  pixelclaw cancel <project> <id> ["<why>"] [--by <author>]       withdraw a request
  pixelclaw work <project> list | claim [<id>] | progress [<id>] "<note>" | block [<id>] "<question>" | done [<id>] "<what changed>" [--by <agent>]
      An agent's side of the request queue, for a session without PixelClaw's MCP tools (the MCP
      work tool does the same): list hands over the open requests (the cards say seen by
      <agent>), claim takes the next open one or <id> and prints what is asked, progress posts a
      note the person sees, block stops it with one clear question, done finishes it with what
      changed (only when the asset passes its checks). After claim the id may be left out. Any
      error applies nothing. --by names the agent (default claude). With a server running these
      go through it, so the dashboard's cards move live and the agent shows as listening.
  pixelclaw work <project> start [--port N]      (also: pixelclaw work <project> [--port N])
      Work the request queue with a headless Claude Code session (claude -p with the PixelClaw MCP
      server and the skill) until it is empty or the budget cap is reached. Runs only when
      project.json has "worker": { "enabled": true } (it spends money; cap, command and args are
      settings there; docs/worker.md). Never two at once; with a server running, use its
      dashboard's Start Claude button instead. The log is logs/worker.log (shown in the dashboard).
  pixelclaw skill install [--dest <dir> | --project <dir>]
      Install the Claude Code skill (workflows, house rules, the blind-review hand-off) into
      ~/.claude/skills/pixelclaw (or <dir>/.claude/skills/pixelclaw). skill path prints where it is.
  pixelclaw export <project> [<asset>...] [--profile <name|file.json>] [--out <dir>]
      Write assets through an export profile (default png): built-in png, atlas, tiled, godot,
      aseprite-json, aseprite, or the project's profiles/*.json (docs/profiles.md). Without assets,
      all; a map brings what it draws. Default folder: <project>/exports/<profile>/.
  pixelclaw export <project> <asset> --format split|png|strip|bmfont [--out <dir>]
      split: an oversized asset as one-cell pieces plus a stamp; png: a map at 1x or a first frame;
      strip: a font as a glyph strip (red separator columns) plus its characters; bmfont: a font as .fnt + page.
  pixelclaw import <project> <file.png|file.aseprite|folder> [--profile <name>] [--as <name>] [--kind <kind>]
         [--palette <name> | --build] [--grid WxH [--cells]] [--slice WxH [--offset x,y] [--gap x,y]]
         [--pattern '{name}_{n}' | --names a,b,c | --names-from manifest] [--set <set>] [--wrap] [--no-manifest] [--by <author>] [--replace]
      A PNG or .aseprite file becomes a new asset quantised to a palette (--build: one made from
      the image); --grid slices a sheet into frames (--cells: one image with that cell grid);
      --slice cuts a sheet into separate assets, one per non-empty cell, named by a pattern, a
      list, or the manifest's planned entries (of --set) in order. A folder imports every PNG and
      .aseprite in it. New assets get manifest entries (in --set) and every check is run. With
      --profile, a folder an export wrote is read back by name and compared with the project;
      images no asset exports become new assets.
  pixelclaw upgrade <project> [<asset>...]
      Rewrite language 1 tapes in the current language: the palette goes into the 'new'
      line. Each is replayed before and after; it is written only if the pixels are the same.
  pixelclaw verify <project> [<asset>...]
      Replay every tape and compare with asset.json, preview.png and checkpoints.
  pixelclaw await <project-folder | watch-url> [--timeout <seconds>, default 600] [--since <cursor>] [--as <name>] [--json]
      Wait on the running server for what people ask in the dashboard (a request, a reply, a
      withdrawn request, or an approval, rejection or review mark), print the events with their
      next step (work claims a request; changes reads a change) and a cursor, then EXIT. Run it in
      the background and restart it with --since <cursor> after each exit: its exit is what wakes
      an agent. Exit 0 with events, 3 on timeout, 1 if no server can be reached. Requests handed
      over are recorded as seen by --as (default claude). Works with serve --no-mcp.
  pixelclaw serve --project <project> [--port 7417] [--no-mcp]
      Own the project: MCP on stdin/stdout for the agent, and the live watch view on
      http://127.0.0.1:<port>/?token=... (printed to stderr). Creates the project if needed.

While a server runs (pixelclaw serve): commands that write (new, run, seeds --apply, export,
import, review, plan --manifest/--templates, request, reply, cancel, work) are sent to it over HTTP,
found through the project's lock and a token file only you can read, so they go through its
writer and a connected dashboard updates live. Read-only commands read the files. If the server
cannot be reached the command runs directly. upgrade still needs the server stopped.

Command reference: docs/commands.md
`;

export class UsageError extends Error {}

/** The writer a command writes through: the server's own when it was sent to one, else a new one on the folder. */
function wr(io: Io, proj: Project): Writer {
  return io.writer ?? new Writer(proj, { now: io.now });
}

export interface Parsed {
  pos: string[];
  flags: Map<string, string[]>;
}

export function parseArgs(argv: string[], valued: string[], bare: string[]): Parsed {
  const pos: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('-') && a !== '-') {
      const name = a.replace(/^--?/, '');
      if (valued.includes(name)) {
        const v = argv[++i];
        if (v === undefined) throw new UsageError(`${a} needs a value`);
        flags.set(name, [...(flags.get(name) ?? []), v]);
      } else if (bare.includes(name)) flags.set(name, ['']);
      else throw new UsageError(`unknown option ${a}`);
    } else pos.push(a);
  }
  return { pos, flags };
}

export const one = (p: Parsed, k: string): string | undefined => p.flags.get(k)?.at(-1);

function printErrors(io: Io, source: string, errors: { line: number; col: number; message: string }[]): void {
  for (const e of errors) io.err(`${source}:${e.line}:${e.col}: error: ${e.message}\n`);
  io.err(`${errors.length} error${errors.length === 1 ? '' : 's'}; nothing was applied.\n`);
}

function cmdNewProject(io: Io, dir: string, p: Parsed): number {
  const palettes = (p.flags.get('palette') ?? []).map(readPaletteFile);
  const g = one(p, 'grid');
  if (g !== undefined && (!/^\d+$/.test(g) || Number(g) < 4 || Number(g) > 256)) throw new UsageError('new: --grid is the tile size in pixels, 4..256');
  const proj = createProject(dir, { name: one(p, 'name'), palettes, ...(g !== undefined ? { grid: Number(g) } : {}) });
  io.out(`created project '${proj.json.name}' at ${dir}\n`);
  for (const pal of proj.palettes.values()) io.out(`  palette ${pal.name}: ${pal.entries.length} entries${pal.name === proj.json.defaultPalette ? ' (default)' : ''}\n`);
  return 0;
}

function loadState(proj: Project, name: string): AssetState {
  return new Writer(proj).state(name);
}

/** A running server is the single writer for its project; the CLI does not write behind its back. */
function assertNoServer(proj: Project): void {
  const held = lockHolder(proj.dir);
  if (held) throw new ProjectError(`a pixelclaw server (pid ${held.pid}) owns ${proj.dir} and the command could not be sent to it (its token file must be readable by you); send commands through it (MCP: run, export, import, request; or its dashboard), or stop it first`);
}

function apply(io: Io, proj: Project, text: string, source: string, o: { asset?: string; replace: boolean; by: string; dry?: boolean }): { code: number; doc?: Doc } {
  const w = wr(io, proj);
  if (o.dry) return applyDry(io, w, text, source, o);
  assertNoServer(proj);
  let r;
  try {
    r = w.run({ asset: o.asset, commands: text, by: o.by, replace: o.replace });
  } catch (e) {
    if (e instanceof NoAssetError) { io.err(`error: say which asset with --asset <name> (or start the script with 'new')\n`); return { code: 1 }; }
    if (e instanceof AssetExistsError) { io.err(`error: asset '${e.asset}' already exists; use --replace to start its tape again\n`); return { code: 1 }; }
    throw e;
  }
  if (!r.ok) { printErrors(io, source, r.errors); return { code: 1 }; }
  if (!r.doc) { io.out('nothing to do\n'); return { code: 0 }; }
  if (r.added.length === 0) { io.out(`${r.asset}: no commands\n`); return { code: 0, doc: r.doc }; }
  io.out(`${r.asset}: applied ${r.added.length} command${r.added.length === 1 ? '' : 's'} as group ${r.group}; ${r.changed} px changed\n`);
  io.out(`  tape: ${r.commands} commands in ${r.groups} group${r.groups === 1 ? '' : 's'}; preview: ${join(r.dir!, 'preview.png')}\n`);
  for (const wn of r.warnings) io.out(`  warning: ${wn}\n`);
  if (r.followed?.length) io.out(`  brought up to date: ${r.followed.join(', ')} (variants that inherit the band, families whose textures came from=${r.asset})\n`);
  io.out(`  ${checkSummary(w.checks(r.asset, { budget: SUMMARY_BUDGET }).results)}\n`);
  return { code: 0, doc: r.doc };
}

/** `run --dry`: apply to a copy, check it, keep nothing (safe while a server owns the project). */
function applyDry(io: Io, w: Writer, text: string, source: string, o: { asset?: string; replace: boolean; by: string }): { code: number; doc?: Doc } {
  if (needsUnderlay(text)) throw new UsageError('run --dry: a dry run cannot call the image provider (underlay generate/import)');
  let r;
  try {
    r = w.dry({ asset: o.asset, commands: text, by: o.by, replace: o.replace });
  } catch (e) {
    if (e instanceof NoAssetError) { io.err(`error: say which asset with --asset <name> (or start the script with 'new')\n`); return { code: 1 }; }
    if (e instanceof AssetExistsError) { io.err(`error: asset '${e.asset}' already exists; use --replace to try starting its tape again\n`); return { code: 1 }; }
    throw e;
  }
  if (!r.ok) { printErrors(io, source, r.errors); return { code: 1 }; }
  io.out(`${r.asset}: dry run of ${r.added.length} command${r.added.length === 1 ? '' : 's'}; ${r.changed} px would change; nothing was kept\n`);
  for (const wn of r.warnings) io.out(`  warning: ${wn}\n`);
  if (r.doc) io.out(`  ${checkSummary(r.results)}\n`);
  return { code: 0, doc: r.doc ?? undefined };
}

function cmdSeeds(io: Io, p: Parsed): number {
  const [dir, asset, ...line] = p.pos;
  if (!dir || !asset || !line.length) throw new UsageError('seeds: give a project, an asset and a generator line');
  const proj = loadProject(dir);
  const num = (k: string) => { const v = one(p, k); if (v === undefined) return undefined; const n = Number(v); if (!Number.isInteger(n) || n < 1) throw new UsageError(`--${k} must be a whole number from 1`); return n; };
  const checks = one(p, 'checks')?.split(',');
  for (const c of checks ?? []) if (!isCheckId(c)) throw new UsageError(`unknown check '${c}' (checks: ${CHECK_IDS.join(', ')})`);
  const seeds = one(p, 'seeds')?.split(',').map(Number);
  const w = wr(io, proj);
  const by = one(p, 'by') ?? 'claude';
  const before = one(p, 'before');
  const r = w.seeds({ asset, line: line.join(' '), before, by, count: num('count'), from: num('from'), seeds, checks: checks as CheckId[] | undefined });
  if (!r.ok) { printErrors(io, '<line>', r.errors); return 1; }
  io.out(formatSeeds(asset, r.trials) + '\n');
  if (!p.flags.has('apply') || !r.trials[0]) return 0;
  const best = r.trials[0];
  return apply(io, proj, before ? `${before}\n${best.line}` : best.line, '<seeds>', { asset, replace: false, by }).code;
}

function cmdNewAsset(io: Io, dir: string, p: Parsed): number {
  const proj = loadProject(dir);
  const text = 'new ' + p.pos.slice(1).join(' ');
  return apply(io, proj, text, '<new>', { replace: p.flags.has('replace'), by: one(p, 'by') ?? 'claude' }).code;
}

function cmdRun(io: Io, p: Parsed): number {
  const [dir, script] = p.pos;
  if (!dir) throw new UsageError('run: give a project folder');
  const proj = loadProject(dir);
  let text: string;
  let source: string;
  const inline = p.flags.get('e');
  if (inline) {
    if (script) throw new UsageError('run: give a script or -e, not both');
    text = inline.join('\n');
    source = '<-e>';
  } else if (script === '-') {
    text = io.stdin();
    source = '<stdin>';
  } else if (script) {
    if (!existsSync(script)) throw new UsageError(`run: no such script ${script}`);
    text = readFileSync(script, 'utf8');
    source = script;
  } else throw new UsageError('run: give a script file, - for stdin, or -e "<commands>"');
  const r = apply(io, proj, text, source, { asset: one(p, 'asset'), replace: p.flags.has('replace'), by: one(p, 'by') ?? 'claude', dry: p.flags.has('dry') });
  if (r.code === 0 && r.doc && p.flags.has('view')) return writeViews(io, proj, r.doc, p.flags.get('view')!, p);
  return r.code;
}

/** The options of the commands that write (valued, bare): the CLI uses them to send a command to a running server. */
export const WRITE_OPTS: Record<string, [string[], string[]]> = {
  new: [['name', 'palette', 'by', 'grid'], ['replace']],
  run: [['asset', 'by', 'e', 'view', 'scale', 'region', 'out', 'frame', 'marks', 'theme', 'themes', 'ground', 'with', 'size', 'seed', 'camera'], ['replace', 'dry']],
  seeds: [['count', 'from', 'seeds', 'checks', 'before', 'by'], ['apply']],
  export: [['format', 'out', 'profile'], []],
  import: [['profile', 'as', 'kind', 'palette', 'grid', 'by', 'slice', 'offset', 'gap', 'pattern', 'names', 'names-from', 'set'], ['build', 'cells', 'replace', 'wrap', 'no-manifest']],
  review: [['name', 'set', 'size', 'seed'], []],
  plan: [['set', 'manifest', 'seed', 'order'], ['json', 'templates']],
  request: [['note', 'by', 'kind', 'size', 'set', 'description', 'height'], []],
  reply: [['by'], []],
  cancel: [['by'], []],
  work: [['by', 'port'], []],
};

/** `pixelclaw work <project> <action>`: the MCP work tool's actions, for an agent with no MCP. */
export const WORK_ACTIONS = ['list', 'claim', 'progress', 'block', 'done'];

/** Whether a `work` command line starts the headless worker (`work <project> start`, or the older `work <project>`). */
export function startsWorker(argv: string[]): boolean {
  if (argv[0] !== 'work') return false;
  let p: Parsed;
  try { p = parseArgs(argv.slice(1), ...WRITE_OPTS.work!); } catch { return true; }
  return p.pos[1] === undefined || p.pos[1] === 'start';
}

const RUN_OPTS = WRITE_OPTS.run![0];

/**
 * `run` with `underlay generate` or `underlay import` lines: those call an image provider or read
 * a file, so they are resolved (asynchronously) before the batch runs; the run then takes the
 * rewritten text as -e. Returns argv unchanged when there is nothing to resolve.
 */
export async function resolveRunArgv(argv: string[], io: Io = nodeIo): Promise<string[]> {
  if (argv[0] !== 'run') return argv;
  let p: Parsed;
  try { p = parseArgs(argv.slice(1), ...WRITE_OPTS.run!); } catch { return argv; }
  const [dir, script] = p.pos;
  if (!dir || p.flags.has('dry')) return argv;
  const inline = p.flags.get('e');
  const text = inline ? inline.join('\n') : script === '-' ? io.stdin() : script && existsSync(script) ? readFileSync(script, 'utf8') : null;
  if (text === null || (!needsUnderlay(text) && script !== '-')) return argv;
  const proj = loadProject(dir);
  // With a server up the run is sent to it afterwards; only the image provider call happens here.
  if (needsUnderlay(text) && !findServer(dir)) assertNoServer(proj);
  let resolved = text;
  if (needsUnderlay(text)) {
    const w = wr(io, proj);
    const asset = one(p, 'asset');
    let doc: Doc | null = null;
    if (asset && listAssets(proj).includes(asset)) { try { doc = w.doc(asset); } catch { doc = null; } }
    resolved = await resolveUnderlays(proj, text, { doc, now: w.stamp() });
  }
  const out = ['run', dir, '-e', resolved];
  for (const [k, vs] of p.flags) {
    if (k === 'e') continue;
    if (vs.length === 0) out.push(`--${k}`);
    for (const v of vs) out.push(`--${k}`, v);
  }
  return out;
}

function writeViews(io: Io, proj: Project, doc: Doc, modesIn: string[], p: Parsed): number {
  let modes = modesIn.length ? modesIn : ['render'];
  if (modes.includes('all')) modes = ['render', 'grid', 'tile3x3'];
  for (const m of modes) if (!isViewMode(m)) throw new UsageError(`unknown view '${m}' (views: ${VIEW_MODES.join(', ')}, all)`);
  const scaleS = one(p, 'scale');
  const scale = scaleS === undefined ? undefined : Number(scaleS);
  if (scale !== undefined && (!Number.isInteger(scale) || scale < 1 || scale > 64)) throw new UsageError('--scale must be an integer 1..64');
  const regionS = one(p, 'region');
  const region = regionS ? parseRegion(regionS) : undefined;
  if (region === null) throw new UsageError(`--region must look like 8,0,12x10 or "8,0 12x10"`);
  if (region && (region.w < 1 || region.h < 1)) throw new UsageError('--region size must be at least 1x1');
  const camS = one(p, 'camera');
  const cm = camS ? /^(\d+),(\d+)$/.exec(camS) : null;
  if (camS && !cm) throw new UsageError('--camera must look like 12,9 (a cell)');
  const camera = cm ? [Number(cm[1]), Number(cm[2])] as [number, number] : undefined;
  if (region && !doc.wrap && (region.x + region.w > doc.width || region.y + region.h > doc.height)) {
    throw new UsageError(`--region runs past the ${doc.width}x${doc.height} canvas`);
  }
  const frameS = one(p, 'frame');
  const frame = frameS === undefined ? undefined : Number(frameS) - 1;
  if (frame !== undefined && (!Number.isInteger(frame) || frame < 0 || frame >= doc.frameCount)) throw new UsageError(`--frame must be 1..${doc.frameCount}`);
  const marksS = one(p, 'marks');
  const marks = marksS === undefined ? undefined : marksS === 'failing' ? 'failing' as const : marksS.split(',').map((x) => x.trim());
  if (Array.isArray(marks) && !marks.every(isCheckId)) throw new UsageError(`--marks takes failing or check names (${CHECK_IDS.join(', ')})`);
  const sizeS = one(p, 'size');
  const sm = sizeS ? /^(\d+)x(\d+)$/.exec(sizeS) : null;
  if (sizeS && !sm) throw new UsageError('--size must look like 16x12 (tiles)');
  const size = sm ? { cols: Number(sm[1]), rows: Number(sm[2]) } : undefined;
  const seedS = one(p, 'seed');
  const seed = seedS === undefined ? undefined : Number(seedS);
  if (seed !== undefined && (!Number.isInteger(seed) || seed < 1)) throw new UsageError('--seed must be a whole number from 1');
  const w = wr(io, proj);
  for (const m of modes as ViewMode[]) {
    const out = one(p, 'out') ?? join(proj.dir, 'views');
    const v = w.view(doc.name, m, {
      scale, region, frame, marks: marks as CheckId[] | 'failing' | undefined, theme: one(p, 'theme'), themes: one(p, 'themes')?.split(','),
      ground: one(p, 'ground'), with: p.flags.get('with'), size, seed, camera,
    }, out);
    if (v.kind === 'text') {
      io.out(v.text);
      io.out(`wrote ${v.path}\n`);
    } else io.out(`${v.text ? v.text + '\n' : ''}wrote ${v.path} (${v.width}x${v.height})\n`);
  }
  return 0;
}

function cmdCheck(io: Io, p: Parsed): number {
  const [dir, ...names] = p.pos;
  if (!dir) throw new UsageError('check: give a project folder');
  const proj = loadProject(dir);
  const w = wr(io, proj);
  const ids = one(p, 'checks')?.split(',').map((x) => x.trim());
  if (ids && !ids.every(isCheckId)) throw new UsageError(`--checks takes check names (${CHECK_IDS.join(', ')})`);
  const frameS = one(p, 'frame');
  const frame = frameS === undefined ? undefined : Number(frameS) - 1;
  if (frame !== undefined && (!Number.isInteger(frame) || frame < 0)) throw new UsageError('--frame must be a frame number from 1');
  let failing = 0;
  for (const name of names.length ? names : w.assets()) {
    const { results, problems } = w.checks(name, { checks: ids as CheckId[] | undefined, frame, ground: one(p, 'ground'), ref: one(p, 'ref') });
    const bad = results.filter((r) => r.status === 'fail').map((r) => r.id);
    if (bad.length) failing++;
    io.out(formatChecks(name, results, problems, frame) + '\n');
    if (p.flags.has('marks') && bad.length) {
      const v = w.view(name, w.doc(name).wrap ? 'tile3x3' : 'render', { frame: frame ?? results.find((r) => r.status === 'fail')?.frame, marks: bad });
      io.out(`  wrote ${v.path}\n`);
    }
  }
  return failing ? 1 : 0;
}

function cmdReview(io: Io, p: Parsed): number {
  const [dir, ...names] = p.pos;
  if (!dir) throw new UsageError('review: give a project folder');
  const size = one(p, 'size');
  const sm = size ? /^(\d+)x(\d+)$/.exec(size) : null;
  if (size && !sm) throw new UsageError('--size must look like 16x12 (tiles)');
  const seed = one(p, 'seed') === undefined ? undefined : Number(one(p, 'seed'));
  if (seed !== undefined && (!Number.isInteger(seed) || seed < 1)) throw new UsageError('--seed must be a whole number from 1');
  const map = { ...(sm ? { cols: Number(sm[1]), rows: Number(sm[2]) } : {}), ...(seed ? { seed } : {}) };
  const r = writeReview(wr(io, loadProject(dir)), { assets: names.length ? names : undefined, set: one(p, 'set'), name: one(p, 'name'), map });
  io.out(`wrote ${r.files.length} files to ${r.dir}\n${r.files.map((f) => `  ${f}\n`).join('')}Hand the folder to a fresh reviewer: "Review the art in ${r.dir} by following rubric.md."\n`);
  return 0;
}

/** `request`: file one (draw, change, add) as the dashboard's buttons do, or list the open ones. */
function cmdRequest(io: Io, p: Parsed): number {
  const [dir, kind, name, ...extra] = p.pos;
  if (!dir) throw new UsageError('request: give a project folder');
  if (extra.length) throw new UsageError(`request: unexpected argument '${extra[0]}'`);
  const proj = loadProject(dir);
  if (!kind) {
    const open = openRequests(readRequests(proj));
    io.out(open.length ? open.map((q) => requestLine(q) + '\n').join('') : 'no open requests\n');
    return 0;
  }
  if (!['draw', 'change', 'add'].includes(kind)) throw new UsageError(`request: the kind is draw, change or add (not '${kind}')`);
  if (!name) throw new UsageError(`request ${kind}: give the asset${kind === 'add' ? "'s name" : ''}`);
  if (kind !== 'add') for (const k of ['kind', 'size', 'set', 'description', 'height']) if (one(p, k) !== undefined) throw new UsageError(`request ${kind}: --${k} is for add`);
  let entry: Record<string, unknown> | undefined;
  if (kind === 'add') {
    const height = one(p, 'height');
    if (height !== undefined && !/^\d+$/.test(height)) throw new UsageError('--height is a number of pixels');
    entry = { name, kind: one(p, 'kind'), size: one(p, 'size'), ...(one(p, 'set') ? { set: one(p, 'set') } : {}), ...(one(p, 'description') ? { description: one(p, 'description') } : {}), ...(height ? { height: Number(height) } : {}) };
  }
  assertNoServer(proj);
  const w = wr(io, proj);
  const q = personRequest(w, one(p, 'by') ?? 'claude', toPersonRequest({ action: 'request', kind, asset: name, note: one(p, 'note'), entry }));
  w.requestsChanged();
  io.out(`${requestLine(q)}\n`);
  return 0;
}

/** `reply` and `cancel`: answer a blocked request, or withdraw one. */
function cmdAnswer(io: Io, action: string, p: Parsed): number {
  const [dir, id, text, ...extra] = p.pos;
  if (!dir || !id) throw new UsageError(`${action}: give a project folder and a request id`);
  if (extra.length) throw new UsageError(`${action}: put the text in quotes (unexpected '${extra[0]}')`);
  const proj = loadProject(dir);
  assertNoServer(proj);
  const w = wr(io, proj);
  const q = personRequest(w, one(p, 'by') ?? 'claude', toPersonRequest({ action, id, text }));
  w.requestsChanged();
  io.out(`${requestLine(q)}\n`);
  return 0;
}

/**
 * `work`: an agent's side of a request, as the MCP work tool does it: list hands the open requests
 * over (seen), claim takes one, progress posts a note, block asks one question, done finishes it
 * (only when the asset passes its checks). The id may be left out after claim: it is the one you
 * hold. Errors apply nothing.
 */
function cmdWork(io: Io, p: Parsed): number {
  const [dir, action, ...rest] = p.pos;
  if (!dir || !action) throw new UsageError(`work: ${WORK_USAGE}`);
  if (action === 'start') throw new UsageError('work start: run it from the pixelclaw command, not through a server');
  if (!WORK_ACTIONS.includes(action)) throw new UsageError(`work: the action is ${WORK_ACTIONS.join(', ')} or start (not '${action}')`);
  if (one(p, 'port') !== undefined) throw new UsageError('work: --port is for work start');
  const id = rest[0] && /^r\d+$/.test(rest[0]) ? rest.shift() : undefined;
  const [text, ...extra] = rest;
  if (extra.length) throw new UsageError(`work ${action}: put the text in quotes (unexpected '${extra[0]}')`);
  if (action === 'list' && (id || text !== undefined)) throw new UsageError('work list takes no id or text');
  if (action === 'claim' && text !== undefined) throw new UsageError(`work claim: unexpected '${text}' (give a request id like r3, or none for the next open one)`);
  if (['progress', 'block', 'done'].includes(action) && !text?.trim()) {
    throw new UsageError(`work ${action}: say ${action === 'progress' ? 'what you are doing' : action === 'block' ? 'the one question for the person' : 'what changed'} (in quotes)`);
  }
  const proj = loadProject(dir);
  assertNoServer(proj);
  const w = wr(io, proj);
  const by = one(p, 'by') ?? 'claude';
  const steps = cliSteps(dir);
  if (action === 'list') {
    agentWork(w, by, { action: 'list' });
    const active = openRequests(readRequests(proj));
    io.out(active.length ? active.map((q) => requestLine(q) + '\n').join('') + `Take one: \`pixelclaw work ${shellArg(dir)} claim [<id>]\`\n` : 'no open requests\n');
    return 0;
  }
  const r = action === 'claim' ? agentWork(w, by, { action: 'next', id }, steps)
    : agentWork(w, by, { action: action === 'block' ? 'blocked' : action as 'progress' | 'done', id, text: text! }, steps);
  w.requestsChanged();
  if (!r.request) {
    io.out(`${r.message}\n`);
    return 0;
  }
  if (action === 'claim') {
    io.out(`${r.message}\n${requestBrief(w, r.request, steps)}\n`);
    return 0;
  }
  const left = openRequests(readRequests(proj)).filter((x) => x.state === 'open').length;
  io.out(`${r.message}\n${requestLine(r.request)}\n${action === 'progress' ? '' : left ? `${left} open request${left === 1 ? '' : 's'} left: ${steps.next}.\n` : 'No open requests left.\n'}`);
  return 0;
}

export const WORK_USAGE = 'work <project> (list | claim [<id>] | progress [<id>] "<note>" | block [<id>] "<question>" | done [<id>] "<what changed>") [--by <agent>], or work <project> start [--port N]';

function cmdPlan(io: Io, p: Parsed): number {
  const [dir] = p.pos;
  if (!dir) throw new UsageError('plan: give a project folder');
  const w = wr(io, loadProject(dir));
  const manifestFile = one(p, 'manifest');
  if (manifestFile) {
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(manifestFile, 'utf8'));
    } catch (e) {
      throw new ProjectError(`${manifestFile}: ${(e as Error).message}`);
    }
    const r = writeManifest(w.project, json);
    if (!r.manifest) {
      io.err(`error: the manifest was not written; ${r.errors.length} problem${r.errors.length === 1 ? '' : 's'}:\n${r.errors.map((e) => `  ${e.path || '(top)'}: ${e.message}\n`).join('')}`);
      return 1;
    }
    io.out(`wrote ${join(w.project.dir, 'manifest.json')}: ${r.manifest.assets.length} assets\n`);
  }
  if (p.flags.has('templates')) {
    const seed = one(p, 'seed') === undefined ? undefined : Number(one(p, 'seed'));
    const t = writeTemplates(w, { seed });
    io.out(`wrote ${t.files.length} templates to ${t.dir}\n${t.files.map((f) => `  ${f}\n`).join('')}`);
  }
  const order = one(p, 'order');
  if (order !== undefined && order !== 'set' && order !== 'scene') throw new UsageError('--order is set or scene');
  const r = planReport(w, { set: one(p, 'set') });
  io.out(p.flags.has('json') ? JSON.stringify(r, null, 2) + '\n' : planText(r, { order }) + '\n');
  return r.manifest.errors.length ? 1 : 0;
}

/** Where the shipped skill is: skill/ in the repo, or beside the bundle. */
function skillSource(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const d of [join(here, 'skill'), join(here, '..', '..', 'skill')]) if (existsSync(join(d, 'SKILL.md'))) return d;
  throw new ProjectError('the skill is not in this build (no skill/SKILL.md)');
}

function cmdSkill(io: Io, p: Parsed): number {
  const [what] = p.pos;
  if (what !== 'install' && what !== 'path') throw new UsageError('skill: install [--dest <dir> | --project <dir>], or path');
  const src = skillSource();
  if (what === 'path') { io.out(src + '\n'); return 0; }
  const proj = one(p, 'project');
  const dest = one(p, 'dest') ?? (proj ? join(proj, '.claude', 'skills', 'pixelclaw') : join(homedir(), '.claude', 'skills', 'pixelclaw'));
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  // The command reference goes beside it (the bundle carries a copy; the repo has it in docs/).
  const ref = join(src, '..', 'docs', 'commands.md');
  if (!existsSync(join(src, 'commands.md')) && existsSync(ref)) cpSync(ref, join(dest, 'commands.md'));
  const files = readdirSync(dest, { recursive: true }).map(String).filter((f) => f.includes('.')).sort();
  io.out(`installed the PixelClaw skill in ${dest} (${files.join(', ')})\nClaude Code finds it as /pixelclaw; connect the tools with:\n  claude mcp add pixelclaw -- npx pixelclaw serve --project <your project>.pclaw\n`);
  return 0;
}

function cmdView(io: Io, p: Parsed): number {
  const [dir, name, ...modes] = p.pos;
  if (!dir || !name) throw new UsageError('view: give a project folder and an asset name');
  const proj = loadProject(dir);
  const { doc } = loadState(proj, name);
  if (!doc) throw new ProjectError(`asset '${name}' has an empty tape`);
  return writeViews(io, proj, doc, modes, p);
}

function cmdExport(io: Io, p: Parsed): number {
  const [dir, name] = p.pos;
  if (!dir || !name) throw new UsageError('export: give a project folder and an asset name');
  const format = one(p, 'format') as ExportFormat;
  if (!(EXPORT_FORMATS as readonly string[]).includes(format)) throw new UsageError(`--format must be one of ${EXPORT_FORMATS.join(', ')}`);
  const proj = loadProject(dir);
  assertNoServer(proj);
  const w = wr(io, proj);
  const files = exportAsset(w.doc(name), w.assetDocs(), format, one(p, 'out') ?? join(proj.dir, 'exports', format));
  io.out(`${format}: wrote ${files.length} files\n${files.map((f) => `  ${f}\n`).join('')}`);
  return 0;
}

function cmdExportProfile(io: Io, p: Parsed): number {
  const [dir, ...names] = p.pos;
  if (!dir) throw new UsageError('export: give a project folder');
  const proj = loadProject(dir);
  assertNoServer(proj);
  const w = wr(io, proj);
  const profile = one(p, 'profile') ?? 'png';
  const r = exportWithProfile(proj, w.assetDocs(), profile, { names: names.length ? names : undefined, dest: one(p, 'out'), at: io.now() });
  io.out(`${profile}: ${r.images} images, wrote ${r.files.length} files into ${r.dir}\n${r.notes.map((n) => `  note: ${n}\n`).join('')}`);
  return 0;
}

function cmdImport(io: Io, p: Parsed): number {
  const [dir, path] = p.pos;
  if (!dir || !path) throw new UsageError('import: give a project folder and a file or folder');
  const proj = loadProject(dir);
  assertNoServer(proj);
  const w = wr(io, proj);
  const pair = (k: string, re: RegExp, sep: string, what: string): [number, number] | undefined => {
    const v = one(p, k);
    if (v === undefined) return undefined;
    if (!re.test(v)) throw new UsageError(`--${k} is ${what}`);
    return v.split(sep).map(Number) as [number, number];
  };
  const grid = pair('grid', /^\d+x\d+$/, 'x', 'a size like 24x24');
  const cell = pair('slice', /^\d+x\d+$/, 'x', 'a size like 24x24');
  const offset = pair('offset', /^\d+,\d+$/, ',', 'a point like 2,2');
  const gap = pair('gap', /^\d+,\d+$/, ',', 'a point like 1,1');
  const namesFrom = one(p, 'names-from');
  if (namesFrom !== undefined && namesFrom !== 'manifest') throw new UsageError('--names-from takes manifest');
  const by = one(p, 'by') ?? 'claude';
  const common = { as: one(p, 'as'), kind: one(p, 'kind'), palette: one(p, 'palette'), build: p.flags.has('build'), grid, cells: p.flags.has('cells') };
  if (!one(p, 'profile')) {
    const r = importIntoProject(w, {
      path, ...common, slice: cell ? { cell, offset, gap } : undefined, pattern: one(p, 'pattern'), names: one(p, 'names')?.split(','), namesFrom: namesFrom as 'manifest' | undefined,
      set: one(p, 'set'), wrap: p.flags.has('wrap'), manifest: p.flags.has('no-manifest') ? false : undefined, replace: p.flags.has('replace'),
    }, by);
    io.out((r.text || 'nothing to import') + '\n');
    return 0;
  }
  const plan = planImport(proj, w.assetDocs(), { path, profile: one(p, 'profile'), ...common });
  const created: string[] = [];
  for (const c of plan.create) {
    const r = w.run({ asset: c.name, commands: c.tape, by, replace: p.flags.has('replace') });
    if (!r.ok) throw new ProjectError(`${c.name}: ${r.errors.map((e) => `${e.line}:${e.col} ${e.message}`).join('; ')}`);
    created.push(c.name);
  }
  io.out((importSummary(plan, created) || 'nothing to import') + '\n');
  return plan.differ.length ? 1 : 0;
}

function cmdUpgrade(io: Io, p: Parsed): number {
  const [dir, ...names] = p.pos;
  if (!dir) throw new UsageError('upgrade: give a project folder');
  const proj = loadProject(dir);
  assertNoServer(proj);
  const src = paletteSource(proj);
  let failed = 0;
  const done: string[] = [];
  for (const name of names.length ? names : listAssets(proj)) {
    const entries = readTape(proj, name);
    let up: TapeEntry[] | null;
    try {
      up = upgradeTape(entries, src);
    } catch (e) {
      io.out(`FAIL ${name}: ${(e as Error).message}\n`);
      failed++;
      continue;
    }
    if (!up) { io.out(`ok   ${name}: already language ${LANG_VERSION}\n`); continue; }
    const before = replay(entries, src);
    const after = replay(up, src);
    const same = !before.problems.length && !after.problems.length && before.doc && after.doc && Buffer.compare(serializeDoc(before.doc), serializeDoc(after.doc)) === 0;
    if (!same) {
      io.out(`FAIL ${name}: the upgraded tape does not replay to the same document; left as it was\n`);
      failed++;
      continue;
    }
    const tl = new Timeline(src);
    saveAsset(proj, { doc: after.doc, entries: up }, (n) => tl.docAt(up!, n).doc, true);
    io.out(`ok   ${name}: language 1 → ${LANG_VERSION}, the same pixels (${up.length} commands)\n`);
    done.push(name);
  }
  if (done.length) return Math.max(failed ? 1 : 0, cmdVerify(io, { ...p, pos: [dir, ...done] }));
  return failed ? 1 : 0;
}

function cmdVerify(io: Io, p: Parsed): number {
  const [dir, ...names] = p.pos;
  if (!dir) throw new UsageError('verify: give a project folder');
  const proj = loadProject(dir);
  const assets = names.length ? names : listAssets(proj);
  let failed = 0;
  for (const name of assets) {
    const problems: string[] = [];
    let entries;
    try {
      entries = readTape(proj, name);
    } catch (e) {
      io.out(`FAIL ${name}: ${(e as Error).message}\n`);
      failed++;
      continue;
    }
    // One pass replays the tape and checks each checkpoint as its point goes by; a second checks determinism.
    const cps = readCheckpoints(proj, name);
    const at = new Map(cps.filter((c) => c.n > 0).map((c) => [c.n, c]));
    const run = () => {
      const cur = new TapeCursor(paletteSource(proj));
      for (const e of entries) {
        const message = cur.step(e);
        if (message !== null) return { doc: cur.doc, problems: [{ seq: e.seq, message }] };
        const c = at.get(cur.done.length);
        if (c && checking) {
          if (c.hash !== prefixHash(entries, c.n)) problems.push(`checkpoint ${c.file} was made from another tape`);
          else if (!cur.doc || Buffer.compare(Buffer.from(serializeDoc(cur.doc)), Buffer.from(c.body)) !== 0) problems.push(`checkpoint ${c.file} differs from the replay`);
        }
      }
      return { doc: cur.doc, problems: [] as { seq: number; message: string }[] };
    };
    let checking = true;
    const a = run();
    checking = false;
    const b = run();
    for (const pr of a.problems) problems.push(`tape seq ${pr.seq}: ${pr.message}`);
    let summary = '';
    if (!a.problems.length && a.doc && b.doc) {
      const bytes = serializeDoc(a.doc);
      if (sha256(bytes) !== sha256(serializeDoc(b.doc))) problems.push('two replays differ');
      const hash = sha256(bytes);
      const aj = readAssetJson(proj, name);
      const v1 = serializeDocV1(a.doc);
      const legacy = aj.state.sha256 !== hash && v1 !== null && aj.state.sha256 === sha256(v1);
      if (aj.state.sha256 !== hash && !legacy) problems.push(`replayed state ${hash.slice(0, 12)} differs from asset.json ${aj.state.sha256.slice(0, 12)}`);
      if (aj.tape.commands !== entries.length) problems.push(`asset.json counts ${aj.tape.commands} commands, the tape has ${entries.length}`);
      const pf = join(assetDir(proj, name), 'preview.png');
      if (!existsSync(pf)) problems.push('preview.png is missing');
      else if (Buffer.compare(Buffer.from(previewPng(a.doc)), readFileSync(pf)) !== 0) problems.push('preview.png differs from the replayed document');
      for (const c of cps) {
        if (c.n < 0) problems.push(`checkpoint ${c.file} is not a checkpoint file`);
        else if (c.n > entries.length) problems.push(`checkpoint ${c.file} is past the end of the tape`);
        else if (c.file !== `${String(c.n).padStart(6, '0')}.gwc`) problems.push(`checkpoint ${c.file} holds command ${c.n}`);
      }
      // The state cache: when its key is this tape's, its bytes must be the replay's.
      const cached = readStateCacheRaw(proj, name);
      const current = cached?.key === stateKey(proj, readTapeFile(proj, name).bytes, tapeLang(entries));
      if (cached && current && Buffer.compare(Buffer.from(bytes), Buffer.from(cached.body)) !== 0) problems.push('the state cache differs from the replay (delete .cache/ to rebuild it)');
      const missing = checkpointNames(entries.length).filter((f) => !cps.some((c) => c.file === f));
      if (missing.length) problems.push(`checkpoint${missing.length === 1 ? '' : 's'} missing: ${missing.join(', ')}`);
      summary = `${entries.length} commands, ${new Set(entries.map((e) => e.group)).size} groups, state ${hash.slice(0, 12)}${legacy ? ' (asset.json has a hash in the older state format; it is updated on the next save)' : ''}, ${cps.length ? cps.length + ' checkpoint' + (cps.length === 1 ? '' : 's') + ' checked' : 'no checkpoints'}${current ? ', cache checked' : ''}`;
    } else if (!a.doc && !a.problems.length) problems.push('the tape has no document');
    if (problems.length) {
      failed++;
      io.out(`FAIL ${name}\n${problems.map((s) => `  ${s}\n`).join('')}`);
    } else io.out(`ok   ${name}: ${summary}\n`);
  }
  io.out(failed ? `${failed} of ${assets.length} assets failed\n` : `${assets.length} asset${assets.length === 1 ? '' : 's'} verified in ${relative(process.cwd(), proj.dir) || '.'}\n`);
  return failed ? 1 : 0;
}

export function main(argv: string[], io: Io = nodeIo): number {
  const [cmd, ...rest] = argv;
  try {
    switch (cmd) {
      case 'new': {
        const p = parseArgs(rest, ...WRITE_OPTS.new!);
        if (!p.pos[0]) throw new UsageError('new: give a project folder');
        return p.pos.length === 1 ? cmdNewProject(io, p.pos[0], p) : cmdNewAsset(io, p.pos[0], p);
      }
      case 'run':
        return cmdRun(io, parseArgs(rest, ...WRITE_OPTS.run!));
      case 'seeds':
        return cmdSeeds(io, parseArgs(rest, ...WRITE_OPTS.seeds!));
      case 'view':
        return cmdView(io, parseArgs(rest, ['scale', 'region', 'out', 'frame', 'marks', 'theme', 'themes', 'ground', 'with', 'size', 'seed', 'camera'], []));
      case 'export': {
        const p = parseArgs(rest, ...WRITE_OPTS.export!);
        return one(p, 'format') ? cmdExport(io, p) : cmdExportProfile(io, p);
      }
      case 'import':
        return cmdImport(io, parseArgs(rest, ...WRITE_OPTS.import!));
      case 'check':
        return cmdCheck(io, parseArgs(rest, ['checks', 'frame', 'ground', 'ref'], ['marks']));
      case 'review':
        return cmdReview(io, parseArgs(rest, ...WRITE_OPTS.review!));
      case 'plan':
        return cmdPlan(io, parseArgs(rest, ...WRITE_OPTS.plan!));
      case 'request':
        return cmdRequest(io, parseArgs(rest, ...WRITE_OPTS.request!));
      case 'reply': case 'cancel':
        return cmdAnswer(io, cmd, parseArgs(rest, ...WRITE_OPTS.reply!));
      case 'work':
        return cmdWork(io, parseArgs(rest, ...WRITE_OPTS.work!));
      case 'skill':
        return cmdSkill(io, parseArgs(rest, ['dest', 'project'], []));
      case 'verify':
        return cmdVerify(io, parseArgs(rest, [], []));
      case 'upgrade':
        return cmdUpgrade(io, parseArgs(rest, [], []));
      case undefined: case 'help': case '-h': case '--help':
        io.out(USAGE);
        return cmd === undefined ? 1 : 0;
      default:
        throw new UsageError(`unknown command '${cmd}'`);
    }
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`error: ${e.message}\n\n${USAGE}`);
      return 2;
    }
    if (e instanceof ProjectError) {
      io.err(`error: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
}

