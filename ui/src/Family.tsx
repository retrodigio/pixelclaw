// The family views (plan §4.2, §4.3, §8.3): for a family document the middle of the page can show
// every variant among its neighbours (the 3x3 map that resolves to it), with pieces and detached
// variants marked, or a sample map built with the scheme, with its seam score and any overlays
// playing at the game's speed. Detaching, attaching, laying out the coverage map and cutting from
// it are commands on the tape; choosing the map's size and seed, the overlays and playing only
// change what you see.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { drawScaleOf, mapText, renderMap, renderVariant, schemeOf, type Doc, type Rgba, type Theme } from '@pixelclaw/core';
import { Editor } from './editor.ts';
import type { Store } from './store.ts';

/** An RGBA image on a canvas, drawn at a whole-number scale with CSS. */
function Img({ img, k = 1, testid }: { img: Rgba; k?: number; testid?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  }, [img]);
  return <canvas ref={ref} data-testid={testid} style={{ width: img.width * k, height: img.height * k }} />;
}

export type FamilyMode = 'sheet' | 'variants' | 'map';

export function FamilyVariants({ doc, ed, editable, frame, theme }: { doc: Doc; ed: Editor; editable: boolean; frame: number; theme: Theme | null }) {
  const f = doc.family!;
  const s = schemeOf(f);
  const pieces = new Set(s.pieces);
  const detached = new Set(f.detached);
  const k = f.tile <= 16 ? 3 : f.tile <= 32 ? 2 : 1;
  const g = f.geometry;
  const bandText = g.bands.length ? g.bands.map((b) => `${b.w}:${typeof b.fill === 'number' ? doc.palette.entries[b.fill]?.name : b.fill}`).join(' ') : 'none';
  return (
    <div className="family-view" data-testid="family-variants">
      <div className="family-head">
        <b>{s.name}</b> <span className="dim">{s.variants.length} variants of {f.tile}×{f.tile} · band {bandText} · radius {g.radius} · inset {g.inset}</span>
        <span className="spacer" />
        {f.mapCols > 0 && (
          <>
            <button className="mini" disabled={!editable} data-testid="family-coverage" onClick={() => ed.act('family coverage', { context: false })}
              title={`Lay out the ${f.mapCols}x${f.mapRows} coverage map so it holds every variant, with a flat template to paint over (family coverage)`}>coverage map</button>
            <button className="mini" disabled={!editable || !f.terrain.length || !g.bands.length} data-testid="family-cut" onClick={() => ed.act('family cut', { context: false })}
              title="Cut every variant from the painted map: the medoid tile of each, its band only (family cut)">cut from map</button>
          </>
        )}
      </div>
      <div className="dim family-legend">Each variant sits in the middle of the neighbourhood that makes it. <span className="piece-tag">piece</span> drawn by hand on layer band, the others built from their quadrants; <span className="detached-tag">detached</span> drawn by hand.</div>
      <div className="family-grid">
        {s.variants.map((v, i) => {
          const piece = pieces.has(v.name), det = detached.has(v.name);
          return (
            <div key={v.name} className={`variant${piece ? ' piece' : ''}${det ? ' detached' : ''}`} data-variant={v.name}>
              <Img img={renderVariant(doc, i, { frame, theme })} k={k} />
              <div className="vname">
                <span className="mono" title={`@cell(${v.name})`}>{v.name}</span>
                {piece ? <span className="piece-tag">piece</span> : (
                  <button className="mini" disabled={!editable} data-testid={`variant-${det ? 'attach' : 'detach'}-${v.name}`}
                    title={det ? `Build it from the pieces again (family attach ${v.name})` : `Draw it by hand from now on (family detach ${v.name})`}
                    onClick={() => ed.act(`family ${det ? 'attach' : 'detach'} ${v.name}`, { context: false })}>{det ? 'attach' : 'detach'}</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const SIZES = ['12x10', '16x12', '24x16'];

export function FamilyMap({ doc, store, frame }: { doc: Doc; store: Store; frame: number }) {
  const [size, setSize] = useState('16x12');
  const [seed, setSeed] = useState(1);
  const [play, setPlay] = useState(true);
  const [tick, setTick] = useState(0);
  const overlays = store.assetDocs().filter((a) => a.doc.overlay);
  const [on, setOn] = useState<string[]>(() => overlays.map((o) => o.name));
  const [cols, rows] = size.split('x').map(Number) as [number, number];
  const chosen = overlays.filter((o) => on.includes(o.name)).map((o) => o.doc);
  const moves = doc.frameCount > 1 || chosen.length > 0;
  const rate = store.project?.tickRate ?? 60;
  useEffect(() => {
    if (!play || !moves) return;
    const start = performance.now();
    const id = setInterval(() => setTick(Math.floor(((performance.now() - start) * rate) / 1000)), 1000 / 15);
    return () => clearInterval(id);
  }, [play, moves, rate]);
  // At the game's draw scale (2 below 48 px, 1 from 48, unless the style guide says).
  const o = { cols, rows, seed, overlays: chosen, theme: store.themeObj(), scale: drawScaleOf(store.style, store.project?.grid), tick, ...(moves && play ? {} : { frame }) };
  const img = renderMap(doc, o);
  const text = mapText(doc, { ...o, tick: 0 });
  return (
    <div className="family-view" data-testid="family-map">
      <div className="family-head">
        <span className="dim">map</span>
        <select value={size} onChange={(e) => setSize(e.target.value)} data-testid="map-size" title="The map's size in tiles (only for looking)">
          {SIZES.map((x) => <option key={x}>{x}</option>)}
        </select>
        <span className="dim">seed</span>
        <input className="num" type="number" min={1} value={seed} data-testid="map-seed" onChange={(e) => setSeed(Math.max(1, Number(e.target.value) || 1))} title="The random island's seed (only for looking)" />
        <button className="mini" data-testid="map-reroll" onClick={() => setSeed(seed + 1)} title="Another random island (only for looking)">⟳ another</button>
        {moves && <button className="mini" data-testid="map-play" onClick={() => setPlay(!play)} title="Play the map at the game's speed (only for looking)">{play ? '⏸' : '▶'}</button>}
        {overlays.map((x) => (
          <label key={x.name} className="chk" title={`Play overlay ${x.name} (${x.doc.overlay!.mode} on ${x.doc.overlay!.on}) over the map`}>
            <input type="checkbox" checked={on.includes(x.name)} data-testid={`map-overlay-${x.name}`}
              onChange={() => setOn(on.includes(x.name) ? on.filter((n) => n !== x.name) : [...on, x.name])} /> {x.name}
          </label>
        ))}
      </div>
      <div className="dim map-text" data-testid="map-text">{text}</div>
      <div className="map-body"><Img img={img} testid="map-canvas" /></div>
    </div>
  );
}
