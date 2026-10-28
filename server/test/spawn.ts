// A `pixelclaw serve` process on a temporary project, driven over MCP as an agent would, and
// WebSocket clients standing in for pages.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

export const REPO = join(import.meta.dirname, '..', '..');
export const BIN = join(REPO, 'cli', 'bin', 'pixelclaw.js');
export const PALETTE = join(REPO, 'examples', 'src', 'mossy-ruins.json');

export type Content = { type: string; text?: string; data?: string; mimeType?: string }[];

export const texts = (c: Content) => c.filter((x) => x.type === 'text').map((x) => x.text).join('\n');

export async function until(f: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

export interface Served {
  root: string;
  proj: string;
  url: string;
  client: Client;
  transport: StdioClientTransport;
  stderr(): string;
  call(name: string, args: Record<string, unknown>): Promise<{ content: Content; isError?: boolean }>;
  close(): Promise<void>;
}

export async function spawnServer(prefix: string): Promise<Served> {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const proj = join(root, 'ruins.pclaw');
  execFileSync(process.execPath, [BIN, 'new', proj, '--palette', PALETTE]);
  const transport = new StdioClientTransport({ command: process.execPath, args: [BIN, 'serve', '--project', proj, '--port', '0'], stderr: 'pipe' });
  let stderr = '';
  (transport.stderr as PassThrough).on('data', (d: Buffer) => { stderr += d.toString(); });
  const client = new Client({ name: 'pixelclaw-test', version: '1.0.0' });
  await client.connect(transport);
  await until(() => /watch at (\S+)/.test(stderr), 10000);
  return {
    root, proj, client, transport,
    url: /watch at (\S+)/.exec(stderr)![1]!,
    stderr: () => stderr,
    call: async (name, args) => (await client.callTool({ name, arguments: args })) as { content: Content; isError?: boolean },
    close: async () => {
      await client.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export interface Page {
  ws: WebSocket;
  messages: { type: string; [k: string]: unknown }[];
  /** Send commands as a person and wait for the answer to this message. */
  run(asset: string, commands: string, by: string): Promise<{ ok: boolean; group?: string; errors?: { message: string }[] }>;
}

/** A WebSocket client like the watch view: collects every message, and can send edits. */
export function openPage(u: string): Promise<Page> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(u);
    const messages: Page['messages'] = [];
    let id = 0;
    ws.onmessage = (ev) => messages.push(JSON.parse(String(ev.data)));
    ws.onopen = () => resolve({
      ws, messages,
      async run(asset, commands, by) {
        const my = ++id;
        ws.send(JSON.stringify({ type: 'run', id: my, asset, commands, by }));
        await until(() => messages.some((m) => m.type === 'result' && m.id === my));
        return messages.find((m) => m.type === 'result' && m.id === my) as never;
      },
    });
    ws.onerror = () => reject(new Error('websocket failed'));
  });
}

export const wsUrl = (url: string) => url.replace('http', 'ws').replace('/?token', '/ws?token');
