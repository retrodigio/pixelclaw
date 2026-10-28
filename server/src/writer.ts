// The single writer for a project (plan §8.1). Every command, from the agent (MCP), the CLI or a
// browser, goes through `run` in the order it arrives; each applied batch is saved and then sent
// to every listener (the watch view's sockets).

import { join } from 'node:path';
import {
  activeGroups, parse, replay, runBatch, type AssetState, type Diag, type Doc, type TapeEntry,
} from '@pixelclaw/core';
import {
  ProjectError, addPalettes, assetExists, listAssets, paletteSource, readTape, saveAsset, type Project,
} from './project.ts';
import type { Eye, ServerMessage, Snapshot } from './protocol.ts';
import { makeView, type View, type ViewMode, type ViewOptions } from './views.ts';

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

export type Listener = (m: ServerMessage) => void;

export interface WriterOptions {
  /** The clock for tape `at` stamps (UTC, whole seconds). */
  now?: () => string;
}

const utcNow = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

export class Writer {
  project: Project;
  private readonly states = new Map<string, AssetState>();
  private readonly listeners = new Set<Listener>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly now: () => string;
  private live: string | null = null;
  lastEye: Eye | null = null;

  constructor(project: Project, o: WriterOptions = {}) {
    this.project = project;
    this.now = o.now ?? utcNow;
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
    this.states.clear();
    this.live = null;
    this.lastEye = null;
    this.emit({ type: 'hello', snapshot: this.snapshot() });
  }

  addPalettes(files: Parameters<typeof addPalettes>[1]): void {
    addPalettes(this.project, files);
    this.emit({ type: 'palettes', palettes: [...this.project.palettes.values()], defaultPalette: this.project.json.defaultPalette });
  }

  /** The asset's state, replayed from its tape on first use and kept in memory after that. */
  state(name: string): AssetState {
    const cached = this.states.get(name);
    if (cached) return cached;
    const entries = readTape(this.project, name);
    const r = replay(entries, paletteSource(this.project));
    if (r.problems.length) {
      throw new ProjectError(`asset '${name}': tape seq ${r.problems[0]!.seq}: ${r.problems[0]!.message} (run 'pixelclaw verify')`);
    }
    const s = { doc: r.doc, entries };
    this.states.set(name, s);
    return s;
  }

  doc(name: string): Doc {
    const { doc } = this.state(name);
    if (!doc) throw new ProjectError(`asset '${name}' has an empty tape`);
    return doc;
  }

  /** Parse, apply and save one batch as one undo group. Any error applies nothing. */
  run(req: RunRequest): RunOutcome {
    const parsed = parse(req.commands);
    const first = parsed.commands[0];
    const startsNew = first?.name === 'new';
    const newName = startsNew ? first.args[1] : undefined;
    const declared = newName?.t === 'word' ? newName.v : undefined;
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
    if (exists) {
      if (startsNew && !req.replace) throw new AssetExistsError(name);
      if (!startsNew) state = this.state(name);
    } else if (!startsNew && !parsed.errors.length) {
      throw new ProjectError(`no asset '${name}' in ${this.project.dir}; start the commands with 'new <kind> ${name} <W>x<H>'`);
    }
    const r = runBatch(state, req.commands, { by: req.by, at: this.now(), palettes: paletteSource(this.project) });
    if (!r.ok) return { ok: false, errors: r.errors };
    const base = { asset: name, doc: r.state.doc, group: r.group, added: r.added, changed: r.changed, created: startsNew };
    const totals = (s: AssetState) => ({ commands: s.entries.length, groups: new Set(s.entries.map((e) => e.group)).size });
    if (!r.state.doc || r.added.length === 0) {
      return { ok: true, ...base, warnings: ['no commands'], ...totals(r.state), dir: null };
    }
    if (r.state.doc.name !== name) throw new ProjectError(`the commands create '${r.state.doc.name}' but the asset is '${name}'`);
    const dir = saveAsset(this.project, r.state);
    this.states.set(name, r.state);
    this.live = name;
    const warnings: string[] = [];
    const drew = r.added.some((e) => !e.cmd.startsWith('new ') && !e.cmd.startsWith('undo '));
    if (drew && r.changed === 0) warnings.push('the batch changed no pixels');
    this.emit({
      type: 'batch', asset: name, by: req.by, group: r.group!, entries: startsNew ? r.state.entries : r.added,
      changed: r.changed, reset: startsNew,
    });
    return { ok: true, ...base, warnings, ...totals(r.state), dir };
  }

  /** Render a view and save it (under views/ unless outDir is given). */
  view(asset: string, mode: ViewMode, o: ViewOptions = {}, outDir?: string): View {
    return makeView(this.doc(asset), mode, o, outDir ?? join(this.project.dir, 'views'));
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
    const assets = this.assets().map((name) => ({ name, entries: this.states.get(name)?.entries ?? readTape(this.project, name) }));
    return {
      project: { name: this.project.json.name, dir: this.project.dir },
      palettes: [...this.project.palettes.values()],
      defaultPalette: this.project.json.defaultPalette,
      assets,
      live: this.live,
      eye: this.lastEye,
    };
  }
}
