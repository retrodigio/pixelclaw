// The map editor (plan §4.11, §8.3): a map document drawn from the assets it names, at 1x or the
// game's scale. Painting terrain (brush, rectangle, erase), placing objects and tiles by name,
// moving and removing them are commands on the tape, written as you; the camera (the engine's
// screen around a cell) and the zoom only change what you see.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  TRANSPARENT, cameraOf, cameraRegion, composeMapDoc, entryBox, footprintOf, mapChecks, mapWorld, paintComposed, placedAt, type Doc, type Pt,
} from '@pixelclaw/core';
import type { Editor } from './editor.ts';
import type { Store } from './store.ts';

export type MapTool = 'brush' | 'rect' | 'erase' | 'place' | 'move' | 'remove' | 'camera';

const TOOLS: { id: MapTool; label: string; tip: string }[] = [
  { id: 'brush', label: '✎ paint', tip: 'Paint the terrain layer cell by cell (terrain <layer> brush …)' },
  { id: 'rect', label: '▭ rect', tip: 'Paint a rectangle of terrain; hold Shift to erase it (terrain <layer> rect …)' },
  { id: 'erase', label: '⌫ erase', tip: 'Erase the terrain layer cell by cell (terrain <layer> brush … erase)' },
  { id: 'place', label: '⊕ place', tip: 'Place the chosen asset by its anchor cell (place <asset> x,y)' },
  { id: 'move', label: '✣ move', tip: 'Drag something placed to another cell (move x,y x,y)' },
  { id: 'remove', label: '✕ remove', tip: 'Take away what is placed on a cell (remove x,y)' },
  { id: 'camera', label: '▣ camera', tip: 'Click to stand the camera there: the game\'s screen around that cell (only for looking)' },
];

export function MapEditor({ doc, store, ed, editable }: { doc: Doc; store: Store; ed: Editor; editable: boolean }) {
  const [tool, setTool] = useState<MapTool>('brush');
  const [scale, setScale] = useState(1);
  const [layer, setLayer] = useState<string | null>(null);
  const [asset, setAsset] = useState<string | null>(null);
  const [camera, setCamera] = useState<Pt | null>(null);
  const [showCam, setShowCam] = useState(false);
  const [marks, setMarks] = useState(false);
  const [hover, setHover] = useState<Pt | null>(null);
  const [drag, setDrag] = useState<{ from: Pt; to: Pt; cells: Pt[]; shift: boolean } | null>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const assets = store.assetDocs();
  const world = useMemo(() => mapWorld(assets), [store.getVersion()]);
  const composed = useMemo(() => composeMapDoc(doc, world), [doc, world]);
  const t = doc.map!.tile;
  const terrains = doc.layers.filter((l) => l.map?.kind === 'terrain').map((l) => l.name);
  const holders = doc.layers.filter((l) => l.map?.kind === 'objects' || l.map?.kind === 'tiles').map((l) => l.name);
  const placeable = assets.filter((a) => !a.doc.family && !a.doc.overlay && !a.doc.map && a.doc.cellW === t);
  const terrainLayer = layer && terrains.includes(layer) ? layer : terrains[0] ?? null;
  const placeLayer = layer && holders.includes(layer) ? layer : holders.find((n) => doc.layers.find((l) => l.name === n)!.map!.kind === 'objects') ?? holders[0] ?? null;
  const chosen = asset && placeable.some((a) => a.name === asset) ? asset : placeable.find((a) => a.doc.kind === 'object')?.name ?? placeable[0]?.name ?? null;
  const screen = cameraOf(store.style);
  const cam = camera && showCam ? cameraRegion(composed, camera[0], camera[1], screen[0], screen[1]) : null;
  const region = cam ? { x: cam.x, y: cam.y, w: cam.w, h: cam.h } : { x: 0, y: 0, w: doc.width, h: doc.height };
  const k = cam ? Math.max(scale, 2) : scale;
  const checks = useMemo(() => (marks ? mapChecks(doc, world, {}, composed) : []), [marks, doc, world, composed]);
  const marked = checks.filter((c) => !c.pass).flatMap((c) => c.groups.flatMap((g) => g.cells));

  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    const img = paintComposed(composed, { scale: k, region, marks: marked });
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d')!;
    g.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    const box = (x: number, y: number, w: number, h: number, colour: string, fill?: string) => {
      const X = (x - region.x) * t * k, Y = (y - region.y) * t * k;
      if (fill) { g.fillStyle = fill; g.fillRect(X, Y, w * t * k, h * t * k); }
      g.strokeStyle = colour;
      g.lineWidth = 2;
      g.strokeRect(X + 1, Y + 1, w * t * k - 2, h * t * k - 2);
    };
    if (drag && (tool === 'brush' || tool === 'erase')) for (const [x, y] of drag.cells) box(x, y, 1, 1, 'transparent', tool === 'erase' ? 'rgba(255,80,80,0.35)' : 'rgba(80,220,255,0.35)');
    if (drag && tool === 'rect') {
      const r = norm(drag.from, drag.to);
      box(r.x, r.y, r.w, r.h, drag.shift ? '#ff5050' : '#50dcff', drag.shift ? 'rgba(255,80,80,0.2)' : 'rgba(80,220,255,0.2)');
    }
    if (drag && tool === 'move') {
      const p = placedAt(doc, doc.layers.findIndex((l) => l.name === (placeLayer ?? '')), drag.from[0], drag.from[1]);
      if (p) {
        const e = doc.map!.entries[p.entry]!;
        const b = entryBox(e, p.x + drag.to[0] - drag.from[0], p.y + drag.to[1] - drag.from[1]);
        box(b.x, b.y, b.w, b.h, '#ffd84a', 'rgba(255,216,74,0.25)');
      }
    }
    if (hover && !drag) {
      if (tool === 'place' && chosen) {
        const fp = footprintOf(assets.find((a) => a.name === chosen)!.doc);
        box(hover[0] - fp.anchor[0], hover[1] - fp.anchor[1], fp.cols, fp.rows, '#ffd84a');
      } else box(hover[0], hover[1], 1, 1, 'rgba(255,255,255,0.8)');
    }
    if (camera && !showCam) {
      const r = cameraRegion(composed, camera[0], camera[1], screen[0], screen[1]);
      box(r.x, r.y, r.w, r.h, '#ff4fd8');
    }
  });

  useEffect(() => { if (!editable && tool !== 'camera') setTool('camera'); }, [editable, tool]);

  const cellAt = (e: React.MouseEvent): Pt => {
    const r = ref.current!.getBoundingClientRect();
    return [region.x + Math.floor((e.clientX - r.left) / (t * k)), region.y + Math.floor((e.clientY - r.top) / (t * k))];
  };
  const inside = ([x, y]: Pt) => x >= 0 && y >= 0 && x < doc.width && y < doc.height;
  const send = (text: string) => ed.act(text, { context: false });

  const down = (e: React.MouseEvent) => {
    const p = cellAt(e);
    if (!inside(p)) return;
    if (tool === 'camera') { setCamera(p); return; }
    if (!editable) return;
    if (tool === 'place') {
      const a = assets.find((x) => x.name === chosen);
      if (!a || !placeLayer) return;
      const fp = footprintOf(a.doc);
      send(`place ${a.name} ${p[0]},${p[1]} layer=${placeLayer} cells=${fp.cols}x${fp.rows} anchor=${fp.anchor[0]},${fp.anchor[1]}`);
      return;
    }
    if (tool === 'remove') {
      const li = doc.layers.findIndex((l) => l.map?.kind === 'objects' || l.map?.kind === 'tiles');
      if (li >= 0) send(`remove ${p[0]},${p[1]}`);
      return;
    }
    setDrag({ from: p, to: p, cells: [p], shift: e.shiftKey });
  };
  const move = (e: React.MouseEvent) => {
    const p = cellAt(e);
    setHover(inside(p) ? p : null);
    if (!drag) return;
    const last = drag.cells[drag.cells.length - 1]!;
    if (p[0] === last[0] && p[1] === last[1]) return;
    setDrag({ ...drag, to: p, cells: tool === 'brush' || tool === 'erase' ? [...drag.cells, p] : drag.cells, shift: drag.shift || e.shiftKey });
  };
  const up = () => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if ((tool === 'brush' || tool === 'erase') && terrainLayer) {
      // Consecutive cells only (the brush draws lines between them), each cell once.
      const pts = d.cells.filter((c, i) => i === 0 || c[0] !== d.cells[i - 1]![0] || c[1] !== d.cells[i - 1]![1]);
      send(`terrain ${terrainLayer} brush ${pts.map((c) => `${c[0]},${c[1]}`).join(' ')} size=1${tool === 'erase' ? ' erase' : ''}`);
    } else if (tool === 'rect' && terrainLayer) {
      const r = norm(d.from, d.to);
      send(`terrain ${terrainLayer} rect ${r.x},${r.y} ${r.w}x${r.h}${d.shift ? ' erase' : ''}`);
    } else if (tool === 'move') {
      const li = doc.layers.findIndex((l) => l.name === placeLayer);
      const p = placedAt(doc, li, d.from[0], d.from[1]) ?? doc.layers.map((_, i) => placedAt(doc, i, d.from[0], d.from[1])).find(Boolean) ?? null;
      if (!p || (d.to[0] === d.from[0] && d.to[1] === d.from[1])) return;
      send(`move ${p.x},${p.y} ${p.x + d.to[0] - d.from[0]},${p.y + d.to[1] - d.from[1]} layer=${doc.layers[p.layer]!.name}`);
    }
  };

  const hovered = hover ? describe(doc, composed, hover) : '';
  return (
    <div className="map-editor" data-testid="map-editor">
      <div className="family-head map-tools">
        <span className="seg" data-testid="map-tools">
          {TOOLS.map((x) => (
            <button key={x.id} className={tool === x.id ? 'on' : ''} data-tool={x.id} title={x.tip} disabled={!editable && x.id !== 'camera'} onClick={() => setTool(x.id)}>{x.label}</button>
          ))}
        </span>
        {(tool === 'brush' || tool === 'rect' || tool === 'erase') && (
          <select value={terrainLayer ?? ''} onChange={(e) => setLayer(e.target.value)} data-testid="map-terrain" title="The terrain layer you paint (its family's scheme picks the edge tiles)">
            {terrains.map((n) => <option key={n}>{n}</option>)}
          </select>
        )}
        {(tool === 'place' || tool === 'move') && (
          <select value={placeLayer ?? ''} onChange={(e) => setLayer(e.target.value)} data-testid="map-layer" title="The tiles or objects layer you place on">
            {holders.map((n) => <option key={n}>{n}</option>)}
          </select>
        )}
        {tool === 'place' && (
          <select value={chosen ?? ''} onChange={(e) => setAsset(e.target.value)} data-testid="map-asset" title="What you place (objects and tiles of the map's cell size)">
            {placeable.map((a) => <option key={a.name} value={a.name}>{a.name} {a.doc.width}×{a.doc.height}</option>)}
          </select>
        )}
        <span className="spacer" />
        <span className="seg" title="The map at 1x or at the game's scale (only for looking)">
          {[1, 2].map((z) => <button key={z} className={scale === z ? 'on' : ''} data-testid={`map-zoom-${z}`} onClick={() => setScale(z)}>{z}×</button>)}
        </span>
        <label className="chk" title="Show only the camera's screen, at the game's scale (only for looking)">
          <input type="checkbox" checked={showCam} disabled={!camera} data-testid="map-camera-view" onChange={(e) => setShowCam(e.target.checked)} /> camera view
        </label>
        <label className="chk" title="Outline the cells the map checks flag (only for looking)">
          <input type="checkbox" checked={marks} data-testid="map-marks" onChange={(e) => setMarks(e.target.checked)} /> hot spots
        </label>
      </div>
      <div className="dim map-text" data-testid="map-status">
        {doc.width}×{doc.height} cells of {t} px{camera ? ` · camera at ${camera[0]},${camera[1]} (${screen[0]}×${screen[1]} px)` : ''}{hovered ? ` · ${hovered}` : ''}
        {marks && ` · ${checks.filter((c) => !c.pass).map((c) => `${c.id} ✗`).join(' ') || 'map checks pass'}`}
      </div>
      <div className="map-body">
        <canvas ref={ref} data-testid="map-edit-canvas" style={{ cursor: tool === 'move' ? 'move' : 'crosshair' }}
          onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={() => { setHover(null); up(); }} />
      </div>
    </div>
  );
}

function norm(a: Pt, b: Pt): { x: number; y: number; w: number; h: number } {
  const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]);
  return { x, y, w: Math.abs(a[0] - b[0]) + 1, h: Math.abs(a[1] - b[1]) + 1 };
}

/** The cell under the pointer in words: its ground tile and anything placed on it. */
function describe(doc: Doc, c: ReturnType<typeof composeMapDoc>, [x, y]: Pt): string {
  const g = c.top[y * doc.width + x];
  const things = doc.layers.flatMap((l, li) => {
    if (l.map?.kind !== 'objects' && l.map?.kind !== 'tiles') return [];
    const p = placedAt(doc, li, x, y);
    if (!p || p.layer !== li) return [];
    const e = doc.map!.entries[p.entry]!;
    return [`${e.name}${e.variant ? `.${e.variant}` : ''} (anchor ${p.x},${p.y})`];
  });
  const cel = doc.cels.map((fr) => fr[0]![y * doc.width + x]);
  void cel; void TRANSPARENT;
  return `${x},${y}: ${g ? `${g.asset}${g.variant ? `.${g.variant}` : ''}` : 'nothing'}${things.length ? ` · ${[...new Set(things)].join(', ')}` : ''}`;
}
