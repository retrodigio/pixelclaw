// Screenshots of the watch view for G7 (docs/screenshots/g7-*.png) and what the agent sees of a
// family (the map and family views, a map GIF). Starts a server on a copy of the example project,
// drives the page like a person, and photographs it. Nothing is left running.
//   node scripts/screenshots-g7.ts

import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { REPO, startAgent } from '../e2e/helpers.ts';

const out = (n: string, ext = 'png') => join(REPO, 'docs', 'screenshots', `${n}.${ext}`);
const settled = (page: Page) => page.waitForFunction(() => document.querySelector('[data-testid=waiting]')?.textContent === '');

const agent = await startAgent({ copy: join(REPO, 'examples', 'mossy-ruins.pclaw') });
// Open review notes would cover the art in every picture: closed on this copy only.
for (const a of ['walker', 'shore', 'sand']) {
  const h = (await agent.call('project', {})).content.map((c) => c.text).join('\n');
  const open = new RegExp(`${a}:.*open notes: ([n\\d, ]+)`).exec(h)?.[1];
  if (open) await agent.call('run', { asset: a, commands: open.split(', ').map((n) => `note done ${n.trim()}`).join('\n') });
}
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`${agent.url}&name=chris`);
  await page.getByTestId('status').getByText('live').waitFor();
  await page.locator('.follow input').uncheck();
  const open = async (asset: string) => {
    await page.locator('.assets li').filter({ has: page.locator('.name', { hasText: new RegExp(`^${asset}$`) }) }).click();
    await page.waitForFunction((a) => document.querySelector('.crumbs')?.textContent?.includes(a), asset);
    await settled(page);
  };

  // The shore's sheet: the two textures, the 47 variants (pieces drawn by hand on layer band).
  await open('shore');
  await page.locator('[data-mode="sheet"]').click();
  await page.mouse.move(5, 5);
  await page.screenshot({ path: out('g7-sheet') });
  // Every variant among its neighbours; pieces and detached variants marked.
  await page.locator('[data-mode="variants"]').click();
  await page.mouse.move(5, 5);
  await page.screenshot({ path: out('g7-variants') });
  // The shore on a random island, the glints playing, the seam score above it.
  await page.locator('[data-mode="map"]').click();
  await page.getByTestId('map-seed').fill('6');
  await page.waitForTimeout(500);
  await page.mouse.move(5, 5);
  await page.screenshot({ path: out('g7-map') });
  // Back on the sheet with the timeline's rows folded (only the layer you draw on).
  await page.locator('[data-mode="sheet"]').click();
  await page.getByTestId('tl-fold-ticks').click();
  await page.getByTestId('tl-fold-layers').click();
  await page.mouse.move(5, 5);
  await page.screenshot({ path: out('g7-folded') });

  // What the agent sees: the map (and its GIF at 1x) and the family view.
  await agent.call('view', { asset: 'shore', mode: 'map', size: '16x12', seed: 6, with: ['glint'] });
  copyFileSync(join(agent.dir, 'views', 'shore.map.png'), out('g7-shore-map'));
  await agent.call('view', { asset: 'shore', mode: 'map', size: '12x9', seed: 6, with: ['glint'], scale: 1 });
  copyFileSync(join(agent.dir, 'views', 'shore.map.gif'), out('g7-shore-map', 'gif'));
  await agent.call('view', { asset: 'shore', mode: 'family' });
  copyFileSync(join(agent.dir, 'views', 'shore.family.png'), out('g7-shore-family'));
} finally {
  await browser.close();
  await agent.close();
}
