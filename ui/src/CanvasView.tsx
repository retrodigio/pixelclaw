// The canvas: one frame of the document at an integer zoom (1-64x), a checkerboard under
// transparent pixels, visible reference layers faded underneath, an optional pixel grid (from 4x)
// and cell grid. Pixels come from core's renderFlat, so they are exactly the colours the core
// renders. On wrap documents, "wrap ghosts" show half a tile of the neighbouring copies around the
// canvas (you can draw on them: the strokes wrap). A second canvas on top draws what is not art:
// your selection (marching ants), other authors' selections, symmetry guides, the marquee or lasso
// being dragged, notes and the hovered pixel. Notes also get a label with their id and text.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TRANSPARENT, flattenReference, renderFlat, rgbOf, type Doc, type Note } from '@pixelclaw/core';
import type { Pt, Rect } from './editor.ts';

export const ZOOMS = [1, 2, 3, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64];
const MAX_SIDE = 16384;
const CHECK_A = '#cccccc';
const CHECK_B = '#eeeeee';

/** The ghost margin around a wrap document: half a tile on each side. */
export function ghostMargin(doc: Doc, on: boolean): { mx: number; my: number } {
  return on && doc.wrap ? { mx: Math.ceil(doc.width / 2), my: Math.ceil(doc.height / 2) } : { mx: 0, my: 0 };
}

export function fitZoom(doc: Doc, w: number, h: number, ghosts = false): number {
  const { mx, my } = ghostMargin(doc, ghosts);
  let best = 1;
  for (const z of ZOOMS) if ((doc.width + 2 * mx) * z <= w && (doc.height + 2 * my) * z <= h) best = z;
  return best;
}

export function maxZoom(doc: Doc): number {
  return ZOOMS.filter((z) => Math.max(doc.width, doc.height) * z <= MAX_SIDE).at(-1) ?? 1;
}

export interface Overlay {
  /** Your selection (marching ants), shifted while it is dragged; other authors' selections (tinted). */
  mySel: Uint8Array | null;
  selOffset: Pt | null;
  otherSels: Uint8Array[];
  marquee: Rect | null;
  /** The marquee is an ellipse (ellipse select). */
  marqueeEllipse: boolean;
  lasso: Pt[] | null;
  /** Live symmetry axes as doubled coordinates (an axis at 11.5 is 23). */
  mirror: { x2: number | null; y2: number | null } | null;
  notes: Note[];
  activeNote: string | null;
  hover: Pt | null;
  /** A note's place waiting for its text. */
  draft: Rect | null;
}

export interface PointerHandlers {
  down(p: Pt, e: { alt: boolean; shift: boolean; button: number }): void;
  move(p: Pt | null): void;
  up(p: Pt | null): void;
}

interface Props {
  doc: Doc | null;
  frame: number;
  /** A number, or 'fit' to fill the space available. */
  zoom: number | 'fit';
  pixelGrid: boolean;
  cellGrid: boolean;
  ghosts: boolean;
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

/** Marching ants along the edges of a mask (between selected and unselected pixels). */
function maskAnts(g: CanvasRenderingContext2D, doc: Doc, m: Uint8Array, z: number, off: Pt): void {
  const path = new Path2D();
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < doc.width && y < doc.height && !!m[y * doc.width + x];
  for (let y = 0; y < doc.height; y++) for (let x = 0; x < doc.width; x++) {
    if (!on(x, y)) continue;
    const px = (x + off[0]) * z;
    const py = (y + off[1]) * z;
    if (!on(x, y - 1)) { path.moveTo(px, py + 0.5); path.lineTo(px + z, py + 0.5); }
    if (!on(x, y + 1)) { path.moveTo(px, py + z - 0.5); path.lineTo(px + z, py + z - 0.5); }
    if (!on(x - 1, y)) { path.moveTo(px + 0.5, py); path.lineTo(px + 0.5, py + z); }
    if (!on(x + 1, y)) { path.moveTo(px + z - 0.5, py); path.lineTo(px + z - 0.5, py + z); }
  }
  g.lineWidth = 1;
  g.setLineDash([4, 4]);
  for (const [colour, offset] of [['#ffffff', 0], ['#000000', 4]] as const) {
    g.strokeStyle = colour;
    g.lineDashOffset = offset;
    g.stroke(path);
  }
  g.setLineDash([]);
}

/** The document's art (and faded reference layers) at 1x, as a canvas. */
function oneX(doc: Doc, frame: number): HTMLCanvasElement {
  const one = document.createElement('canvas');
  one.width = doc.width;
  one.height = doc.height;
  const img = renderFlat(doc, frame);
  const ref = flattenReference(doc, frame);
  if (ref) {
    // Reference pixels under transparent art, half-way to the checkerboard.
    const pal = doc.palette.entries.map((e) => rgbOf(e.hex));
    for (let i = 0; i < ref.length; i++) {
      if (ref[i] === TRANSPARENT || img.data[i * 4 + 3]) continue;
      const c = pal[ref[i]!]!;
      img.data.set([c[0], c[1], c[2], 128], i * 4);
    }
  }
  one.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), doc.width, doc.height), 0, 0);
  return one;
}

function checker(g: CanvasRenderingContext2D, z: number, w: number, h: number): void {
  // Squares of half a pixel (at least 2 px), as in the core's render.
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
  g.fillRect(0, 0, w, h);
}

export function CanvasView(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const over = useRef<HTMLCanvasElement>(null);
  const ghost = useRef<HTMLCanvasElement>(null);
  const artRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const doc = p.doc;
  const z = !doc ? 1 : p.zoom === 'fit' ? fitZoom(doc, box.w - 48, box.h - 48, p.ghosts) : Math.min(p.zoom, maxZoom(doc));
  const { mx, my } = doc ? ghostMargin(doc, p.ghosts) : { mx: 0, my: 0 };

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
    checker(g, z, W, H);
    const one = oneX(doc, p.frame);
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
    // Wrap ghosts: the neighbouring copies of the tile, dimmed.
    const gc = ghost.current;
    if (gc && (mx || my)) {
      const GW = (doc.width + 2 * mx) * z;
      const GH = (doc.height + 2 * my) * z;
      if (gc.width !== GW) gc.width = GW;
      if (gc.height !== GH) gc.height = GH;
      const gg = gc.getContext('2d')!;
      gg.imageSmoothingEnabled = false;
      checker(gg, z, GW, GH);
      for (let ty = -1; ty <= 1; ty++) for (let tx = -1; tx <= 1; tx++) gg.drawImage(one, (mx + tx * doc.width) * z, (my + ty * doc.height) * z, W, H);
      gg.fillStyle = 'rgba(22,23,27,0.42)';
      gg.fillRect(0, 0, GW, GH);
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
    for (const m of o.otherSels) {
      // Selections other authors left on the document: their pixels tinted.
      g.fillStyle = 'rgba(108,196,255,0.2)';
      for (let i = 0; i < m.length; i++) if (m[i]) g.fillRect((i % doc.width) * z, Math.floor(i / doc.width) * z, z, z);
    }
    if (o.mySel) maskAnts(g, doc, o.mySel, z, o.selOffset ?? [0, 0]);
    if (o.mirror) {
      g.strokeStyle = 'rgba(80,220,255,0.9)';
      g.lineWidth = 1;
      g.setLineDash([6, 3]);
      g.beginPath();
      if (o.mirror.x2 !== null) { const x = Math.round(((o.mirror.x2 + 1) / 2) * z) + 0.5; g.moveTo(x, 0); g.lineTo(x, H); }
      if (o.mirror.y2 !== null) { const y = Math.round(((o.mirror.y2 + 1) / 2) * z) + 0.5; g.moveTo(0, y); g.lineTo(W, y); }
      g.stroke();
      g.setLineDash([]);
    }
    for (const n of o.notes) {
      const on = n.id === o.activeNote;
      g.fillStyle = on ? 'rgba(255,214,10,0.28)' : 'rgba(255,214,10,0.12)';
      g.fillRect(n.x * z, n.y * z, n.w * z, n.h * z);
      ants(g, n, z, '#ffd60a', '#3a2f00', on ? 2 : 1);
    }
    if (o.draft) ants(g, o.draft, z, '#ffd60a', '#000000', 2);
    if (o.marquee) {
      if (o.marqueeEllipse) {
        g.strokeStyle = '#ffffff';
        g.setLineDash([4, 4]);
        g.beginPath();
        g.ellipse((o.marquee.x + o.marquee.w / 2) * z, (o.marquee.y + o.marquee.h / 2) * z, (o.marquee.w * z) / 2, (o.marquee.h * z) / 2, 0, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
      }
      ants(g, o.marquee, z, '#ffffff', '#000000');
    }
    if (o.lasso && o.lasso.length > 1) {
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1;
      g.setLineDash([4, 4]);
      g.beginPath();
      o.lasso.forEach(([x, y], i) => (i ? g.lineTo((x + 0.5) * z, (y + 0.5) * z) : g.moveTo((x + 0.5) * z, (y + 0.5) * z)));
      g.stroke();
      g.setLineDash([]);
    }
    if (o.hover && z >= 4 && !p.travel) {
      const hx = ((o.hover[0] % doc.width) + doc.width) % doc.width;
      const hy = ((o.hover[1] % doc.height) + doc.height) % doc.height;
      g.strokeStyle = 'rgba(255,255,255,0.75)';
      g.lineWidth = 1;
      g.strokeRect(hx * z + 0.5, hy * z + 0.5, z - 1, z - 1);
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

  /** Document pixel under the pointer (relative to the art, so ghosts give coordinates past the edges). */
  const at = (e: React.PointerEvent): Pt => {
    const r = artRef.current!.getBoundingClientRect();
    return [Math.floor((e.clientX - r.left) / z), Math.floor((e.clientY - r.top) / z)];
  };
  const inDoc = (q: Pt): Pt | null => {
    if (!doc) return null;
    if (doc.wrap && (mx || my)) return q[0] >= -mx && q[1] >= -my && q[0] < doc.width + mx && q[1] < doc.height + my ? q : null;
    return q[0] >= 0 && q[1] >= 0 && q[0] < doc.width && q[1] < doc.height ? q : null;
  };
  const h = p.pointer;

  return (
    <div className={`stage${p.travel ? ' travel' : ''}`} ref={wrap}>
      {doc ? (
        <div
          className="frame-area"
          style={{ width: (doc.width + 2 * mx) * z, height: (doc.height + 2 * my) * z, cursor: h ? p.cursor : 'default' }}
          data-testid="frame-area"
          onPointerDown={(e) => {
            if (!h || e.button > 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            h.down(at(e), { alt: e.altKey, shift: e.shiftKey, button: e.button });
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
          {(mx > 0 || my > 0) && <canvas ref={ghost} className="ghosts" data-testid="ghosts" style={{ width: (doc.width + 2 * mx) * z, height: (doc.height + 2 * my) * z }} />}
          <div className="art" ref={artRef} style={{ left: mx * z, top: my * z, width: doc.width * z, height: doc.height * z }} data-testid="art">
            <canvas
              ref={canvas}
              data-testid="canvas"
              data-asset={p.asset ?? ''}
              data-seq={p.seq ?? ''}
              data-zoom={z}
              data-frame={p.frame}
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
        </div>
      ) : (
        <div className="empty">{p.asset ? 'Waiting for the first command…' : 'No assets yet. When the agent creates one, it appears here.'}</div>
      )}
    </div>
  );
}
