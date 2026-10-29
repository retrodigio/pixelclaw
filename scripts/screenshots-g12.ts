// Screenshot for G12's worker (docs/screenshots/g12-worker.png): the dashboard's Start Claude panel
// and its log, on a copy of the kiln-hollow example with the worker enabled and the fake claude
// (server/test/fake-claude.ts) standing in for Claude Code, so nothing is spent. The jar's change
// is withdrawn and two planned props are asked for; the fake takes both. Leaves nothing running.
//   node scripts/screenshots-g12.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { REPO, startAgent } from '../e2e/helpers.ts';

const agent = await startAgent({ copy: join(REPO, 'examples', 'kiln-hollow.pclaw') });
const browser = await chromium.launch();
try {
  const pj = JSON.parse(readFileSync(join(agent.dir, 'project.json'), 'utf8'));
  writeFileSync(join(agent.dir, 'project.json'), JSON.stringify({ ...pj, worker: { enabled: true, command: [process.execPath, join(REPO, 'server', 'test', 'fake-claude.ts')], cap: 5 } }, null, 2));
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${agent.url}&name=chris&tab=dashboard`);
  const card = (n: string) => page.getByTestId(`card-${n}`);
  await card('jar_icon').getByTestId('cancel').click();
  for (const n of ['reeds', 'cistern']) {
    await card(n).getByTestId('draw').click();
    await card(n).getByTestId('reject-send').click();
    await card(n).locator('[data-state=open]').waitFor();
  }
  await page.evaluate(() => document.querySelector('.dashboard')!.scrollTo(0, 0));
  await page.getByTestId('worker-start').click();
  await page.getByTestId('worker-status').filter({ hasText: 'stopped' }).waitFor({ timeout: 20_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(REPO, 'docs', 'screenshots', 'g12-worker.png'), clip: { x: 560, y: 0, width: 880, height: 520 } });
} finally {
  await browser.close();
  await agent.close();
}
