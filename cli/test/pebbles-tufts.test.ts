// The structure generators from the command line: they take the style guide's light and are
// ranked by `seeds`.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  tmp = mkdtempSync(join(tmpdir(), 'pixelclaw-g16-'));
  proj = join(tmp, 'p.pclaw');
  expect(cli(['new', proj, '--palette', PALETTE]).code).toBe(0);
  const pj = JSON.parse(readFileSync(join(proj, 'project.json'), 'utf8'));
  pj.style = { ...(pj.style ?? {}), light: 'ne' };
  writeFileSync(join(proj, 'project.json'), JSON.stringify(pj, null, 2));
  expect(cli(['new', proj, 'tile', 'shingle', '24x24', 'bg=soil1']).code).toBe(0);
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('pebbles and tufts from the CLI', () => {
  it('seeds ranks a pebbles line; the lines carry the style guide\'s light', () => {
    const r = cli(['seeds', proj, 'shingle', 'pebbles', 'ramp=stone', '--count', '4']);
    expect(r.err).toBe('');
    expect(r.out).toContain('shingle: 4 seeds ranked by the checks');
    const best = /best: (.*)/.exec(r.out)![1]!;
    expect(best).toMatch(/^pebbles 0,0 24x24 ramp=stone .* light=ne .* seed=\d$/);
    expect(cli(['seeds', proj, 'shingle', 'pebbles', 'ramp=stone', '--count', '4', '--apply']).out).toContain('shingle: applied 1 command as group');
    const t = cli(['seeds', proj, 'shingle', 'tufts', 'ramp=moss', '--count', '3']);
    expect(/best: (.*)/.exec(t.out)![1]).toMatch(/^tufts .* light=ne .*edges=\d seed=\d$/);
    expect(readFileSync(join(proj, 'assets', 'shingle', 'tape.jsonl'), 'utf8')).toContain(best.replace(/edges=\d seed=\d$/, ''));
  });
});
