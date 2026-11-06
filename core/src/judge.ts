// The judge: an optional second opinion on pixel art from a model that answers typed questions
// with probabilities, beside the code checks. This module is the pure part: the questions as data
// (judge/questions.json), which of them apply to an asset, how a response is read, thresholds,
// recognisability, how an image is prepared for the API's size limits, and how a box becomes
// marked pixels. The network, the key and the cache are in the server (server/src/judge.ts).

import { createRgba, type Rgba } from './png.ts';
import type { Pt } from './raster.ts';
import { ABOUT, DEFAULT_QUESTIONS, IDENTITY, LOCATE, READS, RECOGNISABLE, STYLE } from './judge-text.ts';

export const JUDGE_FORMAT = 'pixelclaw-judge-questions';
export const JUDGE_PROVIDERS = ['none', 'jev'] as const;
export type JudgeProvider = (typeof JUDGE_PROVIDERS)[number];
export const JUDGE_MODELS: Record<string, string> = { jev: 'jev-1.14.0' };

/** project.json `judge`. */
export interface JudgeSettings {
  provider: JudgeProvider;
  model: string;
  /** Failing judge questions block `done` like failing checks (default: advisory). */
  gate: boolean;
  /** The approved mockup image (a PNG in the project folder) the style question compares with. */
  mockup?: string;
}

export const DEFAULT_THRESHOLDS = { yes: 0.7, no: 0.3 };

/** The image limits of the API: each side 280..1568 px. */
export const IMAGE_LIMITS = { min: 280, max: 1568, aim: 512 };
/** What transparent and padded areas of a prepared image are filled with. */
export const BACKDROP = [128, 128, 128, 255] as const;

export const IMAGE_NAMES = ['render', 'tile3x3', 'map', 'game', 'before', 'after'] as const;
export type ImageName = (typeof IMAGE_NAMES)[number];

export const QUESTION_TYPES = ['noul', 'choice', 'score', 'recognisable', 'reads', 'style', 'identity'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** One entry of judge/questions.json. */
export interface QuestionSpec {
  id: string;
  type: QuestionType;
  /** The question (noul, choice, score). Placeholders: {name} {kind} {description} {theme}. */
  text?: string;
  /** Which assets it applies to: kinds, manifest sets, names; `skip` names are left out. All empty: every asset. */
  kinds?: string[];
  sets?: string[];
  assets?: string[];
  skip?: string[];
  /** The picture the question is about when its text names none (default render). */
  image?: ImageName;
  /** Which answer is the good one: "yes" (default) or "no" (for "are there seams?"). */
  expect?: 'yes' | 'no';
  yes?: number;
  no?: number;
  /** choice: the options (name → description) and the one that passes. */
  options?: Record<string, string>;
  want?: string;
  /** score: the levels from low to high; the score is held to the thresholds as a share of the top level. */
  levels?: string[];
  /** When it fails, ask a box question for this ("the stray blob") and turn it into marked pixels. */
  locate?: string;
  off?: boolean;
}

export interface QuestionFile {
  thresholds: { yes: number; no: number };
  questions: QuestionSpec[];
}

export interface QuestionProblem {
  path: string;
  message: string;
}

const ID_RE = /^[a-z][a-z0-9_.-]*$/;
const SPEC_KEYS = new Set(['id', 'type', 'text', 'kinds', 'sets', 'assets', 'skip', 'image', 'expect', 'yes', 'no', 'options', 'want', 'levels', 'locate', 'off']);

/** Read judge/questions.json: `{ format, version: 1, thresholds?, questions: [...] }`. */
export function parseQuestionFile(json: unknown): { file: QuestionFile | null; problems: QuestionProblem[] } {
  const problems: QuestionProblem[] = [];
  const err = (path: string, message: string) => problems.push({ path, message });
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { file: null, problems: [{ path: '', message: 'the questions file is a JSON object' }] };
  const o = json as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!['format', 'version', 'thresholds', 'questions'].includes(k)) err(k, `unknown field '${k}'`);
  if (o.format !== JUDGE_FORMAT) err('format', `must be "${JUDGE_FORMAT}"`);
  if (o.version !== 1) err('version', 'must be 1');
  const th = { ...DEFAULT_THRESHOLDS };
  if (o.thresholds !== undefined) {
    const t = o.thresholds as Record<string, unknown>;
    if (!t || typeof t !== 'object') err('thresholds', '{ "yes": 0.7, "no": 0.3 }');
    else {
      for (const k of ['yes', 'no'] as const) {
        if (t[k] === undefined) continue;
        if (typeof t[k] === 'number' && (t[k] as number) >= 0 && (t[k] as number) <= 1) th[k] = t[k] as number;
        else err(`thresholds.${k}`, 'a number 0..1');
      }
      if (th.no >= th.yes) err('thresholds', '"no" must be below "yes"');
    }
  }
  const qs: QuestionSpec[] = [];
  if (!Array.isArray(o.questions)) err('questions', 'a list of questions');
  else {
    const seen = new Set<string>();
    o.questions.forEach((raw, i) => {
      const at = (k: string) => `questions[${i}].${k}`;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return err(`questions[${i}]`, 'a question is an object');
      const q = raw as Record<string, unknown>;
      for (const k of Object.keys(q)) if (!SPEC_KEYS.has(k)) err(at(k), `unknown field '${k}'`);
      if (typeof q.id !== 'string' || !ID_RE.test(q.id)) err(at('id'), 'an id of a-z, 0-9, _, - and . starting with a letter');
      else if (seen.has(q.id)) err(at('id'), `'${q.id}' is used twice`);
      else seen.add(q.id);
      if (!(QUESTION_TYPES as readonly unknown[]).includes(q.type)) err(at('type'), `one of ${QUESTION_TYPES.join(', ')}`);
      for (const k of ['kinds', 'sets', 'assets', 'skip'] as const) {
        if (q[k] !== undefined && (!Array.isArray(q[k]) || !(q[k] as unknown[]).every((x) => typeof x === 'string'))) err(at(k), 'a list of names');
      }
      if (q.image !== undefined && !(IMAGE_NAMES as readonly unknown[]).includes(q.image)) err(at('image'), `one of ${IMAGE_NAMES.join(', ')}`);
      if (q.expect !== undefined && q.expect !== 'yes' && q.expect !== 'no') err(at('expect'), '"yes" or "no"');
      for (const k of ['yes', 'no'] as const) if (q[k] !== undefined && !(typeof q[k] === 'number' && (q[k] as number) >= 0 && (q[k] as number) <= 1)) err(at(k), 'a number 0..1');
      if (q.text !== undefined && typeof q.text !== 'string') err(at('text'), 'text');
      if (['noul', 'choice', 'score'].includes(q.type as string) && (typeof q.text !== 'string' || !q.text.trim())) err(at('text'), `a ${q.type} question needs its text`);
      if (q.type === 'choice') {
        const op = q.options as Record<string, unknown> | undefined;
        if (!op || typeof op !== 'object' || Object.keys(op).length < 2 || !Object.values(op).every((v) => typeof v === 'string')) err(at('options'), 'at least two options: { "name": "what it is" }');
        else if (typeof q.want !== 'string' || !(q.want in op)) err(at('want'), 'the name of the option that passes');
      }
      if (q.type === 'score' && (!Array.isArray(q.levels) || q.levels.length < 2 || !q.levels.every((x) => typeof x === 'string'))) err(at('levels'), 'at least two level descriptions, low to high');
      if (q.locate !== undefined && typeof q.locate !== 'string') err(at('locate'), 'what to place, e.g. "the stray blob"');
      if (q.off !== undefined && typeof q.off !== 'boolean') err(at('off'), 'true or false');
      qs.push(q as unknown as QuestionSpec);
    });
  }
  return { file: problems.length ? null : { thresholds: th, questions: qs }, problems };
}

/** The default question file: the generic set and the default thresholds. */
export function defaultQuestionFile(): QuestionFile {
  return { thresholds: { ...DEFAULT_THRESHOLDS }, questions: DEFAULT_QUESTIONS.map((q) => ({ ...q })) };
}

// ---- thresholds ----

export type Verdict = 'pass' | 'fail' | 'unsure';

/** A probability against the thresholds: ≥ yes is a yes, ≤ no is a no, between is unsure. `expect` says which is good. */
export function verdictOf(p: number, expect: 'yes' | 'no', yes: number, no: number): Verdict {
  const answer = p >= yes ? 'yes' : p <= no ? 'no' : null;
  return answer === null ? 'unsure' : answer === expect ? 'pass' : 'fail';
}

// ---- what to ask of an asset ----

export interface AssetFacts {
  name: string;
  kind: string;
  set: string;
  description: string;
  theme: string;
  /** The manifest's feature reads for it. */
  reads: string[];
  /** The other assets a recognisability question may offer as options (same set, not reference-only), with their descriptions. */
  peers: { name: string; description: string }[];
  /** An approved mockup is set / the asset has an earlier version to compare with. */
  hasMockup: boolean;
  hasPrevious: boolean;
}

/** One question as it will be asked of one asset. */
export interface ResolvedQuestion {
  /** Unique within the asset: the spec's id, or `reads.2`. */
  id: string;
  source: string;
  label: string;
  type: QuestionType;
  /** What goes on the wire. */
  ask: 'noul' | 'choice' | 'score';
  instructions: string;
  criteria?: unknown;
  /** The pictures in the state it is about; `mockup` in `usesMockup` is a picture inside its criteria. */
  images: ImageName[];
  usesMockup: boolean;
  expect: 'yes' | 'no';
  yes: number;
  no: number;
  /** choice: the option that passes. */
  want?: string;
  /** score: the number of levels. */
  levels?: number;
  /** A box question to place the problem when this fails. */
  locate?: { id: string; instructions: string };
}

export const MOCKUP_REF = '@@mockup@@';

const fill = (s: string, a: AssetFacts): string =>
  s.replace(/\{name\}/g, a.name.replace(/[_-]+/g, ' ')).replace(/\{kind\}/g, a.kind).replace(/\{description\}/g, a.description || a.name).replace(/\{theme\}/g, a.theme);

/** The pictures a text names in backticks, else the given default. */
function imagesIn(text: string, dflt: ImageName): ImageName[] {
  const found = IMAGE_NAMES.filter((n) => text.includes(`\`${n}\``));
  return found.length ? found : [dflt];
}

function applies(q: QuestionSpec, a: AssetFacts): boolean {
  if (q.off) return false;
  if (q.skip?.includes(a.name)) return false;
  if (q.kinds?.length && !q.kinds.includes(a.kind)) return false;
  if (q.sets?.length && !q.sets.includes(a.set)) return false;
  if (q.assets?.length && !q.assets.includes(a.name)) return false;
  return true;
}

/** The questions that apply to an asset, ready to ask (only those named in `only`, when given). */
export function resolveQuestions(file: QuestionFile, a: AssetFacts, only?: string[]): ResolvedQuestion[] {
  const out: ResolvedQuestion[] = [];
  for (const q of file.questions) {
    if (!applies(q, a)) continue;
    if (only && !only.includes(q.id)) continue;
    const base = { source: q.id, expect: q.expect ?? 'yes', yes: q.yes ?? file.thresholds.yes, no: q.no ?? file.thresholds.no, usesMockup: false };
    const withLocate = (r: ResolvedQuestion): ResolvedQuestion => (q.locate ? { ...r, locate: { id: `${r.id}__box`, instructions: fill(LOCATE.text(q.locate), a) } } : r);
    const defaultImage: ImageName = q.image ?? 'render';
    switch (q.type) {
      case 'noul': {
        const text = fill(q.text!, a);
        out.push(withLocate({ ...base, id: q.id, label: q.id, type: 'noul', ask: 'noul', instructions: text, images: imagesIn(text, defaultImage) }));
        break;
      }
      case 'choice': {
        const text = fill(q.text!, a);
        out.push({ ...base, id: q.id, label: q.id, type: 'choice', ask: 'choice', instructions: text, criteria: q.options, want: q.want, images: imagesIn(text, defaultImage) });
        break;
      }
      case 'score': {
        const text = fill(q.text!, a);
        out.push({ ...base, id: q.id, label: q.id, type: 'score', ask: 'score', instructions: text, criteria: q.levels, levels: q.levels!.length, images: imagesIn(text, defaultImage) });
        break;
      }
      case 'recognisable': {
        const names = new Set([a.name, ...a.peers.map((p) => p.name)]);
        if (names.size < 2) break;
        const all = [{ name: a.name, description: a.description }, ...a.peers.filter((p) => p.name !== a.name)];
        const criteria = Object.fromEntries(all.sort((x, y) => (x.name < y.name ? -1 : 1)).map((p) => [p.name, p.description || RECOGNISABLE.noDescription(p.name)]));
        out.push({ ...base, id: q.id, label: q.id, type: 'recognisable', ask: 'choice', instructions: q.text ?? RECOGNISABLE.text, criteria, want: a.name, images: ['render'] });
        break;
      }
      case 'reads':
        a.reads.forEach((read, i) => {
          const text = q.text ? fill(q.text, a).replace(/\{read\}/g, read) : READS.text(read);
          out.push(withLocate({ ...base, id: `${q.id}.${i + 1}`, label: `${q.id}: ${read}`, type: 'reads', ask: 'noul', instructions: text, images: ['render'] }));
        });
        break;
      case 'style':
        if (!a.hasMockup) break;
        out.push({
          ...base, id: q.id, label: q.id, type: 'style', ask: 'noul', instructions: q.text ? fill(q.text, a) : STYLE.text, images: ['render'], usesMockup: true,
          criteria: { true: STYLE.yes(MOCKUP_REF), false: STYLE.no },
        });
        break;
      case 'identity':
        if (!a.hasPrevious) break;
        out.push({ ...base, id: q.id, label: q.id, type: 'identity', ask: 'noul', instructions: q.text ? fill(q.text, a) : IDENTITY.text, images: ['before', 'after'] });
        break;
    }
  }
  return out;
}

/** What each picture is, as plain text in the request's state. */
export function aboutImage(n: ImageName): string {
  return ABOUT[n];
}

// ---- answers ----

export interface JudgeBox {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export type Answer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number | null }
  | { type: 'score'; score: number; probabilities: Record<string, number>; confidence: number | null }
  | { type: 'box'; box: JudgeBox; confidence: number | null };

const isP = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/** Read one answer of a response against the type it was asked as; anything unexpected is an error, never an answer. */
export function parseAnswer(want: 'noul' | 'choice' | 'score' | 'box', raw: unknown): { ok: true; answer: Answer } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'no answer' };
  const r = raw as Record<string, unknown>;
  if (r.type !== want) return { ok: false, error: `asked a ${want}, answered with a ${String(r.type)}` };
  const conf = isP(r.confidence) ? r.confidence : null;
  const probs = (): Record<string, number> | null => {
    const p = r.probabilities;
    if (!p || typeof p !== 'object') return null;
    const e = Object.entries(p as Record<string, unknown>);
    return e.length && e.every(([, v]) => isP(v)) ? (p as Record<string, number>) : null;
  };
  switch (want) {
    case 'noul':
      return isP(r.noul) ? { ok: true, answer: { type: 'noul', noul: r.noul } } : { ok: false, error: 'the noul answer is not a probability' };
    case 'choice': {
      const p = probs();
      return typeof r.choice === 'string' && p ? { ok: true, answer: { type: 'choice', choice: r.choice, probabilities: p, confidence: conf } } : { ok: false, error: 'the choice answer has no choice or probabilities' };
    }
    case 'score': {
      const p = probs();
      return typeof r.score === 'number' && Number.isFinite(r.score) && p ? { ok: true, answer: { type: 'score', score: r.score, probabilities: p, confidence: conf } } : { ok: false, error: 'the score answer has no score or probabilities' };
    }
    case 'box': {
      const b = r.box as Record<string, unknown> | undefined;
      if (!b || !isP(b.top) || !isP(b.bottom) || !isP(b.left) || !isP(b.right)) return { ok: false, error: 'the box answer has no edges between 0 and 1' };
      if (b.top >= b.bottom || b.left >= b.right) return { ok: false, error: 'the box answer is empty or upside down' };
      return { ok: true, answer: { type: 'box', box: { top: b.top, bottom: b.bottom, left: b.left, right: b.right }, confidence: conf } };
    }
  }
}

export type FindingStatus = 'pass' | 'fail' | 'unsure' | 'error' | 'skip';

/** One question's result for one asset. */
export interface JudgeFinding {
  id: string;
  label: string;
  type: QuestionType;
  /** The question as asked. */
  text: string;
  /** p(yes) for a noul, p(the wanted option) for a choice, the score as a share of the top level for a score. */
  p: number | null;
  expect: 'yes' | 'no';
  yes: number;
  no: number;
  status: FindingStatus;
  detail: string;
  /** choice and recognisable: what was picked. */
  pick?: string;
  confidence?: number | null;
  /** A box found for a failing question, and the pixels it marks. */
  box?: JudgeBox;
  marks?: Pt[];
}

const f2 = (n: number) => n.toFixed(2);

/** The finding for an answer. For a recognisable question a pick other than itself fails whatever the probability. */
export function evaluate(q: ResolvedQuestion, a: Answer): JudgeFinding {
  const f: JudgeFinding = { id: q.id, label: q.label, type: q.type, text: q.instructions, p: null, expect: q.expect, yes: q.yes, no: q.no, status: 'error', detail: '' };
  if (a.type === 'noul') {
    f.p = a.noul;
    f.status = verdictOf(a.noul, q.expect, q.yes, q.no);
    f.detail = `${f2(a.noul)} yes`;
  } else if (a.type === 'choice') {
    const p = a.probabilities[q.want!] ?? 0;
    f.p = p;
    f.pick = a.choice;
    f.confidence = a.confidence;
    if (q.type === 'recognisable') {
      f.status = a.choice !== q.want ? 'fail' : p >= q.yes ? 'pass' : 'unsure';
      f.detail = a.choice === q.want ? `picked as itself (${f2(p)})` : `read as ${a.choice} (${f2(a.probabilities[a.choice] ?? 0)}); itself ${f2(p)}`;
    } else {
      f.status = verdictOf(p, q.expect, q.yes, q.no);
      f.detail = `picked ${a.choice}; ${q.want} ${f2(p)}`;
    }
  } else if (a.type === 'score') {
    const share = q.levels && q.levels > 1 ? Math.max(0, Math.min(1, a.score / (q.levels - 1))) : 0;
    f.p = share;
    f.confidence = a.confidence;
    f.status = verdictOf(share, q.expect, q.yes, q.no);
    f.detail = `score ${f2(a.score)} of ${(q.levels ?? 1) - 1}`;
  }
  return f;
}

/** Pairs of assets whose picks are each other: A read as B and B read as A. */
export function confusionPairs(picks: Readonly<Record<string, string>>): [string, string][] {
  const out: [string, string][] = [];
  for (const [a, b] of Object.entries(picks)) if (a < b && picks[b] === a) out.push([a, b]);
  return out;
}

// ---- images ----

export interface Prepared {
  img: Rgba;
  /** Output pixels per source pixel (below 1: shrunk by nearest sampling). */
  scale: number;
  padX: number;
  padY: number;
  srcW: number;
  srcH: number;
}

/**
 * An image for the API: each side 280..1568 px. Pixel art is scaled up by a whole number with no
 * smoothing (to about 512 px on its long side when that fits; a source over 1568 px is sampled
 * down), transparent areas and any padding are filled with a flat grey.
 */
export function prepareImage(src: Rgba): Prepared {
  const { min, max, aim } = IMAGE_LIMITS;
  const big = Math.max(src.width, src.height), small = Math.min(src.width, src.height);
  const scale = big > max ? max / big : Math.max(1, Math.min(Math.floor(max / big), Math.max(Math.ceil(min / small), Math.ceil(aim / big))));
  const w = scale >= 1 ? src.width * scale : Math.max(1, Math.floor(src.width * scale));
  const h = scale >= 1 ? src.height * scale : Math.max(1, Math.floor(src.height * scale));
  const outW = Math.max(min, w), outH = Math.max(min, h);
  const padX = Math.floor((outW - w) / 2), padY = Math.floor((outH - h) / 2);
  const out = createRgba(outW, outH);
  const [br, bg, bb, ba] = BACKDROP;
  for (let i = 0; i < outW * outH; i++) { out.data[i * 4] = br; out.data[i * 4 + 1] = bg; out.data[i * 4 + 2] = bb; out.data[i * 4 + 3] = ba; }
  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.width - 1, Math.floor(x / scale));
      const s = (sy * src.width + sx) * 4, d = ((y + padY) * outW + x + padX) * 4;
      const al = src.data[s + 3]! / 255;
      for (let c = 0; c < 3; c++) out.data[d + c] = Math.round(src.data[s + c]! * al + out.data[d + c]! * (1 - al));
    }
  }
  return { img: out, scale, padX, padY, srcW: src.width, srcH: src.height };
}

/** The most pixels a box marks. */
export const MARKS_LIMIT = 240;

/** A box (fractions of the prepared image) as the pixels of its outline on the source image, clipped to it. */
export function boxMarks(box: JudgeBox, p: Prepared): Pt[] {
  const outW = p.img.width, outH = p.img.height;
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
  const x0 = clamp(Math.floor((box.left * outW - p.padX) / p.scale), p.srcW - 1);
  const x1 = clamp(Math.ceil((box.right * outW - p.padX) / p.scale) - 1, p.srcW - 1);
  const y0 = clamp(Math.floor((box.top * outH - p.padY) / p.scale), p.srcH - 1);
  const y1 = clamp(Math.ceil((box.bottom * outH - p.padY) / p.scale) - 1, p.srcH - 1);
  const seen = new Set<number>();
  const out: Pt[] = [];
  const add = (x: number, y: number) => {
    const k = y * p.srcW + x;
    if (!seen.has(k) && out.length < MARKS_LIMIT) { seen.add(k); out.push([x, y]); }
  };
  for (let x = x0; x <= x1; x++) { add(x, y0); add(x, y1); }
  for (let y = y0; y <= y1; y++) { add(x0, y); add(x1, y); }
  return out;
}
