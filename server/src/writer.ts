// The single writer for a project (plan §8.1). Every command, from the agent (MCP), the CLI or a
// browser, goes through `run` in the order it arrives; each applied batch is saved and then sent
// to every listener (the watch view's sockets). It also keeps each agent's read position for
// `changes`, and a timeline per asset so any earlier state is quick to rebuild.

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHECK_IDS, TapeCursor, Timeline, activeGroups, checkContextFor, drawScaleOf, groundOf, paletteToJson, parse, projectThemes, replay, runBatch,
  VIEW_NAMES, cameraOf, flaggedOn, footprintOf, mapWorld, runChecks, setOf, type AssetDoc, type AssetState, type CheckId, type CheckResult, type Diag, type Doc, type Note, type Palette, type Pt,
  type TapeEntry, type Theme, type Token,
} from '@pixelclaw/core';
import {
  ProjectError, addPalettes, assetExists, forkOf, latestCheckpoint, listAssets, paletteSource, readReads, readTape, saveAsset, writeReads,
  type Project,
} from './project.ts';
import type { Eye, ServerMessage, Snapshot } from './protocol.ts';
import { makeView, type View, type ViewMode, type ViewOptions } from './views.ts';

/** What a view asks for, by name: the writer finds the documents, themes and check marks. */
export interface ViewRequest extends Omit<ViewOptions, 'marks' | 'theme' | 'themes' | 'game'> {
  /** Circle the pixels these checks flag ('failing': every failing check). */
  marks?: CheckId[] | 'failing';
  /** render, tile3x3, game: show role entries under this theme. */
  theme?: string;
  /** recolour: these themes (default: the first six). */
  themes?: string[];
  /** game: the ground tile (default: the style guide's, else the first tile). */
  ground?: string;
  /** game: the neighbours shown beside the asset (default: its set). map: overlays played over the map. */
  with?: string[];
  /** map: its size in tiles and the island's seed. */
  size?: { cols: number; rows: number };
  seed?: number;
  /** map of a map document: the camera's view around this cell. */
  camera?: [number, number];
}

/** Run summaries check every frame up to this many pixels (width x height x frames), else only the frame being drawn on. */
export const SUMMARY_BUDGET = 1 << 18;

export interface CheckRequest {
  checks?: CheckId[];
  /** 0-based frame (default: every frame). */
  frame?: number;
  /** Over this many pixels (width x height x frames), check only the `focus` frame (run summaries). */
  budget?: number;
  focus?: number;
  ground?: string;
  ref?: string;
  set?: string[];
}

/** Thrown when a batch names no asset and does not start with `new`. */
export class NoAssetError extends ProjectError {}
/** Thrown when a batch starts with `new` for an asset that exists and `replace` is not set. */
export class AssetExistsError extends ProjectError {
  readonly asset: string;
  constructor(asset: string) {
    super(`asset '${asset}' already exists; set replace to start its tape again`);
    this.asset = asset;
  }
}

export interface RunRequest {
  /** The asset to draw on; may be left out when the commands start with `new`. */
  asset?: string;
  commands: string;
  /** The author written on the tape: `claude`, `human:<name>`, ... */
  by: string;
  /** When the commands start with `new` and the asset exists, start its tape again. */
  replace?: boolean;
}

export type RunOutcome =
  | {
    ok: true;
    asset: string;
    doc: Doc | null;
    group: string | null;
    added: TapeEntry[];
    changed: number;
    created: boolean;
    warnings: string[];
    /** Totals for the whole tape after the batch. */
    commands: number;
    groups: number;
    /** The asset folder, when something was written. */
    dir: string | null;
  }
  | { ok: false; errors: Diag[] };

export interface HistoryRequest {
  asset: string;
  from?: number;
  to?: number;
  last?: number;
}

export interface History {
  asset: string;
  entries: TapeEntry[];
  total: number;
  groups: number;
  undone: string[];
}

/** What changed on one asset since an agent last looked (`changes`). */
export interface AssetChanges {
  asset: string;
  /** The agent had seen the tape up to this command (0: nothing yet). */
  from: number;
  /** The tape's last command now. */
  to: number;
  /** The commands since `from` that other authors wrote. */
  lines: TapeEntry[];
  /** How many of the agent's own commands are in the same range (they are in the diff too). */
  own: number;
  /** The asset's open notes now, and the ids of those written in `lines`. */
  notes: Note[];
  newNotes: string[];
  before: Doc | null;
  after: Doc;
}

export type Listener = (m: ServerMessage) => void;

/** Commands that write pixels: a batch of these that changes nothing gets a warning. */
const DRAWING_RE = /^(px|line|rect|ellipse|fill|paint|stroke|shift|flip|rotate|clear|curve|polygon|dither|gradient|outline|shade|clean|noise|scatter|voronoi|bricks|stamp (?!save |remove )|call)\b/;
const words = (args: Token[]): string[] => args.flatMap((t) => (t.t === 'word' ? [t.v] : []));

export interface WriterOptions {
  /** The clock for tape `at` stamps (UTC, whole seconds). */
  now?: () => string;
}

const utcNow = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

export class Writer {
  project: Project;
  private readonly states = new Map<string, AssetState>();
  private readonly timelines = new Map<string, Timeline>();
  private readonly listeners = new Set<Listener>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly now: () => string;
  private live: string | null = null;
  private styleStamp = '';
  lastEye: Eye | null = null;

  constructor(project: Project, o: WriterOptions = {}) {
    this.project = project;
    this.now = o.now ?? utcNow;
  }

  /** The writer's clock (UTC, whole seconds), as tape lines are stamped. */
  stamp(): string {
    return this.now();
  }

  /** Listen to applied batches and views; returns the unsubscribe function. */
  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(m: ServerMessage): void {
    for (const fn of this.listeners) {
      try {
        fn(m);
      } catch {
        // a broken listener must not stop the writer
      }
    }
  }

  /** Run `fn` after everything queued before it: the order commands arrive is the order applied. */
  enqueue<T>(fn: () => T): Promise<T> {
    const p = this.queue.then(fn);
    this.queue = p.catch(() => undefined);
    return p;
  }

  /** Switch to another project (an MCP `project` call). Listeners should send a fresh snapshot. */
  setProject(p: Project): void {
    this.project = p;
    this.styleStamp = '';
    this.states.clear();
    this.timelines.clear();
    this.live = null;
    this.lastEye = null;
    this.emit({ type: 'hello', snapshot: this.snapshot() });
  }

  addPalettes(files: Parameters<typeof addPalettes>[1]): void {
    addPalettes(this.project, files);
    this.emit({ type: 'palettes', palettes: [...this.project.palettes.values()], defaultPalette: this.project.json.defaultPalette });
  }

  /**
   * The asset's state, replayed from its tape on first use (from its newest matching checkpoint,
   * when there is one) and kept in memory after that.
   */
  state(name: string): AssetState {
    const cached = this.states.get(name);
    if (cached) return cached;
    const entries = readTape(this.project, name);
    const ck = latestCheckpoint(this.project, name, entries);
    let s: AssetState;
    if (ck) {
      const cur = TapeCursor.resume(paletteSource(this.project), ck.doc, entries.slice(0, ck.n));
      for (const e of entries.slice(ck.n)) {
        const problem = cur.step(e);
        if (problem) throw new ProjectError(`asset '${name}': tape seq ${e.seq}: ${problem} (run 'pixelclaw verify')`);
      }
      this.timeline(name).seed(entries, ck.n, ck.doc);
      s = { doc: cur.doc, entries, cache: cur.cache };
    } else {
      const r = replay(entries, paletteSource(this.project));
      if (r.problems.length) {
        throw new ProjectError(`asset '${name}': tape seq ${r.problems[0]!.seq}: ${r.problems[0]!.message} (run 'pixelclaw verify')`);
      }
      s = { doc: r.doc, entries, cache: r.cache };
    }
    this.states.set(name, s);
    return s;
  }

  private timeline(name: string): Timeline {
    let tl = this.timelines.get(name);
    if (!tl) this.timelines.set(name, (tl = new Timeline(paletteSource(this.project))));
    return tl;
  }

  doc(name: string): Doc {
    const { doc } = this.state(name);
    if (!doc) throw new ProjectError(`asset '${name}' has an empty tape`);
    return doc;
  }

  /** The document right after command `seq` of an asset's tape (null before its first command). */
  docAt(name: string, seq: number): Doc | null {
    const r = this.timeline(name).docAfter(this.state(name).entries, seq);
    if (r.problem) throw new ProjectError(`asset '${name}': ${r.problem}`);
    return r.doc;
  }

  /**
   * Parse, apply and save one batch as one undo group. Any error applies nothing. A batch that
   * starts with `new` creates an asset; one that starts with `fork <from> <to>` creates asset
   * <to> from a copy of <from>'s tape up to the fork point.
   */
  run(req: RunRequest): RunOutcome {
    const parsed = parse(req.commands);
    const first = parsed.commands[0];
    const startsNew = first?.name === 'new';
    const startsFork = first?.name === 'fork';
    const declared = startsNew ? words(first.args)[1] : startsFork ? words(first.args)[1] : undefined;
    const name = req.asset ?? declared;
    if (!name) {
      if (parsed.errors.length) return { ok: false, errors: parsed.errors };
      throw new NoAssetError(`say which asset to draw on (or start the commands with 'new')`);
    }
    if (declared && req.asset && declared !== req.asset) {
      throw new ProjectError(`the commands create '${declared}' but the asset is '${req.asset}'`);
    }
    let state: AssetState = { doc: null, entries: [] };
    const exists = assetExists(this.project, name);
    const creates = startsNew || startsFork;
    if (exists) {
      if (creates && !req.replace) throw new AssetExistsError(name);
      if (!creates) state = this.state(name);
    } else if (!creates && !parsed.errors.length) {
      throw new ProjectError(`no asset '${name}' in ${this.project.dir}; start the commands with 'new <kind> ${name} <W>x<H>'`);
    }
    if (startsFork && !parsed.errors.length) state = this.forkPrefix(first);
    const assets = (n: string): Doc | undefined => {
      if (n === name || !this.assets().includes(n)) return undefined;
      try { return this.doc(n); } catch { return undefined; }
    };
    const r = runBatch(state, req.commands, { by: req.by, at: this.now(), palettes: paletteSource(this.project), assets });
    if (!r.ok) return { ok: false, errors: r.errors };
    const base = { asset: name, doc: r.state.doc, group: r.group, added: r.added, changed: r.changed, created: creates };
    const totals = (s: AssetState) => ({ commands: s.entries.length, groups: new Set(s.entries.map((e) => e.group)).size });
    if (!r.state.doc || r.added.length === 0) {
      return { ok: true, ...base, warnings: ['no commands'], ...totals(r.state), dir: null };
    }
    if (r.state.doc.name !== name) throw new ProjectError(`the commands create '${r.state.doc.name}' but the asset is '${name}'`);
    const saved = this.checkSaves(r.saves);
    if (creates) this.timelines.delete(name);
    const tl = this.timeline(name);
    const dir = saveAsset(this.project, r.state, (n) => {
      const at = tl.docAt(r.state.entries, n);
      if (at.problem) throw new ProjectError(`asset '${name}': ${at.problem}`);
      return at.doc;
    }, creates);
    this.writePalettes(saved);
    this.states.set(name, r.state);
    this.live = name;
    this.freshStyle();
    const warnings: string[] = [];
    const drew = r.added.some((e) => DRAWING_RE.test(e.cmd));
    if (drew && r.changed === 0) warnings.push('the batch changed no pixels');
    this.emit({
      type: 'batch', asset: name, by: req.by, group: r.group!, entries: creates ? r.state.entries : r.added,
      changed: r.changed, reset: creates,
    });
    return { ok: true, ...base, warnings, ...totals(r.state), dir };
  }

  /**
   * `palette save as=<name>`: a new project palette, or one identical to it. Replacing a different
   * palette would change how every tape made with it replays, so that is refused.
   */
  private checkSaves(saves: { name: string; palette: Palette }[]): Palette[] {
    const out = new Map<string, Palette>();
    for (const sv of saves) {
      const pal: Palette = { ...sv.palette, name: sv.name };
      const old = this.project.palettes.get(sv.name);
      if (old && paletteToJson(old) !== paletteToJson(pal)) {
        throw new ProjectError(`palette save: the project already has a different palette '${sv.name}' (tapes made with it would replay differently); save as another name`);
      }
      if (!old) out.set(sv.name, pal);
    }
    return [...out.values()];
  }

  private writePalettes(pals: Palette[]): void {
    if (pals.length) this.addPalettes(pals);
  }

  /** The start of a branch: the source's tape up to the fork point, and its document there. */
  private forkPrefix(cmd: { args: Token[] }): AssetState {
    const from = words(cmd.args)[0];
    if (!from) return { doc: null, entries: [] }; // the fork command reports it
    if (!assetExists(this.project, from)) throw new ProjectError(`fork: no asset '${from}' to fork from`);
    const src = this.state(from).entries;
    const atTok = cmd.args.find((t) => t.t === 'kv' && t.key === 'at');
    const last = src.at(-1)?.seq ?? 0;
    const at = atTok?.t === 'kv' ? Number(atTok.value) : last;
    if (!Number.isInteger(at) || at < 1 || at > last) throw new ProjectError(`fork: at=${atTok?.t === 'kv' ? atTok.value : at} is not a command of '${from}' (1..${last})`);
    const entries = src.filter((e) => e.seq <= at);
    return { doc: this.docAt(from, at), entries };
  }

  /**
   * What other authors did since `agent` last called this: their tape lines per asset, the open
   * notes, and the documents before and after. The agent's own commands that come straight after
   * its read position count as read (it wrote them). Moves the read position to the end of every
   * tape, so a second call returns nothing new. `since` reads from that command instead.
   */
  changes(agent: string, o: { asset?: string; since?: number } = {}): AssetChanges[] {
    const reads = readReads(this.project);
    const mine = (reads[agent] ??= {});
    const names = o.asset ? [o.asset] : this.assets();
    const out: AssetChanges[] = [];
    for (const name of names) {
      const { doc, entries } = this.state(name);
      if (!doc) continue;
      const last = entries.at(-1)?.seq ?? 0;
      // A branch the agent never read starts at its fork point: what came before is the source's.
      let from = o.since ?? mine[name] ?? forkOf(entries)?.at ?? 0;
      if (from > last) from = 0; // the tape was started again
      if (o.since === undefined) {
        // The agent knows its own commands: skip past those that come next.
        let i = entries.findIndex((e) => e.seq > from);
        while (i >= 0 && i < entries.length && entries[i]!.by === agent) from = entries[i++]!.seq;
      }
      mine[name] = last;
      const after = entries.filter((e) => e.seq > from);
      const lines = after.filter((e) => e.by !== agent);
      if (lines.length === 0) continue;
      const newNotes = lines.flatMap((e) => /^note .* id=(n\d+)$/.exec(e.cmd)?.slice(1) ?? []);
      out.push({
        asset: name, from, to: last, lines, own: after.length - lines.length, notes: doc.notes, newNotes,
        before: from > 0 ? this.docAt(name, from) : null, after: doc,
      });
    }
    writeReads(this.project, reads);
    return out;
  }

  /**
   * The style guide and themes from project.json, read again when the file changes (people edit
   * it by hand while a session runs). Pages are told when they change.
   */
  private freshStyle(): void {
    const f = join(this.project.dir, 'project.json');
    let stamp: string;
    try {
      const st = statSync(f);
      stamp = `${st.mtimeMs}:${st.size}`;
    } catch {
      return;
    }
    if (stamp === this.styleStamp) return;
    const first = this.styleStamp === '';
    this.styleStamp = stamp;
    try {
      const json = JSON.parse(readFileSync(f, 'utf8')) as Project['json'];
      const changed = JSON.stringify([json.style, json.themes]) !== JSON.stringify([this.project.json.style, this.project.json.themes]);
      this.project.json.style = json.style ?? {};
      this.project.json.themes = json.themes;
      if (changed && !first) this.emit({ type: 'style', style: this.project.json.style, themes: this.themes() });
    } catch {
      // a half-written file: keep what we had, and look again next time
      this.styleStamp = '';
    }
  }

  /** Every asset's document, with what it was forked from (for checks and previews). */
  assetDocs(): AssetDoc[] {
    return this.assets().flatMap((name) => {
      try {
        const { doc, entries } = this.state(name);
        return doc ? [{ name, doc, forkOf: forkOf(entries)?.from ?? null }] : [];
      } catch {
        return []; // an asset that does not replay is reported by verify, not here
      }
    });
  }

  /** The preview themes: built in, then the project's. */
  themes(): Theme[] {
    return projectThemes(this.project.json.themes);
  }

  private themeNamed(name: string): Theme {
    const t = this.themes().find((x) => x.name === name);
    if (!t) throw new ProjectError(`no theme '${name}' (themes: ${this.themes().map((x) => x.name).join(', ')})`);
    return t;
  }

  /** Run checks on an asset with the project's style guide (all of them by default). */
  checks(asset: string, o: CheckRequest = {}): { results: CheckResult[]; problems: string[] } {
    this.freshStyle();
    const doc = this.doc(asset);
    if (o.frame !== undefined && (o.frame < 0 || o.frame >= doc.frameCount)) throw new ProjectError(`frame ${o.frame + 1} does not exist (frames 1..${doc.frameCount})`);
    const { ctx, problems } = checkContextFor(asset, doc, this.assetDocs(), this.project.json.style, (n) => this.project.palettes.get(n), o);
    return { results: runChecks(doc, o.checks ?? CHECK_IDS, { ...ctx, budget: o.budget, focus: o.focus }), problems };
  }

  /**
   * Render a view and save it (under views/ unless outDir is given). The diff compares with the
   * document after command `since`, by default the one before the latest group.
   */
  view(asset: string, mode: ViewMode, req: ViewRequest = {}, outDir?: string, before?: Doc | null): View {
    const dir = outDir ?? join(this.project.dir, 'views');
    this.freshStyle();
    const doc = this.doc(asset);
    const style = this.project.json.style;
    const o: ViewOptions = { scale: req.scale, region: req.region, since: req.since, frame: req.frame, tickRate: this.project.json.tickRate ?? 60 };
    if (req.theme) o.theme = this.themeNamed(req.theme);
    if (req.marks) {
      const ids = req.marks === 'failing' ? undefined : req.marks;
      const rs = this.checks(asset, { checks: ids }).results;
      const seen = new Set<string>();
      const marks: Pt[] = [];
      for (const r of rs) {
        if (req.marks === 'failing' && r.status !== 'fail') continue;
        for (const p of flaggedOn(r, req.frame ?? 0)) if (!seen.has(String(p))) { seen.add(String(p)); marks.push(p); }
      }
      o.marks = marks;
    }
    if (mode === 'game') {
      const all = this.assetDocs();
      const ground = groundOf(asset, all, style, req.ground);
      if (req.ground && !ground) throw new ProjectError(`no asset '${req.ground}' to use as ground`);
      const others = req.with ? req.with.map((n) => ({ name: n, doc: this.doc(n) })) : setOf(asset, doc, all, style).slice(0, 7);
      // All directions of the sprite (each view's first frame) after the frame asked for, then its set.
      const f = req.frame ?? 0;
      const here = doc.views.find((v) => v.from <= f && f <= v.to);
      const dirs = [f, ...[...doc.views].sort((x, y) => VIEW_NAMES.indexOf(x.name as never) - VIEW_NAMES.indexOf(y.name as never)).flatMap((v) => (v === here ? [] : [v.from]))];
      o.game = { ground: ground?.doc ?? null, with: others.map((x) => x.doc), scale: drawScaleOf(style), frames: [...new Set(dirs)] };
    }
    if (mode === 'diff' && doc.map) o.mapDoc = { doc, world: mapWorld(this.assetDocs()), screen: cameraOf(style), drawScale: drawScaleOf(style) };
    if (mode === 'map' && (doc.map || doc.kind === 'object' || doc.footprint)) {
      const all = this.assetDocs();
      const world = mapWorld(all);
      const base = { world, region: req.region, camera: req.camera, screen: cameraOf(style), drawScale: drawScaleOf(style) };
      if (doc.map) o.mapDoc = { doc, ...base };
      else {
        if (req.camera) throw new ProjectError('camera= is for a map document');
        o.mapDoc = { ...this.objectScene(asset, doc, all, req.ground), ...base, region: undefined };
      }
      if (o.marks && !doc.map) o.marks = undefined;
    } else if (mode === 'map') {
      const overlays = (req.with ?? []).map((n) => {
        const d = this.doc(n);
        if (!d.overlay) throw new ProjectError(`'${n}' is not an overlay (with= takes overlays for the map view)`);
        return d;
      });
      let ground: Doc | null = null;
      if (doc.overlay) {
        const all = this.assetDocs().filter((x) => x.name !== asset && (x.doc.family || x.doc.wrap));
        const g = req.ground ? all.find((x) => x.name === req.ground) : all.find((x) => x.doc.family) ?? groundOf(asset, all, style, undefined) ?? all[0];
        if (!g) throw new ProjectError(req.ground ? `no family or tile '${req.ground}' to put the overlay on` : 'no family or tile to put the overlay on (ground=<asset>)');
        ground = g.doc;
      }
      o.map = { cols: req.size?.cols, rows: req.size?.rows, seed: req.seed, overlays, ground };
    }
    if (mode === 'recolour') o.themes = req.themes ? req.themes.map((n) => this.themeNamed(n)) : this.themes().slice(0, 6);
    if (mode !== 'diff' || before !== undefined) return makeView(doc, mode, o, dir, before);
    const { entries } = this.state(asset);
    let since = req.since;
    if (since === undefined) {
      const g = entries.at(-1)?.group;
      since = (entries.find((e) => e.group === g)?.seq ?? 1) - 1;
    }
    return makeView(doc, mode, o, dir, since > 0 ? this.docAt(asset, since) : null);
  }

  /**
   * An object on its ground, among plain tiles (plan §4.10): a 7x6 map of the ground (a tile, or a
   * family's inside) with the object placed by its anchor near the middle.
   */
  private objectScene(asset: string, doc: Doc, all: AssetDoc[], given?: string): { doc: Doc; note: string } {
    const style = this.project.json.style;
    const g = given ? all.find((a) => a.name === given) : groundOf(asset, all, style, undefined) ?? all.find((a) => a.doc.family);
    if (!g) throw new ProjectError(given ? `no asset '${given}' to use as ground` : 'no ground tile or family to stand the object on (ground=<asset>)');
    const t = doc.cellW;
    const fp = footprintOf(doc);
    const [ac, ar] = [Math.ceil(doc.width / t), Math.ceil(doc.height / doc.cellH)];
    const cols = Math.max(7, ac + 4), rows = Math.max(6, ar + 3);
    const ax = Math.floor((cols - fp.cols) / 2) + fp.anchor[0], ay = rows - 2 - (fp.rows - 1) + fp.anchor[1];
    const lines = [`new map scene ${cols}x${rows} tile=${t}`];
    if (g.doc.family) lines.push(`layer add ground terrain=${g.name} outside=on above=floor`, `terrain ground rect 0,0 ${cols}x${rows}`);
    else for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) lines.push(`place ${g.name} ${x},${y} layer=floor cells=1x1 anchor=0,0`);
    lines.push(`layer add props objects`, `place ${asset} ${ax},${ay} layer=props`);
    const r = runBatch({ doc: null, entries: [] }, lines.join('\n'), { by: 'scene', palettes: paletteSource(this.project), assets: (n) => all.find((a) => a.name === n)?.doc });
    if (!r.ok) throw new ProjectError(`the scene: ${r.errors.map((e) => e.message).join('; ')}`);
    const flags = fp.flags.map((row) => row.replace(/\./g, '·')).join(' / ');
    return {
      doc: r.state.doc!,
      note: `${asset} on ${g.name} at the game's scale: ${doc.width}x${doc.height} px, ${ac}x${ar} cells; footprint ${fp.cols}x${fp.rows} at art cell ${fp.at.join(',')}, anchor ${fp.anchor.join(',')} (placed at ${ax},${ay}); cell flags by art row (b blocks, r roof): ${flags}`,
    };
  }

  /** Record an image view as the last one shown to the agent, and tell the watchers. */
  showEye(asset: string, v: View): void {
    if (v.kind !== 'image') return;
    this.lastEye = {
      asset, mode: v.mode, png: Buffer.from(v.png).toString('base64'), width: v.width, height: v.height, path: v.path, at: this.now(),
    };
    this.emit({ type: 'eye', eye: this.lastEye });
  }

  history(req: HistoryRequest): History {
    const { entries } = this.state(req.asset);
    const active = activeGroups(entries);
    let sel = entries.filter((e) => (req.from === undefined || e.seq >= req.from) && (req.to === undefined || e.seq <= req.to));
    if (req.last !== undefined) sel = sel.slice(Math.max(0, sel.length - req.last));
    const groups = [...new Set(entries.map((e) => e.group))];
    return { asset: req.asset, entries: sel, total: entries.length, groups: groups.length, undone: groups.filter((g) => !active.has(g)) };
  }

  assets(): string[] {
    return listAssets(this.project);
  }

  snapshot(): Snapshot {
    this.freshStyle();
    const assets = this.assets().map((name) => ({ name, entries: this.states.get(name)?.entries ?? readTape(this.project, name) }));
    return {
      project: { name: this.project.json.name, dir: this.project.dir, tickRate: this.project.json.tickRate ?? 60 },
      palettes: [...this.project.palettes.values()],
      defaultPalette: this.project.json.defaultPalette,
      style: this.project.json.style ?? {},
      themes: this.themes(),
      assets,
      live: this.live,
      eye: this.lastEye,
    };
  }
}
