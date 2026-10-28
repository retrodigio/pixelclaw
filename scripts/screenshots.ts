// Screenshots of the watch view for the docs (docs/screenshots/g2-*.png). Starts a server on a
// temporary project, drives it over MCP, and photographs the page at a few moments.
//   node scripts/screenshots.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { REPO, startAgent } from '../e2e/helpers.ts';

const out = (n: string) => join(REPO, 'docs', 'screenshots', `g2-${n}.png`);
const script = readFileSync(join(REPO, 'examples', 'scripts', 'stone_floor.pclaw'), 'utf8');
const sections = script.split(/\n(?=# --- )/).map((s) => s.trim());

const agent = await startAgent();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 860 }, deviceScaleFactor: 1 });
  await page.goto(agent.url);
  await page.getByTestId('status').getByText('live').waitFor();
  await page.screenshot({ path: out('empty') });
  for (const s of sections.slice(0, 3)) await agent.call('run', { asset: 'stone_floor', commands: s });
  await agent.call('view', { asset: 'stone_floor', mode: 'render' });
  await page.locator('[data-testid=canvas]').waitFor();
  // Mid-playback: some lines played, the rest dimmed.
  await page.waitForFunction(() => Number(document.querySelector('[data-testid=canvas]')?.getAttribute('data-seq')) >= 16);
  await page.screenshot({ path: out('playback') });
  for (const s of sections.slice(3)) await agent.call('run', { asset: 'stone_floor', commands: s });
  await page.getByTestId('speed').selectOption('Infinity');
  await agent.call('view', { asset: 'stone_floor', mode: 'tile3x3' });
  await page.waitForFunction(() => document.querySelector('[data-testid=waiting]')?.textContent === '');
  await page.screenshot({ path: out('live') });
  await page.locator('.cmd-row[data-seq="20"]').click();
  await page.screenshot({ path: out('travel') });
  await page.getByRole('button', { name: 'Back to live' }).click();
  await page.locator('[data-testid=eye] img').click();
  await page.screenshot({ path: out('eye') });
  await page.locator('.modal').click();
  await agent.call('run', {
    asset: 'runes', commands: `new sheet runes 48x16 cell=16x16 bg=none
rect 2,2 12x12 c=stone2 fill ; rect 18,2 12x12 c=stone2 fill ; rect 34,2 12x12 c=stone2 fill
line 8,4 8,11 c=moss3 ; line 5,7 11,7 c=moss3
ellipse 24,8 r=3x3 c=lichen ; px 24,8 c=lichen
line 37,4 43,11 c=pool ; line 43,4 37,11 c=pool`,
  });
  await page.waitForFunction(() => document.querySelector('[data-testid=canvas]')?.getAttribute('data-asset') === 'runes'
    && document.querySelector('[data-testid=waiting]')?.textContent === '');
  await page.screenshot({ path: out('sheet') });
  console.log('wrote docs/screenshots/g2-{empty,playback,live,travel,eye,sheet}.png');
} finally {
  await browser.close();
  await agent.close();
}
