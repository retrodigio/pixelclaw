// Screenshots for the map-variety walkthrough (docs/screenshots/variety-*.png), from the demo's projects (run
// `node examples/variety-agent.ts` first): Fern Ledge before and after the mix (the lattice's
// cells outlined), the 48 px moor at 1x and a screen of it, the pool on an island; in the browser:
// the lattice's hot spots on Fern Ledge as examples/ledge-agent.ts leaves it, the map editor's fill tool with a mix (on
// a copy with the mix undone), and the 48 px project's gallery and family map at 1x. Starts servers on copies of the
// projects, photographs them, and leaves nothing running.
//   node scripts/screenshots-variety.ts

import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { REPO, startAgent } from '../e2e/helpers.ts';

const out = (n: string) => join(REPO, 'docs', 'screenshots', `${n}.png`);
const FERN = join(REPO, 'out', 'variety.pclaw');
const MOOR = join(REPO, 'out', 'variety-moor.pclaw');
const BEFORE = join(REPO, 'out', 'variety-before.pclaw');
if (!existsSync(join(FERN, 'views', 'variety-fern-before.png'))) throw new Error('run node examples/variety-agent.ts first');
const settled = (page: Page) => page.waitForFunction(() => document.querySelector('[data-testid=waiting]')?.textContent === '');

for (const n of ['variety-fern-before', 'variety-fern-after']) copyFileSync(join(FERN, 'views', `${n}.png`), out(n));
for (const n of ['variety-moor-map', 'variety-moor-camera', 'variety-pool-island']) copyFileSync(join(MOOR, 'views', `${n}.png`), out(n));

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

  // Fern Ledge as examples/ledge-agent.ts leaves it: the lattice's hot spots.
  const was = await startAgent({ copy: BEFORE });
  try {
    await open(was.url, 'fern_ledge');
    await page.getByTestId('map-editor').waitFor();
    await page.getByTestId('map-zoom-2').click();
    await page.getByTestId('map-marks').check();
    await page.waitForTimeout(300);
    await page.screenshot({ path: out('variety-map-lattice') });
  } finally {
    await was.close();
  }
  // After the demo, with the mix undone: the fill tool's mix weights.
  const fern = await startAgent({ copy: FERN });
  try {
    const r = await fern.call('run', { asset: 'fern_ledge', commands: 'undo' });
    if (r.isError) throw new Error(JSON.stringify(r.content));
    await open(fern.url, 'fern_ledge');
    await page.getByTestId('map-editor').waitFor();
    await page.getByTestId('map-zoom-2').click();
    await page.locator('[data-tool="fill"]').click();
    await page.getByTestId('map-fill-tile').selectOption('(mix)');
    await page.getByTestId('map-mix-bed_b').fill('2');
    await page.getByTestId('map-mix-bed_c').fill('1');
    await page.getByTestId('map-mix-bed_d').fill('1');
    const box = (await page.getByTestId('map-edit-canvas').boundingBox())!;
    await page.mouse.move(box.x + 8.5 * 32, box.y + 6.5 * 32);
    await page.waitForTimeout(300);
    await page.screenshot({ path: out('variety-map-fill-mix') });
  } finally {
    await fern.close();
  }

  // The 48 px project: the gallery and the pool's sample map at the draw scale (1x).
  const moor = await startAgent({ copy: MOOR });
  try {
    await page.goto(`${moor.url}&name=chris&tab=gallery`);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: out('variety-moor-gallery') });
    await open(moor.url, 'pool');
    await page.locator('[data-mode="map"]').click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: out('variety-moor-family-map') });
    await open(moor.url, 'moor_map');
    await page.getByTestId('map-editor').waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: out('variety-moor-editor') });
  } finally {
    await moor.close();
  }
} finally {
  await browser.close();
}
console.log('wrote docs/screenshots/variety-*.png');
