// Batches, undo groups, the tape and replay. A document is its tape replayed: every batch of
// commands is normalised, applied to a copy and logged as one undo group, or (on any error)
// nothing is applied at all.

import { applyOp, normaliseCommand, type NormaliseContext } from './commands.ts';
import { cloneDoc, flatten, type Doc } from './doc.ts';
import type { Palette } from './palette.ts';
import { DiagError, parse, type Diag } from './parser.ts';
import { Pcg32, hashString, seedFrom } from './pcg.ts';

/** The command-language version, recorded on the first line of every tape. */
export const LANG_VERSION = 1;

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
}

export type BatchResult =
  | { ok: true; state: AssetState; added: TapeEntry[]; group: string | null; changed: number }
  | { ok: false; errors: Diag[] };

interface GroupInfo {
  id: string;
  undoTargets: string[];
  hasNew: boolean;
  onlyUndo: boolean;
}

const UNDO_RE = /^undo group=(\S+)$/;

function groupsOf(entries: TapeEntry[]): GroupInfo[] {
  const map = new Map<string, GroupInfo>();
  for (const e of entries) {
    let g = map.get(e.group);
    if (!g) map.set(e.group, (g = { id: e.group, undoTargets: [], hasNew: false, onlyUndo: true }));
    const m = UNDO_RE.exec(e.cmd);
    if (m) g.undoTargets.push(m[1]!);
    else g.onlyUndo = false;
    if (e.cmd.startsWith('new ')) g.hasNew = true;
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

function nextGroupId(entries: TapeEntry[]): string {
  let max = 0;
  for (const e of entries) {
    const m = /^g(\d+)$/.exec(e.group);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `g${max + 1}`;
}

function context(doc: Doc | null, entries: TapeEntry[], current: string, palettes: PaletteSource, seq: number): NormaliseContext {
  return {
    doc,
    palette: (n) => palettes.get(n),
    defaultPalette: palettes.defaultName,
    newSeed: () => seedFrom(new Pcg32(seq, hashString(doc?.name ?? 'doc'))),
    undoTarget(group) {
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
        if (active.has(g.id) && !g.onlyUndo && !g.hasNew) return { group: g.id };
      }
      return { error: `nothing to undo` };
    },
  };
}

/** The document from the drawing commands of the groups still in effect. */
function replayEffective(entries: TapeEntry[], palettes: PaletteSource): Doc | null {
  const active = activeGroups(entries);
  let doc: Doc | null = null;
  for (const e of entries) {
    if (!active.has(e.group) || UNDO_RE.test(e.cmd)) continue;
    const { commands, errors } = parse(e.cmd);
    if (errors.length || commands.length !== 1) throw new Error(`tape seq ${e.seq}: '${e.cmd}' does not parse`);
    const n = normaliseCommand(commands[0]!, context(doc, [], e.group, palettes, e.seq));
    doc = applyOp(doc, n.op);
  }
  return doc;
}

function countChanged(before: Doc | null, after: Doc | null): number {
  if (!after) return 0;
  const b = before && before.width === after.width && before.height === after.height ? flatten(before) : null;
  const a = flatten(after);
  if (!b) return a.length;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
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
  const group = nextGroupId(state.entries);
  let seq = (state.entries[state.entries.length - 1]?.seq ?? 0) + 1;
  const added: TapeEntry[] = [];
  for (const cmd of commands) {
    try {
      const n = normaliseCommand(cmd, context(doc, entries, group, opts.palettes, seq));
      const entry: TapeEntry = { seq, by: opts.by, ...(opts.at ? { at: opts.at } : {}), group, cmd: n.text };
      entries.push(entry);
      added.push(entry);
      seq++;
      doc = n.op.k === 'undo' ? replayEffective(entries, opts.palettes) : applyOp(doc, n.op);
    } catch (e) {
      if (!(e instanceof DiagError)) throw e;
      errors.push({ line: e.line, col: e.col, message: e.message });
    }
  }
  if (errors.length) return { ok: false, errors: errors.sort((p, q) => p.line - q.line || p.col - q.col) };
  return {
    ok: true,
    state: { doc, entries },
    added,
    group: added.length ? group : null,
    changed: countChanged(state.doc, doc),
  };
}

export interface ReplayResult {
  doc: Doc | null;
  /** Problems found: lines that no longer parse, apply or are not in normal form. */
  problems: { seq: number; message: string }[];
}

/**
 * Re-run a tape from the start, command by command, exactly as it was first run. Each line must
 * normalise to itself; any line that does not is reported (and replay stops there).
 */
export function replay(entries: TapeEntry[], palettes: PaletteSource): ReplayResult {
  let doc: Doc | null = null;
  const done: TapeEntry[] = [];
  for (const e of entries) {
    const { commands, errors } = parse(e.cmd);
    if (errors.length || commands.length !== 1) {
      return { doc, problems: [{ seq: e.seq, message: errors[0] ? `does not parse: ${errors[0].message}` : `holds ${commands.length} commands` }] };
    }
    try {
      const n = normaliseCommand(commands[0]!, context(doc, done, e.group, palettes, e.seq));
      if (n.text !== e.cmd) return { doc, problems: [{ seq: e.seq, message: `not in normal form: expected '${n.text}'` }] };
      done.push(e);
      doc = n.op.k === 'undo' ? replayEffective(done, palettes) : applyOp(doc, n.op);
    } catch (err) {
      if (!(err instanceof DiagError)) throw err;
      return { doc, problems: [{ seq: e.seq, message: err.message }] };
    }
  }
  return { doc, problems: [] };
}

export function tapeHeader(): string {
  return JSON.stringify({ pclaw: 'tape', lang: LANG_VERSION });
}

export function entryToJson(e: TapeEntry): string {
  return JSON.stringify(e.at ? { seq: e.seq, by: e.by, at: e.at, group: e.group, cmd: e.cmd } : { seq: e.seq, by: e.by, group: e.group, cmd: e.cmd });
}

/** tape.jsonl text: the version header, then one entry per line. */
export function tapeToJsonl(entries: TapeEntry[]): string {
  return [tapeHeader(), ...entries.map(entryToJson)].join('\n') + '\n';
}

export function parseTape(text: string): TapeEntry[] {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) throw new Error('tape is empty (no header line)');
  const head = JSON.parse(lines[0]!) as { pclaw?: string; lang?: number };
  if (head.pclaw !== 'tape') throw new Error(`tape line 1 is not a tape header`);
  if (head.lang !== LANG_VERSION) throw new Error(`tape language version ${head.lang} is not supported (this build reads ${LANG_VERSION})`);
  return lines.slice(1).map((l, i) => {
    const o = JSON.parse(l) as TapeEntry;
    if (typeof o.seq !== 'number' || typeof o.cmd !== 'string' || typeof o.group !== 'string' || typeof o.by !== 'string') {
      throw new Error(`tape line ${i + 2}: needs seq, by, group and cmd`);
    }
    return o;
  });
}
