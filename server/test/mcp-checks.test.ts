// Checks through the server: a check summary in every run result; the check tool's table with
// coordinates and its marked image; the game and recolour views; the style guide's thresholds; the
// review bundle (no author or method names); diffs and changes across frames.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnServer, texts, type Content, type Served } from './spawn.ts';

let s: Served;
const call = (name: string, args: Record<string, unknown>) => s.call(name, args);
const image = (c: Content) => c.find((x) => x.type === 'image');

beforeAll(async () => {
  s = await spawnServer('pixelclaw-g5-');
  // The style guide: the ground for sprites and a stricter outline rule.
  const pj = join(s.proj, 'project.json');
  const json = JSON.parse(readFileSync(pj, 'utf8'));
  json.style = { ground: 'turf', drawScale: 3, checks: { outline: { min: 0.9 } } };
  json.themes = { rust: { light: '#e0a070', dark: '#a05030', darkest: '#301008' } };
  writeFileSync(pj, JSON.stringify(json, null, 2));
  await call('project', { path: s.proj });
  const r = await call('run', { asset: 'turf', commands: 'new tile turf 8x8 bg=moss2\npx 2,2 5,5 c=moss1' });
  expect(r.isError).toBeFalsy();
}, 20000);

afterAll(async () => {
  await s?.close();
});

describe('checks through MCP', () => {
  it('every run result ends with a check summary', async () => {
    const r = await call('run', { asset: 'box', commands: 'new sprite box 12x12\nrect 2,2 8x8 c=stone3 fill\nrect 2,2 8x8 c=ink\npx 5,5 c=lichen' });
    const t = texts(r.content);
    expect(t).toMatch(/checks: palette 0 ✓ · orphans [\d.]+% ✗ · jaggies 0 ✓ · banding 0 ✓ · outline 1 ✓ · coverage 0 ✓ · readability 1 ✓ · margin 0 ✓ · pieces 0 ✓ {2}\(1 failing: `check` gives coordinates\)/);
  });

  it('check gives the table with coordinates and circles the flagged pixels', async () => {
    const r = await call('check', { asset: 'box' });
    const t = texts(r.content);
    expect(t).toContain('box: 1 of 9 checks failing'); // margin and pieces included
    expect(t).toContain('✗  orphans');
    expect(t).toContain('lone pixel (no neighbour shares its colour): 5,5');
    expect(t).toContain('–  seam        skipped: not a wrap (tile) document');
    expect(t).toMatch(/✓ {2}readability 1 +≥ 0.8 +edge contrast: 28 of 28 edge px differ from 'turf'/);
    expect(image(r.content)).toBeTruthy();
    expect(t).toMatch(/render: \d+x\d+ px, saved .*box\.render\.png/);
    // Fixed by coordinates: the summary goes green.
    const fix = texts((await call('run', { asset: 'box', commands: 'px 5,5 c=stone3' })).content);
    expect(fix).toMatch(/checks: .* readability 1 ✓ · margin 0 ✓ · pieces 0 ✓$/m);
    expect(fix).not.toContain('failing');
    const ok = await call('check', { asset: 'box' });
    expect(texts(ok.content)).toContain('box: all 9 checks pass');
    expect(image(ok.content)).toBeUndefined();
  });

  it('the style guide sets thresholds; without an asset, one line per asset', async () => {
    await call('run', { asset: 'box', commands: 'px 5,2 6,2 7,2 c=stone3' });
    const t = texts((await call('check', { asset: 'box', checks: ['outline'] })).content);
    // 28 edge px, 3 not ink: 25/28 = 0.89 < the style's 0.9.
    expect(t).toMatch(/✗ {2}outline +0\.89 +≥ 0\.9 +25 of 28 silhouette edge px are ink; 3 gaps/);
    expect(t).toContain('silhouette edge not in the outline colour (ink): 5,2 6,2 7,2');
    const all = texts((await call('check', {})).content);
    expect(all).toMatch(/^box: palette 0 ✓ .*outline 0\.89 ✗/m);
    expect(all).toMatch(/^turf: .*seam [\d.]+ ✓/m);
    await call('run', { asset: 'box', commands: 'undo' });
  });

  it('views: marks, game on the ground at the draw scale, recolour under themes', async () => {
    await call('run', { asset: 'box', commands: 'px 3,3 c=lichen' });
    const marked = await call('view', { asset: 'box', mode: 'render', marks: 'failing' });
    expect(image(marked.content)).toBeTruthy();
    const game = await call('view', { asset: 'box', mode: 'game' });
    // One 12x12 sprite with 8 px margins: a 28x28 scene at 1x and 84x84 at 3x.
    expect(texts(game.content)).toMatch(/game: 100x136 px, saved .*box\.game\.png/);
    await call('run', { asset: 'fig', commands: 'new sprite fig 8x8\npalette add skin role=light\npalette add cloak role=dark\nrect 2,1 4x6 c=skin fill\nrect 2,4 4x3 c=cloak fill\noutline c=ink' });
    const rc = await call('view', { asset: 'fig', mode: 'recolour', themes: ['grey', 'rust'] });
    expect(texts(rc.content)).toMatch(/recolour: \d+x\d+ px, saved .*fig\.recolour\.png/);
    const bad = await call('view', { asset: 'fig', mode: 'render', theme: 'nope' });
    expect(bad.isError).toBe(true);
    expect(texts(bad.content)).toContain(`no theme 'nope' (themes: grey, moss, ember, tide, dusk, sand, rust)`);
    const badMarks = await call('view', { asset: 'fig', mode: 'render', marks: 'shiny' });
    expect(texts(badMarks.content)).toMatch(/marks must be "failing" or check names/);
    await call('run', { asset: 'box', commands: 'undo' });
  });

  it('review writes a blind bundle: images, palette, rubric, and no author or method names', async () => {
    const r = await call('review', { name: 'first' });
    const t = texts(r.content);
    const dir = /review bundle: (\S+)/.exec(t)![1]!;
    expect(dir).toMatch(/reviews\/\d{4}-\d\d-\d\d-first$/);
    const files = readdirSync(dir, { recursive: true }).map(String).sort();
    expect(files).toEqual(expect.arrayContaining([
      'assets/box.png', 'assets/box.game.png', 'assets/turf.png', 'palette.md', 'rubric.md', 'scenes/box.png', 'scenes/fig.png', 'tiles/turf.3x3.png',
    ]));
    for (const f of files.filter((x) => x.endsWith('.md') || x.endsWith('.json'))) {
      const body = readFileSync(join(dir, f), 'utf8');
      expect(body).not.toMatch(/claude|human:|pixelclaw|anthropic|agent|model|tape/i);
    }
    expect(readFileSync(join(dir, 'rubric.md'), 'utf8')).toContain('<asset> <x>,<y> "what is wrong and what to do"');
  });
});

describe('frames in diffs and changes', () => {
  it('the diff lists changes per frame; changes reports a person\'s edit on frame 2', async () => {
    await call('run', { asset: 'anim', commands: 'new sprite anim 6x6\nrect 1,1 4x4 c=stone3 fill\nframe add 2 copy=1' });
    await call('changes', {});
    const page = await import('./spawn.ts').then((m) => m.openPage(m.wsUrl(s.url)));
    const r = await page.run('anim', 'frame 2\npx 2,2 c=ink', 'human:chris');
    expect(r.ok).toBe(true);
    page.ws.close();
    const ch = texts((await call('changes', { asset: 'anim' })).content);
    expect(ch).toContain('diff #3 → #5: 1 px changed (frame 2: 1):\n  f2 2,2 stone3→ink');
    const v = await call('view', { asset: 'anim', mode: 'diff', since: 3 });
    expect(texts(v.content)).toContain('f2 2,2 stone3→ink');
  });
});
