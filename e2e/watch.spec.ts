// The watch view: after playback the canvas pixels equal the core render; the token is required;
// two connected browsers receive the same stream. Also pause / jump to live, time travel and
// Claude's eye.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { REPO, canvasPixels, mismatches, pageTape, serverDoc, startAgent, tapeRow, type Agent } from './helpers.ts';

const STONE_FLOOR = readFileSync(join(REPO, 'examples', 'scripts', 'stone_floor.pclaw'), 'utf8');
const SPRITE = `new sprite idol 12x16 bg=none
ellipse 6,3 r=3x3 c=stone3 fill
rect 3,7 7x8 c=stone2 fill
line 3,7 9,7 c=stone4
px 5,3 7,3 c=moss3
paint 2,15 <<
  kkkkkkkkk
>>`;

let agent: Agent;

test.beforeEach(async () => {
  agent = await startAgent();
});

test.afterEach(async () => {
  await agent.close();
});

const seqOf = (page: Page) => page.locator('[data-testid=canvas]').getAttribute('data-seq');

async function lastSeq(asset: string): Promise<number> {
  return (await serverDoc(agent.url, asset)).tape.at(-1)!.seq;
}

test('the token is required', async ({ page }) => {
  const base = agent.url.replace(/\?token=.*/, '');
  const res = await page.goto(base);
  expect(res!.status()).toBe(401);
  await expect(page.locator('body')).toContainText('token required');
  expect((await page.goto(`${base}?token=0123`))!.status()).toBe(401);
  expect((await page.goto(agent.url))!.status()).toBe(200);
  await expect(page.getByTestId('status')).toContainText('live');
});

test('live playback draws command by command, and the canvas then equals the core render', async ({ page }) => {
  await page.goto(agent.url);
  await expect(page.getByTestId('status')).toContainText('live');
  await page.getByTestId('speed').selectOption('60');
  // Record every tape position the canvas shows while the batch plays.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    new MutationObserver(() => {
      const s = document.querySelector('[data-testid=canvas]')?.getAttribute('data-seq');
      if (s && seen.at(-1) !== s) seen.push(s);
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-seq'], childList: true });
  });
  const r = await agent.call('run', { asset: 'stone_floor', commands: STONE_FLOOR });
  expect(r.isError).toBeFalsy();
  const last = await lastSeq('stone_floor');
  await expect.poll(() => seqOf(page), { timeout: 20_000 }).toBe(String(last));
  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
  // Every command was shown on its own (none skipped), in order.
  expect(seen.map(Number)).toEqual(Array.from({ length: last }, (_, i) => i + 1));
  const { doc } = await serverDoc(agent.url, 'stone_floor');
  expect(mismatches(doc, await canvasPixels(page))).toEqual([]);
  // The tape panel lists every command (only the rows in view are in the page), coloured as the agent's.
  await expect(page.getByTestId('tape')).toHaveAttribute('data-lines', String(last));
  expect(await page.locator('.cmd-row').count()).toBeGreaterThan(10);
  expect(await page.locator('.cmd-row:not(.by-claude)').count()).toBe(0);

  // A sprite with transparent pixels, at another zoom, with the grids off.
  await page.getByTestId('pixel-grid').click();
  await agent.call('run', { asset: 'idol', commands: SPRITE });
  const idolLast = await lastSeq('idol');
  await expect(page.locator('[data-testid=canvas]')).toHaveAttribute('data-asset', 'idol');
  await expect.poll(() => seqOf(page), { timeout: 20_000 }).toBe(String(idolLast));
  await page.getByRole('button', { name: '−' }).click();
  const idol = await serverDoc(agent.url, 'idol');
  const px = await canvasPixels(page);
  expect(px.zoom).toBeGreaterThanOrEqual(4);
  expect(mismatches(idol.doc, px)).toEqual([]);
});

test('pause holds incoming commands; jump to live shows them all', async ({ page }) => {
  await agent.call('run', { asset: 'slab', commands: 'new tile slab 16x16 bg=stone1' });
  await page.goto(agent.url);
  await expect(page.locator('[data-testid=canvas]')).toHaveAttribute('data-seq', '1');
  await page.getByTestId('pause').click();
  await agent.call('run', { asset: 'slab', commands: 'rect 2,2 12x12 c=stone3 fill\nline 2,2 13,2 c=stone4\nline 2,13 13,13 c=stone2' });
  await expect(page.getByTestId('waiting')).toHaveText('3 to play');
  await page.waitForTimeout(300);
  expect(await seqOf(page)).toBe('1');
  await expect(page.locator('.cmd-row.pending')).toHaveCount(3);
  await page.getByTestId('live').click();
  await expect(page.locator('[data-testid=canvas]')).toHaveAttribute('data-seq', '4');
  await expect(page.getByTestId('pause')).toHaveText(/Pause/);
  const { doc } = await serverDoc(agent.url, 'slab');
  expect(mismatches(doc, await canvasPixels(page))).toEqual([]);
});

test('clicking a tape line shows the document at that point, read-only', async ({ page }) => {
  await page.goto(agent.url);
  await page.getByTestId('speed').selectOption('Infinity');
  await agent.call('run', { asset: 'stone_floor', commands: STONE_FLOOR });
  const last = await lastSeq('stone_floor');
  await expect(page.locator('[data-testid=canvas]')).toHaveAttribute('data-seq', String(last));
  await (await tapeRow(page, 8)).click();
  await expect(page.locator('.banner')).toContainText('after #8 (read-only)');
  await expect(page.locator('[data-testid=canvas]')).toHaveAttribute('data-seq', '8');
  const at8 = await serverDoc(agent.url, 'stone_floor', 8);
  expect(mismatches(at8.doc, await canvasPixels(page))).toEqual([]);
  // New commands keep arriving on the tape while travelling; the view stays put.
  await agent.call('run', { asset: 'stone_floor', commands: 'px 0,0 c=ink' });
  await expect(page.getByTestId('tape')).toHaveAttribute('data-lines', String(last + 1));
  expect(await seqOf(page)).toBe('8');
  await page.getByRole('button', { name: 'Back to live' }).click();
  await expect(page.locator('[data-testid=canvas]')).toHaveAttribute('data-seq', String(last + 1));
  await expect(page.locator('.banner')).toHaveCount(0);
});

test("Claude's eye shows the last image view returned to the agent", async ({ page }) => {
  await page.goto(agent.url);
  await expect(page.getByTestId('eye')).toContainText('Nothing yet');
  await agent.call('run', { asset: 'slab', commands: 'new tile slab 8x8 bg=moss2\npx 1,1 c=ink' });
  const v = await agent.call('view', { asset: 'slab', mode: 'tile3x3' });
  const png = v.content.find((c) => c.type === 'image')!.data!;
  await expect(page.locator('[data-testid=eye] img')).toHaveAttribute('src', `data:image/png;base64,${png}`);
  await expect(page.getByTestId('eye')).toContainText('slab · tile3x3');
  // A text view (the grid) is not an image, so the eye keeps the last image.
  await agent.call('view', { asset: 'slab', mode: 'grid' });
  await page.waitForTimeout(200);
  await expect(page.locator('[data-testid=eye] img')).toHaveAttribute('src', `data:image/png;base64,${png}`);
});

test('two connected browsers receive the same stream', async ({ browser }) => {
  const ctxA = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  const ctxB = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await a.goto(agent.url);
  await b.goto(agent.url);
  for (const p of [a, b]) await expect(p.getByTestId('status')).toContainText('live');
  await agent.call('run', { asset: 'stone_floor', commands: STONE_FLOOR });
  await agent.call('run', { asset: 'stone_floor', commands: 'rect 0,0 6x6 c=ink fill' });
  expect((await agent.call('run', { asset: 'stone_floor', commands: 'undo' })).isError).toBeFalsy();
  const last = await lastSeq('stone_floor');
  for (const p of [a, b]) {
    await p.getByTestId('speed').selectOption('Infinity');
    await expect(p.locator('[data-testid=canvas]')).toHaveAttribute('data-seq', String(last), { timeout: 20_000 });
  }
  const tapeA = await pageTape(a);
  expect(await pageTape(b)).toEqual(tapeA);
  expect(tapeA.at(-1)!.cmd).toBe('undo group=g2');
  const { doc } = await serverDoc(agent.url, 'stone_floor');
  expect(mismatches(doc, await canvasPixels(a))).toEqual([]);
  expect(mismatches(doc, await canvasPixels(b))).toEqual([]);
  await ctxA.close();
  await ctxB.close();
});
