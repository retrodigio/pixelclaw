// The judge's pure part: questions as data, thresholds, answers of every type, recognisability,
// the image limits and how a box becomes marked pixels.

import { describe, expect, it } from 'vitest';
import {
  IMAGE_LIMITS, boxMarks, confusionPairs, createRgba, defaultQuestionFile, evaluate, parseAnswer, parseQuestionFile, prepareImage, resolveQuestions, verdictOf,
  type AssetFacts, type QuestionFile, type ResolvedQuestion,
} from '../src/index.ts';

const facts = (o: Partial<AssetFacts> = {}): AssetFacts => ({
  name: 'urn', kind: 'sprite', set: 'props', description: 'a squat stone urn', theme: 'mossy ruins', reads: [],
  peers: [{ name: 'jar', description: 'a clay jar' }, { name: 'post', description: '' }], hasMockup: false, hasPrevious: false, ...o,
});

describe('thresholds', () => {
  it('are sure at the ends and unsure between (0.7 / 0.3)', () => {
    expect(verdictOf(0.9, 'yes', 0.7, 0.3)).toBe('pass');
    expect(verdictOf(0.1, 'yes', 0.7, 0.3)).toBe('fail');
    expect(verdictOf(0.5, 'yes', 0.7, 0.3)).toBe('unsure');
    expect(verdictOf(0.7, 'yes', 0.7, 0.3)).toBe('pass');
    expect(verdictOf(0.3, 'yes', 0.7, 0.3)).toBe('fail');
  });
  it('turn round for a question where no is the good answer', () => {
    expect(verdictOf(0.1, 'no', 0.7, 0.3)).toBe('pass');
    expect(verdictOf(0.9, 'no', 0.7, 0.3)).toBe('fail');
    expect(verdictOf(0.48, 'no', 0.7, 0.3)).toBe('unsure');
  });
});

describe('answers', () => {
  it('are read for every question type', () => {
    expect(parseAnswer('noul', { type: 'noul', noul: 0.98 })).toEqual({ ok: true, answer: { type: 'noul', noul: 0.98 } });
    expect(parseAnswer('choice', { type: 'choice', choice: 'calm', confidence: 0.7, probabilities: { angry: 0.15, calm: 0.8, excited: 0.05 } })).toMatchObject({ ok: true, answer: { choice: 'calm', confidence: 0.7 } });
    expect(parseAnswer('score', { type: 'score', score: 1.7, confidence: 0.55, legend: { 0: 'a' }, probabilities: { 0: 0.1, 1: 0.1, 2: 0.8 } })).toMatchObject({ ok: true, answer: { score: 1.7 } });
    expect(parseAnswer('box', { type: 'box', box: { top: 0.2, bottom: 0.66, left: 0.19, right: 0.68 }, confidence: null })).toEqual({ ok: true, answer: { type: 'box', box: { top: 0.2, bottom: 0.66, left: 0.19, right: 0.68 }, confidence: null } });
  });
  it('are errors, never answers, when they are not what was asked', () => {
    expect(parseAnswer('noul', undefined).ok).toBe(false);
    expect(parseAnswer('noul', { type: 'choice', choice: 'a', probabilities: { a: 1 } }).ok).toBe(false);
    expect(parseAnswer('noul', { type: 'noul', noul: 1.4 }).ok).toBe(false);
    expect(parseAnswer('choice', { type: 'choice', choice: 'a' }).ok).toBe(false);
    expect(parseAnswer('score', { type: 'score', score: 'high', probabilities: { 0: 1 } }).ok).toBe(false);
    expect(parseAnswer('box', { type: 'box', box: { top: 0.7, bottom: 0.2, left: 0.1, right: 0.5 } }).ok).toBe(false);
    expect(parseAnswer('box', { type: 'box', box: { top: 0.1, bottom: 0.2 } }).ok).toBe(false);
  });
});

describe('questions as data', () => {
  it('the default set applies by kind', () => {
    const f = defaultQuestionFile();
    const ids = (a: AssetFacts) => resolveQuestions(f, a).map((q) => q.id);
    expect(ids(facts())).toEqual(['recognisable', 'stray']);
    expect(ids(facts({ name: 'turf', kind: 'tile', set: 'ground', peers: [] }))).toEqual(['seams']);
    expect(ids(facts({ name: 'bog', kind: 'family', peers: [] }))).toEqual(['map-seams']);
  });
  it('adds reads from the manifest, style with a mockup, identity with an earlier version', () => {
    const f = defaultQuestionFile();
    const qs = resolveQuestions(f, facts({ reads: ['a readable face', 'a handle'], hasMockup: true, hasPrevious: true }));
    expect(qs.map((q) => q.id)).toEqual(['recognisable', 'reads.1', 'reads.2', 'style', 'identity', 'stray']);
    expect(qs.find((q) => q.id === 'reads.1')!.instructions).toContain('a readable face');
    expect(qs.find((q) => q.id === 'style')!.criteria).toMatchObject({ true: { examples: ['@@mockup@@'] } });
    expect(qs.find((q) => q.id === 'identity')!.images).toEqual(['before', 'after']);
    expect(qs.find((q) => q.id === 'stray')!.locate).toBeDefined();
  });
  it('offers the project\'s own names, with descriptions, as the recognisability choice', () => {
    const q = resolveQuestions(defaultQuestionFile(), facts()).find((x) => x.id === 'recognisable')!;
    expect(q.ask).toBe('choice');
    expect(q.criteria).toEqual({ jar: 'a clay jar', post: 'The post.', urn: 'a squat stone urn' });
    expect(q.want).toBe('urn');
    // alone in its set: nothing to tell it from
    expect(resolveQuestions(defaultQuestionFile(), facts({ peers: [] })).map((x) => x.id)).not.toContain('recognisable');
  });
  it('reads and checks a questions file, naming each problem', () => {
    const ok = parseQuestionFile({
      format: 'pixelclaw-judge-questions', version: 1, thresholds: { yes: 0.8, no: 0.2 },
      questions: [
        { id: 'face', type: 'noul', text: 'Is there a face in `render`?', kinds: ['sprite'], locate: 'the face', yes: 0.9 },
        { id: 'read', type: 'score', text: 'How readable is `render`?', levels: ['unreadable', 'readable', 'clear'] },
        { id: 'which', type: 'choice', text: 'What is `render`?', options: { a: 'one', b: 'two' }, want: 'a' },
      ],
    });
    expect(ok.problems).toEqual([]);
    expect(ok.file!.thresholds).toEqual({ yes: 0.8, no: 0.2 });
    const bad = parseQuestionFile({ format: 'x', version: 2, questions: [{ id: 'A', type: 'maybe' }, { id: 'a', type: 'noul' }, { id: 'a', type: 'noul', text: 't', zzz: 1 }, { id: 'c', type: 'choice', text: 't', options: { a: 'x' } }, { id: 's', type: 'score', text: 't', levels: ['x'] }] });
    expect(bad.file).toBeNull();
    const msgs = bad.problems.map((p) => `${p.path}: ${p.message}`).join('\n');
    expect(msgs).toContain('format');
    expect(msgs).toContain('questions[0].id');
    expect(msgs).toContain('questions[0].type');
    expect(msgs).toContain('questions[1].text');
    expect(msgs).toContain("questions[2].id: 'a' is used twice");
    expect(msgs).toContain("questions[2].zzz: unknown field 'zzz'");
    expect(msgs).toContain('questions[3].options');
    expect(msgs).toContain('questions[4].levels');
    expect(parseQuestionFile({ format: 'pixelclaw-judge-questions', version: 1, thresholds: { yes: 0.3, no: 0.6 }, questions: [] }).problems[0]!.message).toContain('below');
  });
  it('applies per kind, set, asset and skip, and honours off and per-question thresholds', () => {
    const file: QuestionFile = {
      thresholds: { yes: 0.7, no: 0.3 },
      questions: [
        { id: 'a', type: 'noul', text: 't `render`', kinds: ['tile'] },
        { id: 'b', type: 'noul', text: 't `render`', sets: ['props'], yes: 0.9 },
        { id: 'c', type: 'noul', text: 't `render`', assets: ['jar'] },
        { id: 'd', type: 'noul', text: 't `render`', skip: ['urn'] },
        { id: 'e', type: 'noul', text: 't `render`', off: true },
      ],
    };
    const qs = resolveQuestions(file, facts());
    expect(qs.map((q) => q.id)).toEqual(['b']);
    expect(qs[0]!.yes).toBe(0.9);
    expect(qs[0]!.no).toBe(0.3);
    expect(resolveQuestions(file, facts(), ['c'])).toEqual([]);
  });
});

const recog = (): ResolvedQuestion => resolveQuestions(defaultQuestionFile(), facts()).find((q) => q.id === 'recognisable')!;
const pick = (choice: string, p: Record<string, number>) => ({ type: 'choice' as const, choice, probabilities: p, confidence: 0.5 });

describe('recognisability', () => {
  it('passes a sprite picked as itself', () => {
    expect(evaluate(recog(), pick('urn', { urn: 0.9, jar: 0.08, post: 0.02 }))).toMatchObject({ status: 'pass', pick: 'urn', p: 0.9 });
  });
  it('flags a sprite not picked as itself, naming what it was read as', () => {
    const f = evaluate(recog(), pick('jar', { urn: 0.2, jar: 0.7, post: 0.1 }));
    expect(f.status).toBe('fail');
    expect(f.detail).toContain('read as jar');
  });
  it('is unsure when it is picked as itself but not clearly', () => {
    expect(evaluate(recog(), pick('urn', { urn: 0.45, jar: 0.4, post: 0.15 })).status).toBe('unsure');
  });
  it('finds two sprites picked as each other', () => {
    expect(confusionPairs({ urn: 'jar', jar: 'urn', post: 'post' })).toEqual([['jar', 'urn']]);
    expect(confusionPairs({ urn: 'jar', jar: 'post', post: 'urn' })).toEqual([]);
  });
});

describe('the other question types', () => {
  it('a noul is p(yes) against the thresholds', () => {
    const q = resolveQuestions(defaultQuestionFile(), facts()).find((x) => x.id === 'stray')!;
    expect(evaluate(q, { type: 'noul', noul: 0.05 })).toMatchObject({ status: 'pass', p: 0.05 });
    expect(evaluate(q, { type: 'noul', noul: 0.85 }).status).toBe('fail');
    expect(evaluate(q, { type: 'noul', noul: 0.5 }).status).toBe('unsure');
  });
  it('a score is held to the thresholds as a share of its top level', () => {
    const file: QuestionFile = { thresholds: { yes: 0.7, no: 0.3 }, questions: [{ id: 'r', type: 'score', text: 'How readable is `render`?', levels: ['no', 'some', 'clear'] }] };
    const q = resolveQuestions(file, facts())[0]!;
    expect(evaluate(q, { type: 'score', score: 1.83, probabilities: { 0: 0, 1: 0.2, 2: 0.8 }, confidence: null }).status).toBe('pass');
    expect(evaluate(q, { type: 'score', score: 0.2, probabilities: { 0: 0.8, 1: 0.2, 2: 0 }, confidence: null }).status).toBe('fail');
    expect(evaluate(q, { type: 'score', score: 1, probabilities: { 0: 0, 1: 1, 2: 0 }, confidence: null }).status).toBe('unsure');
  });
  it('a choice question passes on the wanted option', () => {
    const file: QuestionFile = { thresholds: { yes: 0.7, no: 0.3 }, questions: [{ id: 'w', type: 'choice', text: 'What is `render`?', options: { a: 'x', b: 'y' }, want: 'a' }] };
    const q = resolveQuestions(file, facts())[0]!;
    expect(evaluate(q, pick('a', { a: 0.9, b: 0.1 })).status).toBe('pass');
    expect(evaluate(q, pick('b', { a: 0.1, b: 0.9 })).status).toBe('fail');
  });
});

describe('prepareImage', () => {
  const sizeOk = (w: number, h: number) => w >= IMAGE_LIMITS.min && h >= IMAGE_LIMITS.min && w <= IMAGE_LIMITS.max && h <= IMAGE_LIMITS.max;
  it('scales a small sprite up by a whole number with no smoothing', () => {
    const src = createRgba(24, 24);
    for (let i = 0; i < 24 * 24; i++) { src.data[i * 4] = i % 24 < 12 ? 255 : 0; src.data[i * 4 + 3] = 255; }
    const p = prepareImage(src);
    expect(sizeOk(p.img.width, p.img.height)).toBe(true);
    expect(Number.isInteger(p.scale) && p.scale >= 12).toBe(true);
    expect(p.img.width).toBe(24 * p.scale);
    // Only the two source colours (and no padding grey): hard edges.
    const seen = new Set<number>();
    for (let i = 0; i < p.img.width * p.img.height; i++) seen.add(p.img.data[i * 4]!);
    expect([...seen].sort()).toEqual([0, 255]);
  });
  it('pads a thin image up to the minimum and fills transparent areas with grey', () => {
    const p = prepareImage(createRgba(8, 400));
    expect(sizeOk(p.img.width, p.img.height)).toBe(true);
    expect(p.padX).toBeGreaterThan(0);
    expect([...p.img.data.slice(0, 4)]).toEqual([128, 128, 128, 255]);
  });
  it('samples a huge image down to the maximum', () => {
    const p = prepareImage(createRgba(3000, 2000));
    expect(sizeOk(p.img.width, p.img.height)).toBe(true);
    expect(p.scale).toBeLessThan(1);
  });
  it('stays within the limits for sizes from 1 to 4000', () => {
    for (const [w, h] of [[1, 1], [16, 16], [48, 32], [279, 281], [280, 280], [700, 90], [1568, 1568], [1569, 10], [4000, 4000], [10, 1500]] as const) {
      const p = prepareImage(createRgba(w, h));
      expect(sizeOk(p.img.width, p.img.height), `${w}x${h}`).toBe(true);
    }
  });
});

describe('box to marks', () => {
  it('maps the box back through scale and padding to the source pixels it outlines', () => {
    const p = prepareImage(createRgba(16, 16)); // 16 px → scaled to 512
    expect(p.scale).toBe(32);
    const marks = boxMarks({ top: 0.25, bottom: 0.5, left: 0.5, right: 0.75 }, p);
    // 0.5..0.75 of 512 px = source x 8..11, 0.25..0.5 = y 4..7: an outline of a 4x4 square
    expect(marks).toHaveLength(12);
    expect(marks.every(([x, y]) => x >= 8 && x <= 11 && y >= 4 && y <= 7)).toBe(true);
    expect(marks).toContainEqual([8, 4]);
    expect(marks).toContainEqual([11, 7]);
    expect(marks).not.toContainEqual([9, 5]);
  });
  it('accounts for padding and clips to the canvas', () => {
    const p = prepareImage(createRgba(8, 400)); // padded sideways
    const marks = boxMarks({ top: 0, bottom: 1, left: 0, right: 1 }, p);
    expect(marks.every(([x, y]) => x >= 0 && x < 8 && y >= 0 && y < 400)).toBe(true);
    expect(marks.length).toBeGreaterThan(0);
  });
});
