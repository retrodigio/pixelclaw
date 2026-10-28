// Screenshots of the watch view for G6 (docs/screenshots/g6-*.png) and the anim views (contact
// sheets and GIFs). Starts a server on a copy of the example project, drives the page like a
// person, and photographs it. Nothing is left running.
//   node scripts/screenshots-g6.ts

import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { REPO, startAgent } from '../e2e/helpers.ts';

const out = (n: string, ext = 'png') => join(REPO, 'docs', 'screenshots', `${n}.${ext}`);
const settled = (page: Page) => page.waitForFunction(() => document.querySelector('[data-testid=waiting]')?.textContent === '');

const agent = await startAgent({ copy: join(REPO, 'examples', 'mossy-ruins.pclaw') });
// The walker's two open review notes would cover it in every picture: closed on this copy only.
await agent.call('run', { asset: 'walker', commands: 'note done n2\nnote done n3' });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`${agent.url}&name=chris`);
  await page.getByTestId('status').getByText('live').waitFor();
  const open = async (asset: string) => {
    await page.locator('.assets li').filter({ has: page.locator('.name', { hasText: new RegExp(`^${asset}$`) }) }).click();
    await page.waitForFunction((a) => document.querySelector('[data-testid=canvas]')?.getAttribute('data-asset') === a, asset);
    await settled(page);
  };

  // The walker: the timeline with ticks, views (W a live mirror of E), the pivot and ground line.
  await open('walker');
  await page.mouse.move(5, 5);
  await page.screenshot({ path: out('g6-walker') });
  // The onion skin on frame 2: the frame before in red, the one after in blue.
  await page.locator('[data-frame-head="2"]').click();
  await page.getByTestId('onion-prev').check();
  await page.getByTestId('onion-next').check();
  await page.mouse.move(5, 5);
  await page.screenshot({ path: out('g6-onion') });
  await page.getByTestId('onion-prev').uncheck();
  await page.getByTestId('onion-next').uncheck();
  // Playing east at the game's speed, the mirror frames dimmed in the timeline.
  await page.locator('[data-frame-head="5"]').click();
  await page.getByTestId('play-seq').selectOption('E');
  await page.getByTestId('play').click();
  await page.waitForTimeout(650);
  await page.screenshot({ path: out('g6-playing') });
  await page.getByTestId('play').click();
  // The checks over every frame, anim and views among them, with the anim details open.
  await page.locator('.chip[data-check=anim]').click();
  await page.mouse.move(5, 5);
  await page.screenshot({ path: out('g6-checks') });
  await page.locator('.chip[data-check=anim]').click();

  // The water: three layers, the body's cels linked (◆), the crests drifting; wrap ghosts on.
  await open('water');
  await page.getByTestId('play').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: out('g6-water') });
  await page.getByTestId('play').click();

  // The stone floor as flagstones.
  await open('stone_floor');
  await page.mouse.move(5, 5);
  await page.screenshot({ path: out('g6-stone-floor') });

  // A narrow window: the timeline's bars wrap.
  await open('walker');
  await page.setViewportSize({ width: 1100, height: 820 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: out('g6-narrow') });

  // What the agent sees: the anim contact sheets and GIFs, the game view with every direction, the floor's 3x3.
  for (const [asset, mode] of [['walker', 'anim'], ['water', 'anim'], ['walker', 'game'], ['stone_floor', 'tile3x3']] as const) {
    await agent.call('view', { asset, mode, frame: 1 });
    copyFileSync(join(agent.dir, 'views', `${asset}.${mode}.png`), out(`g6-${asset}-${mode}`));
    if (mode === 'anim') copyFileSync(join(agent.dir, 'views', `${asset}.anim.gif`), out(`g6-${asset}`, 'gif'));
  }
} finally {
  await browser.close();
  await agent.close();
}
