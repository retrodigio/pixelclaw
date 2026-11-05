// Texture variants with band=inherit follow every later fix to their base; their textures stay
// their own.

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





describe('variants inherit the band and override only the texture', () => {
  it('a band=inherit variant follows every later fix to its base; its textures stay its own', () => {
    const p = createProject(join(root, 'v8.pclaw'), { palettes: [JSON.parse(readFileSync(PALETTE, 'utf8'))] });
    const w = new Writer(p, { now: () => '2026-10-29T09:00:00Z' });
    const T = 12;
    const ok = (r: ReturnType<Writer['run']>) => { if (!r.ok) throw new Error(r.errors.map((e) => e.message).join('; ')); return r; };
    ok(w.run({ commands: `new family shore ${T}x${T} scheme=blob47
rect @cell(inside) 0,0 ${T}x${T} c=soil2 fill
rect @cell(outside) 0,0 ${T}x${T} c=pool fill
family band 1:outside 1:stone5 1:soil1`, by: 'claude' }));
    ok(w.run({ commands: `fork shore shore_b\nvariant of=shore band=inherit\nlayer ground\nrect @cell(inside) 0,0 ${T}x${T} c=soil1 fill`, by: 'claude' }));
    const band = (n: string) => { const d = w.doc(n); return Array.from(d.cels[d.layers.findIndex((l) => l.name === BAND_LAYER)]![0]!); };
    // The textures: the inside cell of the ground layer (the rest of it is laid out by the band).
    const ground = (n: string) => {
      const d = w.doc(n), [cx, cy] = layoutOf(d.family!).inside, cel = d.cels[d.layers.findIndex((l) => l.name === GROUND_LAYER)]![0]!;
      return Array.from({ length: T * T }, (_, i) => cel[(cy * T + Math.floor(i / T)) * d.width + cx * T + (i % T)]);
    };
    const before = ground('shore_b');
    // A fix to the base's band (wider, and a pixel by hand on a piece) reaches the variant.
    const fix = ok(w.run({ asset: 'shore', commands: `family band 1:outside 1:ink 2:soil1 radius=1\nlayer band\npx @cell(o) 5,1 c=stone5`, by: 'claude' }));
    expect(fix.followed).toEqual(['shore_b']);
    expect(band('shore_b')).toEqual(band('shore'));
    expect(w.doc('shore_b').family!.geometry).toEqual(w.doc('shore').family!.geometry);
    expect(ground('shore_b')).toEqual(before);
    expect(ground('shore_b')).not.toEqual(ground('shore'));
    const last = w.history({ asset: 'shore_b', last: 1 }).entries[0]!;
    expect(last.cmd).toMatch(/^family band from=shore 1:outside 1:ink 2:soil1 radius=1 inset=0 detached=none frames=1 cells=\S+ <<\n/);
    // The variant's tape replays alone (the band is in the line).
    const r = replay(w.state('shore_b').entries, _ps(p));
    expect(r.problems).toEqual([]);
    expect(serializeDoc(r.doc!)).toEqual(serializeDoc(w.doc('shore_b')));
    // A change that leaves the band alone writes nothing to the variant.
    expect(ok(w.run({ asset: 'shore', commands: `layer ground\nrect @cell(inside) 0,0 ${T}x${T} c=soil0 fill`, by: 'claude' })).followed).toBeUndefined();
    // The variant's own band edits are refused; band=own makes it its own again.
    const own = w.run({ asset: 'shore_b', commands: 'family band 1:outside 1:ink', by: 'claude' });
    expect(own.ok).toBe(false);
    expect(!own.ok && own.errors[0]!.message).toMatch(/inherits its band from 'shore'/);
    expect(w.run({ asset: 'shore_b', commands: 'layer band\npx @cell(o) 1,1 c=ink', by: 'claude' }).ok).toBe(false);
    ok(w.run({ asset: 'shore_b', commands: 'variant of=shore band=own\nfamily band 1:outside 1:ink', by: 'claude' }));
    expect(ok(w.run({ asset: 'shore', commands: 'family band 1:outside 1:stone5 1:soil1', by: 'claude' })).followed).toBeUndefined();
  });
});
