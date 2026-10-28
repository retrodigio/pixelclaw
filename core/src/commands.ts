// Command specs. Each command normalises its parsed tokens into an operation plus the canonical
// command text that goes onto the tape: defaults filled in, colours by palette name, seeds chosen
// and written down. Normalising a normalised line gives the same line back.

import { DOC_KINDS, TRANSPARENT, activeCel, createDoc, type Doc, type DocKind } from './doc.ts';
import type { Palette } from './palette.ts';
import { DiagError, quote, type BlockRow, type ParsedCommand, type Token } from './parser.ts';
import { ellipsePixels, fill, plot, polyline, rectPixels, type Pt, type Target } from './raster.ts';

export interface NormaliseContext {
  /** The document before this command (null before 'new'). */
  doc: Doc | null;
  palette(name: string): Palette | undefined;
  defaultPalette?: string;
  /** A fresh seed for this command, deterministic in the command's tape position. */
  newSeed(): number;
  /** Resolve an undo target: the group to undo, or an error message. */
  undoTarget(group: string | null): { group: string } | { error: string };
}

export type Op =
  | { k: 'new'; kind: DocKind; name: string; width: number; height: number; cellW: number; cellH: number; wrap: boolean; palette: Palette; bg: number }
  | { k: 'pixels'; pts: Pt[]; c: number }
  | { k: 'fill'; x: number; y: number; c: number; global: boolean; conn: 4 | 8 }
  | { k: 'paint'; x: number; y: number; rows: (number | null)[][] }
  | { k: 'undo'; group: string };

export interface Normalised {
  text: string;
  op: Op;
}

export interface CommandSpec {
  name: string;
  summary: string;
  normalise(cmd: ParsedCommand, ctx: NormaliseContext): Normalised;
}

/** Splits a command's tokens into positionals, options, flags and an optional @cell. */
export class Args {
  readonly cmd: ParsedCommand;
  readonly positional: Token[] = [];
  readonly opts = new Map<string, Extract<Token, { t: 'kv' }>>();
  readonly flags: Extract<Token, { t: 'word' }>[] = [];
  cell: Extract<Token, { t: 'cell' }> | null = null;
  private next = 0;

  constructor(cmd: ParsedCommand, allowedOpts: string[], allowedFlags: string[] = []) {
    this.cmd = cmd;
    for (const a of cmd.args) {
      if (a.t === 'kv') {
        if (!allowedOpts.includes(a.key)) {
          const list = allowedOpts.length ? ` (options: ${allowedOpts.join(', ')})` : '';
          throw new DiagError(a.line, a.col, `${cmd.name} has no option '${a.key}'${list}`);
        }
        if (this.opts.has(a.key)) throw new DiagError(a.line, a.col, `option '${a.key}' given twice`);
        this.opts.set(a.key, a);
      } else if (a.t === 'cell') {
        if (this.cell) throw new DiagError(a.line, a.col, `@cell given twice`);
        this.cell = a;
      } else if (a.t === 'word' && allowedFlags.includes(a.v)) {
        this.flags.push(a);
      } else this.positional.push(a);
    }
  }

  /** Where a missing positional would go: one space past the last one read (or the command name). */
  private where(): [number, number] {
    const prev = this.positional[this.next - 1];
    if (prev) return [prev.line, prev.col + tokenText(prev).length + 1];
    return [this.cmd.line, this.cmd.col + this.cmd.name.length + 1];
  }

  peek(): Token | undefined {
    return this.positional[this.next];
  }

  take<T extends Token['t']>(t: T, what: string): Extract<Token, { t: T }> {
    const tok = this.positional[this.next];
    if (!tok) {
      const [l, c] = this.where();
      throw new DiagError(l, c, `${this.cmd.name}: expected ${what}`);
    }
    if (tok.t !== t) throw new DiagError(tok.line, tok.col, `${this.cmd.name}: expected ${what}`);
    this.next++;
    return tok as Extract<Token, { t: T }>;
  }

  rest(): Token[] {
    const r = this.positional.slice(this.next);
    this.next = this.positional.length;
    return r;
  }

  done(): void {
    const extra = this.positional[this.next];
    if (extra) throw new DiagError(extra.line, extra.col, `${this.cmd.name}: unexpected '${tokenText(extra)}'`);
  }

  /** The cell origin in pixels, and its normalised text. */
  cellOrigin(doc: Doc): { dx: number; dy: number; text: string } {
    if (!this.cell) return { dx: 0, dy: 0, text: '' };
    const { cx, cy } = this.cell;
    const cols = Math.floor(doc.width / doc.cellW);
    const rows = Math.floor(doc.height / doc.cellH);
    if (cx >= cols || cy >= rows) throw new DiagError(this.cell.line, this.cell.col, `@cell(${cx},${cy}) is outside the ${cols}x${rows} cell grid`);
    return { dx: cx * doc.cellW, dy: cy * doc.cellH, text: ` @cell(${cx},${cy})` };
  }

  flag(names: string[], dflt: string): string {
    const hits = this.flags.filter((f) => names.includes(f.v));
    if (hits.length > 1) throw new DiagError(hits[1]!.line, hits[1]!.col, `choose one of ${names.join(' or ')}`);
    return hits[0]?.v ?? dflt;
  }

  choice(key: string, values: string[], dflt: string): string {
    const o = this.opts.get(key);
    if (!o) return dflt;
    if (!values.includes(o.value)) throw new DiagError(o.line, o.vcol, `${key}= must be one of ${values.join(', ')}`);
    return o.value;
  }
}

function tokenText(t: Token): string {
  switch (t.t) {
    case 'word': return t.v;
    case 'int': return String(t.v);
    case 'point': return `${t.x},${t.y}`;
    case 'size': return `${t.w}x${t.h}`;
    case 'cell': return `@cell(${t.cx},${t.cy})`;
    case 'string': return quote(t.v);
    case 'kv': return `${t.key}=${t.quoted ? quote(t.value) : t.value}`;
    case 'block': return '<<';
  }
}

function needDoc(cmd: ParsedCommand, ctx: NormaliseContext): Doc {
  if (!ctx.doc) throw new DiagError(cmd.line, cmd.col, `there is no document yet: start with 'new'`);
  return ctx.doc;
}

/** Resolve a colour: an entry name, a key, an exact #rrggbb of an entry, or 'none'. */
export function resolveColour(value: string, palette: Palette, line: number, col: number): { index: number; name: string } {
  if (value === 'none') return { index: TRANSPARENT, name: 'none' };
  let i = palette.entries.findIndex((e) => e.name === value);
  if (i < 0 && [...value].length === 1) i = palette.entries.findIndex((e) => e.key === value);
  if (i < 0 && value.startsWith('#')) {
    const hex = value.toLowerCase();
    i = palette.entries.findIndex((e) => e.hex === hex);
    if (i < 0) throw new DiagError(line, col, `c=${value} is not in palette '${palette.name}'`);
  }
  if (i < 0) {
    const names = palette.entries.map((e) => e.name);
    const shown = names.length > 12 ? names.slice(0, 12).join(', ') + ', ...' : names.join(', ');
    throw new DiagError(line, col, `unknown colour '${value}' (palette '${palette.name}': ${shown}, none)`);
  }
  return { index: i, name: palette.entries[i]!.name };
}

function colourOpt(a: Args, doc: Doc): { index: number; name: string } {
  const o = a.opts.get('c');
  if (!o) throw new DiagError(a.cmd.line, a.cmd.col, `${a.cmd.name}: missing c=<colour>`);
  return resolveColour(o.value, doc.palette, o.line, o.vcol);
}

const shiftPts = (pts: Pt[], dx: number, dy: number): Pt[] => (dx || dy ? pts.map(([x, y]) => [x + dx, y + dy]) : pts);

const newCmd: CommandSpec = {
  name: 'new',
  summary: 'new <kind> <name> <W>x<H> [palette=<name>] [wrap=on|off] [cell=<W>x<H>] [bg=<colour>|none]',
  normalise(cmd, ctx) {
    if (ctx.doc) throw new DiagError(cmd.line, cmd.col, `new must be the first command of a tape (this document already exists)`);
    const a = new Args(cmd, ['palette', 'wrap', 'cell', 'bg']);
    const kindTok = a.take('word', `a kind (${DOC_KINDS.join(', ')})`);
    if (!DOC_KINDS.includes(kindTok.v as DocKind)) throw new DiagError(kindTok.line, kindTok.col, `unknown kind '${kindTok.v}' (kinds: ${DOC_KINDS.join(', ')})`);
    const kind = kindTok.v as DocKind;
    const nameTok = a.take('word', 'a document name');
    if (!/^[a-z][a-z0-9_-]*$/.test(nameTok.v)) throw new DiagError(nameTok.line, nameTok.col, `document names use a-z, 0-9, _ and -, starting with a letter`);
    const size = a.take('size', 'a size like 24x24');
    a.done();
    if (size.w < 1 || size.h < 1 || size.w > 4096 || size.h > 4096) throw new DiagError(size.line, size.col, `size must be 1..4096 on each side`);
    const palOpt = a.opts.get('palette');
    const palName = palOpt?.value ?? ctx.defaultPalette;
    if (!palName) throw new DiagError(cmd.line, cmd.col, `new: no palette= given and the project has no default palette`);
    const palette = ctx.palette(palName);
    if (!palette) throw new DiagError(palOpt?.line ?? cmd.line, palOpt?.vcol ?? cmd.col, `unknown palette '${palName}'`);
    const wrap = a.choice('wrap', ['on', 'off'], kind === 'tile' ? 'on' : 'off') === 'on';
    let cellW = size.w;
    let cellH = size.h;
    const cellOpt = a.opts.get('cell');
    if (cellOpt) {
      const m = /^(\d+)x(\d+)$/.exec(cellOpt.value);
      if (!m || Number(m[1]) < 1 || Number(m[2]) < 1) throw new DiagError(cellOpt.line, cellOpt.vcol, `cell= must be a size like 24x24`);
      cellW = Number(m[1]);
      cellH = Number(m[2]);
    }
    const bgOpt = a.opts.get('bg');
    const bg = bgOpt ? resolveColour(bgOpt.value, palette, bgOpt.line, bgOpt.vcol) : { index: TRANSPARENT, name: 'none' };
    return {
      text: `new ${kind} ${nameTok.v} ${size.w}x${size.h} palette=${palette.name} wrap=${wrap ? 'on' : 'off'} cell=${cellW}x${cellH} bg=${bg.name}`,
      op: { k: 'new', kind, name: nameTok.v, width: size.w, height: size.h, cellW, cellH, wrap, palette, bg: bg.index },
    };
  },
};

const pxCmd: CommandSpec = {
  name: 'px',
  summary: 'px <x,y> [<x,y> ...] c=<colour>',
  normalise(cmd, ctx) {
    const doc = needDoc(cmd, ctx);
    const a = new Args(cmd, ['c']);
    const cell = a.cellOrigin(doc);
    const pts: Pt[] = [];
    pts.push(pt(a.take('point', 'a point x,y')));
    for (const t of a.rest()) {
      if (t.t !== 'point') throw new DiagError(t.line, t.col, `px: expected a point x,y`);
      pts.push(pt(t));
    }
    const c = colourOpt(a, doc);
    return { text: `px${cell.text} ${pts.map(ptText).join(' ')} c=${c.name}`, op: { k: 'pixels', pts: shiftPts(pts, cell.dx, cell.dy), c: c.index } };
  },
};

const lineCmd: CommandSpec = {
  name: 'line',
  summary: 'line <x,y> <x,y> [<x,y> ...] c=<colour> [pp=on|off]',
  normalise(cmd, ctx) {
    const doc = needDoc(cmd, ctx);
    const a = new Args(cmd, ['c', 'pp']);
    const cell = a.cellOrigin(doc);
    const pts: Pt[] = [pt(a.take('point', 'a start point x,y')), pt(a.take('point', 'an end point x,y'))];
    for (const t of a.rest()) {
      if (t.t !== 'point') throw new DiagError(t.line, t.col, `line: expected a point x,y`);
      pts.push(pt(t));
    }
    const c = colourOpt(a, doc);
    const pp = a.choice('pp', ['on', 'off'], 'on');
    return {
      text: `line${cell.text} ${pts.map(ptText).join(' ')} c=${c.name} pp=${pp}`,
      op: { k: 'pixels', pts: polyline(shiftPts(pts, cell.dx, cell.dy), pp === 'on'), c: c.index },
    };
  },
};

const rectCmd: CommandSpec = {
  name: 'rect',
  summary: 'rect <x,y> <W>x<H> c=<colour> [outline|fill]',
  normalise(cmd, ctx) {
    const doc = needDoc(cmd, ctx);
    const a = new Args(cmd, ['c'], ['outline', 'fill']);
    const cell = a.cellOrigin(doc);
    const p = a.take('point', 'a corner x,y');
    const s = a.take('size', 'a size WxH');
    a.done();
    if (s.w < 1 || s.h < 1) throw new DiagError(s.line, s.col, `rect: size must be at least 1x1`);
    const c = colourOpt(a, doc);
    const mode = a.flag(['outline', 'fill'], 'outline');
    return {
      text: `rect${cell.text} ${p.x},${p.y} ${s.w}x${s.h} c=${c.name} ${mode}`,
      op: { k: 'pixels', pts: rectPixels(p.x + cell.dx, p.y + cell.dy, s.w, s.h, mode === 'fill'), c: c.index },
    };
  },
};

const ellipseCmd: CommandSpec = {
  name: 'ellipse',
  summary: 'ellipse <cx,cy> r=<RX>x<RY>|r=<R> c=<colour> [outline|fill]   or   ellipse <x,y> <W>x<H> c=<colour> [outline|fill]',
  normalise(cmd, ctx) {
    const doc = needDoc(cmd, ctx);
    const a = new Args(cmd, ['c', 'r'], ['outline', 'fill']);
    const cell = a.cellOrigin(doc);
    const p = a.take('point', 'a centre x,y (with r=) or a corner x,y (with a size)');
    const rOpt = a.opts.get('r');
    let box: [number, number, number, number];
    let shape: string;
    if (rOpt) {
      const m = /^(\d+)(?:x(\d+))?$/.exec(rOpt.value);
      if (!m) throw new DiagError(rOpt.line, rOpt.vcol, `r= must be a radius like 5 or 5x3`);
      const rx = Number(m[1]);
      const ry = Number(m[2] ?? m[1]);
      a.done();
      box = [p.x - rx, p.y - ry, p.x + rx, p.y + ry];
      shape = `${p.x},${p.y} r=${rx}x${ry}`;
    } else {
      const s = a.take('size', 'a size WxH (or r=<radius>)');
      a.done();
      if (s.w < 1 || s.h < 1) throw new DiagError(s.line, s.col, `ellipse: size must be at least 1x1`);
      box = [p.x, p.y, p.x + s.w - 1, p.y + s.h - 1];
      shape = `${p.x},${p.y} ${s.w}x${s.h}`;
    }
    const c = colourOpt(a, doc);
    const mode = a.flag(['outline', 'fill'], 'outline');
    const pts = ellipsePixels(box[0] + cell.dx, box[1] + cell.dy, box[2] + cell.dx, box[3] + cell.dy, mode === 'fill');
    return { text: `ellipse${cell.text} ${shape} c=${c.name} ${mode}`, op: { k: 'pixels', pts, c: c.index } };
  },
};

const fillCmd: CommandSpec = {
  name: 'fill',
  summary: 'fill <x,y> c=<colour> [mode=contiguous|global] [conn=4|8]',
  normalise(cmd, ctx) {
    const doc = needDoc(cmd, ctx);
    const a = new Args(cmd, ['c', 'mode', 'conn']);
    const cell = a.cellOrigin(doc);
    const p = a.take('point', 'a start point x,y');
    a.done();
    const x = p.x + cell.dx;
    const y = p.y + cell.dy;
    if (!doc.wrap && (x < 0 || y < 0 || x >= doc.width || y >= doc.height)) throw new DiagError(p.line, p.col, `fill: ${p.x},${p.y} is outside the ${doc.width}x${doc.height} canvas`);
    const c = colourOpt(a, doc);
    const mode = a.choice('mode', ['contiguous', 'global'], 'contiguous');
    const conn = a.choice('conn', ['4', '8'], '4');
    return {
      text: `fill${cell.text} ${p.x},${p.y} c=${c.name} mode=${mode} conn=${conn}`,
      op: { k: 'fill', x, y, c: c.index, global: mode === 'global', conn: conn === '8' ? 8 : 4 },
    };
  },
};

const paintCmd: CommandSpec = {
  name: 'paint',
  summary: "paint <x,y> << rows of palette keys ('.' leaves a pixel, ' ' clears it) >>",
  normalise(cmd, ctx) {
    const doc = needDoc(cmd, ctx);
    const a = new Args(cmd, []);
    const cell = a.cellOrigin(doc);
    const p = a.take('point', 'a top-left corner x,y');
    const block = a.take('block', `a block: '<<' at the end of the line, rows, then '>>'`);
    a.done();
    const keyIndex = new Map(doc.palette.entries.map((e, i) => [e.key, i]));
    const rows = block.rows.map((r: BlockRow) =>
      [...r.text].map((ch, i) => {
        if (ch === '.') return null;
        if (ch === ' ') return TRANSPARENT;
        const idx = keyIndex.get(ch);
        if (idx === undefined) throw new DiagError(r.line, r.col + i, `paint: '${ch}' is not a key in palette '${doc.palette.name}'`);
        return idx;
      }),
    );
    return { text: `paint${cell.text} ${p.x},${p.y} <<\n${blockText(block.rows.map((r) => r.text))}>>`, op: { k: 'paint', x: p.x + cell.dx, y: p.y + cell.dy, rows } };
  },
};

/** Canonical block rows: two-space indent, or '|' margins when spaces at a row's ends would be ambiguous. */
function blockText(rows: string[]): string {
  const margins = rows.some((r) => r.startsWith(' ') || r.endsWith(' ') || r.trim() === '>>');
  return rows.map((r) => (margins ? `  |${r}|\n` : r === '' ? '\n' : `  ${r}\n`)).join('');
}

const undoCmd: CommandSpec = {
  name: 'undo',
  summary: 'undo [group=<group>]   (default: the latest group still in effect)',
  normalise(cmd, ctx) {
    needDoc(cmd, ctx);
    const a = new Args(cmd, ['group']);
    a.done();
    const g = a.opts.get('group');
    const r = ctx.undoTarget(g?.value ?? null);
    if ('error' in r) throw new DiagError(g?.line ?? cmd.line, g?.vcol ?? cmd.col, r.error);
    return { text: `undo group=${r.group}`, op: { k: 'undo', group: r.group } };
  },
};

function pt(t: Extract<Token, { t: 'point' }>): Pt {
  return [t.x, t.y];
}
function ptText(p: Pt): string {
  return `${p[0]},${p[1]}`;
}

export const COMMANDS = new Map<string, CommandSpec>();
export function registerCommand(spec: CommandSpec): void {
  COMMANDS.set(spec.name, spec);
}
for (const c of [newCmd, pxCmd, lineCmd, rectCmd, ellipseCmd, fillCmd, paintCmd, undoCmd]) registerCommand(c);

export function normaliseCommand(cmd: ParsedCommand, ctx: NormaliseContext): Normalised {
  const spec = COMMANDS.get(cmd.name);
  if (!spec) throw new DiagError(cmd.line, cmd.col, `unknown command '${cmd.name}' (commands: ${[...COMMANDS.keys()].join(', ')})`);
  return spec.normalise(cmd, ctx);
}

function target(doc: Doc): Target {
  return { width: doc.width, height: doc.height, wrap: doc.wrap, pixels: activeCel(doc) };
}

/** Apply a drawing operation. 'new' returns a fresh document; 'undo' is handled by the engine. */
export function applyOp(doc: Doc | null, op: Op): Doc {
  if (op.k === 'new') return createDoc(op);
  if (!doc) throw new Error('applyOp: no document');
  const t = target(doc);
  switch (op.k) {
    case 'pixels':
      for (const [x, y] of op.pts) plot(t, x, y, op.c);
      break;
    case 'fill':
      fill(t, op.x, op.y, op.c, op.global, op.conn);
      break;
    case 'paint':
      op.rows.forEach((row, j) => row.forEach((c, i) => { if (c !== null) plot(t, op.x + i, op.y + j, c); }));
      break;
    case 'undo':
      throw new Error('applyOp: undo is applied by replay');
  }
  return doc;
}
