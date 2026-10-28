// The single writer for a project (plan §8.1). Every command, from the agent (MCP), the CLI or a
// browser, goes through `run` in the order it arrives; each applied batch is saved and then sent
// to every listener (the watch view's sockets). It also keeps each agent's read position for
// `changes`, and a timeline per asset so any earlier state is quick to rebuild.

import { join } from 'node:path';
import {
  Timeline, activeGroups, parse, replay, runBatch, type AssetState, type Diag, type Doc, type Note, type TapeEntry, type Token,
} from '@pixelclaw/core';
import {
  ProjectError, addPalettes, assetExists, forkOf, listAssets, paletteSource, readReads, readTape, saveAsset, writeReads,
  type Project,
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
const DRAWING_RE = /^(px|line|rect|ellipse|fill|paint|stroke|shift) /;
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
    this.timelines.clear();
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

  /** The document right after command `seq` of an asset's tape (null before its first command). */
  docAt(name: string, seq: number): Doc | null {
    let tl = this.timelines.get(name);
    if (!tl) this.timelines.set(name, (tl = new Timeline(paletteSource(this.project))));
    const r = tl.docAfter(this.state(name).entries, seq);
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
    const r = runBatch(state, req.commands, { by: req.by, at: this.now(), palettes: paletteSource(this.project) });
    if (!r.ok) return { ok: false, errors: r.errors };
    const base = { asset: name, doc: r.state.doc, group: r.group, added: r.added, changed: r.changed, created: creates };
    const totals = (s: AssetState) => ({ commands: s.entries.length, groups: new Set(s.entries.map((e) => e.group)).size });
    if (!r.state.doc || r.added.length === 0) {
      return { ok: true, ...base, warnings: ['no commands'], ...totals(r.state), dir: null };
    }
    if (r.state.doc.name !== name) throw new ProjectError(`the commands create '${r.state.doc.name}' but the asset is '${name}'`);
    const dir = saveAsset(this.project, r.state);
    this.states.set(name, r.state);
    this.live = name;
    const warnings: string[] = [];
    const drew = r.added.some((e) => DRAWING_RE.test(e.cmd));
    if (drew && r.changed === 0) warnings.push('the batch changed no pixels');
    this.emit({
      type: 'batch', asset: name, by: req.by, group: r.group!, entries: creates ? r.state.entries : r.added,
      changed: r.changed, reset: creates,
    });
    return { ok: true, ...base, warnings, ...totals(r.state), dir };
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
   * Render a view and save it (under views/ unless outDir is given). The diff compares with the
   * document after command `since`, by default the one before the latest group.
   */
  view(asset: string, mode: ViewMode, o: ViewOptions = {}, outDir?: string, before?: Doc | null): View {
    const dir = outDir ?? join(this.project.dir, 'views');
    if (mode !== 'diff' || before !== undefined) return makeView(this.doc(asset), mode, o, dir, before);
    const { entries } = this.state(asset);
    let since = o.since;
    if (since === undefined) {
      const g = entries.at(-1)?.group;
      since = (entries.find((e) => e.group === g)?.seq ?? 1) - 1;
    }
    return makeView(this.doc(asset), mode, o, dir, since > 0 ? this.docAt(asset, since) : null);
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
