// Densities and import in the browser: an asset with a higher-density copy gets a density tab in the
// preview panel (the copies side by side and the highest one reduced, its differences marked);
// looking logs nothing. An imported asset's tape starts with its import commands.

import { expect, test } from '@playwright/test';
import { serverDoc, startAgent, type Agent } from './helpers.ts';

let agent: Agent;
test.beforeEach(async () => { agent = await startAgent(); });
test.afterEach(async () => { await agent.close(); });

test('the density tab shows the copies and the reduction, and logs nothing', async ({ page }) => {
  for (const [asset, commands] of [
    ['imp', 'new sprite imp 24x24\nellipse 6,4 12x16 c=moss2 fill\noutline c=ink'],
    ['imp2x', 'fork imp imp2x\nscale 2\ndensity of=imp d=2\nframe 1\npx 20,10 21,10 20,11 21,11 c=ink'],
  ] as const) expect((await agent.call('run', { asset, commands })).isError).toBeFalsy();
  const before = (await serverDoc(agent.url, 'imp2x')).tape.length;
  await page.goto(`${agent.url}&name=chris`);
  await expect(page.getByTestId('status')).toContainText('live');
  await page.locator('.follow input').uncheck();
  for (const name of ['imp', 'imp2x']) {
    await page.locator('.assets li').filter({ has: page.locator('.name', { hasText: new RegExp(`^${name}($|\\s*⑂)`) }) }).click();
    await page.locator('[data-testid=preview] [data-tab=density]').click();
    const c = page.getByTestId('preview-density');
    await expect(c).toBeVisible();
    // Base 1x at 2x on screen, the copy at 1x, the reduction at 2x: three 48-px panels and gaps.
    expect(await c.evaluate((x: HTMLCanvasElement) => [x.width, x.height])).toEqual([8 + 3 * 56, 64]);
    await expect(page.getByTestId('preview')).toContainText('1 pixels differ from imp');
  }
  expect((await serverDoc(agent.url, 'imp2x')).tape.length).toBe(before);
});
