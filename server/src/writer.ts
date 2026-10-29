// The single writer for a project (plan §8.1). Every command, from the agent (MCP), the CLI or a
// browser, goes through `run` in the order it arrives; each applied batch is saved and then sent
// to every listener (the watch view's sockets). It also keeps each agent's read position for
// `changes`, and a timeline per asset so any earlier state is quick to rebuild.

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHECK_IDS, SNAP_MIN_MATERIAL, SNAP_MIN_R2, ReplayCache, composeUnderlay, TapeCursor, Timeline, serializeDoc, tapeLang, tapeToJsonl, activeGroups, checkContextFor, drawScaleOf, groundOf, paletteToJson, parse, projectThemes, replay, runBatch,
  VIEW_NAMES, cameraOf, flaggedOn, footprintOf, mapWorld, runChecks, setOf, type AssetDoc, type AssetState, type CheckId, type CheckResult, type Diag, type Doc, type Note, type Palette, type Pt,
  type TapeEntry, type Theme, type Token,
} from '@pixelclaw/core';
import {
  ProjectError, addPalettes, assetExists, forkOf, latestCheckpoint, listAssets, paletteSource, readReads, readTape, readTapeFile, saveAsset, writeReads,
  type Project,
} from './project.ts';
import type { Eye, ServerMessage, Snapshot, WorkerStatus } from './protocol.ts';
import { checkCacheKey, readCheckCache, readStateCache, stateKey, writeCheckCache, writeStateCache } from './cache.ts';
import { readRequests } from './requests.ts';
import { workerSettings } from './worker-settings.ts';
import { manifestEntry, readManifest, styleDefaults } from './plan.ts';
import { makeView, type View, type ViewMode, type ViewOptions } from './views.ts';
import { blobImage, needsUnderlay, resolveUnderlays, type ProviderEnv } from './underlay.ts';

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
    /** Texture variants that inherit this family's band and were brought up to date (G13). */
    followed?: string[];
  }
  | { ok: false; errors: Diag[] };

/** `run dry=true`: a batch applied to a copy and checked; nothing is kept. */
export type DryOutcome =
  | { ok: true; asset: string; doc: Doc | null; added: TapeEntry[]; changed: number; warnings: string[]; results: CheckResult[] }
  | { ok: false; errors: Diag[] };

export interface SeedsRequest {
  asset: string;
  /** One generator command (noise, scatter, voronoi, bricks, map gen, family coverage, …); its seed= is replaced. */
  line: string;
  /** Commands run first in the same batch (a selection, a clear). */
  before?: string;
  by: string;
  /** Seeds from..from+count-1 (default 1 and 8), or these seeds. */
  count?: number;
  from?: number;
  seeds?: number[];
  /** Rank by these checks (default all). */
  checks?: CheckId[];
}

/** One seed's dry run: the line as written, what fails, and how far over its limits. */
export interface SeedTrial {
  seed: number;
  line: string;
  results: CheckResult[];
  failing: CheckId[];
  /** Failing checks' scores over their limits, summed (0 when every check passes). */
  excess: number;
  /** The closest any passing check comes to its limit (score over limit; lower is safer). */
  margin: number;
}

/** A check's score against its limit as a ratio: above 1 fails (≥ limits are inverted). */
export function overLimit(r: CheckResult): number | null {
  const m = /^([≤≥<>]) ?(-?[\d.]+)/.exec(r.limit);
  if (!m || r.score === null || !Number.isFinite(r.score)) return null;
  const lim = Number(m[2]);
  if (m[1] === '≤' || m[1] === '<') return lim > 0 ? r.score / lim : r.score > 0 ? 1 + r.score : 0;
  return r.score > 0 ? lim / r.score : lim > 0 ? 2 : 0;
}

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

/** A batch's warnings: drawing that changed nothing, an unreliable snap. */
function batchWarnings(added: TapeEntry[], changed: number): string[] {
  const warnings: string[] = [];
  const drew = added.some((e) => DRAWING_RE.test(e.cmd));
  if (drew && changed === 0) warnings.push('the batch changed no pixels');
  for (const e of added) {
    const m = /^snap .* r2=([\d.]+) material=([\d.]+|none)/.exec(e.cmd);
    if (!m) continue;
    const low = [Number(m[1]) < SNAP_MIN_R2 ? `block R² ${m[1]} < ${SNAP_MIN_R2}` : '', m[2] !== 'none' && Number(m[2]) < SNAP_MIN_MATERIAL ? `material match ${m[2]} < ${SNAP_MIN_MATERIAL}` : ''].filter(Boolean);
    if (low.length) warnings.push(`snap: ${low.join(', ')}; the draft is unreliable: reroll the underlay (a new prompt or seed) or trace over it instead`);
  }
  return warnings;
}

export interface WriterOptions {
  /** The clock for tape `at` stamps (UTC, whole seconds). */
  now?: () => string;
  /** Keep check results on disk by state hash (default true; off to compare with a fresh run). */
  checkCache?: boolean;
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
  /** Each asset's version (bumped when a batch changes it), and check results kept until something they read changes. */
  private readonly versions = new Map<string, number>();
  private clock = 0;
  private readonly checkMemo = new Map<string, { key: string; out: { results: CheckResult[]; problems: string[] } }>();
  /** Each loaded asset's state key (its tape and the engine): what the check cache is keyed by. */
  private readonly keys = new Map<string, string>();
  private readonly checkCache: boolean;
  lastEye: Eye | null = null;
  /** The headless worker's run, as the worker controller reports it. */
  worker: Omit<WorkerStatus, 'enabled'> = { running: false, by: null, startedAt: null, spent: 0, cap: 0, sessions: 0, stopped: null };

  constructor(project: Project, o: WriterOptions = {}) {
    this.project = project;
    this.now = o.now ?? utcNow;
    this.checkCache = o.checkCache ?? true;
  }

  /** Tell the watchers requests.jsonl changed. */
  requestsChanged(): void {
    this.emit({ type: 'requests', requests: [...readRequests(this.project).values()] });
  }

  workerStatus(): WorkerStatus {
    return { enabled: workerSettings(this.project.dir).enabled, ...this.worker };
  }

  /** The worker controller's report (sent to the watchers). */
  setWorker(s: Partial<Omit<WorkerStatus, 'enabled'>>): void {
    this.worker = { ...this.worker, ...s };
    this.emit({ type: 'worker', status: this.workerStatus() });
  }

  workerLog(lines: string[]): void {
    if (lines.length) this.emit({ type: 'workerLog', lines });
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
  enqueue<T>(fn: () => T | Promise<T>): Promise<T> {
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
    this.checkMemo.clear();
    this.keys.clear();
    this.live = null;
    this.lastEye = null;
    this.emit({ type: 'hello', snapshot: this.snapshot() });
  }

  addPalettes(files: Parameters<typeof addPalettes>[1]): void {
    addPalettes(this.project, files);
    this.emit({ type: 'palettes', palettes: [...this.project.palettes.values()], defaultPalette: this.project.json.defaultPalette });
  }

  /**
   * The asset's state: from the state cache when its key matches the tape, else replayed from
   * the tape (from its newest matching checkpoint, when there is one) and cached; kept in memory
   * after that.
   */
  state(name: string): AssetState {
    const cached = this.states.get(name);
    if (cached) return cached;
    const { bytes, entries } = readTapeFile(this.project, name);
    const key = stateKey(this.project, bytes, tapeLang(entries));
    this.keys.set(name, key);
    const hit = entries.length ? readStateCache(this.project, name, key) : null;
    if (hit) {
      this.timeline(name).seed(entries, entries.length, hit);
      const s = { doc: hit, entries, cache: new ReplayCache() };
      this.states.set(name, s);
      return s;
    }
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
    if (s.doc) writeStateCache(this.project, name, key, serializeDoc(s.doc));
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
   * `run`, after resolving the batch's `underlay generate` and `underlay import` lines (which call
   * an image provider or read a file, so they cannot run inside the synchronous batch).
   */
  async runAsync(req: RunRequest, env: ProviderEnv = {}): Promise<RunOutcome> {
    if (!needsUnderlay(req.commands)) return this.run(req);
    let doc: Doc | null = null;
    const name = req.asset;
    if (name && assetExists(this.project, name)) {
      try { doc = this.doc(name); } catch { doc = null; }
    }
    const commands = await resolveUnderlays(this.project, req.commands, { ...env, doc, now: this.now() });
    return this.run({ ...req, commands });
  }

  /**
   * Parse, apply and save one batch as one undo group. Any error applies nothing. A batch that
   * starts with `new` creates an asset; one that starts with `fork <from> <to>` creates asset
   * <to> from a copy of <from>'s tape up to the fork point.
   */
  run(req: RunRequest): RunOutcome {
    const b = this.batch(req);
    if (!b.ok) return b;
    const { name, creates, r } = b;
    const base = { asset: name, doc: r.state.doc, group: r.group, added: r.added, changed: r.changed, created: creates };
    const totals = (s: AssetState) => ({ commands: s.entries.length, groups: new Set(s.entries.map((e) => e.group)).size });
    if (!r.state.doc || r.added.length === 0) {
      return { ok: true, ...base, warnings: ['no commands'], ...totals(r.state), dir: null };
    }
    const saved = this.checkSaves(r.saves);
    if (creates) this.timelines.delete(name);
    const tl = this.timeline(name);
    const dir = saveAsset(this.project, r.state, (n) => {
      const at = tl.docAt(r.state.entries, n);
      if (at.problem) throw new ProjectError(`asset '${name}': ${at.problem}`);
      return at.doc;
    }, creates);
    this.writePalettes(saved);
    const key = stateKey(this.project, Buffer.from(tapeToJsonl(r.state.entries), 'utf8'), tapeLang(r.state.entries));
    this.keys.set(name, key);
    writeStateCache(this.project, name, key, serializeDoc(r.state.doc));
    this.states.set(name, r.state);
    this.versions.set(name, ++this.clock);
    this.live = name;
    this.freshStyle();
    const warnings = batchWarnings(r.added, r.changed);
    if (r.state.doc.family && r.added.some((e) => /^family cut\b/.test(e.cmd))) warnings.push(...this.cutWarnings(name));
    this.emit({
      type: 'batch', asset: name, by: req.by, group: r.group!, entries: creates ? r.state.entries : r.added,
      changed: r.changed, reset: creates,
    });
    const followed = this.follow(name, req.by, r.added.some((e) => /^variant of=\S+ band=inherit/.test(e.cmd)));
    return { ok: true, ...base, warnings, ...totals(r.state), dir, ...(followed.length ? { followed } : {}) };
  }

  /**
   * `run dry=true`: apply a batch to a copy of the asset, check the result as if it were saved,
   * and keep nothing (no tape line, no file, nothing sent to the watchers).
   */
  dry(req: RunRequest, o: CheckRequest = {}): DryOutcome {
    const b = this.batch(req, true);
    if (!b.ok) return b;
    const { name, r } = b;
    const doc = r.added.length ? r.state.doc : null;
    const warnings = doc ? batchWarnings(r.added, r.changed) : ['no commands'];
    if (doc?.family && r.added.some((e) => /^family cut\b/.test(e.cmd))) warnings.push(...this.cutWarnings(name, doc));
    const results = doc ? this.checks(name, o, doc).results : [];
    return { ok: true, asset: name, doc, added: r.added, changed: r.changed, warnings, results };
  }

  /**
   * Try one generator line with several seeds, each as a dry run, and rank them by the checks:
   * fewest failing first, then the least over their limits, then the most room on the rest.
   */
  seeds(req: SeedsRequest): { ok: true; trials: SeedTrial[] } | { ok: false; errors: Diag[] } {
    const parsed = parse(req.line);
    if (parsed.errors.length) return { ok: false, errors: parsed.errors };
    if (parsed.commands.length !== 1) throw new ProjectError(`seeds: give one generator command (got ${parsed.commands.length})`);
    const seeds = req.seeds?.length ? [...new Set(req.seeds)] : Array.from({ length: req.count ?? 8 }, (_, i) => (req.from ?? 1) + i);
    if (seeds.some((x) => !Number.isInteger(x) || x < 1)) throw new ProjectError('seeds: seeds are whole numbers from 1');
    if (seeds.length > 64) throw new ProjectError('seeds: at most 64 seeds at once');
    const line = req.line.trim().replace(/\s+seed=\S+/, '');
    const trials: SeedTrial[] = [];
    for (const seed of seeds) {
      const text = `${line} seed=${seed}`;
      const d = this.dry({ asset: req.asset, commands: req.before ? `${req.before}\n${text}` : text, by: req.by }, { checks: req.checks });
      if (!d.ok) {
        if (d.errors.some((e) => /no option 'seed'/.test(e.message))) throw new ProjectError(`seeds: '${parsed.commands[0]!.name}' takes no seed (only generators do: noise, scatter, voronoi, bricks, map gen, family coverage, …)`);
        return d;
      }
      const written = d.added.at(-1)?.cmd ?? '';
      if (!new RegExp(`\\bseed=${seed}\\b`).test(written)) throw new ProjectError(`seeds: '${parsed.commands[0]!.name}' takes no seed (only generators do: noise, scatter, voronoi, bricks, map gen, family coverage, …)`);
      const live = d.results.filter((x) => x.status !== 'skip');
      const failing = live.filter((x) => x.status === 'fail');
      const ratio = (x: CheckResult) => overLimit(x) ?? (x.status === 'fail' ? 2 : 0);
      trials.push({
        seed, line: written, results: d.results, failing: failing.map((x) => x.id),
        excess: failing.reduce((a, x) => a + Math.max(0, ratio(x) - 1), 0),
        margin: live.filter((x) => x.status === 'pass').reduce((a, x) => Math.max(a, ratio(x)), 0),
      });
    }
    trials.sort((a, b) => a.failing.length - b.failing.length || a.excess - b.excess || a.margin - b.margin || a.seed - b.seed);
    return { ok: true, trials };
  }

  /**
   * After a `family cut`: the cut family's seam over a sample island. Cut tiles come from a painted
   * (often snapped) map, so their borders need not join; a high seam is worth knowing at once.
   */
  private cutWarnings(name: string, dry?: Doc): string[] {
    const seam = this.checks(name, { checks: ['seam'] }, dry).results[0];
    if (!seam || seam.status !== 'fail') return [];
    return [`family cut: the cut family's seam is ${seam.shown} (limit ${seam.limit}) on a sample island: its tiles do not join; look at view map, fix the band or the textures by coordinates (check seam), or cut again from a cleaner map`];
  }

  /**
   * Texture variants that inherit a family's band (variant of=<base> band=inherit) follow every
   * change to it: each gets `family band from=<base>` (the band copied into its own tape) when
   * its band differs, as one undo group by the same author. With `self`, the asset itself is
   * brought up to its base too (it has just been made to inherit).
   */
  private following = false;
  private follow(base: string, by: string, self: boolean): string[] {
    if (this.following) return [];
    this.following = true;
    const out: string[] = [];
    try {
      const queue = [base];
      const seen = new Set<string>();
      const sync = (v: string, from: string) => {
        const cur = this.doc(v);
        const d = this.dry({ asset: v, commands: `family band from=${from}`, by });
        if (!d.ok || !d.doc || Buffer.compare(Buffer.from(serializeDoc(d.doc)), Buffer.from(serializeDoc(cur))) === 0) return;
        const r = this.run({ asset: v, commands: `family band from=${from}`, by });
        if (r.ok) { out.push(v); queue.push(v); }
      };
      if (self) {
        const f = this.doc(base).family;
        if (f?.bandOf && this.assets().includes(f.bandOf)) sync(base, f.bandOf);
      }
      while (queue.length) {
        const b = queue.shift()!;
        if (seen.has(b)) continue;
        seen.add(b);
        for (const v of this.assets()) {
          if (v === b || seen.has(v)) continue;
          let f;
          try { f = this.doc(v).family; } catch { continue; }
          if (f?.bandOf === b) sync(v, b);
        }
      }
    } finally {
      this.following = false;
    }
    return out;
  }

  /** Parse and apply a batch to the asset's state (or a new one), without saving anything. */
  private batch(req: RunRequest, dry = false): { ok: true; name: string; creates: boolean; r: Extract<ReturnType<typeof runBatch>, { ok: true }> } | { ok: false; errors: Diag[] } {
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
      // A dry run keeps its own replay cache: its lines must not stand in for the tape's snapshots.
      if (!creates) state = dry ? { ...this.state(name), cache: new ReplayCache() } : this.state(name);
    } else if (!creates && !parsed.errors.length) {
      throw new ProjectError(`no asset '${name}' in ${this.project.dir}; start the commands with 'new <kind> ${name} <W>x<H>'`);
    }
    if (startsFork && !parsed.errors.length) state = this.forkPrefix(first);
    const assets = (n: string): Doc | undefined => {
      if (n === name || !this.assets().includes(n)) return undefined;
      try { return this.doc(n); } catch { return undefined; }
    };
    const defaults = styleDefaults(this.project, readManifest(this.project).manifest);
    const r = runBatch(state, req.commands, { by: req.by, at: this.now(), palettes: paletteSource(this.project), assets, assetNames: () => this.assets(), defaults, images: (b) => blobImage(this.project, b) });
    if (!r.ok) return { ok: false, errors: r.errors };
    if (r.state.doc && r.added.length && r.state.doc.name !== name) throw new ProjectError(`the commands create '${r.state.doc.name}' but the asset is '${name}'`);
    return { ok: true, name, creates, r };
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

  /**
   * Run checks on an asset with the project's style guide (all of them by default). The manifest
   * gives `consistency` the asset's set and its planned height, and a set's thresholds. A plain
   * run (every check, every frame) is kept until the asset, its ground, its set, the style guide
   * or the manifest changes.
   */
  checks(asset: string, o: CheckRequest = {}, dry?: Doc): { results: CheckResult[]; problems: string[] } {
    this.freshStyle();
    const doc = dry ?? this.doc(asset);
    if (o.frame !== undefined && (o.frame < 0 || o.frame >= doc.frameCount)) throw new ProjectError(`frame ${o.frame + 1} does not exist (frames 1..${doc.frameCount})`);
    const m = readManifest(this.project).manifest;
    const entry = manifestEntry(m, asset);
    const set = entry ? entry.set ?? entry.kind : null;
    const plan = entry && m ? {
      peers: m.assets.filter((a) => (a.set ?? a.kind) === set && a.name !== asset).map((a) => a.name),
      ...(entry.height !== undefined ? { expect: { height: entry.height } } : {}),
      ...(set && this.project.json.style?.sets?.[set]?.checks ? { setChecks: this.project.json.style.sets[set]!.checks } : {}),
    } : {};
    // A dry run's document stands in for the asset, as the project's other assets see it too.
    const saved = this.assetDocs();
    const all = dry ? [...saved.filter((a) => a.name !== asset), { name: asset, doc: dry, forkOf: saved.find((a) => a.name === asset)?.forkOf ?? null }] : saved;
    const { ctx, problems } = checkContextFor(asset, doc, all, this.project.json.style, (n) => this.project.palettes.get(n), { ...o, ...plan });
    const plain = !dry && !o.checks && o.frame === undefined && o.budget === undefined && o.ground === undefined && o.ref === undefined && o.set === undefined;
    const v = (n: string) => `${n}:${this.versions.get(n) ?? 0}`;
    const deps = ctx.world ? all.map((a) => a.name) : [asset, ...(ctx.ground ? [ctx.ground.name] : []), ...(ctx.set ?? []).map((x) => x.name), ...(ctx.peers ?? []).map((x) => x.name)];
    const key = plain ? JSON.stringify([this.project.json.style, m, deps.map(v), all.length, [...this.project.palettes.keys()]]) : '';
    const hit = plain ? this.checkMemo.get(asset) : undefined;
    if (hit && hit.key === key) return hit.out;
    // On disk, by the state keys of everything the checks read (a fresh process skips the work).
    const diskKey = plain && this.checkCache && deps.every((n) => this.keys.has(n))
      ? checkCacheKey([this.project.json.style, m, [...new Set(deps)].sort().map((n) => [n, this.keys.get(n)]), all.map((a) => a.name), [...this.project.palettes.values()].map(paletteToJson), problems])
      : null;
    const disk = diskKey ? readCheckCache<{ results: CheckResult[]; problems: string[] }>(this.project, asset, diskKey) : null;
    if (disk) {
      this.checkMemo.set(asset, { key, out: disk });
      return disk;
    }
    const out = { results: runChecks(doc, o.checks ?? CHECK_IDS, { ...ctx, budget: o.budget, focus: o.focus }), problems };
    if (plain) this.checkMemo.set(asset, { key, out });
    if (diskKey) writeCheckCache(this.project, asset, diskKey, out);
    return out;
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
    if (mode === 'render' && doc.layers.some((l) => l.underlay)) o.underlay = composeUnderlay(doc, (b) => blobImage(this.project, b));
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
    if (mode === 'density') {
      // The base and its copies, whichever of them this is.
      const all = this.assetDocs();
      const baseName = doc.densityOf?.of ?? asset;
      const base = all.find((a) => a.name === baseName)?.doc;
      if (!base) throw new ProjectError(`no asset '${baseName}' (the base of ${asset})`);
      const d = style?.density ?? {};
      o.density = { base, copies: all.filter((a) => a.doc.densityOf?.of === baseName).map((a) => a.doc), reducer: d.reducer, ink: d.ink, share: d.share };
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

  /** Tell the watchers the plan changed (a manifest written, an export recorded). */
  planChanged(): void {
    this.emit({ type: 'plan' });
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
      worker: this.workerStatus(),
    };
  }
}
