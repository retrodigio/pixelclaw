// Plan §10 G3 in the browser: every UI action replays from its logged command to the same pixels
// (Playwright drives each tool, then core replays the server's tape and the canvas must match);
// two browsers stay in sync while both edit; undo and redo by author; "branch here" makes a fork
// that replays; a person's fixes and note come back to the agent through `changes`; a tape of
// 10,000 lines stays responsive.

import { expect, test, type Page } from '@playwright/test';
import { canvasPixels, mismatches, pageTape, serverDoc, startAgent, tapeRow, type Agent } from './helpers.ts';

let agent: Agent;

test.beforeEach(async () => {
  agent = await startAgent();
});

test.afterEach(async () => {
  await agent.close();
});

type Pt = [number, number];

/** Screen position of a document pixel's centre. */
async function screen(page: Page, [x, y]: Pt): Promise<Pt> {
  const box = (await page.getByTestId('art').boundingBox())!;
  const z = Number(await page.getByTestId('canvas').getAttribute('data-zoom'));
  return [box.x + (x + 0.5) * z, box.y + (y + 0.5) * z];
}

/** A pointer drag through document pixels (a click when there is one point). */
async function drag(page: Page, pts: Pt[], o: { alt?: boolean } = {}): Promise<void> {
  const first = await screen(page, pts[0]!);
  await page.mouse.move(...first);
  if (o.alt) await page.keyboard.down('Alt');
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(...(await screen(page, p)), { steps: 2 });
  await page.mouse.up();
  if (o.alt) await page.keyboard.up('Alt');
}

async function tapeLength(asset: string): Promise<number> {
  return (await serverDoc(agent.url, asset)).tape.length;
}

/** The canvas equals core's replay of the server's tape, at the tape's end. */
async function canvasMatches(page: Page, asset: string): Promise<void> {
  const { doc, tape } = await serverDoc(agent.url, asset);
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-seq', String(tape.at(-1)!.seq));
  expect(mismatches(doc, await canvasPixels(page))).toEqual([]);
}

/**
 * Do one UI action, wait for it to reach the tape, check the lines it logged, and check that the
 * page shows exactly what core makes of the tape.
 */
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
  expect(added.every((e) => e.by.startsWith('human:'))).toBe(true);
  await canvasMatches(page, asset);
}

async function open(page: Page, name: string): Promise<void> {
  await page.goto(`${agent.url}&name=${name}`);
  await expect(page.getByTestId('status')).toContainText('live');
  await expect(page.getByTestId('me')).toContainText(`human:${name}`);
}

test('every tool logs a command that replays to the pixels on the canvas', async ({ page }) => {
  await agent.call('run', { asset: 'idol', commands: 'new sprite idol 16x16 bg=stone1\nrect 2,2 12x12 c=stone3 fill' });
  await open(page, 'chris');
  await canvasMatches(page, 'idol');
  const key = (k: string) => page.keyboard.press(k);

  // Pencil (B), pixel-perfect: a staircase drag becomes a diagonal.
  await key('b');
  await page.locator('[data-colour=ink]').click();
  await act(page, 'idol', () => drag(page, [[1, 1], [2, 1], [2, 2], [3, 2], [3, 3]]), [/^stroke pencil c=ink pp=on 1,1 2,1 2,2 3,2 3,3$/]);
  // Eraser (E).
  await key('e');
  await act(page, 'idol', () => drag(page, [[5, 5], [8, 5]]), [/^stroke eraser 5,5( \d+,5)* 8,5$/]);
  // Line (L).
  await key('l');
  await page.locator('[data-colour=moss2]').click();
  await act(page, 'idol', () => drag(page, [[1, 14], [14, 10]]), ['line 1,14 14,10 c=moss2 pp=on']);
  // Rectangle (U), outline then filled (F).
  await key('u');
  await act(page, 'idol', () => drag(page, [[4, 7], [9, 11]]), ['rect 4,7 6x5 c=moss2 outline']);
  await key('f');
  await act(page, 'idol', () => drag(page, [[10, 3], [12, 4]]), ['rect 10,3 3x2 c=moss2 fill']);
  // Ellipse (Shift+U), filled.
  await key('Shift+U');
  await act(page, 'idol', () => drag(page, [[6, 1], [11, 5]]), ['ellipse 6,1 6x5 c=moss2 fill']);
  // Fill (G).
  await key('g');
  await page.locator('[data-colour=soil1]').click();
  await act(page, 'idol', () => drag(page, [[0, 15]]), ['fill 0,15 c=soil1 mode=contiguous conn=4']);
  // Picker (I): click a pixel, then the pencil draws with its colour (the picker logs nothing).
  await key('i');
  await drag(page, [[3, 3]]);
  await expect(page.getByTestId('colour')).toContainText('ink');
  await key('b');
  await act(page, 'idol', () => drag(page, [[13, 13]]), ['stroke pencil c=ink pp=on 13,13']);
  // Alt+click picks too.
  await drag(page, [[0, 15]], { alt: true });
  await expect(page.getByTestId('colour')).toContainText('soil1');
  // Rectangle select (M) is a command of its own (selections are per author); drag inside to move it.
  await key('m');
  await act(page, 'idol', () => drag(page, [[4, 7], [9, 11]]), ['select rect 4,7 6x5']);
  await act(page, 'idol', () => drag(page, [[5, 8], [7, 9]]), ['shift 2,1']);
  // With a selection, drawing is clipped to it.
  await key('b');
  await act(page, 'idol', () => drag(page, [[0, 9], [15, 9]]), [/^stroke pencil c=soil1 pp=on 0,9 .*15,9$/]);
  // Delete clears the selected pixels; Esc deselects.
  await act(page, 'idol', () => key('Delete'), ['clear']);
  await act(page, 'idol', () => key('Escape'), ['deselect']);
  // Move (V) without a selection moves everything; arrow keys nudge.
  await key('v');
  await act(page, 'idol', () => drag(page, [[8, 8], [7, 8]]), ['shift -1,0']);
  await act(page, 'idol', () => key('ArrowDown'), ['shift 0,1']);
  // Palette: change a colour (double-click a swatch), and add one.
  await page.locator('[data-colour=stone3]').dblclick();
  await page.getByLabel('hex').fill('#7a8a80');
  await act(page, 'idol', () => page.getByTestId('palette-save').click(), ['palette set stone3 hex=#7a8a80']);
  await page.getByTestId('palette-add').click();
  await page.getByLabel('hex').fill('#e0b040');
  await page.getByLabel('name', { exact: true }).fill('gold');
  await act(page, 'idol', () => page.getByTestId('palette-save').click(), [/^palette add gold hex=#e0b040 key=\S$/]);
  await page.locator('[data-colour=gold]').click();
  await key('b');
  await act(page, 'idol', () => drag(page, [[2, 12], [4, 12]]), [/^stroke pencil c=gold pp=on 2,12( 3,12)? 4,12$/]);
  // A note on a region (N): drag, write, pin. It shows on the canvas.
  await key('n');
  await drag(page, [[2, 12], [4, 12]]);
  await page.getByLabel('note text').fill('gold trim: keep it 3 px wide');
  await act(page, 'idol', () => page.getByRole('button', { name: 'Pin note' }).click(), ['note 2,12 3x1 "gold trim: keep it 3 px wide" id=n1']);
  await expect(page.locator('.note-label[data-note=n1]')).toContainText('gold trim');
  await expect(page.getByTestId('notes')).toContainText('human:chris');
  // Undo and redo (Ctrl+Z, Ctrl+Shift+Z, and the buttons).
  await act(page, 'idol', () => key('Control+z'), ['undo group=h19']);
  await expect(page.locator('.note-label')).toHaveCount(0);
  await act(page, 'idol', () => page.getByTestId('redo').click(), ['redo group=h20']);
  await act(page, 'idol', () => page.getByTestId('undo').click(), ['undo group=h19']);
  await act(page, 'idol', () => key('Control+Shift+z'), ['redo group=h22']);
  // Closing a note from the notes panel.
  await act(page, 'idol', () => page.getByTitle('Close this note (note done)').click(), ['note done n1']);
  // The command line runs any command as this person.
  await act(page, 'idol', async () => {
    await page.getByTestId('cmdline').fill('px 15,0 c=ink ; px 14,1 c=ink');
    await page.getByTestId('cmdline').press('Enter');
  }, ['px 15,0 c=ink', 'px 14,1 c=ink']);
  // The whole tape replays, every human line in its own h<N> group.
  const { tape } = await serverDoc(agent.url, 'idol');
  expect(tape.filter((e) => e.by === 'human:chris').length).toBeGreaterThan(25);
  expect(tape.filter((e) => e.by === 'human:chris').every((e) => /^h\d+$/.test(e.group))).toBe(true);
});

test('two browsers stay in sync while both edit', async ({ browser }) => {
  await agent.call('run', { asset: 'slab', commands: 'new tile slab 16x16 bg=stone1' });
  const ctxA = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  const ctxB = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await open(a, 'ana');
  await open(b, 'ben');
  await a.locator('[data-colour=moss2]').click();
  await b.locator('[data-colour=stone4]').click();
  // Alternate, and overlap: both drags in flight at once.
  await drag(a, [[0, 0], [5, 0]]);
  await drag(b, [[0, 2], [5, 2]]);
  await Promise.all([drag(a, [[1, 4], [1, 9], [3, 12]]), drag(b, [[8, 4], [12, 4], [12, 9]])]);
  await b.keyboard.press('g');
  await drag(b, [[14, 14]]);
  // The agent draws in between.
  await agent.call('run', { asset: 'slab', commands: 'line 0,15 15,15 c=ink' });
  await a.keyboard.press('u');
  await drag(a, [[6, 6], [10, 10]]);
  await expect.poll(() => tapeLength('slab')).toBe(8);
  const { tape } = await serverDoc(agent.url, 'slab');
  expect(tape.map((e) => e.by).filter((x) => x !== 'claude').sort()).toEqual(['human:ana', 'human:ana', 'human:ana', 'human:ben', 'human:ben', 'human:ben']);
  expect(new Set(tape.filter((e) => e.by !== 'claude').map((e) => e.group)).size).toBe(6);
  for (const p of [a, b]) {
    await canvasMatches(p, 'slab');
    expect((await pageTape(p)).map((e) => e.cmd)).toEqual(tape.map((e) => e.cmd));
  }
  await ctxA.close();
  await ctxB.close();
});

test('undo and redo are per author: each person takes back only their own edits', async ({ browser }) => {
  await agent.call('run', { asset: 'slab', commands: 'new tile slab 12x12 bg=stone1' });
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await open(a, 'ana');
  await open(b, 'ben');
  await drag(a, [[1, 1], [4, 1]]); // h1 ana
  await expect.poll(() => tapeLength('slab')).toBe(2);
  await drag(b, [[1, 3], [4, 3]]); // h2 ben
  await expect.poll(() => tapeLength('slab')).toBe(3);
  await agent.call('run', { asset: 'slab', commands: 'px 11,11 c=ink' }); // g2
  await expect(b.getByTestId('undo')).toBeEnabled();
  // Ana's undo takes back h1, not Ben's later h2 nor the agent's g2.
  await a.keyboard.press('Control+z');
  await expect.poll(async () => (await serverDoc(agent.url, 'slab')).tape.at(-1)!.cmd).toBe('undo group=h1');
  await expect(a.getByTestId('undo')).toBeDisabled();
  await expect(a.getByTestId('redo')).toBeEnabled();
  await expect(b.getByTestId('redo')).toBeDisabled();
  for (const p of [a, b]) await canvasMatches(p, 'slab');
  // Ben's undo takes back h2.
  await b.getByTestId('undo').click();
  await expect.poll(async () => (await serverDoc(agent.url, 'slab')).tape.at(-1)!.cmd).toBe('undo group=h2');
  // Ana redoes hers; Ben's stays undone.
  await a.getByTestId('redo').click();
  await expect.poll(async () => (await serverDoc(agent.url, 'slab')).tape.at(-1)!.cmd).toBe('redo group=h3');
  const { tape } = await serverDoc(agent.url, 'slab');
  expect(tape.slice(-3).map((e) => [e.by, e.cmd])).toEqual([
    ['human:ana', 'undo group=h1'], ['human:ben', 'undo group=h2'], ['human:ana', 'redo group=h3'],
  ]);
  for (const p of [a, b]) await canvasMatches(p, 'slab');
  // The agent's undo is as it was: the latest drawing group in effect, whoever wrote it.
  expect((await agent.call('run', { asset: 'slab', commands: 'undo' })).content[0]!.text).toContain('undo group=g2');
  await ctxA.close();
  await ctxB.close();
});

test('time travel: branch here makes a fork whose tape replays', async ({ page }) => {
  await agent.call('run', { asset: 'chest', commands: 'new sprite chest 12x12 bg=none\nrect 1,3 10x8 c=soil1 fill\nrect 1,3 10x8 c=ink\nline 1,6 10,6 c=ink\npx 5,7 6,7 c=lichen' });
  await open(page, 'chris');
  await (await tapeRow(page, 3)).click();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-seq', '3');
  // Read-only while travelling: the tools are off.
  await expect(page.locator('[data-tool=pencil]')).toBeDisabled();
  await page.getByTestId('branch').click();
  await expect(page.getByLabel('branch name')).toHaveValue('chest_b');
  await page.getByTestId('branch-create').click();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-asset', 'chest_b');
  const branch = await serverDoc(agent.url, 'chest_b');
  const src = await serverDoc(agent.url, 'chest');
  expect(branch.tape.slice(0, 3)).toEqual(src.tape.slice(0, 3));
  expect(branch.tape[3]).toMatchObject({ seq: 4, by: 'human:chris', group: 'h1', cmd: 'fork chest chest_b at=3' });
  await canvasMatches(page, 'chest_b');
  // Edit the branch; the original is untouched.
  await page.locator('[data-colour=moss3]').click();
  await drag(page, [[3, 5], [8, 5]]);
  await expect.poll(() => tapeLength('chest_b')).toBe(5);
  await canvasMatches(page, 'chest_b');
  expect((await serverDoc(agent.url, 'chest')).tape).toEqual(src.tape);
  await expect(page.getByTestId('assets')).toContainText('chest_b ⑂ chest');
});

test("the person's fixes and note come back to the agent through changes", async ({ page }) => {
  await agent.call('run', { asset: 'slab', commands: 'new tile slab 16x16 bg=stone2\nrect 0,0 16x16 c=stone0\nline 2,8 13,8 c=stone4' });
  expect((await agent.call('changes', {})).content[0]!.text).toBe('No changes since you last looked.');
  await open(page, 'chris');
  await page.locator('[data-colour=moss2]').click();
  // Three pixels, one click each, then a note.
  for (const p of [[4, 8], [5, 8], [9, 8]] as Pt[]) {
    const n = await tapeLength('slab');
    await drag(page, [p]);
    await expect.poll(() => tapeLength('slab')).toBe(n + 1);
  }
  await page.keyboard.press('n');
  await drag(page, [[5, 8]]);
  await page.getByLabel('note text').fill('moss sits in the cracks, not on top');
  await page.getByRole('button', { name: 'Pin note' }).click();
  await expect(page.locator('.note-label[data-note=n1]')).toBeVisible();
  const r = await agent.call('changes', {});
  const text = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  const lines = text.split('\n').filter((l) => /^#\d+ /.test(l));
  expect(lines).toEqual([
    '#4 human:chris h1  stroke pencil c=moss2 pp=on 4,8',
    '#5 human:chris h2  stroke pencil c=moss2 pp=on 5,8',
    '#6 human:chris h3  stroke pencil c=moss2 pp=on 9,8',
    '#7 human:chris h4  note 5,8 "moss sits in the cracks, not on top" id=n1',
  ]);
  expect(text).toContain('n1 at 5,8: "moss sits in the cracks, not on top"  (new)');
  expect(text).toContain('3 px changed:\n  4,8 stone4→moss2\n  5,8 stone4→moss2\n  9,8 stone4→moss2');
  expect(r.content.some((c) => c.type === 'image')).toBe(true);
  // The diff is now Claude's eye on the page.
  await expect(page.getByTestId('eye')).toContainText('slab · diff');
  expect((await agent.call('changes', {})).content[0]!.text).toBe('No changes since you last looked.');
  // The agent carries on from them and closes the note; the page shows it.
  await agent.call('run', { asset: 'slab', commands: 'px 10,8 c=moss2\nnote done n1' });
  await expect(page.locator('.note-label')).toHaveCount(0);
  await canvasMatches(page, 'slab');
});

test('a tape of 10,000 lines stays responsive', async ({ page }) => {
  test.setTimeout(120_000);
  await agent.call('run', { asset: 'big', commands: 'new tile big 64x64 bg=stone1' });
  const colours = ['stone0', 'stone2', 'stone3', 'moss1', 'moss2', 'soil1', 'lichen', 'ink'];
  for (let b = 0; b < 10; b++) {
    const lines: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const k = b * 1000 + i;
      lines.push(`px ${(k * 7) % 64},${(k * 13 + b) % 64} c=${colours[k % colours.length]}`);
    }
    if (b === 4) lines[999] = 'undo group=g3';
    expect((await agent.call('run', { asset: 'big', commands: lines.join('\n') })).isError).toBeFalsy();
  }
  const total = await tapeLength('big');
  expect(total).toBe(10_001);
  const t0 = Date.now();
  await open(page, 'chris');
  await canvasMatches(page, 'big');
  const loaded = Date.now() - t0;
  // Only the rows in view are in the page.
  expect(await page.locator('.cmd-row').count()).toBeLessThan(150);
  // Time travel to the middle, then nearby: answered from snapshots.
  const timeTo = async (seq: number) => {
    const row = await tapeRow(page, seq);
    const s = Date.now();
    await row.click();
    await expect(page.getByTestId('canvas')).toHaveAttribute('data-seq', String(seq));
    return Date.now() - s;
  };
  const first = await timeTo(5_000);
  const second = await timeTo(5_010);
  const at = await serverDoc(agent.url, 'big', 5_010);
  expect(mismatches(at.doc, await canvasPixels(page))).toEqual([]);
  // Scrolling the whole tape: every frame renders a few rows only.
  const scroll = await page.getByTestId('tape').evaluate(async (el) => {
    const s = performance.now();
    for (let y = 0; y < el.scrollHeight; y += el.scrollHeight / 50) {
      el.scrollTop = y;
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    return performance.now() - s;
  });
  // A stroke on the big tape still lands at once.
  await page.getByRole('button', { name: 'Back to live' }).click();
  const s = Date.now();
  await drag(page, [[1, 1], [6, 1]]);
  await expect.poll(() => tapeLength('big')).toBe(total + 1);
  await canvasMatches(page, 'big');
  const stroke = Date.now() - s;
  console.log(`10k tape: load ${loaded} ms, travel ${first} ms then ${second} ms, scroll 50 steps ${Math.round(scroll)} ms, stroke ${stroke} ms`);
  expect(loaded).toBeLessThan(10_000);
  expect(second).toBeLessThan(1_000);
  expect(scroll).toBeLessThan(5_000);
  expect(stroke).toBeLessThan(3_000);
});
