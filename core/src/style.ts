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
//     "assets": { "stone_floor": { "checks": { "repetition": { "off": true } }, "ground": "...", "set": ["..."] } }
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
  sizes?: Record<string, string>;
  checks?: Record<string, unknown>;
  assets?: Record<string, { checks?: Record<string, unknown>; ground?: string; set?: string[] }>;
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

/** The engine's draw scale for the game view. */
export function drawScaleOf(json: StyleJson | undefined): number {
  const k = json?.drawScale;
  return typeof k === 'number' && Number.isInteger(k) && k >= 1 && k <= 16 ? k : 2;
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
  o: { frame?: number; ground?: string; ref?: string; set?: string[] } = {},
): { ctx: CheckContext; problems: string[] } {
  const { style, problems } = checkStyleOf(json, palette);
  const ground = groundOf(name, assets, json, o.ground);
  if (o.ground && !ground) problems.push(`no asset '${o.ground}' to use as ground`);
  const ref = o.ref ? assets.find((a) => a.name === o.ref) ?? null : null;
  if (o.ref && !ref) problems.push(`no asset '${o.ref}' to compare with`);
  return {
    ctx: {
      frame: o.frame, style, ground: ground?.doc ?? null, ref: ref?.doc ?? null,
      set: setOf(name, doc, assets, json, o.set).map((a) => ({ name: a.name, doc: a.doc })),
      ...(doc.map || doc.variantOf ? { world: mapWorld(assets) } : {}),
    },
    problems,
  };
}
