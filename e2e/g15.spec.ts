// G15 in the browser: the map editor's terrain tools set a terrain layer's border rule
// and its inside mix (layer set <layer> border=… mix=…), and the dashboard's worker panel shows
// what the worker has spent on the project over every run (worker-spend.jsonl), not per run.

import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { serverDoc, startAgent, type Agent } from './helpers.ts';

let agent: Agent;
test.afterEach(async () => { await agent?.close(); });

test('the terrain tools set the border rule and the inside mix', async ({ page }) => {
  agent = await startAgent();
  for (const [asset, commands] of [
    ['meadow', 'new tile meadow 24x24 bg=moss1\nnoise ramp=moss weights=0,6,3,1,0 density=0.3 seed=11'],
    ['clover', 'fork meadow clover\npx 7,8 12,15 17,9 c=lichen'],
    ['pondwater', 'new tile pondwater 24x24 bg=pool'],
    ['bank', 'new family bank 24x24 scheme=blob47\nfamily texture inside from=meadow\nfamily texture outside from=pondwater\nfamily band 1:outside 1:soil0 2:soil1'],
    ['hollow', 'new map hollow 12x8 tile=24\nlayer add land terrain=bank outside=on above=floor\nterrain land rect 0,0 12x8\nterrain land rect 5,3 2x2 erase'],
  ] as const) {
    const r = await agent.call('run', { asset, commands });
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
  }
  await page.goto(`${agent.url}&name=chris`);
  await expect(page.getByTestId('status')).toContainText('live');
  await page.locator('.follow input').uncheck();
  await page.locator('.assets li', { hasText: 'hollow' }).click();
  await expect(page.getByTestId('map-editor')).toBeVisible();
  await page.locator('[data-tool="rect"]').click();
  await expect(page.getByTestId('map-border')).toHaveValue('same');
  await expect(page.getByTestId('map-inside-mix')).toHaveValue('');
  const last = async () => (await serverDoc(agent.url, 'hollow')).tape.at(-1)!;
  await page.getByTestId('map-border').selectOption('not');
  await expect.poll(async () => (await last()).cmd).toBe('layer set land border=not');
  expect((await last()).by).toBe('human:chris');
  await page.getByTestId('map-border').selectOption('same');
  await expect.poll(async () => (await last()).cmd).toBe('layer set land border=same');
  await page.getByTestId('map-inside-mix').fill('meadow:2,clover:1');
  await page.getByTestId('map-inside-mix').press('Enter');
  await expect.poll(async () => (await last()).cmd).toMatch(/^layer set land mix=meadow:2,clover:1 variants=named seed=\d+$/);
  await expect(page.getByTestId('map-inside-mix')).toHaveValue('meadow:2,clover:1');
  // The editor's status line names the tile a mixed cell under the pointer shows.
  const box = (await page.getByTestId('map-edit-canvas').boundingBox())!;
  const names = new Set<string>();
  for (const [x, y] of [[2, 2], [3, 2], [2, 3], [8, 5], [9, 5], [9, 6]]) {
    await page.mouse.move(box.x + (x + 0.5) * (box.width / 12), box.y + (y + 0.5) * (box.height / 8));
    const t = await page.getByTestId('map-status').textContent();
    names.add(/\d+,\d+: (\w+)\./.exec(t ?? '')?.[1] ?? '');
  }
  expect([...names].every((n) => n === 'meadow' || n === 'clover')).toBe(true);
  await page.getByTestId('map-inside-mix').fill('');
  await page.getByTestId('map-inside-mix').press('Enter');
  await expect.poll(async () => (await last()).cmd).toBe('layer set land mix=none');
});

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
