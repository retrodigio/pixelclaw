// The project pipeline (plan §7.3): the manifest (manifest.json, written by the agent), each
// planned asset's status worked out from the project (its tape's marks, the checks, the record of
// its last export in exported.json), the defaults the manifest and style guide give `new`, and
// the flat templates drawn from the manifest (templates/). The dashboard and the MCP `plan` tool
// show the same report.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUILTIN_SCHEMES, FLAT_COLOURS, STATUSES, artHash, coverageTemplate, encodePng, loadScheme, mockupScreen, parseSize, rgbOf, setName, statusOf, validateManifest,
  cameraOf, type Doc, type Manifest, type ManifestAsset, type ManifestError, type ManifestKnown, type Scheme, type Status, type StyleDefaults,
} from '@pixelclaw/core';
import { projectProfiles, projectSchemes, readExported } from './io.ts';
import type { PlanAsset, PlanReport } from './protocol.ts';
export type { PlanAsset, PlanReport } from './protocol.ts';
import { ProjectError, type Project } from './project.ts';
import type { Writer } from './writer.ts';

export const MANIFEST_FILE = 'manifest.json';

/** What a manifest may name in this project. */
export function knownFor(p: Project): ManifestKnown {
  let profiles: string[] | undefined;
  try {
    profiles = [...projectProfiles(p).keys()];
  } catch {
    profiles = undefined;
  }
  return { palettes: [...p.palettes.keys()], schemes: [...BUILTIN_SCHEMES.keys(), ...projectSchemes(p.dir).keys()], profiles };
}

export interface ManifestRead {
  exists: boolean;
  manifest: Manifest | null;
  errors: ManifestError[];
}

/** The project's manifest, checked against its schema and the project. */
export function readManifest(p: Project): ManifestRead {
  const f = join(p.dir, MANIFEST_FILE);
  if (!existsSync(f)) return { exists: false, manifest: null, errors: [] };
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(f, 'utf8'));
  } catch (e) {
    return { exists: true, manifest: null, errors: [{ path: '', message: `manifest.json is not JSON: ${(e as Error).message}` }] };
  }
  return { exists: true, ...validateManifest(json, knownFor(p)) };
}

/** Write a manifest (only a valid one). */
export function writeManifest(p: Project, json: unknown): ManifestRead {
  const r = validateManifest(json, knownFor(p));
  if (!r.manifest) return { exists: existsSync(join(p.dir, MANIFEST_FILE)), ...r };
  writeFileSync(join(p.dir, MANIFEST_FILE), JSON.stringify(json, null, 2) + '\n');
  return { exists: true, ...r };
}

export function manifestEntry(m: Manifest | null, name: string): ManifestAsset | undefined {
  return m?.assets.find((a) => a.name === name);
}

/**
 * What `new` and the helpers take when an option is left out: the manifest's entry for the asset
 * (size, palette, scheme; an object's cell grid is the project's), else the style guide's size for
 * the kind; the style guide's light and outline colours.
 */
export function styleDefaults(p: Project, m: Manifest | null): StyleDefaults {
  const style = p.json.style ?? {};
  const grid = p.json.grid ?? 24;
  return {
    asset: (kind, name) => {
      const e = manifestEntry(m, name);
      const size = e && e.kind === kind ? parseSize(e.size) : (() => {
        const s = style.sizes?.[kind]?.split('|')[0];
        return s ? parseSize(s) : null;
      })();
      if (!size && !e) return undefined;
      const cell: [number, number] | undefined = kind === 'object' && size && size[0] % grid === 0 && size[1] % grid === 0 ? [grid, grid] : undefined;
      return {
        ...(size ? { size } : {}), ...(e?.palette ? { palette: e.palette } : {}), ...(e?.scheme && kind === 'family' ? { scheme: e.scheme } : {}), ...(cell ? { cell } : {}),
        ...(e?.chars && kind === 'font' ? { chars: e.chars } : {}),
      };
    },
    ...(style.light ? { light: style.light } : {}),
    ...(style.outline ? { outline: style.outline } : {}),
  };
}

// --- the report

/** Every planned asset's status (and the assets the manifest does not plan), optionally one set's. */
export function planReport(w: Writer, o: { set?: string } = {}): PlanReport {
  const p = w.project;
  const mr = readManifest(p);
  const m = mr.manifest;
  const exported = readExported(p);
  const existing = new Set(w.assets());
  const entries: (ManifestAsset & { planned: boolean })[] = [
    ...(m?.assets ?? []).map((a) => ({ ...a, planned: true })),
    ...[...existing].filter((n) => !manifestEntry(m, n)).map((n) => {
      let kind = 'sprite', size = '';
      try {
        const d = w.doc(n);
        kind = d.kind; size = `${d.width}x${d.height}`;
      } catch {
        // reported below as not loading
      }
      return { name: n, kind: kind as ManifestAsset['kind'], size, planned: false };
    }),
  ];
  const out: PlanAsset[] = [];
  for (const a of entries) {
    const set = a.planned ? setName(a) : 'unplanned';
    if (o.set && set !== o.set) continue;
    let doc: Doc | null = null, seq: number | null = null, failing: string[] = [], checks: PlanAsset['checks'] = [], pass: boolean | null = null;
    const flags: string[] = [];
    if (existing.has(a.name)) {
      try {
        const s = w.state(a.name);
        doc = s.doc;
        seq = s.entries.at(-1)?.seq ?? null;
        const r = w.checks(a.name).results;
        checks = r.filter((x) => x.status !== 'skip').map((x) => ({ id: x.id, status: x.status, shown: x.shown }));
        failing = r.filter((x) => x.status === 'fail').map((x) => x.id);
        pass = failing.length === 0;
      } catch (e) {
        flags.push(`does not load: ${(e as Error).message}`);
      }
    }
    const art = doc ? artHash(doc) : null;
    const ex = exported[a.name] ?? null;
    const st = statusOf({ exists: !!doc, checksPass: pass, marks: doc?.marks ?? [], art, exportedArt: ex?.art ?? null });
    if (doc && a.planned) {
      const want = parseSize(a.size);
      const have = doc.map ? [doc.width, doc.height] : doc.family ? [doc.family.tile, doc.family.tile] : [doc.width, doc.height];
      if (doc.kind !== a.kind) flags.push(`planned as a ${a.kind}, drawn as a ${doc.kind}`);
      if (want && (have[0] !== want[0] || have[1] !== want[1])) flags.push(`planned ${a.size}, drawn ${have[0]}x${have[1]}`);
    }
    if (doc?.notes.length) flags.push(`${doc.notes.length} open note${doc.notes.length === 1 ? '' : 's'}`);
    out.push({
      name: a.name, kind: a.kind, size: a.size, set, description: a.description ?? '', status: st.status, next: st.next, flags: [...flags, ...st.flags],
      planned: a.planned, exists: !!doc, failing, checks, notes: doc?.notes.length ?? 0, seq, exported: ex,
    });
  }
  const counts = Object.fromEntries(STATUSES.map((s) => [s, out.filter((x) => x.planned && x.status === s).length])) as Record<Status, number>;
  const setNames = [...new Set(out.map((x) => x.set))];
  return {
    project: p.json.name, theme: m?.theme ?? null, manifest: { exists: mr.exists, errors: mr.errors },
    sets: setNames.map((s) => ({ name: s, description: m?.sets?.[s]?.description ?? '', assets: out.filter((x) => x.set === s).map((x) => x.name) })),
    assets: out, counts,
  };
}

/** The report as text (the MCP `plan` tool and `pixelclaw plan`): what is left and what is failing. */
export function planText(r: PlanReport): string {
  const lines: string[] = [];
  if (!r.manifest.exists) {
    lines.push(`project '${r.project}' has no manifest.json yet. Write one (plan with manifest=…): format "pixelclaw-manifest", version 1, a theme paragraph, and the assets (name, kind, size, set, …; docs/pipeline.md).`);
  } else if (r.manifest.errors.length) {
    lines.push(`manifest.json has ${r.manifest.errors.length} problem${r.manifest.errors.length === 1 ? '' : 's'}:`, ...r.manifest.errors.map((e) => `  ${e.path || '(top)'}: ${e.message}`));
  }
  const planned = r.assets.filter((a) => a.planned);
  if (r.theme) lines.push(`${r.project}: ${r.theme}`);
  if (planned.length) {
    lines.push('', `${planned.length} planned: ${STATUSES.map((s) => `${r.counts[s]} ${s}`).join(' · ')}`);
  }
  for (const s of r.sets) {
    lines.push('', `${s.name}${s.description ? ` (${s.description})` : ''}:`);
    for (const n of s.assets) {
      const a = r.assets.find((x) => x.name === n)!;
      const why = [a.failing.length ? `failing: ${a.failing.join(', ')}` : '', ...a.flags].filter(Boolean).join('; ');
      lines.push(`  ${a.status.padEnd(8)} ${a.name} (${a.kind} ${a.size})${a.status !== 'exported' ? ` → ${a.next}` : a.exported ? ` → ${a.exported.profile} in ${a.exported.dir}` : ''}${why ? `  [${why}]` : ''}`);
    }
  }
  const left = planned.filter((a) => a.status !== 'exported').length;
  lines.push('', planned.length ? `${left} of ${planned.length} still to finish.` : 'nothing planned yet.');
  return lines.join('\n');
}

// --- flat templates (plan §7.3 step 3)

function flatColour(p: Project, a: ManifestAsset, i: number): [number, number, number] {
  const f = a.flat;
  if (f && /^#[0-9a-fA-F]{6}$/.test(f)) return rgbOf(f);
  if (f) {
    for (const pal of [a.palette ? p.palettes.get(a.palette) : undefined, p.json.defaultPalette ? p.palettes.get(p.json.defaultPalette) : undefined, ...p.palettes.values()]) {
      const e = pal?.entries.find((x) => x.name === f);
      if (e) return rgbOf(e.hex);
    }
  }
  return FLAT_COLOURS[i % FLAT_COLOURS.length]!;
}

function schemeFor(p: Project): (n: string) => Scheme | undefined {
  const own = projectSchemes(p.dir);
  return (n) => BUILTIN_SCHEMES.get(n) ?? (own.has(n) ? loadScheme(own.get(n)!) : undefined);
}

/** Write the flat templates under templates/: the mockup screen and a coverage map per planned family. */
export function writeTemplates(w: Writer, o: { seed?: number } = {}): { dir: string; files: string[] } {
  const p = w.project;
  const mr = readManifest(p);
  if (!mr.manifest) throw new ProjectError(mr.exists ? `manifest.json has problems: ${mr.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}` : 'no manifest.json: plan the assets first');
  const m = mr.manifest;
  const dir = join(p.dir, 'templates');
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  const save = (f: string, b: Uint8Array | string) => { writeFileSync(join(dir, f), b); files.push(f); };
  const grid = p.json.grid ?? 24;
  const [sw, sh] = cameraOf(p.json.style);
  const scheme = schemeFor(p);
  const index = new Map(m.assets.map((a, i) => [a.name, i]));
  const colour = (a: ManifestAsset) => flatColour(p, a, index.get(a.name) ?? 0);
  const mock = mockupScreen(m, { cols: Math.ceil(sw / grid), rows: Math.ceil(sh / grid), tile: grid, seed: o.seed ?? 1, scale: 2, colour, scheme });
  save('mockup.png', encodePng(mock.img));
  save('mockup@2x.png', encodePng(mock.labelled));
  save('mockup.txt', mock.text);
  for (const f of m.assets.filter((a) => a.kind === 'family')) {
    const s = scheme(f.scheme ?? '');
    if (!s) continue;
    const t = parseSize(f.size)?.[0] ?? grid;
    const byName = (n: string | undefined, dflt: [number, number, number]) => {
      const e = n ? m.assets.find((a) => a.name === n) : undefined;
      return e ? colour(e) : dflt;
    };
    const cov = coverageTemplate(s, { tile: t, band: f.band, seed: o.seed ?? 1, inside: byName(f.inside, colour(f)), outside: byName(f.outside, [70, 70, 76]) });
    if (!cov) continue;
    save(`${f.name}.coverage.png`, encodePng(cov.img));
    save(`${f.name}.coverage.txt`, cov.text);
  }
  return { dir, files };
}
