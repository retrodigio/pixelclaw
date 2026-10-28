// Screenshots of the watch view for the docs (docs/screenshots/g2-*.png and g3-*.png). Starts a
// server on a temporary project, drives it over MCP like an agent and with the mouse like a
// person, and photographs the page at a few moments. Nothing is left running.
//   node scripts/screenshots.ts

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
  // --- G2: watching the agent draw.
  const page = await browser.newPage({ viewport: { width: 1400, height: 860 }, deviceScaleFactor: 1 });
  await page.goto(`${agent.url}&name=chris`);
  await page.getByTestId('status').getByText('live').waitFor();
  await page.screenshot({ path: out('g2-empty') });
  for (const s of sections.slice(0, 3)) await agent.call('run', { asset: 'stone_floor', commands: s });
  await agent.call('view', { asset: 'stone_floor', mode: 'render' });
  await page.locator('[data-testid=canvas]').waitFor();
  // Mid-playback: some lines played, the rest dimmed.
  await page.waitForFunction(() => Number(document.querySelector('[data-testid=canvas]')?.getAttribute('data-seq')) >= 16);
  await page.screenshot({ path: out('g2-playback') });
  for (const s of sections.slice(3)) await agent.call('run', { asset: 'stone_floor', commands: s });
  await page.getByTestId('speed').selectOption('Infinity');
  await agent.call('view', { asset: 'stone_floor', mode: 'tile3x3' });
  await settled(page);
  await page.screenshot({ path: out('g2-live') });
  await (await tapeRow(page, 20)).click();
  await page.screenshot({ path: out('g2-travel') });
  await page.getByRole('button', { name: 'Back to live' }).click();
  await page.locator('[data-testid=eye] img').click();
  await page.screenshot({ path: out('g2-eye') });
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
  await page.screenshot({ path: out('g2-sheet') });

  // --- G3: the person edits; the agent reads the edits.
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
  await page.screenshot({ path: out('g3-note-writing') });
  await page.getByRole('button', { name: 'Pin note' }).click();
  await page.locator('.note-label').waitFor();
  await page.mouse.move(5, 5);
  await page.screenshot({ path: out('g3-note') });
  // The agent reads the changes: the diff becomes Claude's eye.
  await agent.call('changes', {});
  await page.getByTestId('eye').getByText('stone_floor · diff').waitFor();
  await page.screenshot({ path: out('g3-changes') });
  copyFileSync(join(agent.dir, 'views', 'stone_floor.diff.png'), out('g3-diff'));
  // …and carries on from them.
  await agent.call('run', { asset: 'stone_floor', commands: 'rect 9,8 3x1 c=moss0 fill\nnote done n1', view: 'render' });
  await settled(page);
  await page.screenshot({ path: out('g3-continued') });

  // Drawing tools on a sprite: a pencil stroke in progress (the preview is the exact batch).
  await agent.call('run', { asset: 'idol', commands: 'new sprite idol 16x16 bg=none\nellipse 4,1 8x7 c=stone3 fill\nrect 3,8 10x7 c=stone2 fill\nline 3,8 12,8 c=stone4' });
  await page.locator('.assets li', { hasText: 'idol' }).click();
  await settled(page);
  await page.locator('[data-colour=ink]').click();
  await page.keyboard.press('b');
  await drag(page, [[5, 4], [6, 4], [6, 5], [7, 5], [8, 5], [9, 5], [9, 4], [10, 4]], false);
  await page.screenshot({ path: out('g3-pencil') });
  await page.mouse.up();
  // A rectangle selection moved: one group of three lines on the tape.
  await page.keyboard.press('m');
  await drag(page, [[3, 10], [12, 13]]);
  await drag(page, [[6, 11], [6, 12]]);
  await page.waitForTimeout(200);
  await page.mouse.move(5, 5);
  await page.screenshot({ path: out('g3-select-move') });
  // Palette editing: change a colour (a palette command on the tape).
  await page.keyboard.press('Escape');
  await page.locator('[data-colour=lichen]').dblclick();
  await page.getByLabel('hex').fill('#c8d86a');
  await page.screenshot({ path: out('g3-palette') });
  await page.getByTestId('palette-save').click();
  // Time travel, with "branch here".
  await (await tapeRow(page, 3)).click();
  await page.getByTestId('branch').click();
  await page.screenshot({ path: out('g3-branch') });
  await page.getByTestId('branch-create').click();
  await page.getByTestId('canvas').and(page.locator('[data-asset=idol_b]')).waitFor();
  await page.locator('[data-colour=moss2]').click();
  await page.keyboard.press('g');
  await drag(page, [[7, 3]]);
  await page.waitForTimeout(300);
  await page.mouse.move(5, 5);
  await page.screenshot({ path: out('g3-branched') });

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
  await other.screenshot({ path: out('g3-two-people') });
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
  await page.screenshot({ path: out('g3-long-tape') });
  console.log('wrote docs/screenshots/g2-*.png and g3-*.png');
} finally {
  await browser.close();
  await agent.close();
}
