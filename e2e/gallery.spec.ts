// The gallery (game scale, filters, compare, maps and what they use) and a sheet through the slice
// dialog.

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
