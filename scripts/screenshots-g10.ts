// Screenshots for G10 (docs/screenshots/g10-*.png): the dashboard of the kiln-hollow example (20
// planned assets, three exported), a card sent back with "Ask for changes" and another with the
// form open, a narrow window, the editor with the marks on the kiln's tape, the flat templates
// (the mockup screen, the bank's blob47-round coverage map) and the three finished assets at
// game scale. Starts a server on a copy of the example project, photographs it, and leaves
// nothing running.
//   node scripts/screenshots-g10.ts

import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { REPO, startAgent } from '../e2e/helpers.ts';

const out = (n: string) => join(REPO, 'docs', 'screenshots', `${n}.png`);
const EXAMPLE = join(REPO, 'examples', 'kiln-hollow.pclaw');

copyFileSync(join(EXAMPLE, 'templates', 'mockup@2x.png'), out('g10-mockup'));
copyFileSync(join(EXAMPLE, 'templates', 'bank.coverage.png'), out('g10-coverage-bank'));

const agent = await startAgent({ copy: EXAMPLE });
const browser = await chromium.launch();
try {
  for (const [a, mode] of [['clay', 'tile3x3'], ['urn', 'game'], ['kiln', 'game']] as const) {
    await agent.call('view', { asset: a, mode });
    copyFileSync(join(agent.dir, 'views', `${a}.${mode}.png`), out(`g10-${a}-${mode}`));
  }
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`${agent.url}&name=chris&tab=dashboard`);
  await page.getByTestId('card-kiln').waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.dash-card img')].every((i) => (i as HTMLImageElement).complete));
  await page.screenshot({ path: out('g10-dashboard') });
  // A person sends the urn back; the kiln's form is open for another note.
  await page.getByTestId('card-urn').getByTestId('reject').click();
  await page.getByTestId('card-urn').getByTestId('reject-text').fill('the rim wants a lip of light on the left');
  await page.getByTestId('card-urn').getByTestId('reject-send').click();
  await page.getByTestId('card-urn').and(page.locator('[data-status=reviewed]')).waitFor();
  await page.getByTestId('set-filter').selectOption('works');
  await page.getByTestId('card-kiln').getByTestId('reject').click();
  await page.getByTestId('card-kiln').getByTestId('reject-text').fill('more smoke-black around the fire-mouth');
  await page.screenshot({ path: out('g10-dashboard-works') });
  await page.getByTestId('card-kiln').getByTestId('reject-text').press('Escape');
  await page.getByTestId('set-filter').selectOption('props');
  await page.screenshot({ path: out('g10-dashboard-actions') });
  await page.getByTestId('set-filter').selectOption('all');

  await page.setViewportSize({ width: 1000, height: 760 });
  await page.screenshot({ path: out('g10-dashboard-narrow') });
  await page.setViewportSize({ width: 1400, height: 900 });

  // The kiln in the editor: its tape ends with the review's notes closed and the marks.
  await page.getByTestId('card-kiln').locator('.thumb').click();
  await page.getByTestId('canvas').waitFor();
  await page.getByTestId('speed').selectOption('Infinity');
  await page.waitForFunction(() => document.querySelector('[data-testid=waiting]')?.textContent === '');
  await page.getByTestId('tape').evaluate((e) => { e.scrollTop = e.scrollHeight; });
  await page.screenshot({ path: out('g10-editor-marks') });
} finally {
  await browser.close();
  await agent.close();
}
console.log('wrote docs/screenshots/g10-*.png');
