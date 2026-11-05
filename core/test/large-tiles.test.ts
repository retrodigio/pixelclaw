// Checks, generators and views at 48 px: what scales with the cell size.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { composeMapDoc, mapWorld, parsePaletteJson, renderGame, runBatch, runChecks, type AssetState, type Doc, type PaletteSource } from '../src/index.ts';

const MOSSY = parsePaletteJson(readFileSync(join(import.meta.dirname, '..', '..', 'examples', 'src', 'mossy-ruins.json'), 'utf8'));
const pals: PaletteSource = { get: (n) => (n === MOSSY.name ? MOSSY : undefined), defaultName: MOSSY.name };
const EMPTY: AssetState = { doc: null, entries: [] };
function run(state: AssetState, text: string, docs: Record<string, Doc> = {}): AssetState {
  const r = runBatch(state, text, { by: 'test', palettes: pals, assets: (n) => docs[n] });
  if (!r.ok) throw new Error(r.errors.map((e) => `${e.line}:${e.col}: ${e.message}`).join('\n'));
  return r.state;
}
const world = (docs: Record<string, Doc>) => mapWorld(Object.entries(docs).map(([name, doc]) => ({ name, doc })));
const lattice = (map: Doc, docs: Record<string, Doc>) => runChecks(map, ['lattice'], { world: world(docs) })[0]!;

/** A stream-bed tile as examples/demo-g13 draws it: soil noise (by seed), optionally a pebble at x,y, scaled by s. */
function bed(name: string, seed: number, pebble: [number, number] | null, o: { s?: number; of?: string } = {}): Doc {
  const s = o.s ?? 1, T = 16 * s;
  const lines = [`new tile ${name} ${T}x${T} bg=soil1`, ...(o.of ? [`variant of=${o.of}`] : []),
    `noise 0,0 ${T}x${T} ramp=soil weights=1,6,3 cluster=1..${2 * s} density=0.25 base=soil1 wrap=on seed=${seed}`];
  if (pebble) {
    const [x, y] = pebble;
    lines.push(`rect ${x * s},${y * s} ${3 * s}x${2 * s} c=stone3 fill`, `rect ${x * s},${y * s} ${s}x${s} c=stone4 fill`, `rect ${(x + 2) * s},${(y + 1) * s} ${s}x${s} c=stone2 fill`);
  }
  return run(EMPTY, lines.join('\n')).doc!;
}



describe('the 48 px audit in core', () => {
  it('noise: specks scale with the cell when cluster= is left out (1..3 to 47 px, 2..6 at 48)', () => {
    const at = (t: number) => run(EMPTY, `new tile n ${t}x${t} bg=moss2\nnoise ramp=moss`).entries.at(-1)!.cmd;
    expect(at(24)).toMatch(/ cluster=1\.\.3 /);
    expect(at(16)).toMatch(/ cluster=1\.\.3 /);
    expect(at(48)).toMatch(/ cluster=2\.\.6 /);
  });

  it('repetition: at 48 px a band up to 12 lines wide is looked at as one', () => {
    // A faint 12-row band: a dark speck on every row, staggered, so it is even along its length.
    const lines = ['new tile b 48x48 bg=moss2'];
    for (let r = 0; r < 12; r++) for (let x = r % 4; x < 48; x += 4) lines.push(`px ${x},${18 + r} c=moss1`);
    const d = run(EMPTY, lines.join('\n')).doc!;
    const r = runChecks(d, ['repetition'])[0]!;
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/rows 18-29/);
  });

  it('repetition: band widths count in lines of a 24 px tile (a 2-line band at 48 px scores as a 1-line band at 24)', () => {
    const band = (t: number, rows: number) => runChecks(run(EMPTY, `new tile b ${t}x${t} bg=moss2\nrect 0,10 ${t}x${rows} c=moss1 fill`).doc!, ['repetition'])[0]!.score!;
    expect(band(48, 2)).toBeCloseTo(band(24, 1), 1);
  });

  it('jaggies: a texture\'s allowance is per 24x24 px of cell (8 at 48 px); a sprite\'s 2 at 48 px', () => {
    expect(runChecks(run(EMPTY, 'new tile a 24x24 bg=moss2').doc!, ['jaggies'])[0]!.limit).toBe('≤ 2');
    expect(runChecks(run(EMPTY, 'new tile a 48x48 bg=moss2').doc!, ['jaggies'])[0]!.limit).toBe('≤ 8');
    expect(runChecks(run(EMPTY, 'new sprite s 48x48\nrect 4,4 20x20 c=ink').doc!, ['jaggies'])[0]!.limit).toBe('≤ 2');
  });

  it('icon consistency: stroke and centre limits in px grow with the icon (set for 16 px)', () => {
    const icon = (n: string, w: number) => run(EMPTY, `new icon ${n} 48x48\nrect 6,6 36x36 c=ink fill\nrect ${6 + w},${6 + w} ${36 - 2 * w}x${36 - 2 * w} c=none fill`).doc!;
    const set = [{ name: 'a', doc: icon('a', 3) }, { name: 'c', doc: icon('c', 3) }];
    const r = runChecks(icon('b', 5), ['consistency'], { peers: set })[0]!;
    expect(r.parts!.find((x) => x.name === 'stroke weight')!.pass, r.detail).toBe(true);
    // At 16 px the same difference (2 px) is an outlier.
    const small = (n: string, w: number) => run(EMPTY, `new icon ${n} 16x16\nrect 1,1 14x14 c=ink fill\nrect ${1 + w},${1 + w} ${14 - 2 * w}x${14 - 2 * w} c=none fill`).doc!;
    const r16 = runChecks(small('b', 3), ['consistency'], { peers: [{ name: 'a', doc: small('a', 1) }, { name: 'c', doc: small('c', 1) }] })[0]!;
    expect(r16.parts!.find((x) => x.name === 'stroke weight')!.pass).toBe(false);
  });

  it('the game view at a draw scale of 1 shows the scene once', () => {
    const d = run(EMPTY, 'new object o 48x48\nellipse 8,8 32x32 c=stone2 fill').doc!;
    expect(renderGame([{ doc: d }], { scale: 1 }).height).toBe(8 + 48 + 16 + 8);
    expect(renderGame([{ doc: d }], { scale: 2 }).height).toBe(8 + 64 + 8 + 128 + 8);
  });
});
