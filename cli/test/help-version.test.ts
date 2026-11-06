// `pixelclaw --version` and per-command help (`<command> --help`, `help <command>`), also for the
// commands the entry point handles itself (await, serve, judge, work).

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commandHelp } from '../src/main.ts';
import { main, type Io } from '../src/index.ts';

const BIN = join(import.meta.dirname, '..', 'bin', 'pixelclaw.js');
const COMMANDS = ['new', 'run', 'seeds', 'view', 'check', 'judge', 'review', 'plan', 'request', 'reply', 'cancel', 'work', 'skill', 'export', 'import', 'upgrade', 'verify', 'await', 'serve'];

function direct(args: string[]): { code: number; out: string; err: string } {
  let out = '', err = '';
  const io: Io = { out: (s) => { out += s; }, err: (s) => { err += s; }, stdin: () => '', now: () => '2026-11-06T10:00:00Z' };
  return { code: main(args, io), out, err };
}

describe('--version', () => {
  const version = (JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { version: string }).version;
  it('prints the package version', () => {
    expect(direct(['--version'])).toMatchObject({ code: 0, out: `pixelclaw ${version}\n` });
    expect(execFileSync(process.execPath, [BIN, '--version'], { encoding: 'utf8' })).toBe(`pixelclaw ${version}\n`);
    expect(execFileSync(process.execPath, [BIN, '-V'], { encoding: 'utf8' })).toBe(`pixelclaw ${version}\n`);
  });
});

describe('per-command help', () => {
  it('every command has a usage block, and --help prints it with exit 0 (also for await, serve, judge, work)', () => {
    for (const c of COMMANDS) {
      expect(commandHelp(c), c).toContain(`pixelclaw ${c} `);
      const r = spawnSync(process.execPath, [BIN, c, '--help'], { encoding: 'utf8' });
      expect(r.status, `${c}: ${r.stderr}`).toBe(0);
      expect(r.stdout).toContain(`pixelclaw ${c} `);
      // Only that command: not the whole manual.
      expect(r.stdout.length).toBeLessThan(commandHelp('import')!.length + 3000);
    }
  });
  it('shows only the asked command, and both forms of a command with several', () => {
    const h = direct(['await', '--help']).out;
    expect(h).toContain('pixelclaw await <project-folder | watch-url>');
    expect(h).not.toContain('pixelclaw view');
    expect(direct(['export', '-h']).out).toContain('--format split|png|strip|bmfont');
    expect(direct(['help', 'work']).out).toContain('work <project> start');
    expect(direct(['help', 'work']).out).toContain('claim');
  });
  it('an unknown command is a usage error', () => {
    expect(direct(['help', 'frobnicate']).code).toBe(2);
    expect(direct(['frobnicate', '--help']).code).toBe(2);
  });
  it('plain --help still prints everything', () => {
    expect(direct(['--help']).out).toContain('pixelclaw seeds');
  });
});
