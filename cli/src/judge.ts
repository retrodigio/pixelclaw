// `pixelclaw judge <project> [<asset>...] [--questions <id,...>] [--fresh]`: ask the judge (an
// optional model, off by default; docs/judge.md) and print its table. It reads the project and
// writes only the judge's own cache, so it runs directly even while a server holds the project.

import { Writer, formatRun, loadProject, planJudge, runJudge, type JudgeEnv } from '@pixelclaw/server';
import { UsageError, one, parseArgs, type Io } from './main.ts';

export async function judgeMain(argv: string[], io: Pick<Io, 'out' | 'err'>, env: JudgeEnv = {}): Promise<number> {
  const p = parseArgs(argv, ['questions'], ['fresh']);
  const [dir, ...names] = p.pos;
  if (!dir) throw new UsageError('judge: give a project folder');
  const ids = one(p, 'questions')?.split(',').map((x) => x.trim()).filter(Boolean);
  const w = new Writer(loadProject(dir));
  const plan = planJudge(w, names.length ? names : undefined, { fresh: p.flags.has('fresh'), questions: ids });
  const run = await runJudge(w, plan, env);
  io.out(formatRun(run) + '\n');
  const marked = run.assets.find((a) => a.findings.some((f) => f.status === 'fail' && f.marks?.length));
  if (marked) {
    const v = w.view(marked.asset, 'render', { markPixels: marked.findings.flatMap((f) => (f.status === 'fail' ? f.marks ?? [] : [])) });
    io.out(`  wrote ${v.path} (the located problems circled)\n`);
  }
  if (run.refused) return 1;
  return run.assets.some((a) => a.error || a.findings.some((f) => f.status === 'fail' || f.status === 'error')) ? 1 : 0;
}
