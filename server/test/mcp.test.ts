// Plan §10 G2: spawn the server over stdio, run a batch, get an image back, read the history.
// Also: the watch view's token is required, and every connected page gets the same stream.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from '@modelcontextprotocol/client';
import type { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BIN, openPage, spawnServer, texts, until, type Content, type Served } from './spawn.ts';

let served: Served;
let proj: string;
let client: Client;
let transport: StdioClientTransport;
let url: string;

const call = (name: string, args: Record<string, unknown>): Promise<{ content: Content; isError?: boolean }> => served.call(name, args);
const watch = (u: string) => openPage(u);

beforeAll(async () => {
  served = await spawnServer('pixelclaw-mcp-');
  ({ proj, client, transport, url } = served);
}, 20000);

afterAll(async () => {
  await served?.close();
});

describe('MCP over stdio', () => {
  it('lists the tools and gives instructions', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['changes', 'check', 'export', 'history', 'project', 'review', 'run', 'view']);
    expect(client.getInstructions()).toContain('watch link');
  });

  it('project shows palettes, assets and the watch link', async () => {
    const r = await call('project', {});
    const t = texts(r.content);
    expect(t).toContain(`project 'ruins' at ${proj}`);
    expect(t).toContain(`watch live: ${url}`);
    expect(t).toContain('palette mossy-ruins (default): 16 colours');
    expect(t).toContain('3=stone3');
    expect(t).toContain('assets: none yet');
    expect(existsSync(join(proj, '.pixelclaw.lock'))).toBe(true);
  });

  it('run applies a batch as one group and returns the applied lines and an image', async () => {
    const r = await call('run', {
      asset: 'slab',
      commands: 'new tile slab 8x8 bg=stone1\nrect 1,1 6x6 c=3 fill\nline 1,1 6,1 c=stone4',
      view: 'render',
    });
    expect(r.isError).toBeFalsy();
    const t = texts(r.content);
    expect(t).toContain('slab: applied 3 commands as group g1; 64 px changed');
    expect(t).toContain('#2 claude g1  rect 1,1 6x6 c=stone3 fill');
    expect(t).toContain('warnings: none');
    const img = r.content.find((c) => c.type === 'image')!;
    expect(img.mimeType).toBe('image/png');
    const png = Buffer.from(img.data!, 'base64');
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(t).toContain(join(proj, 'views', 'slab.render.png'));
    expect(Buffer.compare(png, readFileSync(join(proj, 'views', 'slab.render.png')))).toBe(0);
  });

  it('a batch with errors reports line and column and applies nothing', async () => {
    const before = readFileSync(join(proj, 'assets', 'slab', 'tape.jsonl'), 'utf8');
    const r = await call('run', { asset: 'slab', commands: 'px 1,1 c=ink\npx 2,2 c=gold' });
    expect(r.isError).toBe(true);
    expect(texts(r.content)).toMatch(/^2:10: error: unknown colour 'gold'.*\n1 error; nothing was applied\.$/);
    expect(readFileSync(join(proj, 'assets', 'slab', 'tape.jsonl'), 'utf8')).toBe(before);
  });

  it('warns when a batch changes nothing, and refuses unknown assets', async () => {
    expect(texts((await call('run', { asset: 'slab', commands: 'px 0,0 c=stone1' })).content)).toContain('warnings: the batch changed no pixels');
    const r = await call('run', { asset: 'nope', commands: 'px 0,0 c=ink' });
    expect(r.isError).toBe(true);
    expect(texts(r.content)).toContain(`no asset 'nope'`);
  });

  it('view returns images inline with their file path, and the grid as text', async () => {
    const r = await call('view', { asset: 'slab', mode: 'tile3x3' });
    expect(r.content[0]!.type).toBe('image');
    expect(texts(r.content)).toContain(join(proj, 'views', 'slab.tile3x3.png'));
    const g = await call('view', { asset: 'slab', mode: 'grid', region: '0,0 4x2' });
    expect(g.content.every((c) => c.type === 'text')).toBe(true);
    expect(texts(g.content)).toContain(' 1  1444');
  });

  it('history reads the tape and marks undone groups', async () => {
    await call('run', { asset: 'slab', commands: 'px 4,4 c=ink' });
    await call('run', { asset: 'slab', commands: 'undo' });
    const t = texts((await call('history', { asset: 'slab' })).content);
    expect(t.split('\n')[0]).toBe('slab: 6 commands in 4 groups; undone: g3');
    expect(t).toContain('#5 claude g3  px 4,4 c=ink   (undone)');
    expect(t).toContain('#6 claude g4  undo group=g3');
    const part = texts((await call('history', { asset: 'slab', from: 2, to: 3 })).content);
    expect(part).toContain('showing 2 (#2..#3)');
  });

  it('the tape the server wrote verifies with the CLI', () => {
    expect(execFileSync(process.execPath, [BIN, 'verify', proj], { encoding: 'utf8' })).toContain('ok   slab');
  });

  it('the CLI refuses to write while the server owns the project', () => {
    let err = '';
    try {
      execFileSync(process.execPath, [BIN, 'run', proj, '--asset', 'slab', '-e', 'px 0,0 c=ink'], { encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      err = String((e as { stderr: string }).stderr);
    }
    expect(err).toContain('a pixelclaw server');
  });
});

describe('the watch view', () => {
  it('requires the token', async () => {
    const base = url.replace(/\/\?token=.*$/, '');
    const token = new URL(url).searchParams.get('token')!;
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect((await fetch(`${base}/api/state`)).status).toBe(401);
    expect((await fetch(`${base}/api/state?token=wrong`)).status).toBe(401);
    expect((await fetch(`${base}/`)).status).toBe(401);
    const ok = await fetch(`${base}/api/state?token=${token}`);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { assets: { name: string }[] }).assets[0]!.name).toBe('slab');
    await expect(watch(`${base.replace('http', 'ws')}/ws`)).rejects.toThrow();
    await expect(watch(`${base.replace('http', 'ws')}/ws?token=nope`)).rejects.toThrow();
  });

  it('sends every connected page the same stream', async () => {
    const wsUrl = url.replace('http', 'ws').replace('/?token', '/ws?token');
    const a = await watch(wsUrl);
    const b = await watch(wsUrl);
    await until(() => a.messages.length === 1 && b.messages.length === 1);
    await call('run', { asset: 'slab', commands: 'px 2,2 c=moss2 ; px 3,3 c=moss3' });
    await call('view', { asset: 'slab', mode: 'render' });
    await until(() => a.messages.length === 3 && b.messages.length === 3);
    expect(a.messages).toEqual(b.messages);
    const [hello, batch, eye] = a.messages as { type: string; [k: string]: unknown }[];
    expect(hello!.type).toBe('hello');
    expect(batch).toMatchObject({ type: 'batch', asset: 'slab', by: 'claude', group: 'g5', changed: 2, reset: false });
    expect((batch!.entries as { cmd: string }[]).map((e) => e.cmd)).toEqual(['px 2,2 c=moss2', 'px 3,3 c=moss3']);
    expect(eye).toMatchObject({ type: 'eye', eye: { asset: 'slab', mode: 'render' } });
    a.ws.close();
    b.ws.close();
  });

  it('stops, and releases the project, when the agent disconnects', async () => {
    const pid = transport.pid!;
    await client.close();
    await until(() => {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    }, 5000);
    expect(existsSync(join(proj, '.pixelclaw.lock'))).toBe(false);
  });
});
