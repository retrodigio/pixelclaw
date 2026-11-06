// Messages between the server and the watch view (WebSocket, JSON). Types only, so the UI can
// import them without pulling in any Node code.

import type { Presence } from './await.ts';

export type { Presence };
import type { Diag, ManifestAsset, ManifestError, Palette, Status, StyleJson, TapeEntry, Theme, WorkRequest } from '@pixelclaw/core';

export interface AssetTape {
  name: string;
  entries: TapeEntry[];
}

/** The last image view returned to the agent ("Claude's eye"). */
export interface Eye {
  asset: string;
  mode: string;
  /** The PNG, base64. */
  png: string;
  width: number;
  height: number;
  path: string;
  at: string;
}

/** Everything a page needs to start: sent on connect, and again when the project changes. */
export interface Snapshot {
  project: { name: string; dir: string; /** The server user's home folder, so the dashboard can show the folder as ~/…. */ home?: string; /** Game ticks per second (frame durations are in ticks). */ tickRate?: number; /** The project's grid (cell size in px). */ grid?: number };
  palettes: Palette[];
  defaultPalette: string | null;
  /** The style guide's check and preview settings (project.json `style`). */
  style: StyleJson;
  /** Preview themes for role art: built in, then the project's. */
  themes: Theme[];
  assets: AssetTape[];
  /** The asset written most recently, if any. */
  live: string | null;
  eye: Eye | null;
  /** The headless worker (\`pixelclaw work\`): whether it may run, and whether it is running. */
  worker: WorkerStatus;
  /** Who is listening for requests; later changes arrive as `presence` messages. */
  presence?: Presence;
}

/** What a person can ask from the dashboard. */
export type PersonRequest =
  | { action: 'request'; kind: 'draw'; asset: string; note?: string }
  | { action: 'request'; kind: 'change'; asset: string; note: string }
  | { action: 'request'; kind: 'new'; entry: ManifestAsset; note?: string }
  | { action: 'reply'; id: string; text: string }
  | { action: 'cancel'; id: string; text?: string };

export interface WorkerStatus {
  /** project.json \`worker.enabled\`: the Start Claude button shows only when true. */
  enabled: boolean;
  running: boolean;
  /** Who started it (a person, or the CLI), and when. */
  by: string | null;
  startedAt: string | null;
  /** Spent on this project so far, over every run (worker-spend.jsonl), and the cap (US dollars). */
  spent: number;
  cap: number;
  sessions: number;
  /** Why the last run stopped. */
  stopped: string | null;
}

export type ServerMessage =
  | { type: 'hello'; snapshot: Snapshot }
  /**
   * One applied batch (one undo group). With reset, `entries` is the asset's whole tape (the
   * tape was started again); otherwise they follow the entries the page already has.
   */
  | { type: 'batch'; asset: string; by: string; group: string; entries: TapeEntry[]; changed: number; reset: boolean }
  | { type: 'eye'; eye: Eye }
  /** project.json's style guide or themes changed. */
  | { type: 'style'; style: StyleJson; themes: Theme[] }
  /** Palettes were added to the project. */
  | { type: 'palettes'; palettes: Palette[]; defaultPalette: string | null }
  /** The answer to one page's `run` (only to that page; the batch itself goes to every page). */
  | { type: 'result'; id: number; ok: true; asset: string; group: string | null; seq: number | null }
  | { type: 'result'; id: number; ok: false; errors: Diag[] }
  | { type: 'pong' }
  /** requests.jsonl changed: every request as it stands. */
  | { type: 'requests'; requests: WorkRequest[] }
  | { type: 'worker'; status: WorkerStatus }
  /** Who is listening for requests (sent on connect and whenever it changes). */
  | { type: 'presence'; presence: Presence }
  /** New lines of the worker's log. */
  | { type: 'workerLog'; lines: string[] }
  /** The answer to a page's request or worker message (only to that page). */
  | { type: 'answer'; id: number; ok: boolean; error?: string; request?: WorkRequest }
  /** The plan changed outside a batch (the manifest was written, assets were exported): the dashboard reloads it. */
  | { type: 'plan' };

/** Authors a page may write as: `human:<name>`. */
export const HUMAN_RE = /^human:[A-Za-z0-9_.-]{1,32}$/;

export type ClientMessage =
  | { type: 'ping' }
  /** Commands from a person: applied by the single writer as one undo group, written `by`. */
  | { type: 'run'; id: number; asset: string; commands: string; by: string }
  /** A request, a reply or a cancel from the dashboard, written \`by\`. */
  | { type: 'request'; id: number; by: string; body: PersonRequest }
  /** Start or stop the headless worker (only when project.json worker.enabled). */
  | { type: 'worker'; id: number; by: string; action: 'start' | 'stop' };

// The plan, as the dashboard and the MCP `plan` tool show it.

export interface ExportRecord {
  profile: string;
  /** The folder, relative to the project when it is inside it. */
  dir: string;
  at: string;
  /** The art's hash when it was exported: a later change makes the export stale. */
  art: string;
}

export interface PlanAsset {
  name: string;
  kind: string;
  size: string;
  set: string;
  description: string;
  status: Status;
  next: string;
  flags: string[];
  /** In the manifest (false: an asset the manifest does not plan). */
  planned: boolean;
  exists: boolean;
  /** Failing checks (ids), and every check's line. */
  failing: string[];
  checks: { id: string; status: string; shown: string }[];
  /** The judge's current answers (null when the judge is off for the project or the asset is not drawn). Advisory unless `gate`. */
  judge: PlanJudge | null;
  notes: number;
  /** The tape's last command, when it was written and by whom. */
  seq: number | null;
  at: string | null;
  by: string | null;
  exported: ExportRecord | null;
  /** The document's canvas (0 when not drawn), its frames and their ticks (animated: more than one frame). */
  width: number;
  height: number;
  frames: number;
  ticks: number[];
  /** The assets it draws from (a map's) and the maps that draw it. */
  uses: string[];
  usedBy: string[];
  /** The scenes that need it. */
  scenes: string[];
}

export interface PlanJudge {
  gate: boolean;
  model: string;
  findings: { id: string; label: string; status: string; p: number | null; expect: string; yes: number; no: number; detail: string }[];
  /** Questions that apply but have no current answer. */
  notAsked: number;
  /** The last request failed (nothing since has answered). */
  error: string | null;
}

export interface PlanScene {
  name: string;
  description: string;
  map: string | null;
  needs: string[];
  /** Not drawn yet; drawn with failing checks. */
  missing: string[];
  unfinished: string[];
}

export interface PlanReport {
  project: string;
  theme: string | null;
  manifest: { exists: boolean; errors: ManifestError[] };
  sets: { name: string; description: string; assets: string[] }[];
  assets: PlanAsset[];
  counts: Record<Status, number>;
  scenes: PlanScene[];
  /** Every request from requests.jsonl, as it stands. */
  requests: WorkRequest[];
}

