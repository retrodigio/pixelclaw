// Layers and frames (plan §3.2). Layers are listed bottom to top; each author draws on their own
// layer and frame (`layer <name>`, `frame <n>`), so one author's choice never moves another's.
// Frames are numbered from 1 in the language; each has a duration in ticks (`frame set`), and
// tags and views (cmd-anim.ts) follow frames as they are added, removed and moved.

import { insertFrames, moveFrame, moveMap, removeFrame, viewOf } from './anim.ts';
import { Args, fn, needDoc, registerCommand, type CommandSpec } from './commands.ts';
import { TRANSPARENT, ctxOf, newLayer, remapCtx, setCtx, type Doc, type MapLayerInfo } from './doc.ts';
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
  summary: 'layer <name> | layer add <name> [above=|below=<layer>] [reference] | (maps) layer add <name> terrain=<family> [outside=on|off] | tiles | objects | overlay=<overlay> on=<layer>|<layer>:out|all | layer set <name> [hidden=] [locked=] [reference=] | layer rename <name> <new> | layer move <name> above=|below=<layer> | layer merge <name> | layer remove <name>',
  normalise(cmd, ctx) {
    const doc = needDoc(cmd, ctx);
    const first = cmd.args[0];
    const mapAdd = !!doc.map && first?.t === 'word' && first.v === 'add';
    const a = new Args(cmd, ['above', 'below', 'hidden', 'locked', 'reference', 'terrain', 'outside', 'overlay', 'on'], mapAdd ? ['reference', 'tiles', 'objects'] : ['reference']);
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
      checkNewName(doc, name);
      if (doc.map && (name.v === 'tiles' || name.v === 'objects')) throw new DiagError(name.line, name.col, `'${name.v}' says what a map layer holds; name the layer something else (layer add props objects)`);
      let info: MapLayerInfo | undefined;
      let what = '';
      if (doc.map) {
        info = mapLayerInfo(a, doc);
        what = mapLayerText(info);
        noOpts(['above', 'below', 'flag', 'terrain', 'outside', 'overlay', 'on']);
      } else {
        noOpts(['above', 'below', 'flag']);
      }
      const where = placement(a, doc, doc.layers[ctxOf(doc, ctx.by).layer]!.name);
      const ref = !doc.map && a.flags.length > 0;
      return {
        text: `layer add ${name.v}${what} ${where.text}${ref ? ' reference' : ''}`,
        op: fn((d) => {
          const n = d.width * d.height;
          const order = d.layers.map((_, i) => i);
          d.layers.push(newLayer(name.v, { reference: ref, ...(info ? { map: info } : {}) }));
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
      if (doc.map) throw new DiagError(how.line, how.col, `layer merge: a map's layers hold different things; move or remove them instead`);
      if (i === 0) throw new DiagError(target.line, target.col, `layer merge: '${target.v}' is the bottom layer; there is nothing below to merge into`);
      const below = doc.layers[i - 1]!;
      if (below.locked) throw new DiagError(target.line, target.col, `layer merge: '${below.name}' below is locked`);
      return {
        text: `layer merge ${target.v}`,
        op: fn((d) => {
          // Linked cels below would take every frame's top layer in turn: the merge unlinks them.
          d.cels[i - 1] = d.cels[i - 1]!.map((c) => c.slice());
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

/** What a new map layer holds: terrain=<family> [outside=on|off], tiles, objects, or overlay=<overlay> on=<where>. */
function mapLayerInfo(a: Args, doc: Doc): MapLayerInfo {
  const ter = a.opts.get('terrain'), ov = a.opts.get('overlay');
  const kinds = [ter ? 'terrain' : '', ov ? 'overlay' : '', ...a.flags.filter((f) => f.v === 'tiles' || f.v === 'objects').map((f) => f.v)].filter(Boolean);
  if (kinds.length !== 1) throw new DiagError(a.cmd.line, a.cmd.col, `layer add: a map layer holds one thing: terrain=<family>, tiles, objects or overlay=<overlay> on=<where>`);
  const ref = a.flags.find((f) => f.v === 'reference');
  if (ref) throw new DiagError(ref.line, ref.col, `layer add: a map has no reference layers`);
  const name = (v: string, o: { line: number; vcol: number }) => {
    if (!/^[a-z][a-z0-9_-]*$/.test(v)) throw new DiagError(o.line, o.vcol, `'${v}' is not an asset name`);
    return v;
  };
  for (const k of ['outside', 'on']) {
    const o = a.opts.get(k);
    if (o && !((k === 'outside' && ter) || (k === 'on' && ov))) throw new DiagError(o.line, o.col, `${k}= goes with ${k === 'outside' ? 'terrain=' : 'overlay='}`);
  }
  if (ter) return { kind: 'terrain', family: name(ter.value, ter), outside: a.choice('outside', ['on', 'off'], 'off') === 'on' };
  if (ov) {
    const on = a.opts.get('on');
    const where = on?.value ?? 'all';
    const [l, out] = where.split(':');
    if (where !== 'all' && (!doc.layers.some((x) => x.name === l && x.map?.kind === 'terrain') || (out !== undefined && out !== 'out'))) {
      throw new DiagError(on!.line, on!.vcol, `on= must be all, a terrain layer, or a terrain layer:out (terrain layers: ${doc.layers.filter((x) => x.map?.kind === 'terrain').map((x) => x.name).join(', ') || 'none'})`);
    }
    return { kind: 'overlay', overlay: name(ov.value, ov), on: where };
  }
  return { kind: kinds[0] as 'tiles' | 'objects' };
}

function mapLayerText(m: MapLayerInfo): string {
  if (m.kind === 'terrain') return ` terrain=${m.family} outside=${m.outside ? 'on' : 'off'}`;
  if (m.kind === 'overlay') return ` overlay=${m.overlay} on=${m.on}`;
  return ` ${m.kind}`;
}

/** Drop a layer; authors on it move to the layer below (or the new bottom one). */
function removeLayer(d: Doc, i: number): void {
  d.layers.splice(i, 1);
  d.cels.splice(i, 1);
  remapCtx(d, (l) => (l > i ? l - 1 : l === i ? Math.max(0, i - 1) : l), (f) => f);
}

const FRAME_WORDS = new Set(['add', 'remove', 'move', 'set']);

function frameNumber(doc: Doc, t: Token | undefined, cmd: ParsedCommand, what: string, max = doc.frameCount): number {
  if (!t || t.t !== 'int') throw new DiagError(t?.line ?? cmd.line, t?.col ?? cmd.col, `frame: expected ${what}`);
  if (t.v < 1 || t.v > max) throw new DiagError(t.line, t.col, `frame ${t.v} does not exist (frames 1..${doc.frameCount})`);
  return t.v;
}

/** A frame number given as an option (copy=, link=, to=): 1..max. */
function frameOpt(doc: Doc, o: Extract<Token, { t: 'kv' }>, max = doc.frameCount): number {
  if (!/^\d+$/.test(o.value) || Number(o.value) < 1 || Number(o.value) > max) throw new DiagError(o.line, o.vcol, `${o.key}= must be a frame 1..${max}`);
  return Number(o.value);
}

/** Frames as `<n>`, `<a>-<b>` or `all`, 1-based and inclusive. */
export function frameRange(doc: Doc, t: Token | undefined, cmd: ParsedCommand): { from: number; to: number; text: string } {
  const bad = () => new DiagError(t?.line ?? cmd.line, t?.col ?? cmd.col, `${cmd.name}: expected frames as <n>, <a>-<b> or all (frames 1..${doc.frameCount})`);
  if (!t) throw bad();
  let from: number;
  let to: number;
  if (t.t === 'int') from = to = t.v;
  else if (t.t === 'word' && t.v === 'all') { from = 1; to = doc.frameCount; }
  else if (t.t === 'word' && /^\d+-\d+$/.test(t.v)) [from, to] = t.v.split('-').map(Number) as [number, number];
  else throw bad();
  if (from < 1 || to > doc.frameCount || from > to) throw new DiagError(t.line, t.col, `${cmd.name}: frames ${from}-${to} are not within 1..${doc.frameCount}`);
  return { from, to, text: from === to ? String(from) : `${from}-${to}` };
}

/** Ticks as an option: a whole number 1..65535. */
export function ticksOpt(o: Extract<Token, { t: 'kv' }>): number {
  if (!/^\d+$/.test(o.value) || Number(o.value) < 1 || Number(o.value) > 65535) throw new DiagError(o.line, o.vcol, `ticks= must be a whole number 1..65535`);
  return Number(o.value);
}

/** Refuse a change to a mirror view's own frames: they follow their source. */
function notMirror(doc: Doc, f: number, t: { line: number; col: number }, what: string): void {
  const v = viewOf(doc, f);
  if (v?.mirror) throw new DiagError(t.line, t.col, `${what}: frame ${f + 1} is in view ${v.name}, a live mirror of ${v.mirror} (change ${v.mirror}, or view ${v.name} mirror=off)`);
}

const frameCmd: CommandSpec = {
  name: 'frame',
  summary: 'frame <n> | frame add [<n>] [copy=<m>|link=<m>|empty] [ticks=<t>] | frame set <n>|<a>-<b>|all ticks=<t> | frame remove <n> | frame move <n> to=<m>   (frames count from 1; ticks are game ticks)',
  normalise(cmd, ctx) {
    const doc = needDoc(cmd, ctx);
    const a = new Args(cmd, ['copy', 'to', 'link', 'ticks'], ['empty']);
    const first = a.peek();
    const noOpts = (what: string, except: string[] = []) => {
      for (const o of a.opts.values()) if (!except.includes(o.key)) throw new DiagError(o.line, o.col, `${what} takes no ${o.key}=`);
    };
    if (first?.t === 'int') {
      const n = frameNumber(doc, a.take('int', 'a frame number'), cmd, 'a frame number');
      a.done();
      noOpts('frame <n>');
      return { text: `frame ${n}`, op: fn((d, by) => setCtx(d, by, { frame: n - 1 })) };
    }
    const how = a.take('word', 'a frame number, or add, set, remove or move');
    if (!FRAME_WORDS.has(how.v)) throw new DiagError(how.line, how.col, `frame: expected a frame number, add, set, remove or move`);
    if (how.v === 'set') {
      const r = frameRange(doc, a.rest()[0], cmd);
      noOpts('frame set', ['ticks']);
      if (a.flags.length) throw new DiagError(a.flags[0]!.line, a.flags[0]!.col, `frame set: unexpected '${a.flags[0]!.v}'`);
      const tk = a.opts.get('ticks');
      if (!tk) throw new DiagError(cmd.line, cmd.col, `frame set: give ticks=<t>`);
      const ticks = ticksOpt(tk);
      // Frames of mirror views follow their source; a range over them sets the others.
      const own = (f: number) => !viewOf(doc, f)?.mirror;
      if (r.from === r.to) notMirror(doc, r.from - 1, cmd, 'frame set');
      return {
        text: `frame set ${r.text} ticks=${ticks}`,
        op: fn((d) => { for (let f = r.from - 1; f < r.to; f++) if (own(f)) d.ticks[f] = ticks; }),
      };
    }
    if (how.v === 'add') {
      const pos = a.peek()?.t === 'int' ? frameNumber(doc, a.take('int', 'a position'), cmd, 'a position', doc.frameCount + 1) : doc.frameCount + 1;
      a.done();
      noOpts('frame add', ['copy', 'link', 'ticks']);
      const copyOpt = a.opts.get('copy');
      const linkOpt = a.opts.get('link');
      const empty = a.flags.length > 0;
      if ([copyOpt, linkOpt, empty || undefined].filter(Boolean).length > 1) throw new DiagError(cmd.line, cmd.col, `frame add: give one of copy=, link= or empty`);
      const src = linkOpt ? frameOpt(doc, linkOpt) : copyOpt ? frameOpt(doc, copyOpt) : ctxOf(doc, ctx.by).frame + 1;
      if (linkOpt) notMirror(doc, src - 1, linkOpt, 'frame add link=');
      const tk = a.opts.get('ticks');
      const ticks = tk ? ticksOpt(tk) : null;
      const how2 = linkOpt ? `link=${src}` : empty ? 'empty' : `copy=${src}`;
      return {
        text: `frame add ${pos} ${how2}${ticks !== null ? ` ticks=${ticks}` : ''}`,
        op: fn((d) => {
          const n = d.width * d.height;
          const make = (l: number) => (empty ? new Uint16Array(n).fill(TRANSPARENT) : linkOpt ? d.cels[l]![src - 1]! : d.cels[l]![src - 1]!.slice());
          insertFrames(d, pos - 1, 1, make, [ticks ?? d.ticks[src - 1]!]);
        }),
      };
    }
    const n = frameNumber(doc, a.take('int', 'a frame number'), cmd, 'a frame number');
    if (how.v === 'remove') {
      a.done();
      noOpts('frame remove');
      if (doc.frameCount === 1) throw new DiagError(cmd.line, cmd.col, `frame remove: frame 1 is the only frame`);
      notMirror(doc, n - 1, cmd, 'frame remove');
      return { text: `frame remove ${n}`, op: fn((d) => removeFrame(d, n - 1)) };
    }
    a.done();
    noOpts('frame move', ['to']);
    const toOpt = a.opts.get('to');
    if (!toOpt) throw new DiagError(cmd.line, cmd.col, `frame move: missing to=<n>`);
    const to = frameOpt(doc, toOpt);
    // A frame stays in its view (or out of every view): views are directions, not just ranges.
    const map = moveMap(n - 1, to - 1);
    for (const v of doc.views) {
      const fs = Array.from({ length: v.to - v.from + 1 }, (_, k) => map(v.from + k));
      const lo = Math.min(...fs);
      if (Math.max(...fs) - lo !== fs.length - 1) throw new DiagError(toOpt.line, toOpt.vcol, `frame move: view ${v.name} would no longer be one run of frames`);
    }
    if (viewOf(doc, n - 1)?.mirror) notMirror(doc, n - 1, cmd, 'frame move');
    return { text: `frame move ${n} to=${to}`, op: fn((d) => moveFrame(d, n - 1, to - 1)) };
  },
};

registerCommand(layerCmd);
registerCommand(frameCmd);
