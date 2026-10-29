// Plan §10 G8 in the browser: every map control (paint, rectangle, erase, place, move, remove)
// logs a command written by the person, and core's replay of the server's tape, composed from the
// assets it names, equals the map on the canvas; the camera, the zoom and the hot spots log nothing.

import { expect, test, type Page } from '@playwright/test';
import { composeMapDoc, mapWorld, paintComposed, type Doc } from '../core/src/index.ts';
import { serverDoc, startAgent, type Agent } from './helpers.ts';

let agent: Agent;
test.beforeEach(async () => { agent = await startAgent(); });
test.afterEach(async () => { await agent.close(); });

const T = 8;
const SETUP: [string, string][] = [
  ['land', [
    `new family land ${T}x${T} scheme=blob47`,
    `rect @cell(inside) 0,0 ${T}x${T} c=moss2 fill`, 'px @cell(inside) 2,2 5,6 c=moss3',
    `rect @cell(outside) 0,0 ${T}x${T} c=pool fill`, 'family band 1:outside 1:stone4 radius=1',
  ].join('\n')],
  ['hut', [`new object hut 16x16 cell=${T}x${T}`, 'rect 0,0 16x8 c=soil2 fill', 'rect 2,8 12x8 c=stone3 fill', 'footprint 2x1 anchor=0,0 <<\n  rr\n  bb\n>>'].join('\n')],
  ['bush', [`new object bush ${T}x${T}`, 'ellipse 1,1 6x6 c=moss3 fill'].join('\n')],
  ['turf', [`new tile turf ${T}x${T}`, `rect 0,0 ${T}x${T} c=moss1 fill`, 'px 2,3 5,6 c=moss2'].join('\n')],
  ['turf_b', [`new tile turf_b ${T}x${T}`, 'variant of=turf', `rect 0,0 ${T}x${T} c=moss1 fill`, 'px 5,1 1,5 c=moss2'].join('\n')],
  ['isle', ['new map isle 12x9 tile=8', 'layer add sea terrain=land outside=on above=floor', 'layer add props objects above=sea', 'terrain sea rect 2,2 8x5'].join('\n')],
];

const tapeLength = async () => (await serverDoc(agent.url, 'isle')).tape.length;

/** The map as core composes it from the server's tapes. */
async function expected(): Promise<{ width: number; height: number; data: number[] }> {
  const docs: { name: string; doc: Doc }[] = [];
  for (const [name] of SETUP) docs.push({ name, doc: (await serverDoc(agent.url, name)).doc });
  const map = docs.find((d) => d.name === 'isle')!.doc;
  const img = paintComposed(composeMapDoc(map, mapWorld(docs)), { scale: 1 });
  return { width: img.width, height: img.height, data: [...img.data] };
}

async function canvas(page: Page): Promise<{ width: number; height: number; data: number[] }> {
  return page.getByTestId('map-edit-canvas').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    return { width: c.width, height: c.height, data: [...d.data] };
  });
}

async function matches(page: Page): Promise<void> {
  await page.mouse.move(1, 1);
  const want = await expected();
  await expect.poll(async () => { const got = await canvas(page); return got.width === want.width && got.data.every((v, i) => v === want.data[i]); }).toBe(true);
}

async function act(page: Page, action: () => Promise<void>, logged: (string | RegExp)[]): Promise<void> {
  const before = await tapeLength();
  await action();
  await expect.poll(tapeLength).toBe(before + logged.length);
  const added = (await serverDoc(agent.url, 'isle')).tape.slice(before);
  logged.forEach((want, i) => (typeof want === 'string' ? expect(added[i]!.cmd).toBe(want) : expect(added[i]!.cmd).toMatch(want)));
  expect(added.every((e) => e.by === 'human:chris')).toBe(true);
  await matches(page);
}

async function open(page: Page): Promise<(x: number, y: number) => Promise<[number, number]>> {
  for (const [asset, commands] of SETUP) {
    const r = await agent.call('run', { asset, commands });
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
  }
  await page.goto(`${agent.url}&name=chris`);
  await expect(page.getByTestId('status')).toContainText('live');
  await page.locator('.assets li', { hasText: 'isle' }).click();
  await expect(page.getByTestId('map-editor')).toBeVisible();
  await matches(page);
  // Banners above the map move it: the cell's place is read each time.
  return async (x, y) => {
    const box = (await page.getByTestId('map-edit-canvas').boundingBox())!;
    return [box.x + (x + 0.5) * T, box.y + (y + 0.5) * T];
  };
}

test('every map control logs a command that replays to the map on the canvas', async ({ page }) => {
  const at = await open(page);
  const tool = (id: string) => page.locator(`[data-tool="${id}"]`).click();
  const drag = async (cells: [number, number][], shift = false) => {
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.move(...await at(...cells[0]!));
    await page.mouse.down();
    for (const c of cells.slice(1)) await page.mouse.move(...await at(...c), { steps: 2 });
    await page.mouse.up();
    if (shift) await page.keyboard.up('Shift');
  };
  await act(page, async () => { await tool('brush'); await drag([[1, 1], [2, 1], [3, 1]]); }, ['terrain sea brush 1,1 2,1 3,1 size=1']);
  await act(page, async () => { await tool('erase'); await drag([[5, 4], [5, 5]]); }, ['terrain sea brush 5,4 5,5 size=1 erase']);
  await act(page, async () => { await tool('rect'); await drag([[9, 6], [10, 7]]); }, ['terrain sea rect 9,6 2x2']);
  await act(page, async () => { await tool('rect'); await drag([[9, 7], [10, 7]], true); }, ['terrain sea rect 9,7 2x1 erase']);
  await act(page, async () => {
    await tool('place');
    await page.getByTestId('map-asset').selectOption('hut');
    await page.mouse.click(...await at(3, 4));
  }, ['place hut 3,4 layer=props cells=2x1 anchor=0,0']);
  await act(page, async () => { await page.getByTestId('map-asset').selectOption('bush'); await page.mouse.click(...await at(7, 3)); }, ['place bush 7,3 layer=props cells=1x1 anchor=0,0']);
  // A footprint may not overlap: placing on the hut is refused, nothing is logged.
  const n = await tapeLength();
  await page.mouse.click(...await at(4, 4));
  await expect(page.getByTestId('error')).toContainText('is taken by hut at 3,4');
  expect(await tapeLength()).toBe(n);
  await act(page, async () => { await tool('move'); await drag([[4, 4], [6, 5]]); }, ['move 3,4 5,5 layer=props']);
  await act(page, async () => { await tool('remove'); await page.mouse.click(...await at(7, 3)); }, ['remove 7,3 layer=props']);
  // Looking logs nothing: the camera, its view, the zoom and the hot spots.
  const before = await tapeLength();
  await tool('camera');
  await page.mouse.click(...await at(6, 4));
  await expect(page.getByTestId('map-status')).toContainText('camera at 6,4');
  await page.getByTestId('map-camera-view').check();
  await page.getByTestId('map-zoom-2').click();
  await page.getByTestId('map-marks').check();
  await expect(page.getByTestId('map-status')).toContainText('repetition');
  await page.getByTestId('map-camera-view').uncheck();
  await page.getByTestId('map-marks').uncheck();
  await page.getByTestId('map-zoom-1').click();
  expect(await tapeLength()).toBe(before);
});

test('G13: the fill tool lays a tile on every empty cell of a tiles layer; walkable marks a terrain\'s ground', async ({ page }) => {
  const at = await open(page);
  await page.locator('[data-tool="fill"]').click();
  await expect(page.getByTestId('map-fill-layer')).toHaveValue('floor');
  await expect(page.getByTestId('map-fill-tile')).toHaveValue('turf');
  // A drag fills a box; a click the rest of the layer.
  await act(page, async () => {
    await page.mouse.move(...await at(0, 0)); await page.mouse.down(); await page.mouse.move(...await at(1, 1), { steps: 2 }); await page.mouse.up();
  }, ['tiles floor fill turf 0,0 2x2 cells=1x1 anchor=0,0']);
  await act(page, async () => { await page.mouse.click(...await at(6, 4)); }, ['tiles floor fill turf 0,0 12x9 cells=1x1 anchor=0,0']);
  await page.locator('[data-tool="brush"]').click();
  await act(page, () => page.getByTestId('map-walkable').check(), ['layer set sea walkable=on']);
  await page.mouse.move(...await at(0, 0));
  await expect(page.getByTestId('map-status')).toContainText('(walkable)');
  await act(page, () => page.getByTestId('map-walkable').uncheck(), ['layer set sea walkable=off']);
});

test('G14: the fill tool lays a mix of tiles by weight (tiles <layer> fill mix=)', async ({ page }) => {
  const at = await open(page);
  await page.locator('[data-tool="fill"]').click();
  await page.getByTestId('map-fill-tile').selectOption('(mix)');
  // The chosen tile and its texture variants start at one each.
  await expect(page.getByTestId('map-mix-turf')).toHaveValue('1');
  await expect(page.getByTestId('map-mix-turf_b')).toHaveValue('1');
  await page.getByTestId('map-mix-turf_b').fill('2');
  await act(page, async () => {
    await page.mouse.move(...await at(0, 0)); await page.mouse.down(); await page.mouse.move(...await at(3, 2), { steps: 2 }); await page.mouse.up();
  }, [/^tiles floor fill mix=turf:1,turf_b:2 0,0 4x3 cells=1x1 anchor=0,0 variants=named seed=\d+$/]);
  await act(page, async () => { await page.mouse.click(...await at(8, 6)); }, [/^tiles floor fill mix=turf:1,turf_b:2 0,0 12x9 cells=1x1 anchor=0,0 variants=named seed=\d+$/]);
  // Back to one tile.
  await page.getByTestId('map-fill-tile').selectOption('turf');
  await expect(page.getByTestId('map-fill-mix')).toHaveCount(0);
});
