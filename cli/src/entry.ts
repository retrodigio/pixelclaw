// The pixelclaw executable: every command but `serve` is synchronous (main.ts); `serve` runs
// until the agent disconnects or the process is stopped.

import { DEFAULT_PORT, serve } from '@pixelclaw/server/serve';
import { ProjectError } from '@pixelclaw/server';
import { USAGE, UsageError, main, one, parseArgs } from './main.ts';

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

export async function cli(argv: string[]): Promise<number> {
  if (argv[0] === 'serve') {
    const code = await serveMain(argv.slice(1));
    // Nothing else should keep the process alive once the server has stopped.
    process.exit(code);
  }
  return main(argv);
}
