// Editing in the page (plan §1.3, §8.3): each tool turns a gesture into the same command text the
// agent would write, and sends it to the single writer as one batch (one undo group) with this
// person's name. While a gesture is in progress the canvas shows a preview: the batch applied by
// core to a copy of the document, so what you see is exactly what will be logged.

import {
  TRANSPARENT, findRedo, findUndo, flatten, quote, runBatch, type Doc, type Note,
} from '@pixelclaw/core';
import type { Store } from './store.ts';

export type ToolId = 'pencil' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'fill' | 'picker' | 'select' | 'move' | 'note';

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
  { id: 'pencil', label: 'Pencil', key: 'B', icon: '✎', hint: 'drag to draw; pixel-perfect by default' },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: '⌫', hint: 'drag to clear pixels' },
  { id: 'line', label: 'Line', key: 'L', icon: '╱', hint: 'drag from one end to the other' },
  { id: 'rect', label: 'Rectangle', key: 'U', icon: '▭', hint: 'drag a box; F toggles filled' },
  { id: 'ellipse', label: 'Ellipse', key: 'Shift+U', icon: '◯', hint: 'drag a box; F toggles filled' },
  { id: 'fill', label: 'Fill', key: 'G', icon: '◧', hint: 'click to flood-fill an area' },
  { id: 'picker', label: 'Colour picker', key: 'I', icon: '◉', hint: 'click a pixel to use its colour (or Alt+click with any tool)' },
  { id: 'select', label: 'Rectangle select', key: 'M', icon: '⬚', hint: 'drag to select; drag inside to move; Delete clears; Esc deselects' },
  { id: 'move', label: 'Move', key: 'V', icon: '✣', hint: 'drag to move the selection (or everything); arrow keys nudge' },
  { id: 'note', label: 'Note', key: 'N', icon: '✍\uFE0E', hint: 'click a pixel or drag a region, then write a note for the agent' },
];

const KEYS: Record<string, ToolId> = { b: 'pencil', e: 'eraser', l: 'line', u: 'rect', U: 'ellipse', g: 'fill', i: 'picker', m: 'select', v: 'move', n: 'note' };

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
const inside = (r: Rect | null, p: Pt) => !!r && p[0] >= r.x && p[1] >= r.y && p[0] < r.x + r.w && p[1] < r.y + r.h;

export class Editor {
  tool: ToolId = 'pencil';
  /** The colour drawing tools use: an entry name, or 'none'. */
  colour = '';
  filled = false;
  pixelPerfect = true;
  /** The page's own selection (a rectangle). Drawing inside it is clipped to it. */
  sel: Rect | null = null;
  drag: Drag | null = null;
  /** The batch being previewed (during a gesture, and until the writer answers). */
  preview: { text: string; doc: Doc | null; sel: Rect | null } | null = null;
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
  colourName(doc: Doc): string {
    if (this.colour === 'none' || doc.palette.entries.some((e) => e.name === this.colour)) return this.colour;
    return doc.palette.entries[0]?.name ?? 'none';
  }

  setTool(t: ToolId): void {
    if (t !== 'picker') this.lastTool = t;
    this.tool = t;
    this.drag = null;
    this.preview = null;
    this.changed();
  }

  setColour(name: string): void {
    this.colour = name;
    this.changed();
  }

  // --- gestures (pixel coordinates of the document)

  down(p: Pt, o: { alt?: boolean } = {}): void {
    this.store.catchUp();
    const doc = this.doc;
    if (!doc) return;
    // The canvas must not switch to whatever the agent draws next while a person is editing.
    if (this.store.follow) this.store.setFollow(false);
    this.noteDraft = null;
    if (o.alt || this.tool === 'picker') {
      this.pick(doc, p);
      return;
    }
    switch (this.tool) {
      case 'pencil':
      case 'eraser':
        this.drag = { kind: 'points', pts: [p] };
        break;
      case 'line':
      case 'rect':
      case 'ellipse':
      case 'note':
        this.drag = { kind: 'box', a: p, b: p };
        break;
      case 'select':
        this.drag = inside(this.sel, p) ? { kind: 'move', a: p, b: p } : { kind: 'box', a: p, b: p };
        break;
      case 'move':
        this.drag = { kind: 'move', a: p, b: p };
        break;
      case 'fill':
        if (!doc.wrap && (p[0] < 0 || p[1] < 0 || p[0] >= doc.width || p[1] >= doc.height)) return;
        void this.commit(this.clip(`fill ${p[0]},${p[1]} c=${this.colourName(doc)}`));
        return;
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
    if (this.tool === 'select' && d.kind === 'box') {
      this.sel = this.clampRect(box(d.a, d.b));
      this.preview = null;
      this.changed();
      return;
    }
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
    if (d.kind === 'move' && this.sel) this.sel = { ...this.sel, x: this.sel.x + d.b[0] - d.a[0], y: this.sel.y + d.b[1] - d.a[1] };
    void this.commit(text);
  }

  cancel(): void {
    this.drag = null;
    this.preview = null;
    this.noteDraft = null;
    this.changed();
  }

  // --- the command text for each gesture

  private clip(text: string): string {
    return this.sel ? `select rect ${rectText(this.sel)}\n${text}\ndeselect` : text;
  }

  private gestureText(d: Drag): string | null {
    const doc = this.doc;
    if (!doc) return null;
    const c = this.colourName(doc);
    if (d.kind === 'points') {
      const pts = d.pts.map((q) => `${q[0]},${q[1]}`).join(' ');
      return this.clip(this.tool === 'eraser' ? `stroke eraser ${pts}` : `stroke pencil c=${c} pp=${this.pixelPerfect ? 'on' : 'off'} ${pts}`);
    }
    if (d.kind === 'move') {
      const dx = d.b[0] - d.a[0];
      const dy = d.b[1] - d.a[1];
      if (dx === 0 && dy === 0) return null;
      return this.sel ? `select rect ${rectText(this.sel)}\nshift ${dx},${dy}\ndeselect` : `shift ${dx},${dy}`;
    }
    const mode = this.filled ? 'fill' : 'outline';
    switch (this.tool) {
      case 'line':
        return this.clip(`line ${d.a[0]},${d.a[1]} ${d.b[0]},${d.b[1]} c=${c}`);
      case 'rect':
        return this.clip(`rect ${rectText(box(d.a, d.b))} c=${c} ${mode}`);
      case 'ellipse':
        return this.clip(`ellipse ${rectText(box(d.a, d.b))} c=${c} ${mode}`);
      default:
        return null;
    }
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

  /** The marquee being dragged (select and note tools). */
  get marquee(): Rect | null {
    const d = this.drag;
    return d?.kind === 'box' && (this.tool === 'select' || this.tool === 'note') ? box(d.a, d.b) : null;
  }

  /** The selection outline as shown: moved along while dragging. */
  get shownSel(): Rect | null {
    const d = this.drag;
    if (d?.kind === 'move' && this.sel) return { ...this.sel, x: this.sel.x + d.b[0] - d.a[0], y: this.sel.y + d.b[1] - d.a[1] };
    return this.preview?.sel ?? this.sel;
  }

  private updatePreview(): void {
    const d = this.drag;
    const text = d ? this.gestureText(d) : null;
    this.preview = text ? { text, doc: this.apply(text), sel: null } : null;
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
    const v = flatten(doc)[y * doc.width + x]!;
    this.colour = v === TRANSPARENT ? 'none' : doc.palette.entries[v]!.name;
    if (this.tool === 'picker') this.tool = this.lastTool;
    this.changed();
  }

  // --- sending

  /** Send a batch for the shown asset; the preview stays until the writer answers. */
  async commit(text: string): Promise<boolean> {
    const a = this.store.current;
    if (!a) return false;
    this.preview = { text, doc: this.apply(text), sel: this.sel };
    this.changed();
    const sent = this.store.send(a.name, text);
    const before = this.inflight;
    this.inflight = before.then(() => sent);
    const r = await sent;
    if (this.preview?.text === text) this.preview = null;
    this.changed();
    return r.ok;
  }

  writeNote(text: string): Promise<boolean> {
    const r = this.noteDraft;
    if (!r || !text.trim()) return Promise.resolve(false);
    this.noteDraft = null;
    const where = r.w === 1 && r.h === 1 ? `${r.x},${r.y}` : rectText(r);
    return this.commit(`note ${where} ${quote(text.trim().replace(/\s+/g, ' '))}`);
  }

  closeNote(n: Note): Promise<boolean> {
    return this.commit(`note done ${n.id}`);
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
    this.inflight = this.inflight.then(() => (this.canUndo() ? this.commit(`undo by=${this.store.me}`) : undefined));
  }

  redo(): void {
    this.inflight = this.inflight.then(() => (this.canRedo() ? this.commit(`redo by=${this.store.me}`) : undefined));
  }

  deleteSelection(): void {
    if (this.sel && this.editable) void this.commit(`rect ${rectText(this.sel)} c=none fill`);
  }

  nudge(dx: number, dy: number): void {
    if (!this.editable) return;
    const text = this.sel ? `select rect ${rectText(this.sel)}\nshift ${dx},${dy}\ndeselect` : `shift ${dx},${dy}`;
    if (this.sel) this.sel = { ...this.sel, x: this.sel.x + dx, y: this.sel.y + dy };
    void this.commit(text);
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
      this.sel = null;
      this.changed();
      return true;
    }
    if (mod || e.altKey) return false;
    if (k === 'Escape') {
      if (this.drag || this.noteDraft) this.cancel();
      else {
        this.sel = null;
        this.changed();
      }
      return true;
    }
    if ((k === 'Delete' || k === 'Backspace') && this.sel) {
      this.deleteSelection();
      return true;
    }
    const arrows: Record<string, Pt> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[k] && (this.sel || this.tool === 'move')) {
      this.nudge(...arrows[k]);
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
}
