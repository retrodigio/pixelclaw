// Import into the gallery (plan §21 item 4): drop a PNG sheet, a folder of PNGs or an .aseprite
// file on the dashboard or the gallery (or pick files). A sheet gets the slice dialog: the cell
// size, the offset to the first cell and the gap between cells, drawn over the image; names from a
// pattern or from the manifest's planned entries (in reading order); quantise to a project palette
// or adopt the image's. Empty cells are skipped. The server makes the assets (their tapes start
// with `import`), adds manifest entries and runs every check; the result lists what each found.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_SLICE_PATTERN, assetIdent, sliceCells, sliceNames, type SliceCell } from '@pixelclaw/core';
import type { PlanReport } from '@pixelclaw/server/protocol';
import type { ImportAnswer, ImportChoice, Store } from './store.ts';

const ACCEPT = /\.(png|aseprite|ase)$/i;

/** Every file in a drop, folders read through (one level of nesting is plenty for a set). */
async function dropFiles(dt: DataTransfer): Promise<File[]> {
  const out: File[] = [];
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  if (!entries.length) return [...dt.files].filter((f) => ACCEPT.test(f.name));
  const walk = async (e: FileSystemEntry): Promise<void> => {
    if (e.isFile) {
      const f = await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej));
      if (ACCEPT.test(f.name)) out.push(f);
    } else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader();
      const all: FileSystemEntry[] = [];
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        all.push(...batch);
      }
      for (const c of all.sort((a, b) => a.name.localeCompare(b.name))) await walk(c);
    }
  };
  for (const e of entries) await walk(e);
  return out;
}

/** Wraps a view: files dropped anywhere on it open the import dialog. */
export function ImportDrop({ store, plan, children }: { store: Store; plan: PlanReport; children: ReactNode }) {
  const [files, setFiles] = useState<File[] | null>(null);
  const [over, setOver] = useState(false);
  return (
    <div className={`drop-zone${over ? ' over' : ''}`} data-testid="drop-zone"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }}
      onDrop={(e) => { e.preventDefault(); setOver(false); void dropFiles(e.dataTransfer).then((f) => { if (f.length) setFiles(f); }); }}>
      {children}
      {over && <div className="drop-hint">Drop a sheet, a folder of PNGs or an .aseprite file to import it</div>}
      {files && <ImportDialog files={files} store={store} plan={plan} onClose={() => setFiles(null)} />}
    </div>
  );
}

/** "Import…": pick files the same way. */
export function ImportButton({ store, plan }: { store: Store; plan: PlanReport }) {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[] | null>(null);
  return (
    <>
      <button onClick={() => input.current?.click()} data-testid="import-open" title="Import a PNG sheet, PNGs or an .aseprite file into the gallery (or drop them on the page)">Import…</button>
      <input ref={input} type="file" accept=".png,.aseprite,.ase" multiple hidden data-testid="import-input"
        onChange={(e) => { const f = [...(e.target.files ?? [])].filter((x) => ACCEPT.test(x.name)); e.target.value = ''; if (f.length) setFiles(f); }} />
      {files && <ImportDialog files={files} store={store} plan={plan} onClose={() => setFiles(null)} />}
    </>
  );
}

const num = (s: string, d = 0) => (/^\d+$/.test(s.trim()) ? Number(s) : d);

function ImportDialog({ files, store, plan, onClose }: { files: File[]; store: Store; plan: PlanReport; onClose(): void }) {
  const sheet = files.length === 1 && /\.png$/i.test(files[0]!.name) ? files[0]! : null;
  const grid = 24;
  const [img, setImg] = useState<{ url: string; w: number; h: number; alpha: Uint8ClampedArray } | null>(null);
  const [cell, setCell] = useState({ w: String(grid), h: String(grid) });
  const [offset, setOffset] = useState({ x: '0', y: '0' });
  const [gap, setGap] = useState({ x: '0', y: '0' });
  const [slice, setSlice] = useState(true);
  const [naming, setNaming] = useState<'pattern' | 'manifest'>('pattern');
  const [pattern, setPattern] = useState(DEFAULT_SLICE_PATTERN);
  const [kind, setKind] = useState('tile');
  const sets = plan.sets.filter((s) => s.name !== 'unplanned').map((s) => s.name);
  const [set, setSet] = useState(sets[0] ?? '');
  const [palette, setPalette] = useState(store.defaultPalette ?? [...store.palettes.keys()][0] ?? '');
  const [adopt, setAdopt] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportAnswer | null>(null);

  useEffect(() => {
    if (!sheet) return;
    const url = URL.createObjectURL(sheet);
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas');
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      const g = c.getContext('2d')!;
      g.drawImage(im, 0, 0);
      const data = g.getImageData(0, 0, c.width, c.height).data;
      const alpha = new Uint8ClampedArray(c.width * c.height);
      for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3]!;
      setImg({ url, w: c.width, h: c.height, alpha });
      if (c.width <= grid && c.height <= grid) setSlice(false);
    };
    im.src = url;
    return () => URL.revokeObjectURL(url);
  }, [sheet]);

  const cw = num(cell.w, 1), ch = num(cell.h, 1);
  const cells: SliceCell[] = useMemo(() => (img && slice ? sliceCells(img.w, img.h, { cell: [cw, ch], offset: [num(offset.x), num(offset.y)], gap: [num(gap.x), num(gap.y)] }) : []), [img, slice, cw, ch, offset, gap]);
  const filled = useMemo(() => {
    if (!img) return [] as boolean[];
    return cells.map((c) => {
      for (let y = c.y; y < c.y + ch; y++) for (let x = c.x; x < c.x + cw; x++) if (img.alpha[y * img.w + x]! >= 128) return true;
      return false;
    });
  }, [cells, img]);
  const kept = cells.filter((_, i) => filled[i]);
  const base = assetIdent((files[0]?.name ?? 'imported').replace(/\.[^.]+$/, ''));
  const planned = plan.assets.filter((a) => a.planned && !a.exists && (!set || a.set === set)).map((a) => a.name);
  const names: string[] | string = sheet && slice
    ? (naming === 'manifest' ? sliceNames(kept, { base, names: planned }) : sliceNames(kept, { base, pattern }))
    : files.map((f) => assetIdent(f.name.replace(/\.[^.]+$/, '')));

  const go = async () => {
    setBusy(true);
    const choice: ImportChoice = {
      kind, ...(set ? { set } : {}), ...(adopt ? { build: true } : { palette }), ...(kind === 'tile' && wrap ? { wrap: true } : {}),
      ...(sheet && slice ? { slice: { cell: [cw, ch], offset: [num(offset.x), num(offset.y)], gap: [num(gap.x), num(gap.y)] }, ...(naming === 'manifest' ? { names: names as string[] } : { pattern }) } : {}),
    };
    const r = await store.importFiles(files, choice);
    setBusy(false);
    setResult(r);
  };

  const scale = img ? Math.max(1, Math.min(6, Math.floor(420 / Math.max(img.w, img.h)))) : 1;
  return (
    <div className="dialog-back" onClick={onClose}>
      <div className="dialog import" data-testid="import-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="panel-title">Import {files.length === 1 ? files[0]!.name : `${files.length} files`}</div>
        {result ? (
          <div className="import-result" data-testid="import-result">
            {result.error ? <div className="banner error">{result.error}</div> : (
              <>
                <p>{result.created?.length ?? 0} asset{result.created?.length === 1 ? '' : 's'} made{result.added?.length ? `; ${result.added.length} added to the plan` : ''}. Each has had every check run:</p>
                <ul className="import-list">
                  {result.created?.map((c) => (
                    <li key={c.name} data-testid={`imported-${c.name}`}>
                      <b className="mono">{c.name}</b> <span className="dim">{c.kind} {c.size}</span>{' '}
                      {c.failing.length ? c.failing.map((id) => <span key={id} className="chk fail">{id}</span>) : <span className="chk pass">{c.checks} checks ✓</span>}
                      {c.inexact > 0 && <span className="dim"> · {c.inexact} px to the nearest colour</span>}
                    </li>
                  ))}
                </ul>
                {result.notes?.map((n) => <div key={n} className="dim">{n}</div>)}
              </>
            )}
            <div className="card-actions"><button onClick={onClose} data-testid="import-close">Close</button>{!result.error && <button onClick={() => { onClose(); store.setTab('gallery'); }}>Show in the gallery</button>}</div>
          </div>
        ) : (
          <div className="import-body">
            {sheet && img && (
              <div className="slice-view" style={{ width: img.w * scale, height: img.h * scale }}>
                <img src={img.url} alt="" style={{ width: img.w * scale, height: img.h * scale }} />
                {cells.map((c, i) => (
                  <div key={i} className={`slice-cell${filled[i] ? '' : ' empty'}`} style={{ left: c.x * scale, top: c.y * scale, width: cw * scale, height: ch * scale }}
                    title={filled[i] ? (Array.isArray(names) ? names[kept.indexOf(c)] : '') : 'empty: skipped'}>
                    {filled[i] && Array.isArray(names) && scale * cw >= 40 && <span>{names[kept.indexOf(c)]}</span>}
                  </div>
                ))}
              </div>
            )}
            <div className="import-form">
              {sheet && (
                <>
                  <label className="row"><input type="checkbox" checked={slice} onChange={(e) => setSlice(e.target.checked)} data-testid="slice-on" /> slice into one asset per cell</label>
                  {slice && (
                    <>
                      <label>cell <input value={cell.w} onChange={(e) => setCell({ ...cell, w: e.target.value })} size={3} data-testid="cell-w" /> x <input value={cell.h} onChange={(e) => setCell({ ...cell, h: e.target.value })} size={3} data-testid="cell-h" /></label>
                      <label>offset <input value={offset.x} onChange={(e) => setOffset({ ...offset, x: e.target.value })} size={3} /> , <input value={offset.y} onChange={(e) => setOffset({ ...offset, y: e.target.value })} size={3} /></label>
                      <label>gap <input value={gap.x} onChange={(e) => setGap({ ...gap, x: e.target.value })} size={3} /> , <input value={gap.y} onChange={(e) => setGap({ ...gap, y: e.target.value })} size={3} /></label>
                      <div className="row">names
                        <label><input type="radio" checked={naming === 'pattern'} onChange={() => setNaming('pattern')} /> pattern</label>
                        <input value={pattern} onChange={(e) => setPattern(e.target.value)} disabled={naming !== 'pattern'} data-testid="pattern" />
                        <label title="The planned, undrawn entries of the set, in order"><input type="radio" checked={naming === 'manifest'} onChange={() => setNaming('manifest')} data-testid="names-manifest" /> the plan's entries</label>
                      </div>
                    </>
                  )}
                </>
              )}
              <label>kind <select value={kind} onChange={(e) => setKind(e.target.value)} data-testid="import-kind">{['tile', 'sprite', 'object', 'icon', 'sheet'].map((k) => <option key={k}>{k}</option>)}</select></label>
              {kind === 'tile' && <label className="row"><input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} /> seamless (wrap)</label>}
              <label>set <select value={set} onChange={(e) => setSet(e.target.value)} data-testid="import-set"><option value="">(its kind)</option>{sets.map((s) => <option key={s}>{s}</option>)}</select></label>
              <div className="row">colours
                <label><input type="radio" checked={!adopt} onChange={() => setAdopt(false)} /> quantise to</label>
                <select value={palette} onChange={(e) => setPalette(e.target.value)} disabled={adopt}>{[...store.palettes.keys()].map((p) => <option key={p}>{p}</option>)}</select>
                <label><input type="radio" checked={adopt} onChange={() => setAdopt(true)} data-testid="adopt" /> adopt the image's</label>
              </div>
              <div className="import-names" data-testid="import-names">
                {typeof names === 'string' ? <span className="flag">{names}</span>
                  : <>{names.length} asset{names.length === 1 ? '' : 's'}: <span className="mono">{names.join(', ')}</span>{sheet && slice && cells.length > kept.length && <span className="dim"> ({cells.length - kept.length} empty cells skipped)</span>}</>}
              </div>
              <div className="card-actions">
                <button className="ask-claude" disabled={busy || typeof names === 'string' || !names.length} onClick={() => void go()} data-testid="import-go">{busy ? 'Importing…' : 'Import'}</button>
                <button onClick={onClose}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
