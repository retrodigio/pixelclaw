// The canvas: the document at an integer zoom (1-64x), a checkerboard under transparent pixels,
// an optional pixel grid (from 4x) and cell grid. Pixels come from core's renderFlat, so they are
// exactly the colours the core renders. A second canvas on top draws what is not art: the
// selection, the marquee being dragged, the agent's selection, notes and the hovered pixel. Notes
// also get a label on the canvas with their id and text.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { renderFlat, type Doc, type Note } from '@pixelclaw/core';
import type { Pt, Rect } from './editor.ts';

export const ZOOMS = [1, 2, 3, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64];
const MAX_SIDE = 16384;
const CHECK_A = '#cccccc';
const CHECK_B = '#eeeeee';

export function fitZoom(doc: Doc, w: number, h: number): number {
  let best = 1;
  for (const z of ZOOMS) if (doc.width * z <= w && doc.height * z <= h) best = z;
  return best;
}

export function maxZoom(doc: Doc): number {
  return ZOOMS.filter((z) => Math.max(doc.width, doc.height) * z <= MAX_SIDE).at(-1) ?? 1;
}

export interface Overlay {
  /** The page's selection, and a marquee being dragged. */
  sel: Rect | null;
  marquee: Rect | null;
  notes: Note[];
  activeNote: string | null;
  hover: Pt | null;
  /** A note's place waiting for its text. */
  draft: Rect | null;
}

export interface PointerHandlers {
  down(p: Pt, e: { alt: boolean; button: number }): void;
  move(p: Pt | null): void;
  up(p: Pt | null): void;
}

interface Props {
  doc: Doc | null;
  /** A number, or 'fit' to fill the space available. */
  zoom: number | 'fit';
  pixelGrid: boolean;
  cellGrid: boolean;
  seq: number | null;
  asset: string | null;
  travel: boolean;
  overlay: Overlay;
  /** Pointer input in document pixels, when the page may edit. */
  pointer: PointerHandlers | null;
  cursor: string;
  onNote(id: string | null): void;
  onZoom(z: number | 'fit'): void;
  onEffectiveZoom(z: number): void;
}

/** A dashed rectangle around pixels x..x+w, y..y+h at zoom z, in two colours so it shows on anything. */
function ants(g: CanvasRenderingContext2D, r: Rect, z: number, a: string, b: string, width = 1): void {
  g.lineWidth = width;
  g.setLineDash([4, 4]);
  for (const [colour, offset] of [[a, 0], [b, 4]] as const) {
    g.strokeStyle = colour;
    g.lineDashOffset = offset;
    g.strokeRect(r.x * z + width / 2, r.y * z + width / 2, r.w * z - width, r.h * z - width);
  }
  g.setLineDash([]);
}

export function CanvasView(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const over = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const doc = p.doc;
  const z = !doc ? 1 : p.zoom === 'fit' ? fitZoom(doc, box.w - 48, box.h - 48) : Math.min(p.zoom, maxZoom(doc));

  useEffect(() => {
    p.onEffectiveZoom(z);
  }, [z]);

  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c || !doc) return;
    const W = doc.width * z;
    const H = doc.height * z;
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    // Checkerboard: squares of half a pixel (at least 2 px), as in the core's render.
    const sq = Math.max(2, z >> 1);
    const tile = document.createElement('canvas');
    tile.width = tile.height = sq * 2;
    const tg = tile.getContext('2d')!;
    tg.fillStyle = CHECK_B;
    tg.fillRect(0, 0, sq * 2, sq * 2);
    tg.fillStyle = CHECK_A;
    tg.fillRect(sq, 0, sq, sq);
    tg.fillRect(0, sq, sq, sq);
    g.fillStyle = g.createPattern(tile, 'repeat')!;
    g.fillRect(0, 0, W, H);
    // The document at 1x, then scaled up with nearest-neighbour.
    const img = renderFlat(doc);
    const one = document.createElement('canvas');
    one.width = doc.width;
    one.height = doc.height;
    one.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), doc.width, doc.height), 0, 0);
    g.drawImage(one, 0, 0, W, H);
    if (p.pixelGrid && z >= 4) {
      for (let x = 1; x < doc.width; x++) {
        g.fillStyle = x % 8 === 0 ? 'rgba(20,20,28,0.45)' : 'rgba(20,20,28,0.18)';
        g.fillRect(x * z, 0, 1, H);
      }
      for (let y = 1; y < doc.height; y++) {
        g.fillStyle = y % 8 === 0 ? 'rgba(20,20,28,0.45)' : 'rgba(20,20,28,0.18)';
        g.fillRect(0, y * z, W, 1);
      }
    }
    if (p.cellGrid && (doc.cellW < doc.width || doc.cellH < doc.height)) {
      // Two device pixels wide from 8x, astride the boundary (pixel centres stay clear).
      const t = z >= 8 ? 2 : 1;
      g.fillStyle = 'rgba(255,79,216,0.9)';
      for (let x = doc.cellW; x < doc.width; x += doc.cellW) g.fillRect(x * z - (t >> 1), 0, t, H);
      for (let y = doc.cellH; y < doc.height; y += doc.cellH) g.fillRect(0, y * z - (t >> 1), W, t);
    }
  });

  // The overlay: everything that is not art.
  useLayoutEffect(() => {
    const c = over.current;
    if (!c || !doc) return;
    const W = doc.width * z;
    const H = doc.height * z;
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, W, H);
    const o = p.overlay;
    if (doc.sel) {
      // A selection the agent left on the document: its pixels tinted.
      g.fillStyle = 'rgba(108,196,255,0.22)';
      for (let i = 0; i < doc.sel.length; i++) if (doc.sel[i]) g.fillRect((i % doc.width) * z, Math.floor(i / doc.width) * z, z, z);
    }
    for (const n of o.notes) {
      const on = n.id === o.activeNote;
      g.fillStyle = on ? 'rgba(255,214,10,0.28)' : 'rgba(255,214,10,0.12)';
      g.fillRect(n.x * z, n.y * z, n.w * z, n.h * z);
      ants(g, n, z, '#ffd60a', '#3a2f00', on ? 2 : 1);
    }
    if (o.draft) ants(g, o.draft, z, '#ffd60a', '#000000', 2);
    if (o.sel) ants(g, o.sel, z, '#ffffff', '#000000');
    if (o.marquee) ants(g, o.marquee, z, '#ffffff', '#000000');
    if (o.hover && z >= 4 && !p.travel) {
      g.strokeStyle = 'rgba(255,255,255,0.75)';
      g.lineWidth = 1;
      g.strokeRect(o.hover[0] * z + 0.5, o.hover[1] * z + 0.5, z - 1, z - 1);
    }
  });

  // Ctrl/Cmd + wheel zooms. A native listener, because React's wheel listeners are passive.
  const onWheel = useRef<(e: WheelEvent) => void>(() => {});
  onWheel.current = (e) => {
    if (!doc || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const i = ZOOMS.indexOf(z);
    const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + (e.deltaY < 0 ? 1 : -1)))]!;
    p.onZoom(Math.min(next, maxZoom(doc)));
  };
  useEffect(() => {
    const el = wrap.current!;
    const h = (e: WheelEvent) => onWheel.current(e);
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);

  const at = (e: React.PointerEvent): Pt => {
    const r = e.currentTarget.getBoundingClientRect();
    return [Math.floor((e.clientX - r.left) / z), Math.floor((e.clientY - r.top) / z)];
  };
  const inDoc = (q: Pt): Pt | null => (doc && q[0] >= 0 && q[1] >= 0 && q[0] < doc.width && q[1] < doc.height ? q : null);
  const h = p.pointer;

  return (
    <div className={`stage${p.travel ? ' travel' : ''}`} ref={wrap}>
      {doc ? (
        <div
          className="art"
          style={{ width: doc.width * z, height: doc.height * z, cursor: h ? p.cursor : 'default' }}
          data-testid="art"
          onPointerDown={(e) => {
            if (!h || e.button > 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            h.down(at(e), { alt: e.altKey, button: e.button });
          }}
          onPointerMove={(e) => {
            if (!h) return;
            // While dragging, points past the edge still count (lines and boxes may run off it).
            const q = at(e);
            h.move(e.buttons ? q : inDoc(q));
          }}
          onPointerUp={(e) => h?.up(at(e))}
          onPointerCancel={() => h?.up(null)}
          onPointerLeave={(e) => { if (!e.buttons) h?.move(null); }}
        >
          <canvas
            ref={canvas}
            data-testid="canvas"
            data-asset={p.asset ?? ''}
            data-seq={p.seq ?? ''}
            data-zoom={z}
            style={{ width: doc.width * z, height: doc.height * z }}
          />
          <canvas ref={over} className="overlay" style={{ width: doc.width * z, height: doc.height * z }} />
          {p.overlay.notes.map((n) => (
            <div
              key={n.id}
              className={`note-label${n.id === p.overlay.activeNote ? ' on' : ''}`}
              data-note={n.id}
              style={{ left: n.x * z, top: n.y * z }}
              title={`${n.id} at ${n.x},${n.y}${n.w > 1 || n.h > 1 ? ` ${n.w}x${n.h}` : ''}: ${n.text}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => p.onNote(n.id === p.overlay.activeNote ? null : n.id)}
            >
              <b>{n.id}</b> {n.id === p.overlay.activeNote || n.text.length <= 28 ? n.text : n.text.slice(0, 26) + '…'}
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">{p.asset ? 'Waiting for the first command…' : 'No assets yet. When the agent creates one, it appears here.'}</div>
      )}
    </div>
  );
}
