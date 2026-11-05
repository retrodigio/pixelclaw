// Screenshots of the watch view for the docs (docs/screenshots/watch-*, edit-* and toolkit-*.png). Starts a
// server on a temporary project, drives it over MCP like an agent and with the mouse like a
// person, and photographs the page at a few moments. Nothing is left running.
//   node scripts/screenshots-editor.ts

import { copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { REPO, startAgent, tapeRow } from '../e2e/helpers.ts';

const out = (n: string) => join(REPO, 'docs', 'screenshots', `${n}.png`);
const script = readFileSync(join(REPO, 'examples', 'scripts', 'stone_floor.pclaw'), 'utf8');
const sections = script.split(/\n(?=# --- )/).map((s) => s.trim());
const settled = (page: Page) => page.waitForFunction(() => document.querySelector('[data-testid=waiting]')?.textContent === '');

type Pt = [number, number];
async function at(page: Page, [x, y]: Pt): Promise<Pt> {
  const box = (await page.getByTestId('art').boundingBox())!;
  const z = Number(await page.getByTestId('canvas').getAttribute('data-zoom'));
  return [box.x + (x + 0.5) * z, box.y + (y + 0.5) * z];
}
async function drag(page: Page, pts: Pt[], release = true): Promise<void> {
  await page.mouse.move(...(await at(page, pts[0]!)));
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(...(await at(page, p)), { steps: 3 });
  if (release) await page.mouse.up();
}

const agent = await startAgent();
const browser = await chromium.launch();
try {
  // --- Watching the agent draw.
  const page = await browser.newPage({ viewport: { width: 1400, height: 860 }, deviceScaleFactor: 1 });
  await page.goto(`${agent.url}&name=chris`);
  await page.getByTestId('status').getByText('live').waitFor();
  await page.screenshot({ path: out('watch-empty') });
  for (const s of sections.slice(0, 3)) await agent.call('run', { asset: 'stone_floor', commands: s });
  await agent.call('view', { asset: 'stone_floor', mode: 'render' });
  await page.locator('[data-testid=canvas]').waitFor();
  // Mid-playback: some lines played, the rest dimmed.
  await page.waitForFunction(() => Number(document.querySelector('[data-testid=canvas]')?.getAttribute('data-seq')) >= 16);
  await page.screenshot({ path: out('watch-playback') });
  for (const s of sections.slice(3)) await agent.call('run', { asset: 'stone_floor', commands: s });
  await page.getByTestId('speed').selectOption('Infinity');
  await agent.call('view', { asset: 'stone_floor', mode: 'tile3x3' });
  await settled(page);
  await page.screenshot({ path: out('watch-live') });
  await (await tapeRow(page, 20)).click();
  await page.screenshot({ path: out('watch-travel') });
  await page.getByRole('button', { name: 'Back to live' }).click();
  await page.locator('[data-testid=eye] img').click();
  await page.screenshot({ path: out('watch-eye') });
  await page.locator('.modal').click();
  await agent.call('run', {
    asset: 'runes', commands: `new sheet runes 48x16 cell=16x16 bg=none
rect 2,2 12x12 c=stone2 fill ; rect 18,2 12x12 c=stone2 fill ; rect 34,2 12x12 c=stone2 fill
line 8,4 8,11 c=moss3 ; line 5,7 11,7 c=moss3
ellipse 24,8 r=3x3 c=lichen ; px 24,8 c=lichen
line 37,4 43,11 c=pool ; line 43,4 37,11 c=pool`,
  });
  await page.waitForFunction(() => document.querySelector('[data-testid=canvas]')?.getAttribute('data-asset') === 'runes');
  await settled(page);
  await page.screenshot({ path: out('watch-sheet') });

  // --- The person edits; the agent reads the edits.
  await page.locator('.assets li', { hasText: 'stone_floor' }).click();
  await agent.call('changes', {});
  // Three pixels of moss along a joint, with the pencil.
  await page.locator('[data-colour=moss1]').click();
  await page.keyboard.press('b');
  for (const x of [12, 13, 14]) {
    await drag(page, [[x, 8]]);
    await page.waitForFunction((s) => Number(document.querySelector('[data-testid=canvas]')?.getAttribute('data-seq')) >= s, 72 + x - 12);
  }
  // A note on the region to the left, while it is being written.
  await page.keyboard.press('n');
  await drag(page, [[9, 8], [11, 8]]);
  await page.getByLabel('note text').fill('carry the moss on along this joint, a shade darker (moss0)');
  await page.screenshot({ path: out('edit-note-writing') });
  await page.getByRole('button', { name: 'Pin note' }).click();
  await page.locator('.note-label').waitFor();
  await page.mouse.move(5, 5);
  await page.screenshot({ path: out('edit-note') });
  // The agent reads the changes: the diff becomes Claude's eye.
  await agent.call('changes', {});
  await page.getByTestId('eye').getByText('stone_floor · diff').waitFor();
  await page.screenshot({ path: out('edit-changes') });
  copyFileSync(join(agent.dir, 'views', 'stone_floor.diff.png'), out('edit-diff'));
  // …and carries on from them.
  await agent.call('run', { asset: 'stone_floor', commands: 'rect 9,8 3x1 c=moss0 fill\nnote done n1', view: 'render' });
  await settled(page);
  await page.screenshot({ path: out('edit-continued') });

  // Drawing tools on a sprite: a pencil stroke in progress (the preview is the exact batch).
  await agent.call('run', { asset: 'idol', commands: 'new sprite idol 16x16 bg=none\nellipse 4,1 8x7 c=stone3 fill\nrect 3,8 10x7 c=stone2 fill\nline 3,8 12,8 c=stone4' });
  await page.locator('.assets li', { hasText: 'idol' }).click();
  await settled(page);
  await page.locator('[data-colour=ink]').click();
  await page.keyboard.press('b');
  await drag(page, [[5, 4], [6, 4], [6, 5], [7, 5], [8, 5], [9, 5], [9, 4], [10, 4]], false);
  await page.screenshot({ path: out('edit-pencil') });
  await page.mouse.up();
  // A rectangle selection (a select line), moved (a shift line).
  await page.keyboard.press('m');
  await drag(page, [[3, 10], [12, 13]]);
  await page.waitForTimeout(200);
  await drag(page, [[6, 11], [6, 12]]);
  await page.waitForTimeout(200);
  await page.mouse.move(5, 5);
  await page.screenshot({ path: out('edit-select-move') });
  // Palette editing: change a colour (a palette command on the tape).
  await page.keyboard.press('Escape');
  await page.locator('[data-colour=lichen]').dblclick();
  await page.getByLabel('hex').fill('#c8d86a');
  await page.screenshot({ path: out('edit-palette') });
  await page.getByTestId('palette-save').click();
  // Time travel, with "branch here".
  await (await tapeRow(page, 3)).click();
  await page.getByTestId('branch').click();
  await page.screenshot({ path: out('edit-branch') });
  await page.getByTestId('branch-create').click();
  await page.getByTestId('canvas').and(page.locator('[data-asset=idol_b]')).waitFor();
  await page.locator('[data-colour=moss2]').click();
  await page.keyboard.press('g');
  await drag(page, [[7, 3]]);
  await page.waitForTimeout(300);
  await page.mouse.move(5, 5);
  await page.screenshot({ path: out('edit-branched') });

  // A second person, editing at the same time.
  const other = await browser.newPage({ viewport: { width: 1400, height: 860 }, deviceScaleFactor: 1 });
  await other.goto(`${agent.url}&name=ana`);
  await other.getByTestId('status').getByText('live').waitFor();
  await other.locator('.assets li', { hasText: 'idol_b' }).click();
  await other.locator('[data-colour=pool]').click();
  await drag(other, [[2, 15], [13, 15]]);
  await other.keyboard.press('Control+z');
  await other.keyboard.press('Control+Shift+z');
  await settled(other);
  await other.waitForTimeout(300);
  await other.mouse.move(5, 5);
  await other.screenshot({ path: out('edit-two-people') });
  await other.close();

  // A long tape: 10,000 commands, virtualised.
  await agent.call('run', { asset: 'big', commands: 'new tile big 64x64 bg=stone1' });
  const colours = ['stone0', 'stone2', 'stone3', 'moss1', 'moss2', 'soil1', 'lichen', 'ink'];
  for (let b = 0; b < 10; b++) {
    const lines: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const k = b * 1000 + i;
      lines.push(`px ${(k * 7) % 64},${(k * 13 + b) % 64} c=${colours[k % colours.length]}`);
    }
    await agent.call('run', { asset: 'big', commands: lines.join('\n') });
  }
  await page.locator('.assets li', { hasText: 'big' }).click();
  await settled(page);
  await (await tapeRow(page, 6_000)).click();
  await page.screenshot({ path: out('edit-long-tape') });
  await page.close();

  // --- The drawing toolkit.
  const g4 = await browser.newPage({ viewport: { width: 1400, height: 860 }, deviceScaleFactor: 1 });
  await g4.goto(`${agent.url}&name=chris`);
  await g4.getByTestId('status').getByText('live').waitFor();
  await g4.getByTestId('speed').selectOption('Infinity');
  const g4script = (f: string) => readFileSync(join(REPO, 'examples', 'scripts', f), 'utf8');
  // The grass tile, seamless by construction: wrap ghosts show its neighbours.
  await agent.call('run', { asset: 'grass', commands: g4script('grass.pclaw') });
  await agent.call('view', { asset: 'grass', mode: 'tile3x3' });
  await g4.locator('.assets li', { hasText: /^○grass\d/ }).click();
  await settled(g4);
  await g4.mouse.move(5, 5);
  await g4.screenshot({ path: out('toolkit-grass') });
  // Two variants: forks before the texture, the same macro with other seeds.
  for (const f of ['grass_b.pclaw', 'grass_c.pclaw']) {
    const text = g4script(f);
    await agent.call('run', { asset: /fork grass (\S+)/.exec(text)![1]!, commands: text });
  }
  await agent.call('view', { asset: 'grass_c', mode: 'tile3x3' });
  await g4.locator('.assets li', { hasText: 'grass_c' }).click();
  await settled(g4);
  await g4.locator('[data-testid=eye] img').click();
  await g4.screenshot({ path: out('toolkit-variants') });
  await g4.locator('.modal').click();
  // The chest: everything up to the merge, so the metal layer is still its own, then the rest.
  const chest = g4script('chest.pclaw');
  const cut = chest.indexOf('layer merge metal');
  await agent.call('run', { asset: 'chest', commands: chest.slice(0, cut) });
  await g4.locator('.assets li', { hasText: 'chest' }).click();
  await settled(g4);
  await g4.mouse.move(5, 5);
  await g4.screenshot({ path: out('toolkit-chest-layers') });
  await agent.call('run', { asset: 'chest', commands: chest.slice(cut), view: 'render' });
  await settled(g4);
  await g4.screenshot({ path: out('toolkit-chest') });
  // A person on a sprite of their own: a reference layer to trace over, symmetry while drawing.
  await agent.call('run', { asset: 'mask', commands: `new sprite mask 16x16
layer add sketch below=main reference
layer sketch
ellipse 7,7 r=6x7 c=pool fill
layer main
frame add 2 copy=1
frame add 3 copy=1` });
  await g4.locator('.assets li', { hasText: 'mask' }).click();
  await settled(g4);
  await g4.locator('[data-colour=stone3]').click();
  await g4.keyboard.press('b');
  await g4.getByTestId('mirror-x').click();
  await drag(g4, [[3, 3], [4, 6], [5, 9], [6, 12]]);
  await g4.waitForTimeout(200);
  await g4.locator('[data-colour=ink]').click();
  await drag(g4, [[4, 5], [5, 5], [6, 6]], false);
  await g4.screenshot({ path: out('toolkit-symmetry') });
  await g4.mouse.up();
  await g4.getByTestId('mirror-x').click();
  // Selections: a wand selection plus a lasso being drawn (Shift adds).
  await g4.keyboard.press('w');
  await drag(g4, [[3, 3]]);
  await g4.waitForTimeout(200);
  await g4.keyboard.press('q');
  await g4.keyboard.down('Shift');
  await drag(g4, [[9, 2], [14, 3], [13, 9], [9, 8], [10, 5]], false);
  await g4.screenshot({ path: out('toolkit-lasso') });
  await g4.mouse.up();
  await g4.keyboard.up('Shift');
  await g4.waitForTimeout(200);
  // A gradient through the selection, colour A to colour B along the stone ramp.
  await g4.locator('[data-colour=stone1]').click();
  await g4.locator('[data-colour=stone5]').click({ button: 'right' });
  await g4.keyboard.press('Shift+G');
  await g4.getByTestId('gradient-pattern').selectOption('bayer4');
  await drag(g4, [[8, 2], [8, 13]]);
  await g4.waitForTimeout(300);
  await g4.mouse.move(5, 5);
  await g4.screenshot({ path: out('toolkit-gradient') });
  // Stamps: save the selection as one, and the timeline with frames and layers.
  await g4.getByTestId('stamp-save').click();
  await g4.getByTestId('stamp-save-ok').click();
  await g4.keyboard.press('Escape');
  await g4.locator('[data-cel="main:2"]').click();
  await g4.keyboard.press('s');
  await drag(g4, [[11, 10]]);
  await g4.waitForTimeout(300);
  await g4.mouse.move(5, 5);
  await g4.screenshot({ path: out('toolkit-stamps-frames') });
  console.log('wrote docs/screenshots/watch-*.png, edit-*.png and toolkit-*.png');
} finally {
  await browser.close();
  await agent.close();
}
