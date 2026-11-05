// The dashboard's worker panel shows what the worker has spent on the project over every run.

import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { serverDoc, startAgent, type Agent } from './helpers.ts';

let agent: Agent;
test.afterEach(async () => { await agent?.close(); });


test('the worker panel shows what the worker has spent on the project in all', async ({ page }) => {
  agent = await startAgent();
  const pj = JSON.parse(readFileSync(join(agent.dir, 'project.json'), 'utf8'));
  writeFileSync(join(agent.dir, 'project.json'), JSON.stringify({ ...pj, worker: { enabled: true, cap: 3 } }, null, 2));
  writeFileSync(join(agent.dir, 'worker-spend.jsonl'), [
    { at: '2026-10-29T10:00:00Z', run: '2026-10-29T09:58:00Z', session: 1, cost: 0.75 },
    { at: '2026-10-29T11:00:00Z', run: '2026-10-29T10:59:00Z', session: 1, cost: 0.5, estimated: true },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n');
  await page.goto(`${agent.url}&name=ana&tab=dashboard`);
  await expect(page.getByTestId('worker-status')).toHaveText('$1.25 of $3.00 cap spent');
});
