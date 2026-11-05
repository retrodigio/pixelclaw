// HTTP and WebSocket for the watch view, on localhost only. The page and its scripts are public
// (they hold no art), but the project itself (/api/*, /ws) needs the token printed at start, and
// so does the page's own URL, so a bare link shows how to get in.

import { timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMcpHandler, type McpServerFactory } from '@modelcontextprotocol/server';
import { composeMapDoc, createRgba, encodePng, mapWorld, renderFlat } from '@pixelclaw/core';
import { rgbaOf } from './export.ts';
import { HUMAN_RE, type ClientMessage, type PersonRequest, type ServerMessage } from './protocol.ts';
import { ProjectError } from './project.ts';
import type { Writer } from './writer.ts';
import { planReport } from './plan.ts';
import { awaitRequests, personRequest } from './requests.ts';
import { importIntoProject, type ImportOptions } from './io.ts';
import { workerLogTail, type WorkerControl } from './worker.ts';
import { acceptWebSocket, type WsConnection } from './ws.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.map': 'application/json',
};

/** The built UI: next to the bundle (dist/ui) or, from the sources, ui/dist. */
export function findUiDir(): string | null {
  const candidates = [
    process.env.PIXELCLAW_UI_DIR,
    fileURLToPath(new URL('./ui/', import.meta.url)),
    fileURLToPath(new URL('../../ui/dist/', import.meta.url)),
  ];
  for (const d of candidates) if (d && existsSync(join(d, 'index.html'))) return d;
  return null;
}

function tokenOk(given: string | null, token: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

const HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

const CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'";

function page(res: ServerResponse, status: number, title: string, body: string): void {
  res.writeHead(status, { ...HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font:15px system-ui;background:#16171b;color:#d8dbe0;padding:3em;max-width:40em">
<h1 style="font-size:20px">PixelClaw: ${title}</h1>${body}</body>`);
}

/** Longest command text a page may send in one message. */
const MAX_COMMANDS = 256 * 1024;

/**
 * A person's edit: one batch, through the writer's queue like everything else, written with the
 * page's author name (which must be `human:<name>`). Pages cannot restart an existing asset.
 */
export async function runFromPage(w: Writer, m: Extract<ClientMessage, { type: 'run' }>): Promise<ServerMessage> {
  const fail = (message: string): ServerMessage => ({ type: 'result', id: m.id, ok: false, errors: [{ line: 0, col: 0, message }] });
  if (typeof m.by !== 'string' || !HUMAN_RE.test(m.by)) return fail(`a page writes as human:<name> (letters, digits, . _ -)`);
  if (typeof m.asset !== 'string' || typeof m.commands !== 'string') return fail('run needs an asset and commands');
  if (m.commands.length > MAX_COMMANDS) return fail('too many commands in one message');
  return w.enqueue(async (): Promise<ServerMessage> => {
    try {
      const r = await w.runAsync({ asset: m.asset || undefined, commands: m.commands, by: m.by });
      if (!r.ok) return { type: 'result', id: m.id, ok: false, errors: r.errors };
      return { type: 'result', id: m.id, ok: true, asset: r.asset, group: r.group, seq: r.added.at(-1)?.seq ?? null };
    } catch (e) {
      if (e instanceof ProjectError) return fail(e.message);
      return fail(`internal error: ${(e as Error).message}`);
    }
  });
}

/** A request, reply or cancel from a page, written as the page's person. */
export async function requestFromPage(w: Writer, m: Extract<ClientMessage, { type: 'request' }>): Promise<ServerMessage> {
  if (typeof m.by !== 'string' || !HUMAN_RE.test(m.by)) return { type: 'answer', id: m.id, ok: false, error: 'a page writes as human:<name>' };
  return w.enqueue((): ServerMessage => {
    try {
      const request = personRequest(w, m.by, m.body as PersonRequest);
      w.requestsChanged();
      return { type: 'answer', id: m.id, ok: true, request };
    } catch (e) {
      return { type: 'answer', id: m.id, ok: false, error: e instanceof ProjectError ? e.message : `internal error: ${(e as Error).message}` };
    }
  });
}

/** Every frame of an asset side by side at 1x (the gallery plays them by their ticks). */
export function framesStrip(w: Writer, name: string): Uint8Array {
  const d = w.doc(name);
  if (d.map) {
    const c = composeMapDoc(d, mapWorld(w.assetDocs()));
    return encodePng(rgbaOf(c.px, c.w, c.h, c.palette));
  }
  if (d.frameCount <= 1 || d.family) return encodePng(renderFlat(d));
  const img = createRgba(d.width * d.frameCount, d.height);
  for (let f = 0; f < d.frameCount; f++) {
    const fr = renderFlat(d, f);
    for (let y = 0; y < d.height; y++) img.data.set(fr.data.subarray(y * d.width * 4, (y + 1) * d.width * 4), (y * img.width + f * d.width) * 4);
  }
  return encodePng(img);
}

/** Largest upload (an import's files, base64 in JSON). */
const MAX_UPLOAD = 32 * 1024 * 1024;

function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let n = 0;
    req.on('data', (d: Buffer) => {
      n += d.length;
      if (n > max) { reject(new ProjectError('too large')); req.destroy(); return; }
      parts.push(d);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

export interface WatchServer {
  url: string;
  port: number;
  token: string;
  clients(): number;
  close(): Promise<void>;
}

export interface WatchOptions {
  writer: Writer;
  token: string;
  /** The port to try first; 0 picks a free one. */
  port: number;
  /** How many ports after `port` to try when it is taken. */
  tries?: number;
  host?: string;
  /**
   * Serve MCP over HTTP at /mcp, with the token as a bearer; the running worker's own token gets a
   * server confined to the project (mcp.ts `confined`).
   */
  mcp?: (o: { confined: boolean }) => ReturnType<McpServerFactory>;
  /** The headless worker, started and stopped from the dashboard. */
  worker?: WorkerControl;
  /** Runs a CLI invocation against the writer (POST /api/cli); the CLI supplies it. */
  runCli?: (argv: string[], writer: Writer, cwd: string) => { code: number; stdout: string; stderr: string };
}

/** Commands the CLI may send to the server (the ones that write). */
export const FORWARDED_COMMANDS = ['new', 'run', 'seeds', 'export', 'import', 'review', 'plan', 'request', 'reply', 'cancel', 'work'];

export async function startWatchServer(o: WatchOptions): Promise<WatchServer> {
  const host = o.host ?? '127.0.0.1';
  const uiDir = findUiDir();
  const sockets = new Set<WsConnection>();
  let port = 0;
  const allowedHosts = (): string[] => [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];

  const broadcast = (m: ServerMessage): void => {
    const text = JSON.stringify(m);
    for (const s of sockets) s.send(text);
  };
  const unsubscribe = o.writer.on(broadcast);
  const mcpHandler = o.mcp ? createMcpHandler(() => o.mcp!({ confined: false }), { onerror: () => undefined }) : null;
  const workerHandler = o.mcp ? createMcpHandler(() => o.mcp!({ confined: true }), { onerror: () => undefined }) : null;
  const json = (res: ServerResponse, status: number, v: unknown) => {
    res.writeHead(status, { ...HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(v) + '\n');
  };

  /** MCP over HTTP: the web request handed to the SDK's handler, its response streamed back. */
  const serveMcp = async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> => {
    const auth = String(req.headers.authorization ?? '');
    const given = auth.startsWith('Bearer ') ? auth.slice(7) : url.searchParams.get('token');
    const workerToken = o.worker?.mcpToken() ?? null;
    const handler = !mcpHandler ? null : tokenOk(given, o.token) ? mcpHandler : workerToken && tokenOk(given, workerToken) ? workerHandler : null;
    if (!handler) {
      res.writeHead(mcpHandler ? 401 : 404, { ...HEADERS, 'Content-Type': 'text/plain' }).end(mcpHandler ? 'token required\n' : 'not found\n');
      return;
    }
    const body = req.method === 'POST' ? await readBody(req, 8 * 1024 * 1024) : undefined;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v); else if (Array.isArray(v)) headers.set(k, v.join(', '));
    const ac = new AbortController();
    res.on('close', () => ac.abort());
    const r = await handler.fetch(new Request(url, { method: req.method, headers, body: body ? new Uint8Array(body) : undefined, signal: ac.signal }));
    const out: Record<string, string> = {};
    r.headers.forEach((v, k) => { out[k] = v; });
    res.writeHead(r.status, out);
    if (!r.body) { res.end(); return; }
    const reader = r.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } catch {
      // the client went away
    }
    res.end();
  };

  const bearerOk = (req: IncomingMessage): boolean => {
    const auth = String(req.headers.authorization ?? '');
    return auth.startsWith('Bearer ') && tokenOk(auth.slice(7), o.token);
  };

  const handle = (req: IncomingMessage, res: ServerResponse): void => {
    // Only localhost names: a page on another site can't reach us by rebinding a DNS name.
    if (!allowedHosts().includes(String(req.headers.host))) {
      res.writeHead(421, HEADERS).end('wrong host\n');
      return;
    }
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const authed = tokenOk(url.searchParams.get('token'), o.token);
    if (url.pathname === '/mcp') {
      serveMcp(req, res, url).catch((e: unknown) => { if (!res.headersSent) json(res, 500, { error: (e as Error).message }); else res.end(); });
      return;
    }
    if (url.pathname === '/api/import' && req.method === 'POST') {
      // An import from the dashboard: { files: [{ name, data (base64) }], options, by }.
      if (!authed) { json(res, 401, { error: 'token required' }); return; }
      readBody(req, MAX_UPLOAD).then(async (b) => {
        const body = JSON.parse(b.toString('utf8')) as { files?: { name: string; data: string }[]; options?: ImportOptions; by?: string };
        if (typeof body.by !== 'string' || !HUMAN_RE.test(body.by)) throw new ProjectError('a page writes as human:<name>');
        if (!Array.isArray(body.files) || !body.files.length) throw new ProjectError('no files');
        const files = body.files.map((f) => ({ name: String(f.name), bytes: new Uint8Array(Buffer.from(String(f.data), 'base64')) }));
        const r = await o.writer.enqueue(() => importIntoProject(o.writer, { ...(body.options ?? {}), files }, body.by!));
        json(res, 200, r);
      }).catch((e: unknown) => json(res, e instanceof ProjectError || e instanceof SyntaxError ? 400 : 500, { error: (e as Error).message }));
      return;
    }
    if (url.pathname === '/api/cli' && req.method === 'POST') {
      // A CLI command run in another process, sent here so it goes through the writer's queue.
      if (!authed && !bearerOk(req)) { json(res, 401, { error: 'token required' }); return; }
      if (!o.runCli) { json(res, 501, { error: 'this server cannot run CLI commands' }); return; }
      readBody(req, MAX_UPLOAD).then(async (b) => {
        const body = JSON.parse(b.toString('utf8')) as { argv?: unknown; cwd?: unknown };
        if (!Array.isArray(body.argv) || !body.argv.every((x) => typeof x === 'string') || typeof body.cwd !== 'string') throw new ProjectError('argv and cwd are needed');
        const argv = body.argv as string[];
        if (!FORWARDED_COMMANDS.includes(argv[0] ?? '')) throw new ProjectError(`'${argv[0]}' is not sent through the server`);
        const cwd = body.cwd;
        const r = await o.writer.enqueue(() => {
          const out = o.runCli!(argv, o.writer, cwd);
          o.writer.requestsChanged();
          o.writer.planChanged();
          return out;
        });
        json(res, 200, r);
      }).catch((e: unknown) => json(res, e instanceof ProjectError || e instanceof SyntaxError ? 400 : 500, { error: (e as Error).message }));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, HEADERS).end();
      return;
    }
    if (url.pathname === '/api/await') {
      // Long poll: events after ?since= (a cursor), or none after ?timeout= seconds. ?as= names the listener.
      if (!authed && !bearerOk(req)) { json(res, 401, { error: 'token required' }); return; }
      const as = url.searchParams.get('as') ?? 'claude';
      if (!/^[A-Za-z0-9_.:-]{1,32}$/.test(as)) { json(res, 400, { error: 'as is a short name (letters, digits, . _ : -)' }); return; }
      const timeoutS = Number(url.searchParams.get('timeout') ?? 600);
      if (!Number.isFinite(timeoutS) || timeoutS < 0) { json(res, 400, { error: 'timeout is seconds' }); return; }
      const ac = new AbortController();
      res.on('close', () => ac.abort());
      awaitRequests(o.writer, { cursor: url.searchParams.get('since') ?? undefined, timeoutS, by: as, via: url.searchParams.get('via') === 'mcp' ? 'mcp' : 'cli', signal: ac.signal })
        .then((r) => { if (!res.writableEnded && !ac.signal.aborted) json(res, 200, r); }, (e: unknown) => { if (!res.writableEnded) json(res, 500, { error: (e as Error).message }); });
      return;
    }
    if (url.pathname === '/api/presence') {
      if (!authed && !bearerOk(req)) { json(res, 401, { error: 'token required' }); return; }
      json(res, 200, o.writer.hub.presence());
      return;
    }
    if (url.pathname === '/api/worker') {
      if (!authed) { json(res, 401, { error: 'token required' }); return; }
      json(res, 200, { status: o.writer.workerStatus(), log: workerLogTail(o.writer.project.dir) });
      return;
    }
    const sm = /^\/api\/strip\/([a-z][a-z0-9_-]*)\.png$/.exec(url.pathname);
    if (sm) {
      if (!authed) { json(res, 401, { error: 'token required' }); return; }
      void o.writer.enqueue(() => framesStrip(o.writer, sm[1]!)).then((png) => {
        res.writeHead(200, { ...HEADERS, 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
        res.end(png);
      }, () => { res.writeHead(404, { ...HEADERS, 'Content-Type': 'text/plain' }).end('not found\n'); });
      return;
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      if (!authed) {
        page(res, 401, 'token required', `<p>This view needs the link with its token, as printed when the server
          started (<code>pixelclaw: watch at http://127.0.0.1:${port}/?token=…</code>). Ask the agent for the
          link, or look in the server's log.</p>`);
        return;
      }
      if (!uiDir) {
        page(res, 503, 'UI not built', '<p>The watch view has not been built. Run <code>pnpm build</code> in the repo.</p>');
        return;
      }
      res.writeHead(200, { ...HEADERS, 'Content-Security-Policy': CSP, 'Content-Type': TYPES['.html']!, 'Cache-Control': 'no-store' });
      res.end(readFileSync(join(uiDir, 'index.html')));
      return;
    }
    if (url.pathname === '/api/state') {
      if (!authed) {
        res.writeHead(401, { ...HEADERS, 'Content-Type': 'application/json' }).end('{"error":"token required"}\n');
        return;
      }
      res.writeHead(200, { ...HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(o.writer.snapshot()));
      return;
    }
    if (url.pathname === '/api/plan') {
      if (!authed) {
        res.writeHead(401, { ...HEADERS, 'Content-Type': 'application/json' }).end('{"error":"token required"}\n');
        return;
      }
      void o.writer.enqueue(() => planReport(o.writer)).then((r) => {
        res.writeHead(200, { ...HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(r));
      }, (e: unknown) => {
        res.writeHead(500, { ...HEADERS, 'Content-Type': 'application/json' }).end(JSON.stringify({ error: (e as Error).message }) + '\n');
      });
      return;
    }
    const pm = /^\/api\/preview\/([a-z][a-z0-9_-]*)\.png$/.exec(url.pathname);
    if (pm) {
      const f = join(o.writer.project.dir, 'assets', pm[1]!, 'preview.png');
      if (!authed || !existsSync(f)) {
        res.writeHead(authed ? 404 : 401, { ...HEADERS, 'Content-Type': 'text/plain' }).end(authed ? 'not found\n' : 'token required\n');
        return;
      }
      res.writeHead(200, { ...HEADERS, 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      res.end(readFileSync(f));
      return;
    }
    // Underlay images (content-addressed, so they may be cached).
    const bm = /^\/api\/blob\/([0-9a-f]{64})\.png$/.exec(url.pathname);
    if (bm) {
      const f = join(o.writer.project.dir, 'blobs', `${bm[1]}.png`);
      if (!authed || !existsSync(f)) {
        res.writeHead(authed ? 404 : 401, { ...HEADERS, 'Content-Type': 'text/plain' }).end(authed ? 'not found\n' : 'token required\n');
        return;
      }
      res.writeHead(200, { ...HEADERS, 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400, immutable' });
      res.end(readFileSync(f));
      return;
    }
    if (uiDir && url.pathname.startsWith('/assets/')) {
      const file = normalize(join(uiDir, decodeURIComponent(url.pathname)));
      if (file.startsWith(join(uiDir, 'assets') + sep) && existsSync(file) && statSync(file).isFile()) {
        res.writeHead(200, {
          ...HEADERS, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
          'Cache-Control': 'public, max-age=31536000, immutable',
        });
        res.end(readFileSync(file));
        return;
      }
    }
    res.writeHead(404, { ...HEADERS, 'Content-Type': 'text/plain' }).end('not found\n');
  };

  const server: Server = createServer(handle);
  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (!allowedHosts().includes(String(req.headers.host)) || url.pathname !== '/ws') {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    if (!tokenOk(url.searchParams.get('token'), o.token)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }
    const ws = acceptWebSocket(req, socket);
    if (!ws) return;
    sockets.add(ws);
    ws.onclose = () => sockets.delete(ws);
    ws.onmessage = (text) => {
      let m: ClientMessage;
      try {
        m = JSON.parse(text) as ClientMessage;
      } catch {
        return;
      }
      if (m.type === 'ping') ws.send(JSON.stringify({ type: 'pong' } satisfies ServerMessage));
      else if (m.type === 'run') void runFromPage(o.writer, m).then((r) => ws.send(JSON.stringify(r)));
      else if (m.type === 'request') void requestFromPage(o.writer, m).then((r) => ws.send(JSON.stringify(r)));
      else if (m.type === 'worker') {
        const answer = (ok: boolean, error?: string) => ws.send(JSON.stringify({ type: 'answer', id: m.id, ok, ...(error ? { error } : {}) } satisfies ServerMessage));
        if (typeof m.by !== 'string' || !HUMAN_RE.test(m.by)) answer(false, 'a page writes as human:<name>');
        else if (!o.worker) answer(false, 'this server runs no worker');
        else {
          try {
            if (m.action === 'stop') o.worker.stop(m.by);
            else void o.worker.start(m.by).catch(() => undefined);
            answer(true);
          } catch (e) {
            answer(false, (e as Error).message);
          }
        }
      }
    };
    ws.send(JSON.stringify({ type: 'hello', snapshot: o.writer.snapshot() } satisfies ServerMessage));
  });

  const tries = o.port === 0 ? 1 : Math.max(1, o.tries ?? 20);
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(o.port === 0 ? 0 : o.port + i, host, () => {
          server.off('error', reject);
          resolve();
        });
      });
      lastErr = undefined;
      break;
    } catch (e) {
      lastErr = e;
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') break;
    }
  }
  if (lastErr) {
    unsubscribe();
    throw lastErr;
  }
  port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}/?token=${o.token}`;
  return {
    url, port, token: o.token,
    clients: () => sockets.size,
    close: () => new Promise<void>((resolve) => {
      unsubscribe();
      o.writer.hub.close();
      void mcpHandler?.close();
      for (const s of sockets) s.close(1001);
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}
