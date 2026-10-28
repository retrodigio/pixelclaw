// The timeline (plan §8.3, §4.4): layers (top first) by frames. Click a cel to draw on that layer
// and frame (yours alone: the page sends `layer` and `frame` with your next edit); Shift+click a
// frame number to choose a run of frames. Above the cels: each frame's ticks (double-click to
// change), the views (directions, with mirror links) and the tags. The bars add, move, merge and
// remove layers and frames; play a sequence at the game's speed; toggle the onion skin; and set
// ticks, tags, views and linked cels on the chosen frames. Every change is a command; playback and
// the onion skin are only for looking. [ and ] step through frames, Enter plays.

import { useState } from 'react';
import { TRANSPARENT, VIEW_NAMES, opposite, sequences, type Doc } from '@pixelclaw/core';
import { Editor } from './editor.ts';

const FLAGS = [
  { key: 'hidden', on: '◌', off: '◉', title: 'Hidden (not in the art): layer set … hidden=on|off' },
  { key: 'locked', on: '🔒︎', off: '·', title: 'Locked (refuses drawing): layer set … locked=on|off' },
  { key: 'reference', on: 'R', off: '·', title: 'Reference (a guide under the art, never exported): layer set … reference=on|off' },
] as const;

/** Runs of frames as table cells: each range spans its frames, gaps are empty cells. */
function spans<T extends { from: number; to: number }>(n: number, rs: T[]): ({ r: T; span: number } | { r: null; at: number })[] {
  const out: ({ r: T; span: number } | { r: null; at: number })[] = [];
  for (let f = 0; f < n;) {
    const r = rs.find((x) => x.from === f);
    if (r) { out.push({ r, span: r.to - r.from + 1 }); f = r.to + 1; } else { out.push({ r: null, at: f }); f++; }
  }
  return out;
}

export function TimelinePanel({ doc, ed, editable, frameShown }: { doc: Doc; ed: Editor; editable: boolean; frameShown: number }) {
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const [ticksAt, setTicksAt] = useState<{ f: number; v: string } | null>(null);
  const [tagName, setTagName] = useState('');
  // Collapsed rows (only for looking): the whole timeline, or its ticks, views, tags or layer rows.
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const fold = (k: string) => setFolded((x) => { const n = new Set(x); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const rowHead = (k: string, label: string, n?: number) => (
    <th colSpan={4} className="rowhead fold" data-testid={`tl-fold-${k}`} onClick={() => fold(k)} title={`${folded.has(k) ? 'Show' : 'Hide'} the ${label} row${n !== undefined ? 's' : ''} (only for looking)`}>
      {folded.has(k) ? '▸' : '▾'} {label}{folded.has(k) && n !== undefined ? ` (${n})` : ''}
    </th>
  );
  const li = ed.layerIndex(doc);
  const fi = ed.frameIndex(doc);
  const cur = doc.layers[li]!;
  const sel = ed.frames(doc);
  const inSel = (f: number) => sel.from <= f && f <= sel.to;
  const seqs = sequences(doc);
  const playSeq = seqs.find((s) => s.name === ed.playSeq) ?? seqs[0]!;
  if (ed.playSeq !== playSeq.name) ed.playSeq = playSeq.name;
  const filled = (l: number, f: number) => doc.cels[l]![f]!.some((v) => v !== TRANSPARENT);
  const linked = (l: number, f: number) => {
    const fr = doc.cels[l]!;
    return fr.flatMap((c, g) => (g !== f && c === fr[f] ? [g + 1] : []));
  };
  const mirrorOf = (f: number) => doc.views.find((v) => v.mirror && v.from <= f && f <= v.to) ?? null;
  const order = doc.layers.map((_, i) => i).reverse();
  const rangeText = Editor.rangeText(sel);
  const freeViews = VIEW_NAMES.filter((n) => !doc.views.some((v) => v.name === n));
  const mirrorable = doc.views.filter((v) => !v.mirror && opposite(v.name) && !doc.views.some((w) => w.name === opposite(v.name)));
  return (
    <div className={`timeline${folded.has('all') ? ' folded' : ''}`} data-testid="timeline">
      <div className="tl-bar">
        <button className="mini" data-testid="tl-fold-all" onClick={() => fold('all')} title={folded.has('all') ? 'Show the timeline' : 'Fold the timeline away (only for looking)'}>{folded.has('all') ? '▸' : '▾'}</button>
        <span className="tl-title">Layers</span>
        <button className="mini" disabled={!editable} onClick={() => ed.addLayer()} title={`New layer above ${cur.name} (layer add)`} data-testid="layer-add">+</button>
        <button className="mini" disabled={!editable || li === doc.layers.length - 1} onClick={() => ed.moveLayer(cur.name, 1)} title={`Move ${cur.name} up (layer move)`} data-testid="layer-up">↑</button>
        <button className="mini" disabled={!editable || li === 0} onClick={() => ed.moveLayer(cur.name, -1)} title={`Move ${cur.name} down (layer move)`} data-testid="layer-down">↓</button>
        <button className="mini" disabled={!editable || li === 0} onClick={() => ed.act(`layer merge ${cur.name}`, { context: false })} title={`Merge ${cur.name} into the layer below (layer merge)`} data-testid="layer-merge">⤓</button>
        <button className="mini" disabled={!editable || doc.layers.length < 2} onClick={() => ed.act(`layer remove ${cur.name}`, { context: false })} title={`Remove ${cur.name} (layer remove)`} data-testid="layer-remove">✕</button>
        <span className="spacer" />
        <span className="tl-title">Frames</span>
        <button className="mini" onClick={() => ed.stepFrame(-1)} disabled={doc.frameCount < 2} title="Previous frame ([)">◀</button>
        <span className="dim" data-testid="frame-now">{frameShown + 1} / {doc.frameCount}</span>
        <button className="mini" onClick={() => ed.stepFrame(1)} disabled={doc.frameCount < 2} title="Next frame (])">▶</button>
        <button className="mini" disabled={!editable} onClick={() => ed.addFrame()} title={`New frame after ${fi + 1}, a copy of it (frame add)`} data-testid="frame-add">+</button>
        <button className="mini" disabled={!editable || doc.frameCount < 2} onClick={() => ed.removeFrame()} title={`Remove frame ${fi + 1} (frame remove)`} data-testid="frame-remove">✕</button>
      </div>
      {!folded.has('all') && <div className="tl-bar tl-anim">
        <button className={`mini play${ed.playing ? ' on' : ''}`} data-testid="play" disabled={doc.frameCount < 2}
          onClick={() => ed.play(ed.playing ? null : playSeq.name)} title={`${ed.playing ? 'Stop' : 'Play'} ${playSeq.name} at the game's speed (Enter); only for looking`}>
          {ed.playing ? '⏸' : '▶'}
        </button>
        <select value={playSeq.name} data-testid="play-seq" title="The sequence to play: a view or a tag (all frames when there is neither)"
          onChange={(e) => { ed.playSeq = e.target.value; if (ed.playing) ed.play(e.target.value); else ed.play(null); }}>
          {seqs.map((s) => <option key={s.name} value={s.name}>{s.name}{s.loop === 'pingpong' ? ' ⇄' : ''}</option>)}
        </select>
        <span className="tl-title">Onion</span>
        <label className="chk" title="Show the frame before yours in its view or tag, tinted red, under yours (only for looking)">
          <input type="checkbox" checked={ed.onionPrev} data-testid="onion-prev" onChange={() => ed.toggle('onionPrev')} />◁
        </label>
        <label className="chk" title="Show the frame after yours in its view or tag, tinted blue, under yours (only for looking; with two frames, the one before)">
          <input type="checkbox" checked={ed.onionNext} data-testid="onion-next" onChange={() => ed.toggle('onionNext')} />▷
        </label>
        <label className="chk" title="Show the pivot and the ground line (set them with the ⌖ tool, P)">
          <input type="checkbox" checked={ed.guides} data-testid="guides" onChange={() => ed.toggle('guides')} />⌖
        </label>
        <span className="spacer" />
        <span className="tl-title" title="Shift+click frame numbers to choose several">Frames {rangeText}</span>
        <button className="mini" disabled={!editable} data-testid="link" title={`Link ${cur.name}'s cels on frames ${rangeText}: they share pixels (cel link)`} onClick={() => ed.link(doc, true)}>⛓</button>
        <button className="mini" disabled={!editable} data-testid="unlink" title={`Unlink ${cur.name}'s cels on frames ${rangeText} (cel unlink)`} onClick={() => ed.link(doc, false)}>⛓̸</button>
        <select value="" disabled={!editable} data-testid="view-set" title={`Make frames ${rangeText} a direction (view … frames=)`}
          onChange={(e) => { if (e.target.value) ed.setView(doc, e.target.value); }}>
          <option value="">view…</option>
          {VIEW_NAMES.filter((n) => freeViews.includes(n) || doc.views.some((v) => v.name === n && !v.mirror)).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value="" disabled={!editable || !mirrorable.length} data-testid="mirror-add" title="Add a direction that mirrors another live (view W mirror=E)"
          onChange={(e) => { const v = mirrorable.find((x) => x.name === e.target.value); if (v) ed.act(`view ${opposite(v.name)} mirror=${v.name}`, { context: false }); }}>
          <option value="">mirror…</option>
          {mirrorable.map((v) => <option key={v.name} value={v.name}>{opposite(v.name)} ⇋ {v.name}</option>)}
        </select>
        <form className="tagform" onSubmit={(e) => { e.preventDefault(); if (tagName.trim()) { ed.addTag(doc, tagName.trim(), 'cycle'); setTagName(''); } }}>
          <input value={tagName} disabled={!editable} placeholder="tag" aria-label="tag the chosen frames" data-testid="tag-name" onChange={(e) => setTagName(e.target.value)}
            title={`Name frames ${rangeText} (tag add; Enter)`} />
        </form>
      </div>}
      {!folded.has('all') && <div className="tl-grid">
        <table>
          <thead>
            <tr className="tl-ticks">
              {rowHead('ticks', 'frame · ticks')}
              {Array.from({ length: doc.frameCount }, (_, f) => (
                <th key={f} className={`fhead${f === frameShown ? ' fnow' : ''}${inSel(f) && ed.frameSel ? ' fsel' : ''}`} data-frame-head={f + 1}
                  onClick={(e) => ed.pickFrame(doc, f, e.shiftKey)}
                  onDoubleClick={() => editable && !mirrorOf(f) && setTicksAt({ f, v: String(doc.ticks[f]) })}
                  title={`Frame ${f + 1}: ${doc.ticks[f]} ticks. Click to draw on it, Shift+click to choose frames, double-click to change its ticks (frame set)`}>
                  <div>{f + 1}</div>
                  {folded.has('ticks') ? null : ticksAt?.f === f ? (
                    <form onSubmit={(e) => {
                      e.preventDefault();
                      const t = Number(ticksAt.v);
                      if (Number.isInteger(t) && t >= 1 && t !== doc.ticks[f]) ed.act(`frame set ${inSel(f) ? rangeText : f + 1} ticks=${t}`, { context: false });
                      setTicksAt(null);
                    }}>
                      <input autoFocus className="ticks-in" value={ticksAt.v} aria-label="ticks" data-testid="ticks-input"
                        onChange={(e) => setTicksAt({ f, v: e.target.value })} onBlur={() => setTicksAt(null)} onKeyDown={(e) => { if (e.key === 'Escape') setTicksAt(null); }} />
                    </form>
                  ) : <div className="ticks">{doc.ticks[f]}</div>}
                </th>
              ))}
            </tr>
            <tr className="tl-views">
              {rowHead('views', 'views', doc.views.length)}
              {folded.has('views') ? <th colSpan={doc.frameCount} /> : spans(doc.frameCount, doc.views).map((c) => c.r ? (
                <th key={`v${c.r.name}`} colSpan={c.span} className={`band view${c.r.mirror ? ' mirror' : ''}`} data-view={c.r.name}
                  title={c.r.mirror ? `View ${c.r.name}: a live mirror of ${c.r.mirror}` : `View ${c.r.name}: frames ${c.r.from + 1}-${c.r.to + 1}`}>
                  {c.r.mirror ? `${c.r.name} ⇋ ${c.r.mirror}` : c.r.name}
                  <button className="x" disabled={!editable} title={c.r.mirror ? `Unlink the mirror (view ${c.r.name} mirror=off)` : `Remove view ${c.r.name} (view remove)`}
                    onClick={() => ed.act(c.r!.mirror ? `view ${c.r!.name} mirror=off` : `view remove ${c.r!.name}`, { context: false })}>✕</button>
                </th>
              ) : <th key={`e${c.at}`} />)}
            </tr>
            {doc.tags.length > 0 && folded.has('tags') && (
              <tr className="tl-tags">{rowHead('tags', 'tags', doc.tags.length)}<th colSpan={doc.frameCount} /></tr>
            )}
            {!folded.has('tags') && doc.tags.map((t) => (
              <tr key={t.name} className="tl-tags">
                {t === doc.tags[0] ? rowHead('tags', 'tags', doc.tags.length) : <th colSpan={4} className="rowhead" />}
                {spans(doc.frameCount, [t]).map((c) => c.r ? (
                  <th key="t" colSpan={c.span} className="band tag" data-tag={t.name} title={`Tag ${t.name}: frames ${t.from + 1}-${t.to + 1}, ${t.loop}`}>
                    {t.name}
                    <button className="x" disabled={!editable} data-testid={`tag-loop-${t.name}`} title={`Loop: ${t.loop} (click for ${t.loop === 'cycle' ? 'pingpong' : 'cycle'}; tag set)`}
                      onClick={() => ed.act(`tag set ${t.name} loop=${t.loop === 'cycle' ? 'pingpong' : 'cycle'}`, { context: false })}>{t.loop === 'cycle' ? '↻' : '⇄'}</button>
                    <button className="x" disabled={!editable} title={`Remove tag ${t.name} (tag remove)`} onClick={() => ed.act(`tag remove ${t.name}`, { context: false })}>✕</button>
                  </th>
                ) : <th key={`e${c.at}`} />)}
              </tr>
            ))}
          </thead>
          <tbody>
            {doc.layers.length > 1 && (
              <tr className="tl-layers-head">{rowHead('layers', 'layers', doc.layers.length)}<th colSpan={doc.frameCount} /></tr>
            )}
            {(folded.has('layers') ? order.filter((l) => l === li) : order).map((l) => {
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
                  {Array.from({ length: doc.frameCount }, (_, f) => {
                    const links = linked(l, f);
                    const m = mirrorOf(f);
                    return (
                      <td key={f} className={`cel${f === frameShown ? ' fnow' : ''}${l === li && f === fi ? ' here' : ''}${inSel(f) && ed.frameSel ? ' fsel' : ''}${m ? ' mirrored' : ''}`}
                        data-cel={`${layer.name}:${f + 1}`} data-linked={links.length ? links.join(',') : undefined}
                        title={`${layer.name}, frame ${f + 1}${links.length ? `; linked with frame${links.length > 1 ? 's' : ''} ${links.join(', ')}` : ''}${m ? `; mirrors ${m.mirror} (draw there)` : ''}`}
                        onClick={(e) => { ed.setLayer(layer.name); ed.pickFrame(doc, f, e.shiftKey); }}>
                        {m ? '⇋' : links.length ? (filled(l, f) ? '◆' : '◇') : filled(l, f) ? '●' : '○'}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>}
    </div>
  );
}
