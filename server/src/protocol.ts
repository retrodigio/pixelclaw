// Messages between the server and the watch view (WebSocket, JSON). Types only, so the UI can
// import them without pulling in any Node code.

import type { Diag, Palette, StyleJson, TapeEntry, Theme } from '@pixelclaw/core';

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
  project: { name: string; dir: string; /** Game ticks per second (frame durations are in ticks). */ tickRate?: number };
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
  | { type: 'pong' };

/** Authors a page may write as: `human:<name>`. */
export const HUMAN_RE = /^human:[A-Za-z0-9_.-]{1,32}$/;

export type ClientMessage =
  | { type: 'ping' }
  /** Commands from a person: applied by the single writer as one undo group, written `by`. */
  | { type: 'run'; id: number; asset: string; commands: string; by: string };
