// Screenshots of the watch view for the G5 docs (docs/screenshots/g5-*.png): check chips and
// their marks, pinning a flagged group as a note, the preview panel, role colours under a theme,
// and the options bar on a narrow window. Starts a server on a copy of the example project with
// the test sprite and a grass variant at their state before the fixes, drives it over MCP like an
// agent and with the mouse like a person. Nothing is left running.
//   node scripts/screenshots-g5.ts

import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { REPO, startAgent } from '../e2e/helpers.ts';

const out = (n: string) => join(REPO, 'docs', 'screenshots', `${n}.png`);
const script = (f: string) => readFileSync(join(REPO, 'examples', 'scripts', f), 'utf8');
const settled = (page: Page) => page.waitForFunction(() => document.querySelector('[data-testid=waiting]')?.textContent === '');

const agent = await startAgent({ copy: join(REPO, 'examples', 'mossy-ruins.pclaw') });
// The test sprite and the first grass variant start again from before G5's fixes.
for (const a of ['glowcap', 'grass_b']) rmSync(join(agent.dir, 'assets', a), { recursive: true, force: true });
const run = async (asset: string, commands: string) => {
  const r = await agent.call('run', { asset, commands });
  if (r.isError) throw new Error(r.content.map((c) => c.text).join('\n'));
};
await run('glowcap', script('glowcap.pclaw'));
await run('grass_b', script('grass_b.pclaw'));

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 860 }, deviceScaleFactor: 1 });
  await page.goto(`${agent.url}&name=chris`);
  await page.getByTestId('status').getByText('live').waitFor();
  await page.getByTestId('speed').selectOption('Infinity');
  const pick = async (asset: string) => {
    await page.locator('.assets li').filter({ has: page.locator('.name', { hasText: new RegExp(`^${asset}( |$)`) }) }).click();
    await page.waitForFunction((a) => document.querySelector('[data-testid=canvas]')?.getAttribute('data-asset') === a, asset);
    await settled(page);
  };
  const chip = (id: string) => page.locator(`[data-check=${id}]`).first();

  // The test sprite with its five defects: the chips, the outline's gaps and the strays circled.
  await pick('glowcap');
  await chip('orphans').click();
  await chip('outline').click();
  await page.screenshot({ path: out('g5-checks') });
  // Pin the outline's gaps as a note for the agent.
  await page.getByTestId('check-pin').first().click();
  await page.locator('.note-label').first().waitFor();
  await page.getByTestId('check-close').click();
  await page.screenshot({ path: out('g5-pin-note') });

  // The agent fixes it by those coordinates: every chip green, the game view in the preview.
  await run('glowcap', 'note done n1');
  await run('glowcap', script('glowcap_fix.pclaw'));
  await run('glowcap', script('glowcap_review.pclaw').replace(/^note .*$/gm, ''));
  await settled(page);
  await page.screenshot({ path: out('g5-fixed') });

  // A grass variant: the stripe the repetition check finds, on the canvas and in the 3x3 preview.
  await pick('grass_b');
  await chip('repetition').click();
  await page.screenshot({ path: out('g5-repetition') });
  await page.getByTestId('check-close').click();

  // Role colours under a preview theme, and the art under every theme in the preview.
  await run('lantern', `new sprite lantern 24x24 palette=ruins-props
palette add rim role=black
palette add glow role=white
palette add flame role=light
palette add body role=dark
palette add shade role=darkest
# A hanging lantern: a cap and a ring, a glass body, a flame inside, a base.
rect 9,2 6x2 c=shade fill
rect 7,4 10x2 c=body fill
rect 6,6 12x11 c=body fill
rect 8,7 8x9 c=flame fill
ellipse 10,9 4x6 c=glow fill
rect 6,17 12x2 c=shade fill
rect 8,19 8x2 c=body fill
line 6,6 6,16 c=shade
line 17,6 17,16 c=shade
outline c=rim`);
  await pick('lantern');
  await page.getByTestId('theme').selectOption('lantern');
  await page.locator('.preview [data-tab=themes]').click();
  await page.screenshot({ path: out('g5-themes') });

  // A narrow window: the options bar keeps its groups together on one row; chips stay readable.
  await page.setViewportSize({ width: 1100, height: 760 });
  await pick('chest');
  await page.keyboard.press('b');
  await page.screenshot({ path: out('g5-narrow') });
} finally {
  await browser.close();
  await agent.close();
}
