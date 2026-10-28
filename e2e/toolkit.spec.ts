// Plan §10 G4 in the browser: every new UI control (selection tools, transforms, symmetry, brush,
// gradient, dither, outline, clean, stamps, layers, frames, palette lock) logs a command that core
// replays to the pixels on the canvas; the page sends your layer, frame, symmetry and brush with
// your next edit only when they change; wrap ghosts let you draw across a tile's edges; the
// agent's selection does not clip a person's strokes.

import { expect, test, type Page } from '@playwright/test';
import { canvasPixels, mismatches, serverDoc, startAgent, type Agent } from './helpers.ts';

let agent: Agent;
test.beforeEach(async () => { agent = await startAgent(); });
test.afterEach(async () => { await agent.close(); });

type Pt = [number, number];

async function screen(page: Page, [x, y]: Pt): Promise<Pt> {
  const box = (await page.getByTestId('art').boundingBox())!;
  const z = Number(await page.getByTestId('canvas').getAttribute('data-zoom'));
  return [box.x + (x + 0.5) * z, box.y + (y + 0.5) * z];
}

async function drag(page: Page, pts: Pt[], mod?: 'Shift' | 'Alt'): Promise<void> {
  await page.mouse.move(...(await screen(page, pts[0]!)));
  if (mod) await page.keyboard.down(mod);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(...(await screen(page, p)), { steps: 2 });
  await page.mouse.up();
  if (mod) await page.keyboard.up(mod);
}

const tapeLength = async (asset: string) => (await serverDoc(agent.url, asset)).tape.length;

async function canvasMatches(page: Page, asset: string): Promise<void> {
  const { doc, tape } = await serverDoc(agent.url, asset);
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-seq', String(tape.at(-1)!.seq));
  expect(mismatches(doc, await canvasPixels(page))).toEqual([]);
}

/** One UI action: the lines it logged (one group, by the person), then canvas == core's replay. */
async function act(page: Page, asset: string, action: () => Promise<void>, logged: (string | RegExp)[]): Promise<void> {
  const before = await tapeLength(asset);
  await action();
  await expect.poll(() => tapeLength(asset)).toBe(before + logged.length);
  const { tape } = await serverDoc(agent.url, asset);
  const added = tape.slice(before);
  logged.forEach((want, i) => {
    if (typeof want === 'string') expect(added[i]!.cmd).toBe(want);
    else expect(added[i]!.cmd).toMatch(want);
  });
  expect(new Set(added.map((e) => e.group)).size).toBe(1);
  expect(added.every((e) => e.by === 'human:chris')).toBe(true);
  await canvasMatches(page, asset);
}

async function open(page: Page): Promise<void> {
  await page.goto(`${agent.url}&name=chris`);
  await expect(page.getByTestId('status')).toContainText('live');
}

test('every new control logs a command that replays to the pixels on the canvas', async ({ page }) => {
  await agent.call('run', { asset: 'kit', commands: 'new sprite kit 16x16 bg=stone1\nrect 2,2 12x12 c=stone3 fill\nline 2,8 13,8 c=moss2' });
  await open(page);
  await canvasMatches(page, 'kit');
  const key = (k: string) => page.keyboard.press(k);
  const tid = (id: string) => page.getByTestId(id);

  // Selection tools: ellipse (Shift+M), then a fill inside it is clipped.
  await key('Shift+M');
  await act(page, 'kit', () => drag(page, [[3, 3], [9, 7]]), ['select ellipse 3,3 7x5']);
  await key('g');
  await page.locator('[data-colour=moss3]').click();
  await act(page, 'kit', () => drag(page, [[5, 5]]), ['fill 5,5 c=moss3 mode=contiguous conn=4']);
  // Lasso (Q) with Shift adds to the selection; Alt subtracts.
  await key('q');
  await act(page, 'kit', () => drag(page, [[10, 10], [14, 10], [14, 14], [10, 14]], 'Shift'), [/^select lasso 10,10 .*10,14 add$/]);
  await key('w');
  await act(page, 'kit', () => drag(page, [[8, 8]], 'Alt'), ['select wand 8,8 mode=contiguous conn=4 sub']);
  // The magic wand (W), whole colour.
  await tid('wand-global').check();
  await act(page, 'kit', () => drag(page, [[0, 0]]), ['select wand 0,0 mode=global conn=4']);
  await act(page, 'kit', () => key('Escape'), ['deselect']);

  // Transforms on a selection: flip (button and Shift+V), rotate.
  await key('m');
  await act(page, 'kit', () => drag(page, [[2, 6], [7, 10]]), ['select rect 2,6 6x5']);
  await act(page, 'kit', () => tid('flip-h').click(), ['flip h']);
  await act(page, 'kit', () => key('Shift+V'), ['flip v']);
  await act(page, 'kit', () => tid('rotate').click(), ['rotate 90']);
  await act(page, 'kit', () => tid('deselect').click(), ['deselect']);

  // Symmetry: the first stroke after turning it on carries the mirror line; the next does not.
  await key('b');
  await page.locator('[data-colour=ink]').click();
  await tid('mirror-x').click();
  await act(page, 'kit', () => drag(page, [[1, 1], [3, 3]]), ['mirror x=7.5 live', /^stroke pencil c=ink pp=on 1,1 .*3,3$/]);
  await act(page, 'kit', () => drag(page, [[1, 14]]), ['stroke pencil c=ink pp=on 1,14']);
  // A bigger brush.
  await tid('mirror-x').click();
  await tid('brush-size').fill('2');
  await act(page, 'kit', () => drag(page, [[5, 13], [7, 13]]), ['mirror off', 'brush square 2', /^stroke pencil c=ink pp=on 5,13 .*7,13$/]);
  await tid('brush-size').fill('1');
  await tid('brush-size').press('Enter');

  // Gradient (Shift+G) from colour A to colour B (right-click), along their ramp, in the selection.
  await key('m');
  await act(page, 'kit', () => drag(page, [[0, 0], [15, 3]]), ['brush off', 'select rect 0,0 16x4']);
  await page.locator('[data-colour=stone0]').click();
  await page.locator('[data-colour=stone5]').click({ button: 'right' });
  await key('Shift+G');
  await tid('gradient-pattern').selectOption('checker');
  await act(page, 'kit', () => drag(page, [[2, 0], [2, 3]]), ['gradient 0,0 16x4 ramp=stone dir=down steps=6 pattern=checker']);
  await act(page, 'kit', () => key('Escape'), ['deselect']);
  // Dither (D): colour B dithered with colour A.
  await key('d');
  await tid('dither-level').selectOption('0.25');
  await act(page, 'kit', () => drag(page, [[0, 12], [3, 15]]), ['dither 0,12 4x4 a=stone5 b=stone0 pattern=bayer4 level=0.25']);
  // Outline and clean act on the whole layer.
  await page.locator('[data-colour=lichen]').click();
  await act(page, 'kit', () => tid('outline').click(), ['outline c=lichen mode=outer corners=off']);
  await act(page, 'kit', () => tid('clean').click(), ['clean orphans size=1 keep=none']);

  // Stamps: save the selection as one, then place it with the stamp tool (S).
  await key('m');
  await act(page, 'kit', () => drag(page, [[2, 6], [4, 8]]), ['select rect 2,6 3x3']);
  await tid('stamp-save').click();
  await act(page, 'kit', () => tid('stamp-save-ok').click(), ['stamp save stamp1 2,6 3x3']);
  await act(page, 'kit', () => key('Escape'), ['deselect']);
  await expect(page.locator('[data-stamp=stamp1]')).toBeVisible();
  await page.locator('[data-stamp=stamp1]').click();
  await act(page, 'kit', () => drag(page, [[12, 12]]), ['stamp stamp1 11,11 flip=none']);

  // Layers: add one, draw on it (the page sends `layer` first), toggle its flags, move, merge.
  await act(page, 'kit', () => tid('layer-add').click(), ['layer add layer2 above=main']);
  await key('b');
  await page.locator('[data-colour=pool]').click();
  await act(page, 'kit', () => drag(page, [[0, 15], [15, 15]]), ['layer layer2', /^stroke pencil c=pool pp=on 0,15 .*15,15$/]);
  const flag = (f: string) => page.locator(`tr[data-layer=layer2] [data-flag=${f}]`);
  await act(page, 'kit', () => flag('hidden').click(), ['layer set layer2 hidden=on']);
  await act(page, 'kit', () => flag('hidden').click(), ['layer set layer2 hidden=off']);
  await act(page, 'kit', () => flag('reference').click(), ['layer set layer2 reference=on']);
  await act(page, 'kit', () => flag('reference').click(), ['layer set layer2 reference=off']);
  await act(page, 'kit', () => flag('locked').click(), ['layer set layer2 locked=on']);
  // Drawing on a locked layer is refused and nothing is logged.
  const n = await tapeLength('kit');
  await drag(page, [[4, 4]]);
  await expect(tid('error')).toContainText("layer 'layer2' is locked");
  expect(await tapeLength('kit')).toBe(n);
  await act(page, 'kit', () => flag('locked').click(), ['layer set layer2 locked=off']);
  await act(page, 'kit', () => tid('layer-down').click(), ['layer move layer2 below=main']);
  await act(page, 'kit', () => tid('layer-up').click(), ['layer move layer2 above=main']);
  await act(page, 'kit', () => tid('layer-merge').click(), ['layer merge layer2']);

  // Frames: add one (a copy), draw on it, step back with [, remove it.
  await act(page, 'kit', () => tid('frame-add').click(), ['frame add 2 copy=1']);
  await expect(tid('frame-now')).toHaveText('2 / 2');
  await act(page, 'kit', () => drag(page, [[8, 0]]), ['frame 2', 'stroke pencil c=pool pp=on 8,0']);
  await expect(tid('canvas')).toHaveAttribute('data-frame', '1');
  await key('[');
  await expect(tid('canvas')).toHaveAttribute('data-frame', '0');
  await canvasMatches(page, 'kit');
  await key(']');
  await act(page, 'kit', () => tid('frame-remove').click(), ['frame remove 2']);

  // Palette lock: the button locks it, and adding colours is gone until it is unlocked.
  await act(page, 'kit', () => tid('palette-lock').click(), ['palette lock']);
  await expect(tid('palette-add')).toHaveCount(0);
  await act(page, 'kit', () => tid('palette-lock').click(), ['palette unlock']);

  // The whole tape replays (serverDoc replays it with core) and the canvas equals it.
  await canvasMatches(page, 'kit');
});

test('wrap ghosts: draw across a tile\'s edges from the neighbouring copies', async ({ page }) => {
  await agent.call('run', { asset: 'turf', commands: 'new tile turf 12x12 bg=moss1' });
  await open(page);
  await expect(page.getByTestId('ghosts')).toBeVisible();
  await page.locator('[data-colour=lichen]').click();
  // From the ghost on the left (x = -3) into the tile: the stroke's points run past the edge and wrap.
  await act(page, 'turf', () => drag(page, [[-3, 4], [2, 4]]), [/^stroke pencil c=lichen pp=on -3,4 .*2,4$/]);
  const { doc } = await serverDoc(agent.url, 'turf');
  const row = [...Array(12).keys()].map((x) => doc.cels[0]![0]![4 * 12 + x]);
  expect(row.filter((v) => v === 11).length).toBe(6);
  await page.getByTestId('ghosts-toggle').uncheck();
  await expect(page.getByTestId('ghosts')).toHaveCount(0);
});

test("the agent's selection does not clip a person's strokes", async ({ page }) => {
  await agent.call('run', { asset: 'slab', commands: 'new sprite slab 12x12 bg=stone1\nselect rect 0,0 3x3' });
  await open(page);
  await page.locator('[data-colour=ink]').click();
  await act(page, 'slab', () => drag(page, [[0, 6], [11, 6]]), [/^stroke pencil c=ink pp=on 0,6 .*11,6$/]);
  const { doc } = await serverDoc(agent.url, 'slab');
  expect([...Array(12).keys()].every((x) => doc.cels[0]![0]![6 * 12 + x] === 0)).toBe(true);
  // The agent's own drawing is still clipped by its selection.
  await agent.call('run', { asset: 'slab', commands: 'rect 0,0 12x12 c=pool fill' });
  const after = (await serverDoc(agent.url, 'slab')).doc;
  expect(after.cels[0]![0]!.filter((v) => v === 15).length).toBe(9);
  await canvasMatches(page, 'slab');
});
