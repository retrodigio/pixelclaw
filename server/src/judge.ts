// The judge, server side: the setting, the questions file, the request to the API, the key, the
// cache and the results the surfaces show. The pure part (questions, answers, thresholds) is core's
// judge.ts. Off by default: nothing leaves the machine unless project.json says `judge.provider`.
//
//   "judge": { "provider": "none" | "jev", "model": "jev-1.14.0", "gate": false, "mockup": "templates/approved.png" }
//
// The key comes only from the environment (TYPESAFE_API_KEY). It is never written to the project,
// the log, a view or any text this module returns.

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  IMAGE_LIMITS, JUDGE_MODELS, JUDGE_PROVIDERS, MOCKUP_REF, aboutImage, boxMarks, confusionPairs, decodePng, defaultQuestionFile, encodePng, evaluate, parseAnswer,
  parseQuestionFile, prepareImage, renderFlat, renderTile3x3, resolveQuestions,
  type AssetFacts, type Answer, type ImageName, type JudgeFinding, type JudgeSettings, type Prepared, type QuestionFile, type ResolvedQuestion, type Rgba,
} from '@pixelclaw/core';
import { CACHE_DIR } from './cache.ts';
import { ProjectError, type Project } from './project.ts';
import { manifestEntry, readManifest } from './plan.ts';
import type { Writer } from './writer.ts';

export const JUDGE_URL = 'https://api.typesafe.ai/v1/systemone';
export const JUDGE_KEY_ENV = 'TYPESAFE_API_KEY';
export const QUESTIONS_FILE = 'judge/questions.json';
/** Dollars per million input tokens (output is free). Only used to show a cost estimate. */
export const JUDGE_PRICE_PER_M = 0.042;
/** A request over this is not sent (the API's limit is 32 MiB for the body). */
const BODY_LIMIT = 30 * 1024 * 1024;
const TIMEOUT_MS = 90_000;

// ---- settings and key ----

export interface JudgeSettingsRead {
  settings: JudgeSettings;
  /** Why project.json's `judge` is not usable (the judge then stays off). */
  problem: string | null;
}

/** project.json `judge`, read fresh each time. Off unless it says otherwise. */
export function judgeSettings(dir: string): JudgeSettingsRead {
  const off: JudgeSettings = { provider: 'none', model: '', gate: false };
  let raw: unknown;
  try {
    raw = (JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')) as { judge?: unknown }).judge;
  } catch {
    return { settings: off, problem: null };
  }
  if (raw === undefined) return { settings: off, problem: null };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { settings: off, problem: 'project.json judge: an object { "provider": "none" | "jev", "model", "gate" }' };
  const j = raw as Record<string, unknown>;
  const provider = j.provider ?? 'none';
  if (!(JUDGE_PROVIDERS as readonly unknown[]).includes(provider)) return { settings: off, problem: `project.json judge.provider: one of ${JUDGE_PROVIDERS.join(', ')} (not ${JSON.stringify(provider)})` };
  if (j.gate !== undefined && typeof j.gate !== 'boolean') return { settings: off, problem: 'project.json judge.gate: true or false' };
  if (j.model !== undefined && (typeof j.model !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(j.model))) return { settings: off, problem: 'project.json judge.model: a model name such as jev-1.14.0' };
  if (j.mockup !== undefined && typeof j.mockup !== 'string') return { settings: off, problem: 'project.json judge.mockup: a PNG path inside the project' };
  const p = provider as JudgeSettings['provider'];
  return {
    settings: { provider: p, model: (j.model as string | undefined) ?? JUDGE_MODELS[p] ?? '', gate: j.gate === true, ...(typeof j.mockup === 'string' ? { mockup: j.mockup } : {}) },
    problem: null,
  };
}

/** The API key from the environment, or undefined. */
export function judgeKey(env: Record<string, string | undefined> = process.env): string | undefined {
  const k = env[JUDGE_KEY_ENV]?.trim();
  return k ? k : undefined;
}

export interface JudgeEnv {
  key?: string;
  fetch?: typeof fetch;
  now?: () => string;
}

const sha = (b: string | Uint8Array): string => createHash('sha256').update(b).digest('hex');

// ---- questions ----

export interface QuestionsRead {
  file: QuestionFile;
  /** True when judge/questions.json is the project's own. */
  custom: boolean;
  problems: string[];
}

/** judge/questions.json, else the generic set. A broken file is reported and the generic set used. */
export function loadQuestions(p: Project): QuestionsRead {
  const f = join(p.dir, QUESTIONS_FILE);
  if (!existsSync(f)) return { file: defaultQuestionFile(), custom: false, problems: [] };
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(f, 'utf8'));
  } catch (e) {
    return { file: defaultQuestionFile(), custom: false, problems: [`${QUESTIONS_FILE} is not JSON (${(e as Error).message}); the default questions are used`] };
  }
  const r = parseQuestionFile(json);
  if (!r.file) return { file: defaultQuestionFile(), custom: false, problems: r.problems.map((x) => `${QUESTIONS_FILE}: ${x.path ? x.path + ': ' : ''}${x.message}`).concat('the default questions are used') };
  return { file: r.file, custom: true, problems: [] };
}

// ---- the stored results ----

interface Stored {
  finding: JudgeFinding;
  /** The question as asked + model, the asset's state, and the pictures: a finding is current when its question and (state or pictures) match. */
  ctx: string;
  state: string;
  content: string;
}

interface Store {
  asset: string;
  model: string;
  at: string;
  findings: Record<string, Stored>;
  /** The last request that failed, until one succeeds. */
  error?: { message: string; at: string };
}

const storeFile = (p: Project, asset: string) => join(p.dir, CACHE_DIR, 'judge', 'results', `${asset}.json`);
export const logFile = (p: Project) => join(p.dir, CACHE_DIR, 'judge', 'requests.jsonl');

function ensureCacheDir(p: Project): void {
  const d = join(p.dir, CACHE_DIR);
  mkdirSync(d, { recursive: true });
  // The cache folder holds its own .gitignore (cache.ts writes the same one).
  if (!existsSync(join(d, '.gitignore'))) writeFileSync(join(d, '.gitignore'), '*\n');
}

function readStore(p: Project, asset: string): Store | null {
  try {
    const s = JSON.parse(readFileSync(storeFile(p, asset), 'utf8')) as Store;
    return s && typeof s === 'object' && s.findings ? s : null;
  } catch {
    return null;
  }
}

function writeStore(p: Project, s: Store): void {
  ensureCacheDir(p);
  const f = storeFile(p, s.asset);
  mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(s));
  renameSync(tmp, f);
}

// ---- what an asset is, for the questions ----

function factsOf(w: Writer, name: string, hasMockup: boolean): AssetFacts {
  const p = w.project;
  const m = readManifest(p).manifest;
  const e = manifestEntry(m, name);
  const doc = w.doc(name);
  const set = e ? e.set ?? e.kind : doc.kind;
  const peers = (m?.assets.filter((a) => (a.set ?? a.kind) === set && a.name !== name && !a.reference) ?? [])
    .map((a) => ({ name: a.name, description: a.description ?? '' }));
  if (!m) for (const n of w.assets()) if (n !== name) { try { if (w.doc(n).kind === doc.kind) peers.push({ name: n, description: '' }); } catch { /* not loadable */ } }
  const groups = new Set(w.state(name).entries.map((x) => x.group)).size;
  return {
    name, kind: doc.kind, set, description: e?.description ?? '', theme: m?.theme ?? '', reads: e?.reads ?? [],
    peers: peers.sort((a, b) => (a.name < b.name ? -1 : 1)).slice(0, 30), hasMockup, hasPrevious: groups >= 2,
  };
}

/** The approved mockup (a PNG inside the project) and a key for its bytes; null when none is set or it cannot be read. */
function mockupOf(p: Project, s: JudgeSettings): { img: Rgba; key: string } | null {
  if (!s.mockup) return null;
  const f = resolve(p.dir, s.mockup);
  const rel = relative(resolve(p.dir), f);
  if (rel.startsWith('..') || isAbsolute(rel) || !existsSync(f)) return null;
  try {
    const bytes = readFileSync(f);
    return { img: decodePng(bytes), key: sha(bytes) };
  } catch {
    return null;
  }
}

// ---- pictures ----

interface Picture {
  prep: Prepared;
  png: Uint8Array;
  hash: string;
}

function picture(img: Rgba): Picture {
  const prep = prepareImage(img);
  const png = encodePng(prep.img);
  return { prep, png, hash: sha(png) };
}

/** The picture of an asset the model is shown: `render` at its pixels, or one of the views. */
function gather(w: Writer, asset: string, name: ImageName): Rgba | null {
  const doc = w.doc(asset);
  switch (name) {
    case 'render':
      if (doc.map || doc.family) {
        const v = w.view(asset, 'map');
        return v.kind === 'image' ? decodePng(v.png) : null;
      }
      return renderFlat(doc, 0);
    case 'after':
      return renderFlat(doc, 0);
    case 'before': {
      const entries = w.state(asset).entries;
      const g = entries.at(-1)?.group;
      const since = (entries.find((e) => e.group === g)?.seq ?? 1) - 1;
      const prev = since > 0 ? w.docAt(asset, since) : null;
      return prev ? renderFlat(prev, 0) : null;
    }
    case 'tile3x3':
      return renderTile3x3(doc, 0);
    case 'map':
    case 'game': {
      const v = w.view(asset, name);
      return v.kind === 'image' ? decodePng(v.png) : null;
    }
  }
}

// ---- the request ----

interface Wire {
  type: 'noul' | 'choice' | 'score' | 'box';
  instructions: string;
  criteria?: unknown;
}

export interface BuiltRequest {
  /** What is sent. */
  body: Record<string, unknown>;
  /** What is logged: the same with each image replaced by its size and hash (and no key anywhere). */
  logged: Record<string, unknown>;
}

const deep = (v: unknown, f: (s: string) => string): unknown =>
  typeof v === 'string' ? f(v) : Array.isArray(v) ? v.map((x) => deep(x, f)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x, f)])) : v;

/**
 * One request for one asset: every question, the asset's pictures once each in the state, and the
 * pictures as assets under references nothing else in the request can contain. Pure: the pictures
 * come in, nothing is read or sent here.
 */
export function buildRequest(o: {
  model: string;
  facts: Pick<AssetFacts, 'name' | 'kind' | 'description'>;
  questions: ResolvedQuestion[];
  pictures: Partial<Record<ImageName, Picture>>;
  mockup?: Picture;
}): BuiltRequest {
  const used = new Set<ImageName>();
  for (const q of o.questions) {
    for (const i of q.images) used.add(i);
    if (q.locate) used.add('render');
  }
  const useMockup = o.questions.some((q) => q.usesMockup) && !!o.mockup;
  const refs: Record<string, string> = {};
  const assets: Record<string, unknown> = {};
  const logged: Record<string, unknown> = {};
  const add = (name: string, pic: Picture) => {
    const ref = `pcjudge-${name}-${pic.hash.slice(0, 12)}`;
    refs[name] = ref;
    assets[ref] = { type: 'image', format: 'png', data_base64: Buffer.from(pic.png).toString('base64') };
    logged[ref] = { type: 'image', format: 'png', bytes: pic.png.length, sha256: pic.hash, width: pic.prep.img.width, height: pic.prep.img.height };
  };
  const state: Record<string, unknown> = { asset: { name: o.facts.name, kind: o.facts.kind, ...(o.facts.description ? { description: o.facts.description } : {}) }, pictures: {} };
  for (const n of [...used].sort()) {
    const pic = o.pictures[n];
    if (!pic) continue;
    add(n, pic);
    state[n] = refs[n];
    (state.pictures as Record<string, string>)[n] = aboutImage(n);
  }
  if (useMockup) add('mockup', o.mockup!);
  const questions: Record<string, Wire> = {};
  for (const q of o.questions) {
    const w: Wire = { type: q.ask, instructions: q.instructions, ...(q.criteria !== undefined ? { criteria: q.criteria } : {}) };
    questions[q.id] = useMockup ? (deep(w, (s) => s.split(MOCKUP_REF).join(refs.mockup!)) as Wire) : w;
    if (q.locate) questions[q.locate.id] = { type: 'box', instructions: q.locate.instructions };
  }
  const body = { model: o.model, state, assets, questions };
  return { body, logged: { ...body, assets: logged } };
}

// ---- asking ----

/** Replace any trace of the key in a message (it is never expected there; this is the belt to that brace). */
function redact(s: string, key: string | undefined): string {
  return key ? s.split(key).join('[key]') : s;
}

interface Reply {
  answers: Record<string, unknown>;
  inputTokens: number;
}

async function post(body: Record<string, unknown>, env: JudgeEnv, key: string): Promise<Reply> {
  const text = JSON.stringify(body);
  if (Buffer.byteLength(text) > BODY_LIMIT) throw new ProjectError('the request would be over 30 MiB (the API takes 32 MiB); judge a smaller asset');
  const f = env.fetch ?? fetch;
  let res: Response;
  try {
    res = await f(JUDGE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'TypeSafe-Danger-Zone-Images': 'true' },
      body: text,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new ProjectError(`could not reach the judge: ${redact((e as Error).message, key)}`);
  }
  const raw = await res.text().catch(() => '');
  if (!res.ok) {
    let detail = raw.slice(0, 300);
    try {
      const j = JSON.parse(raw) as { detail?: unknown };
      if (j.detail !== undefined) detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail).slice(0, 300);
    } catch { /* not JSON: the text will do */ }
    throw new ProjectError(`the judge answered ${res.status}${detail ? `: ${redact(detail, key)}` : ''}`);
  }
  let j: { answers?: unknown; usage?: { input_tokens?: unknown } };
  try {
    j = JSON.parse(raw);
  } catch {
    throw new ProjectError('the judge sent something that is not JSON');
  }
  if (!j.answers || typeof j.answers !== 'object') throw new ProjectError('the judge sent no answers');
  const t = j.usage?.input_tokens;
  return { answers: j.answers as Record<string, unknown>, inputTokens: typeof t === 'number' ? t : 0 };
}

// ---- planning (inside the writer's queue) and running (outside) ----

export interface JudgeOptions {
  /** Ask again even when the answers are current. */
  fresh?: boolean;
  /** Only these question ids (a `reads` id covers all its reads). */
  questions?: string[];
}

interface AskPlan {
  asset: string;
  model: string;
  facts: AssetFacts;
  resolved: ResolvedQuestion[];
  /** Current findings (kept), by id. */
  kept: Map<string, Stored>;
  ask: ResolvedQuestion[];
  keys: Map<string, { ctx: string; state: string; content: string }>;
  pictures: Partial<Record<ImageName, Picture>>;
  mockup?: Picture;
  /** A plain asset: its `render` picture is the canvas itself, so a box on it maps back to canvas pixels. */
  flat: boolean;
  /** Findings for questions that could not be asked at all (a picture could not be made). */
  failed: Map<string, JudgeFinding>;
  prior: Store | null;
}

export interface JudgePlan {
  settings: JudgeSettings;
  problem: string | null;
  questionProblems: string[];
  assets: AskPlan[];
  /** Assets that could not be planned: name → why. */
  errors: Record<string, string>;
}

const stateKeyFor = (w: Writer, asset: string, world: boolean): string =>
  world ? sha(`${w.stateKeyOf(asset)}\n${w.assets().map((n) => `${n}:${w.stateKeyOf(n)}`).join('\n')}`) : w.stateKeyOf(asset);

const needsWorld = (q: ResolvedQuestion, doc: { map?: unknown; family?: unknown }) => q.images.some((i) => i === 'map' || i === 'game') || !!doc.map || !!doc.family;

/** Work out what to ask for these assets (all when none are named). Runs in the writer's queue: it reads documents and renders pictures. */
export function planJudge(w: Writer, names: string[] | undefined, o: JudgeOptions = {}): JudgePlan {
  const p = w.project;
  const { settings, problem } = judgeSettings(p.dir);
  const qr = loadQuestions(p);
  const plan: JudgePlan = { settings, problem, questionProblems: qr.problems, assets: [], errors: {} };
  if (settings.provider === 'none') return plan;
  const all = w.assets();
  for (const n of names ?? all) if (!all.includes(n)) plan.errors[n] = `no asset '${n}'`;
  const mock = mockupOf(p, settings);
  const mockPic = mock ? picture(mock.img) : undefined;
  for (const asset of (names ?? all).filter((n) => all.includes(n))) {
    try {
      const facts = factsOf(w, asset, !!mockPic);
      const resolved = resolveQuestions(qr.file, facts, o.questions);
      const doc = w.doc(asset);
      const prior = readStore(p, asset);
      const keys = new Map<string, { ctx: string; state: string; content: string }>();
      const kept = new Map<string, Stored>();
      const ctxOf = (q: ResolvedQuestion) => sha(JSON.stringify([q, settings.model, q.usesMockup ? mock?.key : null]));
      let stale: ResolvedQuestion[] = [];
      for (const q of resolved) {
        const k = { ctx: ctxOf(q), state: stateKeyFor(w, asset, needsWorld(q, doc)), content: '' };
        keys.set(q.id, k);
        const s = prior?.findings[q.id];
        if (!o.fresh && s && s.ctx === k.ctx && s.state === k.state) kept.set(q.id, s);
        else stale.push(q);
      }
      const pictures: Partial<Record<ImageName, Picture>> = {};
      const failed = new Map<string, JudgeFinding>();
      if (stale.length) {
        const need = new Set<ImageName>(stale.flatMap((q) => [...q.images, ...(q.locate ? (['render'] as const) : [])]));
        const why = new Map<ImageName, string>();
        for (const n of need) {
          try {
            const img = gather(w, asset, n);
            if (img) pictures[n] = picture(img);
            else why.set(n, n === 'before' ? 'there is no earlier version' : `no ${n} picture`);
          } catch (e) {
            why.set(n, `cannot make the ${n} picture: ${(e as Error).message}`);
          }
        }
        const still: ResolvedQuestion[] = [];
        for (const q of stale) {
          const missing = q.images.find((i) => !pictures[i]);
          if (missing) {
            const skipped = missing === 'before';
            failed.set(q.id, {
              id: q.id, label: q.label, type: q.type, text: q.instructions, p: null, expect: q.expect, yes: q.yes, no: q.no,
              status: skipped ? 'skip' : 'error', detail: why.get(missing) ?? `no ${missing} picture`,
            });
            continue;
          }
          const k = keys.get(q.id)!;
          k.content = sha(JSON.stringify([k.ctx, q.images.map((i) => pictures[i]!.hash), q.locate ? pictures.render?.hash : null]));
          const s = prior?.findings[q.id];
          // The same pictures as when it was asked (an undo, a change that left the art alone): current.
          if (!o.fresh && s && s.ctx === k.ctx && s.content === k.content) kept.set(q.id, { ...s, state: k.state });
          else still.push(q);
        }
        stale = still;
      }
      // An identity question on a change that left the art as it was has nothing to compare.
      if (resolved.some((q) => q.type === 'identity') && pictures.before && pictures.after && pictures.before.hash === pictures.after.hash) {
        stale = stale.filter((q) => {
          if (q.type !== 'identity') return true;
          failed.set(q.id, { id: q.id, label: q.label, type: q.type, text: q.instructions, p: null, expect: q.expect, yes: q.yes, no: q.no, status: 'skip', detail: 'the last change left the art as it was' });
          return false;
        });
      }
      plan.assets.push({ asset, model: settings.model, facts, resolved, kept, ask: stale, keys, pictures, mockup: mockPic, flat: !doc.map && !doc.family, failed, prior });
    } catch (e) {
      plan.errors[asset] = (e as Error).message;
    }
  }
  return plan;
}

export interface AssetRun {
  asset: string;
  findings: JudgeFinding[];
  /** Questions answered by the API this run, and answered from the cache. */
  asked: number;
  cached: number;
  inputTokens: number;
  /** The request failed (or could not be made): nothing was answered. */
  error?: string;
}

export interface JudgeRun {
  settings: JudgeSettings;
  assets: AssetRun[];
  /** Why nothing could run (off, no key, bad setting). */
  refused?: string;
  notes: string[];
  inputTokens: number;
  cost: number;
}

/** Asset-level notes for a run that did not happen. */
function refusal(plan: JudgePlan, key: string | undefined): string | undefined {
  if (plan.problem) return plan.problem;
  if (plan.settings.provider === 'none') return 'the judge is off: set "judge": { "provider": "jev" } in project.json (it sends images to a third-party API; docs/judge.md)';
  if (!key) return `${JUDGE_KEY_ENV} is not set in the environment: the judge needs an API key (docs/judge.md)`;
  return undefined;
}

/** Annotate each failing recognisable finding that is half of a confused pair. Mutates the findings. */
export function annotateConfusions(byAsset: Map<string, JudgeFinding[]>): void {
  const picks: Record<string, string> = {};
  for (const [a, fs] of byAsset) {
    const r = fs.find((f) => f.type === 'recognisable' && f.status !== 'error' && f.pick);
    if (r?.pick) picks[a] = r.pick;
  }
  for (const [a, b] of confusionPairs(picks)) {
    for (const [x, y] of [[a, b], [b, a]] as const) {
      const f = byAsset.get(x)?.find((q) => q.type === 'recognisable');
      if (f && !f.detail.includes('each other')) f.detail += `; ${x} and ${y} are read as each other`;
    }
  }
}

/** Send the plan: one request per asset that has questions to ask. Not in the writer's queue (a request takes seconds). */
export async function runJudge(w: Writer, plan: JudgePlan, env: JudgeEnv = {}): Promise<JudgeRun> {
  const p = w.project;
  const key = env.key ?? judgeKey();
  const out: JudgeRun = { settings: plan.settings, assets: [], notes: [...plan.questionProblems], inputTokens: 0, cost: 0 };
  for (const [a, e] of Object.entries(plan.errors)) out.assets.push({ asset: a, findings: [], asked: 0, cached: 0, inputTokens: 0, error: e });
  const refused = refusal(plan, key);
  if (refused) {
    out.refused = refused;
    return out;
  }
  const now = env.now ?? (() => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
  for (const ap of plan.assets) {
    const run: AssetRun = { asset: ap.asset, findings: [], asked: 0, cached: ap.kept.size, inputTokens: 0 };
    const answered = new Map<string, Stored>(ap.kept);
    let error: string | undefined;
    if (ap.ask.length) {
      try {
        const req = buildRequest({ model: ap.model, facts: ap.facts, questions: ap.ask, pictures: ap.pictures, mockup: ap.mockup });
        ensureCacheDir(p);
        mkdirSync(dirname(logFile(p)), { recursive: true });
        appendFileSync(logFile(p), JSON.stringify({ at: now(), asset: ap.asset, url: JUDGE_URL, headers: { 'TypeSafe-Danger-Zone-Images': 'true' }, body: req.logged }) + '\n');
        const reply = await post(req.body, env, key!);
        run.inputTokens = reply.inputTokens;
        for (const q of ap.ask) {
          const k = ap.keys.get(q.id)!;
          const main = parseAnswer(q.ask, reply.answers[q.id]);
          let f: JudgeFinding;
          if (!main.ok) f = { id: q.id, label: q.label, type: q.type, text: q.instructions, p: null, expect: q.expect, yes: q.yes, no: q.no, status: 'error', detail: main.error };
          else {
            f = evaluate(q, main.answer as Answer);
            if (q.locate && f.status === 'fail') {
              const b = parseAnswer('box', reply.answers[q.locate.id]);
              const pic = ap.pictures.render;
              if (b.ok && b.answer.type === 'box' && pic) {
                f.box = b.answer.box;
                if (ap.flat) f.marks = boxMarks(b.answer.box, pic.prep);
              }
            }
          }
          if (f.status === 'error') ap.failed.set(q.id, f);
          else answered.set(q.id, { finding: f, ctx: k.ctx, state: k.state, content: k.content });
          if (f.status !== 'error') run.asked++;
        }
      } catch (e) {
        error = redact((e as Error).message, key);
      }
    }
    if (error) run.error = error;
    // Nothing to compare is an answer too (kept while the art and the question are as they were).
    for (const [id, f] of ap.failed) if (f.status === 'skip') answered.set(id, { finding: f, ctx: ap.keys.get(id)!.ctx, state: ap.keys.get(id)!.state, content: '' });
    const prior = ap.prior;
    if (answered.size || error || prior) {
      writeStore(p, {
        asset: ap.asset, model: ap.model, at: now(),
        findings: Object.fromEntries([...answered].map(([id, s]) => [id, s])),
        ...(error ? { error: { message: error, at: now() } } : {}),
      });
    }
    run.findings = ap.resolved.flatMap((q) => answered.get(q.id)?.finding ?? ap.failed.get(q.id) ?? []);
    out.assets.push(run);
    out.inputTokens += run.inputTokens;
  }
  out.cost = (out.inputTokens * JUDGE_PRICE_PER_M) / 1e6;
  // Confusions: this run's picks, with the stored ones of the assets it did not cover.
  const by = new Map<string, JudgeFinding[]>();
  for (const a of out.assets) by.set(a.asset, a.findings);
  for (const n of w.assets()) if (!by.has(n)) by.set(n, Object.values(readStore(p, n)?.findings ?? {}).map((s) => ({ ...s.finding })));
  annotateConfusions(by);
  return out;
}

// ---- reading the results back (check, the dashboard, the gate) ----

export interface JudgeReport {
  /** The judge is on for this project. */
  enabled: boolean;
  gate: boolean;
  model: string;
  asset: string;
  /** Current findings. */
  findings: JudgeFinding[];
  /** Question ids that apply but have no current answer. */
  notAsked: string[];
  /** The last request failed (and nothing since has answered). */
  error: string | null;
  problems: string[];
}

/** The stored, still-current results for an asset. Never calls the API. */
export function judgeReport(w: Writer, asset: string, shared?: Map<string, JudgeFinding[]>): JudgeReport {
  const p = w.project;
  const { settings, problem } = judgeSettings(p.dir);
  const base: JudgeReport = { enabled: settings.provider !== 'none', gate: settings.gate, model: settings.model, asset, findings: [], notAsked: [], error: null, problems: problem ? [problem] : [] };
  if (!base.enabled) return base;
  const qr = loadQuestions(p);
  base.problems.push(...qr.problems);
  const mock = mockupOf(p, settings);
  const store = readStore(p, asset);
  const doc = w.doc(asset);
  const resolved = resolveQuestions(qr.file, factsOf(w, asset, !!mock));
  const mockHash = mock?.key ?? null;
  for (const q of resolved) {
    const ctx = sha(JSON.stringify([q, settings.model, q.usesMockup ? mockHash : null]));
    const s = store?.findings[q.id];
    if (s && s.ctx === ctx && s.state === stateKeyFor(w, asset, needsWorld(q, doc))) base.findings.push({ ...s.finding });
    else base.notAsked.push(q.id);
  }
  // A stored skip (nothing to compare) is current while the question is; an identity that was never asked is not "not asked" when there is no earlier version.
  if (store?.error && base.notAsked.length) base.error = store.error.message;
  const by = shared ?? new Map<string, JudgeFinding[]>();
  by.set(asset, base.findings);
  if (!shared) for (const n of w.assets()) if (n !== asset) by.set(n, Object.values(readStore(p, n)?.findings ?? {}).map((s) => ({ ...s.finding })));
  annotateConfusions(by);
  return base;
}

/** What stops `done` when the project gates on the judge (empty: nothing does). */
export function judgeBlockers(w: Writer, asset: string): string[] {
  const { settings } = judgeSettings(w.project.dir);
  if (settings.provider === 'none' || !settings.gate) return [];
  const r = judgeReport(w, asset);
  const out = r.findings.filter((f) => f.status === 'fail').map((f) => `  judge ${f.label}: ${f.detail}`);
  if (r.notAsked.length) out.push(`  judge has no current answer for ${r.notAsked.join(', ')}${r.error ? ` (the last request failed: ${r.error})` : ''}: run the judge on ${asset} (pixelclaw judge / the judge tool)`);
  return out;
}

// ---- text ----

const f2 = (n: number) => n.toFixed(2);
const mark = { pass: '✓', fail: '✗', unsure: '?', error: '!', skip: '–' } as const;

/** The label column: the longest label (at most 30), at least 14. */
const labelWidth = (fs: readonly JudgeFinding[]): number => Math.min(30, Math.max(14, ...fs.map((f) => f.label.length)));

function limitOf(f: JudgeFinding): string {
  return f.expect === 'yes' ? `≥ ${f2(f.yes)}` : `≤ ${f2(f.no)}`;
}

/** The judge's table for one asset, as `check` prints it (an empty string when the judge is off). */
export function formatJudge(r: JudgeReport, dir = '<project>'): string {
  if (!r.enabled) return '';
  const out = [`judge ${r.asset}: ${r.gate ? 'gates done' : 'advisory'}, ${r.model} (thresholds: sure at ≥ yes / ≤ no; between is "unsure")`];
  const fs = r.findings;
  for (const f of fs) {
    const p = f.p === null ? '–' : f2(f.p);
    out.push(`  ${mark[f.status]}  ${f.label.padEnd(labelWidth(fs))} ${p.padEnd(5)} ${limitOf(f).padEnd(7)} ${f.status === 'unsure' ? 'unsure: ' : ''}${f.detail}`);
    if (f.marks?.length && f.status === 'fail') out.push(`       marks: ${f.marks.slice(0, 24).map(([x, y]) => `${x},${y}`).join(' ')}${f.marks.length > 24 ? ` … and ${f.marks.length - 24} more` : ''}`);
  }
  if (r.notAsked.length) out.push(`  not asked yet: ${r.notAsked.join(', ')} (pixelclaw judge ${dir} ${r.asset})`);
  if (r.error) out.push(`  error: the last request failed: ${r.error}`);
  for (const pr of r.problems) out.push(`  note: ${pr}`);
  return out.join('\n');
}

/** A whole run as text. */
export function formatRun(run: JudgeRun): string {
  if (run.refused) return `judge: ${run.refused}`;
  const out: string[] = [];
  for (const a of run.assets) {
    if (a.error) {
      out.push(`${a.asset}: error: ${a.error}`);
      continue;
    }
    const bad = a.findings.filter((f) => f.status === 'fail').length;
    const unsure = a.findings.filter((f) => f.status === 'unsure').length;
    out.push(`${a.asset}: ${a.findings.length ? `${a.findings.length - bad - unsure} pass${bad ? `, ${bad} fail` : ''}${unsure ? `, ${unsure} unsure` : ''}` : 'no questions apply'} (${a.asked} asked, ${a.cached} from the cache)`);
    for (const f of a.findings) {
      const fs = a.findings;
      const p = f.p === null ? '–' : f2(f.p);
      out.push(`  ${mark[f.status]}  ${f.label.padEnd(labelWidth(fs))} ${p.padEnd(5)} ${limitOf(f).padEnd(7)} ${f.status === 'unsure' ? 'unsure: ' : ''}${f.detail}`);
      if (f.marks?.length && f.status === 'fail') out.push(`       marks: ${f.marks.slice(0, 24).map(([x, y]) => `${x},${y}`).join(' ')}${f.marks.length > 24 ? ` … and ${f.marks.length - 24} more` : ''}`);
    }
  }
  for (const n of run.notes) out.push(`note: ${n}`);
  out.push(`judge (${run.settings.model}, ${run.settings.gate ? 'gates done' : 'advisory'}): ${run.inputTokens} input tokens${run.inputTokens ? `, about $${run.cost.toFixed(5)}` : ''}`);
  return out.join('\n');
}

/** Image limits the pictures are held to (for docs and tests). */
export const PICTURE_LIMITS = IMAGE_LIMITS;
