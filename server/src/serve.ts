// `pixelclaw serve`: one process that owns a project. It speaks MCP on stdin/stdout (for the
// agent) and serves the watch view on localhost (for people), both through one writer. Logs go
// to stderr, since stdout carries MCP.

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { startWatchServer, type WatchServer } from './http.ts';
import { createMcpServer } from './mcp.ts';
import { ProjectError, acquireLock, createProject, loadProject, releaseLock, type Project } from './project.ts';
import { Writer } from './writer.ts';
import { WorkerControl } from './worker.ts';
import { removeTokenFile, writeTokenFile } from './runfile.ts';

export const VERSION = '0.3.0';
export const DEFAULT_PORT = 7417;

export interface ServeOptions {
  /** The project folder; created (empty) if it has no project.json. */
  project: string;
  /** The port to try first (then the next 19); 0 picks a free one. Default 7417. */
  port?: number;
  /** Speak MCP on stdin/stdout (default). Without it, serve only the watch view. */
  mcp?: boolean;
  token?: string;
  /** Runs a CLI invocation against the writer, for commands sent by another `pixelclaw` process (the CLI supplies it). */
  runCli?: (argv: string[], writer: Writer, cwd: string) => { code: number; stdout: string; stderr: string };
  log?: (line: string) => void;
}

export interface Served {
  url: string;
  port: number;
  token: string;
  writer: Writer;
  web: WatchServer;
  /** The headless worker (started from the dashboard, or by \`pixelclaw work\`). */
  worker: WorkerControl;
  /** Stop everything: MCP, the worker, the web server and the project lock. */
  close(): Promise<void>;
  /** Resolves once the server has stopped (stdin closed, a signal, or close()). */
  closed: Promise<void>;
}

function openProject(dir: string, create: boolean, name: string | undefined, log: (s: string) => void): Project {
  if (existsSync(join(dir, 'project.json'))) return loadProject(dir);
  if (!create) throw new ProjectError(`${dir} is not a PixelClaw project (no project.json); pass create: true to make one`);
  log(`pixelclaw: created an empty project at ${dir}`);
  return createProject(dir, { name, palettes: [] });
}

export async function serve(o: ServeOptions): Promise<Served> {
  const log = o.log ?? ((s: string) => process.stderr.write(s + '\n'));
  const token = o.token ?? randomBytes(16).toString('hex');
  const dir = resolve(o.project);
  const writer = new Writer(openProject(dir, true, undefined, log));
  let web!: WatchServer;
  const host = {
    writer,
    url: () => web.url,
    open(path: string, oo: { create: boolean; name?: string }) {
      const next = resolve(path);
      if (next === writer.project.dir) return;
      if (worker.running()) throw new ProjectError('the worker is running on this project; stop it before opening another');
      const p = openProject(next, oo.create, oo.name, log);
      acquireLock(next, web.url);
      writeTokenFile(next, { url: web.url.replace(/\?.*$/, ''), token });
      releaseLock(writer.project.dir);
      removeTokenFile(writer.project.dir);
      writer.setProject(p);
      log(`pixelclaw: now serving ${next}`);
    },
  };
  const worker = new WorkerControl(writer, () => ({ url: `http://127.0.0.1:${web.port}/mcp` }));
  web = await startWatchServer({ writer, token, port: o.port ?? DEFAULT_PORT, mcp: (m) => createMcpServer(host, VERSION, m), worker, runCli: o.runCli });
  try {
    acquireLock(dir, web.url);
    writeTokenFile(dir, { url: web.url.replace(/\?.*$/, ''), token });
  } catch (e) {
    releaseLock(dir);
    await web.close();
    throw e;
  }

  let mcp: StdioServerHandle | null = null;
  let stopping: Promise<void> | null = null;
  let done!: () => void;
  const closed = new Promise<void>((r) => { done = r; });
  const close = (): Promise<void> => {
    stopping ??= (async () => {
      process.stdin.off('end', onEnd);
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      if (worker.running()) worker.stop('the server stopping');
      await worker.settled();
      releaseLock(writer.project.dir);
      removeTokenFile(writer.project.dir);
      await mcp?.close().catch(() => undefined);
      await web.close();
      done();
    })();
    return stopping;
  };
  const onEnd = (): void => { void close(); };
  const onSignal = (): void => { void close(); };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  if (o.mcp ?? true) {
    mcp = serveStdio(() => createMcpServer(host, VERSION), { onerror: (e) => log(`pixelclaw: mcp: ${e.message}`) });
    // When the agent goes away (stdin closes), so does the server.
    process.stdin.on('end', onEnd);
  }
  log(`pixelclaw: serving ${dir}`);
  log(`pixelclaw: watch at ${web.url}`);
  return { url: web.url, port: web.port, token, writer, web, worker, close, closed };
}
