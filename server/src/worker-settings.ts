// The worker's settings: project.json `worker`, read fresh each time
// (a person turns it on by editing the file). Off by default: a worker spends money.
//
//   "worker": {
//     "enabled": false,           the Start Claude button and `pixelclaw work` run only when true
//     "command": ["claude"],      the Claude Code CLI (a fake stands in for it in tests)
//     "args": [],                 more arguments for it: only --model, --fallback-model, --effort
//     "cap": 5,                   US dollars the worker may spend in all, over every run (worker-spend.jsonl)
//     "maxSessions": 10,          sessions a run may start
//     "stall": 10                 minutes without a tool call before a session is stopped
//   }

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface WorkerSettings {
  enabled: boolean;
  command: string[];
  args: string[];
  cap: number;
  maxSessions: number;
  /** Minutes without a tool call before the watchdog stops a session. */
  stall: number;
}

export const WORKER_DEFAULTS: WorkerSettings = { enabled: false, command: ['claude'], args: [], cap: 5, maxSessions: 10, stall: 10 };

/** The only options `args` may hold (each with its value): none of them widens what the worker reaches. */
export const WORKER_ARG_OPTIONS = ['--model', '--fallback-model', '--effort'] as const;

/**
 * Claude Code options that would widen what the worker reaches (tools, permissions, directories,
 * MCP servers, settings, plugins, agents, other sessions): refused in `command` as well as `args`,
 * so no setting can undo the worker's own flags.
 */
const WIDENING = [
  '--tools', '--allowedTools', '--allowed-tools', '--disallowedTools', '--disallowed-tools', '--permission-mode', '--permission-prompt-tool',
  '--permission-prompts', '--dangerously-skip-permissions', '--allow-dangerously-skip-permissions', '--add-dir', '--mcp-config', '--strict-mcp-config',
  '--settings', '--setting-sources', '--plugin-dir', '--plugin-url', '--agents', '--agent', '--chrome', '--ide', '--system-prompt',
  '--system-prompt-file', '--append-system-prompt', '--append-system-prompt-file', '--resume', '-r', '--continue', '-c', '--fork-session',
  '--worktree', '-w', '--file', '--bare', '--safe-mode', '--restricted', '--remote-control', '--cloud', '--bg', '--background',
];

/** Why these settings may not start a worker (null: they may). */
export function workerSettingsProblem(s: WorkerSettings): string | null {
  for (let i = 0; i < s.args.length; i++) {
    const a = s.args[i]!;
    const [flag, inline] = a.startsWith('--') && a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined];
    if (!(WORKER_ARG_OPTIONS as readonly string[]).includes(flag)) {
      return `worker.args may hold only ${WORKER_ARG_OPTIONS.join(', ')} with a value (not '${a}'): the worker's tools and reach are fixed (docs/worker.md)`;
    }
    if (inline === undefined) {
      const v = s.args[i + 1];
      if (v === undefined || v.startsWith('-')) return `worker.args: ${flag} needs a value`;
      i++;
    } else if (!inline) return `worker.args: ${flag} needs a value`;
  }
  for (const a of s.command.slice(1)) {
    const flag = a.startsWith('-') && a.includes('=') ? a.slice(0, a.indexOf('=')) : a;
    if (WIDENING.includes(flag)) return `worker.command may not pass ${flag}: the worker's tools and reach are fixed (docs/worker.md)`;
  }
  return null;
}

export function workerSettings(dir: string): WorkerSettings {
  let w: Record<string, unknown> = {};
  try {
    const j = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')) as { worker?: Record<string, unknown> };
    if (j.worker && typeof j.worker === 'object') w = j.worker;
  } catch {
    // no project.json: the defaults
  }
  const strs = (v: unknown, d: string[]) => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : d);
  const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : d);
  const command = strs(w.command, WORKER_DEFAULTS.command);
  return {
    enabled: w.enabled === true,
    command: command.length ? command : WORKER_DEFAULTS.command,
    args: strs(w.args, []),
    cap: num(w.cap, WORKER_DEFAULTS.cap, 0, 1000),
    maxSessions: Math.floor(num(w.maxSessions, WORKER_DEFAULTS.maxSessions, 1, 100)),
    stall: num(w.stall, WORKER_DEFAULTS.stall, 0.001, 240),
  };
}

/** The project's spend ledger: one line per session, over every run (the cap is their total). */
export const WORKER_SPEND = 'worker-spend.jsonl';

/** One line of the spend ledger. */
export interface SpendRecord {
  at: string;
  /** The run (when it started) and its session. */
  run: string;
  session: number;
  cost: number;
  /** The session reported no cost (stopped by the watchdog, crashed): an upper-bound estimate from its token counts. */
  estimated?: true;
}

export function readSpend(dir: string): SpendRecord[] {
  try {
    return readFileSync(join(dir, WORKER_SPEND), 'utf8').split('\n').filter(Boolean).flatMap((l) => {
      try {
        const r = JSON.parse(l) as SpendRecord;
        return typeof r.cost === 'number' && Number.isFinite(r.cost) && r.cost >= 0 ? [r] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

/** What the worker has spent on this project, over every run (US dollars). */
export function workerSpent(dir: string): number {
  return Math.round(readSpend(dir).reduce((a, r) => a + r.cost, 0) * 1e6) / 1e6;
}

