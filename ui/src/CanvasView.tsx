// The canvas: the document at an integer zoom (1-64x), a checkerboard under transparent pixels,
// an optional pixel grid (from 4x) and cell grid. Pixels come from core's renderFlat, so they are
// exactly the colours the core renders.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { renderFlat, type Doc } from '@pixelclaw/core';

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

interface Props {
  doc: Doc | null;
  /** A number, or 'fit' to fill the space available. */
  zoom: number | 'fit';
  pixelGrid: boolean;
  cellGrid: boolean;
  seq: number | null;
  asset: string | null;
  travel: boolean;
  onZoom(z: number | 'fit'): void;
  onEffectiveZoom(z: number): void;
}

export function CanvasView(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
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

  return (
    <div className={`stage${p.travel ? ' travel' : ''}`} ref={wrap}>
      {doc ? (
        <canvas
          ref={canvas}
          data-testid="canvas"
          data-asset={p.asset ?? ''}
          data-seq={p.seq ?? ''}
          data-zoom={z}
          style={{ width: doc.width * z, height: doc.height * z }}
        />
      ) : (
        <div className="empty">{p.asset ? 'Waiting for the first command…' : 'No assets yet. When the agent creates one, it appears here.'}</div>
      )}
    </div>
  );
}
