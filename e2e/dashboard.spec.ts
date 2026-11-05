// The dashboard in the browser: the dashboard shows the manifest as cards by set, coloured by
// status, with failing checks; Approve and "Ask for changes" log `mark approved` and
// `mark rejected "…"` on the asset's tape with the person's name, and core's replay of the tape
// gives the status the page shows. Tabs, filters and opening an asset log nothing.

import { expect, test } from '@playwright/test';
import { artHash, statusOf } from '../core/src/index.ts';
import { serverDoc, startAgent, type Agent } from './helpers.ts';

let agent: Agent;
test.beforeEach(async () => { agent = await startAgent(); });
test.afterEach(async () => { await agent.close(); });

const MANIFEST = {
  format: 'pixelclaw-manifest', version: 1, theme: 'Moss over old stone, lit from the top left.',
  sets: { ground: { description: 'floors' }, props: { description: 'things that stand' } },
  assets: [
    { name: 'turf', kind: 'tile', size: '24x24', set: 'ground', description: 'short moss' },
    { name: 'urn', kind: 'sprite', size: '16x16', set: 'props', height: 12, description: 'a squat stone urn' },
    { name: 'post', kind: 'sprite', size: '16x16', set: 'props', height: 14, description: 'a waymark post' },
  ],
};

test('the dashboard: cards by status; approving and asking for changes are marks on the tape', async ({ page }) => {
  expect((await agent.call('plan', { manifest: MANIFEST })).isError).toBeFalsy();
  for (const [asset, commands] of [
    ['urn', 'new sprite urn\nrect 4,4 8x10 c=stone2 fill\nline 4,4 11,4 c=stone4\nline 4,4 4,13 c=stone4\nline 5,13 11,13 c=stone1\noutline c=ink\nmark reviewed "reads as an urn"'],
    ['post', 'new sprite post\nrect 6,2 4x12 c=soil1 fill\npx 0,0 c=moss2'],
  ] as const) expect((await agent.call('run', { asset, commands })).isError).toBeFalsy();
  const before = (await serverDoc(agent.url, 'post')).tape.length;
  await page.goto(`${agent.url}&name=pat&tab=dashboard`);
  await expect(page.getByTestId('dashboard')).toBeVisible();
  const card = (n: string) => page.getByTestId(`card-${n}`);
  await expect(card('turf')).toHaveAttribute('data-status', 'planned');
  await expect(card('post')).toHaveAttribute('data-status', 'drafted');
  await expect(card('post').locator('.chk.fail').first()).toBeVisible();
  await expect(card('urn')).toHaveAttribute('data-status', 'reviewed');
  await expect(page.getByTestId('set-ground')).toContainText('floors');
  // Filters only change what is shown.
  await page.getByTestId('filter-drafted').click();
  await expect(card('urn')).toHaveCount(0);
  await expect(card('post')).toBeVisible();
  await page.getByTestId('filter-drafted').click();
  await page.getByTestId('set-filter').selectOption('ground');
  await expect(card('post')).toHaveCount(0);
  await page.getByTestId('set-filter').selectOption('all');

  // Approve: one command on the urn's tape, by the person.
  await card('urn').getByTestId('approve').click();
  await expect(card('urn')).toHaveAttribute('data-status', 'approved');
  let { doc, tape } = await serverDoc(agent.url, 'urn');
  expect(tape.at(-1)).toMatchObject({ by: 'human:pat', cmd: 'mark approved' });
  expect(statusOf({ exists: true, checksPass: true, marks: doc.marks, art: artHash(doc) }).status).toBe('approved');

  // Ask for changes: the reason goes into the line.
  await card('urn').getByTestId('reject').click();
  await card('urn').getByTestId('reject-text').fill('the rim wants a "lip" of light');
  await card('urn').getByTestId('reject-send').click();
  await expect(card('urn')).toHaveAttribute('data-status', 'reviewed');
  await expect(card('urn')).toContainText('changes asked for');
  ({ doc, tape } = await serverDoc(agent.url, 'urn'));
  expect(tape.at(-1)).toMatchObject({ by: 'human:pat', cmd: 'mark rejected "the rim wants a \\"lip\\" of light"' });
  const st = statusOf({ exists: true, checksPass: true, marks: doc.marks, art: artHash(doc) });
  expect(st.status).toBe('reviewed');
  expect(st.flags.join(' ')).toContain('the rim wants a "lip" of light');

  // The agent's edit reaches the page: the post is fixed and its card moves on.
  expect((await agent.call('run', { asset: 'post', commands: 'clean orphans\nline 6,2 9,2 c=soil2\nline 6,2 6,13 c=soil2\noutline c=ink' })).isError).toBeFalsy();
  await expect(card('post')).toHaveAttribute('data-status', 'checked');
  const mid = (await serverDoc(agent.url, 'post')).tape.length;
  expect(mid).toBe(before + 4);

  // Opening an asset goes to the editor; looking logged nothing on the post's tape.
  await card('post').locator('.thumb').click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await expect(page.locator('.crumbs')).toContainText('post');
  expect((await serverDoc(agent.url, 'post')).tape.length).toBe(mid);
});
