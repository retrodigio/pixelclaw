// Check results as text, for the MCP `check` tool and `pixelclaw check`.

import type { CheckResult, Pt } from '@pixelclaw/core';

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
  const out = [`${asset}${frame ? ` frame ${frame + 1}` : ''}: ${failing.length ? `${failing.length} of ${run.length} checks failing` : `all ${run.length} checks pass`}`];
  for (const r of results) {
    if (r.status === 'skip') { out.push(`  –  ${r.id.padEnd(11)} skipped: ${r.detail}`); continue; }
    out.push(`  ${r.status === 'pass' ? '✓' : '✗'}  ${r.id.padEnd(11)} ${r.shown.padEnd(6)} ${r.limit.padEnd(7)} ${r.detail}`);
    for (const p of r.parts ?? []) if (p.pass === false) out.push(`       ${p.name}: ${p.detail} (needs ${p.limit})`);
    if (r.status === 'fail') for (const g of r.groups) out.push(`       ${g.label}: ${formatPoints(g.pts)}`);
  }
  for (const p of problems) out.push(`  note: ${p}`);
  return out.join('\n');
}

