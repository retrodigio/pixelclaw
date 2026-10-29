// G15 (plan §26) in the server. Item 1, the worker's sandbox and discipline: `pixelclaw work`
// starts `claude` from the PATH with no built-in tools (a fake records its arguments; the flags
// are checked against the installed Claude Code's own help, and the real Claude Code is run
// against a fake model API that asks for a shell, files and the web); settings cannot widen it;
// its MCP connection is fenced to the project; `work done` is refused while a check fails; a
// stall watchdog; a spend ledger across runs.

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

/** Requests to draw planned assets, as a person's records (the CLI's `request` comes with item 2). */
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

describe('the worker cannot run a shell or read files outside its project (§26 item 1)', () => {
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
        ['changes', 'check', 'export', 'history', 'import', 'plan', 'project', 'review', 'run', 'seeds', 'view', 'work'].map((t) => `mcp__pixelclaw__${t}`));
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
      expect(readFileSync(join(dir, 'logs', 'worker.log'), 'utf8')).toMatch(/tools: 12 PixelClaw, nothing else/);
    } finally {
      await api.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('worker discipline (§26 item 1)', () => {
  let root: string, dir: string, s: Served, c: Client;
  const call = async (name: string, args: Record<string, unknown> = {}) => (await c.callTool({ name, arguments: args })) as { content: Content; isError?: boolean };
  beforeAll(async () => {
    ({ root, dir } = scratch());
    ask(dir, ['jar', 'post', 'turf']);
    s = await serve({ project: dir, port: 0, mcp: false, log: () => undefined });
    c = new Client({ name: 'agent', version: '1' });
    await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${s.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${s.token}` } } }));
  }, 30_000);
  afterAll(async () => { await c?.close(); await s?.close(); rmSync(root, { recursive: true, force: true }); });

  it('work done is refused while the asset fails a check (the reply lists them); blocked stays open; fixed, done is taken', async () => {
    expect(texts((await call('work')).content)).toMatch(/claimed r1/);
    let r = await call('work', { action: 'done', text: 'drew it' });
    expect(r.isError).toBe(true);
    expect(texts(r.content)).toMatch(/r1 is not done: jar is not drawn yet/);
    expect((await call('run', { asset: 'jar', commands: 'new sprite jar\nellipse 3,3 10x10 c=stone3 fill' })).isError).toBeFalsy();
    r = await call('work', { action: 'done', text: 'drew it' });
    expect(r.isError).toBe(true);
    expect(texts(r.content)).toMatch(/r1 is not done: jar fails \d checks?:\n {2}outline 0 \(limit ≥ 0\.85\): 0 of \d+ silhouette edge px are ink/);
    expect(texts(r.content)).toMatch(/work\(action="blocked"/);
    expect(readRequestRecords(loadProject(dir)).filter((x) => x.id === 'r1').map((x) => x.type)).toEqual(['request', 'claim']);
    expect((await call('run', { asset: 'jar', commands: 'outline c=ink' })).isError).toBeFalsy();
    r = await call('work', { action: 'done', text: 'drew it, outlined' });
    expect(r.isError).toBeFalsy();
    // blocked is always open to it, failing or not.
    expect(texts((await call('work')).content)).toMatch(/claimed r2/);
    expect((await call('run', { asset: 'post', commands: 'new sprite post\nrect 6,2 4x12 c=soil1 fill' })).isError).toBeFalsy();
    expect((await call('work', { action: 'blocked', text: 'Wood or stone?' })).isError).toBeFalsy();
  });
});

describe('requests from MCP (§26 item 2)', () => {
  it('an agent files, answers and withdraws requests as the dashboard does; the worker\'s own connection has no request tool', async () => {
    const { root, dir } = scratch({ enabled: true, cap: 1 });
    const s = await serve({ project: dir, port: 0, mcp: false, log: () => undefined });
    const c = new Client({ name: 'agent', version: '1' });
    try {
      await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${s.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${s.token}` } } }));
      const call = async (args: Record<string, unknown>) => (await c.callTool({ name: 'request', arguments: args })) as { content: Content; isError?: boolean };
      expect(texts((await call({ kind: 'draw', asset: 'urn', note: 'squat' })).content)).toMatch(/^r1 draw urn: "squat" \(from claude at .*; open\)$/);
      expect((await c.callTool({ name: 'run', arguments: { asset: 'turf', commands: 'new tile turf\nfill 0,0 c=moss1' } }) as { isError?: boolean }).isError).toBeFalsy();
      expect(texts((await call({ kind: 'change', asset: 'turf', note: 'more tufts' })).content)).toMatch(/^r2 change turf: "more tufts"/);
      expect(readFileSync(join(dir, 'assets', 'turf', 'tape.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1)).toMatchObject({ by: 'claude', cmd: 'mark rejected "more tufts"' });
      expect(texts((await call({ kind: 'add', entry: { name: 'crate', kind: 'sprite', size: '16x16', set: 'props' } })).content)).toMatch(/^r3 new asset crate/);
      let r = await call({ kind: 'add', entry: { name: 'crate2', kind: 'sprite' } });
      expect(r.isError).toBe(true);
      expect(texts(r.content)).toMatch(/the new entry has problems/);
      r = await call({ kind: 'change', asset: 'turf' });
      expect(texts(r.content)).toMatch(/say what should change/);
      expect(texts((await call({ action: 'cancel', id: 'r3', text: 'later' })).content)).toMatch(/cancelled\)$/);
      expect(texts((await call({ action: 'reply', id: 'r1', text: 'x' })).content)).toMatch(/only a blocked request takes a reply/);
      expect(readRequestRecords(loadProject(dir)).map((x) => `${x.type} ${x.id}`)).toEqual(['request r1', 'request r2', 'request r3', 'cancel r3']);
      // The worker's connection (its own token, fenced) does not offer the tool.
      const rec = join(root, 'probe.jsonl');
      process.env.FAKE_CLAUDE_RECORD = rec;
      process.env.FAKE_CLAUDE_PROBE = JSON.stringify([['request', { kind: 'draw', asset: 'jar' }]]);
      const pj = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'));
      writeFileSync(join(dir, 'project.json'), JSON.stringify({ ...pj, worker: { ...pj.worker, command: [process.execPath, FAKE, '--fake-mode', 'probe'] } }));
      await s.worker.start('human:ana');
      expect(records(rec).find((x) => x.probe)!.probe![0]).toMatchObject({ error: true, text: expect.stringMatching(/Tool request not found/i) });
    } finally {
      delete process.env.FAKE_CLAUDE_RECORD;
      delete process.env.FAKE_CLAUDE_PROBE;
      await c.close();
      await s.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('family textures follow their source tiles (§26 item 4)', () => {
  it('a change to a tile is copied into the families whose textures came from it, frame by frame; a texture drawn from rows is left alone', () => {
    const { root, dir } = scratch();
    try {
      const w = new Writer(loadProject(dir), { now: () => '2026-10-29T12:00:00Z' });
      const ok = (asset: string, commands: string, by = 'claude') => { const r = w.run({ asset, commands, by }); if (!r.ok) throw new Error(r.errors.map((e) => e.message).join('; ')); return r; };
      ok('sand', 'new tile sand 8x8\nfill 0,0 c=soil2');
      ok('water', 'new tile water 8x8\nfill 0,0 c=pool\nframe add copy=1\nframe 2\npx 1,1 c=stone5\nframe 1');
      ok('shore', 'new family shore 8x8 scheme=blob47\nframe add\nframe 1\nfamily texture inside from=sand\nfamily texture outside from=water frame=1\nframe 2\nfamily texture inside from=sand\nfamily texture outside from=water frame=2\nframe 1\nfamily band 2:outside 1:soil0');
      ok('beach', 'new family beach 8x8 scheme=blob47\nfamily texture inside from=sand\nfamily texture inside <<\n' + '  hhhhhhhh\n'.repeat(8) + '>>');
      const cell = (name: string, which: 'inside' | 'outside', frame: number) => {
        const d = w.doc(name);
        const [cx, cy] = layoutOf(d.family!)[which === 'inside' ? 'inside' : 'outside'] as [number, number];
        const px = flatten(d, frame);
        return Array.from({ length: 64 }, (_, k) => d.palette.entries[px[(cy * 8 + (k >> 3)) * d.width + cx * 8 + (k & 7)]!]!.name).join(' ');
      };
      const tile = (name: string, frame: number) => { const d = w.doc(name); const px = flatten(d, frame); return Array.from(px, (v) => d.palette.entries[v]!.name).join(' '); };
      expect(cell('shore', 'inside', 0)).toBe(tile('sand', 0));
      // The sand changes: shore's inside follows on both its frames, beach's own rows stay.
      const beachBefore = w.state('beach').entries.length;
      const r = ok('sand', 'px 2,2 c=ink', 'human:ana');
      expect(r.followed).toEqual(['shore']);
      expect(cell('shore', 'inside', 0)).toBe(tile('sand', 0));
      expect(cell('shore', 'inside', 1)).toBe(tile('sand', 0));
      expect(cell('shore', 'inside', 0)).toContain('ink');
      const added = w.state('shore').entries.slice(-4).map((e) => [e.by, e.cmd.split('\n')[0]]);
      expect(added).toEqual([['human:ana', 'family texture inside from=sand frame=1 <<'], ['human:ana', 'frame 2'], ['human:ana', 'family texture inside from=sand frame=1 <<'], ['human:ana', 'frame 1']]);
      expect(new Set(w.state('shore').entries.slice(-4).map((e) => e.group)).size).toBe(1);
      expect(w.state('beach').entries.length).toBe(beachBefore);
      // The water's second frame changes: only shore's second frame's outside is copied again.
      const r2 = ok('water', 'frame 2\npx 5,5 c=ink\nframe 1');
      expect(r2.followed).toEqual(['shore']);
      expect(cell('shore', 'outside', 1)).toBe(tile('water', 1));
      expect(cell('shore', 'outside', 0)).toBe(tile('water', 0));
      expect(w.state('shore').entries.slice(-3).map((e) => e.cmd.split('\n')[0])).toEqual(['frame 2', 'family texture outside from=water frame=2 <<', 'frame 1']);
      // A change that leaves the tile's pixels as they were writes nothing.
      const n = w.state('shore').entries.length;
      expect(ok('sand', 'note 1,1 "nice"').followed).toBeUndefined();
      expect(w.state('shore').entries.length).toBe(n);
      // The tapes still replay to the same state.
      expect(execFileSync(process.execPath, [BIN, 'verify', dir], { encoding: 'utf8' })).toMatch(/verified/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 30_000);
});

describe('the stall watchdog and the spend ledger (§26 item 1)', () => {
  const run = async (dir: string, opts: string[], worker: Record<string, unknown> = {}) => {
    const pj = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'));
    writeFileSync(join(dir, 'project.json'), JSON.stringify({ ...pj, worker: { enabled: true, cap: 1, command: [process.execPath, FAKE, ...opts], ...worker } }, null, 2));
    const s = await serve({ project: dir, port: 0, mcp: false, log: () => undefined });
    try { return await s.worker.start('human:ana'); } finally { await s.close(); }
  };

  it('a session with no tool call for `stall` minutes is stopped and resumed once; it finishes', async () => {
    const { root, dir } = scratch();
    const rec = join(root, 'argv.jsonl');
    try {
      ask(dir, ['urn']);
      process.env.FAKE_CLAUDE_RECORD = rec;
      const why = await run(dir, ['--fake-mode', 'stall'], { stall: 0.05 });
      expect(why).toBe('the queue is empty');
      const log = readFileSync(join(dir, 'logs', 'worker.log'), 'utf8');
      expect(log).toMatch(/watchdog: no tool call for 0\.05 min; stopping the session/);
      expect(log).toMatch(/session 1: no tool call for 0\.05 min; stopped it; resuming it once/);
      const argvs = records(rec).map((r) => r.argv!);
      expect(argvs).toHaveLength(2);
      expect(after(argvs[1]!, '--resume')).toMatch(/^fake-\d+$/);
      expect(after(argvs[1]!, '-p')).toMatch(/You made no tool call for 0\.05 minutes/);
      expect(after(argvs[1]!, '--tools')).toBe('');
      expect(readRequestRecords(loadProject(dir)).filter((x) => x.type === 'done').map((x) => x.id)).toEqual(['r1']);
      // The stopped session reported no cost: its tokens are charged at the dearest rates (an upper bound).
      const spend = readSpend(dir);
      expect(spend.map((x) => [x.session, x.estimated ?? false])).toEqual([[1, true], [1, false]]);
      expect(spend[0]!.cost).toBeCloseTo((2 * 1000 * 15 + 2 * 100 * 75) / 1e6, 6); // plan and work, 1000 tokens in and 100 out each
    } finally { delete process.env.FAKE_CLAUDE_RECORD; rmSync(root, { recursive: true, force: true }); }
  }, 60_000);

  it('stalling again after the resume marks the request blocked, with why', async () => {
    const { root, dir } = scratch();
    try {
      ask(dir, ['urn']);
      expect(await run(dir, ['--fake-mode', 'stall', '--fake-stall-again'], { stall: 0.05 })).toBe('the queue is empty');
      const blocked = readRequestRecords(loadProject(dir)).filter((x) => x.type === 'blocked');
      expect(blocked).toEqual([expect.objectContaining({ id: 'r1', by: 'claude', text: expect.stringMatching(/The worker stalled on this \(no tool call for 0\.05 min, twice\)/) })]);
      expect(readFileSync(join(dir, 'logs', 'worker.log'), 'utf8')).toMatch(/stalled again; r1 marked blocked/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 60_000);

  it('the cap is a total over every run (worker-spend.jsonl), and a spent cap refuses to start', async () => {
    const { root, dir } = scratch();
    try {
      ask(dir, ['urn']);
      expect(await run(dir, ['--fake-cost', '0.4'])).toBe('the queue is empty');
      expect(workerSpent(dir)).toBe(0.4);
      ask(dir, ['jar']);
      expect(await run(dir, ['--fake-cost', '0.4'])).toBe('the queue is empty');
      let log = readFileSync(join(dir, "logs", "worker.log"), "utf8");
      expect(log).toMatch(/cap \$1\.00 \(\$0\.40 spent before\)/);
      expect(log).toMatch(/session 1: budget \$0\.60/);
      expect(workerSpent(dir)).toBe(0.8);
      ask(dir, ['post', 'turf']);
      expect(await run(dir, ['--fake-cost', '0.4'])).toBe('the budget cap was reached ($1.00 of $1.00)');
      log = readFileSync(join(dir, 'logs', 'worker.log'), 'utf8');
      expect(log).toMatch(/session 1: budget \$0\.20/);
      expect(readSpend(dir).map((x) => x.cost)).toEqual([0.4, 0.4, 0.2]);
      expect(readFileSync(join(dir, WORKER_SPEND), 'utf8').trim().split('\n')).toHaveLength(3);
      await expect(run(dir, ['--fake-cost', '0.4'])).rejects.toThrow(/has spent \$1\.00 of its \$1\.00 cap on this project \(worker-spend\.jsonl\); raise worker\.cap/);
      // Raised, it goes on from the total.
      expect(await run(dir, ['--fake-cost', '0.4'], { cap: 2 })).toBe('the queue is empty');
      expect(workerSpent(dir)).toBe(1.4);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 90_000);

  it('the command reference is every registered command', () => {
    const ref = commandReference().split('\n');
    expect(ref).toHaveLength(COMMANDS.size);
    expect(ref).toContain(COMMANDS.get('px')!.summary);
  });
});

// Wait helper kept for later items' tests.
void until;
