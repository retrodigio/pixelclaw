// Screenshots for G8 (docs/screenshots/g8-*.png): the map editor on the village, the camera at
// game scale, the hot spots the map checks find when the texture variants are switched off, an
// object on its ground, and what the agent sees (the whole map, the camera, a move's diff).
// Starts a server on a copy of the example project, drives the page like a person, photographs it,
// and leaves nothing running.
//   node scripts/screenshots-g8.ts

import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { REPO, startAgent } from '../e2e/helpers.ts';

const out = (n: string, ext = 'png') => join(REPO, 'docs', 'screenshots', `${n}.${ext}`);
const settled = (page: Page) => page.waitForFunction(() => document.querySelector('[data-testid=waiting]')?.textContent === '');
const VARIANTS = ['lane_b', 'lane_c', 'meadow_b', 'meadow_c', 'shore_b'];

const agent = await startAgent({ copy: join(REPO, 'examples', 'mossy-ruins.pclaw') });
const browser = await chromium.launch();
try {
  // What the agent sees: the whole village at 1x, the camera at game scale, a house on its ground.
  await agent.call('view', { asset: 'village', mode: 'map' });
  copyFileSync(join(agent.dir, 'views', 'village.map.png'), out('g8-village'));
  await agent.call('view', { asset: 'village', mode: 'map', camera: '20,16' });
  copyFileSync(join(agent.dir, 'views', 'village.map.camera.png'), out('g8-village-camera'));
  copyFileSync(join(agent.dir, 'views', 'village.map.camera.gif'), out('g8-village-camera', 'gif'));
  await agent.call('view', { asset: 'house', mode: 'map' });
  copyFileSync(join(agent.dir, 'views', 'house.map.png'), out('g8-house-scene'));
  await agent.call('view', { asset: 'tree', mode: 'map' });
  copyFileSync(join(agent.dir, 'views', 'tree.map.png'), out('g8-tree-scene'));

  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`${agent.url}&name=chris`);
  await page.getByTestId('status').getByText('live').waitFor();
  await page.locator('.follow input').uncheck();
  await page.locator('.assets li').filter({ has: page.locator('.name', { hasText: /^village$/ }) }).click();
  await page.getByTestId('map-editor').waitFor();
  await settled(page);
  const canvas = page.getByTestId('map-edit-canvas');
  const at = async (x: number, y: number, k = 1) => {
    const b = (await canvas.boundingBox())!;
    return [b.x + (x + 0.5) * 24 * k, b.y + (y + 0.5) * 24 * k] as const;
  };

  // The editor at 1x, placing a tree: its footprint under the pointer.
  await page.locator('[data-tool="place"]').click();
  await page.getByTestId('map-asset').selectOption('tree');
  await page.mouse.move(...await at(11, 13));
  await page.screenshot({ path: out('g8-editor') });

  // Moving the well (a drag in progress).
  await page.locator('[data-tool="move"]').click();
  await page.mouse.move(...await at(20, 18));
  await page.mouse.down();
  await page.mouse.move(...await at(21, 19), { steps: 4 });
  await page.screenshot({ path: out('g8-move') });
  await page.mouse.up();
  await settled(page);
  const ch = await agent.call('changes', {});
  void ch;
  copyFileSync(join(agent.dir, 'views', 'village.diff.png'), out('g8-diff'));

  // The camera at game scale.
  await page.locator('[data-tool="camera"]').click();
  await page.mouse.click(...await at(20, 16));
  await page.getByTestId('map-camera-view').check();
  await page.mouse.move(5, 5);
  await page.screenshot({ path: out('g8-camera') });
  await page.getByTestId('map-camera-view').uncheck();

  // Without its texture variants the village repeats: the hot spots, as the agent and the page see them.
  for (const v of VARIANTS) await agent.call('run', { asset: v, commands: 'variant off' });
  await agent.call('view', { asset: 'village', mode: 'map', marks: 'failing' });
  copyFileSync(join(agent.dir, 'views', 'village.map.png'), out('g8-hotspots'));
  await agent.call('view', { asset: 'village', mode: 'map', marks: 'failing', camera: '19,15' });
  copyFileSync(join(agent.dir, 'views', 'village.map.camera.png'), out('g8-hotspots-camera'));
  await page.reload();
  await page.getByTestId('status').getByText('live').waitFor();
  await page.locator('.follow input').uncheck();
  await page.locator('.assets li').filter({ has: page.locator('.name', { hasText: /^village$/ }) }).click();
  await page.getByTestId('map-editor').waitFor();
  await settled(page);
  await page.getByTestId('map-marks').check();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(500);
  await page.screenshot({ path: out('g8-hotspots-ui') });
} finally {
  await browser.close();
  await agent.close();
}
