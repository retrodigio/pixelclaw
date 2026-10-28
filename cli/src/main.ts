// pixelclaw: new | run | view | verify. A thin layer over @pixelclaw/core and the project folder.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  encodePng, importPalette, parse, renderGrid, renderScaled, renderTile3x3, replay, runBatch, serializeDoc,
  type AssetState, type Doc, type Region,
} from '@pixelclaw/core';
import {
  ProjectError, assetDir, assetExists, createProject, listAssets, loadProject, paletteSource, previewPng,
  readAssetJson, readTape, saveAsset, sha256, type Project,
} from './project.ts';

export interface Io {
  out(s: string): void;
  err(s: string): void;
  stdin(): string;
  now(): string;
}

const nodeIo: Io = {
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
  stdin: () => readFileSync(0, 'utf8'),
  now: () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
};

const USAGE = `pixelclaw: a pixel art editor driven by commands

  pixelclaw new <project> [--name <name>] [--palette <file.json|.hex|.gpl>]...
      Create a project folder. The first palette becomes the default.
  pixelclaw new <project> <kind> <name> <W>x<H> [palette=..] [wrap=on|off] [cell=WxH] [bg=..] [--replace]
      Create an asset (kinds: tile, sprite, sheet, icon). Same as running a 'new' command.
  pixelclaw run <project> (<script.pclaw> | - | -e "<commands>") [--asset <name>] [--replace] [--by <author>] [--view <mode>]
      Apply commands as one undo group. Any error applies nothing.
      A script that starts with 'new' creates the asset (--replace starts its tape again).
  pixelclaw view <project> <asset> [render|grid|tile3x3|all]... [--scale N] [--region x,y,WxH] [--out <dir>]
      Write views (default: <project>/views/<asset>.<mode>.png|txt). The grid is also printed.
  pixelclaw verify <project> [<asset>...]
      Replay every tape and compare with asset.json, preview.png and checkpoints.

Command reference: docs/commands.md
`;

class UsageError extends Error {}

interface Parsed {
  pos: string[];
  flags: Map<string, string[]>;
}

function parseArgs(argv: string[], valued: string[], bare: string[]): Parsed {
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

const one = (p: Parsed, k: string): string | undefined => p.flags.get(k)?.at(-1);

function printErrors(io: Io, source: string, errors: { line: number; col: number; message: string }[]): void {
  for (const e of errors) io.err(`${source}:${e.line}:${e.col}: error: ${e.message}\n`);
  io.err(`${errors.length} error${errors.length === 1 ? '' : 's'}; nothing was applied.\n`);
}

function cmdNewProject(io: Io, dir: string, p: Parsed): number {
  const palettes = (p.flags.get('palette') ?? []).map((f) => {
    try {
      return importPalette(f, readFileSync(f, 'utf8'));
    } catch (e) {
      throw new ProjectError(`${f}: ${(e as Error).message}`);
    }
  });
  const proj = createProject(dir, { name: one(p, 'name'), palettes });
  io.out(`created project '${proj.json.name}' at ${dir}\n`);
  for (const pal of proj.palettes.values()) io.out(`  palette ${pal.name}: ${pal.entries.length} entries${pal.name === proj.json.defaultPalette ? ' (default)' : ''}\n`);
  return 0;
}

function loadState(proj: Project, name: string): AssetState {
  const entries = readTape(proj, name);
  const r = replay(entries, paletteSource(proj));
  if (r.problems.length) throw new ProjectError(`asset '${name}': tape seq ${r.problems[0]!.seq}: ${r.problems[0]!.message} (run 'pixelclaw verify')`);
  return { doc: r.doc, entries };
}

function apply(io: Io, proj: Project, text: string, source: string, o: { asset?: string; replace: boolean; by: string }): { code: number; doc?: Doc } {
  const parsed = parse(text);
  const first = parsed.commands[0];
  const startsNew = first?.name === 'new';
  const newName = startsNew ? first.args.find((a, i) => i === 1 && a.t === 'word') : undefined;
  const name = o.asset ?? (newName && newName.t === 'word' ? newName.v : undefined);
  if (!name) {
    if (parsed.errors.length) { printErrors(io, source, parsed.errors); return { code: 1 }; }
    io.err(`error: say which asset with --asset <name> (or start the script with 'new')\n`);
    return { code: 1 };
  }
  let state: AssetState = { doc: null, entries: [] };
  if (assetExists(proj, name)) {
    if (startsNew && !o.replace) {
      io.err(`error: asset '${name}' already exists; use --replace to start its tape again\n`);
      return { code: 1 };
    }
    if (!startsNew) state = loadState(proj, name);
  } else if (!startsNew && !parsed.errors.length) {
    io.err(`error: no asset '${name}' in ${proj.dir}; start the script with 'new'\n`);
    return { code: 1 };
  }
  const r = runBatch(state, text, { by: o.by, at: io.now(), palettes: paletteSource(proj) });
  if (!r.ok) { printErrors(io, source, r.errors); return { code: 1 }; }
  if (!r.state.doc) { io.out('nothing to do\n'); return { code: 0 }; }
  if (r.state.doc.name !== name) {
    io.err(`error: the script creates '${r.state.doc.name}' but --asset says '${name}'\n`);
    return { code: 1 };
  }
  if (r.added.length === 0) { io.out(`${name}: no commands\n`); return { code: 0, doc: r.state.doc }; }
  const dir = saveAsset(proj, r.state);
  const groups = new Set(r.state.entries.map((e) => e.group)).size;
  io.out(`${name}: applied ${r.added.length} command${r.added.length === 1 ? '' : 's'} as group ${r.group}; ${r.changed} px changed\n`);
  io.out(`  tape: ${r.state.entries.length} commands in ${groups} group${groups === 1 ? '' : 's'}; preview: ${join(dir, 'preview.png')}\n`);
  return { code: 0, doc: r.state.doc };
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
  const r = apply(io, proj, text, source, { asset: one(p, 'asset'), replace: p.flags.has('replace'), by: one(p, 'by') ?? 'claude' });
  if (r.code === 0 && r.doc && p.flags.has('view')) return writeViews(io, proj, r.doc, p.flags.get('view')!, p);
  return r.code;
}

function parseRegion(s: string): Region {
  const m = /^(\d+),(\d+)[ ,](\d+)x(\d+)$/.exec(s.trim()) ?? /^(\d+),(\d+),(\d+),(\d+)$/.exec(s.trim());
  if (!m) throw new UsageError(`--region must look like 8,0,12x10 or "8,0 12x10"`);
  const [x, y, w, h] = m.slice(1).map(Number) as [number, number, number, number];
  if (w < 1 || h < 1) throw new UsageError('--region size must be at least 1x1');
  return { x, y, w, h };
}

const MODES = ['render', 'grid', 'tile3x3'];

function writeViews(io: Io, proj: Project, doc: Doc, modesIn: string[], p: Parsed): number {
  let modes = modesIn.length ? modesIn : ['render'];
  if (modes.includes('all')) modes = MODES;
  for (const m of modes) if (!MODES.includes(m)) throw new UsageError(`unknown view '${m}' (views: ${MODES.join(', ')}, all)`);
  const outDir = one(p, 'out') ?? join(proj.dir, 'views');
  mkdirSync(outDir, { recursive: true });
  const scaleS = one(p, 'scale');
  const scale = scaleS === undefined ? undefined : Number(scaleS);
  if (scale !== undefined && (!Number.isInteger(scale) || scale < 1 || scale > 64)) throw new UsageError('--scale must be an integer 1..64');
  const regionS = one(p, 'region');
  const region = regionS ? parseRegion(regionS) : undefined;
  if (region && !doc.wrap && (region.x + region.w > doc.width || region.y + region.h > doc.height)) {
    throw new UsageError(`--region runs past the ${doc.width}x${doc.height} canvas`);
  }
  for (const m of modes) {
    if (m === 'grid') {
      const g = renderGrid(doc, region);
      const f = join(outDir, `${doc.name}.grid${region ? `.${region.x}-${region.y}-${region.w}x${region.h}` : ''}.txt`);
      writeFileSync(f, g);
      io.out(g);
      io.out(`wrote ${f}\n`);
    } else {
      const img = m === 'render' ? renderScaled(doc, { scale }) : renderTile3x3(doc);
      const f = join(outDir, `${doc.name}.${m}.png`);
      writeFileSync(f, encodePng(img));
      io.out(`wrote ${f} (${img.width}x${img.height})\n`);
    }
  }
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
    const a = replay(entries, paletteSource(proj));
    const b = replay(entries, paletteSource(proj));
    for (const pr of a.problems) problems.push(`tape seq ${pr.seq}: ${pr.message}`);
    let summary = '';
    if (!a.problems.length && a.doc && b.doc) {
      const bytes = serializeDoc(a.doc);
      if (sha256(bytes) !== sha256(serializeDoc(b.doc))) problems.push('two replays differ');
      const hash = sha256(bytes);
      const aj = readAssetJson(proj, name);
      if (aj.state.sha256 !== hash) problems.push(`replayed state ${hash.slice(0, 12)} differs from asset.json ${aj.state.sha256.slice(0, 12)}`);
      if (aj.tape.commands !== entries.length) problems.push(`asset.json counts ${aj.tape.commands} commands, the tape has ${entries.length}`);
      const pf = join(assetDir(proj, name), 'preview.png');
      if (!existsSync(pf)) problems.push('preview.png is missing');
      else if (Buffer.compare(Buffer.from(previewPng(a.doc)), readFileSync(pf)) !== 0) problems.push('preview.png differs from the replayed document');
      const cdir = join(assetDir(proj, name), 'checkpoints');
      const cps = existsSync(cdir) ? readdirSync(cdir).filter((f) => f.endsWith('.gwc')) : [];
      // Checkpoints are written from a later step; when present they must match a replay prefix.
      if (cps.length) problems.push(`${cps.length} checkpoint file(s) found, but this build cannot check them yet`);
      summary = `${entries.length} commands, ${new Set(entries.map((e) => e.group)).size} groups, state ${hash.slice(0, 12)}, ${cps.length ? cps.length + ' checkpoints' : 'no checkpoints'}`;
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
        const p = parseArgs(rest, ['name', 'palette', 'by'], ['replace']);
        if (!p.pos[0]) throw new UsageError('new: give a project folder');
        return p.pos.length === 1 ? cmdNewProject(io, p.pos[0], p) : cmdNewAsset(io, p.pos[0], p);
      }
      case 'run':
        return cmdRun(io, parseArgs(rest, ['asset', 'by', 'e', 'view', 'scale', 'region', 'out'], ['replace']));
      case 'view':
        return cmdView(io, parseArgs(rest, ['scale', 'region', 'out'], []));
      case 'verify':
        return cmdVerify(io, parseArgs(rest, [], []));
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

