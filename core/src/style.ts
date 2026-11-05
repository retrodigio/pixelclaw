// The style guide's settings for checks and previews (project.json `style` and `themes`), shared
// by the server, the CLI and the watch view so they all check the same way.
//
//   "style": {
//     "palettes": ["mossy-ruins", "ruins-props"],   colours the art may use
//     "outline": ["ink"],                           outline colours
//     "ground": "grass",                            the usual ground for sprites (readability, game view)
//     "drawScale": 2,                               the engine's draw scale (game view)
//     "sizes": { "sprite": "24x24" },               required sizes per kind (coverage)
//     "checks": { "orphans": { "max": 1.5, "tile": { "max": 3 } } },
//     "assets": { "stone_floor": { "checks": { "repetition": { "off": true } }, "ground": "...", "set": ["..."] } },
//     "shadow": { "c": "darker", "dir": "se" }      the shadow helper's and maps' object shadows (G16)
//   },
//   "themes": { "rust": { "light": "#e0a070", "dark": "#a05030", "darkest": "#301008" } }

import type { CheckContext, CheckStyle } from './checks.ts';
import type { Doc } from './doc.ts';
import { mapWorld } from './map.ts';
import type { Palette } from './palette.ts';
import { BUILTIN_THEMES, themeFromJson, type Theme } from './themes.ts';

export interface StyleJson {
  palettes?: string[];
  outline?: string[];
  ground?: string;
  drawScale?: number;
  /** The engine's screen in art pixels ("384x216"): the map camera's view (default 16x9 cells of the project's grid). */
  camera?: string;
  sizes?: Record<string, string>;
  /** Densities (plan §4.7): the reducer the density check runs, and its options. */
  density?: { reducer?: string; ink?: string[]; share?: [number, number] };
  checks?: Record<string, unknown>;
  assets?: Record<string, { checks?: Record<string, unknown>; ground?: string; set?: string[] }>;
  /** The light direction (n, ne, … nw): `shade`'s default and what `consistency` holds the art to. */
  light?: string;
  /** Colours reserved for some assets (G16): entry name → the assets that may use it (the palette check flags the rest). */
  reserved?: Record<string, string[]>;
  /** Shadows (G16): `c` an entry or `darker` (a step down the ground's ramps, on maps), `dir` where they fall (default: away from the light). */
  shadow?: { c?: string; dir?: string };
  /** Per manifest set: check thresholds (`{ "props": { "checks": { "orphans": { "max": 2 } } } }`). */
  sets?: Record<string, { checks?: Record<string, unknown> }>;
}

/** The check settings from the style guide; unknown palette names are reported, not fatal. */
export function checkStyleOf(json: StyleJson | undefined, palette: (name: string) => Palette | undefined): { style: CheckStyle; problems: string[] } {
  const problems: string[] = [];
  const s = json ?? {};
  const palettes = (s.palettes ?? []).flatMap((n) => {
    const p = palette(n);
    if (!p) problems.push(`style.palettes: no palette '${n}' in the project`);
    return p ? [p] : [];
  });
  return {
    style: {
      ...(palettes.length ? { palettes } : {}), ...(s.outline ? { outline: s.outline } : {}), ...(s.sizes ? { sizes: s.sizes } : {}),
      ...(s.checks ? { checks: s.checks } : {}), ...(s.assets ? { assets: s.assets } : {}),
      ...(s.density ? { density: s.density } : {}), ...(s.light ? { light: s.light } : {}), ...(s.reserved ? { reserved: s.reserved } : {}),
    },
    problems,
  };
}

/** The built-in themes, then the project's (a project theme replaces a built-in of the same name). */
export function projectThemes(json: Record<string, unknown> | undefined): Theme[] {
  const own = Object.entries(json ?? {}).map(([n, o]) => themeFromJson(n, (o ?? {}) as Record<string, unknown>));
  return [...BUILTIN_THEMES.filter((t) => !own.some((o) => o.name === t.name)), ...own];
}

export interface AssetDoc {
  name: string;
  doc: Doc;
  /** The asset this one is a branch of, if any. */
  forkOf?: string | null;
}

/**
 * The engine's draw scale for the game view: the style guide's, else by the project's grid (G14):
 * 2 below 48 px, 1 from 48 px (a game with 48 px tiles draws them at their size).
 */
export function drawScaleOf(json: StyleJson | undefined, grid = 24): number {
  const k = json?.drawScale;
  return typeof k === 'number' && Number.isInteger(k) && k >= 1 && k <= 16 ? k : grid >= 48 ? 1 : 2;
}

/** The camera's screen size in art pixels: the style guide's, else 16x9 cells of the project's grid (384x216 at 24 px, 768x432 at 48). */
export function cameraOf(json: StyleJson | undefined, grid = 24): [number, number] {
  const m = /^(\d+)x(\d+)$/.exec(json?.camera ?? '');
  return m && Number(m[1]) > 0 && Number(m[2]) > 0 ? [Number(m[1]), Number(m[2])] : [16 * grid, 9 * grid];
}

/**
 * The usual ground of an asset: given, else the style guide's for the asset, else the project's,
 * else the first tile (alphabetically) that is not the asset itself.
 */
export function groundOf(name: string, assets: AssetDoc[], json: StyleJson | undefined, given?: string): AssetDoc | null {
  const want = given ?? json?.assets?.[name]?.ground ?? json?.ground;
  if (want) return assets.find((a) => a.name === want) ?? null;
  return [...assets].sort((a, b) => (a.name < b.name ? -1 : 1)).find((a) => a.doc.wrap && a.name !== name) ?? null;
}

/**
 * The set an asset is judged with (readability): given, else the style guide's for the asset,
 * else every other asset of the same kind and size that does not wrap, leaving out branches of
 * the same asset (they are alternatives, not neighbours).
 */
export function setOf(name: string, doc: Doc, assets: AssetDoc[], json: StyleJson | undefined, given?: string[]): AssetDoc[] {
  const want = given ?? json?.assets?.[name]?.set;
  if (want) return assets.filter((a) => want.includes(a.name) && a.name !== name);
  const root = (a: string): string => {
    let cur = a;
    for (let i = 0; i < 32; i++) {
      const up = assets.find((x) => x.name === cur)?.forkOf;
      if (!up) break;
      cur = up;
    }
    return cur;
  };
  const mine = root(name);
  return assets.filter((a) => a.name !== name && !a.doc.wrap && a.doc.kind === doc.kind && a.doc.width === doc.width && a.doc.height === doc.height && root(a.name) !== mine);
}

/** Everything a check run needs for one asset of a project. */
export function checkContextFor(
  name: string, doc: Doc, assets: AssetDoc[], json: StyleJson | undefined, palette: (n: string) => Palette | undefined,
  o: { frame?: number; ground?: string; ref?: string; set?: string[]; peers?: string[]; expect?: { height?: number }; setChecks?: Record<string, unknown> } = {},
): { ctx: CheckContext; problems: string[] } {
  const { style, problems } = checkStyleOf(json, palette);
  // A manifest set's thresholds sit between the style guide's and the asset's own.
  if (o.setChecks) style.checks = mergeChecks(style.checks ?? {}, o.setChecks);
  const ground = groundOf(name, assets, json, o.ground);
  if (o.ground && !ground) problems.push(`no asset '${o.ground}' to use as ground`);
  const ref = o.ref ? assets.find((a) => a.name === o.ref) ?? null : null;
  if (o.ref && !ref) problems.push(`no asset '${o.ref}' to compare with`);
  return {
    ctx: {
      frame: o.frame, style, ground: ground?.doc ?? null, ref: ref?.doc ?? null,
      set: setOf(name, doc, assets, json, o.set).map((a) => ({ name: a.name, doc: a.doc })),
      ...(doc.map || doc.variantOf || doc.densityOf ? { world: mapWorld(assets) } : {}),
      // A manifest set may mix kinds (tiles and families, icons and a font): only like is held to like.
      peers: (o.peers ? assets.filter((a) => o.peers!.includes(a.name) && consistencyClass(a.doc) === consistencyClass(doc)) : peersOf(name, doc, assets)).map((a) => ({ name: a.name, doc: a.doc })),
      ...(o.expect ? { expect: o.expect } : {}),
    },
    problems,
  };
}

function mergeChecks(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] = b && typeof b === 'object' && v && typeof v === 'object' ? { ...(b as object), ...(v as object) } : v;
  }
  return out;
}

const figure = (d: Doc) => !d.wrap && !d.family && !d.overlay && !d.map && !d.font && d.kind !== 'icon';

/**
 * The set an asset is held to by `consistency` when no manifest says: ground tiles with ground
 * tiles, figures and props with figures and props, icons with icons; never its own density copies.
 */
export function peersOf(name: string, doc: Doc, assets: AssetDoc[]): AssetDoc[] {
  const mine = consistencyClass(doc);
  if (mine === 'other') return [];
  return assets.filter((a) => a.name !== name && consistencyClass(a.doc) === mine && !a.doc.densityOf && !doc.densityOf);
}

/** What an asset is compared as: a ground tile, a figure (sprites, props, objects), an icon, or nothing else. */
export function consistencyClass(d: Doc): 'tile' | 'figure' | 'icon' | 'other' {
  return d.wrap && !d.family ? 'tile' : figure(d) ? 'figure' : d.kind === 'icon' ? 'icon' : 'other';
}
