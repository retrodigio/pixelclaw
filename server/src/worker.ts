// The headless worker (plan §21 item 2): a Claude Code session started without a person at the
// keyboard (`claude -p`), connected to this server's MCP endpoint (HTTP, with the watch token) and
// given the shipped skill, that works the request queue until it is empty or the budget cap is
// reached. It runs only when project.json `worker.enabled` is true, never twice for one project
// (a lock file beside the project's, and one per server), and stops at the cap: each session gets
// what is left of it (`--max-budget-usd`), and the run stops once the sessions' reported costs
// reach it. Its log (logs/worker.log) goes to the dashboard line by line.

import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRequests } from '@pixelclaw/core';
import { ProjectError, alive } from './project.ts';
import { readRequests } from './requests.ts';
import { workerSettings } from './worker-settings.ts';
import type { Writer } from './writer.ts';

export const WORKER_LOCK = '.pixelclaw-worker.lock';
export const WORKER_LOG = join('logs', 'worker.log');
/** The author the worker's MCP batches are written with (the MCP server's). */
const AGENT = 'claude';

/** The shipped skill's text: skill/SKILL.md in the repo, or beside the bundle. */
export function skillText(): string {
  const here = fileURLToPath(new URL('.', import.meta.url));
  for (const f of [join(here, 'skill', 'SKILL.md'), join(here, '..', '..', 'skill', 'SKILL.md')]) if (existsSync(f)) return readFileSync(f, 'utf8');
  return '';
}

export const WORKER_PROMPT = (dir: string) => `You are PixelClaw's worker for the project at ${dir}. People asked for work in its dashboard; nobody reads this chat, so do not ask questions here.

Follow the PixelClaw skill (in your instructions). Loop:
1. Call the \`work\` tool: it claims the next open request and says what is asked (draw a planned asset, change a drawn one, or a new asset).
2. Do it with the PixelClaw tools (plan, run, view, check, changes, ...), to the skill's house rules. Post a short \`work\` progress note when a step is done.
3. Finish it: \`work\` with action "done" and what changed, or action "blocked" with one clear question for the person when you cannot go on without them.
4. Call \`work\` again. Stop when it says there are no open requests.`;

/** The worker's command line for one session (the program, then its arguments). */
export function workerArgs(o: { command: string[]; args: string[]; dir: string; mcpConfig: string; budget: number; skill: string }): string[] {
  return [
    ...o.command,
    '-p', WORKER_PROMPT(o.dir),
    '--output-format', 'stream-json', '--verbose',
    '--mcp-config', o.mcpConfig, '--strict-mcp-config',
    '--allowedTools', 'mcp__pixelclaw',
    '--max-budget-usd', o.budget.toFixed(2),
    ...(o.skill ? ['--append-system-prompt', o.skill] : []),
    ...o.args,
  ];
}

interface LockInfo { pid: number; by: string; startedAt: string }

export function workerLockHolder(dir: string): LockInfo | null {
  try {
    const info = JSON.parse(readFileSync(join(dir, WORKER_LOCK), 'utf8')) as LockInfo;
    return alive(info.pid) ? info : null;
  } catch {
    return null;
  }
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const money = (n: number) => `$${n.toFixed(2)}`;

/** One stream-json line from `claude -p` as a log line (null: nothing worth showing). */
export function describeStreamLine(line: string): { text: string | null; cost?: number } {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return { text: line.trim() ? cut(line.trim(), 300) : null };
  }
  if (j.type === 'system' && j.subtype === 'init') return { text: `session started${typeof j.model === 'string' ? ` (${j.model})` : ''}` };
  if (j.type === 'assistant') {
    const content = ((j.message as { content?: unknown[] } | undefined)?.content ?? []) as { type: string; text?: string; name?: string; input?: unknown }[];
    const parts = content.flatMap((c) => (c.type === 'text' && c.text?.trim() ? [`claude: ${cut(c.text.trim().replace(/\s+/g, ' '), 300)}`]
      : c.type === 'tool_use' ? [`→ ${String(c.name).replace(/^mcp__pixelclaw__/, '')} ${cut(JSON.stringify(c.input ?? {}), 160)}`] : []));
    return { text: parts.length ? parts.join('\n') : null };
  }
  if (j.type === 'user') {
    const content = ((j.message as { content?: unknown[] } | undefined)?.content ?? []) as { type: string; is_error?: boolean; content?: unknown }[];
    const errs = content.filter((c) => c.type === 'tool_result' && c.is_error);
    return { text: errs.length ? `← error: ${cut(JSON.stringify(errs[0]!.content), 200)}` : null };
  }
  if (j.type === 'result') {
    const cost = typeof j.total_cost_usd === 'number' ? j.total_cost_usd : undefined;
    return { text: `session ended (${String(j.subtype ?? 'done')}${typeof j.num_turns === 'number' ? `, ${j.num_turns} turns` : ''}${cost !== undefined ? `, ${money(cost)}` : ''})`, ...(cost !== undefined ? { cost } : {}) };
  }
  return { text: null };
}

export interface WorkerEndpoint {
  /** The server's MCP endpoint (http://127.0.0.1:<port>/mcp) and its token. */
  url: string;
  token: string;
}

/**
 * Runs and stops the worker for the writer's project. One per server; `start` refuses when the
 * worker is not enabled, when one is running here, or when another process holds the lock.
 */
export class WorkerControl {
  private child: ChildProcess | null = null;
  private stopping: string | null = null;
  private run: Promise<string> | null = null;

  private readonly w: Writer;
  private readonly endpoint: () => WorkerEndpoint;

  constructor(w: Writer, endpoint: () => WorkerEndpoint) {
    this.w = w;
    this.endpoint = endpoint;
  }

  running(): boolean {
    return this.run !== null;
  }

  private log(lines: string[]): void {
    const at = this.w.stamp();
    const out = lines.flatMap((l) => l.split('\n')).map((l) => `${at} ${l}`);
    try {
      mkdirSync(join(this.w.project.dir, 'logs'), { recursive: true });
      appendFileSync(join(this.w.project.dir, WORKER_LOG), out.join('\n') + '\n');
    } catch {
      // a read-only project: the dashboard still gets the lines
    }
    this.w.workerLog(out);
  }

  /** Start a run; resolves with why it stopped. Throws a ProjectError when it may not start. */
  start(by: string): Promise<string> {
    const dir = this.w.project.dir;
    const s = workerSettings(dir);
    if (!s.enabled) throw new ProjectError('the worker is off for this project: set "worker": { "enabled": true } in project.json (it runs Claude Code headless and spends money; see docs/worker.md)');
    if (this.run) throw new ProjectError('a worker is already running for this project');
    const held = workerLockHolder(dir);
    if (held) throw new ProjectError(`a worker is already running for this project (pid ${held.pid}, started by ${held.by} at ${held.startedAt})`);
    const startedAt = this.w.stamp();
    writeFileSync(join(dir, WORKER_LOCK), JSON.stringify({ pid: process.pid, by, startedAt }) + '\n');
    this.stopping = null;
    this.w.setWorker({ running: true, by, startedAt, spent: 0, cap: s.cap, sessions: 0, stopped: null });
    this.run = this.loop(by).finally(() => {
      rmSync(join(dir, WORKER_LOCK), { force: true });
      this.run = null;
      this.child = null;
    });
    return this.run;
  }

  /** Stop the run (the session in progress is ended). */
  stop(by: string): void {
    if (!this.run) throw new ProjectError('no worker is running');
    this.stopping = `stopped by ${by}`;
    this.child?.kill('SIGTERM');
  }

  /** Wait for the run in progress, if any. */
  async settled(): Promise<void> {
    await this.run?.catch(() => undefined);
  }

  private async loop(by: string): Promise<string> {
    const dir = this.w.project.dir;
    const s = workerSettings(dir);
    let spent = 0, sessions = 0;
    let why = '';
    this.log([`run started by ${by}: cap ${money(s.cap)}, at most ${s.maxSessions} sessions, command ${s.command.join(' ')}`]);
    const pending = () => openRequests(readRequests(this.w.project)).filter((q) => q.state === 'open' || (q.state === 'claimed' && q.claimedBy === AGENT));
    const stamp = () => JSON.stringify([...readRequests(this.w.project).values()].map((q) => [q.id, q.state, q.events.length]));
    for (;;) {
      if (this.stopping) { why = this.stopping; break; }
      if (!pending().length) { why = 'the queue is empty'; break; }
      if (spent >= s.cap - 0.005) { why = `the budget cap was reached (${money(spent)} of ${money(s.cap)})`; break; }
      if (sessions >= s.maxSessions) { why = `the session limit was reached (${s.maxSessions})`; break; }
      const before = stamp();
      sessions++;
      const budget = s.cap - spent;
      this.w.setWorker({ sessions });
      this.log([`session ${sessions}: budget ${money(budget)}; ${pending().length} request${pending().length === 1 ? '' : 's'} waiting`]);
      const cost = await this.session(s.command, s.args, budget);
      if (cost === null) {
        // No cost reported (it crashed or was stopped): count what was left as spent, to be safe.
        spent = s.cap;
        this.w.setWorker({ spent });
        why = this.stopping ?? 'a session ended without reporting its cost; stopping (the rest of the cap is counted as spent)';
        break;
      }
      spent += Math.min(cost, budget);
      this.w.setWorker({ spent });
      this.log([`session ${sessions}: ${money(cost)}; ${money(spent)} of ${money(s.cap)} spent`]);
      if (this.stopping) { why = this.stopping; break; }
      if (spent >= s.cap - 0.005) continue; // the top of the loop says so
      if (stamp() === before) { why = 'a session left the queue as it was; stopping'; break; }
    }
    this.log([`run stopped: ${why}`]);
    this.w.setWorker({ running: false, stopped: why });
    return why;
  }

  /** One `claude -p` session; resolves with its reported cost (null: none reported). */
  private session(command: string[], args: string[], budget: number): Promise<number | null> {
    const dir = this.w.project.dir;
    const ep = this.endpoint();
    // The MCP config holds the token: a private temporary file, removed after.
    const tmp = mkdtempSync(join(tmpdir(), 'pixelclaw-worker-'));
    const cfg = join(tmp, 'mcp.json');
    writeFileSync(cfg, JSON.stringify({ mcpServers: { pixelclaw: { type: 'http', url: ep.url, headers: { Authorization: `Bearer ${ep.token}` } } } }), { mode: 0o600 });
    chmodSync(cfg, 0o600);
    const argv = workerArgs({ command, args, dir, mcpConfig: cfg, budget, skill: skillText() });
    return new Promise((resolve) => {
      let cost: number | null = null;
      let buf = '';
      const child = spawn(argv[0]!, argv.slice(1), { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
      this.child = child;
      const line = (l: string) => {
        const d = describeStreamLine(l);
        if (d.cost !== undefined) cost = d.cost;
        if (d.text) this.log([d.text]);
      };
      child.stdout!.setEncoding('utf8').on('data', (d: string) => {
        buf += d;
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) { line(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
      });
      child.stderr!.setEncoding('utf8').on('data', (d: string) => { for (const l of d.split('\n')) if (l.trim()) this.log([`stderr: ${cut(l.trim(), 300)}`]); });
      let finished = false;
      const done = (code: number | null, err?: Error) => {
        if (finished) return;
        finished = true;
        if (buf.trim()) line(buf);
        buf = '';
        if (err) this.log([`could not start ${argv[0]}: ${err.message}`]);
        else if (code) this.log([`${argv[0]} exited with ${code}`]);
        rmSync(tmp, { recursive: true, force: true });
        resolve(cost);
      };
      child.on('error', (e) => done(null, e));
      child.on('close', (code) => done(code));
    });
  }
}

/** The last lines of the worker's log. */
export function workerLogTail(dir: string, n = 200): string[] {
  try {
    const lines = readFileSync(join(dir, WORKER_LOG), 'utf8').split('\n').filter(Boolean);
    return lines.slice(-n);
  } catch {
    return [];
  }
}
