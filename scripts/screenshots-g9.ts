// Screenshots for G9 (docs/screenshots/g9-*.png): the village with its notes closed (whole, the
// camera at game scale, a rounder corner up close), the house at 2x in the agent's density view and
// in the watch view's density tab, and a sheet re-imported from Aseprite's sheet export with its
// tape starting from the import. Starts a server on a copy of the example project, photographs it,
// and leaves nothing running.
//   node scripts/screenshots-g9.ts

import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { REPO, startAgent } from '../e2e/helpers.ts';

const out = (n: string, ext = 'png') => join(REPO, 'docs', 'screenshots', `${n}.${ext}`);
const settled = (page: Page) => page.waitForFunction(() => document.querySelector('[data-testid=waiting]')?.textContent === '');

const agent = await startAgent({ copy: join(REPO, 'examples', 'mossy-ruins.pclaw') });
const browser = await chromium.launch();
const scratch = mkdtempSync(join(tmpdir(), 'pixelclaw-g9-shots-'));
try {
  // What the agent sees: the village, the camera on the south beach, a rounded corner up close.
  await agent.call('view', { asset: 'village', mode: 'map' });
  copyFileSync(join(agent.dir, 'views', 'village.map.png'), out('g9-village'));
  await agent.call('view', { asset: 'village', mode: 'map', camera: '18,20' });
  copyFileSync(join(agent.dir, 'views', 'village.map.camera.png'), out('g9-village-camera'));
  await agent.call('view', { asset: 'village', mode: 'map', region: '7,18 6x6', scale: 3 });
  copyFileSync(join(agent.dir, 'views', 'village.map.7-18-6x6.png'), out('g9-round-corners'));
  await agent.call('view', { asset: 'house_2x', mode: 'density', scale: 2 });
  copyFileSync(join(agent.dir, 'views', 'house_2x.density.png'), out('g9-house-density'));

  // A sheet back from Aseprite's sheet export, imported by a grid.
  await agent.call('export', { profile: 'aseprite-json', assets: ['walker'], dest: scratch });
  await agent.call('import', { path: join(scratch, 'walker.png'), as: 'walker_sheet', grid: '24x24', palette: 'ruins-folk' });

  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`${agent.url}&name=chris`);
  await page.getByTestId('status').getByText('live').waitFor();
  await page.locator('.follow input').uncheck();
  const pick = async (name: string) => {
    await page.locator('.assets li').filter({ has: page.locator('.name', { hasText: new RegExp(`^${name}($|\\s*⑂)`) }) }).click();
    await settled(page);
  };

  await pick('house_2x');
  await page.locator('[data-testid=preview] [data-tab=density]').click();
  await page.mouse.move(5, 5);
  await page.screenshot({ path: out('g9-density-tab') });

  await pick('walker_sheet');
  await page.mouse.move(5, 5);
  await page.screenshot({ path: out('g9-imported') });

  await pick('village');
  await page.getByTestId('map-editor').waitFor();
  await settled(page);
  await page.mouse.move(5, 5);
  await page.screenshot({ path: out('g9-village-editor') });
} finally {
  await browser.close();
  await agent.close();
  rmSync(scratch, { recursive: true, force: true });
}
