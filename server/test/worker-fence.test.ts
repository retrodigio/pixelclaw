// The worker's fence: `pixelclaw work` starts `claude` from the PATH with no built-in tools (a fake
// records its arguments; the flags are checked against the installed Claude Code's own help, and the
// real Claude Code is run against a fake model API that asks for a shell, files and the web);
// settings cannot widen it; its MCP connection is fenced to the project.

import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { COMMANDS, commandReference, encodePng, createRgba, flatten, layoutOf } from '@pixelclaw/core';
import { serve, type Served } from '../src/serve.ts';
import { BUILTIN_TOOLS, SANDBOX_FLAGS, WORKER_SPEND, Writer, loadProject, readRequestRecords, readSpend, workerSettings, workerSettingsProblem, workerSpent } from '../src/index.ts';
import { BIN, PALETTE, texts, until, type Content } from './spawn.ts';
import { fakeModelEnv, startFakeModel } from './fake-model-api.ts';

const FAKE = join(import.meta.dirname, 'fake-claude.ts');

const MANIFEST = {
  format: 'pixelclaw-manifest', version: 1, theme: 'Old stone under moss, lit from the top left.',
  sets: { ground: { description: 'floors' }, props: { description: 'things that stand' } },
  assets: [
    { name: 'turf', kind: 'tile', size: '24x24', set: 'ground', description: 'short moss' },
    { name: 'urn', kind: 'sprite', size: '16x16', set: 'props', height: 12, description: 'a squat stone urn' },
    { name: 'jar', kind: 'sprite', size: '16x16', set: 'props', height: 12, description: 'a clay jar' },
    { name: 'post', kind: 'sprite', size: '16x16', set: 'props', height: 14, description: 'a waymark post' },
  ],
};

/** A temporary root holding a project (with the manifest) and whatever a test puts beside it. */
function scratch(worker?: Record<string, unknown>): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), 'pixelclaw-g15-'));
  const dir = join(root, 'ruins.pclaw');
  execFileSync(process.execPath, [BIN, 'new', dir, '--palette', PALETTE]);
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(MANIFEST));
  execFileSync(process.execPath, [BIN, 'plan', dir, '--manifest', join(root, 'manifest.json')]);
  if (worker) {
    const pj = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'));
    writeFileSync(join(dir, 'project.json'), JSON.stringify({ ...pj, worker }, null, 2));
  }
  return { root, dir };
}

/** Requests to draw planned assets, as a person's records. */
function ask(dir: string, assets: string[]): void {
  const have = readRequestRecords(loadProject(dir)).filter((r) => r.type === 'request').length;
  writeFileSync(join(dir, 'requests.jsonl'), (existsSync(join(dir, 'requests.jsonl')) ? readFileSync(join(dir, 'requests.jsonl'), 'utf8') : '') +
    assets.map((a, i) => JSON.stringify({ type: 'request', id: `r${have + i + 1}`, asset: a, kind: 'draw', note: '', by: 'human:ana', at: '2026-10-29T10:00:00Z' }) + '\n').join(''));
}

/** `pixelclaw work <dir>` as a person runs it, with a bin folder first on the PATH. */
function work(dir: string, env: Record<string, string> = {}): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, 'work', dir], { env: { ...process.env, ...env }, timeout: 90_000 }, (err, _out, stderr) => {
      resolve({ code: err ? Number((err as { code?: number }).code ?? 1) : 0, stderr: String(stderr) });
    });
  });
}

/** A folder with an executable `claude` that runs the fake with these options. */
function fakeOnPath(root: string, opts: string[] = []): string {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" ${opts.map((o) => `'${o}'`).join(' ')} "$@"\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  return bin;
}

const records = (f: string) => readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { argv?: string[]; probe?: { tool: string; error: boolean; text: string }[] });
const after = (argv: string[], flag: string) => argv[argv.indexOf(flag) + 1];

describe('the worker cannot run a shell or read files outside its project', () => {
  it('`pixelclaw work` starts claude from the PATH with no built-in tools, only PixelClaw, and the command reference', async () => {
    const { root, dir } = scratch({ enabled: true, cap: 1 });
    try {
      ask(dir, ['urn']);
      const bin = fakeOnPath(root);
      const rec = join(root, 'argv.jsonl');
      const r = await work(dir, { PATH: `${bin}:${process.env.PATH}`, FAKE_CLAUDE_RECORD: rec });
      expect(r.stderr).toMatch(/worker stopped: the queue is empty/);
      const argv = records(rec)[0]!.argv!;
      expect(argv[0]).toBe('-p');
      // No built-in tool at all; each one denied by name as well; only PixelClaw's MCP tools allowed, nothing asked.
      expect(after(argv, '--tools')).toBe('');
      const denied = after(argv, '--disallowedTools')!.split(',');
      for (const t of ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'NotebookEdit', 'Skill']) expect(denied).toContain(t);
      expect(after(argv, '--allowedTools')).toBe('mcp__pixelclaw');
      expect(after(argv, '--permission-mode')).toBe('dontAsk');
      expect(after(argv, '--setting-sources')).toBe('user');
      expect(argv).toContain('--strict-mcp-config');
      for (const wide of ['--dangerously-skip-permissions', '--allow-dangerously-skip-permissions', '--add-dir', '--settings', '--plugin-dir', '--agents']) expect(argv).not.toContain(wide);
      // Each flag the worker passes appears once (a later copy cannot override it).
      for (const f of SANDBOX_FLAGS.filter((x) => x.startsWith('--'))) expect(argv.filter((a) => a === f)).toHaveLength(1);
      // The prompt says so, and the system prompt ends with every command of the language.
      expect(after(argv, '-p')).toMatch(/only the PixelClaw tools \(no shell, no files, no web\)/);
      const sys = after(argv, '--append-system-prompt')!;
      expect(sys).toContain('# Every PixelClaw command');
      for (const c of COMMANDS.values()) expect(sys).toContain(c.summary);
      expect(readRequestRecords(loadProject(dir)).filter((x) => x.type === 'done').map((x) => x.id)).toEqual(['r1']);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 60_000);

  it('the judge\'s API key stays with the server: the worker\'s session does not get it', async () => {
    const { root, dir } = scratch({ enabled: true, cap: 1 });
    try {
      ask(dir, ['urn']);
      const rec = join(root, 'argv.jsonl');
      const r = await work(dir, { PATH: `${fakeOnPath(root)}:${process.env.PATH}`, FAKE_CLAUDE_RECORD: rec, TYPESAFE_API_KEY: 'tsk_secret_for_the_judge' });
      expect(r.stderr).toMatch(/worker stopped/);
      expect(readFileSync(rec, 'utf8')).not.toContain('tsk_secret_for_the_judge');
      expect((records(rec)[0] as { typesafeEnv?: string[] }).typesafeEnv).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it('settings cannot widen it: args take only a model and effort; command may not carry tool or permission flags', async () => {
    const base = { enabled: true, command: ['claude'], args: [] as string[], cap: 1, maxSessions: 1, stall: 10 };
    expect(workerSettingsProblem({ ...base, args: ['--model', 'sonnet', '--effort=low', '--fallback-model', 'haiku'] })).toBeNull();
    for (const args of [['--allowedTools', 'Bash'], ['--tools', 'Bash'], ['--dangerously-skip-permissions'], ['--add-dir', '/'], ['--permission-mode=bypassPermissions'], ['--model'], ['--mcp-config', 'x.json']]) {
      expect(workerSettingsProblem({ ...base, args })).toMatch(/worker\.args/);
    }
    for (const command of [['claude', '--tools', 'default'], ['claude', '--allowed-tools=Bash'], ['claude', '--settings', '{}'], ['claude', '--dangerously-skip-permissions']]) {
      expect(workerSettingsProblem({ ...base, command })).toMatch(/worker\.command may not pass/);
    }
    // The CLI refuses to start such a worker and spends nothing.
    const { root, dir } = scratch({ enabled: true, cap: 1, args: ['--allowedTools', 'Bash'] });
    try {
      ask(dir, ['urn']);
      const bin = fakeOnPath(root);
      const r = await work(dir, { PATH: `${bin}:${process.env.PATH}`, FAKE_CLAUDE_RECORD: join(root, 'argv.jsonl') });
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/worker\.args may hold only --model, --fallback-model, --effort/);
      expect(existsSync(join(root, 'argv.jsonl'))).toBe(false);
      expect(workerSettings(dir).args).toEqual(['--allowedTools', 'Bash']);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 30_000);

  it('its MCP connection is fenced to the project: no other project, no files from outside, no image provider', async () => {
    const { root, dir } = scratch({ enabled: true, cap: 1 });
    const outside = join(root, 'outside');
    mkdirSync(outside);
    const png = encodePng(createRgba(4, 4));
    writeFileSync(join(outside, 'secret.png'), png);
    writeFileSync(join(outside, 'pal.hex'), 'ff0000\n00ff00\n');
    mkdirSync(join(dir, 'refs'));
    writeFileSync(join(dir, 'refs', 'sketch.png'), png);
    const probes: [string, Record<string, unknown>][] = [
      ['project', { path: join(root, 'other.pclaw'), create: true }],
      ['project', { palettes: [join(outside, 'pal.hex')] }],
      ['import', { path: join(outside, 'secret.png'), as: 'stolen' }],
      ['import', { path: join(dir, '..', 'outside', 'secret.png'), as: 'stolen2' }],
      ['export', { dest: join(outside, 'out') }],
      ['export', { profile: join(outside, 'p.json') }],
      ['run', { asset: 'pad', commands: `new sprite pad 16x16\nunderlay import ${join(outside, 'secret.png')}` }],
      ['run', { asset: 'pad', commands: 'new sprite pad 16x16\nunderlay import ../outside/secret.png' }],
      ['run', { asset: 'pad', commands: 'new sprite pad 16x16\nunderlay generate "a pad" provider=fake' }],
      ['view', { asset: '../../outside', mode: 'render' }],
      // Inside the project, the same tools work.
      ['run', { asset: 'pad', commands: 'new sprite pad 16x16\nunderlay import refs/sketch.png' }],
      ['export', { dest: join(dir, 'exports', 'mine') }],
    ];
    const rec = join(root, 'probe.jsonl');
    try {
      ask(dir, ['urn']);
      const s: Served = await serve({ project: dir, port: 0, mcp: false, log: () => undefined });
      try {
        const pj = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'));
        writeFileSync(join(dir, 'project.json'), JSON.stringify({ ...pj, worker: { ...pj.worker, command: [process.execPath, FAKE, '--fake-mode', 'probe'] } }));
        process.env.FAKE_CLAUDE_RECORD = rec;
        process.env.FAKE_CLAUDE_PROBE = JSON.stringify(probes);
        await s.worker.start('human:ana');
      } finally {
        delete process.env.FAKE_CLAUDE_RECORD;
        delete process.env.FAKE_CLAUDE_PROBE;
        await s.close();
      }
      const answers = records(rec).find((r) => r.probe)!.probe!;
      expect(answers.map((a) => a.error)).toEqual([true, true, true, true, true, true, true, true, true, true, false, false]);
      expect(answers[0]!.text).toMatch(/the worker stays in its project/);
      for (const a of answers.slice(1, 8)) expect(a.text).toMatch(/is outside the project folder, and the worker stays inside it/);
      expect(answers[8]!.text).toMatch(/the worker does not call the image provider/);
      expect(answers[9]!.text).toMatch(/is not an asset name/);
      expect(existsSync(join(root, 'other.pclaw'))).toBe(false);
      expect(existsSync(join(outside, 'out'))).toBe(false);
      expect(existsSync(join(dir, 'assets', 'stolen'))).toBe(false);
      // The watch token (a person's own agent) is not fenced: it may export anywhere.
      const s2 = await serve({ project: dir, port: 0, mcp: false, log: () => undefined });
      try {
        const c = new Client({ name: 'agent', version: '1' });
        await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${s2.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${s2.token}` } } }));
        const r = (await c.callTool({ name: 'export', arguments: { dest: join(outside, 'out') } })) as { isError?: boolean };
        expect(r.isError).toBeFalsy();
        expect(existsSync(join(outside, 'out'))).toBe(true);
        // A token that is not the watch token or a running worker's is refused outright.
        const res = await fetch(`http://127.0.0.1:${s2.port}/mcp`, { method: 'POST', headers: { Authorization: 'Bearer nope', 'Content-Type': 'application/json' }, body: '{}' });
        expect(res.status).toBe(401);
        await c.close();
      } finally { await s2.close(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 60_000);

  // The installed Claude Code itself: its help names every flag the worker passes, and, run with
  // the worker's command line against a fake model API (no account, nothing spent), it gives the
  // model only the PixelClaw tools and refuses a shell, file reads and writes, the web and agents.
  const claude = spawnSync('claude', ['--help'], { encoding: 'utf8', timeout: 20_000 });
  const hasClaude = claude.status === 0 && /--tools/.test(claude.stdout ?? '');

  it.skipIf(!hasClaude)('the installed Claude Code documents every flag the worker passes', () => {
    const help = claude.stdout;
    for (const f of [...SANDBOX_FLAGS.filter((x) => x.startsWith('--')), '-p', '--output-format', '--verbose', '--mcp-config', '--max-budget-usd', '--append-system-prompt', '--resume']) {
      expect(help, f).toContain(f);
    }
    expect(help).toMatch(/--tools <tools\.\.\.>[\s\S]*Use "" to disable all\s+tools/);
    expect(help).toMatch(/--permission-mode <mode>[\s\S]*"dontAsk"/);
    expect(help).toMatch(/--setting-sources <sources>[\s\S]*\(user, project, local\)/);
  });

  it.skipIf(!hasClaude)('the real Claude Code, asked by its model for a shell, files and the web, refuses them all', async () => {
    const { root, dir } = scratch({ enabled: true, cap: 1, maxSessions: 1 });
    const secret = `SECRET-OUTSIDE-${process.pid}`;
    writeFileSync(join(root, 'secret.txt'), secret + '\n');
    writeFileSync(join(root, 'CLAUDE.md'), `${secret}-CLAUDE-MD\n`);
    mkdirSync(join(dir, '.claude'));
    writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(*)', 'Read(*)', 'Write(*)'] } }));
    ask(dir, ['urn']);
    // What the "model" asks for, one tool call a turn; then it ends its turn.
    const script: [string, Record<string, unknown>][] = [
      ['Bash', { command: 'cat project.json', description: 'look' }],
      ['Bash', { command: `cat ${join(root, 'secret.txt')}`, description: 'look' }],
      ['Read', { file_path: join(root, 'secret.txt') }],
      ['Read', { file_path: join(dir, 'project.json') }],
      ['Glob', { pattern: '**/*', path: root }],
      ['Grep', { pattern: 'SECRET', path: root }],
      ['Write', { file_path: join(root, 'pwned.txt'), content: 'x' }],
      ['Edit', { file_path: join(dir, 'project.json'), old_string: 'ruins', new_string: 'pwned' }],
      ['WebFetch', { url: 'http://127.0.0.1:9/', prompt: 'x' }],
      ['WebSearch', { query: 'x' }],
      ['Agent', { description: 'x', prompt: 'run ls', subagent_type: 'general-purpose' }],
      ['Task', { description: 'x', prompt: 'run ls', subagent_type: 'general-purpose' }],
      ['NotebookEdit', { notebook_path: join(root, 'n.ipynb'), new_source: 'x' }],
      ['mcp__pixelclaw__project', { path: join(root, 'other.pclaw'), create: true }],
      ['mcp__pixelclaw__work', {}],
      ['mcp__pixelclaw__run', { asset: 'urn', commands: 'new sprite urn\nellipse 3,3 10x10 c=stone3 fill\noutline c=ink' }],
      ['mcp__pixelclaw__work', { action: 'done', text: 'drew the urn' }],
    ];
    const api = await startFakeModel((results) => script[results.length] ?? null);
    const seen = api.requests;
    const home = join(root, 'home');
    mkdirSync(home);
    try {
      const r = await work(dir, fakeModelEnv(api.url, home));
      expect(r.stderr).toMatch(/worker stopped/);
      const main = seen.filter((x) => x.tools.includes('mcp__pixelclaw__work'));
      expect(main.length).toBeGreaterThan(script.length);
      // What each call came back with, as the model saw it (the last turn holds the whole conversation).
      const results = (JSON.parse(main.at(-1)!.body) as { messages: { content: unknown }[] }).messages
        .flatMap((m) => (Array.isArray(m.content) ? (m.content as { type: string; content?: unknown }[]) : []))
        .filter((c) => c.type === 'tool_result').map((c) => JSON.stringify(c.content));
      expect(results).toHaveLength(script.length);
      // The model is offered PixelClaw's tools and no built-in one, on every turn.
      for (const x of seen) for (const t of x.tools) expect(BUILTIN_TOOLS, t).not.toContain(t);
      expect(main[0]!.tools.filter((t) => t.startsWith('mcp__pixelclaw__')).sort()).toEqual(
        ['changes', 'check', 'export', 'history', 'import', 'judge', 'plan', 'project', 'review', 'run', 'seeds', 'view', 'work'].map((t) => `mcp__pixelclaw__${t}`));
      // Every built-in call was refused as a tool that does not exist; the shell never ran.
      for (let i = 0; i < 13; i++) expect(results[i], script[i]![0]).toMatch(/No such tool available/);
      expect(results[13]).toMatch(/the worker stays in its project/);
      // Nothing from outside the project reached the model (not the file, not the parent's CLAUDE.md).
      for (const x of seen) expect(x.body).not.toContain(secret);
      expect(existsSync(join(root, 'pwned.txt'))).toBe(false);
      expect(existsSync(join(root, 'other.pclaw'))).toBe(false);
      expect(JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')).name).toBe('ruins');
      // The PixelClaw tools worked: the urn drawn, its request done, the session's cost in the ledger.
      expect(readRequestRecords(loadProject(dir)).filter((x) => x.type === 'done').map((x) => [x.id, x.by])).toEqual([['r1', 'claude']]);
      expect(readSpend(dir)).toHaveLength(1);
      expect(readFileSync(join(dir, 'logs', 'worker.log'), 'utf8')).toMatch(/tools: 13 PixelClaw, nothing else/);
    } finally {
      await api.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});





// Wait helper kept for later items' tests.
void until;
