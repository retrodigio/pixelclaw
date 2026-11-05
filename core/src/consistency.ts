// Consistency across a set (plan §5): each asset is measured the same way and held to the rest
// of its set (the manifest's set, else its kind), and to what the style guide and the manifest
// expect. Measures: the drawn shape's height against the manifest's (G6's note: a chest as tall as
// the walker), mean lightness, the outline's share of the silhouette edge, the light direction
// (from where the light pixels sit against the shape's middle) against the style guide's, the
// mean size of same-colour clusters, and how many steps of each ramp (material) are used. An
// asset that is far from its set's median on a measure is an outlier. Palette-swap recolours
// (the same pixels through a colour mapping) are recognised: they are not compared with their
// source, here or in readability's silhouette distinctness.

import { TRANSPARENT, flatten, type Doc } from './doc.ts';
import { rgbOf } from './palette.ts';

function lstarOf(hex: string): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgbOf(hex);
  const y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}

/** The first frame of each view (or frame 0): what a set is compared on. */
function framesOf(d: Doc): number[] {
  return d.views.length ? [...new Set(d.views.filter((v) => !v.mirror).map((v) => v.from))] : [0];
}

/**
 * Is `b` a palette-swap recolour of `a`: the same size and the same opaque pixels on every frame,
 * each of a's colours always drawn as one colour of b and no two as the same one, with at least
 * one colour that looks different?
 */
export function isRecolour(a: Doc, b: Doc): boolean {
  if (a.width !== b.width || a.height !== b.height || a.frameCount !== b.frameCount) return false;
  const fwd = new Map<number, number>(), back = new Map<number, number>();
  let differs = false;
  for (let f = 0; f < a.frameCount; f++) {
    const pa = flatten(a, f), pb = flatten(b, f);
    for (let i = 0; i < pa.length; i++) {
      const x = pa[i]!, y = pb[i]!;
      if ((x === TRANSPARENT) !== (y === TRANSPARENT)) return false;
      if (x === TRANSPARENT) continue;
      if ((fwd.get(x) ?? y) !== y || (back.get(y) ?? x) !== x) return false;
      fwd.set(x, y); back.set(y, x);
    }
  }
  for (const [x, y] of fwd) if (a.palette.entries[x]!.hex.toLowerCase() !== b.palette.entries[y]!.hex.toLowerCase() || a.palette.entries[x]!.role !== b.palette.entries[y]!.role) differs = true;
  return differs && fwd.size > 0;
}

export interface Measures {
  /** The drawn shape's bounding box (first frame). */
  box: { x: number; y: number; w: number; h: number } | null;
  /** Mean L* of the drawn pixels. */
  lightness: number | null;
  /** Share of the silhouette edge in outline colours (null: tiles, which have no silhouette). */
  outline: number | null;
  /** The light's direction as a unit vector (x right, y down), and how strong (0..1); null when flat. */
  light: { x: number; y: number; strength: number } | null;
  /** Mean size of same-colour 4-connected clusters (outline pixels left out), over the square root of the drawn area. */
  cluster: number | null;
  /** The ramp most of the art is drawn in (its main material). */
  material: string | null;
  /** Mean number of steps used per ramp the art uses. */
  steps: number | null;
  /** Stroke weight: the median over drawn pixels of the shorter of the horizontal and vertical drawn runs through it (icons, plan §4.5). */
  stroke: number | null;
  /** The share of the canvas the drawn box covers. */
  fill: number | null;
  /** The drawn pixels' centre of mass, and its distance from the canvas centre in pixels. */
  centre: { x: number; y: number; off: number } | null;
}

/** Stroke weight, box fill and optical centre of a frame's drawn pixels (the icon-set measures). */
function iconMeasures(px: Uint16Array, W: number, H: number): Pick<Measures, 'stroke' | 'fill' | 'centre'> {
  const runs: number[] = [];
  let n = 0, sx = 0, sy = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
  const h = new Int32Array(W * H), v = new Int32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W;) {
    if (px[y * W + x] === TRANSPARENT) { x++; continue; }
    let e = x;
    while (e < W && px[y * W + e] !== TRANSPARENT) e++;
    for (let k = x; k < e; k++) h[y * W + k] = e - x;
    x = e;
  }
  for (let x = 0; x < W; x++) for (let y = 0; y < H;) {
    if (px[y * W + x] === TRANSPARENT) { y++; continue; }
    let e = y;
    while (e < H && px[e * W + x] !== TRANSPARENT) e++;
    for (let k = y; k < e; k++) v[k * W + x] = e - y;
    y = e;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (px[i] === TRANSPARENT) continue;
    runs.push(Math.min(h[i]!, v[i]!));
    n++; sx += x; sy += y;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  if (!n) return { stroke: null, fill: null, centre: null };
  const cx = sx / n, cy = sy / n;
  return {
    stroke: median(runs),
    fill: ((x1 - x0 + 1) * (y1 - y0 + 1)) / (W * H),
    centre: { x: cx, y: cy, off: Math.hypot(cx - (W - 1) / 2, cy - (H - 1) / 2) },
  };
}

/** The measures of one document (its first frame of each view, merged). */
export function measure(d: Doc, ink: string[]): Measures {
  const pal = d.palette;
  const L = pal.entries.map((e) => lstarOf(e.hex));
  const inkSet = new Set(pal.entries.flatMap((e, i) => (ink.includes(e.name) ? [i] : [])));
  if (!inkSet.size && !d.wrap) {
    // No named outline colour: the darkest colour used counts.
    let best = -1;
    for (const v of flatten(d, 0)) if (v !== TRANSPARENT && (best < 0 || L[v]! < L[best]!)) best = v;
    if (best >= 0) inkSet.add(best);
  }
  const W = d.width, H = d.height;
  let n = 0, lsum = 0, edge = 0, edgeInk = 0, gx = 0, gy = 0, gw = 0, clusters = 0, clustered = 0;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  const rampUse = new Map<string, Set<number>>();
  const entryCount = new Map<number, number>();
  const rampCount = new Map<string, number>();
  const rampOf = new Map<number, string>();
  for (const [r, names] of Object.entries(pal.ramps)) for (const nm of names) {
    const i = pal.entries.findIndex((e) => e.name === nm);
    if (i >= 0 && !rampOf.has(i) && !inkSet.has(i)) rampOf.set(i, r);
  }
  const frames = framesOf(d);
  for (const f of frames) {
    const px = flatten(d, f);
    const at = (x: number, y: number) => (d.wrap ? px[((y + H) % H) * W + ((x + W) % W)]! : x < 0 || y < 0 || x >= W || y >= H ? TRANSPARENT : px[y * W + x]!);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = px[y * W + x]!;
      if (v === TRANSPARENT) continue;
      n++; lsum += L[v]!;
      if (f === frames[0]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      const r = rampOf.get(v);
      if (r) { (rampUse.get(r) ?? rampUse.set(r, new Set()).get(r)!).add(v); rampCount.set(r, (rampCount.get(r) ?? 0) + 1); entryCount.set(v, (entryCount.get(v) ?? 0) + 1); }
      if (!d.wrap && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at(x + dx!, y + dy!) === TRANSPARENT)) { edge++; if (inkSet.has(v)) edgeInk++; }
      // The shading gradient: between neighbours of one material, which way it gets lighter.
      if (r) for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        const u = at(x + dx, y + dy);
        if (u === TRANSPARENT || u === v || rampOf.get(u) !== r) continue;
        const dl = L[u]! - L[v]!;
        gx += dx * dl; gy += dy * dl; gw += Math.abs(dl);
      }
    }
    // Clusters: same colour, 4-connected, ink left out.
    const seen = new Uint8Array(W * H);
    for (let i = 0; i < px.length; i++) {
      const v = px[i]!;
      if (v === TRANSPARENT || inkSet.has(v) || seen[i]) continue;
      let size = 0;
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const j = stack.pop()!;
        size++;
        const x = j % W, y = Math.floor(j / W);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          let xx = x + dx, yy = y + dy;
          if (d.wrap) { xx = (xx + W) % W; yy = (yy + H) % H; } else if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const k = yy * W + xx;
          if (!seen[k] && px[k] === v) { seen[k] = 1; stack.push(k); }
        }
      }
      clusters++; clustered += size;
    }
  }
  if (!n) return { box: null, lightness: null, outline: null, light: null, cluster: null, steps: null, material: null, stroke: null, fill: null, centre: null };
  const mag = Math.hypot(gx, gy);
  const strength = gw > 0 ? mag / gw : 0;
  // Ramp steps (G16): an entry drawn on only a few pixels (a lone accent: a glint, a gem) is not a
  // step of its material; a ramp with no other entries is not a material of the art.
  const accent = Math.max(3, Math.floor(n / 100));
  const uses = [...rampUse.values()].map((s) => [...s].filter((v) => (entryCount.get(v) ?? 0) >= accent).length).filter((k) => k > 0);
  const material = [...rampCount].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null;
  return {
    box: x1 >= 0 ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null,
    lightness: lsum / n,
    outline: d.wrap ? null : edge ? edgeInk / edge : null,
    // The gradient points at the light. Below 0.1 the shading has no clear side.
    light: d.wrap || strength < 0.1 ? null : { x: gx / mag, y: gy / mag, strength },
    // Mean cluster size over the square root of the drawn area: detail at the shape's own scale.
    cluster: clusters ? clustered / clusters / Math.sqrt(n / frames.length) : null,
    steps: uses.length ? uses.reduce((a, b) => a + b, 0) / uses.length : null,
    material,
    ...iconMeasures(flatten(d, frames[0]!), W, H),
  };
}

export const LIGHT_DIRS: Record<string, [number, number]> = {
  n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1],
};

/** The first and third quartiles (linear between ranks). */
function quartiles(xs: number[]): [number, number] {
  const s = [...xs].sort((a, b) => a - b);
  const q = (f: number) => { const r = f * (s.length - 1), i = Math.floor(r); return i + 1 < s.length ? s[i]! + (s[i + 1]! - s[i]!) * (r - i) : s[i]!; };
  return [q(0.25), q(0.75)];
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
}

export interface ConsistencyOptions {
  /** Outline colours (style guide). */
  ink: string[];
  /** The style guide's light direction (n, ne, … nw). */
  light?: string;
  /** The manifest's expected drawn height in pixels. */
  height?: number;
  /** Limits: lightness ΔL* from the set's median; outline share difference; light angle in degrees; cluster size ratio; ramp steps difference; height tolerance in px. */
  maxL: number;
  maxOutline: number;
  maxAngle: number;
  maxCluster: number;
  maxSteps: number;
  heightTol: number;
  /** Icons (plan §4.5): stroke weight difference in px, box fill difference, the optical centre's distance from the canvas centre in px. */
  icon?: { maxStroke: number; maxFill: number; maxCentre: number };
}

export interface ConsistencyPart {
  name: string;
  value: number | null;
  limit: string;
  pass: boolean | null;
  detail: string;
}

export interface ConsistencyReport {
  parts: ConsistencyPart[];
  /** Peers left out because they are recolours of this asset (or it of them). */
  recolours: string[];
  /** The peers compared with. */
  peers: string[];
  box: Measures['box'];
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Hold one document to its set and to the expectations. */
export function consistencyOf(d: Doc, peers: { name: string; doc: Doc }[], o: ConsistencyOptions): ConsistencyReport {
  const recolours = peers.filter((p) => isRecolour(p.doc, d) || isRecolour(d, p.doc)).map((p) => p.name);
  const others = peers.filter((p) => p.doc !== d && !recolours.includes(p.name));
  const me = measure(d, o.ink);
  const theirs = others.map((p) => ({ name: p.name, m: measure(p.doc, o.ink) }));
  const parts: ConsistencyPart[] = [];
  if (o.height !== undefined && me.box) {
    const off = me.box.h - o.height;
    parts.push({ name: 'height', value: me.box.h, limit: `${o.height} ± ${o.heightTol}`, pass: Math.abs(off) <= o.heightTol, detail: `the drawn shape is ${me.box.h} px tall (rows ${me.box.y}..${me.box.y + me.box.h - 1}); the manifest plans ${o.height}` });
  }
  const vs = <K extends keyof Measures>(key: K, name: string, get: (m: Measures) => number | null, limit: number, fmt: (x: number) => string, ratio = false, sameMaterial = false, band = false) => {
    const mine = get(me);
    const vals = theirs.filter((t) => !sameMaterial || (t.m.material !== null && t.m.material === me.material)).map((t) => get(t.m)).filter((x): x is number => x !== null);
    if (mine === null || vals.length < 2) return;
    // The median of the whole set, this asset included (G13): every member is held to one centre,
    // so on a small set one odd asset is the outlier, not the two that disagree with it.
    const med = median([...vals, mine]);
    if (band) {
      // Held to the set's middle half (G16): the distance outside its quartiles, so one more member
      // (an import, a new prop) moves the band a little and does not flip an asset that was inside it.
      const [q1, q3] = quartiles([...vals, mine]);
      const off = mine < q1 ? q1 - mine : mine > q3 ? mine - q3 : 0;
      const mid = q1 === q3 ? fmt(q1) : `${fmt(q1)}..${fmt(q3)}`;
      parts.push({
        name, value: mine, limit: `± ${fmt(limit)} of the set's ${mid}`, pass: off <= limit,
        detail: `${fmt(mine)} against the set's middle half ${mid} (with ${vals.length} others)`,
      });
      return;
    }
    const off = ratio ? (med > 0 ? Math.max(mine / med, med / mine) : 1) : Math.abs(mine - med);
    parts.push({
      name, value: mine, limit: ratio ? `× ${limit} of the set's ${fmt(med)}` : `± ${fmt(limit)} of the set's ${fmt(med)}`, pass: off <= limit,
      detail: `${fmt(mine)} against the set's median ${fmt(med)} (with ${vals.length} others${sameMaterial ? ` mostly in ${me.material}` : ''})`,
    });
    void key;
  };
  // Lightness is compared within one material (sand is lighter than moss by nature).
  vs('lightness', 'lightness', (m) => m.lightness, o.maxL, (x) => String(r1(x)), false, true);
  vs('outline', 'outline share', (m) => m.outline, o.maxOutline, (x) => String(r2(x)));
  vs('cluster', 'cluster size', (m) => m.cluster, o.maxCluster, (x) => String(r2(x)), true);
  vs('steps', 'ramp steps', (m) => m.steps, o.maxSteps, (x) => String(r1(x)), false, false, true);
  if (o.icon) {
    // The icon set (plan §4.5): one stroke weight, boxes that fill the canvas alike, each icon optically centred.
    vs('stroke', 'stroke weight', (m) => m.stroke, o.icon.maxStroke, (x) => String(r1(x)));
    vs('fill', 'box fill', (m) => m.fill, o.icon.maxFill, (x) => String(r2(x)));
    if (me.centre) {
      const c = me.centre;
      parts.push({
        name: 'optical centre', value: r1(c.off), limit: `≤ ${o.icon.maxCentre} px from the canvas centre`, pass: c.off <= o.icon.maxCentre,
        detail: `the drawn pixels' centre is at ${r1(c.x)},${r1(c.y)}, ${r1(c.off)} px from the canvas centre ${r1((d.width - 1) / 2)},${r1((d.height - 1) / 2)}`,
      });
    }
  }
  // The light: against the style guide's direction, else the set's.
  const want = o.light && LIGHT_DIRS[o.light] ? LIGHT_DIRS[o.light]! : (() => {
    const ls = theirs.flatMap((t) => (t.m.light ? [t.m.light] : []));
    if (ls.length < 2) return null;
    const sx = ls.reduce((s, l) => s + l.x, 0), sy = ls.reduce((s, l) => s + l.y, 0);
    return Math.hypot(sx, sy) > 0 ? [sx, sy] as [number, number] : null;
  })();
  if (want && !d.wrap) {
    const wl = Math.hypot(want[0], want[1]);
    if (me.light) {
      const cos = (me.light.x * want[0] + me.light.y * want[1]) / wl;
      const angle = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
      const dir = Object.entries(LIGHT_DIRS).sort((a, b) => {
        const ca = (a[1][0] * me.light!.x + a[1][1] * me.light!.y) / Math.hypot(...a[1]), cb = (b[1][0] * me.light!.x + b[1][1] * me.light!.y) / Math.hypot(...b[1]);
        return cb - ca;
      })[0]![0];
      parts.push({ name: 'light', value: Math.round(angle), limit: `≤ ${o.maxAngle}° from ${o.light ?? "the set's"}`, pass: angle <= o.maxAngle, detail: `lit from the ${dir} (${Math.round(angle)}° from ${o.light ? `the style guide's ${o.light}` : "the set's light"})` });
    } else {
      parts.push({ name: 'light', value: null, limit: '', pass: null, detail: 'no clear lit side (flat shading)' });
    }
  }
  return { parts, recolours, peers: others.map((p) => p.name), box: me.box };
}
