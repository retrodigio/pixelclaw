// The headless worker: a Claude Code session started without a person at the
// keyboard (`claude -p`), connected to this server's MCP endpoint (HTTP, with the watch token) and
// given the shipped skill, that works the request queue until it is empty or the budget cap is
// reached. It runs only when project.json `worker.enabled` is true, never twice for one project
// (a lock file beside the project's, and one per server), and stops at the cap: the cap is a total
// over every run (worker-spend.jsonl), each session gets what is left of it
// (`--max-budget-usd`), and a run stops once the sessions' costs reach it. Its log
// (logs/worker.log) goes to the dashboard line by line.
//
// The session has no built-in tool at all (no shell, no file reads or writes, no web, no
// subagents): only the PixelClaw MCP tools, over a connection with its own token that the server
// confines to the project folder (mcp.ts). A watchdog stops a session that makes no tool call for
// `stall` minutes, resumes it once, and blocks its request if it stalls again.

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandReference, openRequests } from '@pixelclaw/core';
import { ProjectError, alive } from './project.ts';
import { appendRequest, readRequests } from './requests.ts';
import { WORKER_SPEND, workerSettings, workerSettingsProblem, workerSpent, type SpendRecord } from './worker-settings.ts';
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

You have only the PixelClaw tools (no shell, no files, no web): everything you need is in them and in your instructions, which end with every command of the language.

Follow the PixelClaw skill (in your instructions). Loop:
1. Call the \`work\` tool: it claims the next open request and says what is asked (draw a planned asset, change a drawn one, or a new asset).
2. Do it with the PixelClaw tools (plan, run, view, check, changes, ...), to the skill's house rules. Post a short \`work\` progress note when a step is done.
3. Finish it: \`work\` with action "done" and what changed (refused while the asset fails a check: fix what the reply lists), or action "blocked" with one clear question for the person when you cannot go on without them.
4. Call \`work\` again. Stop when it says there are no open requests.`;

/** What a resumed session is told (after the watchdog stopped it). */
export const RESUME_PROMPT = (minutes: number) => `You made no tool call for ${minutes} minute${minutes === 1 ? '' : 's'}, so the session was stopped and resumed. Carry on with the request you claimed: call a PixelClaw tool now. Finish it with work(action="done") or, if you are stuck, work(action="blocked") with one clear question.`;

/**
 * Every built-in Claude Code tool, denied by name (`--tools ""` already leaves the session none;
 * this is the second lock, and covers older names).
 */
export const BUILTIN_TOOLS = [
  'Bash', 'BashOutput', 'KillShell', 'KillBash', 'PowerShell', 'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'NotebookRead', 'Glob', 'Grep', 'LS',
  'WebFetch', 'WebSearch', 'Task', 'Agent', 'TaskOutput', 'TaskStop', 'TodoWrite', 'Skill', 'SlashCommand', 'ToolSearch', 'ExitPlanMode', 'EnterPlanMode',
  'EnterWorktree', 'ExitWorktree', 'Monitor', 'Workflow', 'CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup', 'SendMessage', 'ListAgents',
  'RemoteTrigger', 'PushNotification', 'ListMcpResourcesTool', 'ReadMcpResourceTool', 'AskUserQuestion', 'ReportFindings',
];

/**
 * The flags that fence the session in (docs/worker.md says what each does):
 * no built-in tools, each of them denied by name as well, the PixelClaw MCP tools pre-approved and
 * nothing else allowed (dontAsk: what is not pre-approved is refused, never asked), only the
 * user's own settings (not the project folder's .claude settings or CLAUDE.md files, nor its
 * parents'), and only the MCP server in --mcp-config.
 */
export const SANDBOX_FLAGS = [
  '--tools', '',
  '--disallowedTools', BUILTIN_TOOLS.join(','),
  '--allowedTools', 'mcp__pixelclaw',
  '--permission-mode', 'dontAsk',
  '--setting-sources', 'user',
  '--strict-mcp-config',
] as const;

/** The worker's system prompt: the skill, then every command of the language. */
export function workerSystemPrompt(skill: string): string {
  return `${skill ? `${skill.trim()}\n\n` : ''}# Every PixelClaw command\n\nOne line each, from the editor itself (the MCP server's instructions explain them; this is the full list):\n\n${commandReference()}\n`;
}

/** The worker's command line for one session (the program, then its arguments). */
export function workerArgs(o: { command: string[]; args: string[]; dir: string; mcpConfig: string; budget: number; skill: string; resume?: { session: string; minutes: number } }): string[] {
  return [
    ...o.command,
    '-p', o.resume ? RESUME_PROMPT(o.resume.minutes) : WORKER_PROMPT(o.dir),
    ...(o.resume ? ['--resume', o.resume.session] : []),
    '--output-format', 'stream-json', '--verbose',
    '--mcp-config', o.mcpConfig,
    ...SANDBOX_FLAGS,
    '--max-budget-usd', o.budget.toFixed(2),
    '--append-system-prompt', workerSystemPrompt(o.skill),
    ...o.args,
  ];
}

/**
 * Prices per million tokens used to estimate a session that reported no cost: the dearest Claude
 * rates Claude Code has run on (input, cache writes, cache reads, output), so the estimate is an
 * upper bound and the cap is never overrun by guessing low.
 */
export const ESTIMATE_PRICES = { input: 15, cacheWrite: 18.75, cacheRead: 1.5, output: 75 };

interface Usage { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }

export function usageEstimate(u: Usage): number {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  return (n(u.input_tokens) * ESTIMATE_PRICES.input + n(u.cache_creation_input_tokens) * ESTIMATE_PRICES.cacheWrite
    + n(u.cache_read_input_tokens) * ESTIMATE_PRICES.cacheRead + n(u.output_tokens) * ESTIMATE_PRICES.output) / 1e6;
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
export function describeStreamLine(line: string): { text: string | null; cost?: number; tool?: true; session?: string; usage?: { id: string; usage: Usage } } {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return { text: line.trim() ? cut(line.trim(), 300) : null };
  }
  if (j.type === 'system' && j.subtype === 'init') {
    const tools = Array.isArray(j.tools) ? (j.tools as unknown[]).map(String) : null;
    const others = tools?.filter((t) => !t.startsWith('mcp__pixelclaw__')) ?? [];
    return {
      text: `session started${typeof j.model === 'string' ? ` (${j.model})` : ''}${tools ? `; tools: ${tools.length - others.length} PixelClaw${others.length ? `, and ${others.join(', ')}` : ', nothing else'}` : ''}`,
      ...(typeof j.session_id === 'string' ? { session: j.session_id } : {}),
    };
  }
  if (j.type === 'assistant') {
    const message = (j.message ?? {}) as { id?: string; content?: unknown[]; usage?: Usage };
    const content = (message.content ?? []) as { type: string; text?: string; name?: string; input?: unknown }[];
    const parts = content.flatMap((c) => (c.type === 'text' && c.text?.trim() ? [`claude: ${cut(c.text.trim().replace(/\s+/g, ' '), 300)}`]
      : c.type === 'tool_use' ? [`→ ${String(c.name).replace(/^mcp__pixelclaw__/, '')} ${cut(JSON.stringify(c.input ?? {}), 160)}`] : []));
    return {
      text: parts.length ? parts.join('\n') : null,
      ...(content.some((c) => c.type === 'tool_use') ? { tool: true as const } : {}),
      ...(message.usage ? { usage: { id: message.id ?? `line:${line.length}:${line.slice(0, 40)}`, usage: message.usage } } : {}),
    };
  }
  if (j.type === 'user') {
    const content = ((j.message as { content?: unknown[] } | undefined)?.content ?? []) as { type: string; is_error?: boolean; content?: unknown }[];
    const errs = content.filter((c) => c.type === 'tool_result' && c.is_error);
    return { text: errs.length ? `← error: ${cut(JSON.stringify(errs[0]!.content), 200)}` : null, ...(content.some((c) => c.type === 'tool_result') ? { tool: true as const } : {}) };
  }
  if (j.type === 'result') {
    const cost = typeof j.total_cost_usd === 'number' ? j.total_cost_usd : undefined;
    return { text: `session ended (${String(j.subtype ?? 'done')}${typeof j.num_turns === 'number' ? `, ${j.num_turns} turns` : ''}${cost !== undefined ? `, ${money(cost)}` : ''})`, ...(cost !== undefined ? { cost } : {}) };
  }
  return { text: null };
}

export interface WorkerEndpoint {
  /** The server's MCP endpoint (http://127.0.0.1:<port>/mcp). The worker connects with a token of its own (`mcpToken`). */
  url: string;
}

/** How one session ended. */
interface SessionEnd {
  /** The cost it reported (null: none). */
  cost: number | null;
  /** An upper-bound estimate from the token counts it streamed. */
  estimate: number;
  session: string | null;
  /** The watchdog stopped it. */
  stalled: boolean;
}

/**
 * Runs and stops the worker for the writer's project. One per server; `start` refuses when the
 * worker is not enabled, when one is running here, or when another process holds the lock.
 */
export class WorkerControl {
  private child: ChildProcess | null = null;
  private stopping: string | null = null;
  private run: Promise<string> | null = null;
  /** The bearer token of the running worker's MCP connection (confined to the project). */
  private token: string | null = null;

  private readonly w: Writer;
  private readonly endpoint: () => WorkerEndpoint;

  constructor(w: Writer, endpoint: () => WorkerEndpoint) {
    this.w = w;
    this.endpoint = endpoint;
  }

  running(): boolean {
    return this.run !== null;
  }

  /** The token the worker's sessions connect with (null when no worker runs): the server confines that connection. */
  mcpToken(): string | null {
    return this.token;
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
    const problem = workerSettingsProblem(s);
    if (problem) throw new ProjectError(problem);
    if (this.run) throw new ProjectError('a worker is already running for this project');
    const held = workerLockHolder(dir);
    if (held) throw new ProjectError(`a worker is already running for this project (pid ${held.pid}, started by ${held.by} at ${held.startedAt})`);
    const spent = workerSpent(dir);
    if (spent >= s.cap - 0.005) throw new ProjectError(`the worker has spent ${money(spent)} of its ${money(s.cap)} cap on this project (${WORKER_SPEND}); raise worker.cap in project.json to go on`);
    const startedAt = this.w.stamp();
    writeFileSync(join(dir, WORKER_LOCK), JSON.stringify({ pid: process.pid, by, startedAt }) + '\n');
    this.stopping = null;
    this.token = randomBytes(16).toString('hex');
    this.w.setWorker({ running: true, by, startedAt, spent, cap: s.cap, sessions: 0, stopped: null });
    this.run = this.loop(by, startedAt).finally(() => {
      rmSync(join(dir, WORKER_LOCK), { force: true });
      this.run = null;
      this.child = null;
      this.token = null;
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

  private async loop(by: string, run: string): Promise<string> {
    const dir = this.w.project.dir;
    const s = workerSettings(dir);
    let sessions = 0;
    let why = '';
    const spent = () => workerSpent(dir);
    this.log([`run started by ${by}: cap ${money(s.cap)} (${money(spent())} spent before), at most ${s.maxSessions} sessions, stall ${s.stall} min, command ${s.command.map((c) => basename(c)).join(' ')}`]);
    const pending = () => openRequests(readRequests(this.w.project)).filter((q) => q.state === 'open' || (q.state === 'claimed' && q.claimedBy === AGENT));
    const stamp = () => JSON.stringify([...readRequests(this.w.project).values()].map((q) => [q.id, q.state, q.events.length]));
    /** Write a session's cost into the ledger; false when it reported none (and the run should stop). */
    const charge = (n: number, budget: number, r: SessionEnd): boolean => {
      const cost = Math.min(r.cost ?? r.estimate, budget);
      appendFileSync(join(dir, WORKER_SPEND), JSON.stringify({ at: this.w.stamp(), run, session: n, cost: Math.round(cost * 1e6) / 1e6, ...(r.cost === null ? { estimated: true } : {}) } satisfies SpendRecord) + '\n');
      this.w.setWorker({ spent: spent() });
      this.log([`session ${n}: ${money(cost)}${r.cost === null ? ' (no cost reported: estimated from its tokens, at the dearest rates)' : ''}; ${money(spent())} of ${money(s.cap)} spent`]);
      return r.cost !== null || r.stalled;
    };
    for (;;) {
      if (this.stopping) { why = this.stopping; break; }
      if (!pending().length) { why = 'the queue is empty'; break; }
      if (spent() >= s.cap - 0.005) { why = `the budget cap was reached (${money(spent())} of ${money(s.cap)})`; break; }
      if (sessions >= s.maxSessions) { why = `the session limit was reached (${s.maxSessions})`; break; }
      const before = stamp();
      sessions++;
      let budget = s.cap - spent();
      this.w.setWorker({ sessions });
      this.log([`session ${sessions}: budget ${money(budget)}; ${pending().length} request${pending().length === 1 ? '' : 's'} waiting`]);
      let r = await this.session(s, budget);
      if (!charge(sessions, budget, r)) {
        why = this.stopping ?? 'a session ended without reporting its cost; stopping';
        break;
      }
      if (r.stalled && !this.stopping) {
        const held = () => [...readRequests(this.w.project).values()].find((q) => q.state === 'claimed' && q.claimedBy === AGENT);
        budget = s.cap - spent();
        if (r.session && budget > 0.005) {
          this.log([`session ${sessions}: no tool call for ${s.stall} min; stopped it; resuming it once`]);
          r = await this.session(s, budget, r.session);
          charge(sessions, budget, r);
        }
        const q = held();
        if (r.stalled && !this.stopping && q) {
          appendRequest(this.w.project, { type: 'blocked', id: q.id, by: AGENT, at: this.w.stamp(), text: `The worker stalled on this (no tool call for ${s.stall} min, twice): please look at ${q.asset}, then reply to open it again.` });
          this.w.requestsChanged();
          this.log([`session ${sessions}: stalled again; ${q.id} marked blocked`]);
        } else if (r.stalled && !this.stopping) this.log([`session ${sessions}: stalled again (no request claimed)`]);
      }
      if (this.stopping) { why = this.stopping; break; }
      if (spent() >= s.cap - 0.005) continue; // the top of the loop says so
      if (stamp() === before) { why = 'a session left the queue as it was; stopping'; break; }
    }
    this.log([`run stopped: ${why}`]);
    this.w.setWorker({ running: false, stopped: why });
    return why;
  }

  /** One `claude -p` session (or a resumed one); resolves with how it ended. */
  private session(s: ReturnType<typeof workerSettings>, budget: number, resume?: string): Promise<SessionEnd> {
    const dir = this.w.project.dir;
    const ep = this.endpoint();
    // The MCP config holds the worker's token: a private temporary file, removed after.
    const tmp = mkdtempSync(join(tmpdir(), 'pixelclaw-worker-'));
    const cfg = join(tmp, 'mcp.json');
    writeFileSync(cfg, JSON.stringify({ mcpServers: { pixelclaw: { type: 'http', url: ep.url, headers: { Authorization: `Bearer ${this.token}` } } } }), { mode: 0o600 });
    chmodSync(cfg, 0o600);
    const argv = workerArgs({ command: s.command, args: s.args, dir, mcpConfig: cfg, budget, skill: skillText(), ...(resume ? { resume: { session: resume, minutes: s.stall } } : {}) });
    const stallMs = s.stall * 60_000;
    return new Promise((resolve) => {
      let cost: number | null = null, session: string | null = resume ?? null, stalled = false;
      const usage = new Map<string, Usage>();
      let buf = '';
      let last = Date.now();
      const child = spawn(argv[0]!, argv.slice(1), { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
      this.child = child;
      const watchdog = setInterval(() => {
        if (Date.now() - last <= stallMs || stalled) return;
        stalled = true;
        this.log([`watchdog: no tool call for ${s.stall} min; stopping the session`]);
        child.kill('SIGTERM');
        setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 5000).unref();
      }, Math.max(50, Math.min(5000, stallMs / 4)));
      const line = (l: string) => {
        const d = describeStreamLine(l);
        if (d.cost !== undefined) cost = d.cost;
        if (d.session) session = d.session;
        if (d.tool) last = Date.now();
        if (d.usage) usage.set(d.usage.id, d.usage.usage);
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
        clearInterval(watchdog);
        if (buf.trim()) line(buf);
        buf = '';
        if (err) this.log([`could not start ${argv[0]}: ${err.message}`]);
        else if (code && !stalled) this.log([`${argv[0]} exited with ${code}`]);
        rmSync(tmp, { recursive: true, force: true });
        resolve({ cost: stalled ? null : cost, estimate: [...usage.values()].reduce((a, u) => a + usageEstimate(u), 0), session, stalled });
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
