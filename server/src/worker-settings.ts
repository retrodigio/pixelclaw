// The worker's settings (plan §21 item 2): project.json `worker`, read fresh each time (a person
// turns it on by editing the file). Off by default: a worker spends money.
//
//   "worker": {
//     "enabled": false,           the Start Claude button and `pixelclaw work` run only when true
//     "command": ["claude"],      the Claude Code CLI (a fake stands in for it in tests)
//     "args": [],                 more arguments for it (e.g. ["--model", "sonnet"])
//     "cap": 5,                   US dollars a run may spend, over all its sessions
//     "maxSessions": 10           sessions a run may start
//   }

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface WorkerSettings {
  enabled: boolean;
  command: string[];
  args: string[];
  cap: number;
  maxSessions: number;
}

export const WORKER_DEFAULTS: WorkerSettings = { enabled: false, command: ['claude'], args: [], cap: 5, maxSessions: 10 };

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
  };
}
