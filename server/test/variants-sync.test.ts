// Inheriting variants record only the base's pieces and detached cells, so a sync stays small; the
// variant's tape still replays alone.

import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { BAND_LAYER, layoutOf, replay, runBatch, serializeDoc } from '@pixelclaw/core';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Writer, createProject, paletteSource } from '../src/index.ts';
import { projectSummary } from '../src/mcp.ts';
import { PALETTE } from './spawn.ts';

const root = mkdtempSync(join(tmpdir(), 'pixelclaw-g14-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('inheriting variants record only the pieces and detached cells', () => {
  it('a sync on a 24 px blob47 sheet writes the pieces, not the whole band (tape size before and after)', () => {
    const p = createProject(join(root, 'v3.pclaw'), { palettes: [JSON.parse(readFileSync(PALETTE, 'utf8'))] });
    const w = new Writer(p, { now: () => '2026-10-29T09:00:00Z' });
    const T = 24;
    const ok = (r: ReturnType<Writer['run']>) => { if (!r.ok) throw new Error(r.errors.map((e) => e.message).join('; ')); return r; };
    ok(w.run({ commands: `new family shore ${T}x${T} scheme=blob47
rect @cell(inside) 0,0 ${T}x${T} c=soil2 fill
rect @cell(outside) 0,0 ${T}x${T} c=pool fill
family band 1:outside 1:stone5 2:soil1 jitter=2 seed=4`, by: 'claude' }));
    ok(w.run({ commands: `fork shore shore_b\nvariant of=shore band=inherit\nlayer ground\nrect @cell(inside) 0,0 ${T}x${T} c=soil1 fill`, by: 'claude' }));
    const tapeBytes = () => statSync(join(p.dir, 'assets', 'shore_b', 'tape.jsonl')).size;
    const before = tapeBytes();
    // A fix to the base: its band, a pixel by hand on a piece, and a variant detached and touched up.
    const fix = ok(w.run({ asset: 'shore', commands: `family band 1:outside 1:ink 2:soil1 radius=1 jitter=2 seed=4\nlayer band\npx @cell(o) 5,1 c=stone5\nfamily detach nes\npx @cell(nes) 3,3 c=ink`, by: 'claude' }));
    expect(fix.followed).toEqual(['shore_b']);
    const line = w.history({ asset: 'shore_b', last: 1 }).entries[0]!.cmd;
    expect(line).toMatch(/^family band from=shore 1:outside 1:ink 2:soil1 radius=1 inset=0 jitter=2 seed=4 detached=nes frames=1 cells=[a-z_,]+ <<\n/);
    const cells = /cells=(\S+)/.exec(line)![1]!.split(',');
    // The pieces and the detached variant (the textures have no band art).
    expect(cells).toContain("nes");
    expect(cells.length).toBeLessThanOrEqual(7);
    const after = tapeBytes() - before;
    // The older form held the whole band layer: every row of the sheet above the coverage map.
    const d = w.doc('shore');
    const g13Form = d.width * layoutOf(d.family!).mapRow * T;
    console.log(`a sync on a ${T} px blob47 sheet: the older line held ${g13Form} pixels (about ${Math.round(g13Form / 1024)} KB); the tape grew ${after} bytes (${cells.length} cells: ${cells.join(', ')})`);
    expect(after).toBeLessThan(g13Form / 4);
    expect(after).toBeLessThan(6000);
    // The variant's band is the base's, and its tape replays alone to the same document.
    const band = (n: string) => { const x = w.doc(n); return Array.from(x.cels[x.layers.findIndex((l) => l.name === BAND_LAYER)]![0]!); };
    expect(band('shore_b')).toEqual(band('shore'));
    expect(w.doc('shore_b').family!.detached).toEqual(["nes"]);
    const r = replay(w.state('shore_b').entries, paletteSource(p));
    expect(r.problems).toEqual([]);
    expect(serializeDoc(r.doc!)).toEqual(serializeDoc(w.doc('shore_b')));
  });

  it('the older form (the whole band layer in the line) still replays', () => {
    const p = createProject(join(root, 'v3b.pclaw'), { palettes: [JSON.parse(readFileSync(PALETTE, 'utf8'))] });
    const ps = paletteSource(p);
    const T = 8;
    const base = runBatch({ doc: null, entries: [] }, `new family lake ${T}x${T} scheme=path\nrect @cell(inside) 0,0 ${T}x${T} c=soil2 fill\nrect @cell(outside) 0,0 ${T}x${T} c=pool fill\nfamily band 1:outside 1:stone5`, { by: 't', palettes: ps });
    if (!base.ok) throw new Error('base');
    const b = base.state.doc!;
    const bl = b.layers.findIndex((l) => l.name === BAND_LAYER);
    const sheetH = layoutOf(b.family!).mapRow * T;
    const keys = b.palette.entries.map((e) => e.key);
    const rows = Array.from({ length: sheetH }, (_, y) => Array.from({ length: b.width }, (_, x) => { const v = b.cels[bl]![0]![y * b.width + x]!; return v === 0xffff ? '.' : keys[v]; }).join(''));
    const v = runBatch({ doc: null, entries: [] }, `new family lake_b ${T}x${T} scheme=path\nrect @cell(inside) 0,0 ${T}x${T} c=soil1 fill\nrect @cell(outside) 0,0 ${T}x${T} c=pool fill\nfamily band from=lake 1:outside 1:stone5 radius=0 inset=0 detached=none frames=1 <<\n${rows.map((r) => `  ${r}`).join('\n')}\n>>`, { by: 't', palettes: ps });
    if (!v.ok) throw new Error(v.errors.map((e) => e.message).join('; '));
    expect(Array.from(v.state.doc!.cels[bl]![0]!)).toEqual(Array.from(b.cels[bl]![0]!));
  });
});
