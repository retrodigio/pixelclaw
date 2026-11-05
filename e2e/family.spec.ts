// Families in the browser: every new family control (detach, attach, the coverage map, cutting
// from it) logs a command that core replays to the pixels on the canvas; a stroke on a piece
// reaches every variant built from it; the variants and map views, the map's size and seed, and
// folding timeline rows log nothing.

import { expect, test, type Page } from '@playwright/test';
import { canvasPixels, mismatches, serverDoc, startAgent, type Agent } from './helpers.ts';

let agent: Agent;
test.beforeEach(async () => { agent = await startAgent(); });
test.afterEach(async () => { await agent.close(); });

const FAMILY = [
  'new family bank 8x8 scheme=blob47 map=14x12',
  'rect @cell(inside) 0,0 8x8 c=moss2 fill',
  'px @cell(inside) 2,2 5,6 c=moss3',
  'rect @cell(outside) 0,0 8x8 c=pool fill',
  'family band 1:outside 1:stone4 1:stone2 radius=1',
].join('\n');

const tapeLength = async () => (await serverDoc(agent.url, 'bank')).tape.length;

async function canvasMatches(page: Page): Promise<void> {
  const { doc, tape } = await serverDoc(agent.url, 'bank');
  await page.locator('[data-mode="sheet"]').click();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-seq', String(tape.at(-1)!.seq));
  expect(mismatches(doc, await canvasPixels(page))).toEqual([]);
}

/** One UI action: the lines it logged (by the person), then the canvas equals core's replay. */
async function act(page: Page, action: () => Promise<void>, logged: (string | RegExp)[]): Promise<void> {
  const before = await tapeLength();
  await action();
  await expect.poll(tapeLength).toBe(before + logged.length);
  const added = (await serverDoc(agent.url, 'bank')).tape.slice(before);
  logged.forEach((want, i) => (typeof want === 'string' ? expect(added[i]!.cmd).toBe(want) : expect(added[i]!.cmd).toMatch(want)));
  expect(added.every((e) => e.by === 'human:chris')).toBe(true);
  await canvasMatches(page);
}

async function open(page: Page): Promise<void> {
  await agent.call('run', { asset: 'bank', commands: FAMILY });
  await page.goto(`${agent.url}&name=chris`);
  await expect(page.getByTestId('status')).toContainText('live');
  // The cell lines cross pixel centres at small zooms; the comparison wants the art alone.
  await page.locator('.toolbar label', { hasText: 'cell grid' }).locator('input').uncheck();
  await canvasMatches(page);
}

test('every family control logs a command that replays to the pixels on the canvas', async ({ page }) => {
  await open(page);
  const variants = () => page.locator('[data-mode="variants"]').click();
  await act(page, async () => { await variants(); await page.getByTestId('variant-detach-ne_ne').click(); }, ['family detach ne_ne']);
  await act(page, async () => { await variants(); await page.getByTestId('variant-attach-ne_ne').click(); }, ['family attach ne_ne']);
  await act(page, async () => { await variants(); await page.getByTestId('family-coverage').click(); }, [/^family coverage seed=\d+ copies=1 fill=off$/]);
  await act(page, async () => { await variants(); await page.getByTestId('family-cut').click(); }, ['family cut textures=off']);
  const { doc } = await serverDoc(agent.url, 'bank');
  expect(doc.family!.detached.length).toBe(42);
});

test('a stroke on a piece reaches every variant built from it', async ({ page }) => {
  await open(page);
  const box = (await page.getByTestId('art').boundingBox())!;
  const z = Number(await page.getByTestId('canvas').getAttribute('data-zoom'));
  // Piece 'o' is the first variant: cell (0,1). Its pixel 2,2 is in its NW quadrant (an outer corner).
  const at = (x: number, y: number) => [box.x + (x + 0.5) * z, box.y + (y + 0.5) * z] as const;
  await page.keyboard.press('b');
  await page.locator('.swatch', { hasText: 'ink' }).first().click();
  const before = await tapeLength();
  await page.mouse.move(...at(2, 10));
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(tapeLength).toBe(before + 1);
  const { doc, tape } = await serverDoc(agent.url, 'bank');
  const m = /^stroke pencil c=ink pp=on (\d+),(\d+)$/.exec(tape.at(-1)!.cmd)!;
  const [px, py] = [Number(m[1]), Number(m[2]) - 8];
  expect(px < 4 && py >= 0 && py < 4).toBe(true);
  // Every variant whose NW quadrant is an outer corner shows it: o, e, s, es, es_se.
  const ink = doc.palette.entries.findIndex((e) => e.name === 'ink');
  const cell = (n: string) => { const i = ['o', 'n', 'e', 'ne', 'ne_ne', 's', 'ns', 'es'].indexOf(n); return [i % 8, 1 + Math.floor(i / 8)] as const; };
  for (const n of ['e', 's', 'es']) {
    const [cx, cy] = cell(n);
    const top = doc.layers.map((_, l) => doc.cels[l]![0]![(cy * 8 + py) * doc.width + cx * 8 + px]!).filter((v) => v !== 0xffff).at(-1);
    expect(top, n).toBe(ink);
  }
  await canvasMatches(page);
  // The cell under the pointer is named in the toolbar.
  await page.mouse.move(...at(2, 10));
  await expect(page.getByTestId('family-cell')).toHaveText('o');
});

test('the variants and map views, the map controls and folding timeline rows log nothing', async ({ page }) => {
  await open(page);
  await agent.call('run', { asset: 'glint', commands: 'new overlay glint 2x2\npx 0,0 c=stone5\nframe add empty\nframe 2\npx 1,1 c=stone5\noverlay set mode=wave on=outside every=2' });
  // The page follows the agent to the overlay; then the person goes back to the family.
  await expect(page.locator('.crumbs')).toContainText('glint');
  await expect(page.getByTestId('waiting')).toHaveText('');
  await page.locator('.follow input').uncheck();
  await page.getByTestId('assets').locator('li', { hasText: 'bank' }).click();
  const before = await tapeLength();
  await page.locator('[data-mode="variants"]').click();
  await expect(page.locator('[data-variant]')).toHaveCount(47);
  await expect(page.locator('[data-variant="o"].piece')).toHaveCount(1);
  await page.locator('[data-mode="map"]').click();
  await expect(page.getByTestId('map-text')).toContainText(/16x12 tiles of 8 px, a random island \(seed 1\); seam [\d.]+/);
  await page.getByTestId('map-reroll').click();
  await expect(page.getByTestId('map-text')).toContainText('(seed 2)');
  await page.getByTestId('map-size').selectOption('24x16');
  await expect(page.getByTestId('map-text')).toContainText('24x16 tiles');
  await expect(page.getByTestId('map-text')).toContainText('overlays: glint (wave on outside, every 2)');
  await page.getByTestId('map-overlay-glint').click();
  await expect(page.getByTestId('map-text')).not.toContainText('overlays:');
  await page.locator('[data-mode="sheet"]').click();
  for (const k of ['ticks', 'layers']) await page.getByTestId(`tl-fold-${k}`).click();
  await expect(page.locator('[data-layer]')).toHaveCount(1);
  await page.getByTestId('tl-fold-all').click();
  await expect(page.locator('.tl-grid')).toHaveCount(0);
  await page.getByTestId('tl-fold-all').click();
  await expect(page.locator('[data-layer]')).toHaveCount(1);
  expect(await tapeLength()).toBe(before);
});
