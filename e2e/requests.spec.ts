// The dashboard's request buttons (Draw this, Ask for changes, Add an asset) write records that fold
// to the states the cards show, following the agent through claim, work, done, blocked and an answer.

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

test('request buttons write records; the cards follow the agent through claim, work, done, blocked and an answer', async ({ page }) => {
  agent = await startAgent();
  expect((await agent.call('plan', { manifest: MANIFEST })).isError).toBeFalsy();
  expect((await agent.call('run', { asset: 'post', commands: 'new sprite post\nrect 6,2 4x12 c=soil1 fill\noutline c=ink' })).isError).toBeFalsy();
  await page.goto(`${agent.url}&name=ana&tab=dashboard`);
  const card = (n: string) => page.getByTestId(`card-${n}`);
  await expect(card('urn')).toHaveAttribute('data-status', 'planned');
  await expect(page.getByTestId('scene-gate')).toContainText('urn');

  // Draw this (planned), Ask for changes (drawn), Add an asset (a new manifest entry).
  await card('urn').getByTestId('draw').click();
  await card('urn').getByTestId('reject-text').fill('squat, with a lip');
  await card('urn').getByTestId('reject-send').click();
  await expect(card('urn').getByTestId('request-r1')).toHaveAttribute('data-state', 'open');
  await card('post').getByTestId('reject').click();
  await card('post').getByTestId('reject-text').fill('make it taller');
  await card('post').getByTestId('reject-send').click();
  await expect(card('post').getByTestId('request-r2')).toHaveAttribute('data-state', 'open');
  await page.getByTestId('add-asset-open').click();
  await page.getByTestId('add-name').fill('lamp');
  await page.getByTestId('add-size').fill('16');
  await page.getByTestId('add-set').selectOption('props');
  await page.getByTestId('add-send').click();
  await expect(page.getByTestId('add-error')).toContainText('size');
  await page.getByTestId('add-size').fill('16x16');
  await page.getByTestId('add-description').fill('a lantern on a pole');
  await page.getByTestId('add-send').click();
  await expect(card('lamp').getByTestId('request-r3')).toHaveAttribute('data-state', 'open');
  await expect(page.getByTestId('requests-count')).toHaveText('3 requests for Claude');
  expect(records(agent).map((r) => [r.type, r.id, r.by])).toEqual([['request', 'r1', 'human:ana'], ['request', 'r2', 'human:ana'], ['request', 'r3', 'human:ana']]);
  expect(JSON.parse(readFileSync(join(agent.dir, 'manifest.json'), 'utf8')).assets.at(-1)).toMatchObject({ name: 'lamp', kind: 'sprite', size: '16x16', set: 'props' });
  expect((await serverDoc(agent.url, 'post')).tape.at(-1)).toMatchObject({ by: 'human:ana', cmd: 'mark rejected "make it taller"' });

  // The agent claims r1 and draws: the card says Claude is working on it.
  expect(text(await agent.call('plan', {}))).toMatch(/^Requests from people \(3\)/);
  expect(text(await agent.call('work', {}))).toMatch(/^claimed r1/);
  await expect(card('urn').getByTestId('request-r1')).toHaveAttribute('data-state', 'claimed');
  expect((await agent.call('run', { asset: 'urn', commands: 'new sprite urn\nrect 4,4 8x10 c=stone2 fill' })).isError).toBeFalsy();
  await expect(card('urn').getByTestId('working')).toContainText('Claude is working on this');
  expect((await agent.call('work', { action: 'progress', text: 'outlining' })).isError).toBeFalsy();
  await expect(card('urn').getByTestId('working')).toContainText('outlining');
  // Done is refused while a check fails: the urn has no outline yet.
  expect(text(await agent.call('work', { action: 'done', text: 'drew the urn with a lip' }))).toMatch(/r1 is not done: urn fails/);
  expect((await agent.call('run', { asset: 'urn', commands: 'outline c=ink' })).isError).toBeFalsy();
  expect((await agent.call('work', { action: 'done', text: 'drew the urn with a lip' })).isError).toBeFalsy();
  await expect(card('urn').getByTestId('request-r1')).toHaveAttribute('data-state', 'done');
  await expect(card('urn')).toContainText('✓ done: drew the urn with a lip');

  // r2 blocked with a question; the person answers on the card; it is open again.
  expect(text(await agent.call('work', {}))).toMatch(/^claimed r2/);
  expect((await agent.call('work', { action: 'blocked', text: 'Taller by 2 px or 4 px?' })).isError).toBeFalsy();
  await expect(card('post').getByTestId('request-r2')).toHaveAttribute('data-state', 'blocked');
  await expect(card('post')).toContainText('Claude asks: “Taller by 2 px or 4 px?”');
  await card('post').getByTestId('reply-text').fill('4 px');
  await card('post').getByTestId('reply-send').click();
  await expect(card('post').getByTestId('request-r2')).toHaveAttribute('data-state', 'open');
  // Withdraw r3.
  await card('lamp').getByTestId('cancel').click();
  await expect(card('lamp').getByTestId('request-r3')).toHaveCount(0);

  // The records replay (core's fold) to exactly what the cards showed.
  const { requests, problems } = foldRequests(records(agent));
  expect(problems).toEqual([]);
  expect([...requests.values()].map((q) => [q.id, q.state])).toEqual([['r1', 'done'], ['r2', 'open'], ['r3', 'cancelled']]);
  expect(requests.get('r2')!.events.map((e) => [e.type, e.by])).toEqual([['claim', 'claude'], ['blocked', 'claude'], ['reply', 'human:ana']]);
});
