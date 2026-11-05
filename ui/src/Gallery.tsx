// The gallery: every asset at game scale (the style guide's draw scale), animated
// ones playing at the game's tick rate, maps composed from their assets. Filters by set, kind,
// status and failing check, a sort, a multi-select side-by-side compare, and one click to the
// editor. A map lists the assets it uses and an asset the maps that use it; clicking one shows
// just that family of assets. Looking here changes nothing.

import { useEffect, useMemo, useRef, useState } from 'react';
import { STATUSES, drawScaleOf, type Status } from '@pixelclaw/core';
import type { PlanAsset } from '@pixelclaw/server/protocol';
import type { Store } from './store.ts';
import { STATUS_TEXT, usePlan } from './Dashboard.tsx';
import { ImportButton, ImportDrop } from './Import.tsx';

/** An asset at a whole scale: every frame of its strip in turn, each for its ticks. */
export function Sprite({ a, store, scale, max }: { a: PlanAsset; store: Store; scale: number; max?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const v = a.seq ?? 0;
  useEffect(() => {
    if (!a.exists) return;
    const im = new Image();
    im.onload = () => setImg(im);
    im.src = `/api/strip/${a.name}.png?token=${encodeURIComponent(store.token)}&v=${v}`;
  }, [a.name, v, a.exists]);
  const frames = a.ticks.length > 1 ? a.ticks.length : 1;
  const fw = img ? Math.floor(img.naturalWidth / frames) : a.width;
  const fh = img ? img.naturalHeight : a.height;
  // Big things (maps) shrink to fit; the rest stay at the game's whole scale.
  const k = max && Math.max(fw, fh) * scale > max ? max / Math.max(fw, fh) : scale;
  useEffect(() => {
    const c = canvas.current;
    if (!c || !img) return;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    let f = 0;
    let timer = 0;
    const rate = store.project?.tickRate ?? 60;
    const draw = () => {
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(img, f * fw, 0, fw, fh, 0, 0, c.width, c.height);
      if (frames > 1) {
        const ms = Math.max(16, ((a.ticks[f] ?? 10) * 1000) / rate);
        f = (f + 1) % frames;
        timer = window.setTimeout(draw, ms);
      }
    };
    draw();
    return () => clearTimeout(timer);
  }, [img, k, frames]);
  if (!a.exists) return <span className="planned-box" style={{ width: Math.max(24, (a.width || 24) * scale), height: Math.max(24, (a.height || 24) * scale) }}>planned</span>;
  return <canvas ref={canvas} width={Math.max(1, Math.round(fw * k))} height={Math.max(1, Math.round(fh * k))} data-frames={frames} data-testid={`sprite-${a.name}`} />;
}

const SORTS = { name: 'name', set: 'set', kind: 'kind', status: 'status', recent: 'recently changed', size: 'size' } as const;
type Sort = keyof typeof SORTS;

export function Gallery({ store }: { store: Store }) {
  const { plan, error } = usePlan(store);
  const [set, setSet] = useState('all');
  const [kind, setKind] = useState('all');
  const [status, setStatus] = useState<Status | 'all'>('all');
  const [failing, setFailing] = useState('any');
  const [sort, setSort] = useState<Sort>('set');
  const [related, setRelated] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [zoom, setZoom] = useState(1);
  const scale = Math.max(1, Math.min(4, drawScaleOf(store.style, store.project?.grid)));
  const list = useMemo(() => {
    if (!plan) return [];
    const rel = related ? plan.assets.find((a) => a.name === related) : null;
    const keep = (a: PlanAsset) => (set === 'all' || a.set === set) && (kind === 'all' || a.kind === kind) && (status === 'all' || a.status === status)
      && (failing === 'any' || (failing === 'none' ? a.exists && a.failing.length === 0 : a.failing.includes(failing)))
      && (!rel || a.name === rel.name || rel.uses.includes(a.name) || rel.usedBy.includes(a.name));
    const order = (a: PlanAsset, b: PlanAsset) => {
      switch (sort) {
        case 'name': return a.name.localeCompare(b.name);
        case 'kind': return a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name);
        case 'status': return STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || a.name.localeCompare(b.name);
        case 'recent': return (b.at ?? '').localeCompare(a.at ?? '') || a.name.localeCompare(b.name);
        case 'size': return b.width * b.height - a.width * a.height || a.name.localeCompare(b.name);
        default: return 0;
      }
    };
    const all = plan.assets.filter(keep);
    return sort === 'set' ? all : [...all].sort(order);
  }, [plan, set, kind, status, failing, sort, related]);
  if (!plan) return <div className="dashboard" data-testid="gallery"><div className="dim pad">{error ?? 'Loading…'}</div></div>;
  const kinds = [...new Set(plan.assets.map((a) => a.kind))].sort();
  const failingIds = [...new Set(plan.assets.flatMap((a) => a.failing))].sort();
  const toggle = (n: string) => setPicked(picked.includes(n) ? picked.filter((x) => x !== n) : [...picked, n]);
  const open = (a: PlanAsset) => { if (a.exists) { store.select(a.name); store.setTab('editor'); } };
  const byName = (n: string) => plan.assets.find((a) => a.name === n);
  const chips = (names: string[], what: string) => names.length > 0 && (
    <div className="gal-rel">{what} {names.map((n) => <button key={n} className="link mono" onClick={() => setRelated(n)} title={`Show ${n} and what it is linked with`}>{n}</button>)}</div>
  );
  return (
    <ImportDrop store={store} plan={plan}>
      <div className="dashboard gallery" data-testid="gallery">
        <div className="dash-top">
          <div className="dash-filters">
            <b>{plan.project}</b><span className="dim"> · {list.length} of {plan.assets.length} at game scale ({scale}x)</span>
            <span className="spacer" />
            <label className="dim">set <select value={set} onChange={(e) => setSet(e.target.value)} data-testid="g-set"><option value="all">all</option>{plan.sets.map((s) => <option key={s.name}>{s.name}</option>)}</select></label>
            <label className="dim">kind <select value={kind} onChange={(e) => setKind(e.target.value)} data-testid="g-kind"><option value="all">all</option>{kinds.map((k) => <option key={k}>{k}</option>)}</select></label>
            <label className="dim">status <select value={status} onChange={(e) => setStatus(e.target.value as Status | 'all')} data-testid="g-status"><option value="all">all</option>{STATUSES.map((s) => <option key={s} title={STATUS_TEXT[s]}>{s}</option>)}</select></label>
            <label className="dim">checks <select value={failing} onChange={(e) => setFailing(e.target.value)} data-testid="g-failing"><option value="any">any</option><option value="none">all pass</option>{failingIds.map((c) => <option key={c} value={c}>failing {c}</option>)}</select></label>
            <label className="dim">sort <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} data-testid="g-sort">{Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <ImportButton store={store} plan={plan} />
            <button disabled={picked.length < 2} className={comparing ? 'on' : ''} onClick={() => setComparing(!comparing)} data-testid="compare" title="Select assets (the box on each), then compare them side by side">Compare ({picked.length})</button>
          </div>
          {related && <div className="dash-filters"><span className="chip">showing <b className="mono">{related}</b> with {byName(related)?.uses.length ? 'what it uses' : 'the maps that use it'}</span><button className="link" onClick={() => setRelated(null)} data-testid="g-related-clear">show all</button></div>}
        </div>
        {comparing && picked.length > 1 && (
          <div className="compare" data-testid="compare-view">
            <div className="compare-tools"><span className="seg">{[1, 2, 4].map((z) => <button key={z} className={zoom === z ? 'on' : ''} onClick={() => setZoom(z)} title={`${z * scale}x: the game's scale${z > 1 ? ` times ${z}` : ''}`}>{z === 1 ? 'game scale' : `×${z}`}</button>)}</span></div>
            <div className="compare-row">
              {picked.map((n) => byName(n)).filter((a): a is PlanAsset => !!a).map((a) => (
                <figure key={a.name}>
                  <Sprite a={a} store={store} scale={scale * zoom} max={480 * zoom} />
                  <figcaption className="mono">{a.name} <span className={`badge st-${a.status}`}>{a.status}</span></figcaption>
                </figure>
              ))}
            </div>
          </div>
        )}
        <div className="gal-grid">
          {list.map((a) => (
            <div key={a.name} className={`gal-item st-${a.status}${picked.includes(a.name) ? ' picked' : ''}`} data-testid={`g-${a.name}`} data-status={a.status}>
              <button className="gal-art" onClick={() => open(a)} disabled={!a.exists} title={a.exists ? `Open ${a.name} in the editor` : 'planned: not drawn yet'}>
                <Sprite a={a} store={store} scale={scale} max={360} />
              </button>
              <div className="gal-meta">
                <label className="gal-pick" title="Select to compare"><input type="checkbox" checked={picked.includes(a.name)} onChange={() => toggle(a.name)} data-testid={`pick-${a.name}`} /></label>
                <b className="mono">{a.name}</b>
                <span className={`badge st-${a.status}`} title={STATUS_TEXT[a.status]}>{a.status}</span>
              </div>
              <div className="dim small">{a.set} · {a.kind} {a.exists ? `${a.width}x${a.height}` : a.size}{a.ticks.length > 1 ? ` · ${a.ticks.length} frames` : ''}</div>
              {a.failing.length > 0 && <div className="card-checks">{a.failing.map((id) => <span key={id} className="chk fail">{id}</span>)}</div>}
              {chips(a.uses, 'uses')}
              {chips(a.usedBy, 'in')}
            </div>
          ))}
        </div>
      </div>
    </ImportDrop>
  );
}
