// Plan §10 G6 in the browser: every new timeline control (ticks, tags and their loops, views,
// mirror links, linked cels, the pivot and ground tool) logs a command that core replays to the
// pixels on the canvas; a mirror view follows the agent's drawing; playback runs at the game's
// speed; playback and the onion skin log nothing.

import { expect, test, type Page } from '@playwright/test';
import { canvasPixels, mismatches, serverDoc, startAgent, type Agent } from './helpers.ts';

let agent: Agent;
test.beforeEach(async () => { agent = await startAgent(); });
test.afterEach(async () => { await agent.close(); });

type Pt = [number, number];

async function screen(page: Page, [x, y]: Pt): Promise<Pt> {
  const box = (await page.getByTestId('art').boundingBox())!;
  const z = Number(await page.getByTestId('canvas').getAttribute('data-zoom'));
  return [box.x + (x + 0.5) * z, box.y + (y + 0.5) * z];
}

const tapeLength = async (asset: string) => (await serverDoc(agent.url, asset)).tape.length;

async function canvasMatches(page: Page, asset: string): Promise<void> {
  const { doc, tape } = await serverDoc(agent.url, asset);
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-seq', String(tape.at(-1)!.seq));
  expect(mismatches(doc, await canvasPixels(page))).toEqual([]);
}

/** One UI action: the lines it logged (one group, by the person), then canvas == core's replay. */
async function act(page: Page, action: () => Promise<void>, logged: (string | RegExp)[]): Promise<void> {
  const before = await tapeLength('walker');
  await action();
  await expect.poll(() => tapeLength('walker')).toBe(before + logged.length);
  const added = (await serverDoc(agent.url, 'walker')).tape.slice(before);
  logged.forEach((want, i) => (typeof want === 'string' ? expect(added[i]!.cmd).toBe(want) : expect(added[i]!.cmd).toMatch(want)));
  expect(added.every((e) => e.by === 'human:chris')).toBe(true);
  await canvasMatches(page, 'walker');
}

const FIGURE = (legs: string) => `paint 2,1 <<\n  .00.\n  0330\n  0330\n  .00.\n${legs}\n>>`;
const WALKER = [
  'new sprite walker 8x8', 'frame add empty', 'frame add empty', 'frame add empty',
  'frame 1', FIGURE('  0..0\n  0..0'), 'frame 2', FIGURE('  .00.\n  0..0'),
  'frame 3', FIGURE('  0..0\n  0..0').replace('0330', '0110'), 'frame 4', FIGURE('  .00.\n  0..0').replace('0330', '0110'),
].join('\n');

async function open(page: Page): Promise<void> {
  await agent.call('run', { asset: 'walker', commands: WALKER });
  await page.goto(`${agent.url}&name=chris`);
  await expect(page.getByTestId('status')).toContainText('live');
  await canvasMatches(page, 'walker');
}

const head = (page: Page, f: number) => page.locator(`[data-frame-head="${f}"]`);

test('every timeline control logs a command that replays to the pixels on the canvas', async ({ page }) => {
  await open(page);
  const tid = (id: string) => page.getByTestId(id);
  // Ticks: double-click a frame number.
  await act(page, async () => {
    await head(page, 1).dblclick();
    await tid('ticks-input').fill('6');
    await tid('ticks-input').press('Enter');
  }, ['frame set 1 ticks=6']);
  // Choose frames 1-2 (click, Shift+click), then name them, then make them ping-pong.
  await head(page, 1).click();
  await head(page, 2).click({ modifiers: ['Shift'] });
  await act(page, async () => {
    await tid('tag-name').fill('walk');
    await tid('tag-name').press('Enter');
  }, ['tag add walk 1-2 loop=cycle']);
  await act(page, () => tid('tag-loop-walk').click(), ['tag set walk loop=pingpong']);
  // Ticks for the chosen frames at once.
  await act(page, async () => {
    await head(page, 2).dblclick();
    await tid('ticks-input').fill('9');
    await tid('ticks-input').press('Enter');
  }, ['frame set 1-2 ticks=9']);
  // A view, and a live mirror of it.
  await head(page, 1).click();
  await head(page, 2).click({ modifiers: ['Shift'] });
  await act(page, async () => { await tid('view-set').selectOption('E'); }, ['view E frames=1-2']);
  await act(page, async () => { await tid('mirror-add').selectOption('E'); }, ['view W mirror=E']);
  await expect(page.locator('[data-view=W]')).toContainText('W ⇋ E');
  // Linked cels on frames 3-4, then unlinked.
  await head(page, 3).click();
  await head(page, 4).click({ modifiers: ['Shift'] });
  await act(page, () => tid('link').click(), ['cel link 3-4 layer=main']);
  await expect(page.locator('[data-cel="main:4"]')).toHaveAttribute('data-linked', '3');
  await act(page, () => tid('unlink').click(), ['cel unlink 3-4 layer=main']);
  // The pivot and ground tool (P): click a pixel, Shift+click a row.
  await head(page, 1).click();
  await page.keyboard.press('p');
  await act(page, async () => { await page.mouse.click(...(await screen(page, [3, 7]))); }, ['pivot 3,7']);
  await act(page, async () => {
    await page.keyboard.down('Shift');
    await page.mouse.click(...(await screen(page, [5, 7])));
    await page.keyboard.up('Shift');
  }, ['ground 7']);
  // Remove the tag and unlink the mirror from their bands.
  await act(page, () => page.locator('[data-tag=walk] button[title^="Remove"]').click(), ['tag remove walk']);
  await act(page, () => page.locator('[data-view=W] button').click(), ['view W mirror=off']);
});

test('a mirror view follows the agent\'s drawing on the canvas', async ({ page }) => {
  await open(page);
  await agent.call('run', { asset: 'walker', commands: 'view E frames=1-2\nview W mirror=E' });
  await head(page, 5).click();
  await canvasMatches(page, 'walker');
  await agent.call('run', { asset: 'walker', commands: 'frame 1\npx 1,0 c=lichen' });
  await canvasMatches(page, 'walker');
  const { doc } = await serverDoc(agent.url, 'walker');
  expect(doc.cels[0]![4]![6]).toBe(doc.palette.entries.findIndex((e) => e.name === 'lichen'));
});

test('playback runs at the game\'s speed; playing and the onion skin log nothing', async ({ page }) => {
  await open(page);
  // 30 ticks a frame at 60 ticks/s: half a second each.
  await agent.call('run', { asset: 'walker', commands: 'frame set all ticks=30\ntag add step 1-2' });
  await canvasMatches(page, 'walker');
  const before = await tapeLength('walker');
  await page.getByTestId('play-seq').selectOption('step');
  await page.getByTestId('play').click();
  const seen: { t: number; f: string }[] = await page.evaluate(async () => {
    const out: { t: number; f: string }[] = [];
    const c = document.querySelector<HTMLCanvasElement>('[data-testid=canvas]')!;
    const t0 = performance.now();
    while (performance.now() - t0 < 2300) {
      const f = c.dataset.frame!;
      if (out.at(-1)?.f !== f) out.push({ t: performance.now() - t0, f });
      await new Promise((r) => requestAnimationFrame(r));
    }
    return out;
  });
  const changes = seen.slice(1);
  expect(new Set(seen.map((x) => x.f))).toEqual(new Set(['0', '1']));
  expect(changes.length).toBeGreaterThanOrEqual(3);
  for (let i = 1; i < changes.length; i++) expect(Math.abs(changes[i]!.t - changes[i - 1]!.t - 500)).toBeLessThan(120);
  await page.getByTestId('play').click();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-frame', '0');
  // The onion skin tints the frame after under this one: a pixel empty here shows it.
  await page.getByTestId('onion-next').check();
  const px = await canvasPixels(page);
  const at = (x: number, y: number) => px.data.slice((y * 8 + x) * 4, (y * 8 + x) * 4 + 3);
  expect(at(4, 5)[0]).not.toBe(at(4, 5)[1]); // frame 2's leg at 4,5, tinted blue
  await page.getByTestId('onion-next').uncheck();
  await canvasMatches(page, 'walker');
  expect(await tapeLength('walker')).toBe(before);
});
