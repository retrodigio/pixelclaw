// Small macros (plan §3.3): `def tuft(x,y) { px $x,$y $x+1,$y-1 c=moss2 ; px $x+2,$y c=moss1 }`
// keeps a body of commands in the document; `call tuft 5,18` runs it with x=5, y=18. In a body,
// `$x` is a parameter, `$x+1` (and -, *, / chained left to right) is arithmetic on it, and `$(...)`
// is any integer expression of the parameters. A call is one line on the tape; replay expands it
// again. Generators in a body without seed= take seeds from the call's seed=, written into the line.

import { Args, applyOp, needDoc, normaliseCommand, registerCommand, tokenText, COMMANDS, type CommandSpec, type NormaliseContext, type Op } from './commands.ts';
import { cloneDoc, type Macro } from './doc.ts';
import { DiagError, parse, type Token } from './parser.ts';
import { Pcg32, seedFrom } from './pcg.ts';
import { intOpt } from './values.ts';

const NAME_RE = /^[a-z][a-z0-9_]*$/;
const NOT_IN_MACROS = new Set(['new', 'fork', 'undo', 'redo', 'note', 'def']);
const MAX_DEPTH = 8;

/** The body as written in the normal form: shared indent and blank edge lines removed. */
function canonicalBody(text: string): string {
  const lines = text.split('\n').map((l) => l.replace(/\s+$/, ''));
  while (lines.length && lines[0]!.trim() === '') lines.shift();
  while (lines.length && lines.at(-1)!.trim() === '') lines.pop();
  let indent = Infinity;
  for (const l of lines) if (l.trim()) indent = Math.min(indent, l.length - l.trimStart().length);
  return lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join('\n');
}

function bodyText(body: string): string {
  return body.includes('\n') ? `{\n${body.split('\n').map((l) => (l ? `  ${l}` : '')).join('\n')}\n}` : `{ ${body} }`;
}

/** Evaluate an integer expression of the parameters: + - * / (floor) and parentheses. */
function evalExpr(src: string, vars: Map<string, string>): number {
  let i = 0;
  const ws = () => { while (src[i] === ' ') i++; };
  const atom = (): number => {
    ws();
    if (src[i] === '(') { i++; const v = sum(); ws(); if (src[i] !== ')') throw new Error(`expected ')'`); i++; return v; }
    if (src[i] === '-') { i++; return -atom(); }
    const m = /^(\d+|[a-z_][a-z0-9_]*)/.exec(src.slice(i));
    if (!m) throw new Error(`expected a number or a parameter`);
    i += m[1]!.length;
    if (/^\d/.test(m[1]!)) return Number(m[1]);
    const v = vars.get(m[1]!);
    if (v === undefined) throw new Error(`unknown parameter '${m[1]}'`);
    if (!/^-?\d+$/.test(v)) throw new Error(`parameter '${m[1]}' is '${v}', not a number`);
    return Number(v);
  };
  const prod = (): number => {
    let v = atom();
    for (;;) {
      ws();
      const op = src[i];
      if (op !== '*' && op !== '/') return v;
      i++;
      const r = atom();
      if (op === '/' && r === 0) throw new Error('division by zero');
      v = op === '*' ? v * r : Math.floor(v / r);
    }
  };
  const sum = (): number => {
    let v = prod();
    for (;;) {
      ws();
      const op = src[i];
      if (op !== '+' && op !== '-') return v;
      i++;
      v = op === '+' ? v + prod() : v - prod();
    }
  };
  const v = sum();
  ws();
  if (i < src.length) throw new Error(`unexpected '${src[i]}'`);
  return v;
}

/** The body with its parameters filled in. */
export function expandMacro(m: Macro, values: string[]): string {
  const vars = new Map(m.params.map((p, i) => [p, values[i]!]));
  return m.body.replace(/\$\(([^()]*(?:\([^()]*\)[^()]*)*)\)|\$([a-z_][a-z0-9_]*)((?:[+\-*/]\d+)*)/g, (_all, expr: string | undefined, name: string | undefined, chain: string) => {
    if (expr !== undefined) return String(evalExpr(expr, vars));
    const v = vars.get(name!);
    if (v === undefined) throw new Error(`unknown parameter '$${name}'`);
    if (!chain) return v;
    let n = evalExpr(name!, vars);
    for (const [, op, k] of chain.matchAll(/([+\-*/])(\d+)/g)) {
      const r = Number(k);
      if (op === '/' && r === 0) throw new Error('division by zero');
      n = op === '+' ? n + r : op === '-' ? n - r : op === '*' ? n * r : Math.floor(n / r);
    }
    return String(n);
  });
}

const defCmd: CommandSpec = {
  name: 'def',
  summary: 'def <name>(<param>,...) { <commands> }   (a macro: $param in the body, $x+1 or $(x*2+y) for arithmetic)',
  normalise(cmd, ctx) {
    needDoc(cmd, ctx);
    const bodyTok = cmd.args.find((t): t is Extract<Token, { t: 'body' }> => t.t === 'body');
    if (!bodyTok) throw new DiagError(cmd.line, cmd.col, `def: expected a body in braces: def name(a,b) { ... }`);
    const head = cmd.args.slice(0, cmd.args.indexOf(bodyTok));
    const after = cmd.args.slice(cmd.args.indexOf(bodyTok) + 1);
    if (after.length) throw new DiagError(after[0]!.line, after[0]!.col, `def: unexpected '${tokenText(after[0]!)}' after the body`);
    const sig = head.map(tokenText).join('');
    const m = /^([a-z][a-z0-9_]*)\(([a-z0-9_,]*)\)$/.exec(sig);
    if (!m) throw new DiagError(head[0]?.line ?? cmd.line, head[0]?.col ?? cmd.col, `def: expected name(param,...) before the body, like tuft(x,y)`);
    const name = m[1]!;
    if (COMMANDS.has(name)) throw new DiagError(head[0]!.line, head[0]!.col, `def: '${name}' is a command name`);
    const params = m[2] ? m[2].split(',') : [];
    if (params.some((p) => !NAME_RE.test(p))) throw new DiagError(head[0]!.line, head[0]!.col, `def: parameters are names like x, y, c`);
    if (new Set(params).size !== params.length) throw new DiagError(head[0]!.line, head[0]!.col, `def: a parameter is named twice`);
    const body = canonicalBody(bodyTok.text);
    if (!body.trim()) throw new DiagError(bodyTok.line, bodyTok.col, `def: the body is empty`);
    // Check the body now: it must parse with numbers for its parameters, and use only allowed commands.
    let expanded: string;
    try {
      expanded = expandMacro({ params, body }, params.map(() => '0'));
    } catch (e) {
      throw new DiagError(bodyTok.line, bodyTok.col, `def ${name}: ${(e as Error).message}`);
    }
    const p = parse(expanded);
    if (p.errors.length) throw new DiagError(bodyTok.line, bodyTok.col, `def ${name}: body line ${p.errors[0]!.line}: ${p.errors[0]!.message}`);
    for (const c of p.commands) {
      if (NOT_IN_MACROS.has(c.name)) throw new DiagError(bodyTok.line, bodyTok.col, `def ${name}: '${c.name}' cannot be used in a macro`);
      if (!COMMANDS.has(c.name)) throw new DiagError(bodyTok.line, bodyTok.col, `def ${name}: unknown command '${c.name}' in the body`);
    }
    return {
      text: `def ${name}(${params.join(',')}) ${bodyText(body)}`,
      op: { k: 'fn', run: (d) => { d.macros = { ...d.macros, [name]: { params, body } }; } },
    };
  },
};

const callCmd: CommandSpec = {
  name: 'call',
  summary: 'call <name> <args...> [seed=<n>]   (runs a macro; a point x,y fills two parameters)',
  normalise(cmd, ctx) {
    const doc = needDoc(cmd, ctx);
    const a = new Args(cmd, ['seed']);
    const nameTok = a.take('word', 'a macro name');
    const mac = doc.macros[nameTok.v];
    if (!mac) {
      const names = Object.keys(doc.macros);
      throw new DiagError(nameTok.line, nameTok.col, `no macro '${nameTok.v}' (${names.length ? `macros: ${names.join(', ')}` : 'define one with def'})`);
    }
    const values: string[] = [];
    const shown: string[] = [];
    for (const t of a.rest()) {
      if (t.t === 'point') values.push(String(t.x), String(t.y));
      else if (t.t === 'int') values.push(String(t.v));
      else if (t.t === 'word') values.push(t.v);
      else throw new DiagError(t.line, t.col, `call: arguments are numbers, points x,y or words`);
      shown.push(tokenText(t));
    }
    if (values.length !== mac.params.length) {
      throw new DiagError(nameTok.line, nameTok.col, `call ${nameTok.v}: takes ${mac.params.length} value(s) (${mac.params.join(', ')}), got ${values.length}`);
    }
    const depth = (ctx.depth ?? 0) + 1;
    if (depth > MAX_DEPTH) throw new DiagError(cmd.line, cmd.col, `call ${nameTok.v}: macros call each other more than ${MAX_DEPTH} deep`);
    const so = a.opts.get('seed');
    let callSeed: number | null = so ? intOpt(so, 0, 0x7fffffff) : null;
    let seeds = 0;
    let text: string;
    try {
      text = expandMacro(mac, values);
    } catch (e) {
      throw new DiagError(cmd.line, cmd.col, `call ${nameTok.v}: ${(e as Error).message}`);
    }
    const parsed = parse(text);
    if (parsed.errors.length) throw new DiagError(cmd.line, cmd.col, `call ${nameTok.v}: body line ${parsed.errors[0]!.line}: ${parsed.errors[0]!.message}`);
    let scratch = cloneDoc(doc);
    const ops: Op[] = [];
    for (const c of parsed.commands) {
      if (NOT_IN_MACROS.has(c.name)) throw new DiagError(cmd.line, cmd.col, `call ${nameTok.v}: '${c.name}' cannot be used in a macro`);
      const sub: NormaliseContext = {
        ...ctx,
        doc: scratch,
        depth,
        newSeed: () => {
          if (callSeed === null) callSeed = ctx.newSeed();
          return seedFrom(new Pcg32(callSeed, 1000 + seeds++));
        },
        undoTarget: () => ({ error: 'not in a macro' }),
        redoTarget: () => ({ error: 'not in a macro' }),
      };
      try {
        const n = normaliseCommand(c, sub);
        scratch = applyOp(scratch, n.op, ctx.by);
        ops.push(n.op);
      } catch (e) {
        if (!(e instanceof DiagError)) throw e;
        throw new DiagError(cmd.line, cmd.col, `call ${nameTok.v}: body line ${e.line}: ${e.message}`);
      }
    }
    const seedText = callSeed !== null && (so || seeds > 0) ? ` seed=${callSeed}` : '';
    return {
      text: `call ${nameTok.v}${shown.length ? ' ' + shown.join(' ') : ''}${seedText}`,
      op: { k: 'fn', run: (d, by) => { for (const o of ops) applyOp(d, o, by); } },
    };
  },
};

registerCommand(defCmd);
registerCommand(callCmd);
