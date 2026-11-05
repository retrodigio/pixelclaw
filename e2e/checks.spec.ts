// Checks in the browser: the check chips (computed in the page with core and the project's
// style guide) circle the flagged pixels on the canvas and open their details; a flagged group can
// be pinned as a note; role colours and preview themes; the preview panel. Every new control that
// changes the document logs a command that core replays to the pixels on the canvas; the chips,
// the theme and the preview tabs log nothing.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { BUILTIN_THEMES, type Pt } from '../core/src/index.ts';
import { canvasPixels, mismatches, serverDoc, startAgent, type Agent } from './helpers.ts';

let agent: Agent;
test.beforeEach(async () => { agent = await startAgent(); });
test.afterEach(async () => { await agent.close(); });

const tapeLength = async (asset: string) => (await serverDoc(agent.url, asset)).tape.length;

async function open(page: Page): Promise<void> {
  await page.goto(`${agent.url}&name=chris`);
  await expect(page.getByTestId('status')).toContainText('live');
}

/** Magenta pixels of the canvas overlay near a document pixel's ring (the ring sits just outside it). */
async function ringAt(page: Page, [x, y]: Pt): Promise<boolean> {
  return page.evaluate(([px, py]) => {
    const c = document.querySelector<HTMLCanvasElement>('canvas.overlay')!;
    const z = Number(document.querySelector<HTMLCanvasElement>('[data-testid=canvas]')!.dataset.zoom);
    const g = c.getContext('2d')!;
    const r = Math.round(z * 0.5 + Math.max(2, z * 0.22));
    const cx = Math.round((px + 0.5) * z);
    const cy = Math.round((py + 0.5) * z);
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * Math.PI * 2;
      const d = g.getImageData(cx + Math.round(Math.cos(t) * r), cy + Math.round(Math.sin(t) * r), 1, 1).data;
      if (d[0]! > 200 && d[1]! < 60 && d[2]! > 150) return true;
    }
    return false;
  }, [x, y] as Pt);
}

test('check chips: marks on the canvas, details, pin a note; the summary agrees with the agent\'s check', async ({ page }) => {
  await agent.call('run', { asset: 'turf', commands: 'new tile turf 8x8 bg=moss2' });
  await agent.call('run', { asset: 'box', commands: 'new sprite box 12x12\nrect 2,2 8x8 c=stone3 fill\nrect 2,2 8x8 c=ink\npx 5,5 c=lichen' });
  await open(page);
  const chip = (id: string) => page.locator(`[data-check=${id}]`).first();
  await expect(chip('orphans')).toHaveAttribute('data-status', 'fail');
  await expect(chip('outline')).toHaveAttribute('data-status', 'pass');
  // The same verdicts as the agent's check tool.
  const t = (await agent.call('check', { asset: 'box' })).content.map((c) => c.text ?? '').join('\n');
  for (const id of ['palette', 'orphans', 'jaggies', 'banding', 'outline', 'coverage', 'readability']) {
    const status = await chip(id).getAttribute('data-status');
    expect(t).toMatch(new RegExp(`${status === 'pass' ? '✓' : '✗'} {2}${id}\\b`));
  }
  const before = await tapeLength('box');
  await chip('orphans').click();
  await expect(page.getByTestId('check-details')).toContainText('lone pixel (no neighbour shares its colour): 5,5');
  await expect.poll(() => ringAt(page, [5, 5])).toBe(true);
  expect(await ringAt(page, [3, 3])).toBe(false);
  expect(await tapeLength('box')).toBe(before); // looking writes nothing
  // Pin the flagged pixel as a note for the agent: a note command, replayed.
  await page.getByTestId('check-pin').click();
  await expect.poll(() => tapeLength('box')).toBe(before + 1);
  const { tape, doc } = await serverDoc(agent.url, 'box');
  expect(tape.at(-1)).toMatchObject({ by: 'human:chris', cmd: 'note 5,5 "orphans: lone pixel (no neighbour shares its colour) (5,5)" id=n1' });
  expect(doc.notes).toHaveLength(1);
  // The person fixes it: the chip goes green and the ring goes.
  await page.locator('[data-colour=stone3]').click();
  await page.keyboard.press('b');
  const box = (await page.getByTestId('art').boundingBox())!;
  const z = Number(await page.getByTestId('canvas').getAttribute('data-zoom'));
  await page.mouse.click(box.x + 5.5 * z, box.y + 5.5 * z);
  await expect(chip('orphans')).toHaveAttribute('data-status', 'pass');
  await expect.poll(() => ringAt(page, [5, 5])).toBe(false);
  expect(mismatches((await serverDoc(agent.url, 'box')).doc, await canvasPixels(page))).toEqual([]);
  await page.getByTestId('check-close').click();
  await expect(page.getByTestId('check-details')).toHaveCount(0);
});

test('the style guide: the page uses project.json, and hears when it changes', async ({ page }) => {
  await agent.call('run', { asset: 'box', commands: 'new sprite box 12x12\nrect 2,2 8x8 c=stone3 fill\nrect 2,2 8x8 c=ink\npx 5,2 6,2 7,2 c=stone3' });
  await open(page);
  const chip = page.locator('[data-check=outline]');
  await expect(chip).toHaveAttribute('data-status', 'pass'); // 25/28 = 0.89 ≥ 0.85
  const pj = join(agent.dir, 'project.json');
  writeFileSync(pj, JSON.stringify({ ...JSON.parse(readFileSync(pj, 'utf8')), style: { checks: { outline: { min: 0.9 } } } }));
  await agent.call('run', { asset: 'box', commands: 'px 0,0 c=none' }); // the next batch notices the change
  await expect(chip).toHaveAttribute('data-status', 'fail');
});

test('roles and themes: the role control logs palette commands; the theme only changes what you see', async ({ page }) => {
  await agent.call('run', { asset: 'fig', commands: 'new sprite fig 8x8\npalette add skin hex=#c0b090\nrect 2,1 4x6 c=skin fill\nrect 2,4 4x3 c=stone2 fill\noutline c=ink' });
  await open(page);
  const before = await tapeLength('fig');
  // Double-click a swatch, give it a role.
  await page.locator('[data-colour=skin]').dblclick();
  await page.getByTestId('palette-role').selectOption('light');
  await page.getByTestId('palette-save').click();
  await expect.poll(() => tapeLength('fig')).toBe(before + 1);
  let { tape, doc } = await serverDoc(agent.url, 'fig');
  expect(tape.at(-1)).toMatchObject({ by: 'human:chris', cmd: 'palette set skin role=light' });
  expect(mismatches(doc, await canvasPixels(page))).toEqual([]);
  // Add a role colour, then draw with it.
  await page.getByTestId('palette-add').click();
  await page.getByLabel('name').fill('cloak');
  await page.getByTestId('palette-role').selectOption('dark');
  await page.getByTestId('palette-save').click();
  await expect.poll(() => tapeLength('fig')).toBe(before + 2);
  ({ tape } = await serverDoc(agent.url, 'fig'));
  expect(tape.at(-1)!.cmd).toMatch(/^palette add cloak hex=#808080 key=\S role=dark$/);
  await agent.call('run', { asset: 'fig', commands: 'rect 2,4 4x3 c=cloak fill' });
  // A theme: the canvas shows role entries in its colours; nothing is written.
  const n = await tapeLength('fig');
  await page.getByTestId('theme').selectOption('ember');
  ({ doc } = await serverDoc(agent.url, 'fig'));
  await expect.poll(async () => mismatches(doc, await canvasPixels(page), BUILTIN_THEMES.find((t) => t.name === 'ember')).length).toBe(0);
  expect(mismatches(doc, await canvasPixels(page)).length).toBeGreaterThan(0);
  expect(await tapeLength('fig')).toBe(n);
  // The preview panel: the game view, and the art under the themes.
  await expect(page.getByTestId('preview-game')).toBeVisible();
  await page.locator('.preview [data-tab=themes]').click();
  await expect(page.getByTestId('preview-themes')).toBeVisible();
  expect(await tapeLength('fig')).toBe(n);
});
