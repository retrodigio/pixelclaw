// Preview themes for role palettes (plan §3.1, §4.8): a theme gives each colour role a colour, so
// recolourable art can be seen the way a game will tint it. Themes are only for looking: the
// document stores roles, never themed colours. Projects may add their own (project.json `themes`).

import { DEFAULT_ROLE_HEX, ROLES, normaliseHex, type Palette, type Role } from './palette.ts';

export interface Theme {
  name: string;
  colours: Record<Role, string>;
}

function hsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return '#' + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}

/** A theme from three hues: light at 60 % lightness, dark at 50 %, darkest at 40 %, one saturation. */
export function triadTheme(name: string, h1: number, h2: number, h3: number, s: number): Theme {
  return { name, colours: { black: '#000000', white: '#ffffff', light: hsl(h1, s, 0.6), dark: hsl(h2, s, 0.5), darkest: hsl(h3, s, 0.4) } };
}

/** The themes every project has. `grey` is the default: role entries' own colours. */
export const BUILTIN_THEMES: Theme[] = [
  { name: 'grey', colours: { ...DEFAULT_ROLE_HEX } },
  triadTheme('moss', 95, 115, 140, 0.45),
  triadTheme('ember', 38, 18, 352, 0.65),
  triadTheme('tide', 185, 205, 228, 0.5),
  triadTheme('dusk', 290, 265, 240, 0.35),
  triadTheme('sand', 48, 32, 18, 0.5),
];

/** A theme from project.json (`{ "light": "#…", … }`); roles left out keep the default colours. */
export function themeFromJson(name: string, o: Record<string, unknown>): Theme {
  const colours = { ...DEFAULT_ROLE_HEX };
  for (const [k, v] of Object.entries(o)) {
    if (!(ROLES as readonly string[]).includes(k)) throw new Error(`theme '${name}': unknown role '${k}' (roles: ${ROLES.join(', ')})`);
    const hex = typeof v === 'string' ? normaliseHex(v) : null;
    if (!hex) throw new Error(`theme '${name}': ${k} must be a colour like #a4552e`);
    colours[k as Role] = hex;
  }
  return { name, colours };
}

/** The palette as a theme shows it: role entries take the theme's colours, other entries stay. */
export function themedPalette(p: Palette, t: Theme | null | undefined): Palette {
  if (!t || !p.entries.some((e) => e.role)) return p;
  return { ...p, entries: p.entries.map((e) => (e.role ? { ...e, hex: t.colours[e.role] } : e)) };
}

/** Does the palette have role entries (is it role art)? */
export function hasRoles(p: Palette): boolean {
  return p.entries.some((e) => e.role);
}
