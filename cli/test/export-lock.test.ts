// An export from the CLI is refused while a server owns the project.
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


describe('export while a server owns the project', () => {
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
