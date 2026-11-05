// G4 on the server: checkpoint files every 200 commands (written as a tape grows, removed when it
// starts again, the fast way in when an asset is loaded, and checked by `pixelclaw verify`), and
// `palette save` writing a document's palette back to the project.

import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { serializeDoc, serializeDocV1 } from '@pixelclaw/core';
import { main, type Io } from '../../cli/src/index.ts';
import { Writer, createProject, loadProject, readPaletteFile, sha256, type Project } from '../src/index.ts';

const PALETTE = join(import.meta.dirname, '..', '..', 'examples', 'src', 'mossy-ruins.json');
let root: string;
let proj: Project;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pixelclaw-ckpt-'));
  proj = createProject(join(root, 'p.pclaw'), { palettes: [readPaletteFile(PALETTE)] });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function verify(): { code: number; out: string } {
  let out = '';
  const io: Io = { out: (s) => { out += s; }, err: (s) => { out += s; }, stdin: () => '', now: () => '2026-10-27T00:00:00Z' };
  return { code: main(['verify', proj.dir], io), out };
}

const lines = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `px ${(from + i) % 16},${Math.floor((from + i) / 16) % 16} c=${['moss1', 'moss2', 'stone3'][(from + i) % 3]}`).join('\n');
const ckpts = () => readdirSync(join(proj.dir, 'assets', 'grass', 'checkpoints')).sort();

describe('checkpoints', () => {
  it('are written every 200 commands, checked by verify, and used to load an asset', () => {
    const w = new Writer(proj);
    expect(w.run({ commands: 'new tile grass 16x16', by: 'claude' }).ok).toBe(true);
    for (let k = 0; k < 5; k++) w.run({ asset: 'grass', commands: lines(90, k * 90), by: 'claude' });
    expect(ckpts()).toEqual(['000200.gwc', '000400.gwc']);
    const asset = JSON.parse(readFileSync(join(proj.dir, 'assets', 'grass', 'asset.json'), 'utf8'));
    expect(asset.checkpoints).toEqual({ every: 200, files: ['000200.gwc', '000400.gwc'] });
    const head = readFileSync(join(proj.dir, 'assets', 'grass', 'checkpoints', '000400.gwc')).subarray(0, 80).toString('latin1').split('\n')[0];
    expect(head).toMatch(/^PCLAWCKPT 1 400 [0-9a-f]{64}$/);
    const v = verify();
    expect(v.out).toContain('2 checkpoints checked');
    expect(v.code).toBe(0);
    // A fresh writer loads from the newest checkpoint (with no state cache) and gets the same state.
    rmSync(join(proj.dir, '.cache'), { recursive: true, force: true });
    const fresh = new Writer(loadProject(proj.dir));
    expect(serializeDoc(fresh.doc('grass'))).toEqual(serializeDoc(w.doc('grass')));
    // An undo across a checkpoint still matches a replay.
    fresh.run({ asset: 'grass', commands: 'undo group=g2', by: 'claude' });
    expect(verify().code).toBe(0);
  });

  it('a damaged or stale checkpoint fails verify; starting the tape again removes them', () => {
    const w = new Writer(proj);
    w.run({ commands: 'new tile grass 16x16', by: 'claude' });
    w.run({ asset: 'grass', commands: lines(250), by: 'claude' });
    const f = join(proj.dir, 'assets', 'grass', 'checkpoints', '000200.gwc');
    const good = readFileSync(f);
    const bad = Buffer.from(good);
    bad[bad.length - 1] ^= 1;
    writeFileSync(f, bad);
    expect(verify().out).toContain('checkpoint 000200.gwc differs from the replay');
    writeFileSync(f, good);
    expect(verify().code).toBe(0);
    w.run({ commands: 'new tile grass 16x16', by: 'claude', replace: true });
    expect(ckpts()).toEqual([]);
    expect(verify().code).toBe(0);
  });

  it('verify accepts the state hash of an older asset.json (the first state format)', () => {
    const ex = join(root, 'ex.pclaw');
    cpSync(join(import.meta.dirname, '..', '..', 'examples', 'mossy-ruins.pclaw'), ex, { recursive: true });
    const aj = join(ex, 'assets', 'stone_floor', 'asset.json');
    const j = JSON.parse(readFileSync(aj, 'utf8'));
    proj = loadProject(ex);
    // The hash this tile had before G4 (PCLAWDOC 1) is still accepted; another one is not.
    j.state.sha256 = sha256(serializeDocV1(new Writer(proj).doc('stone_floor'))!);
    writeFileSync(aj, JSON.stringify(j));
    const v = verify();
    expect(v.out).toContain('asset.json has a hash in the older state format');
    expect(v.code).toBe(0);
    j.state.sha256 = '0'.repeat(64);
    writeFileSync(aj, JSON.stringify(j));
    expect(verify().out).toContain('differs from asset.json');
  });
});

describe('palette save', () => {
  it('writes the document\'s palette as a new project palette, and refuses to replace a different one', () => {
    const w = new Writer(proj);
    w.run({ commands: 'new sprite chest 8x8\npalette add gold hex=#d8a43a\nramp metal = stone2 stone4 gold\npalette save as=ruins-props', by: 'claude' });
    const file = join(proj.dir, 'palettes', 'ruins-props.json');
    expect(existsSync(file)).toBe(true);
    const saved = readPaletteFile(file);
    expect(saved.entries.at(-1)).toMatchObject({ name: 'gold', hex: '#d8a43a' });
    expect(saved.ramps.metal).toEqual(['stone2', 'stone4', 'gold']);
    expect(w.project.palettes.has('ruins-props')).toBe(true);
    // Saving the same palette again is fine; a different one under a taken name is refused, with nothing applied.
    expect(w.run({ asset: 'chest', commands: 'palette save as=ruins-props', by: 'claude' }).ok).toBe(true);
    const before = w.state('chest').entries.length;
    expect(() => w.run({ asset: 'chest', commands: 'palette set gold hex=#ffcc00\npalette save as=ruins-props', by: 'claude' })).toThrow(/already has a different palette 'ruins-props'/);
    expect(() => w.run({ asset: 'chest', commands: 'palette save as=mossy-ruins', by: 'claude' })).toThrow(/different palette 'mossy-ruins'/);
    expect(w.state('chest').entries.length).toBe(before);
    expect(verify().code).toBe(0);
  });
});
