// G13 (plan §23) from the command line: `run --dry` and `seeds`, and an export refused while a
// server owns the project.
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

let tmp: string;
let proj: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pixelclaw-g13-'));
  proj = join(tmp, 'p.pclaw');
  expect(cli(['new', proj, '--palette', PALETTE]).code).toBe(0);
  expect(cli(['new', proj, 'tile', 'turf', '24x24', 'bg=moss2']).code).toBe(0);
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('run --dry and seeds', () => {
  it('a dry run prints the checks and keeps nothing', () => {
    const tape = readFileSync(join(proj, 'assets', 'turf', 'tape.jsonl'), 'utf8');
    const r = cli(['run', proj, '--asset', 'turf', '--dry', '-e', 'line 0,5 23,5 c=ink']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('turf: dry run of 1 command; 24 px would change; nothing was kept');
    expect(r.out).toMatch(/repetition [\d.]+ ✗/);
    expect(readFileSync(join(proj, 'assets', 'turf', 'tape.jsonl'), 'utf8')).toBe(tape);
  });

  it('seeds ranks a generator line and --apply runs the best', () => {
    const r = cli(['seeds', proj, 'turf', 'noise', 'ramp=moss', 'density=0.2', '--count', '4']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('turf: 4 seeds ranked by the checks');
    const best = /best: (.*)/.exec(r.out)![1]!;
    const a = cli(['seeds', proj, 'turf', 'noise', 'ramp=moss', 'density=0.2', '--count', '4', '--apply']);
    expect(a.out).toContain('turf: applied 1 command as group');
    expect(readFileSync(join(proj, 'assets', 'turf', 'tape.jsonl'), 'utf8')).toContain(best.replace(/^noise /, ''));
  });
});

describe('item 10: export while a server owns the project', () => {
  it('is refused, and nothing is written', () => {
    // A live process (this test's parent) holds the lock, as a running pixelclaw serve would.
    writeFileSync(join(proj, '.pixelclaw.lock'), JSON.stringify({ pid: process.ppid, url: 'http://127.0.0.1:7417/' }) + '\n');
    const r = cli(['export', proj, '--profile', 'png']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/a pixelclaw server \(pid \d+\) owns .*send commands through it \(MCP: run, export, import, request; or its dashboard\)/);
    expect(existsSync(join(proj, 'exports'))).toBe(false);
    const f = cli(['export', proj, 'turf', '--format', 'png']);
    expect(f.code).toBe(1);
    rmSync(join(proj, '.pixelclaw.lock'));
    expect(cli(['export', proj, '--profile', 'png']).code).toBe(0);
  });
});
