// The side panels for editing: the tool buttons (with their shortcuts in the tooltips), the
// palette (pick a colour; edit or add one, which becomes a `palette` command on the tape), and the
// open notes.

import { useEffect, useRef, useState } from 'react';
import { TRANSPARENT, rgbOf, type Doc, type Note, type Palette, type Stamp, type TapeEntry } from '@pixelclaw/core';
import { TOOLS, type Editor } from './editor.ts';

export function ToolsPanel({ ed, disabled }: { ed: Editor; disabled: boolean }) {
  return (
    <div className="tools" data-testid="tools">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={ed.tool === t.id ? 'on' : ''}
          disabled={disabled}
          data-tool={t.id}
          aria-label={t.label}
          title={`${t.label} (${t.key}): ${t.hint}`}
          onClick={() => ed.setTool(t.id)}
        >
          {t.icon}
        </button>
      ))}
    </div>
  );
}

const HEX_RE = /^#[0-9a-f]{6}$/;

/**
 * The palette: click a swatch for colour A (drawing), right-click for colour B (gradient end,
 * dither ground); double-click to change its colour; + adds one. Locked palettes say so.
 */
export function PalettePanel({ palette, ed, editable, locked }: { palette: Palette; ed: Editor; editable: boolean; locked: boolean }) {
  const [editing, setEditing] = useState<{ name: string | null; hex: string; newName: string } | null>(null);
  const current = ed.doc ? ed.colourName(ed.doc) : ed.colour;
  const second = ed.doc ? ed.colourName(ed.doc, true) : ed.colour2;
  const canEdit = editable && !locked;
  const save = async () => {
    if (!editing || !HEX_RE.test(editing.hex)) return;
    const cmd = editing.name === null
      ? `palette add${editing.newName.trim() ? ` ${editing.newName.trim()}` : ''} hex=${editing.hex}`
      : `palette set ${editing.name} hex=${editing.hex}`;
    if (await ed.commit(cmd, { context: false })) setEditing(null);
  };
  return (
    <>
      <div className="panel-title">
        Palette <span className="dim">{palette.name}</span>
        {locked && <span className="dim" title="The palette is locked (palette unlock to change it)" data-testid="palette-locked">🔒</span>}
        <span className="spacer" />
        {editable && (
          <button className="mini" title={locked ? 'Unlock the palette (palette unlock)' : 'Lock the palette: no more colour edits (palette lock)'} data-testid="palette-lock"
            onClick={() => void ed.commit(locked ? 'palette unlock' : 'palette lock', { context: false })}>{locked ? 'unlock' : 'lock'}</button>
        )}
        {canEdit && (
          <button className="mini" title="Add a colour to this asset's palette" data-testid="palette-add"
            onClick={() => setEditing({ name: null, hex: '#808080', newName: '' })}>+</button>
        )}
      </div>
      {editing && (
        <div className="palette-edit" data-testid="palette-edit">
          <input type="color" value={editing.hex} onChange={(e) => setEditing({ ...editing, hex: e.target.value })} />
          <input className="hex" value={editing.hex} spellCheck={false} aria-label="hex"
            onChange={(e) => setEditing({ ...editing, hex: e.target.value.toLowerCase() })}
            onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') setEditing(null); }} />
          {editing.name === null && (
            <input className="pname" placeholder="name" value={editing.newName} aria-label="name"
              onChange={(e) => setEditing({ ...editing, newName: e.target.value })} />
          )}
          <button onClick={() => void save()} disabled={!HEX_RE.test(editing.hex)} data-testid="palette-save"
            title={editing.name === null ? 'Add this colour (palette add)' : `Set ${editing.name} to this colour (palette set)`}>
            {editing.name === null ? 'Add' : 'Set'}
          </button>
          <button onClick={() => setEditing(null)} title="Cancel (Esc)">✕</button>
        </div>
      )}
      <div className="swatches" data-testid="swatches">
        <div className={`swatch${current === 'none' ? ' on' : ''}${second === 'none' ? ' two' : ''}`} title="none: transparent (draws by clearing)"
          onClick={() => ed.setColour('none')} onContextMenu={(e) => { e.preventDefault(); ed.setColour('none', true); }} data-colour="none">
          <span className="chip-colour none" />
          <span className="key">·</span>
          <span className="sname">none</span>
          {current === 'none' && <span className="ab">A</span>}{second === 'none' && <span className="ab b">B</span>}
        </div>
        {palette.entries.map((e) => (
          <div
            key={e.key}
            className={`swatch${current === e.name ? ' on' : ''}${second === e.name ? ' two' : ''}`}
            title={`${e.name}  ${e.hex}  key ${e.key}  (click: colour A, right-click: colour B${canEdit ? ', double-click to change the colour' : ''})`}
            data-colour={e.name}
            onClick={() => ed.setColour(e.name)}
            onContextMenu={(ev) => { ev.preventDefault(); ed.setColour(e.name, true); }}
            onDoubleClick={() => canEdit && setEditing({ name: e.name, hex: e.hex, newName: '' })}
          >
            <span className="chip-colour" style={{ background: e.hex }} />
            <span className="key">{e.key}</span>
            <span className="sname">{e.name}</span>
            {current === e.name && <span className="ab">A</span>}{second === e.name && <span className="ab b">B</span>}
          </div>
        ))}
      </div>
    </>
  );
}

/** Who wrote each open note: the author of its line on the tape. */
function noteAuthors(tape: TapeEntry[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of tape) {
    const id = / id=(n\d+)$/.exec(e.cmd)?.[1];
    if (id && e.cmd.startsWith('note ')) m.set(id, e.by);
  }
  return m;
}

export function NotesPanel({ doc, tape, ed, editable, active, onActive }: {
  doc: Doc; tape: TapeEntry[]; ed: Editor; editable: boolean; active: string | null; onActive(id: string | null): void;
}) {
  if (doc.notes.length === 0) return null;
  const by = noteAuthors(tape);
  return (
    <>
      <div className="panel-title">Notes <span className="dim">{doc.notes.length} open</span></div>
      <ul className="notes" data-testid="notes">
        {doc.notes.map((n: Note) => (
          <li key={n.id} className={n.id === active ? 'on' : ''} onClick={() => onActive(n.id === active ? null : n.id)}>
            <span className="nid">{n.id}</span>
            <span className="ntext">
              {n.text}
              <span className="dim"> · {n.x},{n.y}{n.w > 1 || n.h > 1 ? ` ${n.w}×${n.h}` : ''} · {by.get(n.id) ?? '?'}</span>
            </span>
            {editable && (
              <button className="mini" title="Close this note (note done)" onClick={(e) => { e.stopPropagation(); void ed.closeNote(n); }}>✓</button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

/** A stamp drawn at a small scale. */
function StampThumb({ s, palette }: { s: Stamp; palette: Palette }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = s.w;
    c.height = s.h;
    const img = new ImageData(s.w, s.h);
    for (let i = 0; i < s.px.length; i++) {
      if (s.px[i] === TRANSPARENT) continue;
      const [r, g, b] = rgbOf(palette.entries[s.px[i]!]?.hex ?? '#ff00ff');
      img.data.set([r, g, b, 255], i * 4);
    }
    c.getContext('2d')!.putImageData(img, 0, 0);
  }, [s, palette]);
  const k = Math.max(1, Math.min(4, Math.floor(32 / Math.max(s.w, s.h))));
  return <canvas ref={ref} style={{ width: s.w * k, height: s.h * k }} />;
}

/** The document's stamps: pick one for the stamp tool (S); save your selection as a new one. */
export function StampsPanel({ doc, ed, editable }: { doc: Doc; ed: Editor; editable: boolean }) {
  const [naming, setNaming] = useState<string | null>(null);
  const names = Object.keys(doc.stamps).sort();
  const free = () => { let n = names.length + 1; while (doc.stamps[`stamp${n}`]) n++; return `stamp${n}`; };
  return (
    <>
      <div className="panel-title">
        Stamps <span className="dim">{names.length || ''}</span>
        <span className="spacer" />
        {editable && naming === null && (
          <button className="mini" disabled={!ed.hasSel()} title="Save your selection as a stamp (stamp save)" data-testid="stamp-save" onClick={() => setNaming(free())}>+ from selection</button>
        )}
      </div>
      {naming !== null && (
        <form className="palette-edit" onSubmit={(e) => { e.preventDefault(); void ed.saveStamp(naming).then((ok) => ok && setNaming(null)); }}>
          <input value={naming} onChange={(e) => setNaming(e.target.value)} aria-label="stamp name" autoFocus />
          <button type="submit" data-testid="stamp-save-ok">Save</button>
          <button type="button" onClick={() => setNaming(null)}>✕</button>
        </form>
      )}
      <div className="stamps" data-testid="stamps">
        {names.map((n) => (
          <button key={n} className={`stamp${ed.stamp === n ? ' on' : ''}`} data-stamp={n} title={`${n} (${doc.stamps[n]!.w}x${doc.stamps[n]!.h}): click, then click the canvas to place it`}
            onClick={() => { ed.stamp = n; ed.setTool('stamp'); }}>
            <StampThumb s={doc.stamps[n]!} palette={doc.palette} />
            <span>{n}</span>
          </button>
        ))}
      </div>
    </>
  );
}
