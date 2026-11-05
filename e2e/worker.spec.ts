// The worker in the dashboard: no Start Claude unless enabled; enabled, it runs (a fake claude) and
// its log shows.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { encodePng, createRgba, foldRequests, type RequestRecord } from '../core/src/index.ts';
import { REPO, serverDoc, startAgent, type Agent } from './helpers.ts';

let agent: Agent;
test.afterEach(async () => { await agent?.close(); });

const MANIFEST = {
  format: 'pixelclaw-manifest', version: 1, theme: 'Moss over old stone, lit from the top left.',
  sets: { ground: { description: 'floors' }, props: { description: 'things that stand' }, scenes: { description: 'places' } },
  assets: [
    { name: 'turf', kind: 'tile', size: '24x24', set: 'ground', description: 'short moss' },
    { name: 'urn', kind: 'sprite', size: '16x16', set: 'props', height: 12, description: 'a squat stone urn' },
    { name: 'post', kind: 'sprite', size: '16x16', set: 'props', height: 14, description: 'a waymark post' },
    { name: 'court', kind: 'map', size: '8x6', set: 'scenes', uses: ['turf', 'post'] },
  ],
  scenes: [{ name: 'gate', description: 'the gate court', uses: ['turf', 'urn', 'post'], map: 'court' }],
};

const records = (a: Agent) => readFileSync(join(a.dir, 'requests.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as RequestRecord);
const text = (r: { content: { text?: string }[] }) => r.content.map((c) => c.text ?? '').join('\n');



test('the worker: no Start Claude unless enabled; enabled, it runs (a fake claude) and its log shows', async ({ page }) => {
  agent = await startAgent();
  expect((await agent.call('plan', { manifest: MANIFEST })).isError).toBeFalsy();
  await page.goto(`${agent.url}&name=ana&tab=dashboard`);
  await expect(page.getByTestId('card-urn')).toBeVisible();
  await expect(page.getByTestId('worker-start')).toHaveCount(0);
  // The person enables it in project.json (a fake claude stands in for the CLI), and reloads.
  const pj = JSON.parse(readFileSync(join(agent.dir, 'project.json'), 'utf8'));
  writeFileSync(join(agent.dir, 'project.json'), JSON.stringify({ ...pj, worker: { enabled: true, command: [process.execPath, join(REPO, 'server', 'test', 'fake-claude.ts')], cap: 2 } }, null, 2));
  await page.reload();
  await page.getByTestId('card-urn').getByTestId('draw').click();
  await page.getByTestId('card-urn').getByTestId('reject-send').click();
  await expect(page.getByTestId('card-urn').getByTestId('request-r1')).toHaveAttribute('data-state', 'open');
  await page.getByTestId('worker-start').click();
  await expect(page.getByTestId('worker-log')).toContainText('run started by human:ana: cap $2.00');
  await expect(page.getByTestId('worker-status')).toContainText('stopped: the queue is empty', { timeout: 20_000 });
  await expect(page.getByTestId('worker-log')).toContainText('→ work {}');
  await expect(page.getByTestId('card-urn').getByTestId('request-r1')).toHaveAttribute('data-state', 'done');
  await expect(page.getByTestId('card-urn')).toHaveAttribute('data-status', /drafted|checked/);
});
