// The page's state: the project's tapes as the server streams them, a playhead per asset (live
// playback applies incoming commands one at a time with core's TapeCursor), pause and speed, time
// travel (from a Timeline's snapshots), the agent's last image view, and this person's author name
// for the edits the page sends. React reads it via useSyncExternalStore.

import {
  BUILTIN_THEMES, CHECK_IDS, TapeCursor, Timeline, activeGroups, checkContextFor, runChecks, type AssetDoc, type CheckId, type CheckResult, type Diag,
  type Doc, type Palette, type PaletteSource, type StyleJson, type TapeEntry, type Theme, type WorkRequest,
} from '@pixelclaw/core';
import { HUMAN_RE, type Eye, type PersonRequest, type ServerMessage, type Snapshot, type WorkerStatus } from '@pixelclaw/server/protocol';

export type Tab = 'editor' | 'dashboard' | 'gallery';
const TABS: Tab[] = ['editor', 'dashboard', 'gallery'];

export type Answer = { ok: boolean; error?: string; request?: WorkRequest };

/** What an import from the dashboard sends with its files (the server's ImportOptions). */
export interface ImportChoice {
  kind?: string;
  slice?: { cell: [number, number]; offset?: [number, number]; gap?: [number, number] };
  pattern?: string;
  names?: string[];
  set?: string;
  palette?: string;
  build?: boolean;
  wrap?: boolean;
}

export interface ImportAnswer {
  created?: { name: string; kind: string; size: string; inexact: number; failing: string[]; checks: number; planned: boolean }[];
  added?: string[];
  notes?: string[];
  text?: string;
  error?: string;
}

export interface AssetModel {
  name: string;
  tape: TapeEntry[];
  /** The live playhead: cursor.done is the part of the tape shown so far. */
  cursor: TapeCursor;
  problem: string | null;
  /** Snapshots for time travel. */
  timeline: Timeline;
}

export type RunResult = { ok: true; asset: string; group: string | null; seq: number | null } | { ok: false; errors: Diag[] };

const isHuman = (by: string) => by === 'human' || by.startsWith('human:');

/** The author name this page writes as: ?name=…, else the last one used here, else human:guest. */
function initialAuthor(): string {
  const q = new URLSearchParams(location.search).get('name');
  const stored = (() => {
    try {
      return localStorage.getItem('pixelclaw.author');
    } catch {
      return null;
    }
  })();
  for (const c of [q && (q.startsWith('human:') ? q : `human:${q}`), stored]) if (c && HUMAN_RE.test(c)) return c;
  return 'human:guest';
}

export type Status = 'connecting' | 'open' | 'closed';

/** The page checks every frame up to this many pixels (width x height x frames), as the run summary does. */
export const CHECK_BUDGET = 1 << 18;

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
  /** The author this page's edits are written as. */
  me: string = initialAuthor();
  /** The last error from an edit this page sent (shown until the next edit). */
  error: string | null = null;
  /** The style guide (project.json `style`) and the preview themes. */
  style: StyleJson = {};
  themes: Theme[] = BUILTIN_THEMES;
  /** The preview theme role entries are shown in (null: their own colours). Only for looking. */
  theme: string | null = null;
  /** Checks whose flagged pixels are circled on the canvas. */
  marked = new Set<CheckId>();
  /** The check whose details are open under the toolbar. */
  openCheck: CheckId | null = null;
  /** The tab shown: the editor, or the dashboard (the asset plan). Only for looking. */
  tab: Tab = (TABS as string[]).includes(new URLSearchParams(location.search).get('tab') ?? '') ? (new URLSearchParams(location.search).get('tab') as Tab) : 'editor';
  /** Every request as it stands: from the plan report, then as the server sends them. */
  requests: WorkRequest[] = [];
  /** The headless worker, and its log as far as this page has seen it. */
  worker: WorkerStatus | null = null;
  workerLog: string[] = [];
  /** Bumped when the plan may have changed (a batch, an export, a new manifest): the dashboard reloads it. */
  planVersion = 0;
  /** The token the page was opened with (the dashboard's requests carry it). */
  token = '';
  private styleVersion = 0;
  private checkCache: { key: string; asset: string; at: number; results: CheckResult[] } | null = null;
  /** Assets in the order their batches arrived and have not played yet. */
  private queue: string[] = [];
  private travelCache: { key: string; doc: Doc | null } | null = null;
  private nextId = 0;
  private waiting = new Map<number, (r: RunResult) => void>();
  private answers = new Map<number, (r: Answer) => void>();
  private listeners = new Set<() => void>();
  private version = 0;
  private ws: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private raf = 0;
  private budget = 0;
  private lastTick = 0;

  private idle = true;
  private readonly source: PaletteSource = { get: (n) => this.palettes.get(n) };

  get paletteSource(): PaletteSource {
    return this.source;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.version;

  /** Tell React something changed. */
  changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  private model(name: string, tape: TapeEntry[]): AssetModel {
    return { name, tape, cursor: new TapeCursor(this.source), problem: null, timeline: new Timeline(this.source) };
  }

  setMe(name: string): boolean {
    const by = name.startsWith('human:') ? name : `human:${name}`;
    if (!HUMAN_RE.test(by)) return false;
    this.me = by;
    try {
      localStorage.setItem('pixelclaw.author', by);
    } catch {
      // private mode: the name lasts for this page only
    }
    this.changed();
    return true;
  }

  /**
   * Send commands to the single writer as this person: one batch, one undo group. The batch
   * comes back to every page (this one included) like any other; the promise gives the answer.
   */
  send(asset: string, commands: string): Promise<RunResult> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.resolve({ ok: false, errors: [{ line: 0, col: 0, message: 'not connected' }] });
    const id = ++this.nextId;
    ws.send(JSON.stringify({ type: 'run', id, asset, commands, by: this.me }));
    return new Promise((resolve) => this.waiting.set(id, (r) => {
      this.error = r.ok ? null : r.errors.map((e) => (e.line ? `${e.line}:${e.col}: ${e.message}` : e.message)).join('\n');
      this.changed();
      resolve(r);
    }));
  }

  /** A request, a reply or a cancel, written as this person. */
  request(body: PersonRequest): Promise<Answer> {
    return this.ask({ type: 'request', body });
  }

  /** Start or stop the headless worker. */
  workerAction(action: 'start' | 'stop'): Promise<Answer> {
    return this.ask({ type: 'worker', action });
  }

  private ask(m: { type: 'request'; body: PersonRequest } | { type: 'worker'; action: 'start' | 'stop' }): Promise<Answer> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.resolve({ ok: false, error: 'not connected' });
    const id = ++this.nextId;
    ws.send(JSON.stringify({ ...m, id, by: this.me }));
    return new Promise((resolve) => this.answers.set(id, resolve));
  }

  /** Import files into the gallery: new assets, manifest entries, checks. */
  async importFiles(files: File[], choice: ImportChoice): Promise<ImportAnswer> {
    const enc = await Promise.all(files.map(async (f) => {
      const b = new Uint8Array(await f.arrayBuffer());
      let bin = '';
      for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
      return { name: f.name, data: btoa(bin) };
    }));
    try {
      const r = await fetch(`/api/import?token=${encodeURIComponent(this.token)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: enc, options: choice, by: this.me }) });
      return (await r.json()) as ImportAnswer;
    } catch (e) {
      return { error: String(e) };
    }
  }

  /** The worker's log so far (on opening the panel). */
  async loadWorker(): Promise<void> {
    try {
      const r = (await (await fetch(`/api/worker?token=${encodeURIComponent(this.token)}`)).json()) as { status: WorkerStatus; log: string[] };
      this.worker = r.status;
      this.workerLog = r.log;
      this.changed();
    } catch {
      // shown when the next line arrives
    }
  }

  /** Who wrote the asset's last command, and when (for "Claude is working on this"). */
  lastWrite(name: string): { by: string; at: string } | null {
    const e = this.assets.get(name)?.tape.at(-1);
    return e ? { by: e.by, at: e.at ?? "" } : null;
  }

  // --- connection

  setTab(t: Tab): void {
    this.tab = t;
    const u = new URL(location.href);
    if (t !== 'editor') u.searchParams.set('tab', t); else u.searchParams.delete('tab');
    history.replaceState(null, '', u);
    this.changed();
  }

  connect(token: string): void {
    this.token = token;
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
    if (m.type === 'hello') { this.load(m.snapshot); this.planVersion++; }
    else if (m.type === 'palettes') {
      this.palettes = new Map(m.palettes.map((p) => [p.name, p]));
      this.defaultPalette = m.defaultPalette;
    } else if (m.type === 'eye') this.eye = m.eye;
    else if (m.type === 'style') {
      this.style = m.style;
      this.themes = m.themes;
      this.styleVersion++;
    }
    else if (m.type === 'result') {
      const done = this.waiting.get(m.id);
      this.waiting.delete(m.id);
      done?.(m.ok ? { ok: true, asset: m.asset, group: m.group, seq: m.seq } : { ok: false, errors: m.errors });
    } else if (m.type === 'plan') this.planVersion++;
    else if (m.type === 'answer') {
      const done = this.answers.get(m.id);
      this.answers.delete(m.id);
      done?.({ ok: m.ok, ...(m.error ? { error: m.error } : {}), ...(m.request ? { request: m.request } : {}) });
    } else if (m.type === 'requests') this.requests = m.requests;
    else if (m.type === 'worker') this.worker = m.status;
    else if (m.type === 'workerLog') this.workerLog = [...this.workerLog, ...m.lines].slice(-500);
    else if (m.type === 'batch') {
      this.planVersion++;
      let a = this.assets.get(m.asset);
      if (!a || m.reset) {
        a = this.model(m.asset, []);
        this.assets.set(m.asset, a);
        if (this.travel !== null && this.selected === m.asset) this.travel = null;
      }
      const caughtUp = this.pending(a) === 0;
      a.tape.push(...m.entries);
      if (!this.selected) this.selected = m.asset;
      // A person's edit shows at once (it is one stroke or one action, not a script to watch).
      if (isHuman(m.by) && caughtUp && !this.paused) this.advance(a, m.entries.length);
      else this.queue.push(m.asset);
      this.schedule();
    }
    this.changed();
  }

  /** A fresh snapshot (on connect, or when the server switches project): everything shown at once. */
  private load(s: Snapshot): void {
    this.project = s.project;
    this.palettes = new Map(s.palettes.map((p) => [p.name, p]));
    this.defaultPalette = s.defaultPalette;
    this.style = s.style ?? {};
    this.themes = s.themes ?? BUILTIN_THEMES;
    this.styleVersion++;
    this.eye = s.eye;
    this.worker = s.worker ?? null;
    this.queue = [];
    this.travel = null;
    this.assets = new Map();
    for (const t of s.assets) {
      const a = this.model(t.name, t.entries);
      // One pass through the timeline: it keeps snapshots for time travel on the way.
      const r = a.timeline.docAt(a.tape, a.tape.length);
      if (r.problem) {
        this.advance(a, a.tape.length);
      } else {
        a.cursor = TapeCursor.resume(this.source, r.doc, a.tape);
      }
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
    // People's edits that queued behind a batch still play at once when their turn comes.
    for (const a of this.assets.values()) {
      while (this.pending(a) > 0 && !a.problem && isHuman(a.tape[a.cursor.done.length]!.by)) this.advance(a, 1);
    }
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
      // At most as many commands per frame as the speed asks of a 60 Hz display (one, up to 60/s),
      // so a slow frame delays playback rather than skipping a command you were meant to see.
      const most = Math.max(1, Math.ceil(this.speed / 60));
      const n = Math.min(Math.floor(this.budget), most);
      this.budget = Math.min(this.budget - n, most);
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

  /** Show every received command at once (before an edit, so the person edits what is there). */
  catchUp(): void {
    const a = this.current;
    if (a && this.pending(a) > 0) {
      this.advance(a, this.pending(a));
      this.queue = this.queue.filter((n) => n !== a.name);
      this.changed();
    }
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
      this.travelCache = { key, doc: a.timeline.docAfter(a.tape, this.travel).doc };
    }
    return { doc: this.travelCache.doc, seq: this.travel };
  }

  // --- checks and previews

  /** Every asset's live document, with what it was forked from. */
  assetDocs(): AssetDoc[] {
    const out: AssetDoc[] = [];
    for (const a of this.assets.values()) {
      if (!a.cursor.doc) continue;
      const fork = a.tape.map((e) => /^fork (\S+) \S+ at=\d+$/.exec(e.cmd)).find(Boolean);
      out.push({ name: a.name, doc: a.cursor.doc, forkOf: fork?.[1] ?? null });
    }
    return out;
  }

  /** The preview theme chosen, as a theme (null: role entries in their own colours). */
  themeObj(): Theme | null {
    return this.theme ? this.themes.find((t) => t.name === this.theme) ?? null : null;
  }

  setTheme(name: string | null): void {
    this.theme = name;
    this.changed();
  }

  /**
   * The checks of the shown document over every frame, with the project's style guide (the same
   * answers the agent's `check` gets). Kept until the document, the other assets or the style
   * change. On large canvases only the frame shown is checked (as in the agent's run summary), and
   * while commands play they are worked out again at most twice a second.
   */
  checksFor(doc: Doc, frame: number): CheckResult[] {
    const a = this.current;
    if (!a) return [];
    let total = 0;
    for (const x of this.assets.values()) total += x.cursor.done.length;
    const large = doc.width * doc.height * doc.frameCount > CHECK_BUDGET;
    const key = `${a.name}:${this.travel}:${a.cursor.done.length}:${large ? frame : ''}:${total}:${this.styleVersion}`;
    if (this.checkCache?.key !== key) {
      const now = performance.now();
      const busy = this.pending(a) > 0 && this.checkCache?.asset === a.name;
      if (large && busy && now - this.checkCache!.at < 500) return this.checkCache!.results;
      const { ctx } = checkContextFor(a.name, doc, this.assetDocs(), this.style, (n) => this.palettes.get(n));
      this.checkCache = { key, asset: a.name, at: now, results: runChecks(doc, CHECK_IDS, { ...ctx, budget: CHECK_BUDGET, focus: frame }) };
    }
    return this.checkCache.results;
  }

  /** Show or hide a check's flagged pixels; the details of the last one shown stay open. */
  toggleCheck(id: CheckId): void {
    if (this.marked.has(id)) {
      this.marked.delete(id);
      if (this.openCheck === id) this.openCheck = [...this.marked].at(-1) ?? null;
    } else {
      this.marked.add(id);
      this.openCheck = id;
    }
    this.changed();
  }

  closeChecks(): void {
    this.marked.clear();
    this.openCheck = null;
    this.changed();
  }

  private undoneCache: { tape: TapeEntry[]; n: number; set: Set<string> } | null = null;

  undoneGroups(a: AssetModel): Set<string> {
    const c = this.undoneCache;
    if (c && c.tape === a.tape && c.n === a.tape.length) return c.set;
    const active = activeGroups(a.tape);
    const set = new Set(a.tape.map((e) => e.group).filter((g) => !active.has(g)));
    this.undoneCache = { tape: a.tape, n: a.tape.length, set };
    return set;
  }
}
