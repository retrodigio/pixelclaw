// Editing in the page (plan §1.3, §8.3): each tool turns a gesture into the same command text the
// agent would write, and sends it to the single writer as one batch (one undo group) with this
// person's name. While a gesture is in progress the canvas shows a preview: the batch applied by
// core to a copy of the document, so what you see is exactly what will be logged.
//
// Each author has their own layer, frame, selection, symmetry and brush in the document. The page
// keeps the layer, frame, symmetry and brush you choose and, when they differ from yours in the
// document, starts your next batch with the lines that set them (`layer rim`, `mirror x=11.5 live`,
// …). Selections are commands at once (`select …`, `deselect`), as in Aseprite, where they undo.

import {
  PATTERNS, TRANSPARENT, ctxOf, findRedo, findUndo, flatten, quote, runBatch, type Doc, type Note,
} from '@pixelclaw/core';
import type { Store } from './store.ts';

export type ToolId =
  | 'pencil' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'fill' | 'gradient' | 'dither' | 'picker'
  | 'select' | 'select-ellipse' | 'lasso' | 'wand' | 'move' | 'stamp' | 'note' | 'pivot';

export interface ToolInfo {
  id: ToolId;
  label: string;
  /** The shortcut as shown in the tooltip. */
  key: string;
  icon: string;
  hint: string;
}

/** Aseprite-style shortcuts (plan §8.3). */
export const TOOLS: ToolInfo[] = [
  { id: 'pencil', label: 'Pencil', key: 'B', icon: '✎', hint: 'drag to draw; pixel-perfect by default; the brush size is in the options bar' },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: '⌫', hint: 'drag to clear pixels' },
  { id: 'line', label: 'Line', key: 'L', icon: '╱', hint: 'drag from one end to the other' },
  { id: 'rect', label: 'Rectangle', key: 'U', icon: '▭', hint: 'drag a box; F toggles filled' },
  { id: 'ellipse', label: 'Ellipse', key: 'Shift+U', icon: '◯', hint: 'drag a box; F toggles filled' },
  { id: 'fill', label: 'Fill', key: 'G', icon: '◧', hint: 'click to flood-fill an area' },
  { id: 'gradient', label: 'Gradient', key: 'Shift+G', icon: '▤', hint: 'drag from where colour A starts to where colour B ends; fills your selection, or the canvas, along the ramp between them' },
  { id: 'dither', label: 'Dither', key: 'D', icon: '▚', hint: 'drag a box: colour A dithered over colour B at the level in the options bar' },
  { id: 'picker', label: 'Colour picker', key: 'I', icon: '◉', hint: 'click a pixel to use its colour (or Alt+click with a drawing tool)' },
  { id: 'select', label: 'Rectangle select', key: 'M', icon: '⬚', hint: 'drag to select; Shift adds, Alt subtracts; drag inside to move; Delete clears; Esc deselects' },
  { id: 'select-ellipse', label: 'Ellipse select', key: 'Shift+M', icon: '◌', hint: 'drag a box to select an ellipse; Shift adds, Alt subtracts' },
  { id: 'lasso', label: 'Lasso', key: 'Q', icon: '➰', hint: 'drag around an area to select it; Shift adds, Alt subtracts' },
  { id: 'wand', label: 'Magic wand', key: 'W', icon: '✦', hint: 'click to select touching pixels of one colour on your layer (or all of that colour); Shift adds, Alt subtracts' },
  { id: 'move', label: 'Move', key: 'V', icon: '✣', hint: 'drag to move the selection (or your whole layer); arrow keys nudge' },
  { id: 'stamp', label: 'Stamp', key: 'S', icon: '❖', hint: 'click to place the chosen stamp (see Stamps); save one from a selection' },
  { id: 'note', label: 'Note', key: 'N', icon: '✍︎', hint: 'click a pixel or drag a region, then write a note for the agent' },
  { id: 'pivot', label: 'Pivot and ground', key: 'P', icon: '⌖', hint: 'click the pixel the sprite stands on (pivot); Shift+click a row to set the ground line' },
];

const KEYS: Record<string, ToolId> = {
  b: 'pencil', e: 'eraser', l: 'line', u: 'rect', U: 'ellipse', g: 'fill', G: 'gradient', d: 'dither', i: 'picker',
  m: 'select', M: 'select-ellipse', q: 'lasso', w: 'wand', v: 'move', s: 'stamp', n: 'note', p: 'pivot',
};

const SELECT_TOOLS: ToolId[] = ['select', 'select-ellipse', 'lasso', 'wand'];
const BRUSH_TOOLS: ToolId[] = ['pencil', 'eraser', 'line', 'rect', 'ellipse'];

export type Pt = [number, number];
export interface Rect { x: number; y: number; w: number; h: number }

type Drag =
  | { kind: 'points'; pts: Pt[] }
  | { kind: 'box'; a: Pt; b: Pt }
  | { kind: 'move'; a: Pt; b: Pt };

const box = (a: Pt, b: Pt): Rect => ({
  x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]) + 1, h: Math.abs(a[1] - b[1]) + 1,
});
const rectText = (r: Rect) => `${r.x},${r.y} ${r.w}x${r.h}`;
const axisText = (x2: number) => (x2 % 2 === 0 ? String(x2 / 2) : `${(x2 - 1) / 2}.5`);

/** The bounding box of a selection mask. */
export function maskBox(doc: Doc, m: Uint8Array): Rect | null {
  let x0 = doc.width, y0 = doc.height, x1 = -1, y1 = -1;
  for (let i = 0; i < m.length; i++) {
    if (!m[i]) continue;
    const x = i % doc.width;
    const y = (i - x) / doc.width;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Drop points that lie on the straight line between their neighbours (a lasso drag gets shorter). */
function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    if (out.length && out.at(-1)![0] === p[0] && out.at(-1)![1] === p[1]) continue;
    if (out.length >= 2) {
      const a = out.at(-2)!;
      const b = out.at(-1)!;
      if ((b[0] - a[0]) * (p[1] - a[1]) === (b[1] - a[1]) * (p[0] - a[0])) out.pop();
    }
    out.push(p);
  }
  return out;
}

export class Editor {
  tool: ToolId = 'pencil';
  /** Colour A (drawing) and colour B (gradient end, dither ground): entry names, or 'none'. */
  colour = '';
  colour2 = '';
  filled = false;
  pixelPerfect = true;
  brushSize = 1;
  brushShape: 'square' | 'circle' = 'square';
  mirrorX = false;
  mirrorY = false;
  /** Wand: every pixel of the colour, not just the touching ones. */
  wandGlobal = false;
  gradientPattern = 'none';
  ditherPattern = 'bayer4';
  ditherLevel = 0.5;
  /** The stamp the stamp tool places. */
  stamp: string | null = null;
  /** The layer (by name) and frame (0-based) you draw on and see; null follows yours in the document. */
  layerName: string | null = null;
  frame: number | null = null;
  /** Frames chosen in the timeline (0-based, inclusive) for ticks, tags, views and links; null: your frame. */
  frameSel: { from: number; to: number } | null = null;
  /** Onion skin: the frame before and the frame after, tinted under yours. Only for looking. */
  onionPrev = false;
  onionNext = false;
  /** Show the pivot and the ground line on the canvas. */
  guides = true;
  /** Playback: the sequence playing (by name) and when it started (performance.now()). Only for looking. */
  playing: { seq: string; start: number } | null = null;
  /** The sequence the play button plays. */
  playSeq: string | null = null;
  drag: Drag | null = null;
  /** Shift or Alt held when a selection gesture started: add to or subtract from the selection. */
  private combine = '';
  /** The batch being previewed (during a gesture, and until the writer answers). */
  preview: { text: string; doc: Doc | null } | null = null;
  /** A note's place, waiting for its text. */
  noteDraft: Rect | null = null;
  hover: Pt | null = null;
  activeNote: string | null = null;
  private lastTool: ToolId = 'pencil';
  private readonly store: Store;
  /** The latest batch sent and not yet answered: undo and redo wait for it. */
  private inflight: Promise<unknown> = Promise.resolve();

  constructor(store: Store) {
    this.store = store;
  }

  private changed(): void {
    this.store.changed();
  }

  /** The live document of the shown asset, when the page may edit it (not while time travelling). */
  get doc(): Doc | null {
    const a = this.store.current;
    if (!a || this.store.travel !== null || this.store.status !== 'open' || a.problem) return null;
    return a.cursor.doc;
  }

  get editable(): boolean {
    return this.doc !== null;
  }

  /** The colour in use, falling back to the palette's first entry. */
  colourName(doc: Doc, second = false): string {
    const c = second ? this.colour2 : this.colour;
    if (c === 'none' || doc.palette.entries.some((e) => e.name === c)) return c;
    return doc.palette.entries[second ? Math.min(1, doc.palette.entries.length - 1) : 0]?.name ?? 'none';
  }

  setTool(t: ToolId): void {
    if (t !== 'picker') this.lastTool = t;
    this.tool = t;
    this.drag = null;
    this.preview = null;
    this.changed();
  }

  setColour(name: string, second = false): void {
    if (second) this.colour2 = name;
    else this.colour = name;
    this.changed();
  }

  swapColours(doc: Doc): void {
    const a = this.colourName(doc);
    this.colour = this.colourName(doc, true);
    this.colour2 = a;
    this.changed();
  }

  // --- your layer and frame

  /** The layer you draw on: the one chosen here, else yours in the document. */
  layerIndex(doc: Doc): number {
    const i = this.layerName === null ? -1 : doc.layers.findIndex((l) => l.name === this.layerName);
    return i >= 0 ? i : Math.min(ctxOf(doc, this.store.me).layer, doc.layers.length - 1);
  }

  frameIndex(doc: Doc): number {
    const f = this.frame ?? ctxOf(doc, this.store.me).frame;
    return Math.max(0, Math.min(doc.frameCount - 1, f));
  }

  setLayer(name: string): void {
    this.layerName = name;
    this.changed();
  }

  setFrame(f: number): void {
    this.frame = f;
    this.changed();
  }

  /** The lines that make your context in the document match what you chose here. */
  private prefix(doc: Doc): string[] {
    const c = ctxOf(doc, this.store.me);
    const out: string[] = [];
    const li = this.layerIndex(doc);
    if (li !== c.layer) out.push(`layer ${doc.layers[li]!.name}`);
    const fi = this.frameIndex(doc);
    if (fi !== c.frame) out.push(`frame ${fi + 1}`);
    const x2 = this.mirrorX ? doc.width - 1 : null;
    const y2 = this.mirrorY ? doc.height - 1 : null;
    const has = c.mirror;
    if (x2 === null && y2 === null) {
      if (has) out.push('mirror off');
    } else if (!has || has.x2 !== x2 || has.y2 !== y2) {
      out.push(`mirror ${[x2 !== null ? `x=${axisText(x2)}` : '', y2 !== null ? `y=${axisText(y2)}` : ''].filter(Boolean).join(' ')} live`);
    }
    const b = c.brush;
    if (this.brushSize <= 1) {
      if (b) out.push('brush off');
    } else if (!b || b.shape !== this.brushShape || b.size !== this.brushSize) {
      out.push(`brush ${this.brushShape} ${this.brushSize}`);
    }
    return out;
  }

  /** Your selection in the document. */
  mySel(doc: Doc): Uint8Array | null {
    return ctxOf(doc, this.store.me).sel;
  }

  // --- gestures (pixel coordinates of the document)

  down(p: Pt, o: { alt?: boolean; shift?: boolean } = {}): void {
    this.store.catchUp();
    const doc = this.doc;
    if (!doc) return;
    // The canvas must not switch to whatever the agent draws next while a person is editing.
    if (this.store.follow) this.store.setFollow(false);
    this.noteDraft = null;
    const selecting = SELECT_TOOLS.includes(this.tool);
    if (this.tool === 'picker' || (o.alt && !selecting)) {
      this.pick(doc, p);
      return;
    }
    this.combine = selecting ? (o.shift ? ' add' : o.alt ? ' sub' : '') : '';
    switch (this.tool) {
      case 'pencil':
      case 'eraser':
      case 'lasso':
        this.drag = { kind: 'points', pts: [p] };
        break;
      case 'line':
      case 'rect':
      case 'ellipse':
      case 'note':
      case 'gradient':
      case 'dither':
      case 'select-ellipse':
        this.drag = { kind: 'box', a: p, b: p };
        break;
      case 'select': {
        const sel = this.mySel(doc);
        const i = p[1] * doc.width + p[0];
        const inside = !!sel && p[0] >= 0 && p[1] >= 0 && p[0] < doc.width && p[1] < doc.height && !!sel[i];
        this.drag = inside && !this.combine ? { kind: 'move', a: p, b: p } : { kind: 'box', a: p, b: p };
        break;
      }
      case 'move':
        this.drag = { kind: 'move', a: p, b: p };
        break;
      case 'wand':
        if (!doc.wrap && (p[0] < 0 || p[1] < 0 || p[0] >= doc.width || p[1] >= doc.height)) return;
        void this.commit(`select wand ${p[0]},${p[1]} mode=${this.wandGlobal ? 'global' : 'contiguous'} conn=4${this.combine}`);
        return;
      case 'fill':
        if (!doc.wrap && (p[0] < 0 || p[1] < 0 || p[0] >= doc.width || p[1] >= doc.height)) return;
        void this.commit(`fill ${p[0]},${p[1]} c=${this.colourName(doc)}`);
        return;
      case 'pivot':
        if (p[0] < 0 || p[1] < 0 || p[0] >= doc.width || p[1] >= doc.height) return;
        void this.commit(o.shift ? `ground ${p[1]}` : `pivot ${p[0]},${p[1]}`, { context: false });
        return;
      case 'stamp': {
        const s = this.stamp ? doc.stamps[this.stamp] : undefined;
        if (!s) return;
        void this.commit(`stamp ${this.stamp} ${p[0] - (s.w >> 1)},${p[1] - (s.h >> 1)}`);
        return;
      }
    }
    this.updatePreview();
  }

  move(p: Pt | null): void {
    this.hover = p;
    const d = this.drag;
    if (d && p) {
      if (d.kind === 'points') {
        const last = d.pts[d.pts.length - 1]!;
        if (last[0] !== p[0] || last[1] !== p[1]) d.pts.push(p);
      } else d.b = p;
      this.updatePreview();
    }
    this.changed();
  }

  up(p: Pt | null): void {
    const d = this.drag;
    if (!d) return;
    if (p) this.move(p);
    this.drag = null;
    if (this.tool === 'note' && d.kind === 'box') {
      this.noteDraft = this.clampRect(box(d.a, d.b));
      this.preview = null;
      this.changed();
      return;
    }
    const text = this.gestureText(d);
    if (!text) {
      this.preview = null;
      this.changed();
      return;
    }
    void this.commit(text);
  }

  cancel(): void {
    this.drag = null;
    this.preview = null;
    this.noteDraft = null;
    this.changed();
  }

  // --- the command text for each gesture

  private gestureText(d: Drag): string | null {
    const doc = this.doc;
    if (!doc) return null;
    const c = this.colourName(doc);
    if (d.kind === 'points') {
      if (this.tool === 'lasso') {
        const pts = simplify(d.pts);
        return pts.length >= 3 ? `select lasso ${pts.map((q) => `${q[0]},${q[1]}`).join(' ')}${this.combine}` : null;
      }
      const pts = d.pts.map((q) => `${q[0]},${q[1]}`).join(' ');
      return this.tool === 'eraser' ? `stroke eraser ${pts}` : `stroke pencil c=${c} pp=${this.pixelPerfect ? 'on' : 'off'} ${pts}`;
    }
    if (d.kind === 'move') {
      const dx = d.b[0] - d.a[0];
      const dy = d.b[1] - d.a[1];
      return dx === 0 && dy === 0 ? null : `shift ${dx},${dy}`;
    }
    const mode = this.filled ? 'fill' : 'outline';
    const r = box(d.a, d.b);
    switch (this.tool) {
      case 'line':
        return `line ${d.a[0]},${d.a[1]} ${d.b[0]},${d.b[1]} c=${c}`;
      case 'rect':
        return `rect ${rectText(r)} c=${c} ${mode}`;
      case 'ellipse':
        return `ellipse ${rectText(r)} c=${c} ${mode}`;
      case 'select':
        return `select rect ${rectText(this.clampRect(r))}${this.combine}`;
      case 'select-ellipse':
        return `select ellipse ${rectText(r)}${this.combine}`;
      case 'dither':
        return `dither ${rectText(r)} a=${this.colourName(doc, true)} b=${c} pattern=${this.ditherPattern} level=${this.ditherLevel}`;
      case 'gradient':
        return this.gradientText(doc, d.a, d.b);
      default:
        return null;
    }
  }

  /**
   * A gradient from colour A where the drag starts to colour B where it ends, across your selection
   * (or the canvas), along the palette ramp between them when they share one.
   */
  private gradientText(doc: Doc, a: Pt, b: Pt): string | null {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (dx === 0 && dy === 0) return null;
    const dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    const sel = this.mySel(doc);
    const r = (sel && maskBox(doc, sel)) ?? { x: 0, y: 0, w: doc.width, h: doc.height };
    const ca = this.colourName(doc);
    const cb = this.colourName(doc, true);
    if (ca === 'none' || cb === 'none' || ca === cb) return null;
    let ramp = `${ca},${cb}`;
    for (const [name, members] of Object.entries(doc.palette.ramps)) {
      const i = members.indexOf(ca);
      const j = members.indexOf(cb);
      if (i < 0 || j < 0) continue;
      // The whole ramp, darkest first, goes by its name.
      if (i === 0 && j === members.length - 1) ramp = name;
      else ramp = (i < j ? members.slice(i, j + 1) : members.slice(j, i + 1).reverse()).join(',');
      break;
    }
    return `gradient ${rectText(r)} ramp=${ramp} dir=${dir} pattern=${this.gradientPattern}`;
  }

  private clampRect(r: Rect): Rect {
    const doc = this.doc;
    if (!doc) return r;
    const x0 = Math.max(0, r.x);
    const y0 = Math.max(0, r.y);
    const x1 = Math.min(doc.width, r.x + r.w);
    const y1 = Math.min(doc.height, r.y + r.h);
    return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  }

  /** The marquee being dragged (box selection and note tools). */
  get marquee(): Rect | null {
    const d = this.drag;
    return d?.kind === 'box' && (this.tool === 'select' || this.tool === 'select-ellipse' || this.tool === 'note' || this.tool === 'dither') ? box(d.a, d.b) : null;
  }

  /** The lasso being dragged. */
  get lassoPath(): Pt[] | null {
    const d = this.drag;
    return d?.kind === 'points' && this.tool === 'lasso' ? d.pts : null;
  }

  /** How far the selection is being dragged. */
  get dragOffset(): Pt | null {
    const d = this.drag;
    return d?.kind === 'move' ? [d.b[0] - d.a[0], d.b[1] - d.a[1]] : null;
  }

  private updatePreview(): void {
    const d = this.drag;
    const text = d && !(this.tool === 'lasso' || this.tool === 'select' || this.tool === 'select-ellipse') ? this.gestureText(d) : null;
    this.preview = text ? { text, doc: this.apply(this.withContext(text)) } : null;
  }

  private withContext(text: string): string {
    const doc = this.doc;
    return doc ? [...this.prefix(doc), text].join('\n') : text;
  }

  /** The batch applied by core to a copy of the live document, as the writer will apply it. */
  private apply(text: string): Doc | null {
    const a = this.store.current;
    if (!a || !a.cursor.doc) return null;
    const r = runBatch({ doc: a.cursor.doc, entries: a.cursor.done }, text, { by: this.store.me, palettes: this.store.paletteSource });
    return r.ok ? r.state.doc : null;
  }

  /** The document to draw: the preview while there is one. */
  previewDoc(): Doc | null {
    return this.preview?.doc ?? null;
  }

  private pick(doc: Doc, p: Pt): void {
    const [x, y] = p;
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return;
    const v = flatten(doc, this.frameIndex(doc))[y * doc.width + x]!;
    this.colour = v === TRANSPARENT ? 'none' : doc.palette.entries[v]!.name;
    if (this.tool === 'picker') this.tool = this.lastTool;
    this.changed();
  }

  // --- sending

  /**
   * Send a batch for the shown asset; the preview stays until the writer answers. With context
   * (the default), the batch starts with whatever sets your layer, frame, symmetry and brush.
   */
  async commit(text: string, o: { context?: boolean } = {}): Promise<boolean> {
    const a = this.store.current;
    if (!a) return false;
    const full = o.context === false ? text : this.withContext(text);
    this.preview = { text: full, doc: this.apply(full) };
    this.changed();
    const sent = this.store.send(a.name, full);
    const before = this.inflight;
    this.inflight = before.then(() => sent);
    const r = await sent;
    if (this.preview?.text === full) this.preview = null;
    this.changed();
    return r.ok;
  }

  writeNote(text: string): Promise<boolean> {
    const r = this.noteDraft;
    if (!r || !text.trim()) return Promise.resolve(false);
    this.noteDraft = null;
    const where = r.w === 1 && r.h === 1 ? `${r.x},${r.y}` : rectText(r);
    return this.commit(`note ${where} ${quote(text.trim().replace(/\s+/g, ' '))}`, { context: false });
  }

  closeNote(n: Note): Promise<boolean> {
    return this.commit(`note done ${n.id}`, { context: false });
  }

  canUndo(): boolean {
    const a = this.store.current;
    return !!a && this.editable && 'group' in findUndo(a.tape, null, this.store.me);
  }

  canRedo(): boolean {
    const a = this.store.current;
    return !!a && this.editable && 'group' in findRedo(a.tape, null, this.store.me);
  }

  /** Undo this person's latest edit, once every edit sent before it has been answered. */
  undo(): void {
    this.inflight = this.inflight.then(() => (this.canUndo() ? this.commit(`undo by=${this.store.me}`, { context: false }) : undefined));
  }

  redo(): void {
    this.inflight = this.inflight.then(() => (this.canRedo() ? this.commit(`redo by=${this.store.me}`, { context: false }) : undefined));
  }

  // --- actions on your selection (or your layer)

  /** Run a command when the page may edit. */
  act(text: string, o: { context?: boolean } = {}): void {
    if (this.editable) void this.commit(text, o);
  }

  hasSel(): boolean {
    const doc = this.doc;
    return !!doc && !!this.mySel(doc);
  }

  deselect(): void {
    if (this.hasSel()) this.act('deselect', { context: false });
  }

  /** Save your selection's box (unselected pixels left out) as a stamp. */
  saveStamp(name: string): Promise<boolean> {
    const doc = this.doc;
    const sel = doc && this.mySel(doc);
    const r = doc && sel ? maskBox(doc, sel) : null;
    if (!doc || !r) return Promise.resolve(false);
    return this.commit(`stamp save ${name} ${rectText(r)}`).then((ok) => {
      if (ok) {
        this.stamp = name;
        this.changed();
      }
      return ok;
    });
  }

  // --- layers and frames

  addLayer(): void {
    const doc = this.doc;
    if (!doc) return;
    let n = doc.layers.length + 1;
    while (doc.layers.some((l) => l.name === `layer${n}`)) n++;
    const name = `layer${n}`;
    void this.commit(`layer add ${name} above=${doc.layers[this.layerIndex(doc)]!.name}`, { context: false }).then((ok) => ok && this.setLayer(name));
  }

  /** Move a layer one place up (+1) or down (-1) the stack. */
  moveLayer(name: string, dir: 1 | -1): void {
    const doc = this.doc;
    if (!doc) return;
    const i = doc.layers.findIndex((l) => l.name === name);
    const other = doc.layers[i + dir];
    if (!other) return;
    this.act(`layer move ${name} ${dir > 0 ? 'above' : 'below'}=${other.name}`, { context: false });
  }

  addFrame(): void {
    const doc = this.doc;
    if (!doc) return;
    const f = this.frameIndex(doc);
    void this.commit(`frame add ${f + 2} copy=${f + 1}`, { context: false }).then((ok) => ok && this.setFrame(f + 1));
  }

  removeFrame(): void {
    const doc = this.doc;
    if (!doc || doc.frameCount < 2) return;
    const f = this.frameIndex(doc);
    void this.commit(`frame remove ${f + 1}`, { context: false }).then((ok) => ok && this.setFrame(Math.max(0, f - 1)));
  }

  // --- animation (plan §4.4)

  /** The chosen frames (0-based, inclusive): the timeline's choice, else your frame. */
  frames(doc: Doc): { from: number; to: number } {
    const s = this.frameSel;
    if (s && s.to < doc.frameCount) return s;
    const f = this.frameIndex(doc);
    return { from: f, to: f };
  }

  /** Click a frame: draw on it (outside the chosen frames, the choice ends); Shift+click: choose the frames from yours to it. */
  pickFrame(doc: Doc, f: number, extend: boolean): void {
    if (extend) {
      const a = this.frameSel?.from ?? this.frameIndex(doc);
      this.frameSel = { from: Math.min(a, f), to: Math.max(a, f) };
      this.changed();
      return;
    }
    // A click inside the chosen frames keeps them (a double-click to set their ticks starts with one).
    if (!this.frameSel || f < this.frameSel.from || f > this.frameSel.to) this.frameSel = null;
    this.setFrame(f);
  }

  static rangeText(r: { from: number; to: number }): string {
    return r.from === r.to ? String(r.from + 1) : `${r.from + 1}-${r.to + 1}`;
  }

  setTicks(doc: Doc, ticks: number): void {
    this.act(`frame set ${Editor.rangeText(this.frames(doc))} ticks=${ticks}`, { context: false });
  }

  addTag(doc: Doc, name: string, loop: 'cycle' | 'pingpong'): void {
    this.act(`tag add ${name} ${Editor.rangeText(this.frames(doc))} loop=${loop}`, { context: false });
  }

  setView(doc: Doc, name: string): void {
    const r = this.frames(doc);
    this.act(`view ${name} frames=${r.from + 1}-${r.to + 1}`, { context: false });
  }

  link(doc: Doc, on: boolean): void {
    const r = this.frames(doc);
    const layer = doc.layers[this.layerIndex(doc)]!.name;
    this.act(`cel ${on ? 'link' : 'unlink'} ${r.from + 1}-${r.to + 1} layer=${layer}`, { context: false });
  }

  toggle(k: 'onionPrev' | 'onionNext' | 'guides'): void {
    this[k] = !this[k];
    this.changed();
  }

  play(seq: string | null): void {
    this.playing = seq === null ? null : { seq, start: performance.now() };
    this.changed();
  }

  stepFrame(d: 1 | -1): void {
    const doc = this.store.shownDoc().doc;
    if (!doc) return;
    this.setFrame((this.frameIndex(doc) + d + doc.frameCount) % doc.frameCount);
  }

  // --- keyboard

  /** Handle a key; returns true when it was used. */
  key(e: KeyboardEvent): boolean {
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key;
    if (mod && (k === 'z' || k === 'Z')) {
      if (e.shiftKey) this.redo();
      else this.undo();
      return true;
    }
    if (mod && k === 'y') {
      this.redo();
      return true;
    }
    if (mod && k === 'd') {
      this.deselect();
      return true;
    }
    if (mod && k === 'a') {
      this.act('select all', { context: false });
      return true;
    }
    if (mod && (k === 'i' || k === 'I') && e.shiftKey) {
      this.act('select invert', { context: false });
      return true;
    }
    if (mod || e.altKey) return false;
    if (k === 'Escape') {
      if (this.drag || this.noteDraft) this.cancel();
      else this.deselect();
      return true;
    }
    if ((k === 'Delete' || k === 'Backspace') && this.hasSel()) {
      this.act('clear');
      return true;
    }
    const arrows: Record<string, Pt> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[k] && (this.hasSel() || this.tool === 'move')) {
      this.act(`shift ${arrows[k][0]},${arrows[k][1]}`);
      return true;
    }
    if (e.shiftKey && (k === 'H' || k === 'V')) {
      this.act(`flip ${k.toLowerCase()}`);
      return true;
    }
    if (e.shiftKey && k === 'R') {
      this.act('rotate 90');
      return true;
    }
    if (k === 'Enter' && this.playSeq) {
      this.play(this.playing ? null : this.playSeq);
      return true;
    }
    if (k === '[' || k === ']') {
      this.stepFrame(k === ']' ? 1 : -1);
      return true;
    }
    if (k === 'x' || k === 'X') {
      const doc = this.doc;
      if (doc) this.swapColours(doc);
      return true;
    }
    if (k === 'f' || k === 'F') {
      this.filled = !this.filled;
      this.changed();
      return true;
    }
    const t = KEYS[e.shiftKey ? k.toUpperCase() : k.toLowerCase()] ?? KEYS[k.toLowerCase()];
    if (t) {
      this.setTool(t);
      return true;
    }
    return false;
  }

  usesBrush(): boolean {
    return BRUSH_TOOLS.includes(this.tool);
  }
}

export const PATTERN_NAMES = Object.keys(PATTERNS);
