// A server on a temporary project, driven over MCP like an agent would, for the browser tests.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type { Page } from '@playwright/test';
import { importPalette, renderFlat, replay, type Doc, type TapeEntry } from '../core/src/index.ts';

export const REPO = join(import.meta.dirname, '..');
const BIN = join(REPO, 'cli', 'bin', 'pixelclaw.js');
export const PALETTE_FILE = join(REPO, 'examples', 'src', 'mossy-ruins.json');

type Content = { type: string; text?: string; data?: string }[];

export interface Agent {
  dir: string;
  url: string;
  call(name: string, args: Record<string, unknown>): Promise<{ content: Content; isError?: boolean }>;
  close(): Promise<void>;
}

export async function startAgent(): Promise<Agent> {
  const root = mkdtempSync(join(tmpdir(), 'pixelclaw-e2e-'));
  const dir = join(root, 'ruins.pclaw');
  execFileSync(process.execPath, [BIN, 'new', dir, '--palette', PALETTE_FILE]);
  const transport = new StdioClientTransport({ command: process.execPath, args: [BIN, 'serve', '--project', dir, '--port', '0'], stderr: 'pipe' });
  let stderr = '';
  (transport.stderr as PassThrough).on('data', (d: Buffer) => { stderr += d.toString(); });
  const client = new Client({ name: 'pixelclaw-e2e', version: '1.0.0' });
  await client.connect(transport);
  const t0 = Date.now();
  while (!/watch at (\S+)/.test(stderr)) {
    if (Date.now() - t0 > 10_000) throw new Error(`no URL from the server: ${stderr}`);
    await new Promise((r) => setTimeout(r, 20));
  }
  return {
    dir,
    url: /watch at (\S+)/.exec(stderr)![1]!,
    call: async (name, args) => (await client.callTool({ name, arguments: args })) as { content: Content; isError?: boolean },
    close: async () => {
      await client.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** The asset's tape and document as the core replays it, read from the server. */
export async function serverDoc(url: string, asset: string, upTo?: number): Promise<{ doc: Doc; tape: TapeEntry[] }> {
  const state = (await (await fetch(url.replace('/?token', '/api/state?token'))).json()) as {
    palettes: { name: string }[]; assets: { name: string; entries: TapeEntry[] }[];
  };
  const palettes = new Map(state.palettes.map((p) => [p.name, importPalette(`${p.name}.json`, JSON.stringify(p))]));
  const tape = state.assets.find((a) => a.name === asset)!.entries;
  const r = replay(upTo === undefined ? tape : tape.filter((e) => e.seq <= upTo), { get: (n) => palettes.get(n) });
  if (!r.doc || r.problems.length) throw new Error('replay failed');
  return { doc: r.doc, tape };
}

/**
 * The canvas, read back one sample per document pixel (at the pixel's centre). Grid lines sit on
 * pixel edges, so the centres are the document's colours. Returns RGBA bytes, width*height*4.
 */
export async function canvasPixels(page: Page): Promise<{ width: number; height: number; zoom: number; data: number[] }> {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('[data-testid=canvas]')!;
    const z = Number(c.dataset.zoom);
    const w = c.width / z;
    const h = c.height / z;
    const all = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const out: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = ((y * z + (z >> 1)) * c.width + x * z + (z >> 1)) * 4;
      out.push(all[o]!, all[o + 1]!, all[o + 2]!, all[o + 3]!);
    }
    return { width: w, height: h, zoom: z, data: out };
  });
}

/** Compare the canvas with the core's render: opaque pixels exactly, transparent ones show the checkerboard. */
export function mismatches(doc: Doc, got: { width: number; height: number; data: number[] }): string[] {
  const want = renderFlat(doc).data;
  const bad: string[] = [];
  if (got.width !== doc.width || got.height !== doc.height) return [`size ${got.width}x${got.height}, want ${doc.width}x${doc.height}`];
  for (let i = 0; i < doc.width * doc.height; i++) {
    const g = got.data.slice(i * 4, i * 4 + 4);
    const w = [...want.slice(i * 4, i * 4 + 4)];
    const ok = w[3] === 0 ? (g[0] === 204 || g[0] === 238) && g[0] === g[1] && g[1] === g[2] : g.join() === w.join();
    if (!ok) bad.push(`${i % doc.width},${Math.floor(i / doc.width)}: canvas ${g.join()} core ${w.join()}`);
  }
  return bad;
}
