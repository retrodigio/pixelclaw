// The watch view (plan §8.3, the G2 subset): assets and palette on the left, the canvas in the
// middle, the tape with playback controls and "Claude's eye" on the right. No editing yet (G3).

import { useState, useSyncExternalStore } from 'react';
import { CanvasView, ZOOMS } from './CanvasView.tsx';
import { SPEEDS, type Store } from './store.ts';
import { TapePanel, authorClass, time } from './TapePanel.tsx';

function speedLabel(s: number): string {
  return s === Infinity ? 'instant' : `${s}/s`;
}

/** The eye image enlarged by a whole number (so its pixels stay square), as large as fits. */
function eyeSize(w: number, h: number): { width: number; height: number } {
  const k = Math.max(1, Math.min(Math.floor((innerWidth * 0.92) / w), Math.floor((innerHeight * 0.85) / h)));
  return { width: w * k, height: h * k };
}

export function App({ store }: { store: Store }) {
  useSyncExternalStore(store.subscribe, store.getVersion);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [effZoom, setEffZoom] = useState(1);
  const [pixelGrid, setPixelGrid] = useState(true);
  const [cellGrid, setCellGrid] = useState(true);
  const [eyeOpen, setEyeOpen] = useState(false);

  const a = store.current;
  const { doc, seq } = store.shownDoc();
  const pending = store.pending(a);
  const waiting = [...store.assets.values()].reduce((n, x) => n + store.pending(x), 0);
  const live = store.travel === null && waiting === 0 && !store.paused;
  const palette = doc?.palette ?? (store.defaultPalette ? store.palettes.get(store.defaultPalette) : undefined);
  const lastBy = a?.tape.at(-1)?.by;

  const step = (dir: 1 | -1) => {
    const i = ZOOMS.indexOf(effZoom);
    setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 0 : i) + dir))]!);
  };

  return (
    <div className="app">
      <header>
        <span className="logo">PixelClaw</span>
        <span className="crumbs">
          {store.project?.name ?? '…'}
          {a && <> <span className="sep">▸</span> {a.name}</>}
          {doc && <span className="meta"> {doc.kind} {doc.width}×{doc.height}{doc.wrap ? ' · wrap' : ''} · {doc.palette.name}</span>}
        </span>
        <span className="spacer" />
        {store.travel !== null && <span className="chip travel-chip">viewing #{store.travel} · read-only</span>}
        {store.paused && <span className="chip paused-chip">paused</span>}
        <span className={`chip conn-${store.status}`} data-testid="status">
          {store.status === 'open' ? (live ? '● live' : '● connected') : store.status === 'connecting' ? 'connecting…' : 'reconnecting…'}
        </span>
      </header>

      <aside className="left">
        <div className="panel-title">
          Assets
          <label className="follow" title="Show whichever asset the agent is drawing on">
            <input type="checkbox" checked={store.follow} onChange={(e) => store.setFollow(e.target.checked)} /> follow
          </label>
        </div>
        <ul className="assets" data-testid="assets">
          {[...store.assets.values()].map((x) => {
            const n = store.pending(x);
            return (
              <li key={x.name} className={x.name === store.selected ? 'selected' : ''} onClick={() => store.select(x.name)}>
                <span className={`dot${n > 0 ? ' busy' : ''}`}>{n > 0 ? '●' : '○'}</span>
                <span className="name">{x.name}</span>
                <span className="count">{x.tape.length}</span>
              </li>
            );
          })}
          {store.assets.size === 0 && <li className="none">none yet</li>}
        </ul>
        {palette && (
          <>
            <div className="panel-title">Palette <span className="dim">{palette.name}</span></div>
            <div className="swatches">
              {palette.entries.map((e) => (
                <div key={e.key} className="swatch" title={`${e.name}  ${e.hex}  key ${e.key}`}>
                  <span className="chip-colour" style={{ background: e.hex }} />
                  <span className="key">{e.key}</span>
                  <span className="sname">{e.name}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </aside>

      <main>
        <div className="toolbar">
          <button onClick={() => step(-1)} disabled={!doc} title="Zoom out (Ctrl/⌘ + wheel)">−</button>
          <span className="zoom" data-testid="zoom">{doc ? `${effZoom}×` : ''}</span>
          <button onClick={() => step(1)} disabled={!doc} title="Zoom in (Ctrl/⌘ + wheel)">+</button>
          <button className={zoom === 'fit' ? 'on' : ''} disabled={!doc} onClick={() => setZoom('fit')}>Fit</button>
          <span className="gap" />
          <label><input type="checkbox" checked={pixelGrid} onChange={(e) => setPixelGrid(e.target.checked)} /> pixel grid</label>
          <label><input type="checkbox" checked={cellGrid} onChange={(e) => setCellGrid(e.target.checked)} /> cell grid</label>
          <span className="spacer" />
          {doc && seq !== null && <span className="dim">after #{seq}</span>}
        </div>
        {store.travel !== null && (
          <div className="banner">
            Viewing the document after #{store.travel} (read-only).
            <button onClick={() => store.setTravel(null)}>Back to live</button>
          </div>
        )}
        {a?.problem && <div className="banner error">This tape does not replay: {a.problem}</div>}
        <CanvasView
          doc={doc}
          zoom={zoom}
          pixelGrid={pixelGrid}
          cellGrid={cellGrid}
          seq={seq}
          asset={a?.name ?? null}
          travel={store.travel !== null}
          onZoom={setZoom}
          onEffectiveZoom={setEffZoom}
        />
      </main>

      <aside className="right">
        <div className="panel-title">
          Tape
          {a && <span className="dim"> {a.tape.length} commands</span>}
          <span className="spacer" />
          {lastBy && <span className={`legend ${authorClass(lastBy)}`}>{lastBy}</span>}
        </div>
        <TapePanel asset={a} undone={a ? store.undoneGroups(a) : new Set()} travel={store.travel} follow={store.follow} onPick={(s) => store.setTravel(s)} />
        <div className="controls" data-testid="controls">
          <button onClick={() => store.setPaused(!store.paused)} data-testid="pause">{store.paused ? '▶ Play' : '❚❚ Pause'}</button>
          <select value={String(store.speed)} onChange={(e) => store.setSpeed(Number(e.target.value))} title="Playback speed (commands per second)" data-testid="speed">
            {SPEEDS.map((s) => <option key={String(s)} value={String(s)}>{speedLabel(s)}</option>)}
          </select>
          <button onClick={() => store.jumpToLive()} disabled={live} data-testid="live">Jump to live ⏭</button>
          <span className="spacer" />
          <span className="dim" data-testid="waiting">{pending > 0 ? `${pending} to play` : waiting > 0 ? `${waiting} waiting` : ''}</span>
        </div>
        <div className="panel-title">Claude's eye <span className="dim">the last image the agent saw</span></div>
        <div className="eye" data-testid="eye">
          {store.eye ? (
            <>
              <img src={`data:image/png;base64,${store.eye.png}`} alt={`${store.eye.asset} ${store.eye.mode}`} onClick={() => setEyeOpen(true)} />
              <div className="dim">{store.eye.asset} · {store.eye.mode} · {store.eye.width}×{store.eye.height} · {time(store.eye.at)}</div>
            </>
          ) : (
            <div className="dim">Nothing yet. When the agent looks at a view, it shows here.</div>
          )}
        </div>
      </aside>

      {eyeOpen && store.eye && (
        <div className="modal" onClick={() => setEyeOpen(false)}>
          <img src={`data:image/png;base64,${store.eye.png}`} alt="" style={eyeSize(store.eye.width, store.eye.height)} />
          <div className="dim">{store.eye.path}</div>
        </div>
      )}
    </div>
  );
}
