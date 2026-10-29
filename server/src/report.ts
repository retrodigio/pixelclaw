// Check results as text, for the MCP `check` tool and `pixelclaw check`.

import type { CheckResult, Pt } from '@pixelclaw/core';
import type { SeedTrial } from './writer.ts';

const COORDS_SHOWN = 40;

/** Points as text, compressed: whole rows or columns of a band are named as such. */
export function formatPoints(pts: readonly Pt[], limit = COORDS_SHOWN): string {
  const shown = pts.slice(0, limit).map(([x, y]) => `${x},${y}`).join(' ');
  return pts.length > limit ? `${shown} … and ${pts.length - limit} more` : shown;
}

/** One asset's check table: each check's mark, score, threshold and finding; flagged pixels under it. */
export function formatChecks(asset: string, results: CheckResult[], problems: string[] = [], frame?: number): string {
  const run = results.filter((r) => r.status !== 'skip');
  const failing = run.filter((r) => r.status === 'fail');
  const out = [`${asset}${frame !== undefined ? ` frame ${frame + 1}` : ''}: ${failing.length ? `${failing.length} of ${run.length} checks failing` : `all ${run.length} checks pass`}`];
  for (const r of results) {
    if (r.status === 'skip') { out.push(`  –  ${r.id.padEnd(11)} skipped: ${r.detail}`); continue; }
    out.push(`  ${r.status === 'pass' ? '✓' : '✗'}  ${r.id.padEnd(11)} ${r.shown.padEnd(6)} ${r.limit.padEnd(7)} ${r.detail}`);
    for (const p of r.parts ?? []) if (p.pass === false) out.push(`       ${p.name}: ${p.detail} (needs ${p.limit})`);
    if (r.status === 'fail') for (const g of r.groups) out.push(`       ${g.label}: ${formatPoints(g.pts)}`);
  }
  for (const p of problems) out.push(`  note: ${p}`);
  return out.join('\n');
}

/** The ranked seeds as a table: seed, failing checks, and each check's score. */
export function formatSeeds(asset: string, trials: SeedTrial[]): string {
  if (!trials.length) return `${asset}: no seeds tried`;
  // The checks worth a column: any that fails somewhere, then the rest that have a score.
  const ids = [...new Set(trials.flatMap((t) => t.results.filter((r) => r.status !== 'skip' && r.score !== null).map((r) => r.id)))];
  const failingSomewhere = ids.filter((id) => trials.some((t) => t.failing.includes(id)));
  const cols = [...failingSomewhere, ...ids.filter((id) => !failingSomewhere.includes(id))].slice(0, 8);
  const limits = cols.map((id) => trials[0]!.results.find((r) => r.id === id)?.limit ?? '');
  const head = `${asset}: ${trials.length} seed${trials.length === 1 ? '' : 's'} ranked by the checks (fewest failing, then least over, then most room)`;
  const row = (cells: string[]) => cells.map((c, i) => c.padEnd(i === 0 ? 6 : Math.max(13, c.length + 2))).join('').trimEnd();
  const lines = [head, `limits: ${cols.map((id, i) => `${id} ${limits[i]}`).join(', ')} (a limit in brackets: that seed's own, e.g. repetition's raised by its spread)`];
  lines.push(row(['seed', ...cols, 'failing']));
  for (const t of trials) {
    lines.push(row([String(t.seed), ...cols.map((id, i) => {
      const r = t.results.find((x) => x.id === id);
      if (!r || r.status === 'skip') return '–';
      return `${r.shown}${r.limit !== limits[i] ? ` (${r.limit})` : ''} ${r.status === 'pass' ? '✓' : '✗'}`;
    }), t.failing.length ? t.failing.join(',') : 'none']));
  }
  lines.push(`best: ${trials[0]!.line}`);
  return lines.join('\n');
}
