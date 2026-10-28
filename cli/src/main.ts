// pixelclaw: new | run | view | check | review | verify | upgrade. A thin layer over @pixelclaw/core and the project folder.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  CHECK_IDS, LANG_VERSION, TapeCursor, Timeline, checkSummary, isCheckId, replay, serializeDoc, serializeDocV1, upgradeTape, type AssetState, type CheckId, type Doc,
  type TapeEntry,
} from '@pixelclaw/core';
import {
  AssetExistsError, NoAssetError, ProjectError, VIEW_MODES, Writer, assetDir, checkpointNames, createProject, formatChecks, isViewMode, listAssets,
  loadProject, lockHolder, paletteSource, parseRegion, prefixHash, previewPng, readAssetJson, readCheckpoints, readPaletteFile,
  readTape, saveAsset, sha256, writeReview, SUMMARY_BUDGET, type Project, type ViewMode,
} from '@pixelclaw/server';

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

export const USAGE = `pixelclaw: a pixel art editor driven by commands

  pixelclaw new <project> [--name <name>] [--palette <file.json|.hex|.gpl>]...
      Create a project folder. The first palette becomes the default.
  pixelclaw new <project> <kind> <name> <W>x<H> [palette=..] [wrap=on|off] [cell=WxH] [bg=..] [--replace]
      Create an asset (kinds: tile, sprite, sheet, icon). Same as running a 'new' command.
  pixelclaw run <project> (<script.pclaw> | - | -e "<commands>") [--asset <name>] [--replace] [--by <author>] [--view <mode>]
      Apply commands as one undo group. Any error applies nothing.
      A script that starts with 'new' creates the asset (--replace starts its tape again).
  pixelclaw view <project> <asset> [render|grid|tile3x3|diff|game|recolour|all]... [--scale N] [--region x,y,WxH] [--frame N] [--out <dir>]
         [--marks failing|<check>,...] [--theme <name>] [--themes a,b,c] [--ground <tile>] [--with <asset>]...
      Write views (default: <project>/views/<asset>.<mode>.png|txt). The grid is also printed.
      diff shows what the latest group changed; game shows a sprite on its ground at 1x and the
      draw scale beside its set; recolour shows role art under preview themes; all is render,
      grid and tile3x3. --marks circles the pixels checks flag.
  pixelclaw check <project> [<asset>...] [--checks a,b] [--frame N] [--ground <tile>] [--ref <asset>] [--marks]
      Run the quality checks against the style guide (project.json style): scores, pass or fail,
      and the flagged pixels. Exits 1 if any check fails. --marks writes the render (tile3x3 for
      tiles) with the flagged pixels circled.
  pixelclaw review <project> [<asset>...] [--name <set>]
      Write a blind review bundle under <project>/reviews/<date>-<set>/ (rubric.md inside).
  pixelclaw upgrade <project> [<asset>...]
      Rewrite language 1 tapes (G1-G4) in the current language: the palette goes into the 'new'
      line. Each is replayed before and after; it is written only if the pixels are the same.
  pixelclaw verify <project> [<asset>...]
      Replay every tape and compare with asset.json, preview.png and checkpoints.
  pixelclaw serve --project <project> [--port 7417] [--no-mcp]
      Own the project: MCP on stdin/stdout for the agent, and the live watch view on
      http://127.0.0.1:<port>/?token=... (printed to stderr). Creates the project if needed.

Command reference: docs/commands.md
`;

export class UsageError extends Error {}

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
  const proj = createProject(dir, { name: one(p, 'name'), palettes });
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
  if (held) throw new ProjectError(`a pixelclaw server (pid ${held.pid}) owns ${proj.dir}; send commands through it (MCP), or stop it first`);
}

function apply(io: Io, proj: Project, text: string, source: string, o: { asset?: string; replace: boolean; by: string }): { code: number; doc?: Doc } {
  assertNoServer(proj);
  const w = new Writer(proj, { now: io.now });
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
  io.out(`  ${checkSummary(w.checks(r.asset, { budget: SUMMARY_BUDGET }).results)}\n`);
  return { code: 0, doc: r.doc };
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

function writeViews(io: Io, proj: Project, doc: Doc, modesIn: string[], p: Parsed): number {
  let modes = modesIn.length ? modesIn : ['render'];
  if (modes.includes('all')) modes = VIEW_MODES.filter((m) => m !== 'diff');
  for (const m of modes) if (!isViewMode(m)) throw new UsageError(`unknown view '${m}' (views: ${VIEW_MODES.join(', ')}, all)`);
  const scaleS = one(p, 'scale');
  const scale = scaleS === undefined ? undefined : Number(scaleS);
  if (scale !== undefined && (!Number.isInteger(scale) || scale < 1 || scale > 64)) throw new UsageError('--scale must be an integer 1..64');
  const regionS = one(p, 'region');
  const region = regionS ? parseRegion(regionS) : undefined;
  if (region === null) throw new UsageError(`--region must look like 8,0,12x10 or "8,0 12x10"`);
  if (region && (region.w < 1 || region.h < 1)) throw new UsageError('--region size must be at least 1x1');
  if (region && !doc.wrap && (region.x + region.w > doc.width || region.y + region.h > doc.height)) {
    throw new UsageError(`--region runs past the ${doc.width}x${doc.height} canvas`);
  }
  const frameS = one(p, 'frame');
  const frame = frameS === undefined ? undefined : Number(frameS) - 1;
  if (frame !== undefined && (!Number.isInteger(frame) || frame < 0 || frame >= doc.frameCount)) throw new UsageError(`--frame must be 1..${doc.frameCount}`);
  const marksS = one(p, 'marks');
  const marks = marksS === undefined ? undefined : marksS === 'failing' ? 'failing' as const : marksS.split(',').map((x) => x.trim());
  if (Array.isArray(marks) && !marks.every(isCheckId)) throw new UsageError(`--marks takes failing or check names (${CHECK_IDS.join(', ')})`);
  const w = new Writer(proj);
  for (const m of modes as ViewMode[]) {
    const out = one(p, 'out') ?? join(proj.dir, 'views');
    const v = w.view(doc.name, m, {
      scale, region, frame, marks: marks as CheckId[] | 'failing' | undefined, theme: one(p, 'theme'), themes: one(p, 'themes')?.split(','),
      ground: one(p, 'ground'), with: p.flags.get('with'),
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
  const w = new Writer(proj);
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
  const r = writeReview(new Writer(loadProject(dir), { now: io.now }), { assets: names.length ? names : undefined, name: one(p, 'name') });
  io.out(`wrote ${r.files.length} files to ${r.dir}\n${r.files.map((f) => `  ${f}\n`).join('')}Hand the folder to a fresh reviewer: "Review the art in ${r.dir} by following rubric.md."\n`);
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
      const missing = checkpointNames(entries.length).filter((f) => !cps.some((c) => c.file === f));
      if (missing.length) problems.push(`checkpoint${missing.length === 1 ? '' : 's'} missing: ${missing.join(', ')}`);
      summary = `${entries.length} commands, ${new Set(entries.map((e) => e.group)).size} groups, state ${hash.slice(0, 12)}${legacy ? ' (asset.json has the G1-G3 state hash; it is updated on the next save)' : ''}, ${cps.length ? cps.length + ' checkpoint' + (cps.length === 1 ? '' : 's') + ' checked' : 'no checkpoints'}`;
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
        return cmdRun(io, parseArgs(rest, ['asset', 'by', 'e', 'view', 'scale', 'region', 'out', 'frame', 'marks', 'theme', 'themes', 'ground', 'with'], ['replace']));
      case 'view':
        return cmdView(io, parseArgs(rest, ['scale', 'region', 'out', 'frame', 'marks', 'theme', 'themes', 'ground', 'with'], []));
      case 'check':
        return cmdCheck(io, parseArgs(rest, ['checks', 'frame', 'ground', 'ref'], ['marks']));
      case 'review':
        return cmdReview(io, parseArgs(rest, ['name'], []));
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

