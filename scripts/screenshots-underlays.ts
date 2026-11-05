// Screenshots for the theme-to-set walkthrough (docs/screenshots/underlays-*.png, font-*.png and icon*.png): the yard's mockup underlay in the watch view,
// then its snapped draft over it; the three tiles cut from the draft (3x3); the 5x7 font in the
// editor with its text preview, and its glyph strip and BMFont page enlarged; the four HUD icons.
// Starts a server on a copy of the kiln-hollow example, photographs it, and leaves nothing running.
//   node scripts/screenshots-underlays.ts

import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { createRgba, decodePng, encodePng } from '../core/src/index.ts';
import { REPO, startAgent } from '../e2e/helpers.ts';

const out = (n: string) => join(REPO, 'docs', 'screenshots', `${n}.png`);
const settled = (page: Page) => page.waitForFunction(() => document.querySelector('[data-testid=waiting]')?.textContent === '');

/** A PNG enlarged k times on a background colour (transparent pixels). */
function enlarge(src: string, dst: string, k: number, bg: [number, number, number]): void {
  const img = decodePng(readFileSync(src));
  const o = createRgba(img.width * k, img.height * k);
  for (let y = 0; y < o.height; y++) for (let x = 0; x < o.width; x++) {
    const i = (Math.floor(y / k) * img.width + Math.floor(x / k)) * 4;
    o.data.set(img.data[i + 3] ? img.data.subarray(i, i + 4) : [...bg, 255], (y * o.width + x) * 4);
  }
  writeFileSync(dst, encodePng(o));
}

const EXAMPLE = join(REPO, 'examples', 'kiln-hollow.pclaw');
enlarge(join(EXAMPLE, 'exports', 'strip', 'hollow_type.png'), out('font-strip'), 4, [32, 34, 40]);
enlarge(join(EXAMPLE, 'exports', 'bmfont', 'hollow_type_0.png'), out('font-bmfont'), 6, [32, 34, 40]);

const agent = await startAgent({ copy: EXAMPLE });
const browser = await chromium.launch();
try {
  for (const t of ['sage', 'yard_clay', 'shallows']) {
    await agent.call('view', { asset: t, mode: 'tile3x3' });
    copyFileSync(join(agent.dir, 'views', `${t}.tile3x3.png`), out(`underlays-${t}-tile3x3`));
  }
  await agent.call('view', { asset: 'yard', mode: 'render', scale: 4 });
  // The icons side by side at 1x and 4x, as the game view draws a set.
  await agent.call('view', { asset: 'jar_icon', mode: 'game', with: ['hearth_icon', 'drop_icon', 'bowl_icon'] });
  copyFileSync(join(agent.dir, 'views', 'jar_icon.game.png'), out('icons-game'));

  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`${agent.url}&name=chris`);
  await page.getByTestId('status').getByText('live').waitFor();
  await page.locator('.follow input').uncheck();
  const pick = async (name: string) => {
    await page.locator('.assets li').filter({ has: page.locator('.name', { hasText: new RegExp(`^${name}($|\\s*⑂)`) }) }).click();
    await settled(page);
  };
  // The yard: first the underlay alone (the draft hidden), then the draft as art over it.
  await agent.call('run', { asset: 'yard', commands: 'layer set draft hidden=on' });
  await pick('yard');
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  await page.waitForTimeout(400);
  await page.mouse.move(5, 5);
  await page.screenshot({ path: out('underlays-yard-underlay') });
  await agent.call('run', { asset: 'yard', commands: 'layer set draft hidden=off reference=off' });
  await settled(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('underlays-yard-draft') });

  await pick('hollow_type');
  await page.locator('[data-testid=preview] [data-tab=text]').click();
  await page.mouse.move(5, 5);
  await page.screenshot({ path: out('font-editor') });

  await pick('bowl_icon');
  await page.mouse.move(5, 5);
  await page.screenshot({ path: out('icon-editor') });
} finally {
  await browser.close();
  await agent.close();
}
console.log('wrote docs/screenshots/underlays-*.png, font-*.png and icon*.png');
