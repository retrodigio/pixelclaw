// Animation commands (plan §4.4): tags, directional views (with live mirror links), linked cels,
// the pivot and the ground line. Frame durations are `frame set … ticks=` (cmd-layers.ts).

import { VIEW_NAMES, insertFrames, opposite, viewOf } from './anim.ts';
import { frameRange } from './cmd-layers.ts';
import { Args, fn, needDoc, pt, registerCommand, type CommandSpec } from './commands.ts';
import { DEFAULT_TICKS, TRANSPARENT, ctxOf, type Doc, type Loop } from './doc.ts';
import { DiagError, type ParsedCommand, type Token } from './parser.ts';

const TAG_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const TAG_WORDS = new Set(['add', 'set', 'remove', 'all']);
const LOOPS: Loop[] = ['cycle', 'pingpong'];

function noFlags(a: Args, what: string): void {
  if (a.flags.length) throw new DiagError(a.flags[0]!.line, a.flags[0]!.col, `${what}: unexpected '${a.flags[0]!.v}'`);
}

function onlyOpts(a: Args, what: string, allowed: string[]): void {
  for (const o of a.opts.values()) if (!allowed.includes(o.key)) throw new DiagError(o.line, o.col, `${what} takes no ${o.key}=`);
}

/** frames=<a>-<b> as an option. */
function framesOpt(doc: Doc, a: Args): { from: number; to: number; text: string } | null {
  const o = a.opts.get('frames');
  if (!o) return null;
  const tok: Token = /^\d+$/.test(o.value) ? { t: 'int', v: Number(o.value), line: o.line, col: o.vcol } : { t: 'word', v: o.value, line: o.line, col: o.vcol };
  return frameRange(doc, tok, a.cmd);
}

const tagCmd: CommandSpec = {
  name: 'tag',
  summary: 'tag add <name> <a>-<b> [loop=cycle|pingpong] | tag set <name> [frames=<a>-<b>] [loop=cycle|pingpong] | tag remove <name>   (a named run of frames: walk_s, idle)',
  normalise(cmd, ctx) {
    const doc = needDoc(cmd, ctx);
    const a = new Args(cmd, ['loop', 'frames']);
    noFlags(a, 'tag');
    const how = a.take('word', 'add, set or remove');
    if (!['add', 'set', 'remove'].includes(how.v)) throw new DiagError(how.line, how.col, `tag: expected add, set or remove`);
    const name = a.take('word', 'a tag name');
    const at = doc.tags.findIndex((t) => t.name === name.v);
    if (how.v === 'add') {
      if (!TAG_RE.test(name.v) || TAG_WORDS.has(name.v)) throw new DiagError(name.line, name.col, `'${name.v}' is not a usable tag name`);
      if (at >= 0) throw new DiagError(name.line, name.col, `there is already a tag '${name.v}'`);
      const r = frameRange(doc, a.rest()[0], cmd);
      onlyOpts(a, 'tag add', ['loop']);
      const loop = a.choice('loop', LOOPS, 'cycle') as Loop;
      return {
        text: `tag add ${name.v} ${r.text} loop=${loop}`,
        op: fn((d) => { d.tags.push({ name: name.v, from: r.from - 1, to: r.to - 1, loop }); }),
      };
    }
    if (at < 0) throw new DiagError(name.line, name.col, `no tag '${name.v}'${doc.tags.length ? ` (tags: ${doc.tags.map((t) => t.name).join(', ')})` : ''}`);
    a.done();
    if (how.v === 'remove') {
      onlyOpts(a, 'tag remove', []);
      return { text: `tag remove ${name.v}`, op: fn((d) => { d.tags = d.tags.filter((t) => t.name !== name.v); }) };
    }
    onlyOpts(a, 'tag set', ['loop', 'frames']);
    const r = framesOpt(doc, a);
    const loopOpt = a.opts.get('loop');
    if (!r && !loopOpt) throw new DiagError(cmd.line, cmd.col, `tag set: give frames=<a>-<b> or loop=`);
    const loop = loopOpt ? (a.choice('loop', LOOPS, 'cycle') as Loop) : null;
    return {
      text: `tag set ${name.v}${r ? ` frames=${r.from}-${r.to}` : ''}${loop ? ` loop=${loop}` : ''}`,
      op: fn((d) => {
        const t = d.tags.find((x) => x.name === name.v)!;
        if (r) { t.from = r.from - 1; t.to = r.to - 1; }
        if (loop) t.loop = loop;
      }),
    };
  },
};

function viewName(t: Extract<Token, { t: 'word' }>): string {
  if (!(VIEW_NAMES as readonly string[]).includes(t.v)) throw new DiagError(t.line, t.col, `view: '${t.v}' is not a direction (${VIEW_NAMES.join(', ')})`);
  return t.v;
}

const viewCmd: CommandSpec = {
  name: 'view',
  summary: 'view <dir> frames=<a>-<b> | view <dir> mirror=<dir>|off | view remove <dir>   (directions S N E W SE SW NE NW; a mirror view is its source flipped left to right, kept up to date)',
  normalise(cmd, ctx) {
    const doc = needDoc(cmd, ctx);
    const a = new Args(cmd, ['frames', 'mirror']);
    noFlags(a, 'view');
    const first = a.take('word', 'a direction, or remove');
    if (first.v === 'remove') {
      const t = a.take('word', 'a direction');
      a.done();
      onlyOpts(a, 'view remove', []);
      const name = viewName(t);
      if (!doc.views.some((v) => v.name === name)) throw new DiagError(t.line, t.col, `there is no view ${name}`);
      if (doc.views.some((v) => v.mirror === name)) throw new DiagError(t.line, t.col, `view ${name} is the source of mirror view ${doc.views.find((v) => v.mirror === name)!.name} (turn that off first)`);
      return { text: `view remove ${name}`, op: fn((d) => { d.views = d.views.filter((v) => v.name !== name); }) };
    }
    const name = viewName(first);
    a.done();
    const r = framesOpt(doc, a);
    const m = a.opts.get('mirror');
    if (!!r === !!m) throw new DiagError(cmd.line, cmd.col, `view ${name}: give frames=<a>-<b> or mirror=<dir>|off`);
    const cur = doc.views.find((v) => v.name === name);
    if (r) {
      if (cur?.mirror) throw new DiagError(cmd.line, cmd.col, `view ${name} is a mirror of ${cur.mirror}: view ${name} mirror=off first`);
      const clash = doc.views.find((v) => v.name !== name && v.from <= r.to - 1 && r.from - 1 <= v.to);
      if (clash) throw new DiagError(cmd.line, cmd.col, `view ${name}: frames ${r.text} overlap view ${clash.name} (${clash.from + 1}-${clash.to + 1})`);
      return {
        text: `view ${name} frames=${r.from}-${r.to}`,
        op: fn((d) => {
          const v = d.views.find((x) => x.name === name);
          if (v) { v.from = r.from - 1; v.to = r.to - 1; } else d.views.push({ name, from: r.from - 1, to: r.to - 1, mirror: null });
        }),
      };
    }
    if (m!.value === 'off') {
      if (!cur?.mirror) throw new DiagError(m!.line, m!.vcol, `view ${name} is not a mirror`);
      return { text: `view ${name} mirror=off`, op: fn((d) => { d.views.find((v) => v.name === name)!.mirror = null; }) };
    }
    const src = doc.views.find((v) => v.name === m!.value);
    if (!(VIEW_NAMES as readonly string[]).includes(m!.value)) throw new DiagError(m!.line, m!.vcol, `mirror= must be a direction (${VIEW_NAMES.join(', ')}) or off`);
    if (!src) throw new DiagError(m!.line, m!.vcol, `there is no view ${m!.value} to mirror (view ${m!.value} frames=<a>-<b> first)`);
    if (src.name === name) throw new DiagError(m!.line, m!.vcol, `a view cannot mirror itself`);
    if (src.mirror) throw new DiagError(m!.line, m!.vcol, `view ${src.name} is itself a mirror (of ${src.mirror})`);
    if (doc.views.some((v) => v.mirror === name)) throw new DiagError(cmd.line, cmd.col, `view ${name} is the source of another mirror`);
    if (opposite(name) !== src.name) throw new DiagError(m!.line, m!.vcol, `view ${name} faces the other way from ${opposite(name) ?? 'no view'}, not ${src.name} (a mirror flips left to right)`);
    return {
      text: `view ${name} mirror=${src.name}`,
      op: fn((d) => {
        let v = d.views.find((x) => x.name === name);
        if (!v) {
          // A new view: its frames are added at the end (syncMirrors draws them).
          const s = d.views.find((x) => x.name === src.name)!;
          const at = d.frameCount;
          const count = s.to - s.from + 1;
          insertFrames(d, at, count, () => new Uint16Array(d.width * d.height).fill(TRANSPARENT), Array.from({ length: count }, () => DEFAULT_TICKS));
          d.views.push((v = { name, from: at, to: at + count - 1, mirror: null }));
        }
        v.mirror = src.name;
      }),
    };
  },
};

/** The layers a cel command works on: layer=<name>, all, or the author's layer. */
function layersOpt(doc: Doc, a: Args, by: string): { layers: number[]; text: string } {
  const o = a.opts.get('layer');
  if (!o) {
    const l = ctxOf(doc, by).layer;
    return { layers: [l], text: `layer=${doc.layers[l]!.name}` };
  }
  if (o.value === 'all') return { layers: doc.layers.map((_, i) => i), text: 'layer=all' };
  const i = doc.layers.findIndex((l) => l.name === o.value);
  if (i < 0) throw new DiagError(o.line, o.vcol, `no layer '${o.value}'`);
  return { layers: [i], text: `layer=${o.value}` };
}

function rangeFrames(doc: Doc, cmd: ParsedCommand, r: { from: number; to: number }): void {
  for (let f = r.from - 1; f < r.to; f++) {
    const v = viewOf(doc, f);
    if (v?.mirror) throw new DiagError(cmd.line, cmd.col, `${cmd.name}: frame ${f + 1} is in view ${v.name}, a live mirror of ${v.mirror}`);
  }
}

const celCmd: CommandSpec = {
  name: 'cel',
  summary: 'cel link <a>-<b> [layer=<name>|all] | cel unlink <a>-<b> [layer=<name>|all]   (linked cels share their pixels: draw on one, all change; link copies frame <a>\'s pixels)',
  normalise(cmd, ctx) {
    const doc = needDoc(cmd, ctx);
    const a = new Args(cmd, ['layer']);
    noFlags(a, 'cel');
    const how = a.take('word', 'link or unlink');
    if (how.v !== 'link' && how.v !== 'unlink') throw new DiagError(how.line, how.col, `cel: expected link or unlink`);
    const r = frameRange(doc, a.rest()[0], cmd);
    if (how.v === 'link' && r.from === r.to) throw new DiagError(cmd.line, cmd.col, `cel link: give two or more frames (<a>-<b>)`);
    rangeFrames(doc, cmd, r);
    const ls = layersOpt(doc, a, ctx.by);
    return {
      text: `cel ${how.v} ${r.from}-${r.to} ${ls.text}`,
      op: fn((d) => {
        for (const l of ls.layers) {
          const fr = d.cels[l]!;
          for (let f = r.from - 1; f < r.to; f++) {
            if (how.v === 'link') fr[f] = fr[r.from - 1]!;
            else if (fr.indexOf(fr[f]!) !== f || fr.lastIndexOf(fr[f]!) !== f) fr[f] = fr[f]!.slice();
          }
        }
      }),
    };
  },
};

const pivotCmd: CommandSpec = {
  name: 'pivot',
  summary: 'pivot <x,y> | pivot off   (the pixel the sprite stands on: an export field, and what pivot drift is measured from)',
  normalise(cmd, ctx) {
    const doc = needDoc(cmd, ctx);
    const a = new Args(cmd, [], ['off']);
    if (a.flags.length) {
      a.done();
      return { text: 'pivot off', op: fn((d) => { d.pivot = null; }) };
    }
    const p = pt(a.take('point', 'a pixel x,y (or off)'));
    a.done();
    if (p[0] < 0 || p[1] < 0 || p[0] >= doc.width || p[1] >= doc.height) throw new DiagError(cmd.line, cmd.col, `pivot ${p[0]},${p[1]} is outside the ${doc.width}x${doc.height} canvas`);
    return { text: `pivot ${p[0]},${p[1]}`, op: fn((d) => { d.pivot = [p[0], p[1]]; }) };
  },
};

const groundCmd: CommandSpec = {
  name: 'ground',
  summary: 'ground <y> | ground off   (the row the feet rest on: every frame should touch it)',
  normalise(cmd, ctx) {
    const doc = needDoc(cmd, ctx);
    const a = new Args(cmd, [], ['off']);
    if (a.flags.length) {
      a.done();
      return { text: 'ground off', op: fn((d) => { d.ground = null; }) };
    }
    const y = a.take('int', 'a row y (or off)');
    a.done();
    if (y.v < 0 || y.v >= doc.height) throw new DiagError(y.line, y.col, `ground ${y.v} is outside rows 0..${doc.height - 1}`);
    return { text: `ground ${y.v}`, op: fn((d) => { d.ground = y.v; }) };
  },
};

for (const c of [tagCmd, viewCmd, celCmd, pivotCmd, groundCmd]) registerCommand(c);
