// Plan §10 G3 on the server: people's edits arrive over the WebSocket and become tape commands
// with their author (h<N> groups); `changes` returns exactly the people's lines and notes with a
// diff image, then nothing new; forks start a branch tape that replays; undo and redo by author.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BIN, openPage, spawnServer, texts, until, wsUrl, type Page, type Served } from './spawn.ts';

let s: Served;
let page: Page;
const CHRIS = 'human:chris';
const tape = (asset: string) => readFileSync(join(s.proj, 'assets', asset, 'tape.jsonl'), 'utf8').trim().split('\n').slice(1).map((l) => JSON.parse(l) as { seq: number; by: string; group: string; cmd: string });

beforeAll(async () => {
  s = await spawnServer('pixelclaw-edits-');
  page = await openPage(wsUrl(s.url));
  await until(() => page.messages.length === 1);
  const r = await s.call('run', { asset: 'slab', commands: 'new tile slab 8x8 bg=stone1\nrect 1,1 6x6 c=stone3 fill\nline 1,1 6,1 c=stone4' });
  expect(r.isError).toBeFalsy();
}, 20000);

afterAll(async () => {
  page?.ws.close();
  await s?.close();
});

describe('edits from a page', () => {
  it('become tape commands with their author, in the person\'s own h<N> groups', async () => {
    const r = await page.run('slab', 'stroke pencil c=ink 2,2 3,3', CHRIS);
    expect(r).toMatchObject({ ok: true, group: 'h1' });
    expect(tape('slab').at(-1)).toMatchObject({ seq: 4, by: CHRIS, group: 'h1', cmd: 'stroke pencil c=ink pp=on 2,2 3,3' });
    const batch = page.messages.find((m) => m.type === 'batch' && m.by === CHRIS)!;
    expect(batch).toMatchObject({ asset: 'slab', group: 'h1', reset: false });
    // The agent's next group keeps its own counter.
    expect(texts((await s.call('run', { asset: 'slab', commands: 'px 0,0 c=ink' })).content)).toContain('as group g2');
  });

  it('are refused with errors (and nothing applied) for bad commands, a bad author or a restart', async () => {
    const before = tape('slab').length;
    const bad = await page.run('slab', 'px 1,1 c=gold', CHRIS);
    expect(bad.ok).toBe(false);
    expect(bad.errors![0]!.message).toContain("unknown colour 'gold'");
    expect((await page.run('slab', 'px 1,1 c=ink', 'claude')).errors![0]!.message).toContain('human:<name>');
    expect((await page.run('slab', 'new tile slab 8x8', CHRIS)).errors![0]!.message).toContain('already exists');
    expect(tape('slab').length).toBe(before);
  });

  it('undo and redo by author take back only that person\'s groups', async () => {
    await page.run('slab', 'px 6,6 c=moss3', 'human:ana'); // h2
    const u = await page.run('slab', `undo by=${CHRIS}`, CHRIS);
    expect(u.ok).toBe(true);
    expect(tape('slab').at(-1)!.cmd).toBe('undo group=h1');
    await page.run('slab', `redo by=${CHRIS}`, CHRIS);
    expect(tape('slab').at(-1)!.cmd).toMatch(/^redo group=h3$/);
    expect((await page.run('slab', `redo by=${CHRIS}`, CHRIS)).errors![0]!.message).toBe(`nothing of ${CHRIS}'s to redo`);
  });
});

describe('changes', () => {
  it('returns exactly the people\'s lines and notes with a diff image, then nothing new', async () => {
    // Everything so far (the edits above) is unread; read it once to start clean.
    const first = await s.call('changes', {});
    expect(texts(first.content)).toContain('slab: 4 commands (3 by human:chris, 1 by human:ana) since #3');
    expect(texts((await s.call('changes', {})).content)).toBe('No changes since you last looked.');

    // The person fixes three pixels and leaves a note; the agent draws one line in between.
    const from = tape('slab').at(-1)!.seq;
    await page.run('slab', 'stroke pencil c=moss2 pp=on 3,4', CHRIS);
    await s.call('run', { asset: 'slab', commands: 'px 7,7 c=ink' });
    await page.run('slab', 'stroke pencil c=moss2 pp=on 4,4 5,4', CHRIS);
    await page.run('slab', 'note 3,4 3x1 "moss should sit low, under the lip"', CHRIS);
    const r = await s.call('changes', {});
    expect(r.isError).toBeFalsy();
    const t = texts(r.content);
    const human = tape('slab').filter((e) => e.seq > from && e.by === CHRIS);
    expect(human.map((e) => e.cmd)).toEqual([
      'stroke pencil c=moss2 pp=on 3,4', 'stroke pencil c=moss2 pp=on 4,4 5,4', 'note 3,4 3x1 "moss should sit low, under the lip" id=n1',
    ]);
    expect(t).toContain(`slab: 3 commands (3 by human:chris) since #${from}`);
    for (const e of human) expect(t).toContain(`#${e.seq} human:chris ${e.group}  ${e.cmd}`);
    // Exactly those: the agent's own line is not listed (but counted).
    expect(t.split('\n').filter((l) => /^#\d+ /.test(l)).length).toBe(3);
    expect(t).not.toContain('px 7,7 c=ink');
    expect(t).toContain('(1 of your own command in the same range are not listed; the diff includes them)');
    expect(t).toContain('n1 at 3,4 3x1: "moss should sit low, under the lip"  (new)');
    expect(t).toContain('4 px changed:\n  3,4 stone3→moss2\n  4,4 stone3→moss2\n  5,4 stone3→moss2\n  7,7 stone1→ink');
    const img = r.content.find((c) => c.type === 'image')!;
    const path = join(s.proj, 'views', 'slab.diff.png');
    expect(t).toContain(`saved ${path}`);
    expect(Buffer.compare(Buffer.from(img.data!, 'base64'), readFileSync(path))).toBe(0);
    // The page's "Claude's eye" now shows the diff.
    await until(() => page.messages.some((m) => m.type === 'eye' && (m.eye as { mode: string }).mode === 'diff'));
    // A second call: nothing new.
    expect(texts((await s.call('changes', {})).content)).toBe('No changes since you last looked.');
    // The read position is kept in the project, so a restarted server knows it.
    expect(JSON.parse(readFileSync(join(s.proj, 'reads.json'), 'utf8')).claude.slab).toBe(tape('slab').at(-1)!.seq);
    expect(JSON.parse(readFileSync(join(s.proj, 'assets', 'slab', 'asset.json'), 'utf8')).notes).toEqual([
      { id: 'n1', x: 3, y: 4, w: 3, h: 1, text: 'moss should sit low, under the lip' },
    ]);
  });

  it('since re-reads from a command, and the project summary lists open notes', async () => {
    const t = texts((await s.call('changes', { asset: 'slab', since: tape('slab').at(-2)!.seq })).content);
    expect(t).toContain('slab: 1 command (1 by human:chris)');
    expect(texts((await s.call('project', {})).content)).toContain('open notes: n1');
    // The agent closes the note: its own line is not a change for it.
    await s.call('run', { asset: 'slab', commands: 'note done n1' });
    expect(texts((await s.call('changes', {})).content)).toBe('No changes since you last looked.');
  });

  it('view diff shows what the latest group changed', async () => {
    await s.call('run', { asset: 'slab', commands: 'px 0,7 1,7 c=moss1' });
    const r = await s.call('view', { asset: 'slab', mode: 'diff' });
    expect(texts(r.content)).toContain('2 px changed:\n  0,7 stone1→moss1\n  1,7 stone1→moss1');
    expect(r.content.some((c) => c.type === 'image')).toBe(true);
  });
});

describe('fork', () => {
  it('a page branches an asset at an earlier command; the branch tape replays and verifies', async () => {
    const r = await page.run('slab_b', 'fork slab slab_b at=3\npx 0,0 c=moss3', CHRIS);
    expect(r.ok).toBe(true);
    const b = tape('slab_b');
    const src = tape('slab');
    expect(b.slice(0, 3)).toEqual(src.slice(0, 3));
    expect(b.slice(3).map((e) => [e.seq, e.by, e.group, e.cmd])).toEqual([
      [4, CHRIS, 'h1', 'fork slab slab_b at=3'], [5, CHRIS, 'h1', 'px 0,0 c=moss3'],
    ]);
    const batch = page.messages.filter((m) => m.type === 'batch' && m.asset === 'slab_b').at(-1)!;
    expect(batch.reset).toBe(true);
    expect(JSON.parse(readFileSync(join(s.proj, 'assets', 'slab_b', 'asset.json'), 'utf8')).links).toEqual([{ fork: { from: 'slab', at: 3 } }]);
    expect(execFileSync(process.execPath, [BIN, 'verify', s.proj], { encoding: 'utf8' })).toMatch(/ok +slab_b/);
  });

  it('the agent forks through run too; changes on a branch start at the fork', async () => {
    const r = await s.call('run', { asset: 'slab_c', commands: 'fork slab slab_c' });
    expect(texts(r.content)).toContain(`fork slab slab_c at=${tape('slab').at(-1)!.seq}`);
    expect((await s.call('run', { asset: 'slab_d', commands: 'fork nope slab_d' })).isError).toBe(true);
    expect(texts((await s.call('run', { asset: 'slab_d', commands: 'fork slab slab_d at=999' })).content)).toContain('is not a command of');
    expect(existsSync(join(s.proj, 'assets', 'slab_d'))).toBe(false);
    // The person's branch: only what came after the fork is new to the agent.
    const t = texts((await s.call('changes', { asset: 'slab_b' })).content);
    expect(t).toContain('slab_b: 2 commands (2 by human:chris) since #3');
  });
});
