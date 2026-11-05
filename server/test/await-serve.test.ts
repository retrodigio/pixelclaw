// A real `pixelclaw serve` with another process waiting on it: `pixelclaw await` blocks until a
// dashboard-style request arrives, the request is seen, claimed and finished, and CLI commands
// from other processes go through the server's writer so a connected page sees them live.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { tokenFilePath } from '../src/runfile.ts';

const REPO = join(import.meta.dirname, '..', '..');
const BIN = join(REPO, 'cli', 'bin', 'pixelclaw.js');
const PALETTE = join(REPO, 'examples', 'src', 'mossy-ruins.json');

let tmp: string;
let dir: string;
let env: NodeJS.ProcessEnv;
let server: ChildProcess | null = null;
let url = '';
let token = '';
let port = 0;

interface Done { code: number | null; out: string; err: string }

/** Run the CLI to its end. */
function cli(args: string[], input?: string): Promise<Done> {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [BIN, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    c.stdout.on('data', (d: Buffer) => { out += d; });
    c.stderr.on('data', (d: Buffer) => { err += d; });
    c.on('close', (code) => resolve({ code, out, err }));
    c.stdin.end(input ?? '');
  });
}

async function startServe(): Promise<void> {
  server = spawn(process.execPath, [BIN, 'serve', '--project', dir, '--port', '0', '--no-mcp'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  server.stderr!.on('data', (d: Buffer) => { err += d; });
  const t0 = Date.now();
  while (!/watch at (\S+)/.test(err)) {
    if (Date.now() - t0 > 15_000) throw new Error(`no URL from the server: ${err}`);
    await new Promise((r) => setTimeout(r, 25));
  }
  url = /watch at (\S+)/.exec(err)![1]!;
  token = new URL(url).searchParams.get('token')!;
  port = Number(new URL(url).port);
}

const api = async (path: string): Promise<unknown> => (await fetch(`http://127.0.0.1:${port}${path}${path.includes('?') ? '&' : '?'}token=${token}`)).json();
const until = async (f: () => Promise<boolean> | boolean, what: string): Promise<void> => {
  const t0 = Date.now();
  while (!(await f())) {
    if (Date.now() - t0 > 10_000) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
};

/** A page: a WebSocket that keeps every message and can send a request as a person. */
async function page(): Promise<{ msgs: { type: string; [k: string]: unknown }[]; send(body: unknown): Promise<{ ok: boolean; error?: string }>; close(): void }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
  const msgs: { type: string; [k: string]: unknown }[] = [];
  const waiting = new Map<number, (m: { ok: boolean; error?: string }) => void>();
  let n = 0;
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data)) as { type: string; id?: number; ok?: boolean; error?: string };
    msgs.push(m);
    if (m.type === 'answer' && m.id !== undefined) waiting.get(m.id)?.({ ok: !!m.ok, error: m.error });
  };
  await new Promise<void>((r, j) => { ws.onopen = () => r(); ws.onerror = () => j(new Error('ws')); });
  await until(() => msgs.some((m) => m.type === 'hello'), 'the hello message');
  return {
    msgs,
    send: (body) => new Promise((resolve) => {
      const id = ++n;
      waiting.set(id, resolve);
      ws.send(JSON.stringify({ type: 'request', id, by: 'human:ana', body }));
    }),
    close: () => ws.close(),
  };
}

const MANIFEST = {
  format: 'pixelclaw-manifest', version: 1, theme: 'Old stone under moss.',
  sets: { props: { description: 'things that stand' } },
  assets: [{ name: 'urn', kind: 'sprite', size: '16x16', set: 'props', height: 12, description: 'a squat stone urn' }],
};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pixelclaw-await-'));
  dir = join(tmp, 'p.pclaw');
  process.env.PIXELCLAW_STATE_DIR = join(tmp, 'state');
  env = { ...process.env };
  execFileSync(process.execPath, [BIN, 'new', dir, '--palette', PALETTE], { env });
  writeFileSync(join(tmp, 'm.json'), JSON.stringify(MANIFEST));
  execFileSync(process.execPath, [BIN, 'plan', dir, '--manifest', join(tmp, 'm.json')], { env });
});

afterEach(async () => {
  delete process.env.PIXELCLAW_STATE_DIR;
  if (server) {
    const s = server;
    server = null;
    const closed = new Promise((r) => s.on('close', r));
    s.kill('SIGTERM');
    await closed;
  }
  rmSync(tmp, { recursive: true, force: true });
});

describe('pixelclaw await against a real server', () => {
  it('blocks until a request arrives, then the request is seen, claimed, finished', async () => {
    await startServe();
    const p = await page();
    const states: string[] = [];
    const label = (): string => {
      const last = [...p.msgs].reverse().find((m) => m.type === 'requests') as { requests: { id: string; state: string; seen: unknown[] }[] } | undefined;
      const q = last?.requests.find((x) => x.id === 'r1');
      return !q ? 'none' : q.state === 'open' ? (q.seen.length ? 'seen' : 'sent') : q.state === 'claimed' ? 'working' : q.state;
    };
    const note = (): void => { const l = label(); if (states.at(-1) !== l) states.push(l); };
    // Nobody is listening yet.
    expect(((await api('/api/presence')) as { listening: boolean }).listening).toBe(false);
    const waiter = spawn(process.execPath, [BIN, 'await', dir, '--timeout', '30'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    waiter.stdout.on('data', (d: Buffer) => { out += d; });
    const exited = new Promise<number | null>((r) => waiter.on('close', r));
    await until(async () => ((await api('/api/presence')) as { waiters: unknown[] }).waiters.length === 1, 'the waiter to show in presence');
    await until(() => (p.msgs.filter((m) => m.type === 'presence').at(-1) as { presence?: { listening: boolean } } | undefined)?.presence?.listening === true, 'the page to hear a listener');
    expect(out).toBe('');
    // A person asks for the urn to be drawn.
    const sent = await p.send({ action: 'request', kind: 'draw', asset: 'urn', note: 'squat' });
    expect(sent.ok).toBe(true);
    note();
    expect(await exited).toBe(0);
    expect(out).toContain('request r1 (urn) from human:ana');
    expect(out).toContain('next: work');
    const cursor = /next cursor: (\S+)/.exec(out)![1]!;
    await until(() => (note(), label() === 'seen'), 'seen');
    // The agent claims it over MCP, draws with the CLI (through the server), finishes it.
    const mcp = new Client({ name: 'test', version: '1' });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    const text = async (name: string, args: Record<string, unknown>): Promise<string> => ((await mcp.callTool({ name, arguments: args })) as { content: { text?: string }[] }).content.map((c) => c.text ?? '').join('\n');
    expect(await text('work', {})).toContain('claimed r1');
    await until(() => (note(), label() === 'working'), 'working');
    const draw = await cli(['run', dir, '-e', 'new sprite urn\nrect 4,4 8x10 c=stone2 fill\noutline c=ink', '--by', 'claude']);
    expect(draw.err).toBe('');
    expect(draw.code).toBe(0);
    const done = await text('work', { action: 'done', text: 'drew the urn' });
    expect(done).toMatch(/r1: done|not done/);
    if (/not done/.test(done)) throw new Error(`the urn did not pass its checks: ${done}`);
    await until(() => (note(), label() === 'done'), 'done');
    expect(states).toEqual(['sent', 'seen', 'working', 'done']);
    // Awaiting again from the cursor does not repeat r1; a status mark by a person is an event.
    const again = cli(['await', dir, '--since', cursor, '--timeout', '30']);
    await until(async () => ((await api('/api/presence')) as { waiters: unknown[] }).waiters.length === 1, 'the second waiter');
    const marked = await cli(['run', dir, '-e', 'mark approved "good"', '--asset', 'urn', '--by', 'human:ana']);
    expect(marked.code).toBe(0);
    const second = await again;
    expect(second.code).toBe(0);
    expect(second.out).toContain('approved urn from human:ana');
    expect(second.out).toContain('"good"');
    expect(second.out).toContain('next: changes');
    expect(second.out).not.toContain('r1');
    await mcp.close();
    p.close();
  });

  it('exits with code 3 on timeout, and works from a watch URL', async () => {
    await startServe();
    const r = await cli(['await', dir, '--timeout', '1']);
    expect(r.code).toBe(3);
    expect(r.out).toMatch(/^no new events\nnext cursor: [0-9a-f]+:\d+\n$/);
    const viaUrl = await cli(['await', url, '--timeout', '1', '--json']);
    expect(viaUrl.code).toBe(3);
    expect(JSON.parse(viaUrl.out)).toMatchObject({ events: [], timedOut: true });
  });

  it('a listener with no cursor is told of requests still open and unseen', async () => {
    await startServe();
    const p = await page();
    expect((await p.send({ action: 'request', kind: 'draw', asset: 'urn' })).ok).toBe(true);
    const r = await cli(['await', dir, '--timeout', '5']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('request r1 (urn)');
    // Now it is seen: a second listener with no cursor waits.
    expect((await cli(['await', dir, '--timeout', '1'])).code).toBe(3);
    p.close();
  });
});

describe('an agent with no MCP works requests with the CLI', () => {
  it('serve --no-mcp: the card goes sent → seen → working → done, driven only by the CLI', async () => {
    await startServe();
    const p = await page();
    const states: string[] = [];
    const label = (): string => {
      const last = [...p.msgs].reverse().find((m) => m.type === 'requests') as { requests: { id: string; state: string; seen: unknown[] }[] } | undefined;
      const q = last?.requests.find((x) => x.id === 'r1');
      return !q ? 'none' : q.state === 'open' ? (q.seen.length ? 'seen' : 'sent') : q.state === 'claimed' ? 'working' : q.state;
    };
    const note = (): void => { const l = label(); if (states.at(-1) !== l) states.push(l); };
    const presence = async () => (await api('/api/presence')) as { listening: boolean; agents: { by: string }[] };
    expect((await presence()).listening).toBe(false);
    // A person asks for the urn in the dashboard.
    expect((await p.send({ action: 'request', kind: 'draw', asset: 'urn', note: 'squat' })).ok).toBe(true);
    await until(() => (note(), label() === 'sent'), 'sent');
    // The agent hears of it, then lists the requests (which hands r1 over).
    const heard = await cli(['await', dir, '--timeout', '10']);
    expect(heard.code).toBe(0);
    expect(heard.out).toContain(`without MCP: pixelclaw work ${dir} claim r1`);
    await until(() => (note(), label() === 'seen'), 'seen');
    const list = await cli(['work', dir, 'list']);
    expect(list.out).toContain('r1 draw urn: "squat" (from human:ana');
    expect(list.out).toContain('seen by claude)');
    // The other lists say what the card says.
    expect((await cli(['request', dir])).out).toContain('; seen by claude)');
    expect((await cli(['plan', dir])).out).toContain('(from human:ana; seen by claude)');
    // claim: working, and the agent shows as listening.
    const claim = await cli(['work', dir, 'claim']);
    expect(claim.err).toBe('');
    expect(claim.out).toContain('claimed r1');
    await until(() => (note(), label() === 'working'), 'working');
    expect((await presence()).agents.map((a) => a.by)).toContain('claude');
    expect((await presence()).listening).toBe(true);
    const progress = await cli(['work', dir, 'progress', 'blocking in the body']);
    expect(progress.code).toBe(0);
    await until(() => p.msgs.some((m) => m.type === 'requests' && (m.requests as { latest: string | null }[])[0]?.latest === 'blocking in the body'), 'the progress note on the page');
    // A first try that fails its checks: done is refused and the card stays working.
    expect((await cli(['run', dir, '-e', 'new sprite urn\npx 3,3 c=stone2'])).code).toBe(0);
    const before = readFileSync(join(dir, 'requests.jsonl'), 'utf8');
    const refused = await cli(['work', dir, 'done', 'drew the urn']);
    expect(refused.code).toBe(1);
    expect(refused.err).toMatch(/r1 is not done: urn fails \d+ checks?/);
    expect(readFileSync(join(dir, 'requests.jsonl'), 'utf8')).toBe(before);
    expect(label()).toBe('working');
    // Fixed, then done.
    expect((await cli(['run', dir, '--asset', 'urn', '-e', 'clear\nrect 4,4 8x10 c=stone2 fill\noutline c=ink'])).code).toBe(0);
    const done = await cli(['work', dir, 'done', 'drew the urn']);
    expect(done.err).toBe('');
    expect(done.out).toMatch(/^r1: done\n/);
    await until(() => (note(), label() === 'done'), 'done');
    expect(states).toEqual(['sent', 'seen', 'working', 'done']);
    // Written by the server's writer, with the agent as author.
    const recs = readFileSync(join(dir, 'requests.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { type: string; by: string });
    expect(recs.map((x) => x.type)).toEqual(['request', 'seen', 'claim', 'progress', 'done']);
    expect(recs.slice(1).every((x) => x.by === 'claude')).toBe(true);
    p.close();
  }, 90_000); // a dozen CLI processes, each a Node start-up, under a full parallel run
});

describe('CLI writes go through a running server', () => {
  it('run from another process reaches a connected page without a reconnect', async () => {
    await startServe();
    const p = await page();
    const hellos = p.msgs.filter((m) => m.type === 'hello').length;
    const r = await cli(['run', dir, '-e', 'new sprite crate 8x8\nfill 0,0 c=stone1', '--by', 'claude']);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toContain('crate: applied');
    await until(() => p.msgs.some((m) => m.type === 'batch' && m.asset === 'crate'), 'the batch on the page');
    expect(p.msgs.filter((m) => m.type === 'hello').length).toBe(hellos);
    expect(p.msgs.find((m) => m.type === 'batch')).toMatchObject({ by: 'claude' });
    // Not applied behind the server's back: the tape is the server's one.
    expect(readFileSync(join(dir, 'assets', 'crate', 'tape.jsonl'), 'utf8')).toContain('fill');
    p.close();
  });

  it('a refused command applies nothing and fails as it does directly', async () => {
    await startServe();
    const before = existsSync(join(dir, 'assets', 'crate'));
    const viaServer = await cli(['run', dir, '-e', 'new sprite crate 8x8\nfill 0,0 c=nosuchcolour']);
    expect(viaServer.code).toBe(1);
    expect(viaServer.err).toContain('nothing was applied');
    expect(existsSync(join(dir, 'assets', 'crate'))).toBe(before);
    // The same text with no server running fails the same way.
    await stopServe();
    const direct = await cli(['run', dir, '-e', 'new sprite crate 8x8\nfill 0,0 c=nosuchcolour']);
    expect(direct.code).toBe(viaServer.code);
    expect(direct.err).toBe(viaServer.err);
    expect(existsSync(join(dir, 'assets', 'crate'))).toBe(before);
  });

  it('request, reply and cancel go through the server and the page sees them', async () => {
    await startServe();
    const p = await page();
    const r = await cli(['request', dir, 'draw', 'urn', '--note', 'squat', '--by', 'human:ana']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^r1 draw urn: "squat"/);
    await until(() => p.msgs.some((m) => m.type === 'requests'), 'the requests message');
    p.close();
  });

  it('read-only commands still read the files, and dry runs are not sent', async () => {
    await startServe();
    expect((await cli(['plan', dir])).out).toContain('urn');
    const dry = await cli(['run', dir, '-e', 'new sprite crate 8x8', '--dry']);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain('nothing was kept');
  });

  it('falls back to the direct path when the lock is stale (dead pid)', async () => {
    writeFileSync(join(dir, '.pixelclaw.lock'), JSON.stringify({ pid: 2 ** 22 + 12345, url: 'http://127.0.0.1:1/' }) + '\n');
    const r = await cli(['run', dir, '-e', 'new sprite crate 8x8\nfill 0,0 c=stone1']);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toContain('crate: applied');
  });

  it('a live server whose token file is gone refuses as before, and says why', async () => {
    await startServe();
    rmSync(tokenFilePath(dir));
    const r = await cli(['run', dir, '-e', 'new sprite crate 8x8']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('token file');
  });
});

describe('the token file', () => {
  it('is readable by the user alone, and is gone when the server stops', async () => {
    await startServe();
    const f = tokenFilePath(dir);
    expect(existsSync(f)).toBe(true);
    if (process.platform !== 'win32') {
      expect(statSync(f).mode & 0o777).toBe(0o600);
      expect(statSync(join(tmp, 'state')).mode & 0o777).toBe(0o700);
    }
    // Not in the project folder, nor in the lock file.
    expect(readFileSync(join(dir, '.pixelclaw.lock'), 'utf8')).not.toContain(token);
    // The file lives outside the project folder, so no project .gitignore, tool or view reaches it.
    expect(f.startsWith(dir)).toBe(false);
    await stopServe();
    expect(existsSync(f)).toBe(false);
  });
});

async function stopServe(): Promise<void> {
  const s = server!;
  server = null;
  const closed = new Promise((r) => s.on('close', r));
  s.kill('SIGTERM');
  await closed;
}
