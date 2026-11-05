// G15 from the command line. Item 2: requests filed, answered and withdrawn from the CLI,
// validated as the dashboard's are, and a change writing the same `mark rejected` on the tape.
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

describe('requests from the CLI', () => {
  it('draw, change (with the mark rejected on the tape) and add (the manifest entry validated)', () => {
    let r = cli(['request', proj, 'draw', 'urn', '--note', 'squat, with a lip', '--by', 'human:ana']);
    expect(r).toMatchObject({ code: 0, out: 'r1 draw urn: "squat, with a lip" (from human:ana at 2026-10-29T12:00:00Z; open)\n' });
    r = cli(['request', proj, 'change', 'turf', '--note', 'more tufts', '--by', 'human:ana']);
    expect(r.code).toBe(0);
    const tape = readFileSync(join(proj, 'assets', 'turf', 'tape.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(tape.at(-1)).toMatchObject({ by: 'human:ana', cmd: 'mark rejected "more tufts"' });
    expect(records()[1]).toMatchObject({ type: 'request', id: 'r2', kind: 'change', asset: 'turf', note: 'more tufts', mark: tape.at(-1).seq });
    r = cli(['request', proj, 'add', 'crate', '--kind', 'sprite', '--size', '16x16', '--set', 'props', '--description', 'a slatted crate', '--height', '12']);
    expect(r).toMatchObject({ code: 0, out: expect.stringMatching(/^r3 new asset crate \(from claude at .*; open\)\n$/) });
    const m = JSON.parse(readFileSync(join(proj, 'manifest.json'), 'utf8'));
    expect(m.assets.at(-1)).toEqual({ name: 'crate', kind: 'sprite', size: '16x16', set: 'props', description: 'a slatted crate', height: 12 });
    // The list: what is still open.
    r = cli(['request', proj]);
    expect(r.out.trim().split('\n').map((l) => l.split(' ').slice(0, 3).join(' '))).toEqual(['r1 draw urn:', 'r2 change turf:', 'r3 new asset']);
  });

  it('validated like the dashboard: nothing is written when a request does not fit', () => {
    const before = readFileSync(join(proj, 'manifest.json'), 'utf8');
    for (const [args, msg] of [
      [['draw', 'well'], /'well' is not planned in manifest\.json/],
      [['draw', 'turf'], /'turf' is drawn already: ask for changes instead/],
      [['change', 'urn', '--note', 'x'], /'urn' is not drawn yet: ask for it to be drawn instead/],
      [['change', 'turf'], /say what should change/],
      [['add', 'crate', '--kind', 'sprite'], /the new entry has problems: .*size/],
      [['add', 'urn', '--kind', 'sprite', '--size', '16x16'], /'urn' is already in the manifest/],
      [['add', 'Crate!', '--kind', 'sprite', '--size', '16x16'], /the new entry has problems/],
    ] as [string[], RegExp][]) {
      const r = cli(['request', proj, ...args]);
      expect(r.code, args.join(' ')).toBe(1);
      expect(r.err).toMatch(msg);
    }
    expect(cli(['request', proj, 'paint', 'urn']).code).toBe(2);
    expect(cli(['request', proj, 'draw', 'urn', '--size', '8x8']).err).toMatch(/--size is for add/);
    expect(records()).toEqual([]);
    expect(readFileSync(join(proj, 'manifest.json'), 'utf8')).toBe(before);
    expect(readFileSync(join(proj, 'assets', 'turf', 'tape.jsonl'), 'utf8')).not.toMatch(/mark rejected/);
    // A second draw request for the same asset is refused too.
    expect(cli(['request', proj, 'draw', 'urn']).code).toBe(0);
    expect(cli(['request', proj, 'draw', 'urn']).err).toMatch(/r1 already asks for 'urn' \(open\)/);
  });

  it('reply opens a blocked request again; cancel withdraws one', () => {
    expect(cli(['request', proj, 'draw', 'urn']).code).toBe(0);
    expect(cli(['reply', proj, 'r1', 'stone']).err).toMatch(/r1 is open: only a blocked request takes a reply/);
    // The agent claims it and blocks it with a question.
    writeFileSync(join(proj, 'requests.jsonl'), readFileSync(join(proj, 'requests.jsonl'), 'utf8') +
      JSON.stringify({ type: 'claim', id: 'r1', by: 'claude', at: 'x' }) + '\n' + JSON.stringify({ type: 'blocked', id: 'r1', by: 'claude', at: 'x', text: 'Stone or clay?' }) + '\n');
    expect(cli(['request', proj]).out).toMatch(/r1 draw urn \(from claude at .*; blocked: "Stone or clay\?"\)/);
    let r = cli(['reply', proj, 'r1', 'Stone, grey.', '--by', 'human:ana']);
    expect(r).toMatchObject({ code: 0, out: expect.stringMatching(/; open\)\n$/) });
    expect(records().at(-1)).toMatchObject({ type: 'reply', id: 'r1', by: 'human:ana', text: 'Stone, grey.' });
    expect(cli(['reply', proj, 'r1']).code).toBe(1);
    r = cli(['cancel', proj, 'r1', 'not needed after all']);
    expect(r).toMatchObject({ code: 0, out: expect.stringMatching(/; cancelled\)\n$/) });
    expect(cli(['cancel', proj, 'r1']).err).toMatch(/r1 is cancelled: it is already finished/);
    expect(cli(['cancel', proj, 'r9']).err).toMatch(/no request r9/);
    expect(cli(['request', proj]).out).toBe('no open requests\n');
  });

  it('refused while a server owns the project', () => {
    writeFileSync(join(proj, '.pixelclaw.lock'), JSON.stringify({ pid: process.ppid, url: 'http://127.0.0.1:1/' }));
    const r = cli(['request', proj, 'draw', 'urn']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/owns .*MCP: run, export, import, request; or its dashboard/);
    expect(records()).toEqual([]);
  });
});

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
