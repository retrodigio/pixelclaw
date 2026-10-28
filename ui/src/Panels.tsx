// The side panels for editing: the tool buttons (with their shortcuts in the tooltips), the
// palette (pick a colour; edit or add one, which becomes a `palette` command on the tape), and the
// open notes.

import { useState } from 'react';
import type { Doc, Note, Palette, TapeEntry } from '@pixelclaw/core';
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

/** The palette: click a swatch to draw with it; double-click (or ✎) to change its colour; + adds one. */
export function PalettePanel({ palette, ed, editable }: { palette: Palette; ed: Editor; editable: boolean }) {
  const [editing, setEditing] = useState<{ name: string | null; hex: string; newName: string } | null>(null);
  const current = ed.doc ? ed.colourName(ed.doc) : ed.colour;
  const save = async () => {
    if (!editing || !HEX_RE.test(editing.hex)) return;
    const cmd = editing.name === null
      ? `palette add${editing.newName.trim() ? ` ${editing.newName.trim()}` : ''} hex=${editing.hex}`
      : `palette set ${editing.name} hex=${editing.hex}`;
    if (await ed.commit(cmd)) setEditing(null);
  };
  return (
    <>
      <div className="panel-title">
        Palette <span className="dim">{palette.name}</span>
        <span className="spacer" />
        {editable && (
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
          <button onClick={() => void save()} disabled={!HEX_RE.test(editing.hex)} data-testid="palette-save">
            {editing.name === null ? 'Add' : `Set ${editing.name}`}
          </button>
          <button onClick={() => setEditing(null)}>✕</button>
        </div>
      )}
      <div className="swatches" data-testid="swatches">
        <div className={`swatch${current === 'none' ? ' on' : ''}`} title="none: transparent (draws by clearing)" onClick={() => ed.setColour('none')} data-colour="none">
          <span className="chip-colour none" />
          <span className="key">·</span>
          <span className="sname">none</span>
        </div>
        {palette.entries.map((e) => (
          <div
            key={e.key}
            className={`swatch${current === e.name ? ' on' : ''}`}
            title={`${e.name}  ${e.hex}  key ${e.key}${editable ? '  (double-click to change the colour)' : ''}`}
            data-colour={e.name}
            onClick={() => ed.setColour(e.name)}
            onDoubleClick={() => editable && setEditing({ name: e.name, hex: e.hex, newName: '' })}
          >
            <span className="chip-colour" style={{ background: e.hex }} />
            <span className="key">{e.key}</span>
            <span className="sname">{e.name}</span>
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
