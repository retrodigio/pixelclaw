// G6 in core: frame durations, tags, views with live mirror links, linked cels, the pivot and the
// ground line, sequences and playback timing; every one replays and round-trips the state bytes.
import { describe, expect, it } from 'vitest';
import {
  TRANSPARENT, deserializeDoc, flatten, frameAtTick, playOrder, renderGrid, replay, runBatch, sequences, serializeDoc, type Doc,
} from '../src/index.ts';
import { EMPTY, palettes, run } from './helpers.ts';

const doc = (text: string): Doc => run(EMPTY, text).doc!;
const fails = (text: string): string => {
  const s = run(EMPTY, text.split('\n')[0]!);
  const r = runBatch(s, text.split('\n').slice(1).join('\n'), { by: 'test', palettes });
  if (r.ok) throw new Error('expected an error');
  return r.errors[0]!.message;
};
/** The state survives replay and a trip through the state bytes. */
function roundTrips(text: string): Doc {
  const s = run(EMPTY, text);
  const r = replay(s.entries, palettes);
  expect(serializeDoc(r.doc!)).toEqual(serializeDoc(s.doc!));
  const back = deserializeDoc(serializeDoc(s.doc!));
  expect(serializeDoc(back)).toEqual(serializeDoc(s.doc!));
  return s.doc!;
}

describe('frame durations', () => {
  it('default to 10 ticks; frame set changes one, a range or all; a new frame takes its source\'s', () => {
    const d = roundTrips('new sprite s 4x4\nframe add\nframe add\nframe set 2 ticks=6\nframe set all ticks=8\nframe set 1-2 ticks=12\nframe add 2 copy=3\nframe add empty ticks=4');
    expect(d.ticks).toEqual([12, 8, 12, 8, 4]);
    const s = run(EMPTY, 'new sprite s 4x4\nframe add\nframe set all ticks=7');
    expect(s.entries.at(-1)!.cmd).toBe('frame set 1-2 ticks=7');
  });
  it('documents without animation keep their old state bytes', () => {
    const bytes = new TextDecoder().decode(serializeDoc(doc('new sprite s 4x4\nframe add')));
    expect(bytes).not.toContain('"anim"');
    expect(new TextDecoder().decode(serializeDoc(doc('new sprite s 4x4\nframe set 1 ticks=3')))).toContain('"anim"');
  });
  it('refuses bad ticks', () => {
    expect(fails('new sprite s 4x4\nframe set 1 ticks=0')).toMatch(/ticks= must be/);
    expect(fails('new sprite s 4x4\nframe set 1-3 ticks=5')).toMatch(/not within 1..1/);
  });
});

describe('tags', () => {
  it('add, set and remove; they follow frames added, removed and moved', () => {
    let s = run(EMPTY, 'new sprite s 4x4\nframe add\nframe add\nframe add\ntag add idle 1-2\ntag add walk 3-4 loop=pingpong');
    expect(s.doc!.tags).toEqual([{ name: 'idle', from: 0, to: 1, loop: 'cycle' }, { name: 'walk', from: 2, to: 3, loop: 'pingpong' }]);
    s = run(s, 'frame add 2'); // inside idle: it grows; walk moves along
    expect(s.doc!.tags.map((t) => [t.from, t.to])).toEqual([[0, 2], [3, 4]]);
    s = run(s, 'frame remove 1');
    expect(s.doc!.tags.map((t) => [t.from, t.to])).toEqual([[0, 1], [2, 3]]);
    s = run(s, 'tag set walk frames=3-3 loop=cycle\ntag remove idle');
    expect(s.doc!.tags).toEqual([{ name: 'walk', from: 2, to: 2, loop: 'cycle' }]);
    expect(serializeDoc(replay(s.entries, palettes).doc!)).toEqual(serializeDoc(s.doc!));
  });
  it('refuses clashes and unknown tags', () => {
    expect(fails('new sprite s 4x4\ntag add a 1\ntag add a 1')).toMatch(/already a tag/);
    expect(fails('new sprite s 4x4\ntag remove b')).toMatch(/no tag 'b'/);
  });
});

describe('linked cels', () => {
  it('share pixels: drawing on one draws on all; unlink gives each its own copy', () => {
    let s = run(EMPTY, 'new sprite s 4x4\nframe add empty\nframe add empty\npx 0,0 c=ink\ncel link 1-3\nframe 2\npx 1,1 c=leaf');
    const d = s.doc!;
    for (let f = 0; f < 3; f++) expect([flatten(d, f)[0], flatten(d, f)[5]]).toEqual([0, 2]);
    expect(d.cels[0]![0]).toBe(d.cels[0]![2]);
    // Links survive cloning, replay and the state bytes.
    roundTrips(s.entries.map((e) => e.cmd).join('\n'));
    const back = deserializeDoc(serializeDoc(d));
    expect(back.cels[0]![1]).toBe(back.cels[0]![2]);
    s = run(s, 'cel unlink 2\npx 2,2 c=rust');
    expect(flatten(s.doc!, 1)[10]).toBe(5);
    expect(flatten(s.doc!, 0)[10]).toBe(TRANSPARENT);
    expect(s.doc!.cels[0]![0]).toBe(s.doc!.cels[0]![2]);
  });
  it('frame add link= makes a linked frame; undo takes a link back', () => {
    let s = run(EMPTY, 'new sprite s 4x4\npx 0,0 c=ink\nframe add link=1');
    s = run(s, 'frame 2\npx 3,3 c=moss');
    expect(flatten(s.doc!, 0)[15]).toBe(1);
    s = run(s, 'undo');
    expect(flatten(s.doc!, 0)[15]).toBe(TRANSPARENT);
  });
});

describe('views and live mirror links', () => {
  const walker = 'new sprite w 6x4\nframe add empty\nframe add empty\nframe add empty\n' +
    'view S frames=1-2\nview E frames=3-4\nframe 3\npaint 0,0 <<\n  00....\n  0.....\n>>\nframe 4\npx 0,3 c=leaf\nview W mirror=E';
  it('a mirror view gets its frames at the end, each its source flipped', () => {
    const d = roundTrips(walker);
    expect(d.frameCount).toBe(6);
    expect(d.views).toEqual([
      { name: 'S', from: 0, to: 1, mirror: null }, { name: 'E', from: 2, to: 3, mirror: null }, { name: 'W', from: 4, to: 5, mirror: 'E' },
    ]);
    expect(renderGrid(d, undefined, 4).split('\n').slice(2, 4).map((r) => r.trim())).toEqual(['0  ....00', '1  .....0']);
    expect(flatten(d, 5)[3 * 6 + 5]).toBe(2);
  });
  it('updates live: drawing on the source, adding a source frame, durations', () => {
    let s = run(EMPTY, walker);
    s = run(s, 'frame 3\npx 2,2 c=rust\nframe set 3-4 ticks=6\nframe add 4 copy=3');
    const d = s.doc!;
    const W = d.views.find((v) => v.name === 'W')!;
    expect([W.from, W.to]).toEqual([5, 7]);
    expect(flatten(d, 5)[2 * 6 + 3]).toBe(5);
    expect(flatten(d, 6)[2 * 6 + 3]).toBe(5);
    expect(d.ticks.slice(5)).toEqual([6, 6, 6]);
    // A range over a mirror's frames sets the others; the mirror follows.
    expect(run(s, 'frame set all ticks=4').doc!.ticks).toEqual([4, 4, 4, 4, 4, 4, 4, 4]);
    expect(serializeDoc(replay(s.entries, palettes).doc!)).toEqual(serializeDoc(d));
  });
  it('refuses drawing on a mirror, and frees it with mirror=off', () => {
    expect(fails(`${walker.split('\n')[0]}\n${walker.split('\n').slice(1).join('\n')}\nframe 5\npx 1,1 c=ink`)).toMatch(/view W, a live mirror of E: draw on E \(frame 3\)/);
    let s = run(EMPTY, walker);
    s = run(s, 'view W mirror=off\nframe 5\npx 1,1 c=ink\nframe 3\npx 1,1 c=leaf');
    expect(flatten(s.doc!, 4)[7]).toBe(0);
  });
  it('checks directions, overlaps and moves', () => {
    expect(fails('new sprite s 4x4\nframe add\nview E frames=1\nview S mirror=E')).toMatch(/faces the other way/);
    expect(fails('new sprite s 4x4\nframe add\nview E frames=1-2\nview S frames=2')).toMatch(/overlap view E/);
    expect(fails('new sprite s 4x4\nframe add\nframe add\nview E frames=1-2\nframe move 1 to=3')).toMatch(/no longer be one run/);
    expect(fails('new sprite s 4x4\nview Q frames=1')).toMatch(/not a direction/);
  });
});

describe('pivot and ground', () => {
  it('set, clear, and round-trip', () => {
    const d = roundTrips('new sprite s 8x8\npivot 4,7\nground 7');
    expect([d.pivot, d.ground]).toEqual([[4, 7], 7]);
    expect(doc('new sprite s 8x8\npivot 4,7\npivot off').pivot).toBeNull();
    expect(fails('new sprite s 8x8\nground 8')).toMatch(/outside rows/);
  });
});

describe('sequences and playback timing', () => {
  it('views and tags become sequences; ping-pong plays there and back', () => {
    const d = doc('new sprite s 4x4\nframe add\nframe add\nframe add\nview S frames=1-2\ntag add bob 3-4 loop=pingpong\nframe add\nframe add\ntag add ripple 5-6 loop=pingpong\ntag set ripple frames=4-6');
    const seqs = sequences(d);
    expect(seqs.map((s) => [s.name, s.frames, s.loop])).toEqual([['S', [0, 1], 'cycle'], ['bob', [2, 3], 'pingpong'], ['ripple', [3, 4, 5], 'pingpong']]);
    expect(playOrder(seqs[2]!)).toEqual([3, 4, 5, 4]);
    expect(sequences(doc('new tile t 4x4\nframe add')).map((s) => s.frames)).toEqual([[0, 1]]);
  });
  it('the frame at a tick follows the durations', () => {
    const d = doc('new tile t 4x4\nframe add\nframe add\nframe set 1 ticks=5\nframe set 2 ticks=10\nframe set 3 ticks=1');
    const s = sequences(d)[0]!;
    expect([0, 4, 5, 14, 15, 16, 20].map((t) => frameAtTick(d, s, t))).toEqual([0, 0, 1, 1, 2, 0, 0]);
  });
});
