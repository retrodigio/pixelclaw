// A server on a temporary project, driven over MCP like an agent would, for the browser tests.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type { Page } from '@playwright/test';
import { TRANSPARENT, flattenReference, importPalette, renderFlat, replay, type Doc, type TapeEntry, type Theme } from '../core/src/index.ts';

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

/** A server on a new project with the demo palette, or on a copy of an existing project folder. */
export async function startAgent(o: { copy?: string } = {}): Promise<Agent> {
  const root = mkdtempSync(join(tmpdir(), 'pixelclaw-e2e-'));
  const dir = join(root, 'ruins.pclaw');
  if (o.copy) cpSync(o.copy, dir, { recursive: true });
  else execFileSync(process.execPath, [BIN, 'new', dir, '--palette', PALETTE_FILE]);
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
export async function canvasPixels(page: Page): Promise<{ width: number; height: number; zoom: number; frame: number; data: number[] }> {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('[data-testid=canvas]')!;
    const z = Number(c.dataset.zoom);
    const frame = Number(c.dataset.frame ?? 0);
    const w = c.width / z;
    const h = c.height / z;
    const all = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const out: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = ((y * z + (z >> 1)) * c.width + x * z + (z >> 1)) * 4;
      out.push(all[o]!, all[o + 1]!, all[o + 2]!, all[o + 3]!);
    }
    return { width: w, height: h, zoom: z, frame, data: out };
  });
}

/**
 * Compare the canvas (the frame it shows) with the core's render: opaque pixels exactly,
 * transparent ones show the checkerboard (or, under a visible reference layer, its faded colour).
 */
export function mismatches(doc: Doc, got: { width: number; height: number; frame?: number; data: number[] }, theme?: Theme): string[] {
  const want = renderFlat(doc, got.frame ?? 0, theme).data;
  const ref = flattenReference(doc, got.frame ?? 0);
  const bad: string[] = [];
  if (got.width !== doc.width || got.height !== doc.height) return [`size ${got.width}x${got.height}, want ${doc.width}x${doc.height}`];
  for (let i = 0; i < doc.width * doc.height; i++) {
    const g = got.data.slice(i * 4, i * 4 + 4);
    const w = [...want.slice(i * 4, i * 4 + 4)];
    const underRef = !!ref && ref[i] !== TRANSPARENT;
    const ok = w[3] === 0 ? underRef || ((g[0] === 204 || g[0] === 238) && g[0] === g[1] && g[1] === g[2]) : g.join() === w.join();
    if (!ok) bad.push(`${i % doc.width},${Math.floor(i / doc.width)}: canvas ${g.join()} core ${w.join()}`);
  }
  return bad;
}

/** Scroll the (virtualised) tape until the row of command `seq` is in the page (a binary search), and return it. */
export async function tapeRow(page: Page, seq: number) {
  await page.getByTestId('tape').evaluate(async (el, want) => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    let lo = 0;
    let hi = el.scrollHeight;
    for (let i = 0; i < 60; i++) {
      const rows = [...el.querySelectorAll<HTMLElement>('.cmd-row')].map((r) => Number(r.dataset.seq));
      if (rows.includes(want) || rows.length === 0) return;
      if (want < Math.min(...rows)) hi = el.scrollTop;
      else lo = el.scrollTop;
      el.scrollTop = Math.floor((lo + hi) / 2);
      el.dispatchEvent(new Event('scroll'));
      await frame();
    }
  }, seq);
  return page.locator(`.cmd-row[data-seq="${seq}"]`);
}

/** The shown asset's tape as the page holds it. */
export function pageTape(page: Page): Promise<{ seq: number; by: string; group: string; cmd: string }[]> {
  return page.evaluate(() => {
    const s = (window as unknown as { pixelclaw: { current?: { tape: { seq: number; by: string; group: string; cmd: string }[] } } }).pixelclaw;
    return (s.current?.tape ?? []).map(({ seq, by, group, cmd }) => ({ seq, by, group, cmd }));
  });
}
