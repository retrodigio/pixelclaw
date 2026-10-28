// Batches, undo groups, the tape and replay. A document is its tape replayed: every batch of
// commands is normalised, applied to a copy and logged as one undo group, or (on any error)
// nothing is applied at all.

import { LANG_VERSION, applyOp, normaliseCommand, type NormaliseContext } from './commands.ts';
import './registry.ts';
import { cloneDoc, flatten, type Doc } from './doc.ts';
import type { Palette } from './palette.ts';
import { DiagError, parse, type Diag } from './parser.ts';
import { Pcg32, hashString, seedFrom } from './pcg.ts';


export interface TapeEntry {
  seq: number;
  by: string;
  at?: string;
  group: string;
  cmd: string;
}

export interface PaletteSource {
  get(name: string): Palette | undefined;
  defaultName?: string;
}

export interface AssetState {
  doc: Doc | null;
  entries: TapeEntry[];
  /** Snapshots that make an undo replay from near the undone group instead of from the start. */
  cache?: ReplayCache;
}

export type BatchResult =
  | {
    ok: true; state: AssetState; added: TapeEntry[]; group: string | null; changed: number;
    /** `palette save as=<name>` lines: the palette as it was at that line, for the writer to save. */
    saves: { name: string; palette: Palette }[];
  }
  | { ok: false; errors: Diag[] };

interface GroupInfo {
  id: string;
  /** The author of the group's first command. */
  by: string;
  undoTargets: string[];
  /** Holds `new` or `fork`: the group that made this tape's document, which cannot be undone. */
  hasNew: boolean;
  /** Every command is an undo or a redo. */
  onlyUndo: boolean;
}

const UNDO_RE = /^(?:undo|redo) group=(\S+)$/;

function groupsOf(entries: TapeEntry[]): GroupInfo[] {
  const map = new Map<string, GroupInfo>();
  for (const e of entries) {
    let g = map.get(e.group);
    if (!g) map.set(e.group, (g = { id: e.group, by: e.by, undoTargets: [], hasNew: false, onlyUndo: true }));
    const m = UNDO_RE.exec(e.cmd);
    if (m) g.undoTargets.push(m[1]!);
    else g.onlyUndo = false;
    if (e.cmd.startsWith('new ') || e.cmd.startsWith('fork ')) g.hasNew = true;
  }
  return [...map.values()];
}

/**
 * The groups still in effect. Walking from the latest group back, a group is undone when a later
 * group still in effect undoes it. Undoing an undo group therefore redoes what it undid.
 */
export function activeGroups(entries: TapeEntry[]): Set<string> {
  const groups = groupsOf(entries);
  const undone = new Set<string>();
  const active = new Set<string>();
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]!;
    if (undone.has(g.id)) continue;
    active.add(g.id);
    for (const t of g.undoTargets) undone.add(t);
  }
  return active;
}

/** The group-id prefix for an author: `h` for people (`human:…`), `g` for agents and scripts. */
export function groupPrefix(by: string): 'g' | 'h' {
  return by === 'human' || by.startsWith('human:') ? 'h' : 'g';
}

/** The next group id with this prefix: each prefix counts on its own (g1, g2, … and h1, h2, …). */
export function nextGroupId(entries: TapeEntry[], prefix = 'g'): string {
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  for (const e of entries) {
    const m = re.exec(e.group);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

type Target = { group: string } | { error: string };

/**
 * The group a plain `undo` (or `undo by=<author>`) takes back: the latest group still in effect,
 * by that author if given, that draws (is not itself an undo) and did not create the document.
 */
export function findUndo(entries: TapeEntry[], group: string | null, by: string | null = null, current?: string): Target {
  const groups = groupsOf(entries).filter((g) => g.id !== current);
  const active = activeGroups(entries);
  if (group !== null) {
    if (group === current) return { error: `a batch cannot undo its own group` };
    const g = groups.find((x) => x.id === group);
    if (!g) return { error: `no group '${group}' on this tape` };
    if (!active.has(group)) return { error: `group '${group}' is already undone` };
    if (g.hasNew) return { error: `group '${group}' created the document and cannot be undone` };
    return { group };
  }
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]!;
    if (by !== null && g.by !== by) continue;
    if (active.has(g.id) && !g.onlyUndo && !g.hasNew) return { group: g.id };
  }
  return { error: by !== null ? `nothing of ${by}'s to undo` : `nothing to undo` };
}

/**
 * The undo group a `redo` takes back. With a group, it must be an undo still in effect. Otherwise
 * the latest undo still in effect (by that author if given), as long as no drawing came after it:
 * drawing something new ends the redo chain, as in any editor.
 */
export function findRedo(entries: TapeEntry[], group: string | null, by: string | null = null, current?: string): Target {
  const groups = groupsOf(entries).filter((g) => g.id !== current);
  const byId = new Map(groups.map((g) => [g.id, g]));
  const active = activeGroups(entries);
  /** An undo step: an undo group whose targets are drawing groups (not a redo). */
  const isUndoStep = (g: GroupInfo) => g.onlyUndo && g.undoTargets.every((t) => !byId.get(t)?.onlyUndo);
  if (group !== null) {
    const g = byId.get(group);
    if (!g) return { error: `no group '${group}' on this tape` };
    if (!g.onlyUndo || !isUndoStep(g)) return { error: `group '${group}' is not an undo, so there is nothing to redo` };
    if (!active.has(group)) return { error: `group '${group}' is already taken back` };
    return { group };
  }
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]!;
    if (by !== null && g.by !== by) continue;
    if (!g.onlyUndo) break;
    if (isUndoStep(g) && active.has(g.id)) return { group: g.id };
  }
  return { error: by !== null ? `nothing of ${by}'s to redo` : `nothing to redo` };
}

const NOTE_LINE_RE = /^note .* id=n(\d+)$/;

function nextNoteId(entries: TapeEntry[]): string {
  let max = 0;
  for (const e of entries) {
    const m = NOTE_LINE_RE.exec(e.cmd);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `n${max + 1}`;
}

function context(doc: Doc | null, entries: TapeEntry[], current: string, palettes: PaletteSource, seq: number, by: string): NormaliseContext {
  return {
    doc,
    seq,
    by,
    palette: (n) => palettes.get(n),
    defaultPalette: palettes.defaultName,
    newSeed: () => seedFrom(new Pcg32(seq, hashString(doc?.name ?? 'doc'))),
    undoTarget: (group, by) => findUndo(entries, group, by ?? null, current),
    redoTarget: (group, by) => findRedo(entries, group, by ?? null, current),
    noteId: () => nextNoteId(entries),
  };
}

/**
 * Snapshots of the effective replay (the document from the groups still in effect), so an undo
 * replays only from the last snapshot before the first command whose group changed state. A
 * snapshot after n entries is reused while the same groups among those n are undone.
 */
export class ReplayCache {
  private snaps: { n: number; last: TapeEntry; undone: string; doc: Doc | null }[] = [];
  private readonly every: number;
  constructor(every = 100) {
    this.every = every;
  }

  /** The undone drawing groups among the first n entries, as a key. */
  private static key(entries: TapeEntry[], n: number, active: Set<string>): string {
    const out = new Set<string>();
    for (let i = 0; i < n; i++) {
      const e = entries[i]!;
      if (!active.has(e.group) && !UNDO_RE.test(e.cmd)) out.add(e.group);
    }
    return [...out].sort().join(' ');
  }

  /**
   * Keep the document after the first n entries (all of the tape so far) when n is a multiple of
   * the snapshot spacing: as a tape is written, its undo snapshots come for free.
   */
  record(entries: TapeEntry[], doc: Doc | null): void {
    const n = entries.length;
    if (n === 0 || n % this.every !== 0 || this.snaps.some((s) => s.n === n && s.last === entries[n - 1])) return;
    this.snaps = this.snaps.filter((s) => s.n !== n);
    this.snaps.push({ n, last: entries[n - 1]!, undone: ReplayCache.key(entries, n, activeGroups(entries)), doc: doc ? cloneDoc(doc) : null });
  }

  /** How many snapshots are held (for tests). */
  get size(): number {
    return this.snaps.length;
  }

  /** The document from the groups still in effect. */
  replay(entries: TapeEntry[], palettes: PaletteSource): Doc | null {
    const active = activeGroups(entries);
    this.snaps = this.snaps.filter((s) => s.n <= entries.length && entries[s.n - 1] === s.last);
    let base: { n: number; doc: Doc | null } = { n: 0, doc: null };
    for (const s of [...this.snaps].sort((a, b) => b.n - a.n)) {
      if (ReplayCache.key(entries, s.n, active) === s.undone) {
        base = s;
        break;
      }
    }
    let doc = base.doc ? cloneDoc(base.doc) : null;
    for (let i = base.n; i < entries.length; i++) {
      const e = entries[i]!;
      if (active.has(e.group) && !UNDO_RE.test(e.cmd)) {
        const { commands, errors } = parse(e.cmd);
        if (errors.length || commands.length !== 1) throw new Error(`tape seq ${e.seq}: '${e.cmd}' does not parse`);
        const n = normaliseCommand(commands[0]!, context(doc, [], e.group, palettes, e.seq, e.by));
        doc = applyOp(doc, n.op, e.by);
      }
      const n = i + 1;
      if (n % this.every === 0 && n < entries.length && !this.snaps.some((s) => s.n === n && s.last === e)) {
        this.snaps = this.snaps.filter((s) => s.n !== n);
        this.snaps.push({ n, last: e, undone: ReplayCache.key(entries, n, active), doc: doc ? cloneDoc(doc) : null });
      }
    }
    return doc;
  }
}

/** The document from the drawing commands of the groups still in effect (no snapshots). */
function replayEffective(entries: TapeEntry[], palettes: PaletteSource, cache?: ReplayCache): Doc | null {
  return (cache ?? new ReplayCache()).replay(entries, palettes);
}

/** Pixels of the flat art that differ, over every frame (a frame that is new counts whole). */
function countChanged(before: Doc | null, after: Doc | null): number {
  if (!after) return 0;
  const same = before && before.width === after.width && before.height === after.height;
  let n = 0;
  for (let f = 0; f < after.frameCount; f++) {
    const a = flatten(after, f);
    const b = same && f < before.frameCount ? flatten(before, f) : null;
    if (!b) { n += a.length; continue; }
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  }
  return n;
}

/**
 * Parse, normalise and apply a batch of command text as one undo group. On any error (parse or
 * semantic) the result lists every error with its line and column and the state is untouched.
 */
export function runBatch(state: AssetState, text: string, opts: { by: string; at?: string; palettes: PaletteSource }): BatchResult {
  const { commands, errors } = parse(text);
  let doc = state.doc ? cloneDoc(state.doc) : null;
  const entries = [...state.entries];
  const cache = state.cache ?? new ReplayCache();
  const group = nextGroupId(state.entries, groupPrefix(opts.by));
  let seq = (state.entries[state.entries.length - 1]?.seq ?? 0) + 1;
  const added: TapeEntry[] = [];
  const saves: { name: string; palette: Palette }[] = [];
  for (const cmd of commands) {
    try {
      const n = normaliseCommand(cmd, context(doc, entries, group, opts.palettes, seq, opts.by));
      const entry: TapeEntry = { seq, by: opts.by, ...(opts.at ? { at: opts.at } : {}), group, cmd: n.text };
      entries.push(entry);
      added.push(entry);
      seq++;
      doc = n.op.k === 'undo' ? replayEffective(entries, opts.palettes, cache) : applyOp(doc, n.op, opts.by);
      cache.record(entries, doc);
      const save = /^palette save as=(\S+)$/.exec(n.text);
      if (save && doc) saves.push({ name: save[1]!, palette: doc.palette });
    } catch (e) {
      if (!(e instanceof DiagError)) throw e;
      errors.push({ line: e.line, col: e.col, message: e.message });
    }
  }
  if (errors.length) return { ok: false, errors: errors.sort((p, q) => p.line - q.line || p.col - q.col) };
  return {
    ok: true,
    state: { doc, entries, cache },
    added,
    group: added.length ? group : null,
    changed: countChanged(state.doc, doc),
    saves,
  };
}

export interface ReplayResult {
  doc: Doc | null;
  /** Undo snapshots taken on the way (pass them on in the asset state). */
  cache?: ReplayCache;
  /** Problems found: lines that no longer parse, apply or are not in normal form. */
  problems: { seq: number; message: string }[];
}

/**
 * Applies tape entries one at a time, exactly as they were first run: the step-by-step form of
 * `replay`, for live playback and time travel. Each line must normalise to itself.
 */
export class TapeCursor {
  doc: Doc | null = null;
  readonly done: TapeEntry[] = [];
  private readonly palettes: PaletteSource;
  /** Undo snapshots, kept as the cursor steps; hand them on with the state. */
  readonly cache = new ReplayCache();

  constructor(palettes: PaletteSource) {
    this.palettes = palettes;
  }

  /** A cursor that carries on from a known point: `doc` is the document after `done` (it is copied). */
  static resume(palettes: PaletteSource, doc: Doc | null, done: TapeEntry[]): TapeCursor {
    const c = new TapeCursor(palettes);
    c.doc = doc ? cloneDoc(doc) : null;
    c.done.push(...done);
    return c;
  }

  /** Apply one entry. On a problem the cursor is unchanged and the message is returned. */
  step(e: TapeEntry): string | null {
    const { commands, errors } = parse(e.cmd);
    if (errors.length || commands.length !== 1) {
      return errors[0] ? `does not parse: ${errors[0].message}` : `holds ${commands.length} commands`;
    }
    try {
      const ctx = context(this.doc, this.done, e.group, this.palettes, e.seq, e.by);
      let n = normaliseCommand(commands[0]!, ctx);
      // A language 1 tape: its `new` line has no palette block and reads the project's palette.
      if (n.text !== e.cmd && isLang1New(e.cmd)) n = normaliseCommand(commands[0]!, { ...ctx, lang: 1 });
      if (n.text !== e.cmd) return `not in normal form: expected '${n.text}'`;
      this.done.push(e);
      this.doc = n.op.k === 'undo' ? replayEffective(this.done, this.palettes, this.cache) : applyOp(this.doc, n.op, e.by);
      this.cache.record(this.done, this.doc);
      return null;
    } catch (err) {
      if (!(err instanceof DiagError)) throw err;
      return err.message;
    }
  }
}

interface Snapshot {
  n: number;
  last: TapeEntry;
  doc: Doc | null;
}

/**
 * The document at any point of a tape without replaying it from the start each time: a snapshot
 * is kept every `every` commands as they are first passed, and a request replays from the nearest
 * one before it. Snapshots are checked against the tape (the entry they end on), so a tape that
 * grows keeps them and a tape that was started again drops them.
 */
export class Timeline {
  private readonly palettes: PaletteSource;
  private readonly every: number;
  private snaps: Snapshot[] = [];

  constructor(palettes: PaletteSource, every = 100) {
    this.palettes = palettes;
    this.every = every;
  }

  /** The document after the first n entries of the tape (a fresh copy the caller may keep). */
  docAt(tape: TapeEntry[], n: number): { doc: Doc | null; problem: string | null } {
    n = Math.max(0, Math.min(n, tape.length));
    this.snaps = this.snaps.filter((s) => s.n <= tape.length && tape[s.n - 1] === s.last);
    let base: Snapshot | undefined;
    for (const s of this.snaps) if (s.n <= n && (!base || s.n > base.n)) base = s;
    const cur = TapeCursor.resume(this.palettes, base?.doc ?? null, tape.slice(0, base?.n ?? 0));
    for (let i = base?.n ?? 0; i < n; i++) {
      const problem = cur.step(tape[i]!);
      if (problem !== null) return { doc: cur.doc, problem: `#${tape[i]!.seq}: ${problem}` };
      if ((i + 1) % this.every === 0 && !this.snaps.some((s) => s.n === i + 1)) {
        this.snaps.push({ n: i + 1, last: tape[i]!, doc: cur.doc ? cloneDoc(cur.doc) : null });
      }
    }
    return { doc: cur.doc, problem: null };
  }

  /** Keep a known state (from a checkpoint file): the document after the first n entries of `tape`. */
  seed(tape: TapeEntry[], n: number, doc: Doc | null): void {
    if (n < 1 || n > tape.length || this.snaps.some((s) => s.n === n)) return;
    this.snaps.push({ n, last: tape[n - 1]!, doc: doc ? cloneDoc(doc) : null });
  }

  /** The document right after the entry with this seq (or before the tape starts, for 0). */
  docAfter(tape: TapeEntry[], seq: number): { doc: Doc | null; problem: string | null } {
    let n = 0;
    while (n < tape.length && tape[n]!.seq <= seq) n++;
    return this.docAt(tape, n);
  }

  /** How many snapshots are held (for tests). */
  get size(): number {
    return this.snaps.length;
  }
}

/**
 * Re-run a tape from the start, command by command, exactly as it was first run. Each line must
 * normalise to itself; any line that does not is reported (and replay stops there).
 */
export function replay(entries: TapeEntry[], palettes: PaletteSource): ReplayResult {
  const cur = new TapeCursor(palettes);
  for (const e of entries) {
    const message = cur.step(e);
    if (message !== null) return { doc: cur.doc, problems: [{ seq: e.seq, message }] };
  }
  return { doc: cur.doc, problems: [], cache: cur.cache };
}

const isLang1New = (cmd: string): boolean => cmd.startsWith('new ') && !cmd.includes('\n');

/**
 * The language a tape is written in: 1 when its first line is a `new` without a palette block
 * (or a fork of such a tape), else the current version. A branch keeps its source's language.
 */
export function tapeLang(entries: TapeEntry[]): number {
  return entries[0] && isLang1New(entries[0].cmd) ? 1 : LANG_VERSION;
}

export function tapeHeader(lang = LANG_VERSION): string {
  return JSON.stringify({ pclaw: 'tape', lang });
}

export function entryToJson(e: TapeEntry): string {
  return JSON.stringify(e.at ? { seq: e.seq, by: e.by, at: e.at, group: e.group, cmd: e.cmd } : { seq: e.seq, by: e.by, group: e.group, cmd: e.cmd });
}

/** tape.jsonl text: the version header, then one entry per line. */
export function tapeToJsonl(entries: TapeEntry[]): string {
  return [tapeHeader(tapeLang(entries)), ...entries.map(entryToJson)].join('\n') + '\n';
}

/** The tape's entries; the header's language must be one this build reads (1 or 2) and match the tape. */
export function parseTape(text: string): TapeEntry[] {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) throw new Error('tape is empty (no header line)');
  const head = JSON.parse(lines[0]!) as { pclaw?: string; lang?: number };
  if (head.pclaw !== 'tape') throw new Error(`tape line 1 is not a tape header`);
  if (head.lang !== 1 && head.lang !== LANG_VERSION) throw new Error(`tape language version ${head.lang} is not supported (this build reads 1 and ${LANG_VERSION})`);
  const entries = lines.slice(1).map((l, i) => {
    const o = JSON.parse(l) as TapeEntry;
    if (typeof o.seq !== 'number' || typeof o.cmd !== 'string' || typeof o.group !== 'string' || typeof o.by !== 'string') {
      throw new Error(`tape line ${i + 2}: needs seq, by, group and cmd`);
    }
    return o;
  });
  if (entries.length && tapeLang(entries) !== head.lang) {
    throw new Error(`tape header says language ${head.lang} but its first line is written in language ${tapeLang(entries)}`);
  }
  return entries;
}
