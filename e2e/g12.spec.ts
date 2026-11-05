// Plan §21 in the browser: the dashboard's request buttons (Draw this, Ask for changes, Add an
// asset) write records that replay (core's fold of requests.jsonl) to the states the cards show;
// the agent's claim shows "Claude is working on this" while its batches arrive, done and blocked
// show on the card, and the person's answer opens it again. The gallery: game scale, filters,
// compare, maps and the assets they use; a sheet imported through the slice dialog. The worker's
// button only when project.json enables it, running a fake claude.

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

test('request buttons write records; the cards follow the agent through claim, work, done, blocked and an answer', async ({ page }) => {
  agent = await startAgent();
  expect((await agent.call('plan', { manifest: MANIFEST })).isError).toBeFalsy();
  expect((await agent.call('run', { asset: 'post', commands: 'new sprite post\nrect 6,2 4x12 c=soil1 fill\noutline c=ink' })).isError).toBeFalsy();
  await page.goto(`${agent.url}&name=ana&tab=dashboard`);
  const card = (n: string) => page.getByTestId(`card-${n}`);
  await expect(card('urn')).toHaveAttribute('data-status', 'planned');
  await expect(page.getByTestId('scene-gate')).toContainText('urn');

  // Draw this (planned), Ask for changes (drawn), Add an asset (a new manifest entry).
  await card('urn').getByTestId('draw').click();
  await card('urn').getByTestId('reject-text').fill('squat, with a lip');
  await card('urn').getByTestId('reject-send').click();
  await expect(card('urn').getByTestId('request-r1')).toHaveAttribute('data-state', 'open');
  await card('post').getByTestId('reject').click();
  await card('post').getByTestId('reject-text').fill('make it taller');
  await card('post').getByTestId('reject-send').click();
  await expect(card('post').getByTestId('request-r2')).toHaveAttribute('data-state', 'open');
  await page.getByTestId('add-asset-open').click();
  await page.getByTestId('add-name').fill('lamp');
  await page.getByTestId('add-size').fill('16');
  await page.getByTestId('add-set').selectOption('props');
  await page.getByTestId('add-send').click();
  await expect(page.getByTestId('add-error')).toContainText('size');
  await page.getByTestId('add-size').fill('16x16');
  await page.getByTestId('add-description').fill('a lantern on a pole');
  await page.getByTestId('add-send').click();
  await expect(card('lamp').getByTestId('request-r3')).toHaveAttribute('data-state', 'open');
  await expect(page.getByTestId('requests-count')).toHaveText('3 requests for Claude');
  expect(records(agent).map((r) => [r.type, r.id, r.by])).toEqual([['request', 'r1', 'human:ana'], ['request', 'r2', 'human:ana'], ['request', 'r3', 'human:ana']]);
  expect(JSON.parse(readFileSync(join(agent.dir, 'manifest.json'), 'utf8')).assets.at(-1)).toMatchObject({ name: 'lamp', kind: 'sprite', size: '16x16', set: 'props' });
  expect((await serverDoc(agent.url, 'post')).tape.at(-1)).toMatchObject({ by: 'human:ana', cmd: 'mark rejected "make it taller"' });

  // The agent claims r1 and draws: the card says Claude is working on it.
  expect(text(await agent.call('plan', {}))).toMatch(/^Requests from people \(3\)/);
  expect(text(await agent.call('work', {}))).toMatch(/^claimed r1/);
  await expect(card('urn').getByTestId('request-r1')).toHaveAttribute('data-state', 'claimed');
  expect((await agent.call('run', { asset: 'urn', commands: 'new sprite urn\nrect 4,4 8x10 c=stone2 fill' })).isError).toBeFalsy();
  await expect(card('urn').getByTestId('working')).toContainText('Claude is working on this');
  expect((await agent.call('work', { action: 'progress', text: 'outlining' })).isError).toBeFalsy();
  await expect(card('urn').getByTestId('working')).toContainText('outlining');
  // Done is refused while a check fails: the urn has no outline yet.
  expect(text(await agent.call('work', { action: 'done', text: 'drew the urn with a lip' }))).toMatch(/r1 is not done: urn fails/);
  expect((await agent.call('run', { asset: 'urn', commands: 'outline c=ink' })).isError).toBeFalsy();
  expect((await agent.call('work', { action: 'done', text: 'drew the urn with a lip' })).isError).toBeFalsy();
  await expect(card('urn').getByTestId('request-r1')).toHaveAttribute('data-state', 'done');
  await expect(card('urn')).toContainText('✓ done: drew the urn with a lip');

  // r2 blocked with a question; the person answers on the card; it is open again.
  expect(text(await agent.call('work', {}))).toMatch(/^claimed r2/);
  expect((await agent.call('work', { action: 'blocked', text: 'Taller by 2 px or 4 px?' })).isError).toBeFalsy();
  await expect(card('post').getByTestId('request-r2')).toHaveAttribute('data-state', 'blocked');
  await expect(card('post')).toContainText('Claude asks: “Taller by 2 px or 4 px?”');
  await card('post').getByTestId('reply-text').fill('4 px');
  await card('post').getByTestId('reply-send').click();
  await expect(card('post').getByTestId('request-r2')).toHaveAttribute('data-state', 'open');
  // Withdraw r3.
  await card('lamp').getByTestId('cancel').click();
  await expect(card('lamp').getByTestId('request-r3')).toHaveCount(0);

  // The records replay (core's fold) to exactly what the cards showed.
  const { requests, problems } = foldRequests(records(agent));
  expect(problems).toEqual([]);
  expect([...requests.values()].map((q) => [q.id, q.state])).toEqual([['r1', 'done'], ['r2', 'open'], ['r3', 'cancelled']]);
  expect(requests.get('r2')!.events.map((e) => [e.type, e.by])).toEqual([['claim', 'claude'], ['blocked', 'claude'], ['reply', 'human:ana']]);
});

test('the gallery: game scale, filters, compare, maps and what they use; a sheet through the slice dialog', async ({ page }) => {
  agent = await startAgent();
  expect((await agent.call('plan', { manifest: MANIFEST })).isError).toBeFalsy();
  for (const [asset, commands] of [
    ['turf', 'new tile turf bg=moss2\nnoise ramp=moss density=0.2 seed=4'],
    ['post', 'new sprite post\nrect 6,2 4x12 c=soil1 fill\noutline c=ink\nframe add copy=1\npx 7,3 c=soil2\nframe set all ticks=20'],
    ['urn', 'new sprite urn\nrect 4,4 8x10 c=stone2 fill\noutline c=ink'],
    ['court', 'new map court tile=24\nlayer add props objects\nplace turf 0,0 layer=props\nplace post 3,3 layer=props'],
  ] as const) expect((await agent.call('run', { asset, commands })).isError, asset).toBeFalsy();
  await page.goto(`${agent.url}&name=ana&tab=gallery`);
  const item = (n: string) => page.getByTestId(`g-${n}`);
  await expect(item('urn')).toBeVisible();
  // Game scale is the style guide's draw scale (2 by default): the urn is 32 px; the post plays its 2 frames.
  await expect(page.getByTestId('sprite-urn')).toHaveAttribute('width', '32');
  await expect(page.getByTestId('sprite-post')).toHaveAttribute('data-frames', '2');
  await expect(item('court')).toContainText('uses');
  await expect(item('post')).toContainText('in court');
  // Filters.
  await page.getByTestId('g-kind').selectOption('tile');
  await expect(item('urn')).toHaveCount(0);
  await expect(item('turf')).toBeVisible();
  await page.getByTestId('g-kind').selectOption('all');
  await page.getByTestId('g-status').selectOption('planned');
  await expect(item('urn')).toHaveCount(0);
  await page.getByTestId('g-status').selectOption('all');
  // Both ways: the map's assets, an asset's maps.
  await item('court').getByRole('button', { name: 'post' }).click();
  await expect(item('urn')).toHaveCount(0);
  await expect(item('court')).toBeVisible();
  await page.getByTestId('g-related-clear').click();
  // Compare two side by side.
  await page.getByTestId('pick-urn').check();
  await page.getByTestId('pick-post').check();
  await page.getByTestId('compare').click();
  await expect(page.getByTestId('compare-view').locator('canvas')).toHaveCount(2);

  // Import a sheet: three 16x16 cells, one empty, sliced into assets named by a pattern.
  const img = createRgba(48, 16);
  for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) { img.data.set([0x14, 0x16, 0x1c, 255], (y * 48 + x) * 4); img.data.set([0x14, 0x16, 0x1c, 255], (y * 48 + 32 + x) * 4); }
  const sheet = join(agent.dir, '..', 'pebbles.png');
  writeFileSync(sheet, encodePng(img));
  await page.getByTestId('import-input').setInputFiles(sheet);
  await expect(page.getByTestId('import-dialog')).toBeVisible();
  await page.getByTestId('cell-w').fill('16');
  await page.getByTestId('cell-h').fill('16');
  await page.getByTestId('import-kind').selectOption('sprite');
  await page.getByTestId('import-set').selectOption('props');
  await expect(page.getByTestId('import-names')).toContainText('2 assets: pebbles_1, pebbles_2 (1 empty cells skipped)');
  await page.getByTestId('import-go').click();
  await expect(page.getByTestId('import-result')).toContainText('2 assets made; 2 added to the plan');
  await expect(page.getByTestId('imported-pebbles_2')).toContainText('sprite 16x16');
  await page.getByTestId('import-close').click();
  await expect(item('pebbles_2')).toBeVisible();
  const m = JSON.parse(readFileSync(join(agent.dir, 'manifest.json'), 'utf8')) as { assets: { name: string; set?: string }[] };
  expect(m.assets.filter((a) => a.name.startsWith('pebbles')).map((a) => [a.name, a.set])).toEqual([['pebbles_1', 'props'], ['pebbles_2', 'props']]);
  expect((await serverDoc(agent.url, 'pebbles_2')).tape.at(-1)!.cmd).toMatch(/^import 0,0 from="pebbles.png cell 2,0" blob=/);
});

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
