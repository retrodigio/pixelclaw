// The dashboard: the manifest as a grid of thumbnails coloured by status and
// check results, by set, with what each asset needs next. A person approves reviewed work here,
// and asks the agent for work: "Draw this" on a planned card, "Ask for changes" on any drawn one
// (also a `mark rejected "…"` on its tape), "Add an asset" (a manifest entry). Requests
// are records in requests.jsonl; each card shows its request's state live, "Claude is working on
// this" while the claimer's batches arrive. Scenes show what they still need; the worker panel
// starts Claude headless when the project allows it. Filters and opening only change what is shown.

import { useEffect, useMemo, useRef, useState } from 'react';
import { DOC_KINDS, STATUSES, type Status, type WorkRequest } from '@pixelclaw/core';
import type { PlanAsset, PlanReport } from '@pixelclaw/server/protocol';
import type { Store } from './store.ts';
import { ImportButton, ImportDrop } from './Import.tsx';
import { ListenerChip, NoListener, unattended, useNow } from './Listening.tsx';

export const STATUS_TEXT: Record<Status, string> = {
  planned: 'not drawn yet', drafted: 'drawn; checks failing', checked: 'every check passes', reviewed: 'blind review done',
  approved: 'approved by a person', exported: 'exported to the game',
};

/** The plan report, fetched again (debounced) when it may have changed. */
export function usePlan(store: Store): { plan: PlanReport | null; error: string | null } {
  const [plan, setPlan] = useState<PlanReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const version = store.planVersion;
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      fetch(`/api/plan?token=${encodeURIComponent(store.token)}`)
        .then((r) => r.json() as Promise<PlanReport & { error?: string }>)
        .then((j) => {
          if (!alive) return;
          if (j.error) setError(j.error);
          else { setPlan(j); setError(null); store.requests = j.requests; store.changed(); }
        })
        .catch((e: unknown) => { if (alive) setError(String(e)); });
    }, plan ? 300 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [version, store.token]);
  return { plan, error };
}

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

const ACTIVE = ['open', 'claimed', 'blocked'];
const KIND_WORD: Record<WorkRequest['kind'], string> = { draw: 'Claude to draw it', change: 'for changes', new: 'for this new asset' };

/** A request's state on its card: open, Claude working, blocked with the question and a reply box, done. */
function RequestLine({ q, store }: { q: WorkRequest; store: Store }) {
  const now = useNow();
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const last = store.lastWrite(q.asset);
  const claimedAt = q.events.filter((e) => e.type === 'claim').at(-1)?.at ?? '';
  const working = q.state === 'claimed' && !!last && last.by === q.claimedBy && last.at >= claimedAt;
  const who = (by: string | null) => (by ?? '').replace(/^human:/, '') || 'someone';
  const send = async (body: Parameters<Store['request']>[0]) => {
    setBusy(true);
    const r = await store.request(body);
    setBusy(false);
    if (!r.ok) store.error = r.error ?? 'refused';
    else store.error = null;
    store.changed();
    return r.ok;
  };
  const seen = q.seen ?? [];
  const nobody = unattended(store, q, now);
  // sent → seen by <agent> → working → done (blocked and withdrawn as they are)
  const stage = q.state === 'open' ? (seen.length ? 'seen' : 'sent') : q.state === 'claimed' ? 'working' : q.state;
  return (
    <div className={`req req-${q.state}${working ? ' working' : ''}${nobody ? ' unattended' : ''}`} data-testid={`request-${q.id}`} data-state={q.state} data-stage={stage} title={`${q.id}: ${q.kind} asked by ${q.by} at ${q.at}`}>
      <div className="req-head">
        <span className="req-id mono">{q.id}</span>
        {q.state === 'open' && <span>
          <b data-testid="stage">{seen.length ? `seen by ${seen.map((x) => x.by).join(', ')}` : 'sent'}</b>
          {' · '}{who(q.by)} asked {KIND_WORD[q.kind]}{q.note ? <>: <i>“{q.note}”</i></> : ''}{q.events.some((e) => e.type === 'reply') ? ' (answered; waiting for an agent)' : ''}
        </span>}
        {q.state === 'claimed' && (working
          ? <span className="claude-working" data-testid="working"><span className="pulse" />Claude is working on this{q.latest ? <>: <i>{q.latest}</i></> : ''}</span>
          : <span>claimed by {q.claimedBy}{q.latest ? <>: <i>{q.latest}</i></> : ''}</span>)}
        {q.state === 'blocked' && <span>Claude asks: <b>“{q.question}”</b></span>}
        {q.state === 'done' && <span>✓ done: {q.latest}</span>}
        {q.state === 'cancelled' && <span className="dim">withdrawn</span>}
      </div>
      {nobody && <NoListener store={store} why={store.presence?.listening ? 'Nobody has picked this up for a couple of minutes. It is only a note in the project until an agent takes it.' : 'No agent is listening. Nobody has this request yet; it waits in the project until an agent is started.'} />}
      {q.state === 'blocked' && (
        <form className="card-actions ask" onSubmit={(e) => { e.preventDefault(); if (reply.trim()) void send({ action: 'reply', id: q.id, text: reply.trim() }).then((ok) => { if (ok) setReply(''); }); }}>
          <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="your answer" aria-label="your answer" data-testid="reply-text" />
          <button type="submit" disabled={!reply.trim() || busy} data-testid="reply-send">Answer</button>
        </form>
      )}
      {ACTIVE.includes(q.state) && (
        <button className="link" disabled={busy} onClick={() => void send({ action: 'cancel', id: q.id })} data-testid="cancel" title="Withdraw this request">withdraw</button>
      )}
    </div>
  );
}

function Card({ a, store, requests }: { a: PlanAsset; store: Store; requests: WorkRequest[] }) {
  const [asking, setAsking] = useState<'draw' | 'change' | null>(null);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const mine = requests.filter((q) => q.asset === a.name);
  const active = mine.filter((q) => ACTIVE.includes(q.state));
  const lastDone = mine.filter((q) => q.state === 'done').at(-1);
  const canApprove = a.exists && a.status === 'reviewed';
  const canDraw = !a.exists && a.planned && !active.some((q) => q.kind === 'draw' || q.kind === 'new');
  const canChange = a.exists && !active.some((q) => q.kind === 'change');
  const send = async (commands: string) => {
    setBusy(true);
    const r = await store.send(a.name, commands);
    setBusy(false);
    return r.ok;
  };
  const ask = async () => {
    setBusy(true);
    const r = asking === 'draw'
      ? await store.request({ action: 'request', kind: 'draw', asset: a.name, note: why.trim() })
      : await store.request({ action: 'request', kind: 'change', asset: a.name, note: why.trim() });
    setBusy(false);
    store.error = r.ok ? null : r.error ?? 'refused';
    store.changed();
    if (r.ok) { setAsking(null); setWhy(''); }
  };
  const open = () => {
    if (!a.exists) return;
    store.select(a.name);
    store.setTab('editor');
  };
  return (
    <div className={`dash-card st-${a.status}${a.planned ? '' : ' unplanned'}${active.length ? ' has-request' : ''}`} data-testid={`card-${a.name}`} data-status={a.status}>
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
        {active.map((q) => <RequestLine key={q.id} q={q} store={store} />)}
        {!active.length && lastDone && <RequestLine q={lastDone} store={store} />}
        {!asking && (canApprove || canDraw || canChange) && (
          <div className="card-actions">
            {canApprove && <button className="approve" disabled={busy} onClick={() => void send('mark approved')} data-testid="approve" title="Approve this asset (mark approved, on its tape with your name)">✓ Approve</button>}
            {canDraw && <button className="ask-claude" disabled={busy} onClick={() => setAsking('draw')} data-testid="draw" title="Ask Claude to draw this planned asset (a request it takes with its work tool)">Draw this…</button>}
            {canChange && <button disabled={busy} onClick={() => setAsking('change')} data-testid="reject" title="Ask Claude for changes (a request, and mark rejected on the tape with your reason)">Ask for changes…</button>}
          </div>
        )}
        {asking && (
          <form className="card-actions ask" onSubmit={(e) => { e.preventDefault(); if (asking === 'draw' || why.trim()) void ask(); }}>
            <input autoFocus value={why} onChange={(e) => setWhy(e.target.value)} placeholder={asking === 'draw' ? 'anything Claude should know? (optional)' : 'what should change?'}
              aria-label={asking === 'draw' ? 'a note for Claude' : 'what should change'} onKeyDown={(e) => { if (e.key === 'Escape') setAsking(null); }} data-testid="reject-text" />
            <button type="submit" disabled={(asking === 'change' && !why.trim()) || busy} data-testid="reject-send">{asking === 'draw' ? 'Ask Claude' : 'Send'}</button>
            <button type="button" onClick={() => setAsking(null)}>Cancel</button>
          </form>
        )}
      </div>
    </div>
  );
}

/** "Add an asset": a manifest entry, validated by the server, and a request to draw it. */
function AddAsset({ plan, store, onClose }: { plan: PlanReport; store: Store; onClose(): void }) {
  const [f, setF] = useState({ name: '', kind: 'sprite', size: '24x24', set: plan.sets.find((s) => s.name !== 'unplanned')?.name ?? '', description: '', height: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    setBusy(true);
    const entry = { name: f.name.trim(), kind: f.kind, size: f.size.trim(), ...(f.set ? { set: f.set } : {}), ...(f.description.trim() ? { description: f.description.trim() } : {}), ...(f.height ? { height: Number(f.height) } : {}) };
    const r = await store.request({ action: 'request', kind: 'new', entry: entry as never, note: f.note.trim() });
    setBusy(false);
    if (r.ok) onClose(); else setErr(r.error ?? 'refused');
  };
  return (
    <div className="dialog-back" onClick={onClose}>
      <form className="dialog add-asset" data-testid="add-asset" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="panel-title">Add an asset</div>
        <p className="dim">A new entry in the plan (manifest.json), and a request for Claude to draw it.</p>
        <label>name <input value={f.name} onChange={set('name')} placeholder="lantern" data-testid="add-name" autoFocus /></label>
        <label>kind <select value={f.kind} onChange={set('kind')} data-testid="add-kind">{DOC_KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
        <label>size <input value={f.size} onChange={set('size')} placeholder="24x24" data-testid="add-size" /></label>
        <label>set <select value={f.set} onChange={set('set')} data-testid="add-set"><option value="">(its kind)</option>{plan.sets.filter((s) => s.name !== 'unplanned').map((s) => <option key={s.name}>{s.name}</option>)}</select></label>
        <label>height <input value={f.height} onChange={set('height')} placeholder="drawn height in px (props, figures)" /></label>
        <label className="wide">what it is <input value={f.description} onChange={set('description')} placeholder="what it should read as" data-testid="add-description" /></label>
        <label className="wide">note for Claude <input value={f.note} onChange={set('note')} placeholder="optional" data-testid="add-note" /></label>
        {err && <div className="banner error" data-testid="add-error">{err}</div>}
        <div className="card-actions">
          <button type="submit" className="ask-claude" disabled={busy || !f.name.trim()} data-testid="add-send">Add and ask Claude</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

/** The headless worker: Start Claude (only when project.json enables it), its spend and its log. */
function WorkerPanel({ store }: { store: Store }) {
  const w = store.worker;
  const [showLog, setShowLog] = useState(false);
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => { if (showLog) void store.loadWorker(); }, [showLog]);
  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [store.workerLog.length, showLog]);
  if (!w?.enabled) return null;
  const act = async (a: 'start' | 'stop') => {
    setBusy(true);
    const r = await store.workerAction(a);
    setBusy(false);
    store.error = r.ok ? null : r.error ?? 'refused';
    if (r.ok && a === 'start') setShowLog(true);
    store.changed();
  };
  return (
    <div className="worker" data-testid="worker">
      {w.running
        ? <button onClick={() => void act('stop')} disabled={busy} data-testid="worker-stop">■ Stop Claude</button>
        : <button className="ask-claude" onClick={() => void act('start')} disabled={busy} data-testid="worker-start" title="Run Claude Code headless on the open requests, with only the PixelClaw tools, up to the project's budget cap (project.json worker; docs/worker.md)">▶ Start Claude</button>}
      <span className="dim" data-testid="worker-status">
        {w.running ? `working · $${w.spent.toFixed(2)} of $${w.cap.toFixed(2)} spent · session ${w.sessions}` : `${w.stopped ? `stopped: ${w.stopped} · ` : ''}$${(w.spent || 0).toFixed(2)} of $${(w.cap || 0).toFixed(2)} cap spent`}
      </span>
      <button className={showLog ? 'on' : ''} onClick={() => setShowLog(!showLog)} data-testid="worker-log-toggle">Log</button>
      {showLog && <pre className="worker-log" ref={logRef} data-testid="worker-log">{store.workerLog.join('\n') || 'nothing yet'}</pre>}
    </div>
  );
}

export function Dashboard({ store }: { store: Store }) {
  const { plan, error } = usePlan(store);
  const [setFilter, setSetFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<Status | null>(null);
  const [adding, setAdding] = useState(false);
  const requests = store.requests;
  const now = useNow();
  const active = useMemo(() => requests.filter((q) => ACTIVE.includes(q.state)), [requests]);
  if (!plan) return <div className="dashboard" data-testid="dashboard"><div className="dim pad">{error ?? 'Loading the plan…'}</div></div>;
  const planned = plan.assets.filter((a) => a.planned);
  const shown = (a: PlanAsset) => (setFilter === 'all' || a.set === setFilter) && (!statusFilter || a.status === statusFilter);
  return (
    <ImportDrop store={store} plan={plan}>
      <div className="dashboard" data-testid="dashboard">
        <div className="dash-top">
          <div className="dash-row">
            <div className="dash-theme">
              <b>{plan.project}</b>
              {plan.theme ? <span className="dim"> · {plan.theme}</span> : <span className="dim"> · no manifest yet: the agent writes the plan (manifest.json) with its plan tool.</span>}
            </div>
            <span className="spacer" />
            <ListenerChip store={store} />
            <WorkerPanel store={store} />
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
            {active.length > 0 && (() => {
              const forClaude = active.filter((q) => q.state !== 'blocked').length, waiting = active.length - forClaude;
              const nobody = active.filter((q) => unattended(store, q, now)).length;
              return <span className={`chip req-chip${nobody ? ' unattended' : ''}`} data-testid="requests-count" title={active.map((q) => `${q.id} ${q.kind} ${q.asset}: ${q.state}`).join('\n')}>
                {[forClaude ? `${forClaude} request${forClaude === 1 ? '' : 's'} for Claude` : '', waiting ? `${waiting} waiting for your answer` : '', nobody ? (store.presence?.listening ? `${nobody} unseen for 2 minutes` : 'no agent is listening') : ''].filter(Boolean).join(' · ')}
              </span>;
            })()}
            {plan.manifest.exists && !plan.manifest.errors.length && <button onClick={() => setAdding(true)} data-testid="add-asset-open" title="Add an asset to the plan and ask Claude to draw it">+ Add an asset</button>}
            <ImportButton store={store} plan={plan} />
            <label className="dim">set <select value={setFilter} onChange={(e) => setSetFilter(e.target.value)} data-testid="set-filter">
              <option value="all">all</option>
              {plan.sets.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select></label>
          </div>
        </div>
        {plan.scenes.length > 0 && (
          <section className="dash-set dash-scenes" data-testid="scenes">
            <div className="panel-title">scenes<span className="dim"> · what each place still needs</span></div>
            <div className="scene-list">
              {plan.scenes.map((sc) => (
                <div key={sc.name} className={`scene${sc.missing.length || sc.unfinished.length ? '' : ' complete'}`} data-testid={`scene-${sc.name}`}>
                  <b className="mono">{sc.name}</b>{sc.description && <span className="dim"> {sc.description}</span>}
                  <div className="scene-gaps">
                    {sc.missing.length === 0 && sc.unfinished.length === 0 && <span className="chk pass">everything drawn and checked</span>}
                    {sc.missing.map((n) => <span key={n} className="chk missing" title="not drawn yet">{n}</span>)}
                    {sc.unfinished.map((n) => <span key={n} className="chk fail" title="drawn; checks failing">{n}</span>)}
                    <span className="dim"> {sc.needs.length - sc.missing.length} of {sc.needs.length} drawn</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
        {plan.sets.filter((s) => setFilter === 'all' || s.name === setFilter).map((s) => {
          const cards = s.assets.map((n) => plan.assets.find((a) => a.name === n)!).filter(shown);
          if (!cards.length) return null;
          return (
            <section key={s.name} className="dash-set" data-testid={`set-${s.name}`}>
              <div className="panel-title">{s.name}{s.description && <span className="dim"> {s.description}</span>}<span className="dim"> · {cards.length}</span></div>
              <div className="dash-grid">
                {cards.map((a) => <Card key={a.name} a={a} store={store} requests={requests} />)}
              </div>
            </section>
          );
        })}
        {store.error && <div className="banner error floating" data-testid="error">{store.error}</div>}
        {adding && <AddAsset plan={plan} store={store} onClose={() => setAdding(false)} />}
      </div>
    </ImportDrop>
  );
}
