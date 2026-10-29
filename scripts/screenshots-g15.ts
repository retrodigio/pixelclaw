// Screenshots for G15 (docs/screenshots/g15-*.png), from the demo's project (run
// `node examples/demo-g15-agent.ts` first): the terrain map as G14 drew it (a band along the map's
// border, one inside tile) and as G15 draws it (a clean border, a mixed inside); in the browser: the
// map editor's terrain tools with the border rule and the inside mix, and the dashboard's worker
// panel with the run's log (done refused while the outline check failed, then finished; the shell
// and the file refused) and the project's spend. Starts servers on copies of the project,
// photographs them, and leaves nothing running.
//   node scripts/screenshots-g15.ts

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { REPO, startAgent } from '../e2e/helpers.ts';

const out = (n: string) => join(REPO, 'docs', 'screenshots', `${n}.png`);
const DEMO = join(REPO, 'out', 'demo-g15.pclaw');
if (!existsSync(join(DEMO, 'views', 'g15-hollow-after.png'))) throw new Error('run node examples/demo-g15-agent.ts first');
const settled = (page: Page) => page.waitForFunction(() => document.querySelector('[data-testid=waiting]')?.textContent === '');

for (const n of ['g15-hollow-before', 'g15-hollow-after']) copyFileSync(join(DEMO, 'views', `${n}.png`), out(n));

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  const agent = await startAgent({ copy: DEMO });
  try {
    // The map editor: the rect tool's terrain settings (border, inside mix) on the hollow.
    await page.goto(`${agent.url}&name=chris`);
    await page.getByTestId('status').getByText('live').waitFor();
    await page.locator('.follow input').uncheck();
    await page.locator('.assets li').filter({ has: page.locator('.name', { hasText: /^hollow($|\s)/ }) }).click();
    await settled(page);
    await page.getByTestId('map-editor').waitFor();
    await page.getByTestId('map-zoom-2').click();
    await page.locator('[data-tool="rect"]').click();
    const box = (await page.getByTestId('map-edit-canvas').boundingBox())!;
    await page.mouse.move(box.x + 3.5 * 48, box.y + 2.5 * 48);
    await page.waitForTimeout(300);
    await page.screenshot({ path: out('g15-map-terrain-tools') });

    // The dashboard's worker panel (enabled on this copy so it shows; nothing is started).
    const pj = JSON.parse(readFileSync(join(agent.dir, 'project.json'), 'utf8'));
    writeFileSync(join(agent.dir, 'project.json'), JSON.stringify({ ...pj, worker: { ...pj.worker, enabled: true } }, null, 2));
    await page.goto(`${agent.url}&name=chris&tab=dashboard`);
    await page.getByTestId('worker').waitFor();
    await page.getByTestId('worker-log-toggle').click();
    await page.getByTestId('worker-log').getByText('run stopped').waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: out('g15-worker-log') });
  } finally {
    await agent.close();
  }
} finally {
  await browser.close();
}
console.log('wrote docs/screenshots/g15-*.png');
