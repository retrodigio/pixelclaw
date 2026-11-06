// The judge on the dashboard: an advisory badge on each card with the judge's answers, "unsure"
// shown as unsure, and nothing at all while the project's judge is off. The answers come from the
// real `pixelclaw judge` command with its HTTP call answered by a stand-in (fake-judge-api.mjs).

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { startAgent, REPO, type Agent } from './helpers.ts';

let agent: Agent;
test.beforeEach(async () => { agent = await startAgent(); });
test.afterEach(async () => { await agent.close(); });

const MANIFEST = {
  format: 'pixelclaw-manifest', version: 1, theme: 'Moss over old stone, lit from the top left.',
  assets: [
    { name: 'urn', kind: 'sprite', size: '16x16', set: 'props', description: 'a squat stone urn', reads: ['a rim at the top'] },
    { name: 'post', kind: 'sprite', size: '16x16', set: 'props', description: 'a waymark post' },
  ],
};

/** `pixelclaw judge` with its HTTP call answered by the stand-in; it exits 1 when a question fails, as the stray-blob one does here. */
function judge(args: string[]): string {
  const r = spawnSync(process.execPath, ['--import', join(REPO, 'e2e', 'fake-judge-api.mjs'), join(REPO, 'cli', 'bin', 'pixelclaw.js'), 'judge', agent.dir, ...args], {
    env: { ...process.env, TYPESAFE_API_KEY: 'tsk_e2e_not_a_real_key' }, encoding: 'utf8',
  });
  expect(r.status, r.stderr).toBe(1);
  return r.stdout;
}

async function draw(): Promise<void> {
  expect((await agent.call('plan', { manifest: MANIFEST })).isError).toBeFalsy();
  for (const a of ['urn', 'post']) {
    expect((await agent.call('run', { asset: a, commands: `new sprite ${a}\nrect 4,4 8x10 c=stone2 fill\noutline c=ink` })).isError).toBeFalsy();
  }
}

test('the judge is off by default: no badge on the cards', async ({ page }) => {
  await draw();
  await page.goto(`${agent.url}&name=pat&tab=dashboard`);
  await expect(page.getByTestId('card-urn')).toBeVisible();
  await expect(page.getByTestId('judge')).toHaveCount(0);
});

test('the dashboard shows the judge\'s answers as an advisory badge, with unsure as unsure', async ({ page }) => {
  await draw();
  const pj = JSON.parse(readFileSync(join(agent.dir, 'project.json'), 'utf8'));
  writeFileSync(join(agent.dir, 'project.json'), JSON.stringify({ ...pj, judge: { provider: 'jev' } }, null, 2));
  await page.goto(`${agent.url}&name=pat&tab=dashboard`);
  // Before any question is asked, the card says so.
  await expect(page.getByTestId('card-urn').getByTestId('judge-notasked')).toBeVisible();
  // Advisory: a failing answer does not move the asset's status.
  const status = await page.getByTestId('card-urn').getAttribute('data-status');
  const out = judge([]);
  expect(out).toContain('urn: ');
  expect(out).toContain('wrote ');
  await page.reload();
  const row = page.getByTestId('card-urn').getByTestId('judge');
  await expect(row.getByTestId('judge-tag')).toHaveText('judge · advisory');
  await expect(row.locator('[data-judge="recognisable"]')).toHaveAttribute('data-status', 'pass');
  const reads = row.locator('[data-judge="reads.1"]');
  await expect(reads).toHaveAttribute('data-status', 'unsure');
  await expect(reads).toContainText('unsure');
  await expect(row.locator('[data-judge="stray"]')).toHaveAttribute('data-status', 'fail');
  await expect(page.getByTestId('card-urn')).toHaveAttribute('data-status', status!);
  await expect(page.getByTestId('card-post').locator('[data-judge="reads.1"]')).toHaveCount(0);
  // The same answers are in `check`, as a separate table.
  const check = (await agent.call('check', { asset: 'urn' })).content.map((c) => c.text ?? '').join('\n');
  expect(check).toContain('judge urn: advisory');
  expect(check).toMatch(/\? {2}reads: a rim at the top/);
  // Gating changes the tag, not the answers.
  writeFileSync(join(agent.dir, 'project.json'), JSON.stringify({ ...pj, judge: { provider: 'jev', gate: true } }, null, 2));
  await page.reload();
  await expect(page.getByTestId('card-urn').getByTestId('judge-tag')).toHaveText('judge · gates');
});
