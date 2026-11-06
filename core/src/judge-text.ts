// All the default wording of the judge in one place: the question texts, the descriptions of the
// answers, and the generic default question set (judge/questions.json overrides or extends it).
// Placeholders in a text: {name} {kind} {description} {theme}; `render`, `tile3x3`, `map`, `game`,
// `before` and `after` in backticks are the images the question is asked about.

import type { QuestionSpec } from './judge.ts';

/** The state shown to the model beside the images. */
export const ABOUT = {
  /** How the picture of an asset is described in the state (the model reads these as plain text). */
  render: 'The artwork at its native pixel grid, scaled up without smoothing. Transparent areas are grey.',
  tile3x3: 'The tile repeated in a 3 by 3 block, then the same block magnified.',
  map: 'The asset shown the way the game draws it.',
  game: 'The sprite on its usual ground, among the other things of its set.',
  before: 'The asset before the latest change.',
  after: 'The asset now, after the latest change.',
} as const;

/** The recognisability question: a choice over the project's own asset names. */
export const RECOGNISABLE = {
  text: 'Which of the listed things is drawn in `render`?',
  /** Used for an option with no description in the manifest. */
  noDescription: (name: string) => `The ${name.replace(/[_-]+/g, ' ')}.`,
};

/** A manifest "reads" entry ("a readable face") as a yes/no question. */
export const READS = {
  text: (read: string) => `Does \`render\` show ${read}? Judge only what is drawn, at the size a player would see it.`,
};

/** The style-match question; the approved mockup is the example of what is right. */
export const STYLE = {
  text: 'Is the style of `render` (palette, outline, shading, level of detail) consistent with the style of the approved mockup?',
  yes: (mockup: string) => ({
    description: 'It matches the style of this approved mockup: the same kind of palette, outlines, shading and detail.',
    examples: [mockup],
  }),
  no: 'It looks like it was made in a different style: other colours, outline or shading, or much more or less detail.',
};

/** The edit-identity question: did the last change keep it the same object? */
export const IDENTITY = {
  text: 'Is the object in `after` the same object as in `before`, only redrawn or touched up, and not something else?',
};

/** The wording for a box that places a problem. */
export const LOCATE = {
  text: (what: string) => `Where in \`render\` is ${what}?`,
};

/** The generic default question set. */
export const DEFAULT_QUESTIONS: QuestionSpec[] = [
  { id: 'recognisable', type: 'recognisable', kinds: ['sprite', 'object', 'icon'] },
  { id: 'reads', type: 'reads' },
  {
    id: 'seams', type: 'noul', kinds: ['tile'], image: 'tile3x3', expect: 'no',
    text: 'Are there visible seams where the tiles meet, or an obvious repeating pattern, in `tile3x3`?',
  },
  {
    id: 'map-seams', type: 'noul', kinds: ['family', 'map'], image: 'map', expect: 'no',
    text: 'Are there visible seams between tiles, or an obvious repeating pattern, in `map`?',
  },
  { id: 'style', type: 'style' },
  { id: 'identity', type: 'identity', kinds: ['sprite', 'object', 'icon'] },
  {
    id: 'stray', type: 'noul', kinds: ['sprite', 'object', 'icon'], expect: 'no',
    text: 'Is there a stray blob or a few loose pixels in `render` that are not part of the {name}?',
    locate: 'the stray blob or loose pixels',
  },
];

/** The wording of a result line. */
export const WORDS = {
  unsure: 'unsure',
  advisory: 'advisory: the judge does not block anything',
  gate: 'the judge gates: failing questions block done',
  notRun: 'not run yet (pixelclaw judge <project> <asset>)',
  stale: 'out of date (the art or the questions changed since it was asked)',
};
