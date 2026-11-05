// Checks and previews in the watch view: a chip per check in the header (click to
// circle its flagged pixels on the canvas and open its details; a flagged group can be pinned as a
// note for the agent), and the preview panel: the tile 3x3, the game view (the sprite on its
// ground at 1x and the draw scale, beside its set) and the art under preview themes. Everything is
// computed in the page with core, from the same style guide the agent's `check` uses.

import { useLayoutEffect, useRef, useState } from 'react';
import {
  renderMap, setText, themedPalette, drawScaleOf, groundOf, hasRoles, quote, renderDensity, renderGame, renderRecolour, renderTile3x3, setOf, type CheckId, type CheckResult, type Doc, type Pt,
  type Rgba,
} from '@pixelclaw/core';
import type { Editor } from './editor.ts';
import type { Store } from './store.ts';

export function CheckChips({ results, store }: { results: CheckResult[]; store: Store }) {
  const shown = results.filter((r) => r.status !== 'skip');
  if (!shown.length) return null;
  return (
    <span className="checks" data-testid="checks">
      {shown.map((r) => (
        <button
          key={r.id}
          className={`chip check ${r.status}${store.marked.has(r.id) ? ' on' : ''}`}
          data-check={r.id}
          data-status={r.status}
          title={`${r.id}: ${r.shown} (${r.limit})\n${r.detail}${r.flagged.length ? `\nclick to circle the ${r.flagged.length} flagged px` : ''}`}
          onClick={() => store.toggleCheck(r.id)}
        >
          {r.id} {r.status === 'fail' || !/^[01]$/.test(r.shown) ? <span className="score">{r.shown}</span> : null} {r.status === 'pass' ? '✓' : '✗'}
        </button>
      ))}
    </span>
  );
}

/** The bounding box of some pixels, as note coordinates. */
function box(pts: readonly Pt[]): { x: number; y: number; w: number; h: number } {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x + 1, h: Math.max(...ys) - y + 1 };
}

/** Flagged pixels in clusters: pixels within 2 of each other belong together. */
export function clusters(pts: readonly Pt[]): Pt[][] {
  const left = [...pts];
  const out: Pt[][] = [];
  while (left.length) {
    const group = [left.shift()!];
    for (let i = 0; i < group.length; i++) {
      for (let j = left.length - 1; j >= 0; j--) {
        if (Math.max(Math.abs(left[j]![0] - group[i]![0]), Math.abs(left[j]![1] - group[i]![1])) <= 2) group.push(...left.splice(j, 1));
      }
    }
    out.push(group);
  }
  return out;
}

const coords = (pts: readonly Pt[], n = 16) => pts.slice(0, n).map(([x, y]) => `${x},${y}`).join(' ') + (pts.length > n ? ` … +${pts.length - n}` : '');

export function CheckDetails({ result, ed, editable, onClose }: { result: CheckResult; ed: Editor; editable: boolean; onClose(): void }) {
  // One note per cluster of flagged pixels (a box around scattered pixels would cover the whole
  // sprite), the biggest clusters first, all in one batch.
  const pin = (label: string, pts: readonly Pt[]) => {
    const lines = clusters(pts).sort((a, b) => b.length - a.length).slice(0, 6).map((c) => {
      const b = box(c);
      const where = b.w === 1 && b.h === 1 ? `${b.x},${b.y}` : `${b.x},${b.y} ${b.w}x${b.h}`;
      return `note ${where} ${quote(`${result.id}: ${label} (${coords(c, 12)})`.slice(0, 900))}`;
    });
    void ed.commit(lines.join('\n'), { context: false });
  };
  return (
    <div className={`banner check-details ${result.status}`} data-testid="check-details" data-check={result.id}>
      <div className="cd-head">
        <b>{result.id}</b> <span className="score">{result.shown}</span> <span className="dim">({result.limit || 'no threshold'})</span>
        <span className="cd-detail">{result.detail}</span>
        <span className="spacer" />
        <button onClick={onClose} title="Hide the marks and these details" data-testid="check-close">✕</button>
      </div>
      {result.groups.map((g) => (
        <div className="cd-group" key={g.label}>
          <span className="mark-dot" /> {g.label}: <span className="mono">{coords(g.pts)}</span>
          {editable && (
            <button className="mini" onClick={() => pin(g.label, g.pts)} title="Pin notes on these pixels for the agent (one per cluster)" data-testid="check-pin">📌 note</button>
          )}
        </div>
      ))}
      {result.parts?.map((p) => (
        <div className="cd-group" key={p.name}>
          {p.pass === null ? '–' : p.pass ? '✓' : '✗'} {p.name}: {p.detail}{p.limit ? ` (${p.limit})` : ''}
        </div>
      ))}
    </div>
  );
}

/** An RGBA image from core on a canvas at its own size. */
function RgbaCanvas({ img, testid }: { img: Rgba; testid: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  }, [img]);
  return <canvas ref={ref} data-testid={testid} style={{ width: img.width, height: img.height }} />;
}

type Tab = '3x3' | 'game' | 'themes' | 'map' | 'density' | 'text';

/** A font's sample: a pangram's letters it has (upper or lower case), its digits, else every glyph in rows. */
function fontSample(doc: Doc): string {
  const has = new Set(doc.font!.chars.map((c) => String.fromCodePoint(c)));
  const pick = (s: string) => [...s].filter((ch) => ch === ' ' || has.has(ch)).join('').trim();
  const lines = ['THE QUICK BROWN FOX', 'JUMPS OVER THE LAZY DOG', 'the quick brown fox', '0123456789 !?.,:'].map(pick).filter((l) => l.replace(/ /g, '').length >= 4);
  if (lines.length) return lines.join('\n');
  const all = doc.font!.chars.map((c) => String.fromCodePoint(c));
  return Array.from({ length: Math.ceil(all.length / 16) }, (_, i) => all.slice(i * 16, i * 16 + 16).join('')).join('\n');
}

/** An image k times larger on a background colour (the font sample). */
function onGround(img: Rgba, k: number, bg: [number, number, number], pad = 2): Rgba {
  const W = (img.width + pad * 2) * k, H = (img.height + pad * 2) * k;
  const out = { width: W, height: H, data: new Uint8Array(W * H * 4) };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = Math.floor(x / k) - pad, sy = Math.floor(y / k) - pad;
    const o = sx >= 0 && sy >= 0 && sx < img.width && sy < img.height ? (sy * img.width + sx) * 4 : -1;
    out.data.set(o >= 0 && img.data[o + 3]! ? [img.data[o]!, img.data[o + 1]!, img.data[o + 2]!, 255] : [...bg, 255], (y * W + x) * 4);
  }
  return out;
}

export function PreviewPanel({ doc, frame, store, marks }: { doc: Doc; frame: number; store: Store; marks: readonly Pt[] }) {
  const base: Tab[] = doc.font ? ['text'] : doc.family || doc.overlay ? ['map', 'themes'] : doc.wrap ? ['3x3', 'themes'] : ['game', 'themes'];
  // An asset with higher-density copies (or a copy): its densities side by side and the reduction.
  const all0 = store.assetDocs();
  const densityBase = doc.densityOf?.of ?? (all0.some((a) => a.doc.densityOf?.of === (store.current?.name ?? doc.name)) ? store.current?.name ?? doc.name : null);
  const tabs: Tab[] = densityBase ? [...base, 'density'] : base;
  const [want, setWant] = useState<Tab>('3x3');
  const tab = tabs.includes(want) ? want : tabs[0]!;
  const [open, setOpen] = useState(true);
  const name = store.current?.name ?? doc.name;
  let img: Rgba | null = null;
  let note = '';
  if (open) {
    if (tab === 'text') {
      // The font set as text, at 2x on a dark and a light ground (glyphs are often white or ink).
      const sample = fontSample(doc);
      const t = setText(doc, sample, themedPalette(doc.palette, store.themeObj()).entries.map((e) => e.hex));
      const k = t.width * 2 > 300 ? 1 : 2;
      const dark = onGround(t, k, [24, 26, 32]), light = onGround(t, k, [232, 230, 222]);
      img = { width: dark.width, height: dark.height * 2, data: new Uint8Array([...dark.data, ...light.data]) };
      note = `line ${doc.font!.line} px, baseline row ${doc.font!.baseline}, spacing ${doc.font!.spacing}; ${doc.font!.chars.length} glyphs`;
    } else if (tab === 'map') {
      // A family on a small random island; an overlay over the first family (or the ground tile).
      const all = store.assetDocs();
      const under = doc.overlay ? (all.find((a) => a.doc.family) ?? groundOf(name, all, store.style)) : null;
      if (doc.family || under) {
        // About 288 px across whatever the tile (12x9 cells of 24, 6x5 of 48).
        const t = doc.family?.tile ?? under?.doc.cellW ?? 24;
        const cols = Math.max(6, Math.min(12, Math.round(288 / t)));
        img = renderMap(doc, { cols, rows: Math.round((cols * 3) / 4), seed: 1, scale: 1, theme: store.themeObj(), ground: under?.doc ?? null });
        note = doc.family ? `a random island; the seam and more in the map view (toolbar)` : `over ${under!.name}`;
      } else note = 'no family or tile to show it over';
    } else if (tab === 'density') {
      const b = all0.find((a) => a.name === densityBase)?.doc;
      if (b) {
        const d = store.style?.density ?? {};
        const v = renderDensity(b, all0.filter((a) => a.doc.densityOf?.of === densityBase).map((a) => a.doc), { frame, scale: 1, reducer: d.reducer, ink: d.ink, share: d.share });
        img = v.img;
        note = v.text.split('\n').filter((l) => / reduced |no higher/.test(l)).join(' ');
      } else note = `no asset '${densityBase}'`;
    } else if (tab === '3x3') img = renderTile3x3(doc, frame, { theme: store.themeObj(), marks, scale: doc.width <= 32 ? 2 : 1 });
    else if (tab === 'game') {
      const all = store.assetDocs();
      const ground = groundOf(name, all, store.style);
      const set = setOf(name, doc, all, store.style).slice(0, 5);
      img = renderGame([{ doc, frame }, ...set.map((a) => ({ doc: a.doc }))], { ground: ground?.doc ?? null, scale: drawScaleOf(store.style, store.project?.grid), theme: store.themeObj(), marks });
      note = `${ground ? `on ${ground.name}` : 'no ground tile'}${set.length ? `, beside ${set.map((a) => a.name).join(', ')}` : ''}; ${drawScaleOf(store.style, store.project?.grid) === 1 ? 'at 1x, the draw scale' : `1x and ${drawScaleOf(store.style, store.project?.grid)}x`}`;
    } else {
      img = renderRecolour(doc, store.themes.slice(0, 6), { frame, scale: Math.max(1, Math.min(2, Math.floor(48 / Math.max(doc.width, doc.height)))) });
      note = hasRoles(doc.palette) ? store.themes.slice(0, 6).map((t) => t.name).join(' · ') : 'no role colours: the art looks the same under every theme';
    }
  }
  return (
    <div className="preview" data-testid="preview">
      <div className="panel-title">
        Preview
        {tabs.map((t) => (
          <button key={t} className={`mini${t === tab && open ? ' on' : ''}`} data-tab={t} onClick={() => { setWant(t); setOpen(true); }}>{t}</button>
        ))}
        <span className="spacer" />
        <button className="mini" onClick={() => setOpen(!open)} title={open ? 'Hide the preview' : 'Show the preview'}>{open ? '▾' : '▸'}</button>
      </div>
      {img && (
        <div className="preview-body">
          <RgbaCanvas img={img} testid={`preview-${tab}`} />
          {note && <div className="dim">{note}</div>}
        </div>
      )}
    </div>
  );
}

export type { CheckId };
