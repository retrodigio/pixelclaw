// The event cursor and presence (await.ts), the token file (runfile.ts).
import { chmodSync, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { foldRequests, type RequestRecord } from '@pixelclaw/core';
import { ACTIVE_MS, Hub, unseenOpen } from '../src/await.ts';
import { readTokenFile, removeTokenFile, tokenFilePath, writeTokenFile } from '../src/runfile.ts';

const req = (id: string, by = 'human:ana'): RequestRecord => ({ type: 'request', id, asset: 'urn', kind: 'draw', note: 'n', by, at: '2026-11-05T10:00:00Z' });

describe('the event cursor', () => {
  it('returns events after a cursor once, in order, and nothing is repeated', async () => {
    const h = new Hub();
    const recs: RequestRecord[] = [];
    const push = (r: RequestRecord) => { recs.push(r); h.syncRequests(recs, foldRequests(recs).requests); };
    push(req('r1'));
    const first = await h.wait({ initial: () => [], timeoutMs: 50, by: 'claude', via: 'cli' });
    expect(first.events).toEqual([]);
    const c0 = first.cursor;
    push(req('r2'));
    push({ type: 'cancel', id: 'r2', by: 'human:ana', at: '2026-11-05T10:01:00Z' });
    const a = await h.wait({ cursor: c0, initial: () => [], timeoutMs: 50, by: 'claude', via: 'cli' });
    expect(a.events.map((e) => [e.kind, e.id])).toEqual([['request', 'r2'], ['cancel', 'r2']]);
    expect(a.events.map((e) => e.seq)).toEqual([2, 3]);
    const b = await h.wait({ cursor: a.cursor, initial: () => [], timeoutMs: 20, by: 'claude', via: 'cli' });
    expect(b).toMatchObject({ events: [], timedOut: true, cursor: a.cursor });
  });

  it('wakes a waiter as soon as an event arrives', async () => {
    const h = new Hub();
    const recs: RequestRecord[] = [];
    const t0 = Date.now();
    const w = h.wait({ initial: () => [], timeoutMs: 5000, by: 'claude', via: 'cli' });
    expect(h.presence().waiters).toHaveLength(1);
    setTimeout(() => { recs.push(req('r1')); h.syncRequests(recs, foldRequests(recs).requests); }, 30);
    const r = await w;
    expect(r.events[0]).toMatchObject({ kind: 'request', id: 'r1', next: 'work' });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(h.presence().waiters).toHaveLength(0);
  });

  it('does not report the agent\'s own claim, progress and done, nor its own requests back to it', async () => {
    const h = new Hub();
    const recs: RequestRecord[] = [req('r1')];
    h.attach([]);
    const at = '2026-11-05T10:00:00Z';
    recs.push({ type: 'claim', id: 'r1', by: 'claude', at }, { type: 'progress', id: 'r1', by: 'claude', at, text: 'x' }, { type: 'done', id: 'r1', by: 'claude', at, text: 'y' }, req('r2', 'claude'));
    h.syncRequests(recs, foldRequests(recs).requests);
    const r = await h.wait({ cursor: `${h.epoch}:0`, initial: () => [], timeoutMs: 20, by: 'claude', via: 'cli' });
    expect(r.events.map((e) => e.id)).toEqual(['r1']);
  });

  it('a cursor from another run, or none, falls back to the open unseen requests', async () => {
    const h = new Hub();
    const recs = [req('r1'), req('r2'), { type: 'seen', id: 'r2', by: 'claude', at: '2026-11-05T10:00:00Z' } as RequestRecord];
    const initial = () => unseenOpen(foldRequests(recs).requests);
    for (const cursor of [undefined, 'ffffff:3', 'junk', `${h.epoch}:99`]) {
      const r = await h.wait({ cursor, initial, timeoutMs: 20, by: 'claude', via: 'cli' });
      expect(r.events.map((e) => e.id), String(cursor)).toEqual(['r1']);
    }
  });

  it('status marks by a person are events; the agent\'s are not; Ask for changes is one event, not two', () => {
    const h = new Hub();
    h.marks('urn', 'human:ana', [{ cmd: 'mark approved "nice"' }, { cmd: 'fill 0,0 c=a' }], 'T');
    h.marks('urn', 'claude', [{ cmd: 'mark reviewed' }], 'T');
    h.withoutMarkEvents(() => h.marks('urn', 'human:ana', [{ cmd: 'mark rejected "taller"' }], 'T'));
    h.marks('urn', 'human:bo', [{ cmd: 'mark reviewed' }], 'T');
    const e = h.since(`${h.epoch}:0`)!;
    expect(e.map((x) => [x.kind, x.asset, x.note, x.next])).toEqual([['approved', 'urn', 'nice', 'changes'], ['reviewed', 'urn', '', 'changes']]);
  });

  it('a waiting await, a recent tool call and the running worker make the project listened to', () => {
    let now = 1_000_000;
    let worker = false;
    const h = new Hub(() => now);
    h.workerRunning = () => worker;
    expect(h.presence().listening).toBe(false);
    h.touch('claude');
    expect(h.presence()).toMatchObject({ listening: true, agents: [{ by: 'claude' }] });
    now += ACTIVE_MS + 1;
    expect(h.presence().listening).toBe(false);
    worker = true;
    expect(h.presence()).toMatchObject({ listening: true, worker: true });
    h.close();
  });
});

describe('the seen record', () => {
  const at = '2026-11-05T10:00:00Z';
  it('folds into the request, once per agent, and a reply clears it', () => {
    const recs: RequestRecord[] = [req('r1'), { type: 'seen', id: 'r1', by: 'claude', at }, { type: 'seen', id: 'r1', by: 'claude', at }, { type: 'seen', id: 'r1', by: 'other', at }];
    const f = foldRequests(recs);
    expect(f.requests.get('r1')!.seen.map((s) => s.by)).toEqual(['claude', 'other']);
    expect(f.problems).toHaveLength(1);
    const more = [...recs, { type: 'claim', id: 'r1', by: 'claude', at } as RequestRecord, { type: 'blocked', id: 'r1', by: 'claude', at, text: 'q?' } as RequestRecord, { type: 'reply', id: 'r1', by: 'human:ana', at, text: 'a' } as RequestRecord];
    expect(foldRequests(more).requests.get('r1')).toMatchObject({ state: 'open', seen: [] });
  });

  it('files written before seen existed read the same', () => {
    const old = [req('r1'), { type: 'claim', id: 'r1', by: 'claude', at } as RequestRecord, { type: 'done', id: 'r1', by: 'claude', at, text: 'ok' } as RequestRecord];
    const f = foldRequests(old);
    expect(f.problems).toEqual([]);
    expect(f.requests.get('r1')).toMatchObject({ state: 'done', seen: [] });
  });

  it('is refused once the request is no longer open', () => {
    const f = foldRequests([req('r1'), { type: 'claim', id: 'r1', by: 'claude', at } as RequestRecord, { type: 'seen', id: 'r1', by: 'other', at }]);
    expect(f.problems[0]).toMatch(/only an open request/);
  });
});

describe('the token file', () => {
  let tmp: string;
  let proj: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pixelclaw-tok-'));
    proj = join(tmp, 'p.pclaw');
    process.env.PIXELCLAW_STATE_DIR = join(tmp, 'state');
  });
  afterEach(() => {
    delete process.env.PIXELCLAW_STATE_DIR;
    rmSync(tmp, { recursive: true, force: true });
  });

  it.skipIf(process.platform === 'win32')('is created readable by the user alone, outside the project, and removed on stop', () => {
    writeTokenFile(proj, { url: 'http://127.0.0.1:7417/', token: 'secret' });
    const f = tokenFilePath(proj);
    expect(f.startsWith(proj)).toBe(false);
    expect(statSync(f).mode & 0o777).toBe(0o600);
    expect(statSync(join(tmp, 'state')).mode & 0o777).toBe(0o700);
    expect(readTokenFile(proj)).toMatchObject({ token: 'secret', pid: process.pid });
    removeTokenFile(proj);
    expect(existsSync(f)).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('is not trusted when others can read it, or its server is gone', () => {
    writeTokenFile(proj, { url: 'http://127.0.0.1:7417/', token: 'secret' });
    const f = tokenFilePath(proj);
    writeFileSync(f, JSON.stringify({ pid: process.pid, url: 'u', token: 't', dir: proj }), { mode: 0o644 });
    chmodSync(f, 0o644);
    expect(readTokenFile(proj)).toBeNull();
    chmodSync(f, 0o600);
    writeFileSync(f, JSON.stringify({ pid: 2 ** 22 + 99, url: 'u', token: 't', dir: proj }), { mode: 0o600 });
    expect(readTokenFile(proj)).toBeNull();
  });

  it('does not remove another server\'s file', () => {
    writeTokenFile(proj, { url: 'u', token: 't' });
    writeFileSync(tokenFilePath(proj), JSON.stringify({ pid: 1, url: 'u', token: 't', dir: proj }), { mode: 0o600 });
    removeTokenFile(proj);
    expect(existsSync(tokenFilePath(proj))).toBe(true);
  });
});
