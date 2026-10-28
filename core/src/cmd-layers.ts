// Layers and frames (plan §3.2). Layers are listed bottom to top; each author draws on their own
// layer and frame (`layer <name>`, `frame <n>`), so one author's choice never moves another's.
// Frames are numbered from 1 in the language. Durations, tags and linked cels come with G6.

import { Args, fn, needDoc, registerCommand, type CommandSpec } from './commands.ts';
import { TRANSPARENT, ctxOf, newLayer, remapCtx, setCtx, type Doc } from './doc.ts';
import { DiagError, type ParsedCommand, type Token } from './parser.ts';

const LAYER_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const LAYER_WORDS = new Set(['add', 'set', 'remove', 'rename', 'move', 'merge']);
const onOff = (b: boolean) => (b ? 'on' : 'off');

function layerIndex(doc: Doc, tok: Extract<Token, { t: 'word' }>): number {
  const i = doc.layers.findIndex((l) => l.name === tok.v);
  if (i < 0) throw new DiagError(tok.line, tok.col, `no layer '${tok.v}' (layers: ${doc.layers.map((l) => l.name).join(', ')})`);
  return i;
}

function checkNewName(doc: Doc, tok: Extract<Token, { t: 'word' }>): void {
  if (!LAYER_RE.test(tok.v) || LAYER_WORDS.has(tok.v)) throw new DiagError(tok.line, tok.col, `'${tok.v}' is not a usable layer name`);
  if (doc.layers.some((l) => l.name === tok.v)) throw new DiagError(tok.line, tok.col, `there is already a layer '${tok.v}'`);
}

/** Reorder layers: `order[k]` is the old index of the layer now at k. Authors keep their layer. */
function reorder(d: Doc, order: number[]): void {
  const where = new Map(order.map((old, k) => [old, k]));
  d.layers = order.map((i) => d.layers[i]!);
  d.cels = order.map((i) => d.cels[i]!);
  remapCtx(d, (i) => where.get(i) ?? 0, (f) => f);
}

/** Where a layer goes: above=<layer> or below=<layer>, as an index in the list with that layer still in it. */
function placement(a: Args, doc: Doc, dflt: string): { at: number; text: string } {
  const above = a.opts.get('above');
  const below = a.opts.get('below');
  if (above && below) throw new DiagError(below.line, below.col, `give above= or below=, not both`);
  const o = above ?? below;
  const name = o?.value ?? dflt;
  const i = doc.layers.findIndex((l) => l.name === name);
  if (i < 0) throw new DiagError(o?.line ?? a.cmd.line, o?.vcol ?? a.cmd.col, `no layer '${name}'`);
  return below ? { at: i, text: `below=${name}` } : { at: i + 1, text: `above=${name}` };
}

function flagOpts(a: Args): { hidden?: boolean; locked?: boolean; reference?: boolean } {
  const out: { hidden?: boolean; locked?: boolean; reference?: boolean } = {};
  for (const k of ['hidden', 'locked', 'reference'] as const) {
    if (a.opts.has(k)) out[k] = a.choice(k, ['on', 'off'], 'off') === 'on';
  }
  return out;
}

const layerCmd: CommandSpec = {
  name: 'layer',
  summary: 'layer <name> | layer add <name> [above=|below=<layer>] [reference] | layer set <name> [hidden=] [locked=] [reference=] | layer rename <name> <new> | layer move <name> above=|below=<layer> | layer merge <name> | layer remove <name>',
  normalise(cmd, ctx) {
    const doc = needDoc(cmd, ctx);
    const a = new Args(cmd, ['above', 'below', 'hidden', 'locked', 'reference'], ['reference']);
    const how = a.take('word', 'a layer name, or add, set, rename, move, merge or remove');
    const noOpts = (except: string[] = []) => {
      for (const o of a.opts.values()) if (!except.includes(o.key)) throw new DiagError(o.line, o.col, `layer ${how.v} takes no ${o.key}=`);
      if (!except.includes('flag') && a.flags.length) throw new DiagError(a.flags[0]!.line, a.flags[0]!.col, `layer ${how.v}: unexpected '${a.flags[0]!.v}'`);
    };
    if (!LAYER_WORDS.has(how.v)) {
      // Choose the layer this author draws on.
      a.done();
      noOpts();
      const i = layerIndex(doc, how);
      return { text: `layer ${how.v}`, op: fn((d, by) => setCtx(d, by, { layer: i })) };
    }
    if (how.v === 'add') {
      const name = a.take('word', 'a name for the new layer');
      a.done();
      noOpts(['above', 'below', 'flag']);
      checkNewName(doc, name);
      const where = placement(a, doc, doc.layers[ctxOf(doc, ctx.by).layer]!.name);
      const ref = a.flags.length > 0;
      return {
        text: `layer add ${name.v} ${where.text}${ref ? ' reference' : ''}`,
        op: fn((d) => {
          const n = d.width * d.height;
          const order = d.layers.map((_, i) => i);
          d.layers.push(newLayer(name.v, { reference: ref }));
          d.cels.push(Array.from({ length: d.frameCount }, () => new Uint16Array(n).fill(TRANSPARENT)));
          order.splice(where.at, 0, d.layers.length - 1);
          reorder(d, order);
        }),
      };
    }
    const target = a.take('word', 'a layer name');
    const i = layerIndex(doc, target);
    if (how.v === 'set') {
      a.done();
      noOpts(['hidden', 'locked', 'reference']);
      const f = flagOpts(a);
      if (!Object.keys(f).length) throw new DiagError(cmd.line, cmd.col, `layer set: give hidden=, locked= or reference= (on or off)`);
      const parts = (['hidden', 'locked', 'reference'] as const).flatMap((k) => (f[k] === undefined ? [] : [`${k}=${onOff(f[k]!)}`]));
      return { text: `layer set ${target.v} ${parts.join(' ')}`, op: fn((d) => { Object.assign(d.layers[i]!, f); }) };
    }
    if (how.v === 'rename') {
      const to = a.take('word', 'the new name');
      a.done();
      noOpts();
      checkNewName(doc, to);
      return {
        text: `layer rename ${target.v} ${to.v}`,
        op: fn((d) => { d.layers[i]!.name = to.v; }),
      };
    }
    if (how.v === 'move') {
      a.done();
      noOpts(['above', 'below']);
      if (!a.opts.has('above') && !a.opts.has('below')) throw new DiagError(cmd.line, cmd.col, `layer move: give above=<layer> or below=<layer>`);
      const where = placement(a, doc, '');
      const other = (a.opts.get('above') ?? a.opts.get('below'))!;
      if (other.value === target.v) throw new DiagError(other.line, other.vcol, `layer move: a layer cannot move relative to itself`);
      return {
        text: `layer move ${target.v} ${where.text}`,
        op: fn((d) => {
          const order = d.layers.map((_, k) => k);
          order.splice(where.at, 0, i);
          order.splice(where.at <= i ? i + 1 : i, 1);
          reorder(d, order);
        }),
      };
    }
    if (how.v === 'merge') {
      a.done();
      noOpts();
      if (i === 0) throw new DiagError(target.line, target.col, `layer merge: '${target.v}' is the bottom layer; there is nothing below to merge into`);
      const below = doc.layers[i - 1]!;
      if (below.locked) throw new DiagError(target.line, target.col, `layer merge: '${below.name}' below is locked`);
      return {
        text: `layer merge ${target.v}`,
        op: fn((d) => {
          for (let f = 0; f < d.frameCount; f++) {
            const top = d.cels[i]![f]!;
            const dst = d.cels[i - 1]![f]!;
            for (let k = 0; k < top.length; k++) if (top[k] !== TRANSPARENT) dst[k] = top[k]!;
          }
          removeLayer(d, i);
        }),
      };
    }
    // remove
    a.done();
    noOpts();
    if (doc.layers.length === 1) throw new DiagError(target.line, target.col, `layer remove: '${target.v}' is the only layer`);
    return { text: `layer remove ${target.v}`, op: fn((d) => removeLayer(d, i)) };
  },
};

/** Drop a layer; authors on it move to the layer below (or the new bottom one). */
function removeLayer(d: Doc, i: number): void {
  d.layers.splice(i, 1);
  d.cels.splice(i, 1);
  remapCtx(d, (l) => (l > i ? l - 1 : l === i ? Math.max(0, i - 1) : l), (f) => f);
}

const FRAME_WORDS = new Set(['add', 'remove', 'move']);

function frameNumber(doc: Doc, t: Token | undefined, cmd: ParsedCommand, what: string, max = doc.frameCount): number {
  if (!t || t.t !== 'int') throw new DiagError(t?.line ?? cmd.line, t?.col ?? cmd.col, `frame: expected ${what}`);
  if (t.v < 1 || t.v > max) throw new DiagError(t.line, t.col, `frame ${t.v} does not exist (frames 1..${doc.frameCount})`);
  return t.v;
}

const frameCmd: CommandSpec = {
  name: 'frame',
  summary: 'frame <n> | frame add [<n>] [copy=<m>|empty] | frame remove <n> | frame move <n> to=<m>   (frames count from 1)',
  normalise(cmd, ctx) {
    const doc = needDoc(cmd, ctx);
    const a = new Args(cmd, ['copy', 'to'], ['empty']);
    const first = a.peek();
    if (first?.t === 'int') {
      const n = frameNumber(doc, a.take('int', 'a frame number'), cmd, 'a frame number');
      a.done();
      for (const o of a.opts.values()) throw new DiagError(o.line, o.col, `frame <n> takes no ${o.key}=`);
      return { text: `frame ${n}`, op: fn((d, by) => setCtx(d, by, { frame: n - 1 })) };
    }
    const how = a.take('word', 'a frame number, or add, remove or move');
    if (!FRAME_WORDS.has(how.v)) throw new DiagError(how.line, how.col, `frame: expected a frame number, add, remove or move`);
    if (how.v === 'add') {
      const pos = a.peek()?.t === 'int' ? frameNumber(doc, a.take('int', 'a position'), cmd, 'a position', doc.frameCount + 1) : doc.frameCount + 1;
      a.done();
      const copyOpt = a.opts.get('copy');
      const empty = a.flags.length > 0;
      if (copyOpt && empty) throw new DiagError(copyOpt.line, copyOpt.col, `frame add: give copy= or empty, not both`);
      const toOpt = a.opts.get('to');
      if (toOpt) throw new DiagError(toOpt.line, toOpt.col, `frame add takes no to=`);
      let copy = ctxOf(doc, ctx.by).frame + 1;
      if (copyOpt) {
        if (!/^\d+$/.test(copyOpt.value) || Number(copyOpt.value) < 1 || Number(copyOpt.value) > doc.frameCount) {
          throw new DiagError(copyOpt.line, copyOpt.vcol, `copy= must be a frame 1..${doc.frameCount}`);
        }
        copy = Number(copyOpt.value);
      }
      return {
        text: `frame add ${pos} ${empty ? 'empty' : `copy=${copy}`}`,
        op: fn((d) => {
          const n = d.width * d.height;
          for (const fr of d.cels) fr.splice(pos - 1, 0, empty ? new Uint16Array(n).fill(TRANSPARENT) : fr[copy - 1]!.slice());
          d.frameCount++;
          // Authors keep the frame they were on.
          remapCtx(d, (l) => l, (f) => (f >= pos - 1 ? f + 1 : f));
        }),
      };
    }
    const n = frameNumber(doc, a.take('int', 'a frame number'), cmd, 'a frame number');
    if (how.v === 'remove') {
      a.done();
      for (const o of a.opts.values()) throw new DiagError(o.line, o.col, `frame remove takes no ${o.key}=`);
      if (doc.frameCount === 1) throw new DiagError(cmd.line, cmd.col, `frame remove: frame 1 is the only frame`);
      return {
        text: `frame remove ${n}`,
        op: fn((d) => {
          for (const fr of d.cels) fr.splice(n - 1, 1);
          d.frameCount--;
          remapCtx(d, (l) => l, (f) => (f > n - 1 ? f - 1 : Math.min(f, d.frameCount - 1)));
        }),
      };
    }
    a.done();
    const toOpt = a.opts.get('to');
    if (!toOpt) throw new DiagError(cmd.line, cmd.col, `frame move: missing to=<n>`);
    if (!/^\d+$/.test(toOpt.value) || Number(toOpt.value) < 1 || Number(toOpt.value) > doc.frameCount) throw new DiagError(toOpt.line, toOpt.vcol, `to= must be a frame 1..${doc.frameCount}`);
    const to = Number(toOpt.value);
    return {
      text: `frame move ${n} to=${to}`,
      op: fn((d) => {
        for (const fr of d.cels) { const [c] = fr.splice(n - 1, 1); fr.splice(to - 1, 0, c!); }
        const map = (f: number) => (f === n - 1 ? to - 1 : n - 1 < f && f <= to - 1 ? f - 1 : to - 1 <= f && f < n - 1 ? f + 1 : f);
        remapCtx(d, (l) => l, map);
      }),
    };
  },
};

registerCommand(layerCmd);
registerCommand(frameCmd);
