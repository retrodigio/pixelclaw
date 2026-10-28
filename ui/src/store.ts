// The watch view's state: the project's tapes as the server streams them, a playhead per asset
// (live playback applies incoming commands one at a time with core's TapeCursor), pause and
// speed, time travel, and the agent's last image view. React reads it via useSyncExternalStore.

import { TapeCursor, activeGroups, type Doc, type Palette, type PaletteSource, type TapeEntry } from '@pixelclaw/core';
import type { Eye, ServerMessage, Snapshot } from '@pixelclaw/server/protocol';

export interface AssetModel {
  name: string;
  tape: TapeEntry[];
  /** The live playhead: cursor.done is the part of the tape shown so far. */
  cursor: TapeCursor;
  problem: string | null;
}

export type Status = 'connecting' | 'open' | 'closed';

/** Commands per second; Infinity plays a batch at once. */
export const SPEEDS = [1, 2, 4, 8, 16, 32, 60, Infinity] as const;

export class Store {
  status: Status = 'connecting';
  project: Snapshot['project'] | null = null;
  palettes = new Map<string, Palette>();
  defaultPalette: string | null = null;
  assets = new Map<string, AssetModel>();
  selected: string | null = null;
  /** Switch to whichever asset the agent is drawing on. */
  follow = true;
  paused = false;
  speed: number = 8;
  /** Time travel: the tape position (seq) shown read-only, or null for live. */
  travel: number | null = null;
  eye: Eye | null = null;
  /** Assets in the order their batches arrived and have not played yet. */
  private queue: string[] = [];
  private travelCache: { key: string; doc: Doc | null } | null = null;
  private listeners = new Set<() => void>();
  private version = 0;
  private ws: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private raf = 0;
  private budget = 0;
  private lastTick = 0;

  private idle = true;
  private readonly source: PaletteSource = { get: (n) => this.palettes.get(n) };

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.version;

  private changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  // --- connection

  connect(token: string): void {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => { this.status = 'open'; this.changed(); };
    ws.onmessage = (ev) => this.receive(JSON.parse(String(ev.data)) as ServerMessage);
    ws.onclose = () => {
      this.ws = null;
      this.status = 'closed';
      this.changed();
      this.retry = setTimeout(() => this.connect(token), 1000);
    };
  }

  disconnect(): void {
    if (this.retry) clearTimeout(this.retry);
    this.ws?.close();
    cancelAnimationFrame(this.raf);
  }

  receive(m: ServerMessage): void {
    if (m.type === 'hello') this.load(m.snapshot);
    else if (m.type === 'palettes') {
      this.palettes = new Map(m.palettes.map((p) => [p.name, p]));
      this.defaultPalette = m.defaultPalette;
    } else if (m.type === 'eye') this.eye = m.eye;
    else if (m.type === 'batch') {
      let a = this.assets.get(m.asset);
      if (!a || m.reset) {
        a = { name: m.asset, tape: [], cursor: new TapeCursor(this.source), problem: null };
        this.assets.set(m.asset, a);
        if (this.travel !== null && this.selected === m.asset) this.travel = null;
      }
      a.tape.push(...m.entries);
      this.queue.push(m.asset);
      if (!this.selected) this.selected = m.asset;
      this.schedule();
    }
    this.changed();
  }

  /** A fresh snapshot (on connect, or when the server switches project): everything shown at once. */
  private load(s: Snapshot): void {
    this.project = s.project;
    this.palettes = new Map(s.palettes.map((p) => [p.name, p]));
    this.defaultPalette = s.defaultPalette;
    this.eye = s.eye;
    this.queue = [];
    this.travel = null;
    this.assets = new Map();
    for (const t of s.assets) {
      const a: AssetModel = { name: t.name, tape: t.entries, cursor: new TapeCursor(this.source), problem: null };
      this.advance(a, a.tape.length);
      this.assets.set(t.name, a);
    }
    if (!this.selected || !this.assets.has(this.selected)) this.selected = s.live ?? s.assets[0]?.name ?? null;
  }

  // --- playback

  pending(a: AssetModel | undefined): number {
    return a ? a.tape.length - a.cursor.done.length : 0;
  }

  /** Apply up to n more entries of the tape to the live playhead. */
  private advance(a: AssetModel, n: number): void {
    for (let i = 0; i < n && !a.problem; i++) {
      const e = a.tape[a.cursor.done.length];
      if (!e) break;
      const problem = a.cursor.step(e);
      if (problem) a.problem = `#${e.seq}: ${problem}`;
    }
  }

  private schedule(): void {
    if (this.raf) return;
    this.lastTick = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    this.raf = 0;
    const dt = Math.min(250, now - this.lastTick);
    this.lastTick = now;
    if (this.paused) return;
    let cur = this.selected ? this.assets.get(this.selected) : undefined;
    // Following: once the shown asset has caught up, move to the next asset with new commands.
    if (this.follow && this.pending(cur) === 0) {
      this.queue = this.queue.filter((n) => this.pending(this.assets.get(n)) > 0);
      const next = this.queue[0];
      if (next && next !== this.selected) {
        this.selected = next;
        this.travel = null;
        cur = this.assets.get(next);
        this.budget = 0;
      }
    }
    if (!cur || this.pending(cur) === 0 || cur.problem) {
      this.idle = true;
      this.budget = 0;
      this.changed();
      return;
    }
    if (this.speed === Infinity) this.advance(cur, this.pending(cur));
    else {
      // The first command of a batch shows at once; the rest follow at the chosen speed.
      if (this.idle) this.budget = 1;
      else this.budget += (dt * this.speed) / 1000;
      this.idle = false;
      const n = Math.floor(this.budget);
      this.budget -= n;
      this.advance(cur, n);
    }
    this.changed();
    this.schedule();
  };

  setPaused(p: boolean): void {
    this.paused = p;
    if (!p) this.schedule();
    this.changed();
  }

  setSpeed(s: number): void {
    this.speed = s;
    this.changed();
  }

  setFollow(f: boolean): void {
    this.follow = f;
    if (f) this.schedule();
    this.changed();
  }

  /** Show everything received so far, leave time travel and resume playback. */
  jumpToLive(): void {
    for (const a of this.assets.values()) this.advance(a, this.pending(a));
    this.queue = [];
    this.travel = null;
    this.paused = false;
    this.changed();
  }

  select(name: string): void {
    if (!this.assets.has(name)) return;
    this.selected = name;
    this.travel = null;
    this.schedule();
    this.changed();
  }

  /** Time travel: view the document as it was after tape entry `seq` (null returns to live). */
  setTravel(seq: number | null): void {
    this.travel = seq;
    this.changed();
  }

  // --- what to draw

  get current(): AssetModel | undefined {
    return this.selected ? this.assets.get(this.selected) : undefined;
  }

  /** The document on the canvas: the travel point, or the live playhead. */
  shownDoc(): { doc: Doc | null; seq: number | null } {
    const a = this.current;
    if (!a) return { doc: null, seq: null };
    if (this.travel === null) return { doc: a.cursor.doc, seq: a.cursor.done.at(-1)?.seq ?? null };
    const key = `${a.name}:${this.travel}:${a.tape.length}:${a.tape[0]?.seq ?? 0}`;
    if (this.travelCache?.key !== key) {
      const c = new TapeCursor(this.source);
      for (const e of a.tape) {
        if (e.seq > this.travel || c.step(e) !== null) break;
      }
      this.travelCache = { key, doc: c.doc };
    }
    return { doc: this.travelCache.doc, seq: this.travel };
  }

  undoneGroups(a: AssetModel): Set<string> {
    const active = activeGroups(a.tape);
    return new Set(a.tape.map((e) => e.group).filter((g) => !active.has(g)));
  }
}
