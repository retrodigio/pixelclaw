// The timeline (plan §8.3): layers (top first) by frames. Click a cel to draw on that layer and
// frame (yours alone: the page sends `layer` and `frame` with your next edit). The flags beside a
// layer's name toggle hidden, locked and reference (`layer set`); the buttons add, move, merge and
// remove layers and add or remove frames. [ and ] step through frames.

import { useState } from 'react';
import { TRANSPARENT, type Doc } from '@pixelclaw/core';
import type { Editor } from './editor.ts';

const FLAGS = [
  { key: 'hidden', on: '◌', off: '◉', title: 'Hidden (not in the art): layer set … hidden=on|off' },
  { key: 'locked', on: '🔒︎', off: '·', title: 'Locked (refuses drawing): layer set … locked=on|off' },
  { key: 'reference', on: 'R', off: '·', title: 'Reference (a guide under the art, never exported): layer set … reference=on|off' },
] as const;

export function TimelinePanel({ doc, ed, editable }: { doc: Doc; ed: Editor; editable: boolean }) {
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const li = ed.layerIndex(doc);
  const fi = ed.frameIndex(doc);
  const cur = doc.layers[li]!;
  const filled = (l: number, f: number) => doc.cels[l]![f]!.some((v) => v !== TRANSPARENT);
  const order = doc.layers.map((_, i) => i).reverse();
  return (
    <div className="timeline" data-testid="timeline">
      <div className="tl-bar">
        <span className="tl-title">Layers</span>
        <button className="mini" disabled={!editable} onClick={() => ed.addLayer()} title={`New layer above ${cur.name} (layer add)`} data-testid="layer-add">+</button>
        <button className="mini" disabled={!editable || li === doc.layers.length - 1} onClick={() => ed.moveLayer(cur.name, 1)} title={`Move ${cur.name} up (layer move)`} data-testid="layer-up">↑</button>
        <button className="mini" disabled={!editable || li === 0} onClick={() => ed.moveLayer(cur.name, -1)} title={`Move ${cur.name} down (layer move)`} data-testid="layer-down">↓</button>
        <button className="mini" disabled={!editable || li === 0} onClick={() => ed.act(`layer merge ${cur.name}`, { context: false })} title={`Merge ${cur.name} into the layer below (layer merge)`} data-testid="layer-merge">⤓</button>
        <button className="mini" disabled={!editable || doc.layers.length < 2} onClick={() => ed.act(`layer remove ${cur.name}`, { context: false })} title={`Remove ${cur.name} (layer remove)`} data-testid="layer-remove">✕</button>
        <span className="spacer" />
        <span className="tl-title">Frames</span>
        <button className="mini" onClick={() => ed.stepFrame(-1)} disabled={doc.frameCount < 2} title="Previous frame ([)">◀</button>
        <span className="dim" data-testid="frame-now">{fi + 1} / {doc.frameCount}</span>
        <button className="mini" onClick={() => ed.stepFrame(1)} disabled={doc.frameCount < 2} title="Next frame (])">▶</button>
        <button className="mini" disabled={!editable} onClick={() => ed.addFrame()} title={`New frame after ${fi + 1}, a copy of it (frame add)`} data-testid="frame-add">+</button>
        <button className="mini" disabled={!editable || doc.frameCount < 2} onClick={() => ed.removeFrame()} title={`Remove frame ${fi + 1} (frame remove)`} data-testid="frame-remove">✕</button>
      </div>
      <div className="tl-grid">
        <table>
          <tbody>
            {order.map((l) => {
              const layer = doc.layers[l]!;
              return (
                <tr key={layer.name} className={l === li ? 'on' : ''} data-layer={layer.name}>
                  {FLAGS.map((f) => (
                    <td key={f.key} className={`flag${layer[f.key] ? ' set' : ''}`}>
                      <button className="flagbtn" disabled={!editable} title={f.title} data-flag={f.key}
                        onClick={() => ed.act(`layer set ${layer.name} ${f.key}=${layer[f.key] ? 'off' : 'on'}`, { context: false })}>
                        {layer[f.key] ? f.on : f.off}
                      </button>
                    </td>
                  ))}
                  <td className="lname" onClick={() => ed.setLayer(layer.name)}
                    onDoubleClick={() => editable && setRenaming({ from: layer.name, to: layer.name })} title="Click to draw on this layer; double-click to rename">
                    {renaming?.from === layer.name ? (
                      <form onSubmit={(e) => {
                        e.preventDefault();
                        if (renaming.to && renaming.to !== layer.name) {
                          ed.act(`layer rename ${layer.name} ${renaming.to}`, { context: false });
                          if (ed.layerName === layer.name) ed.layerName = renaming.to;
                        }
                        setRenaming(null);
                      }}>
                        <input autoFocus value={renaming.to} aria-label="layer name" onChange={(e) => setRenaming({ ...renaming, to: e.target.value })}
                          onBlur={() => setRenaming(null)} onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(null); }} />
                      </form>
                    ) : layer.name}
                  </td>
                  {Array.from({ length: doc.frameCount }, (_, f) => (
                    <td key={f} className={`cel${f === fi ? ' fnow' : ''}${l === li && f === fi ? ' here' : ''}`} data-cel={`${layer.name}:${f + 1}`}
                      title={`${layer.name}, frame ${f + 1}`} onClick={() => { ed.setLayer(layer.name); ed.setFrame(f); }}>
                      {filled(l, f) ? '●' : '○'}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
