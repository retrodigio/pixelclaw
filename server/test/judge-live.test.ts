// An opt-in smoke test of the real judge: one small request about one of the repo's own example
// assets. It runs only when TYPESAFE_API_KEY is set in the environment, and never in CI:
//
//   TYPESAFE_API_KEY=… pnpm vitest run server/test/judge-live.test.ts
//
// It costs a few thousandths of a cent.

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Writer, formatRun, loadProject, planJudge, runJudge } from '../src/index.ts';
import { REPO } from './spawn.ts';

const key = process.env.TYPESAFE_API_KEY;
const live = !!key && !process.env.CI;
let root = '';

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!live)('the real judge (TYPESAFE_API_KEY is set)', () => {
  it('answers one question about the example chest', async () => {
    root = mkdtempSync(join(tmpdir(), 'pixelclaw-judge-live-'));
    const src = join(REPO, 'examples', 'mossy-ruins.pclaw');
    const dir = join(root, 'ruins.pclaw');
    cpSync(src, dir, { recursive: true, filter: (f) => !/[\\/](exports|views|\.cache)([\\/]|$)/.test(f) && !/[\\/]assets[\\/](?!chest([\\/]|$))[^\\/]+/.test(f.slice(src.length)) });
    const pj = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'));
    writeFileSync(join(dir, 'project.json'), JSON.stringify({ ...pj, judge: { provider: 'jev' } }, null, 2));
    const w = new Writer(loadProject(dir));
    const plan = await w.enqueue(() => planJudge(w, ['chest'], { questions: ['stray'] }));
    const run = await runJudge(w, plan);
    const out = formatRun(run);
    expect(run.refused, out).toBeUndefined();
    const a = run.assets[0]!;
    expect(a.error, out).toBeUndefined();
    expect(a.findings).toHaveLength(1);
    const f = a.findings[0]!;
    expect(f.p).toBeGreaterThanOrEqual(0);
    expect(f.p).toBeLessThanOrEqual(1);
    expect(['pass', 'fail', 'unsure']).toContain(f.status);
    expect(run.inputTokens).toBeGreaterThan(0);
    expect(out).not.toContain(key!);
    console.log(out);
  }, 60_000);
});
