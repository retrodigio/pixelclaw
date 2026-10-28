// The page (plan §8.3): assets, tools and palette on the left; the canvas in the middle; the tape
// with playback controls, the command line, notes and "Claude's eye" on the right. People edit
// here: every action becomes a command on the tape with their name (plan §1.3).

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CanvasView, ZOOMS } from './CanvasView.tsx';
import { Editor } from './editor.ts';
import { NotesPanel, PalettePanel, ToolsPanel } from './Panels.tsx';
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

const FORK_RE = /^fork (\S+) \S+ at=(\d+)$/;

function isTyping(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

/** A free name for a branch of `name`: name_b, name_c, … */
function branchName(name: string, taken: (n: string) => boolean): string {
  for (const s of 'bcdefghijklmnopqrstuvwxyz') if (!taken(`${name}_${s}`)) return `${name}_${s}`;
  return `${name}_branch`;
}

export function App({ store }: { store: Store }) {
  useSyncExternalStore(store.subscribe, store.getVersion);
  const ed = useMemo(() => {
    const e = new Editor(store);
    // For tests and debugging: the editor behind the page.
    (window as unknown as { pixelclawEditor: Editor }).pixelclawEditor = e;
    return e;
  }, [store]);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [effZoom, setEffZoom] = useState(1);
  const [pixelGrid, setPixelGrid] = useState(true);
  const [cellGrid, setCellGrid] = useState(true);
  const [eyeOpen, setEyeOpen] = useState(false);
  const [branch, setBranch] = useState<string | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [cmdLine, setCmdLine] = useState('');
  const [noteText, setNoteText] = useState('');
  const noteInput = useRef<HTMLInputElement>(null);

  const a = store.current;
  const { doc: shown, seq } = store.shownDoc();
  const doc = ed.previewDoc() ?? shown;
  const pending = store.pending(a);
  const waiting = [...store.assets.values()].reduce((n, x) => n + store.pending(x), 0);
  const live = store.travel === null && waiting === 0 && !store.paused;
  const palette = doc?.palette ?? (store.defaultPalette ? store.palettes.get(store.defaultPalette) : undefined);
  const lastBy = a?.tape.at(-1)?.by;
  const editable = ed.editable;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (ed.key(e)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ed]);

  useEffect(() => {
    if (ed.noteDraft) noteInput.current?.focus();
  }, [ed.noteDraft]);

  const step = (dir: 1 | -1) => {
    const i = ZOOMS.indexOf(effZoom);
    setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 0 : i) + dir))]!);
  };

  const makeBranch = async () => {
    if (!a || store.travel === null || !branch) return;
    const at = store.travel;
    const r = await store.send(branch, `fork ${a.name} ${branch} at=${at}`);
    if (r.ok) {
      setBranch(null);
      store.select(branch);
    }
  };

  const sendLine = async () => {
    const text = cmdLine.trim();
    if (!text) return;
    store.catchUp();
    const r = await store.send(/^\s*(new|fork)\b/.test(text) ? '' : a?.name ?? '', text);
    if (r.ok) {
      setCmdLine('');
      if (r.asset !== a?.name) store.select(r.asset);
    }
  };

  const draft = ed.noteDraft;

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
        {naming === null ? (
          <button className="chip me" data-testid="me" title="The name your edits are written with on the tape. Click to change it."
            onClick={() => setNaming(store.me.slice('human:'.length))}>
            you: <b>{store.me}</b>
          </button>
        ) : (
          <form className="me-form" onSubmit={(e) => { e.preventDefault(); if (store.setMe(naming)) setNaming(null); }}>
            human:<input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} onBlur={() => setNaming(null)} aria-label="your name" />
          </form>
        )}
        <span className={`chip conn-${store.status}`} data-testid="status">
          {store.status === 'open' ? (live ? '● live' : '● connected') : store.status === 'connecting' ? 'connecting…' : 'reconnecting…'}
        </span>
      </header>

      <aside className="left">
        <div className="panel-title">
          Assets
          <label className="follow" title="Show whichever asset the agent is drawing on (turns off when you start editing)">
            <input type="checkbox" checked={store.follow} onChange={(e) => store.setFollow(e.target.checked)} /> follow
          </label>
        </div>
        <ul className="assets" data-testid="assets">
          {[...store.assets.values()].map((x) => {
            const n = store.pending(x);
            const fork = x.tape.map((e) => FORK_RE.exec(e.cmd)).find(Boolean);
            return (
              <li key={x.name} className={x.name === store.selected ? 'selected' : ''} onClick={() => store.select(x.name)}
                title={fork ? `a branch of ${fork[1]} at #${fork[2]}` : undefined}>
                <span className={`dot${n > 0 ? ' busy' : ''}`}>{n > 0 ? '●' : '○'}</span>
                <span className="name">{x.name}{fork && <span className="dim"> ⑂ {fork[1]}</span>}</span>
                <span className="count">{x.tape.length}</span>
              </li>
            );
          })}
          {store.assets.size === 0 && <li className="none">none yet</li>}
        </ul>
        <div className="panel-title">Tools</div>
        <ToolsPanel ed={ed} disabled={!editable} />
        {palette && <PalettePanel palette={palette} ed={ed} editable={editable} />}
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
          <span className="gap" />
          {doc && editable && (
            <>
              <span className="colour-now" title="The colour you draw with (I or Alt+click picks one from the canvas)" data-testid="colour">
                <span className={`chip-colour${ed.colourName(doc) === 'none' ? ' none' : ''}`}
                  style={{ background: doc.palette.entries.find((e) => e.name === ed.colourName(doc))?.hex }} />
                {ed.colourName(doc)}
              </span>
              {(ed.tool === 'rect' || ed.tool === 'ellipse') && (
                <label title="Filled shapes (F)"><input type="checkbox" checked={ed.filled} onChange={(e) => { ed.filled = e.target.checked; store.changed(); }} /> filled</label>
              )}
              {ed.tool === 'pencil' && (
                <label title="Pixel-perfect pencil: no doubled L-corners"><input type="checkbox" checked={ed.pixelPerfect}
                  onChange={(e) => { ed.pixelPerfect = e.target.checked; store.changed(); }} /> pixel-perfect</label>
              )}
            </>
          )}
          <span className="spacer" />
          <button onClick={() => ed.undo()} disabled={!ed.canUndo()} title={`Undo your last edit (Ctrl/⌘+Z): undo by=${store.me}`} data-testid="undo">↶ Undo</button>
          <button onClick={() => ed.redo()} disabled={!ed.canRedo()} title={`Redo your last undo (Ctrl/⌘+Shift+Z): redo by=${store.me}`} data-testid="redo">↷ Redo</button>
          {doc && seq !== null && <span className="dim">after #{seq}</span>}
        </div>
        {store.travel !== null && a && (
          <div className="banner">
            Viewing the document after #{store.travel} (read-only).
            <button onClick={() => store.setTravel(null)}>Back to live</button>
            {branch === null ? (
              <button onClick={() => setBranch(branchName(a.name, (n) => store.assets.has(n)))} data-testid="branch"
                title="Start a new asset from this point (a fork); the original stays as it is">⑂ Branch here…</button>
            ) : (
              <form className="inline-form" onSubmit={(e) => { e.preventDefault(); void makeBranch(); }}>
                new asset <input value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="branch name" autoFocus />
                <button type="submit" data-testid="branch-create">Create branch</button>
                <button type="button" onClick={() => setBranch(null)}>Cancel</button>
              </form>
            )}
          </div>
        )}
        {draft && (
          <form className="banner note-banner" data-testid="note-form"
            onSubmit={(e) => { e.preventDefault(); void ed.writeNote(noteText).then((ok) => ok && setNoteText('')); }}>
            Note at {draft.x},{draft.y}{draft.w > 1 || draft.h > 1 ? ` ${draft.w}×${draft.h}` : ''}:
            <input ref={noteInput} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="what should the agent know?"
              onKeyDown={(e) => { if (e.key === 'Escape') ed.cancel(); }} aria-label="note text" />
            <button type="submit" disabled={!noteText.trim()}>Pin note</button>
            <button type="button" onClick={() => ed.cancel()}>Cancel</button>
          </form>
        )}
        {store.error && <div className="banner error" data-testid="error">{store.error}</div>}
        {a?.problem && <div className="banner error">This tape does not replay: {a.problem}</div>}
        <CanvasView
          doc={doc}
          zoom={zoom}
          pixelGrid={pixelGrid}
          cellGrid={cellGrid}
          seq={seq}
          asset={a?.name ?? null}
          travel={store.travel !== null}
          overlay={{ sel: ed.shownSel, marquee: ed.marquee, notes: doc?.notes ?? [], activeNote: ed.activeNote, hover: ed.hover, draft }}
          pointer={editable ? { down: (p, e) => ed.down(p, e), move: (p) => ed.move(p), up: (p) => ed.up(p) } : null}
          cursor={ed.tool === 'move' ? 'move' : ed.tool === 'picker' ? 'copy' : 'crosshair'}
          onNote={(id) => { ed.activeNote = id; store.changed(); }}
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
        <form className="cmdline" onSubmit={(e) => { e.preventDefault(); void sendLine(); }}>
          <span className="prompt">&gt;</span>
          <input value={cmdLine} onChange={(e) => setCmdLine(e.target.value)} placeholder="type a command…" spellCheck={false}
            disabled={store.status !== 'open'} aria-label="command line" data-testid="cmdline"
            title={`Commands run on the shown asset as ${store.me}, as one undo group (';' between commands)`} />
        </form>
        <div className="controls" data-testid="controls">
          <button onClick={() => store.setPaused(!store.paused)} data-testid="pause">{store.paused ? '▶ Play' : '❚❚ Pause'}</button>
          <select value={String(store.speed)} onChange={(e) => store.setSpeed(Number(e.target.value))} title="Playback speed (commands per second)" data-testid="speed">
            {SPEEDS.map((s) => <option key={String(s)} value={String(s)}>{speedLabel(s)}</option>)}
          </select>
          <button onClick={() => store.jumpToLive()} disabled={live} data-testid="live">Jump to live ⏭</button>
          <span className="spacer" />
          <span className="dim" data-testid="waiting">{pending > 0 ? `${pending} to play` : waiting > 0 ? `${waiting} waiting` : ''}</span>
        </div>
        {doc && a && (
          <NotesPanel doc={doc} tape={a.tape} ed={ed} editable={editable} active={ed.activeNote}
            onActive={(id) => { ed.activeNote = id; store.changed(); }} />
        )}
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
