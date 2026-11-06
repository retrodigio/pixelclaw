// The judge against a mocked HTTP layer (answers in the API's documented shapes): the request it
// builds, thresholds and "unsure", the cache, errors that are never answers, recognisability,
// boxes as marks, the gate, and that the key stays out of everything.

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodePng, defaultQuestionFile, importPalette } from '@pixelclaw/core';
import {
  JUDGE_URL, Writer, createProject, formatJudge, formatRun, judgeBlockers, judgeReport, judgeSettings, logFile, planJudge, runJudge, writeManifest,
  type JudgeEnv, type JudgeRun,
} from '../src/index.ts';
import { PALETTE } from './spawn.ts';

const KEY = 'tsk_test_0123456789abcdef';
let root: string;
let w: Writer;

interface Sent { url: string; headers: Record<string, string>; body: any }

/** A fake API: records requests; `answer` builds the answers for one request's questions. */
function fake(answer: (id: string, q: any, body: any) => unknown, o: { status?: number; text?: string; throws?: string } = {}): { env: JudgeEnv; sent: Sent[] } {
  const sent: Sent[] = [];
  const f = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    if (o.throws) throw new Error(o.throws);
    const body = JSON.parse(init.body);
    sent.push({ url, headers: init.headers, body });
    if (o.status && o.status >= 400) return new Response(o.text ?? JSON.stringify({ detail: 'bad request' }), { status: o.status });
    const answers = Object.fromEntries(Object.entries<any>(body.questions).map(([id, q]) => [id, answer(id, q, body)]));
    return new Response(JSON.stringify({ model: body.model, answers, usage: { input_tokens: 1000, output_tokens: 10 } }));
  }) as unknown as typeof fetch;
  return { env: { key: KEY, fetch: f, now: () => '2026-11-06T10:00:00Z' }, sent };
}

const noul = (p: number) => ({ type: 'noul', noul: p });
const choice = (pick: string, probabilities: Record<string, number>) => ({ type: 'choice', choice: pick, confidence: 0.6, probabilities });
const box = (b = { top: 0.25, bottom: 0.5, left: 0.5, right: 0.75 }) => ({ type: 'box', box: b, confidence: null });

/** Answers that pass everything: each sprite is picked as itself. */
const happy = (self: string) => (id: string, q: any) =>
  q.type === 'box' ? box() : q.type === 'choice' ? choice(self, { ...Object.fromEntries(Object.keys(q.criteria).map((k) => [k, 0.02])), [self]: 0.9 }) : noul(id === 'stray' ? 0.05 : 0.9);

async function ask(names?: string[], env?: JudgeEnv, o: { fresh?: boolean; questions?: string[] } = {}): Promise<JudgeRun> {
  const plan = await w.enqueue(() => planJudge(w, names, o));
  return runJudge(w, plan, env);
}

function setup(judge: object | null = { provider: 'jev', gate: false }) {
  root = mkdtempSync(join(tmpdir(), 'pixelclaw-judge-'));
  const dir = join(root, 'ruins.pclaw');
  const p = createProject(dir, { palettes: [importPalette('mossy-ruins.json', readFileSync(PALETTE, 'utf8'))] });
  if (judge) writeFileSync(join(dir, 'project.json'), JSON.stringify({ ...p.json, judge }, null, 2));
  w = new Writer({ ...p, json: JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')) });
  writeManifest(w.project, {
    format: 'pixelclaw-manifest', version: 1, theme: 'Old stone under moss.',
    assets: [
      { name: 'urn', kind: 'sprite', size: '16x16', set: 'props', description: 'a squat stone urn', reads: ['a rim at the top'] },
      { name: 'jar', kind: 'sprite', size: '16x16', set: 'props', description: 'a clay jar' },
      { name: 'turf', kind: 'tile', size: '16x16', set: 'ground', description: 'short moss' },
    ],
  });
  const draw = (asset: string, extra = '') => {
    const r = w.run({ asset: asset === 'turf' ? 'turf' : asset, by: 'claude', commands: `new ${asset === 'turf' ? 'tile' : 'sprite'} ${asset} 16x16\nrect 3,3 10x10 c=stone3 fill\nrect 3,3 10x10 c=ink${extra ? '\n' + extra : ''}` });
    if (!r.ok) throw new Error(r.errors.map((e) => e.message).join('; '));
  };
  draw('urn');
  draw('jar', 'px 8,8 c=stone4');
  draw('turf');
}

beforeEach(() => setup());
afterEach(() => rmSync(root, { recursive: true, force: true }));

const png = (b64: string) => decodePng(Buffer.from(b64, 'base64'));

describe('the setting', () => {
  it('is off by default and read fresh from project.json', () => {
    expect(judgeSettings(w.project.dir).settings).toMatchObject({ provider: 'jev', model: 'jev-1.14.0', gate: false });
    const f = join(w.project.dir, 'project.json');
    const pj = JSON.parse(readFileSync(f, 'utf8'));
    delete pj.judge;
    writeFileSync(f, JSON.stringify(pj));
    expect(judgeSettings(w.project.dir).settings.provider).toBe('none');
    writeFileSync(f, JSON.stringify({ ...pj, judge: { provider: 'gpt' } }));
    const bad = judgeSettings(w.project.dir);
    expect(bad.settings.provider).toBe('none');
    expect(bad.problem).toContain('judge.provider');
  });
  it('refuses to run when off or without a key, and says why', async () => {
    const pj = JSON.parse(readFileSync(join(w.project.dir, 'project.json'), 'utf8'));
    const keyless = fake(happy('urn'));
    const noKey = await ask(['urn'], { ...keyless.env, key: undefined });
    expect(noKey.refused).toContain('TYPESAFE_API_KEY');
    expect(keyless.sent).toHaveLength(0);
    writeFileSync(join(w.project.dir, 'project.json'), JSON.stringify({ ...pj, judge: { provider: 'none' } }));
    const off = await ask(['urn'], fake(happy('urn')).env);
    expect(off.refused).toContain('off');
  });
});

describe('the request', () => {
  it('is one request per asset with the pictures in the state once, however many questions', async () => {
    const f = fake(happy('urn'));
    const run = await ask(['urn'], f.env);
    expect(f.sent).toHaveLength(1);
    const { url, headers, body } = f.sent[0]!;
    expect(url).toBe(JUDGE_URL);
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(headers['TypeSafe-Danger-Zone-Images']).toBe('true');
    expect(body.model).toBe('jev-1.14.0');
    // recognisable, reads.1, stray (+ its box): several questions, one picture
    expect(Object.keys(body.questions)).toEqual(['recognisable', 'reads.1', 'stray', 'stray__box']);
    expect(body.questions.stray__box.type).toBe('box');
    expect(Object.keys(body.assets)).toHaveLength(1);
    const ref = body.state.render as string;
    expect(Object.keys(body.assets)).toEqual([ref]);
    expect(JSON.stringify(body).split(ref).length - 1).toBe(2); // once in the state, once as the asset's key
    expect(body.state.asset).toMatchObject({ name: 'urn', kind: 'sprite' });
    expect(body.questions.recognisable.criteria).toEqual({ jar: 'a clay jar', urn: 'a squat stone urn' });
    expect(run.assets[0]!.asked).toBe(3);
  });
  it('sends pixel art upscaled by a whole number within the size limits', async () => {
    const f = fake(happy('urn'));
    await ask(['urn'], f.env);
    const asset = Object.values<any>(f.sent[0]!.body.assets)[0];
    expect(asset).toMatchObject({ type: 'image', format: 'png' });
    const img = png(asset.data_base64);
    expect(img.width).toBeGreaterThanOrEqual(280);
    expect(img.width).toBeLessThanOrEqual(1568);
    expect(img.width % 16).toBe(0);
    expect(img.height).toBe(img.width);
  });
  it('gives each picture of a request its own reference, and sends two for an edit comparison', async () => {
    w.run({ asset: 'urn', by: 'claude', commands: 'px 1,1 c=stone4' });
    const f = fake(happy('urn'));
    await ask(['urn'], f.env, { questions: ['identity'] });
    const b = f.sent[0]!.body;
    expect(Object.keys(b.questions)).toEqual(['identity']);
    expect(b.state.before).not.toBe(b.state.after);
    expect(new Set(Object.keys(b.assets)).size).toBe(2);
    for (const ref of Object.keys(b.assets)) expect(JSON.stringify(b.state)).toContain(ref);
    expect(b.questions.identity.instructions).toContain('`before`');
  });
  it('logs the exact payload without image bytes and without the key', async () => {
    const f = fake(happy('urn'));
    await ask(['urn'], f.env);
    const log = readFileSync(logFile(w.project), 'utf8');
    expect(log).not.toContain(KEY);
    expect(log).not.toContain('data_base64');
    const rec = JSON.parse(log.trim().split('\n')[0]!);
    expect(rec.body.questions).toEqual(f.sent[0]!.body.questions);
    expect(rec.body.model).toBe('jev-1.14.0');
    expect(Object.values<any>(rec.body.assets)[0]).toMatchObject({ type: 'image', sha256: expect.any(String), width: expect.any(Number) });
  });
  it('puts the approved mockup in the style question\'s criteria when one is set', async () => {
    const pj = JSON.parse(readFileSync(join(w.project.dir, 'project.json'), 'utf8'));
    const mock = join(w.project.dir, 'approved.png');
    writeFileSync(mock, readFileSync(join(w.project.dir, 'assets', 'urn', 'preview.png')));
    writeFileSync(join(w.project.dir, 'project.json'), JSON.stringify({ ...pj, judge: { provider: 'jev', mockup: 'approved.png' } }));
    const f = fake(happy('urn'));
    await ask(['urn'], f.env, { questions: ['style'] });
    const b = f.sent[0]!.body;
    const crit = b.questions.style.criteria;
    expect(Object.keys(b.assets)).toHaveLength(2);
    expect(Object.keys(b.assets)).toContain(crit.true.examples[0]);
    expect(Object.values(b.state)).toContain(b.state.render);
  });
});

describe('answers', () => {
  it('become findings with the thresholds, and "unsure" between them', async () => {
    const f = fake((id, q) => (q.type === 'box' ? box() : q.type === 'choice' ? choice('urn', { urn: 0.95, jar: 0.05 }) : id === 'reads.1' ? noul(0.5) : noul(0.1)));
    const run = await ask(['urn'], f.env);
    const by = Object.fromEntries(run.assets[0]!.findings.map((x) => [x.id, x]));
    expect(by.recognisable).toMatchObject({ status: 'pass', p: 0.95 });
    expect(by['reads.1']).toMatchObject({ status: 'unsure', p: 0.5, label: 'reads: a rim at the top' });
    expect(by.stray).toMatchObject({ status: 'pass', expect: 'no' });
    const text = formatJudge(judgeReport(w, 'urn'));
    expect(text).toContain('? ');
    expect(text).toContain('unsure: ');
    expect(text).toContain('advisory');
    expect(formatRun(run)).toContain('1000 input tokens');
  });
  it('turn a box into marked pixels when a no-question fails', async () => {
    const f = fake((id, q) => (q.type === 'box' ? box({ top: 0.25, bottom: 0.5, left: 0.5, right: 0.75 }) : q.type === 'choice' ? choice('urn', { urn: 0.95, jar: 0.05 }) : id === 'stray' ? noul(0.9) : noul(0.9)));
    const run = await ask(['urn'], f.env);
    const stray = run.assets[0]!.findings.find((x) => x.id === 'stray')!;
    expect(stray.status).toBe('fail');
    expect(stray.box).toEqual({ top: 0.25, bottom: 0.5, left: 0.5, right: 0.75 });
    expect(stray.marks!.length).toBeGreaterThan(4);
    expect(stray.marks!.every(([x, y]) => x >= 0 && x < 16 && y >= 0 && y < 16)).toBe(true);
    expect(formatJudge(judgeReport(w, 'urn'))).toContain('marks: 8,4');
  });
  it('flag a sprite not picked as itself and two sprites picked as each other', async () => {
    const f = fake((id, q) => {
      if (q.type === 'box') return box();
      if (q.type === 'choice') return q.instructions && 'urn' in q.criteria && f.sent.at(-1)!.body.state.asset.name === 'urn' ? choice('jar', { urn: 0.1, jar: 0.85 }) : choice('urn', { urn: 0.8, jar: 0.15 });
      return noul(id === 'stray' ? 0.05 : 0.9);
    });
    const run = await ask(['urn', 'jar'], f.env);
    const rec = (a: string) => run.assets.find((x) => x.asset === a)!.findings.find((x) => x.id === 'recognisable')!;
    expect(rec('urn').status).toBe('fail');
    expect(rec('jar').status).toBe('fail');
    expect(rec('urn').detail).toContain('urn and jar are read as each other');
    expect(f.sent).toHaveLength(2);
  });
  it('are errors, not answers, when the response is malformed', async () => {
    const f = fake((id, q) => (id === 'recognisable' ? { type: 'noul', noul: 0.9 } : q.type === 'box' ? box() : noul(0.1)));
    const run = await ask(['urn'], f.env);
    const r = run.assets[0]!.findings.find((x) => x.id === 'recognisable')!;
    expect(r.status).toBe('error');
    expect(r.p).toBeNull();
    // not stored: it is asked again next time
    expect(judgeReport(w, 'urn').notAsked).toContain('recognisable');
  });
});

describe('the cache', () => {
  it('does not ask again for an unchanged asset and question set', async () => {
    const f = fake(happy('urn'));
    await ask(['urn'], f.env);
    const again = await ask(['urn'], f.env);
    expect(f.sent).toHaveLength(1);
    expect(again.assets[0]).toMatchObject({ asked: 0, cached: 3 });
    expect(again.inputTokens).toBe(0);
    expect(judgeReport(w, 'urn')).toMatchObject({ notAsked: [] });
  });
  it('asks again with fresh, after the art changes, or after the questions change', async () => {
    const f = fake(happy('urn'));
    await ask(['urn'], f.env);
    await ask(['urn'], f.env, { fresh: true });
    expect(f.sent).toHaveLength(2);
    w.run({ asset: 'urn', by: 'claude', commands: 'px 1,1 c=stone4' });
    expect(judgeReport(w, 'urn').notAsked.length).toBeGreaterThan(0);
    await ask(['urn'], f.env);
    expect(f.sent).toHaveLength(3);
    // The questions file changes one question's wording: only that one is asked again.
    mkdirSync(join(w.project.dir, 'judge'));
    const qs = defaultQuestionFile();
    qs.questions.find((q) => q.id === 'stray')!.text = 'Is something loose in `render`?';
    writeFileSync(join(w.project.dir, 'judge', 'questions.json'), JSON.stringify({ format: 'pixelclaw-judge-questions', version: 1, questions: qs.questions }));
    const run = await ask(['urn'], f.env);
    expect(f.sent).toHaveLength(4);
    expect(Object.keys(f.sent[3]!.body.questions)).toEqual(['stray', 'stray__box']);
    expect(run.assets[0]!.cached).toBe(3); // recognisable, reads and identity
  }, 30_000);
  it('reports a broken questions file and falls back to the default set', async () => {
    mkdirSync(join(w.project.dir, 'judge'));
    writeFileSync(join(w.project.dir, 'judge', 'questions.json'), JSON.stringify({ format: 'pixelclaw-judge-questions', version: 1, questions: [{ id: 'x', type: 'noul' }] }));
    const run = await ask(['urn'], fake(happy('urn')).env);
    expect(run.notes.join('\n')).toContain('judge/questions.json');
    expect(run.assets[0]!.asked).toBe(3);
  });
  it('keeps answers when the art is put back as it was (same pictures)', async () => {
    const f = fake(happy('urn'));
    await ask(['urn'], f.env, { questions: ['recognisable'] });
    w.run({ asset: 'urn', by: 'claude', commands: 'px 1,1 c=stone4' });
    w.run({ asset: 'urn', by: 'claude', commands: 'px 1,1 c=none' });
    const again = await ask(['urn'], f.env, { questions: ['recognisable'] });
    expect(f.sent).toHaveLength(1);
    expect(again.assets[0]!.cached).toBe(1);
  });
  it('asks only the questions that are stale, in one request', async () => {
    const f = fake(happy('urn'));
    await ask(['urn'], f.env, { questions: ['recognisable'] });
    const run = await ask(['urn'], f.env);
    expect(f.sent).toHaveLength(2);
    expect(Object.keys(f.sent[1]!.body.questions)).toEqual(['reads.1', 'stray', 'stray__box']);
    expect(run.assets[0]).toMatchObject({ asked: 2, cached: 1 });
  });
  it('is kept under .cache, which a project never commits', async () => {
    await ask(['urn'], fake(happy('urn')).env);
    expect(readFileSync(join(w.project.dir, '.cache', '.gitignore'), 'utf8')).toContain('*');
    expect(statSync(join(w.project.dir, '.cache', 'judge', 'results', 'urn.json')).isFile()).toBe(true);
  });
});

describe('errors', () => {
  it('a server error, a client error and a network failure surface as errors with nothing answered', async () => {
    for (const [o, want] of [[{ status: 500, text: 'boom' }, '500'], [{ status: 400, text: JSON.stringify({ detail: 'image too small' }) }, 'image too small'], [{ throws: `fetch failed ${KEY}` }, 'could not reach']] as const) {
      const f = fake(happy('urn'), o);
      const run = await ask(['urn'], f.env, { fresh: true });
      const a = run.assets[0]!;
      expect(a.error, want).toContain(want);
      expect(a.findings).toEqual([]);
      expect(JSON.stringify(run)).not.toContain(KEY);
      expect(formatRun(run)).not.toContain(KEY);
    }
    const r = judgeReport(w, 'urn');
    expect(r.error).toContain('could not reach');
    expect(r.findings).toEqual([]);
    expect(formatJudge(r)).not.toContain(KEY);
    expect(formatJudge(r)).toContain('error:');
  });
  it('an unknown asset is an error result, and the others still run', async () => {
    const f = fake(happy('urn'));
    const run = await ask(['urn', 'nope'], f.env);
    expect(run.assets.find((x) => x.asset === 'nope')!.error).toContain("no asset 'nope'");
    expect(run.assets.find((x) => x.asset === 'urn')!.asked).toBe(3);
  });
  it('the key is in no file of the project', async () => {
    await ask(['urn', 'jar', 'turf'], fake(happy('urn')).env);
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    for (const f of walk(w.project.dir)) expect(readFileSync(f).includes(KEY), f).toBe(false);
  });
});

describe('the gate', () => {
  it('is advisory by default and blocks on failures and missing answers when gate is true', async () => {
    expect(judgeBlockers(w, 'urn')).toEqual([]);
    const pj = JSON.parse(readFileSync(join(w.project.dir, 'project.json'), 'utf8'));
    writeFileSync(join(w.project.dir, 'project.json'), JSON.stringify({ ...pj, judge: { provider: 'jev', gate: true } }));
    expect(judgeBlockers(w, 'urn').join('\n')).toContain('no current answer');
    await ask(['urn'], fake((id, q) => (q.type === 'box' ? box() : q.type === 'choice' ? choice('jar', { urn: 0.1, jar: 0.9 }) : noul(id === 'stray' ? 0.05 : 0.9))).env);
    const blockers = judgeBlockers(w, 'urn');
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain('judge recognisable');
    await ask(['urn'], fake(happy('urn')).env, { fresh: true });
    expect(judgeBlockers(w, 'urn')).toEqual([]);
    expect(formatJudge(judgeReport(w, 'urn'))).toContain('gates done');
  });
  it('treats "unsure" as not blocking', async () => {
    const pj = JSON.parse(readFileSync(join(w.project.dir, 'project.json'), 'utf8'));
    writeFileSync(join(w.project.dir, 'project.json'), JSON.stringify({ ...pj, judge: { provider: 'jev', gate: true } }));
    await ask(['urn'], fake((id, q) => (q.type === 'box' ? box() : q.type === 'choice' ? choice('urn', { urn: 0.5, jar: 0.5 }) : noul(0.5))).env);
    expect(judgeBlockers(w, 'urn')).toEqual([]);
  });
});
