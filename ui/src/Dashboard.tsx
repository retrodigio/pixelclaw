// The dashboard (plan §7.3, §8.3): the manifest as a grid of thumbnails coloured by status and
// check results, by set, with what each asset needs next. A person approves reviewed work here or
// asks for changes; both are commands on the asset's tape (`mark approved`, `mark rejected
// "…"`), written with their name, so the agent reads them with `changes` and the status follows.
// Filters, and opening an asset in the editor, only change what is shown.

import { useEffect, useState } from 'react';
import { STATUSES, quote, type Status } from '@pixelclaw/core';
import type { PlanAsset, PlanReport } from '@pixelclaw/server/protocol';
import type { Store } from './store.ts';

const STATUS_TEXT: Record<Status, string> = {
  planned: 'not drawn yet', drafted: 'drawn; checks failing', checked: 'every check passes', reviewed: 'blind review done',
  approved: 'approved by a person', exported: 'exported to the game',
};

/** A preview at a whole-number scale that fits the box (so pixels stay square). */
function Thumb({ src, box }: { src: string; box: number }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const k = size ? Math.max(1, Math.floor(box / Math.max(size.w, size.h))) : 1;
  const fit = size && Math.max(size.w, size.h) > box ? box / Math.max(size.w, size.h) : k;
  return (
    <img src={src} alt="" draggable={false} onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
      style={size ? { width: Math.round(size.w * fit), height: Math.round(size.h * fit) } : { visibility: 'hidden' }} />
  );
}

function Card({ a, store }: { a: PlanAsset; store: Store }) {
  const [asking, setAsking] = useState(false);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const canApprove = a.exists && a.status === 'reviewed';
  const canReject = a.exists && (a.status === 'reviewed' || a.status === 'approved' || a.status === 'exported');
  const send = async (commands: string) => {
    setBusy(true);
    const r = await store.send(a.name, commands);
    setBusy(false);
    return r.ok;
  };
  const open = () => {
    if (!a.exists) return;
    store.select(a.name);
    store.setTab('editor');
  };
  return (
    <div className={`dash-card st-${a.status}${a.planned ? '' : ' unplanned'}`} data-testid={`card-${a.name}`} data-status={a.status}>
      <button className="thumb" onClick={open} disabled={!a.exists} title={a.exists ? `Open ${a.name} in the editor` : 'Not drawn yet'}>
        {a.exists ? <Thumb src={`/api/preview/${a.name}.png?token=${encodeURIComponent(store.token)}&v=${a.seq ?? 0}`} box={96} /> : <span className="planned-box">{a.size}</span>}
      </button>
      <div className="card-body">
        <div className="card-head">
          <b className="mono">{a.name}</b>
          <span className={`badge st-${a.status}`} title={STATUS_TEXT[a.status]} data-testid="status">{a.status}</span>
        </div>
        <div className="dim">{a.kind} {a.size}{a.notes ? ` · ${a.notes} note${a.notes === 1 ? '' : 's'}` : ''}</div>
        {a.description && <div className="desc">{a.description}</div>}
        {a.exists && (
          <div className="card-checks" title={a.checks.map((c) => `${c.id} ${c.shown} ${c.status === 'pass' ? '✓' : '✗'}`).join('\n')}>
            {a.failing.length ? a.failing.map((id) => <span key={id} className="chk fail">{id}</span>) : <span className="chk pass">{a.checks.length} checks ✓</span>}
          </div>
        )}
        {a.status !== 'exported' && <div className="next">→ {a.next}</div>}
        {a.status === 'exported' && a.exported && <div className="next dim">{a.exported.profile} → {a.exported.dir}</div>}
        {a.flags.map((f) => <div key={f} className="flag">{f}</div>)}
        {(canApprove || canReject) && !asking && (
          <div className="card-actions">
            {canApprove && <button className="approve" disabled={busy} onClick={() => void send('mark approved')} data-testid="approve" title="Approve this asset (mark approved, on its tape with your name)">✓ Approve</button>}
            {canReject && <button disabled={busy} onClick={() => setAsking(true)} data-testid="reject" title="Ask the agent for changes (mark rejected, with your reason)">Ask for changes…</button>}
          </div>
        )}
        {asking && (
          <form className="card-actions ask" onSubmit={(e) => { e.preventDefault(); if (why.trim()) void send(`mark rejected ${quote(why.trim())}`).then((ok) => { if (ok) { setAsking(false); setWhy(''); } }); }}>
            <input autoFocus value={why} onChange={(e) => setWhy(e.target.value)} placeholder="what should change?" aria-label="what should change"
              onKeyDown={(e) => { if (e.key === 'Escape') setAsking(false); }} data-testid="reject-text" />
            <button type="submit" disabled={!why.trim() || busy} data-testid="reject-send">Send</button>
            <button type="button" onClick={() => setAsking(false)}>Cancel</button>
          </form>
        )}
      </div>
    </div>
  );
}

export function Dashboard({ store }: { store: Store }) {
  const [plan, setPlan] = useState<PlanReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setFilter, setSetFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<Status | null>(null);
  const version = store.planVersion;
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      fetch(`/api/plan?token=${encodeURIComponent(store.token)}`)
        .then((r) => r.json() as Promise<PlanReport & { error?: string }>)
        .then((j) => { if (!alive) return; if (j.error) setError(j.error); else { setPlan(j); setError(null); } })
        .catch((e: unknown) => { if (alive) setError(String(e)); });
    }, plan ? 300 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [version, store.token]);
  if (!plan) return <div className="dashboard" data-testid="dashboard"><div className="dim pad">{error ?? 'Loading the plan…'}</div></div>;
  const planned = plan.assets.filter((a) => a.planned);
  const shown = (a: PlanAsset) => (setFilter === 'all' || a.set === setFilter) && (!statusFilter || a.status === statusFilter);
  return (
    <div className="dashboard" data-testid="dashboard">
      <div className="dash-top">
        <div className="dash-theme">
          <b>{plan.project}</b>
          {plan.theme ? <span className="dim"> · {plan.theme}</span> : <span className="dim"> · no manifest yet: the agent writes the plan (manifest.json) with its plan tool.</span>}
        </div>
        {plan.manifest.errors.length > 0 && (
          <div className="banner error" data-testid="manifest-errors">
            manifest.json has problems: {plan.manifest.errors.map((e) => `${e.path || '(top)'}: ${e.message}`).join(' · ')}
          </div>
        )}
        {planned.length > 0 && (
          <div className="dash-progress" title="Planned assets by status">
            {STATUSES.map((s) => plan.counts[s] > 0 && <span key={s} className={`seg-bar st-${s}`} style={{ flexGrow: plan.counts[s] }} />)}
          </div>
        )}
        <div className="dash-filters">
          <span className="dim">{planned.length} planned:</span>
          {STATUSES.map((s) => (
            <button key={s} className={`badge st-${s}${statusFilter === s ? ' on' : ''}`} onClick={() => setStatusFilter(statusFilter === s ? null : s)} data-testid={`filter-${s}`}
              title={`${STATUS_TEXT[s]}: show only these`}>
              {plan.counts[s]} {s}
            </button>
          ))}
          <span className="spacer" />
          <label className="dim">set <select value={setFilter} onChange={(e) => setSetFilter(e.target.value)} data-testid="set-filter">
            <option value="all">all</option>
            {plan.sets.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select></label>
        </div>
      </div>
      {plan.sets.filter((s) => setFilter === 'all' || s.name === setFilter).map((s) => {
        const cards = s.assets.map((n) => plan.assets.find((a) => a.name === n)!).filter(shown);
        if (!cards.length) return null;
        return (
          <section key={s.name} className="dash-set" data-testid={`set-${s.name}`}>
            <div className="panel-title">{s.name}{s.description && <span className="dim"> {s.description}</span>}<span className="dim"> · {cards.length}</span></div>
            <div className="dash-grid">
              {cards.map((a) => <Card key={a.name} a={a} store={store} />)}
            </div>
          </section>
        );
      })}
      {store.error && <div className="banner error" data-testid="error">{store.error}</div>}
    </div>
  );
}
