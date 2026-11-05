// Screenshots for G16 (docs/screenshots/g16-*.png), from the demo's project (run
// `node examples/demo-g16-agent.ts` first): the heath at 1x, the plateau, the lane, the stones'
// shadows, the shingle and grass tiles 3x3; in the browser: the heath in the map editor, the cliff's
// and the lane's sample maps, and the new checks' chips with their pixels circled (on a copy with
// the beacon's fix undone, and the crab's and the pile's faults put back). Starts servers on copies
// of the project, photographs them, and leaves nothing running.
//   node scripts/screenshots-g16.ts

import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { REPO, startAgent } from '../e2e/helpers.ts';

const out = (n: string) => join(REPO, 'docs', 'screenshots', `${n}.png`);
const HEATH = join(REPO, 'out', 'demo-g16.pclaw');
if (!existsSync(join(HEATH, 'views', 'g16-heath.png'))) throw new Error('run node examples/demo-g16-agent.ts first');
const settled = (page: Page) => page.waitForFunction(() => document.querySelector('[data-testid=waiting]')?.textContent === '');

for (const n of ['g16-heath', 'g16-plateau', 'g16-lane', 'g16-shadows', 'g16-shingle-3x3', 'g16-grass-3x3']) copyFileSync(join(HEATH, 'views', `${n}.png`), out(n));

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  const open = async (url: string, name: string) => {
    await page.goto(`${url}&name=chris`);
    await page.getByTestId('status').getByText('live').waitFor();
    await page.locator('.follow input').uncheck();
    await page.locator('.assets li').filter({ has: page.locator('.name', { hasText: new RegExp(`^${name}($|\\s*⑂)`) }) }).click();
    await settled(page);
  };
  const heath = await startAgent({ copy: HEATH });
  try {
    await open(heath.url, 'heath');
    await page.getByTestId('map-editor').waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: out('g16-map-editor') });
    for (const fam of ['cliff', 'lane']) {
      await open(heath.url, fam);
      await page.locator('[data-mode="map"]').click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: out(`g16-${fam}-map`) });
    }
    // The planted faults put back, each check's chip pressed to circle its pixels.
    for (const [asset, undo, check] of [['beacon', 'undo', 'pieces'], ['crab', 'undo', 'margin'], ['pile', 'undo', 'palette']] as const) {
      const r = await heath.call('run', { asset, commands: undo });
      if (r.isError) throw new Error(JSON.stringify(r.content));
      await open(heath.url, asset);
      await page.locator(`[data-check="${check}"]`).click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: out(`g16-check-${check}`) });
    }
  } finally {
    await heath.close();
  }
} finally {
  await browser.close();
}
console.log('wrote docs/screenshots/g16-*.png');
