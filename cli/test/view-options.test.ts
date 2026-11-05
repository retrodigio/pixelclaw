// CLI details: a closed pipe ends quietly, view regions and scales, and the orphans check's 2 px rule.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main, type Io } from '../src/index.ts';

const PALETTE = join(import.meta.dirname, '..', '..', 'examples', 'src', 'mossy-ruins.json');

function cli(args: string[]): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const io: Io = { out: (s) => { out += s; }, err: (s) => { err += s; }, stdin: () => '', now: () => '2026-10-29T12:00:00Z' };
  return { code: main(args, io), out, err };
}

const MANIFEST = {
  format: 'pixelclaw-manifest', version: 1, theme: 'Old stone under moss.',
  sets: { ground: { description: 'floors' }, props: { description: 'things that stand' } },
  assets: [
    { name: 'turf', kind: 'tile', size: '24x24', set: 'ground', description: 'short moss' },
    { name: 'urn', kind: 'sprite', size: '16x16', set: 'props', height: 12, description: 'a squat stone urn' },
  ],
};

let tmp: string;
let proj: string;
const records = () => existsSync(join(proj, 'requests.jsonl')) ? readFileSync(join(proj, 'requests.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pixelclaw-g15-'));
  proj = join(tmp, 'p.pclaw');
  expect(cli(['new', proj, '--palette', PALETTE]).code).toBe(0);
  writeFileSync(join(tmp, 'm.json'), JSON.stringify(MANIFEST));
  expect(cli(['plan', proj, '--manifest', join(tmp, 'm.json')]).code).toBe(0);
  expect(cli(['run', proj, '-e', 'new tile turf\nfill 0,0 c=moss1']).code).toBe(0);
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));


describe('the smaller items', () => {
  it('plan piped into a reader that stops early (EPIPE) ends quietly', async () => {
    const { spawn } = await import('node:child_process');
    const BIN = join(import.meta.dirname, '..', 'bin', 'pixelclaw.js');
    const r = await new Promise<{ code: number | null; err: string }>((resolve) => {
      const c = spawn(process.execPath, [BIN, 'plan', proj, '--json'], { stdio: ['ignore', 'pipe', 'pipe'] });
      c.stdout.destroy();
      let err = '';
      c.stderr.on('data', (d) => { err += d; });
      c.on('close', (code) => resolve({ code, err }));
    });
    expect(r).toEqual({ code: 0, err: '' });
  });

  it('view render takes a region and tile3x3 a scale, on tiles as on sprites; one region format everywhere', () => {
    const size = (args: string[]) => {
      const r = cli(['view', proj, ...args, '--out', join(tmp, 'v')]);
      expect(r.code, r.err).toBe(0);
      return /\((\d+x\d+)\)/.exec(r.out)![1];
    };
    const whole = size(['turf', 'render', '--scale', '2']);
    const part = size(['turf', 'render', '--scale', '2', '--region', '0,0,8x8']);
    expect(part).not.toBe(whole);
    expect(size(['turf', 'render', '--scale', '2', '--region', '0,0 8x8'])).toBe(part);
    expect(size(['turf', 'render', '--scale', '2', '--region', '0,0,8,8'])).toBe(part);
    expect(size(['turf', 'tile3x3', '--scale', '2'])).not.toBe(size(['turf', 'tile3x3']));
    // The rulers keep the canvas's coordinates: a region from 8,8 is labelled 8 and 16.
    expect(cli(['view', proj, 'turf', 'grid', '--region', '8,8 4x2']).out).toMatch(/^ +8/m);
    // import's region= takes the same forms; the line written is the same.
    expect(cli(['run', proj, '-e', 'new tile patch 8x8']).code).toBe(0);
    const lines = ['region=0,0,4x4', 'region="0,0 4x4"', 'region=0,0,4,4'].map((reg) => {
      const r = cli(['run', proj, '--asset', 'patch', '-e', `import 0,0 asset=turf ${reg}`]);
      expect(r.code, r.err).toBe(0);
      return readFileSync(join(proj, 'assets', 'patch', 'tape.jsonl'), 'utf8').trim().split('\n').at(-1)!.replace(/"seq":\d+,/, '').replace(/"group":"g\d+",/, '');
    });
    expect(new Set(lines).size).toBe(1);
  });

  it('the orphans check\'s 2 px rule is documented, and holds', () => {
    const doc = readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'checks.md'), 'utf8');
    expect(doc).toMatch(/\*\*The 2 px rule:\*\*/);
    // A 2x1 dash is fine; a diagonal pair is two strays; three on a diagonal is a line.
    const strays = (paint: string) => {
      expect(cli(['run', proj, '-e', `new sprite s 8x8\npaint 0,0 <<\n${paint}>>`, '--replace']).code).toBe(0);
      return cli(['check', proj, 's', '--checks', 'orphans']).out;
    };
    expect(strays('  ........\n  .kk.....\n  ........\n')).toMatch(/0 stray px/);
    expect(strays('  ........\n  .k......\n  ..k.....\n')).toMatch(/near-orphan \(a diagonal pair\)/);
    expect(strays('  ........\n  .k......\n  ..k.....\n  ...k....\n')).toMatch(/0 stray px/);
  });
});
