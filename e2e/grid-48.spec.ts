// A 48 px project (its grid set through MCP) is shown at its own scale: the gallery, the family's
// sample map, the preview and the map editor's camera.

import { expect, test } from '@playwright/test';
import { startAgent, type Agent } from './helpers.ts';

let agent: Agent;
test.afterEach(async () => { await agent?.close(); });

const T = 48;

test('a 48 px project: the gallery, the family map, the preview and the camera follow the grid', async ({ page }) => {
  agent = await startAgent();
  expect((await agent.call('project', { grid: T })).isError).toBeFalsy();
  for (const [asset, commands] of [
    ['moor', `new tile moor ${T}x${T} bg=moss2\nnoise ramp=moss seed=3`],
    ['pool', `new family pool ${T}x${T} scheme=blob47\nrect @cell(inside) 0,0 ${T}x${T} c=pool fill\nrect @cell(outside) 0,0 ${T}x${T} c=moss2 fill\nfamily band 2:outside 2:soil1`],
    ['moor_map', 'new map moor_map 20x12\ntiles floor fill moor\nlayer add bog terrain=pool outside=off above=floor\nterrain bog rect 3,2 5x4'],
  ] as const) {
    const r = await agent.call('run', { asset, commands });
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
  }
  await page.goto(`${agent.url}&name=chris&tab=gallery`);
  await expect(page.locator('.gallery')).toContainText('at game scale (1x)');

  await page.goto(`${agent.url}&name=chris`);
  await expect(page.getByTestId('status')).toContainText('live');
  await page.locator('.follow input').uncheck();
  await page.locator('.assets li', { hasText: 'pool' }).click();
  // The preview's island: 6x5 cells of 48 (about 288 px), not 12x9.
  await page.locator('.preview [data-tab="map"]').click();
  await expect.poll(() => page.getByTestId('preview-map').evaluate((c: HTMLCanvasElement) => [c.width, c.height])).toEqual([6 * T, 5 * T]);
  // The family's sample map at 1x: 16x12 cells of 48.
  await page.locator('[data-mode="map"]').click();
  await expect.poll(() => page.getByTestId('map-canvas').evaluate((c: HTMLCanvasElement) => [c.width, c.height])).toEqual([16 * T, 12 * T]);

  // The map editor's camera view: 16x9 cells of the grid.
  await page.locator('.assets li', { hasText: 'moor_map' }).click();
  await expect(page.getByTestId('map-editor')).toBeVisible();
  await page.getByTestId('map-zoom-1').click();
  await page.locator('[data-tool="camera"]').click();
  const box = (await page.getByTestId('map-edit-canvas').boundingBox())!;
  await page.mouse.click(box.x + 10.5 * T, box.y + 6.5 * T);
  await page.getByTestId('map-camera-view').check();
  await expect.poll(() => page.getByTestId('map-edit-canvas').evaluate((c: HTMLCanvasElement) => [c.width, c.height])).toEqual([16 * T, 9 * T]);
});
