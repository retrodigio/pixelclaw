// A request is only a note in the project until an agent hears of it. The cards say so: sent, then
// seen by an agent, and with nobody listening (or nobody looking for two minutes) a plain warning
// with a prompt to hand to Claude Code.

import { appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { REPO, startAgent, type Agent } from './helpers.ts';

let agent: Agent;
test.afterEach(async () => { await agent?.close(); });

const MANIFEST = {
  format: 'pixelclaw-manifest', version: 1, theme: 'Moss over old stone, lit from the top left.',
  sets: { props: { description: 'things that stand' } },
  assets: [
    { name: 'urn', kind: 'sprite', size: '16x16', set: 'props', height: 12, description: 'a squat stone urn' },
    { name: 'post', kind: 'sprite', size: '16x16', set: 'props', height: 14, description: 'a waymark post' },
  ],
};

/** Screenshots for the docs, written only when asked (SCREENSHOTS=1 pnpm test:e2e listening). */
const shot = async (page: import('@playwright/test').Page, name: string) => {
  if (process.env.SCREENSHOTS) await page.getByTestId('card-urn').screenshot({ path: join(REPO, 'docs', 'screenshots', `${name}.png`) });
};

test('with nobody listening the card says so, offers the prompt, and clears once an agent is there', async ({ page, context }) => {
  agent = await startAgent({ home: true });
  // The manifest is written to the folder directly: no agent tool has been called, so nobody is listening.
  writeFileSync(join(agent.dir, 'manifest.json'), JSON.stringify(MANIFEST));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`${agent.url}&name=ana&tab=dashboard`);
  const card = page.getByTestId('card-urn');
  await expect(card).toHaveAttribute('data-status', 'planned');
  await expect(page.getByTestId('listener-chip')).toHaveAttribute('data-listening', 'false');
  await expect(page.getByTestId('listener-chip')).toContainText('no agent is listening');

  // Submitting says so at once, instead of looking accepted by Claude.
  await card.getByTestId('draw').click();
  await card.getByTestId('reject-text').fill('squat, with a lip');
  await card.getByTestId('reject-send').click();
  const req = card.getByTestId('request-r1');
  await expect(req).toHaveAttribute('data-stage', 'sent');
  await expect(req.getByTestId('stage')).toHaveText('sent');
  await expect(req.getByTestId('no-listener')).toContainText('No agent is listening');
  await expect(req.getByTestId('no-listener')).toContainText('Nobody has this request yet');
  await expect(page.getByTestId('requests-count')).toContainText('no agent is listening');
  // The worker is off in this project, so only the prompt is offered.
  await expect(req.getByTestId('start-worker')).toHaveCount(0);
  await req.getByTestId('copy-prompt').click();
  await expect(req.getByTestId('prompt-copied')).toContainText('Copied');
  const prompt = await req.getByTestId('prompt-text').innerText();
  // The folder as the person would type it, and the steps for a session with MCP and one without.
  expect(prompt).toContain('the project at ~/art/ruins.pclaw.');
  expect(prompt).toContain('`pixelclaw await ~/art/ruins.pclaw`');
  expect(prompt).toContain('--since');
  expect(prompt).toContain("If you have PixelClaw's MCP tools, use the work tool");
  for (const step of ['claim', 'progress "<note>"', 'done "<what changed>"', 'block "<one clear question>"']) {
    expect(prompt).toContain(`\`pixelclaw work ~/art/ruins.pclaw ${step}`);
  }
  expect(prompt).not.toContain('/var/');
  expect(prompt).not.toContain(tmpdir());
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(prompt);
  await shot(page, 'request-nobody-listening');

  // An agent comes: it lists the requests (which hands it r1). The warning goes; the card says who has seen it.
  expect((await agent.call('work', { action: 'list' })).isError).toBeFalsy();
  await expect(req.getByTestId('no-listener')).toHaveCount(0);
  await expect(req).toHaveAttribute('data-stage', 'seen');
  await expect(req.getByTestId('stage')).toHaveText('seen by claude');
  await expect(page.getByTestId('listener-chip')).toHaveAttribute('data-listening', 'true');
  await expect(page.getByTestId('requests-count')).not.toContainText('no agent');
  await shot(page, 'request-seen');

  // Working, then done.
  expect((await agent.call('work', {})).isError).toBeFalsy();
  await expect(req).toHaveAttribute('data-stage', 'working');
});

test('an agent is around but has not looked at a request for two minutes: the card says so', async ({ page }) => {
  agent = await startAgent();
  writeFileSync(join(agent.dir, 'manifest.json'), JSON.stringify(MANIFEST));
  expect((await agent.call('work', { action: 'list' })).isError).toBeFalsy();
  await page.goto(`${agent.url}&name=ana&tab=dashboard`);
  await expect(page.getByTestId('listener-chip')).toHaveAttribute('data-listening', 'true');
  // A request filed ten minutes ago that nobody has seen (written as an older client would have).
  const old = new Date(Date.now() - 10 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  appendFileSync(join(agent.dir, 'requests.jsonl'), JSON.stringify({ type: 'request', id: 'r1', asset: 'urn', kind: 'draw', note: '', by: 'human:ana', at: old }) + '\n');
  // Any request change makes the server send them all again; the agent's own request does that.
  expect((await agent.call('request', { kind: 'draw', asset: 'post' })).isError).toBeFalsy();
  const req = page.getByTestId('card-urn').getByTestId('request-r1');
  await expect(req.getByTestId('no-listener')).toContainText('couple of minutes');
  await expect(req).toHaveAttribute('data-stage', 'sent');
  await expect(page.getByTestId('requests-count')).toContainText('unseen for 2 minutes');
  // The agent's own request, just filed, is not flagged.
  await expect(page.getByTestId('card-post').getByTestId('no-listener')).toHaveCount(0);
});
