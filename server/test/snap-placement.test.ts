// Snap on the placement grid, and a warning when a cut family does not join.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { BAND_LAYER, GROUND_LAYER, layoutOf, createRgba, encodePng, replay, serializeDoc } from '@pixelclaw/core';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { serve, type Served } from '../src/serve.ts';
import { ProjectError, Writer, createProject, loadProject, paletteSource as _ps, readCostLog, scrub, type FetchLike } from '../src/index.ts';
import { BIN, PALETTE, type Content } from './spawn.ts';

const texts = (c: Content) => c.filter((x) => x.type === 'text').map((x) => x.text).join('\n');

let root: string;
let dir: string;
let s: Served;
let mcp: Client;
const call = async (name: string, args: Record<string, unknown> = {}) => (await mcp.callTool({ name, arguments: args })) as { content: Content; isError?: boolean };

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'pixelclaw-g13-'));
  dir = join(root, 'ruins.pclaw');
  execFileSync(process.execPath, [BIN, 'new', dir, '--palette', PALETTE]);
  s = await serve({ project: dir, port: 0, mcp: false, log: () => undefined });
  mcp = new Client({ name: 'g13-test', version: '1.0.0' });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${s.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${s.token}` } } }));
  const r = await call('run', { asset: 'turf', commands: 'new tile turf 24x24 bg=moss2' });
  expect(r.isError).toBeFalsy();
});

afterAll(async () => {
  await mcp.close();
  await s.close();
  rmSync(root, { recursive: true, force: true });
});




describe('snap on the placement grid; a high seam after family cut', () => {
  it('snap keeps one block per placed pixel even when the image has a stronger nearby period', () => {
    const p = createProject(join(root, 's4.pclaw'), { palettes: [JSON.parse(readFileSync(PALETTE, 'utf8'))] });
    const w = new Writer(p, { now: () => '2026-10-29T09:00:00Z' });
    expect(w.run({ commands: 'new sheet yard 24x16', by: 'claude' }).ok).toBe(true);
    // 240x160 for a 24x16 placement (10 px a pixel), but painted in stripes 11 px wide: a free
    // fit takes the stripes' period and makes a draft of the wrong size.
    const img = createRgba(240, 160);
    for (let y = 0; y < 160; y++) for (let x = 0; x < 240; x++) {
      const c = Math.floor(x / 11) % 2 ? [0x48, 0x6a, 0x32] : [0x6c, 0x75, 0x70];
      img.data.set([...c, 255], (y * 240 + x) * 4);
    }
    writeFileSync(join(p.dir, 'stripes.png'), encodePng(img));
    const imp = w.run({ asset: 'yard', commands: 'underlay import stripes.png', by: 'claude' });
    expect(imp.ok).toBe(false); // underlay import is resolved by runAsync
    return w.runAsync({ asset: 'yard', commands: 'underlay import stripes.png', by: 'claude' }).then((u) => {
      expect(u.ok).toBe(true);
      const free = w.dry({ asset: 'yard', commands: 'snap fit=free', by: 'claude' });
      expect(free.ok && free.added[0]!.cmd).not.toMatch(/ grid=24x16 /);
      const r = w.run({ asset: 'yard', commands: 'snap', by: 'claude' });
      expect(r.ok && r.added[0]!.cmd).toMatch(/^snap from=underlay into=draft at=0,0 grid=24x16 pitch=10\.000x10\.000 /);
    });
  });

  it('warns when the cut family does not join', () => {
    const p = createProject(join(root, 'c4.pclaw'), { palettes: [JSON.parse(readFileSync(PALETTE, 'utf8'))] });
    const w = new Writer(p, { now: () => '2026-10-29T09:00:00Z' });
    const T = 12;
    const base = `new family f ${T}x${T} scheme=blob47 map=14x12
rect @cell(inside) 0,0 ${T}x${T} c=moss2 fill
rect @cell(outside) 0,0 ${T}x${T} c=soil1 fill
family band 1:outside 1:ink 1:moss1 draw=off
family coverage seed=7 copies=1 fill=on`;
    expect(w.run({ commands: base, by: 'claude' }).ok).toBe(true);
    const clean = w.dry({ asset: 'f', commands: 'family cut textures=on', by: 'claude' });
    expect(clean.ok && clean.warnings.join(' ')).not.toContain('family cut:');
    // A map painted with a dark line along every cell's top: the cut tiles carry it, a seam.
    const top = w.doc('f').height - 12 * T; // the coverage map is under the sheet
    const lines = Array.from({ length: 12 }, (_, j) => `line 0,${top + j * T} ${14 * T - 1},${top + j * T} c=ink`).join('\n');
    const r = w.run({ asset: 'f', commands: `layer ground\n${lines}\nfamily cut textures=on`, by: 'claude' });
    expect(r.ok && r.warnings.join(' ')).toMatch(/family cut: the cut family's seam is [\d.]+ \(limit ≤ 1\)/);
  });
});
