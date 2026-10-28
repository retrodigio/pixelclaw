// The animation model (plan §4.4): inserting, removing and moving frames with their durations,
// tags and views kept in step; live mirror views; and the sequences that playback, the `anim`
// view and the `anim` checks walk through.

import { DEFAULT_TICKS, TRANSPARENT, remapCtx, type Doc, type Loop, type Tag, type View } from './doc.ts';

/** The directions a view can be named after. */
export const VIEW_NAMES = ['S', 'N', 'E', 'W', 'SE', 'SW', 'NE', 'NW'] as const;

/** The view facing the other way left to right (E and W, SE and SW, NE and NW), or null. */
export function opposite(name: string): string | null {
  const m: Record<string, string> = { E: 'W', W: 'E', SE: 'SW', SW: 'SE', NE: 'NW', NW: 'NE' };
  return m[name] ?? null;
}

type Range = { from: number; to: number };

/**
 * Insert frames at 0-based position `at`: `make(layer)` gives each layer's cels for them. Durations
 * come from `ticks`. A range the new frames land strictly inside grows; one after them moves.
 */
export function insertFrames(d: Doc, at: number, count: number, make: (layer: number, k: number) => Uint16Array, ticks: number[]): void {
  d.cels.forEach((fr, l) => fr.splice(at, 0, ...Array.from({ length: count }, (_, k) => make(l, k))));
  d.ticks.splice(at, 0, ...ticks);
  d.frameCount += count;
  const shift = (r: Range) => {
    if (at <= r.from) { r.from += count; r.to += count; } else if (at <= r.to) r.to += count;
  };
  d.tags.forEach(shift);
  d.views.forEach(shift);
  // Authors keep the frame they were on.
  remapCtx(d, (l) => l, (f) => (f >= at ? f + count : f));
}

/** Remove the frame at 0-based `at`; ranges shrink, and one left empty goes. */
export function removeFrame(d: Doc, at: number): void {
  for (const fr of d.cels) fr.splice(at, 1);
  d.ticks.splice(at, 1);
  d.frameCount--;
  const shrink = <T extends Range>(rs: T[]): T[] => rs.filter((r) => {
    if (at < r.from) { r.from--; r.to--; } else if (at <= r.to) r.to--;
    return r.to >= r.from;
  });
  d.tags = shrink(d.tags);
  d.views = shrink(d.views);
  remapCtx(d, (l) => l, (f) => (f > at ? f - 1 : Math.min(f, d.frameCount - 1)));
}

/** Where frame f goes when the frame at `from` moves to `to` (0-based). */
export function moveMap(from: number, to: number): (f: number) => number {
  return (f) => (f === from ? to : from < f && f <= to ? f - 1 : to <= f && f < from ? f + 1 : f);
}

/** Move a frame; a range becomes the span of the frames that were in it. */
export function moveFrame(d: Doc, from: number, to: number): void {
  for (const fr of d.cels) { const [c] = fr.splice(from, 1); fr.splice(to, 0, c!); }
  const [t] = d.ticks.splice(from, 1);
  d.ticks.splice(to, 0, t!);
  const map = moveMap(from, to);
  for (const r of [...d.tags, ...d.views]) {
    const fs = Array.from({ length: r.to - r.from + 1 }, (_, k) => map(r.from + k));
    r.from = Math.min(...fs);
    r.to = Math.max(...fs);
  }
  remapCtx(d, (l) => l, map);
}

/** A cel flipped left to right (a new array). */
export function flipCel(c: Uint16Array, w: number, h: number): Uint16Array {
  const out = new Uint16Array(c.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = c[y * w + w - 1 - x]!;
  return out;
}

/** The view a frame (0-based) belongs to, if any. */
export function viewOf(d: Doc, f: number): View | null {
  return d.views.find((v) => v.from <= f && f <= v.to) ?? null;
}

/**
 * Keep every mirror view a mirror: as many frames as its source (added or removed at its end),
 * each layer's cels its source's flipped left to right, and the same durations. Runs after every
 * command, so a mirror updates live whatever changed its source.
 */
export function syncMirrors(d: Doc): void {
  for (const v of d.views) {
    if (!v.mirror) continue;
    const src = d.views.find((s) => s.name === v.mirror && !s.mirror);
    if (!src) { v.mirror = null; continue; }
    const want = src.to - src.from + 1;
    while (v.to - v.from + 1 < want) {
      insertFrames(d, v.to + 1, 1, () => new Uint16Array(d.width * d.height).fill(TRANSPARENT), [DEFAULT_TICKS]);
      v.to++;
    }
    while (v.to - v.from + 1 > want) removeFrame(d, v.to);
    for (let k = 0; k < want; k++) {
      d.ticks[v.from + k] = d.ticks[src.from + k]!;
      d.cels.forEach((fr) => { fr[v.from + k] = flipCel(fr[src.from + k]!, d.width, d.height); });
    }
  }
}

/** Something playback, the `anim` view and the `anim` checks step through. */
export interface Sequence {
  name: string;
  /** The frames of one pass, 0-based, in order (a ping-pong's way back is not listed). */
  frames: number[];
  loop: Loop;
  /** The view it shows, if any. */
  view: string | null;
  /** A mirror view's frames (the same art as its source, flipped). */
  mirror: boolean;
}

/**
 * The sequences of a document: every tag; every view with no tag inside it; and when there is
 * neither, all frames as one cycle. Views first, in direction order, then tags as written.
 */
export function sequences(d: Doc): Sequence[] {
  const range = (r: Range) => Array.from({ length: r.to - r.from + 1 }, (_, k) => r.from + k);
  const inside = (t: Tag, v: View) => v.from <= t.from && t.to <= v.to;
  const out: Sequence[] = [];
  const views = [...d.views].sort((a, b) => VIEW_NAMES.indexOf(a.name as never) - VIEW_NAMES.indexOf(b.name as never));
  for (const v of views) {
    if (d.tags.some((t) => inside(t, v))) continue;
    out.push({ name: v.name, frames: range(v), loop: 'cycle', view: v.name, mirror: !!v.mirror });
  }
  for (const t of d.tags) {
    const v = d.views.find((x) => inside(t, x)) ?? null;
    out.push({ name: t.name, frames: range(t), loop: t.loop, view: v?.name ?? null, mirror: !!v?.mirror });
  }
  if (!out.length) out.push({ name: 'all', frames: range({ from: 0, to: d.frameCount - 1 }), loop: 'cycle', view: null, mirror: false });
  return out;
}

/** The frames played in one full loop: a ping-pong goes there and back without repeating its ends. */
export function playOrder(s: Sequence): number[] {
  if (s.loop !== 'pingpong' || s.frames.length < 3) return s.frames;
  return [...s.frames, ...s.frames.slice(1, -1).reverse()];
}

/** Ticks in one loop of a sequence. */
export function loopTicks(d: Doc, s: Sequence): number {
  return playOrder(s).reduce((n, f) => n + d.ticks[f]!, 0);
}

/** The frame showing at a tick (counted from the start, looping). */
export function frameAtTick(d: Doc, s: Sequence, tick: number): number {
  const order = playOrder(s);
  const total = loopTicks(d, s);
  let t = total > 0 ? ((tick % total) + total) % total : 0;
  for (const f of order) {
    if (t < d.ticks[f]!) return f;
    t -= d.ticks[f]!;
  }
  return order[0]!;
}
