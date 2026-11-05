// The pixelclaw executable: every command but `serve` is synchronous (main.ts); `serve` runs
// until the agent disconnects or the process is stopped.

import { DEFAULT_PORT, serve } from '@pixelclaw/server/serve';
import { ProjectError, lockHolder, workerLockHolder, workerSettings } from '@pixelclaw/server';
import { resolve } from 'node:path';
import { USAGE, UsageError, main, one, parseArgs, resolveRunArgv } from './main.ts';

async function serveMain(argv: string[]): Promise<number> {
  try {
    const p = parseArgs(argv, ['project', 'port', 'token'], ['no-mcp']);
    const project = one(p, 'project') ?? p.pos[0];
    if (!project) throw new UsageError('serve: give a project folder with --project <dir>');
    if (p.pos.length > (one(p, 'project') ? 0 : 1)) throw new UsageError(`serve: unexpected argument '${p.pos.at(-1)}'`);
    const portS = one(p, 'port');
    const port = portS === undefined ? DEFAULT_PORT : Number(portS);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError('--port must be 0..65535');
    const s = await serve({ project, port, mcp: !p.flags.has('no-mcp'), token: one(p, 'token') });
    await s.closed;
    return 0;
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`error: ${e.message}\n\n${USAGE}`);
      return 2;
    }
    if (e instanceof ProjectError) {
      process.stderr.write(`error: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
}

/** `pixelclaw work`: a server of its own (watch view and MCP over HTTP), then the worker until it stops. */
export async function workMain(argv: string[]): Promise<number> {
  try {
    const p = parseArgs(argv, ['port'], []);
    const [project] = p.pos;
    if (!project || p.pos.length > 1) throw new UsageError('work: give one project folder');
    const dir = resolve(project);
    const s = workerSettings(dir);
    if (!s.enabled) throw new ProjectError(`the worker is off for ${dir}: set "worker": { "enabled": true } in its project.json first (it runs Claude Code headless and spends money, up to "cap" US dollars a run, default ${s.cap}; see docs/worker.md)`);
    const held = lockHolder(dir);
    if (held) throw new ProjectError(`a pixelclaw server (pid ${held.pid}) owns ${dir}: start the worker from its dashboard (Start Claude) instead`);
    const w = workerLockHolder(dir);
    if (w) throw new ProjectError(`a worker is already running for ${dir} (pid ${w.pid}, started by ${w.by} at ${w.startedAt})`);
    const portS = one(p, 'port');
    const port = portS === undefined ? 0 : Number(portS);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError('--port must be 0..65535');
    const served = await serve({ project: dir, port, mcp: false });
    let why: string;
    try {
      why = await served.worker.start('cli');
    } finally {
      await served.close();
    }
    process.stderr.write(`pixelclaw: worker stopped: ${why}\n`);
    return 0;
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`error: ${e.message}\n\n${USAGE}`);
      return 2;
    }
    if (e instanceof ProjectError) {
      process.stderr.write(`error: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
}

export async function cli(argv: string[]): Promise<number> {
  // A reader that stops early (`pixelclaw plan … | head`) closes the pipe: stop quietly, as Unix
  // tools do, instead of failing on an unhandled EPIPE.
  process.stdout.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EPIPE') process.exit(0);
    throw e;
  });
  if (argv[0] === 'work') process.exit(await workMain(argv.slice(1)));
  if (argv[0] === 'serve') {
    const code = await serveMain(argv.slice(1));
    // Nothing else should keep the process alive once the server has stopped.
    process.exit(code);
  }
  if (argv[0] === 'run') {
    try {
      return main(await resolveRunArgv(argv));
    } catch (e) {
      if (e instanceof ProjectError) {
        process.stderr.write(`error: ${e.message}\n`);
        return 1;
      }
      throw e;
    }
  }
  return main(argv);
}
