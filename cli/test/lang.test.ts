// Tape language 2 (plan §13): a tape carries its palette in its `new` line, so changing a project
// palette file no longer changes how it replays. Language 1 tapes (from G1-G4) still replay by
// reading the project palette, and a branch of one stays in language 1.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main, type Io } from '../src/index.ts';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'lang1.pclaw');

function cli(args: string[], stdin = ''): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const io: Io = { out: (s) => { out += s; }, err: (s) => { err += s; }, stdin: () => stdin, now: () => '2026-10-27T12:00:00Z' };
  return { code: main(args, io), out, err };
}

let tmp: string;
let proj: string;
const header = (asset: string) => readFileSync(join(proj, 'assets', asset, 'tape.jsonl'), 'utf8').split('\n')[0];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pixelclaw-lang-'));
  proj = join(tmp, 'p.pclaw');
  cpSync(FIXTURE, proj, { recursive: true });
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

/** Change one colour of the project's mossy-ruins palette file. */
function editPalette(): void {
  const f = join(proj, 'palettes', 'mossy-ruins.json');
  writeFileSync(f, readFileSync(f, 'utf8').replace('"#486a32"', '"#ff00ff"'));
}

describe('tape language', () => {
  it('language 1 tapes from G1-G4 still verify, and can be drawn on', () => {
    expect(header('grass')).toBe('{"pclaw":"tape","lang":1}');
    const v = cli(['verify', proj]);
    expect(v.out).toContain('ok   grass');
    expect(v.out).toContain('ok   stone_floor');
    expect(v.code).toBe(0);
    expect(cli(['run', proj, '-e', 'px 1,1 c=ink', '--asset', 'grass']).code).toBe(0);
    expect(header('grass')).toBe('{"pclaw":"tape","lang":1}');
    expect(cli(['verify', proj, 'grass']).code).toBe(0);
  });

  it('a language 1 tape reads the project palette; a language 2 tape keeps its own', () => {
    expect(cli(['run', proj, '-e', 'new tile fresh 8x8 bg=moss2']).code).toBe(0);
    expect(header('fresh')).toBe('{"pclaw":"tape","lang":2}');
    editPalette();
    const v = cli(['verify', proj]);
    // The old tape now replays to other colours than its recorded state; the new one is unchanged.
    expect(v.out).toMatch(/FAIL grass\b/);
    expect(v.out).toContain('ok   fresh');
  });

  it('a branch of a language 1 tape stays language 1', () => {
    const r = cli(['run', proj, '-e', 'fork grass grass_d at=4\npx 2,2 c=ink']);
    expect(r.err).toBe('');
    expect(header('grass_d')).toBe('{"pclaw":"tape","lang":1}');
    expect(cli(['verify', proj, 'grass_d']).code).toBe(0);
  });

  it('a header that does not match the tape is refused', () => {
    const f = join(proj, 'assets', 'grass', 'tape.jsonl');
    writeFileSync(f, readFileSync(f, 'utf8').replace('"lang":1', '"lang":2'));
    const v = cli(['verify', proj, 'grass']);
    expect(v.code).toBe(1);
    expect(v.out + v.err).toMatch(/header says language 2/);
  });
});
