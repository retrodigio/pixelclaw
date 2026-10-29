// Underlays from image providers and files (plan §6, §19). A batch's `underlay generate "<prompt>"`
// and `underlay import <file>` lines are resolved here, before the batch runs: the image is made by
// a provider (or read from the file), kept as a blob (blobs/<sha256>.png), and the line rewritten
// as `underlay <layer> blob=<sha256> image=<W>x<H> …` with where it came from. Core never calls a
// network or reads a file, and replay needs only the blob's hash.
//
// Providers: `openai` (the Images API; the key comes from OPENAI_API_KEY and is never stored,
// logged or echoed: it goes only into the request's Authorization header) and `fake` (offline and
// deterministic: the layout drawn as a rough pixel-art draft with texture, a sub-pixel offset,
// blur and noise, so snap has real work to do; tests and demos use it). Every call has a cost cap
// (estimated before the call from a price table; over the cap it is refused) and is written to
// the project's cost log, logs/underlay-costs.jsonl.

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import {
  TRANSPARENT, Pcg32, createRgba, decodePng, encodePng, hashString, parse, quote, rgbOf,
  type Doc, type Palette, type Rgba,
} from '@pixelclaw/core';
import { ProjectError, type Project } from './project.ts';
import { saveBlob } from './io.ts';

// --- blobs as images

const decoded = new Map<string, { mtime: number; img: Rgba }>();

/** A blob (blobs/<sha256>.png) decoded, or undefined when the project has no such blob. */
export function blobImage(p: Project, sha: string): Rgba | undefined {
  if (!/^[0-9a-f]{64}$/.test(sha)) return undefined;
  const f = join(p.dir, 'blobs', `${sha}.png`);
  if (!existsSync(f)) return undefined;
  const mtime = statSync(f).mtimeMs;
  const hit = decoded.get(f);
  if (hit && hit.mtime === mtime) return hit.img;
  const img = decodePng(readFileSync(f));
  decoded.set(f, { mtime, img });
  if (decoded.size > 16) decoded.delete(decoded.keys().next().value!);
  return img;
}

// --- providers

export interface ImageRequest {
  prompt: string;
  /** The image size asked for. */
  size: [number, number];
  /** The flat template it should follow (PNG, at the request size). */
  layout: Uint8Array | null;
  model: string;
  quality: string;
  /** The art grid the image stands for (document pixels), and the palette (for the fake provider). */
  grid?: [number, number];
  palette?: Palette;
  /** The layout at its own size (for the fake provider). */
  layoutImage?: Rgba | null;
}

export interface ImageResult {
  png: Uint8Array;
  /** Token counts the provider reported, when it did. */
  usage?: Record<string, unknown>;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string | FormData }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export interface ProviderEnv {
  /** The environment the key is read from (default process.env). */
  env?: Record<string, string | undefined>;
  /** The HTTP client (default global fetch); tests pass a fake. */
  fetch?: FetchLike;
}

export interface Provider {
  name: string;
  defaults: { model: string; quality: string };
  generate(req: ImageRequest, e: ProviderEnv): Promise<ImageResult>;
}

/**
 * Take every part of a secret out of a message (errors from a provider may echo a request, or the
 * key masked with its first and last characters showing, as OpenAI's 401 does): the key, anything
 * shaped like an API key (sk-…, masked or not), and any run of four or more of the key's own
 * first or last characters. Nothing of the key is ever written anywhere (G13).
 */
export function scrub(msg: string, secret: string | undefined): string {
  let out = msg.replace(/\b(sk|rk|pk)-[A-Za-z0-9_*\-.]{2,}/g, '[key]').replace(/\*{4,}[A-Za-z0-9_-]*/g, '[key]');
  if (!secret) return out;
  out = out.split(secret).join('[key]');
  for (let n = secret.length - 1; n >= 4; n--) {
    for (const part of [secret.slice(0, n), secret.slice(-n)]) if (out.includes(part)) out = out.split(part).join('[key]');
  }
  return out;
}

/**
 * Input image tokens for an image (as OpenAI counts them for vision input): scaled to fit 2048,
 * the short side to 768, then 170 tokens per 512 px tile plus 85.
 */
export function imageInputTokens(w: number, h: number): number {
  let s = Math.min(1, 2048 / Math.max(w, h));
  let W = w * s, H = h * s;
  s = Math.min(1, 768 / Math.min(W, H));
  W *= s; H *= s;
  return 85 + 170 * Math.ceil(W / 512) * Math.ceil(H / 512);
}

export const OPENAI_URL = 'https://api.openai.com/v1';

const openai: Provider = {
  name: 'openai',
  defaults: { model: 'gpt-image-1.5', quality: 'medium' },
  async generate(req, e) {
    const env = e.env ?? process.env;
    const key = env.OPENAI_API_KEY;
    if (!key) throw new ProjectError('underlay generate: OPENAI_API_KEY is not set in the environment of the PixelClaw process (the server, or the CLI running this; or use provider=fake)');
    const f = e.fetch ?? (globalThis.fetch as unknown as FetchLike);
    const size = `${req.size[0]}x${req.size[1]}`;
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      if (req.layout) {
        // An edit of the flat layout: the image follows its composition.
        const form = new FormData();
        form.append('model', req.model);
        form.append('prompt', req.prompt);
        form.append('size', size);
        form.append('quality', req.quality);
        form.append('n', '1');
        form.append('image[]', new Blob([Buffer.from(req.layout)], { type: 'image/png' }), 'layout.png');
        res = await f(`${OPENAI_URL}/images/edits`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
      } else {
        res = await f(`${OPENAI_URL}/images/generations`, {
          method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: req.model, prompt: req.prompt, size, quality: req.quality, n: 1 }),
        });
      }
    } catch (err) {
      throw new ProjectError(`underlay generate: the request failed: ${scrub((err as Error).message, key)}`);
    }
    if (!res.ok) {
      let detail = '';
      try { detail = await res.text(); } catch { /* no body */ }
      let msg = detail;
      try { msg = (JSON.parse(detail) as { error?: { message?: string } }).error?.message ?? detail; } catch { /* not JSON */ }
      throw new ProjectError(`underlay generate: OpenAI answered ${res.status}: ${scrub(msg, key).slice(0, 400)}`);
    }
    const j = (await res.json()) as { data?: { b64_json?: string }[]; usage?: Record<string, unknown> };
    const b64 = j.data?.[0]?.b64_json;
    if (!b64) throw new ProjectError('underlay generate: the answer held no image');
    return { png: new Uint8Array(Buffer.from(b64, 'base64')), ...(j.usage ? { usage: j.usage } : {}) };
  },
};

/**
 * The offline provider: a rough draft of the layout (or of noise, without one) as a generator
 * might return it. Each art pixel takes one of the palette colours nearest its layout colour
 * (clustered, seeded by the prompt), the art is enlarged to the request size with a sub-pixel
 * offset, then blurred and given noise. Deterministic for the same request.
 */
export function fakeDraft(req: ImageRequest): Rgba {
  const [W, H] = req.size;
  const g = new Pcg32(hashString(`${req.prompt}|${W}x${H}`), 7);
  const lay = req.layoutImage ?? null;
  const [cols, rows] = req.grid ?? (lay ? [lay.width, lay.height] : [Math.round(W / 8), Math.round(H / 8)]);
  const pal = (req.palette?.entries ?? []).map((e) => rgbOf(e.hex));
  // The art: the layout's colour per art pixel, moved to a nearby palette colour in clusters.
  const art = new Uint8Array(cols * rows * 4);
  // A coarse value-noise field (0..1) on a lattice, smoothly interpolated.
  const lattice = new Map<string, number>();
  const at = (x: number, y: number) => {
    const k = `${x},${y}`;
    if (!lattice.has(k)) lattice.set(k, g.nextInt(1000) / 1000);
    return lattice.get(k)!;
  };
  const field = (x: number, y: number) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx, bottom = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
    return top * (1 - sy) + bottom * sy;
  };
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    let c: [number, number, number];
    if (lay) {
      const o = (Math.min(lay.height - 1, Math.floor(((j + 0.5) * lay.height) / rows)) * lay.width + Math.min(lay.width - 1, Math.floor(((i + 0.5) * lay.width) / cols))) * 4;
      c = [lay.data[o]!, lay.data[o + 1]!, lay.data[o + 2]!];
    } else c = [g.nextInt(256), g.nextInt(256), g.nextInt(256)];
    if (pal.length) {
      const dist = (k: number) => (pal[k]![0] - c[0]) ** 2 + (pal[k]![1] - c[1]) ** 2 + (pal[k]![2] - c[2]) ** 2;
      const best = pal.reduce((b, _, k) => (dist(k) < dist(b) ? k : b), 0);
      // Texture: the neighbouring steps of the same ramp (a material keeps its colours), in
      // patches: lighter where a coarse noise field is high, darker where it is low.
      const name = req.palette!.entries[best]!.name;
      const ramp = Object.values(req.palette!.ramps).find((r) => r.includes(name));
      const step = (d: number) => {
        const n = ramp?.[ramp.indexOf(name) + d];
        const k = n ? req.palette!.entries.findIndex((e) => e.name === n) : -1;
        return k >= 0 ? k : best;
      };
      const v = field(i / 2, j / 2) * 0.5 + (g.nextInt(1000) / 1000) * 0.5;
      c = pal[v > 0.66 ? step(1) : v < 0.3 ? step(-1) : best]!;
    }
    art.set([c[0], c[1], c[2], 255], (j * cols + i) * 4);
  }
  // Enlarged with a sub-pixel offset, then a 3x3 blur and noise.
  const px = W / cols, py = H / rows;
  const ox = (px * (g.nextInt(31) - 15)) / 100, oy = (py * (g.nextInt(31) - 15)) / 100;
  const raw = new Float64Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = Math.min(cols - 1, Math.max(0, Math.floor((x + 0.5 - ox) / px)));
    const j = Math.min(rows - 1, Math.max(0, Math.floor((y + 0.5 - oy) / py)));
    for (let c = 0; c < 3; c++) raw[(y * W + x) * 3 + c] = art[(j * cols + i) * 4 + c]!;
  }
  const out = createRgba(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    for (let c = 0; c < 3; c++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        s += raw[(yy * W + xx) * 3 + c]!; n++;
      }
      out.data[(y * W + x) * 4 + c] = Math.max(0, Math.min(255, Math.round(s / n + g.nextInt(7) - 3)));
    }
    out.data[(y * W + x) * 4 + 3] = 255;
  }
  return out;
}

const fake: Provider = {
  name: 'fake',
  defaults: { model: 'draft', quality: 'medium' },
  async generate(req) {
    return { png: encodePng(fakeDraft(req)) };
  },
};

export const PROVIDERS: ReadonlyMap<string, Provider> = new Map([openai, fake].map((p) => [p.name, p]));

// --- prices and the cost cap

export interface PriceEntry {
  /** US dollars per image, by quality and then by size ("1024x1024"). */
  image?: Record<string, Record<string, number>>;
  /** US dollars per million tokens, when the provider reports usage (input text, input image, output image). */
  tokens?: { textIn?: number; imageIn?: number; imageOut?: number };
}

/**
 * Estimates for OpenAI's image models (US dollars per image; check https://openai.com/api/pricing/
 * and override in project.json `underlay.prices`). An edit also pays for the layout image's input
 * tokens: the estimate adds them (imageIn per million tokens), and the usage-based cost (when the
 * answer reports usage) has them as billed.
 */
export const DEFAULT_PRICES: Record<string, PriceEntry> = {
  'gpt-image-1.5': {
    image: {
      low: { '1024x1024': 0.009, '1536x1024': 0.013, '1024x1536': 0.013 },
      medium: { '1024x1024': 0.034, '1536x1024': 0.05, '1024x1536': 0.05 },
      high: { '1024x1024': 0.133, '1536x1024': 0.2, '1024x1536': 0.2 },
    },
    tokens: { textIn: 5, imageIn: 8, imageOut: 32 },
  },
  'gpt-image-1': {
    image: {
      low: { '1024x1024': 0.011, '1536x1024': 0.016, '1024x1536': 0.016 },
      medium: { '1024x1024': 0.042, '1536x1024': 0.063, '1024x1536': 0.063 },
      high: { '1024x1024': 0.167, '1536x1024': 0.25, '1024x1536': 0.25 },
    },
    tokens: { textIn: 5, imageIn: 10, imageOut: 40 },
  },
  'gpt-image-1-mini': {
    image: {
      low: { '1024x1024': 0.005, '1536x1024': 0.006, '1024x1536': 0.006 },
      medium: { '1024x1024': 0.011, '1536x1024': 0.015, '1024x1536': 0.015 },
      high: { '1024x1024': 0.036, '1536x1024': 0.052, '1024x1536': 0.052 },
    },
    tokens: { textIn: 2, imageIn: 2.5, imageOut: 8 },
  },
  draft: { image: { low: {}, medium: {}, high: {} } },
};

/** The default per-call cap in US dollars (PIXELCLAW_UNDERLAY_CAP or project.json underlay.cap override it). */
export const DEFAULT_CAP = 0.25;

export interface UnderlayConfig {
  provider?: string;
  model?: string;
  quality?: string;
  size?: string;
  cap?: number;
  prices?: Record<string, PriceEntry>;
}

/**
 * The estimated cost of one image (null when the price table has no entry for it): the image,
 * plus for an edit the input tokens of the image sent (and the prompt's, about 4 characters a
 * token) at the model's token prices.
 */
export function estimateCost(provider: string, model: string, quality: string, size: string, prices: Record<string, PriceEntry>, input?: { image?: [number, number] | null; prompt?: string }): number | null {
  if (provider === 'fake') return 0;
  const q = prices[model]?.image?.[quality];
  const out = q?.[size];
  if (out === undefined) return null;
  const t = prices[model]?.tokens;
  const imageIn = input?.image ? imageInputTokens(input.image[0], input.image[1]) * (t?.imageIn ?? 0) : 0;
  const textIn = input?.prompt ? Math.ceil(input.prompt.length / 4) * (t?.textIn ?? 0) : 0;
  return out + (imageIn + textIn) / 1e6;
}

/** The cost from reported usage, when the price table has token prices for the model. */
export function usageCost(model: string, usage: Record<string, unknown> | undefined, prices: Record<string, PriceEntry>): number | null {
  const t = prices[model]?.tokens;
  if (!usage || !t) return null;
  const d = (usage.input_tokens_details ?? {}) as Record<string, number>;
  const textIn = Number(d.text_tokens ?? 0), imageIn = Number(d.image_tokens ?? 0), out = Number(usage.output_tokens ?? 0);
  if (!Number.isFinite(textIn + imageIn + out)) return null;
  return (textIn * (t.textIn ?? 0) + imageIn * (t.imageIn ?? 0) + out * (t.imageOut ?? 0)) / 1e6;
}

export const COST_LOG = join('logs', 'underlay-costs.jsonl');

function logCost(p: Project, rec: Record<string, unknown>): void {
  const f = join(p.dir, COST_LOG);
  mkdirSync(join(f, '..'), { recursive: true });
  appendFileSync(f, JSON.stringify(rec) + '\n');
}

/** The cost log's lines (for `pixelclaw underlay costs` and tests). */
export function readCostLog(p: Project): Record<string, unknown>[] {
  const f = join(p.dir, COST_LOG);
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
}

// --- resolving underlay lines

export interface ResolveOptions extends ProviderEnv {
  /** The document the batch draws on (null when the batch creates it). */
  doc: Doc | null;
  /** The writer's clock, for the cost log. */
  now: string;
}

const SIZES: [number, number][] = [[1024, 1024], [1536, 1024], [1024, 1536]];

/** The supported size closest to the shape of the area the underlay is placed on (its orientation and aspect). */
export function sizeFor(area: [number, number] | null): [number, number] {
  if (!area) return [1536, 1024];
  const r = area[0] / area[1];
  return SIZES.reduce((best, s) => (Math.abs(Math.log(s[0] / s[1] / r)) < Math.abs(Math.log(best[0] / best[1] / r)) ? s : best));
}

/** An image stretched to a size, nearest neighbour (layouts are flat colour, so this keeps them flat). */
function stretch(img: Rgba, w: number, h: number): Rgba {
  const out = createRgba(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(img.width - 1, Math.floor(((x + 0.5) * img.width) / w)), sy = Math.min(img.height - 1, Math.floor(((y + 0.5) * img.height) / h));
    out.data.set(img.data.subarray((sy * img.width + sx) * 4, (sy * img.width + sx) * 4 + 4), (y * w + x) * 4);
  }
  return out;
}

/** One layer of a document in its palette's colours (a layout drawn on a layer). */
function layerImage(doc: Doc, name: string, box?: { x: number; y: number; w: number; h: number }): Rgba | null {
  const i = doc.layers.findIndex((l) => l.name === name);
  if (i < 0) return null;
  const cel = doc.cels[i]![0]!;
  // Only the placed area: the layout the image must follow is what lies under the underlay.
  const b = box ?? { x: 0, y: 0, w: doc.width, h: doc.height };
  const out = createRgba(b.w, b.h);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const X = b.x + x, Y = b.y + y;
    if (X < 0 || Y < 0 || X >= doc.width || Y >= doc.height) continue;
    const v = cel[Y * doc.width + X]!;
    if (v === TRANSPARENT) continue;
    const c = rgbOf(doc.palette.entries[v]!.hex);
    out.data.set([c[0], c[1], c[2], 255], (y * b.w + x) * 4);
  }
  return out;
}

/** Where an underlay goes on the document: at= and size= (default the whole canvas), in document pixels. */
function placedArea(opts: Map<string, string>, doc: Doc | null, where: string): { x: number; y: number; w: number; h: number } | null {
  const at = opts.get('at'), size = opts.get('size');
  const am = at ? /^(\d+),(\d+)$/.exec(at) : null, sm = size ? /^(\d+)x(\d+)$/.exec(size) : null;
  if (at && !am) throw new ProjectError(`${where}: at= is a point x,y`);
  if (size && (!sm || Number(sm[1]) < 1 || Number(sm[2]) < 1)) throw new ProjectError(`${where}: size= is the placed area, like 72x48`);
  const [x, y] = am ? [Number(am[1]), Number(am[2])] : [0, 0];
  if (sm) return { x, y, w: Number(sm[1]), h: Number(sm[2]) };
  return doc ? { x, y, w: doc.width, h: doc.height } : null;
}

const RESOLVED = /^\s*underlay\s+(generate|import)\b/;

/** Does a batch hold lines the server must resolve first? */
export function needsUnderlay(text: string): boolean {
  return text.split(/\r?\n/).some((l) => RESOLVED.test(l));
}

/**
 * Rewrite a batch's `underlay generate` and `underlay import` lines into `underlay <layer> blob=…`
 * lines, making the images. Each such command must be on a line of its own.
 */
export async function resolveUnderlays(p: Project, text: string, o: ResolveOptions): Promise<string> {
  const lines = text.split(/\r?\n/);
  let inBlock = false;
  const cfg: UnderlayConfig = (p.json as { underlay?: UnderlayConfig }).underlay ?? {};
  const prices = { ...DEFAULT_PRICES, ...(cfg.prices ?? {}) };
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    if (inBlock) { if (line.trim() === '>>') inBlock = false; continue; }
    if (/<<\s*(#.*)?$/.test(line) && !RESOLVED.test(line)) { inBlock = true; continue; }
    if (!RESOLVED.test(line)) continue;
    const parsed = parse(line);
    const where = `line ${li + 1}`;
    if (parsed.errors.length) throw new ProjectError(`${where}: ${parsed.errors[0]!.message}`);
    if (parsed.commands.length !== 1) throw new ProjectError(`${where}: put underlay ${RESOLVED.exec(line)![1]} on a line of its own`);
    const cmd = parsed.commands[0]!;
    const opts = new Map<string, string>();
    const pos: string[] = [];
    for (const t of cmd.args) {
      if (t.t === 'kv') opts.set(t.key, t.value);
      else if (t.t === 'string' || t.t === 'word') pos.push(t.v);
      else throw new ProjectError(`${where}: underlay: unexpected '${t.t}'`);
    }
    const sub = pos.shift()!;
    const allowed = sub === 'generate' ? ['layer', 'layout', 'image', 'provider', 'model', 'quality', 'cap', 'at', 'size'] : ['layer', 'layout', 'at', 'size'];
    for (const k of opts.keys()) if (!allowed.includes(k)) throw new ProjectError(`${where}: underlay ${sub} has no option '${k}' (options: ${allowed.join(', ')})`);
    const layer = opts.get('layer') ?? (sub === 'generate' ? 'mockup' : 'underlay');
    const place = `${opts.has('at') ? ` at=${opts.get('at')}` : ''}${opts.has('size') ? ` size=${opts.get('size')}` : ''}`;
    const area = placedArea(opts, o.doc, where);
    // The layout: a PNG file (a flat template) or a layer of the document.
    let layoutImg: Rgba | null = null, layoutBlob: string | null = null;
    const layoutRef = opts.get('layout');
    if (layoutRef && layoutRef !== 'none') {
      const path = isAbsolute(layoutRef) ? layoutRef : resolve(p.dir, layoutRef);
      if (/\.png$/i.test(layoutRef) && existsSync(path)) {
        const bytes = readFileSync(path);
        layoutImg = decodePng(bytes);
        layoutBlob = saveBlob(p, bytes, '.png');
      } else {
        layoutImg = o.doc ? layerImage(o.doc, layoutRef, area ?? undefined) : null;
        if (!layoutImg) throw new ProjectError(`${where}: layout=${layoutRef} is neither a PNG file in the project nor a layer of the asset`);
        layoutBlob = saveBlob(p, encodePng(layoutImg), '.png');
      }
    }
    if (sub === 'import') {
      const file = pos[0];
      if (!file || pos.length > 1) throw new ProjectError(`${where}: underlay import <file.png>`);
      const path = isAbsolute(file) ? file : resolve(p.dir, file);
      if (!existsSync(path)) throw new ProjectError(`${where}: underlay import: no file ${file}`);
      const bytes = readFileSync(path);
      let img: Rgba;
      try { img = decodePng(bytes); } catch (e) { throw new ProjectError(`${where}: underlay import: ${basename(file)}: ${(e as Error).message}`); }
      const blob = saveBlob(p, bytes, '.png');
      lines[li] = `underlay ${layer} blob=${blob} image=${img.width}x${img.height}${place}${layoutBlob ? ` layout=${layoutBlob}` : ''} from=${quote(basename(file))}`;
      continue;
    }
    // generate
    const prompt = pos[0];
    if (!prompt || pos.length > 1) throw new ProjectError(`${where}: underlay generate "<prompt>" (the prompt in quotes)`);
    const providerName = opts.get('provider') ?? cfg.provider ?? 'openai';
    const provider = PROVIDERS.get(providerName);
    if (!provider) throw new ProjectError(`${where}: no provider '${providerName}' (providers: ${[...PROVIDERS.keys()].join(', ')})`);
    const model = opts.get('model') ?? (providerName === (cfg.provider ?? 'openai') ? cfg.model : undefined) ?? provider.defaults.model;
    const quality = opts.get('quality') ?? cfg.quality ?? provider.defaults.quality;
    const sizeText = opts.get('image') ?? cfg.size;
    const size: [number, number] = sizeText ? (() => {
      const m = /^(\d+)x(\d+)$/.exec(sizeText);
      if (!m) throw new ProjectError(`${where}: image= is the size to ask for, like 1536x1024`);
      return [Number(m[1]), Number(m[2])] as [number, number];
    })() : sizeFor(area ? [area.w, area.h] : null);
    const capRaw = opts.get('cap') ?? process.env.PIXELCLAW_UNDERLAY_CAP ?? (cfg.cap !== undefined ? String(cfg.cap) : undefined);
    const cap = capRaw !== undefined ? Number(capRaw) : DEFAULT_CAP;
    if (!Number.isFinite(cap) || cap < 0) throw new ProjectError(`${where}: cap= is US dollars, like 0.25`);
    const sizeKey = `${size[0]}x${size[1]}`;
    const estimate = estimateCost(providerName, model, quality, sizeKey, prices, { image: layoutImg ? size : null, prompt });
    const base = { at: o.now, provider: providerName, model, quality, size: sizeKey, layout: layoutBlob, prompt, estimate, cap };
    if (estimate === null) {
      logCost(p, { ...base, ok: false, error: 'no price for this model, quality and size' });
      throw new ProjectError(`${where}: no price for ${model} at ${quality} ${sizeKey}, so the cost cap cannot be checked; add it to project.json underlay.prices`);
    }
    if (estimate > cap) {
      logCost(p, { ...base, ok: false, error: `over the cap` });
      throw new ProjectError(`${where}: ${model} at ${quality} ${sizeKey} is about $${estimate.toFixed(3)}, over the cap of $${cap.toFixed(2)} a call (cap=, PIXELCLAW_UNDERLAY_CAP or project.json underlay.cap)`);
    }
    let res: ImageResult;
    try {
      res = await provider.generate({
        prompt, size, model, quality, layout: layoutImg ? encodePng(stretch(layoutImg, size[0], size[1])) : null,
        ...(o.doc ? { grid: [area!.w, area!.h] as [number, number], palette: o.doc.palette } : {}), layoutImage: layoutImg,
      }, o);
    } catch (e) {
      logCost(p, { ...base, ok: false, error: (e as Error).message });
      throw e;
    }
    let img: Rgba;
    try { img = decodePng(res.png); } catch (e) { throw new ProjectError(`${where}: the provider's image does not decode: ${(e as Error).message}`); }
    const blob = saveBlob(p, res.png, '.png');
    const actual = usageCost(model, res.usage, prices);
    const cost = actual ?? estimate;
    logCost(p, { ...base, ok: true, blob, ...(res.usage ? { usage: res.usage } : {}), ...(actual !== null ? { actual } : {}) });
    lines[li] = `underlay ${layer} blob=${blob} image=${img.width}x${img.height}${place}${layoutBlob ? ` layout=${layoutBlob}` : ''} prompt=${quote(prompt)} provider=${providerName} model=${model} quality=${quality} cost=${cost.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') || '0'}`;
  }
  return lines.join('\n');
}
