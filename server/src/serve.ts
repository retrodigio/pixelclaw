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

export const VERSION = '0.2.0';
export const DEFAULT_PORT = 7417;

export interface ServeOptions {
  /** The project folder; created (empty) if it has no project.json. */
  project: string;
  /** The port to try first (then the next 19); 0 picks a free one. Default 7417. */
  port?: number;
  /** Speak MCP on stdin/stdout (default). Without it, serve only the watch view. */
  mcp?: boolean;
  token?: string;
  log?: (line: string) => void;
}

export interface Served {
  url: string;
  port: number;
  token: string;
  writer: Writer;
  web: WatchServer;
  /** Stop everything: MCP, the web server and the project lock. */
  close(): Promise<void>;
  /** Resolves once the server has stopped (stdin closed, a signal, or close()). */
  closed: Promise<void>;
}

function openProject(dir: string, create: boolean, name: string | undefined, log: (s: string) => void): Project {
  if (existsSync(join(dir, 'project.json'))) return loadProject(dir);
  if (!create) throw new ProjectError(`${dir} is not a Pixel Claw project (no project.json); pass create: true to make one`);
  log(`pixelclaw: created an empty project at ${dir}`);
  return createProject(dir, { name, palettes: [] });
}

export async function serve(o: ServeOptions): Promise<Served> {
  const log = o.log ?? ((s: string) => process.stderr.write(s + '\n'));
  const token = o.token ?? randomBytes(16).toString('hex');
  const dir = resolve(o.project);
  const writer = new Writer(openProject(dir, true, undefined, log));
  const web = await startWatchServer({ writer, token, port: o.port ?? DEFAULT_PORT });
  try {
    acquireLock(dir, web.url);
  } catch (e) {
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
      releaseLock(writer.project.dir);
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
    const host = {
      writer,
      url: () => web.url,
      open(path: string, oo: { create: boolean; name?: string }) {
        const next = resolve(path);
        if (next === writer.project.dir) return;
        const p = openProject(next, oo.create, oo.name, log);
        acquireLock(next, web.url);
        releaseLock(writer.project.dir);
        writer.setProject(p);
        log(`pixelclaw: now serving ${next}`);
      },
    };
    mcp = serveStdio(() => createMcpServer(host, VERSION), { onerror: (e) => log(`pixelclaw: mcp: ${e.message}`) });
    // When the agent goes away (stdin closes), so does the server.
    process.stdin.on('end', onEnd);
  }
  log(`pixelclaw: serving ${dir}`);
  log(`pixelclaw: watch at ${web.url}`);
  return { url: web.url, port: web.port, token, writer, web, close, closed };
}
