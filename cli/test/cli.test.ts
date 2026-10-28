import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { main, type Io } from '../src/index.ts';

function cli(args: string[], stdin = ''): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const io: Io = { out: (s) => { out += s; }, err: (s) => { err += s; }, stdin: () => stdin, now: () => '2026-10-27T12:00:00Z' };
  const code = main(args, io);
  return { code, out, err };
}

let root: string;
let proj: string;
const read = (...p: string[]) => readFileSync(join(proj, ...p), 'utf8');

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'pixelclaw-cli-'));
  proj = join(root, 'demo.pclaw');
  writeFileSync(join(root, 'dusk.gpl'), 'GIMP Palette\nName: Dusk Moss\n# comment\n 20  22  28\tInk\n 63 107  58\tMoss\n127 174  76\tLeaf\n156 199 230\tSky\n');
  writeFileSync(join(root, 'extra.hex'), '000000\nffffff\n');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('pixelclaw CLI', () => {
  it('new <project> creates the §7.1 layout with imported palettes', () => {
    const r = cli(['new', proj, '--palette', join(root, 'dusk.gpl'), '--palette', join(root, 'extra.hex')]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`palette dusk-moss: 4 entries (default)`);
    const pj = JSON.parse(read('project.json'));
    expect(pj).toMatchObject({ format: 'pixelclaw-project', version: 1, name: 'demo', defaultPalette: 'dusk-moss', tickRate: 60 });
    expect(readdirSync(join(proj, 'palettes')).sort()).toEqual(['dusk-moss.json', 'extra.json']);
    expect(JSON.parse(read('palettes', 'dusk-moss.json')).entries[0]).toEqual({ key: '0', name: 'ink', hex: '#14161c' });
    expect(cli(['new', proj]).code).toBe(1);
  });

  it('new <project> <kind> <name> <size> creates an asset with tape, asset.json, preview and checkpoints/', () => {
    const r = cli(['new', proj, 'tile', 'floor', '8x8', 'bg=moss']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('floor: applied 1 command as group g1');
    for (const f of ['asset.json', 'tape.jsonl', 'preview.png', 'checkpoints']) expect(existsSync(join(proj, 'assets', 'floor', f))).toBe(true);
    const tape = read('assets', 'floor', 'tape.jsonl').split('\n');
    expect(tape[0]).toBe('{"pclaw":"tape","lang":2}');
    const first = JSON.parse(tape[1]!);
    expect(first).toMatchObject({ seq: 1, by: 'claude', at: '2026-10-27T12:00:00Z', group: 'g1' });
    // Language 2: the palette is written into the new line.
    expect(first.cmd).toMatch(/^new tile floor 8x8 palette=dusk-moss wrap=on cell=8x8 bg=moss <<\n {2}\S \S+ #[0-9a-f]{6}\n[^]*>>$/);
    const aj = JSON.parse(read('assets', 'floor', 'asset.json'));
    expect(aj).toMatchObject({ name: 'floor', kind: 'tile', size: [8, 8], wrap: true, palette: 'dusk-moss', frames: 1, tape: { commands: 1, groups: 1 } });
    expect(aj.state.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('run applies a script as one group', () => {
    const script = join(root, 'a.pclaw');
    writeFileSync(script, '# border and a dot\nrect 0,0 8x8 c=ink\npx 3,3 c=leaf ; px 4,4 c=sky\n');
    const r = cli(['run', proj, script, '--asset', 'floor', '--by', 'human:test']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('floor: applied 3 commands as group h1; 30 px changed');
    const lines = read('assets', 'floor', 'tape.jsonl').trim().split('\n');
    expect(lines.length).toBe(5);
    expect(JSON.parse(lines[2]!)).toEqual({ seq: 2, by: 'human:test', at: '2026-10-27T12:00:00Z', group: 'h1', cmd: 'rect 0,0 8x8 c=ink outline' });
  });

  it('run with errors prints file:line:col and applies nothing', () => {
    const before = read('assets', 'floor', 'tape.jsonl');
    const png = read('assets', 'floor', 'preview.png');
    const script = join(root, 'bad.pclaw');
    writeFileSync(script, 'px 1,1 c=ink\npx 2,2 c=gold\nline 0,0 c=ink\n');
    const r = cli(['run', proj, script, '--asset', 'floor']);
    expect(r.code).toBe(1);
    expect(r.err).toBe(
      `${script}:2:10: error: unknown colour 'gold' (palette 'dusk-moss': ink, moss, leaf, sky, none)\n` +
      `${script}:3:10: error: line: expected an end point x,y\n2 errors; nothing was applied.\n`,
    );
    expect(read('assets', 'floor', 'tape.jsonl')).toBe(before);
    expect(read('assets', 'floor', 'preview.png')).toBe(png);
  });

  it('run -e and stdin work, and undo takes back a group', () => {
    expect(cli(['run', proj, '--asset', 'floor', '-e', 'fill 1,1 c=sky']).code).toBe(0);
    expect(cli(['run', proj, '-', '--asset', 'floor'], 'undo\n').out).toContain('applied 1 command as group g3');
    expect(read('assets', 'floor', 'tape.jsonl').trim().split('\n').at(-1)).toContain('"cmd":"undo group=g2"');
  });

  it('run refuses to restart an existing asset without --replace', () => {
    const script = join(root, 'fresh.pclaw');
    writeFileSync(script, 'new tile floor 8x8\npx 0,0 c=ink\n');
    expect(cli(['run', proj, script]).err).toContain(`asset 'floor' already exists; use --replace`);
    const r = cli(['run', proj, script, '--replace']);
    expect(r.code).toBe(0);
    expect(read('assets', 'floor', 'tape.jsonl').trim().split('\n').length).toBe(3);
    expect(cli(['run', proj, '-e', 'px 0,0 c=ink']).err).toContain('--asset');
  });

  it('view writes render, grid and tile3x3, and prints the grid', () => {
    const r = cli(['view', proj, 'floor', 'all', '--scale', '4']);
    expect(r.code).toBe(0);
    expect(r.out).toContain(' 0  0.......');
    for (const f of ['floor.render.png', 'floor.grid.txt', 'floor.tile3x3.png']) expect(existsSync(join(proj, 'views', f))).toBe(true);
    const reg = cli(['view', proj, 'floor', 'grid', '--region', '0,0,3x2']);
    expect(reg.out.split('\n').slice(0, 4)).toEqual(['    0', '    012', ' 0  0..', ' 1  ...']);
    expect(cli(['view', proj, 'floor', 'nope']).code).toBe(2);
  });

  it('verify replays every tape and catches tampering', () => {
    expect(cli(['run', proj, '-e', 'new sprite hero 4x4\npx 1,1 c=leaf']).code).toBe(0);
    const ok = cli(['verify', proj]);
    expect(ok.code).toBe(0);
    expect(ok.out).toMatch(/ok {3}floor: 2 commands, 1 groups, state [0-9a-f]{12}, no checkpoints/);
    expect(ok.out).toContain('ok   hero');
    const tape = join(proj, 'assets', 'hero', 'tape.jsonl');
    const good = readFileSync(tape, 'utf8');
    writeFileSync(tape, good.replace('px 1,1 c=leaf', 'px 1,1 c=sky'));
    const bad = cli(['verify', proj, 'hero']);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('differs from asset.json');
    expect(bad.out).toContain('preview.png differs');
    writeFileSync(tape, good.replace('px 1,1 c=leaf', 'px 1,1 c=2'));
    expect(cli(['verify', proj, 'hero']).out).toContain(`tape seq 2: not in normal form: expected 'px 1,1 c=leaf'`);
    writeFileSync(tape, good);
    expect(cli(['verify', proj]).code).toBe(0);
  });

  it('prints usage, and the bin script runs under plain node', () => {
    expect(cli(['help']).out).toContain('pixelclaw run <project>');
    expect(cli(['frob']).code).toBe(2);
    const out = execFileSync(process.execPath, [join(import.meta.dirname, '..', 'bin', 'pixelclaw.js'), 'verify', proj], { encoding: 'utf8' });
    expect(out).toContain('2 assets verified');
  });
});
