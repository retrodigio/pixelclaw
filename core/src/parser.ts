// The command language parser. Text becomes a list of commands, each a name and typed tokens with
// 1-based line and column positions, so every later error can point at the exact place.
//
//   - One command per line, or several separated by ';'.
//   - '#' starts a comment at the start of a line or after whitespace (so c=#aabbcc is a colour).
//   - Tokens: words, points (x,y), sizes (WxH), integers, key=value options, "strings",
//     @cell(cx,cy) cell addressing, and '<<' which opens a block of raw rows closed by '>>'.

export interface Diag {
  line: number;
  col: number;
  message: string;
}

export class DiagError extends Error {
  readonly line: number;
  readonly col: number;
  constructor(line: number, col: number, message: string) {
    super(message);
    this.line = line;
    this.col = col;
  }
}

interface Pos {
  line: number;
  col: number;
}

export type Token =
  | (Pos & { t: 'word'; v: string })
  | (Pos & { t: 'int'; v: number })
  | (Pos & { t: 'point'; x: number; y: number })
  | (Pos & { t: 'size'; w: number; h: number })
  | (Pos & { t: 'cell'; cx: number; cy: number })
  | (Pos & { t: 'string'; v: string })
  | (Pos & { t: 'kv'; key: string; value: string; quoted: boolean; vcol: number })
  | (Pos & { t: 'block'; rows: BlockRow[] });

export interface BlockRow {
  text: string;
  line: number;
  /** Column of text[0] in the source. */
  col: number;
}

export interface ParsedCommand extends Pos {
  name: string;
  args: Token[];
}

export interface ParseResult {
  commands: ParsedCommand[];
  errors: Diag[];
}

const INT_RE = /^-?\d+$/;
const POINT_RE = /^(-?\d+),(-?\d+)$/;
const SIZE_RE = /^(\d+)x(\d+)$/;
const CELL_RE = /^@cell\((\d+),(\d+)\)$/;
const KV_RE = /^([A-Za-z_][A-Za-z0-9_-]*)=/;
const NAME_RE = /^[a-z][a-z0-9_-]*$/;
const MAX_INT = 1 << 20;

function classify(raw: string, line: number, col: number, quotedValue: string | null): Token {
  let m: RegExpExecArray | null;
  const num = (s: string, c: number): number => {
    const n = Number(s);
    if (Math.abs(n) > MAX_INT) throw new DiagError(line, c, `number ${s} is out of range`);
    return n;
  };
  if ((m = KV_RE.exec(raw))) {
    const key = m[1]!;
    const vcol = col + key.length + 1;
    if (quotedValue !== null) return { t: 'kv', key, value: quotedValue, quoted: true, vcol, line, col };
    return { t: 'kv', key, value: raw.slice(key.length + 1), quoted: false, vcol, line, col };
  }
  if (quotedValue !== null) {
    if (raw.startsWith('"')) return { t: 'string', v: quotedValue, line, col };
    throw new DiagError(line, col, `unexpected quote in '${raw}'`);
  }
  if (INT_RE.test(raw)) return { t: 'int', v: num(raw, col), line, col };
  if ((m = POINT_RE.exec(raw))) return { t: 'point', x: num(m[1]!, col), y: num(m[2]!, col), line, col };
  if ((m = SIZE_RE.exec(raw))) return { t: 'size', w: num(m[1]!, col), h: num(m[2]!, col), line, col };
  if ((m = CELL_RE.exec(raw))) return { t: 'cell', cx: num(m[1]!, col), cy: num(m[2]!, col), line, col };
  return { t: 'word', v: raw, line, col };
}

/** Dedent paint-block rows. With '|' margins on every row, the text between them is taken verbatim. */
function dedentBlock(rows: BlockRow[]): BlockRow[] {
  const nonEmpty = rows.filter((r) => r.text.trim() !== '');
  if (nonEmpty.length > 0 && nonEmpty.every((r) => r.text.trimStart().startsWith('|'))) {
    return rows.map((r) => {
      if (r.text.trim() === '') return { ...r, text: '' };
      const start = r.text.indexOf('|') + 1;
      let body = r.text.slice(start);
      const end = body.lastIndexOf('|');
      if (end >= 0 && body.slice(end + 1).trim() === '') body = body.slice(0, end);
      return { text: body, line: r.line, col: r.col + start };
    });
  }
  let indent = Infinity;
  for (const r of nonEmpty) indent = Math.min(indent, r.text.length - r.text.trimStart().length);
  if (!Number.isFinite(indent)) indent = 0;
  return rows.map((r) => (r.text.trim() === '' ? { ...r, text: '' } : { text: r.text.slice(indent), line: r.line, col: r.col + indent }));
}

export function parse(text: string): ParseResult {
  const lines = text.split(/\r?\n/);
  const commands: ParsedCommand[] = [];
  const errors: Diag[] = [];
  let cur: Token[] = [];

  const finish = (): void => {
    if (cur.length === 0) return;
    const head = cur[0]!;
    if (head.t !== 'word' || !NAME_RE.test(head.v)) {
      errors.push({ line: head.line, col: head.col, message: `expected a command name` });
    } else {
      commands.push({ name: head.v, line: head.line, col: head.col, args: cur.slice(1) });
    }
    cur = [];
  };

  for (let li = 0; li < lines.length; li++) {
    const src = lines[li]!;
    const line = li + 1;
    let i = 0;
    let lineFailed = false;
    while (i < src.length) {
      const ch = src[i]!;
      if (ch === ' ' || ch === '\t') { i++; continue; }
      if (ch === '#') break;
      if (ch === ';') { finish(); i++; continue; }
      const start = i;
      let quoted: string | null = null;
      try {
        while (i < src.length && src[i] !== ' ' && src[i] !== '\t' && src[i] !== ';') {
          if (src[i] === '"') {
            if (quoted !== null) throw new DiagError(line, i + 1, `a token may hold only one quoted string`);
            let j = i + 1;
            let s = '';
            while (j < src.length && src[j] !== '"') {
              if (src[j] === '\\' && j + 1 < src.length) { s += src[j + 1]; j += 2; } else { s += src[j]; j++; }
            }
            if (j >= src.length) throw new DiagError(line, i + 1, `unterminated string`);
            quoted = s;
            i = j + 1;
          } else i++;
        }
        const raw = src.slice(start, i);
        if (raw === '<<') {
          // A block: rows until a line that is just '>>'. Nothing but a comment may follow '<<'.
          const rest = src.slice(i).trim();
          if (rest !== '' && !rest.startsWith('#')) throw new DiagError(line, i + 2, `'<<' must end the line; the block starts on the next line`);
          const rows: BlockRow[] = [];
          let lj = li + 1;
          while (lj < lines.length && lines[lj]!.trim() !== '>>') {
            rows.push({ text: lines[lj]!, line: lj + 1, col: 1 });
            lj++;
          }
          if (lj >= lines.length) throw new DiagError(line, start + 1, `block opened here is never closed with '>>'`);
          cur.push({ t: 'block', rows: dedentBlock(rows), line, col: start + 1 });
          li = lj; // continue after the '>>' line
          i = src.length;
          break;
        }
        cur.push(classify(raw, line, start + 1, quoted));
      } catch (e) {
        if (!(e instanceof DiagError)) throw e;
        errors.push({ line: e.line, col: e.col, message: e.message });
        // Drop the rest of this command so one mistake gives one error.
        cur = [];
        lineFailed = true;
        if (e.message.startsWith('block opened')) li = lines.length;
        break;
      }
    }
    if (!lineFailed) finish();
  }
  finish();
  return { commands, errors };
}

/** Quote a string token for normalised output. */
export function quote(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}
