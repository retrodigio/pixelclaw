// Palettes: named, ordered entries, each with a one-character key (used by grid views and paint
// blocks), a name and a colour; plus ramps (ordered runs of entry names). Import from the JSON
// format, Lospec JSON, .hex and .gpl.

export interface PaletteEntry {
  key: string;
  name: string;
  hex: string; // #rrggbb, lower case
}

export interface Palette {
  name: string;
  entries: PaletteEntry[];
  ramps: Record<string, string[]>;
}

export const MAX_ENTRIES = 256;
/** Characters that can never be palette keys: '.' (leave) and ' ' (clear) in paint blocks, '|' margins. */
export const RESERVED_KEYS = new Set(['.', ' ', '|']);
const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const HEX_RE = /^#?([0-9a-fA-F]{6})$/;

export class PaletteError extends Error {}

export function rgbOf(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function hexOf(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
}

export function normaliseHex(s: string): string | null {
  const m = HEX_RE.exec(s.trim());
  return m ? '#' + m[1]!.toLowerCase() : null;
}

/** Check a palette's invariants; returns it unchanged or throws PaletteError. */
export function validatePalette(p: Palette): Palette {
  if (!p.name || !NAME_RE.test(p.name)) throw new PaletteError(`palette name '${p.name}' must match ${NAME_RE}`);
  if (p.entries.length === 0) throw new PaletteError(`palette '${p.name}' has no entries`);
  if (p.entries.length > MAX_ENTRIES) throw new PaletteError(`palette '${p.name}' has ${p.entries.length} entries; the limit is ${MAX_ENTRIES}`);
  const keys = new Set<string>();
  const names = new Set<string>();
  for (const e of p.entries) {
    if ([...e.key].length !== 1) throw new PaletteError(`entry '${e.name}': key '${e.key}' must be one character`);
    if (RESERVED_KEYS.has(e.key) || /\s/.test(e.key)) throw new PaletteError(`entry '${e.name}': key '${e.key}' is reserved`);
    if (keys.has(e.key)) throw new PaletteError(`duplicate key '${e.key}'`);
    if (!NAME_RE.test(e.name)) throw new PaletteError(`entry name '${e.name}' must match ${NAME_RE}`);
    if (e.name === 'none') throw new PaletteError(`'none' is reserved (it means transparent)`);
    if (names.has(e.name)) throw new PaletteError(`duplicate entry name '${e.name}'`);
    if (!/^#[0-9a-f]{6}$/.test(e.hex)) throw new PaletteError(`entry '${e.name}': colour '${e.hex}' must be #rrggbb`);
    keys.add(e.key);
    names.add(e.name);
  }
  for (const [ramp, members] of Object.entries(p.ramps)) {
    if (!NAME_RE.test(ramp)) throw new PaletteError(`ramp name '${ramp}' must match ${NAME_RE}`);
    if (members.length === 0) throw new PaletteError(`ramp '${ramp}' is empty`);
    for (const m of members) if (!names.has(m)) throw new PaletteError(`ramp '${ramp}' names unknown entry '${m}'`);
  }
  return p;
}

/** Keys handed out to imported palettes that have none: digits, letters, punctuation, then Latin-1. */
export function autoKeys(n: number): string[] {
  const out: string[] = [];
  const ascii = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!"#$%&\'()*+,-/:;<=>?@[\\]^_`{}~';
  for (const ch of ascii) if (out.length < n) out.push(ch);
  for (let cp = 0xc0; out.length < n; cp++) if (cp !== 0xd7 && cp !== 0xf7) out.push(String.fromCodePoint(cp));
  return out;
}

function sanitiseName(raw: string, fallback: string, used: Set<string>): string {
  let s = raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  if (!s || s === 'untitled' || s === 'none') s = fallback;
  if (!/^[a-z]/.test(s)) s = 'c' + s;
  let name = s;
  for (let i = 2; used.has(name); i++) name = `${s}_${i}`;
  used.add(name);
  return name;
}

function fromColours(name: string, colours: { hex: string; name?: string }[]): Palette {
  const keys = autoKeys(colours.length);
  const used = new Set<string>();
  const entries = colours.map((c, i) => ({ key: keys[i]!, name: sanitiseName(c.name ?? '', `c${i}`, used), hex: c.hex }));
  return validatePalette({ name, entries, ramps: {} });
}

/** The palette JSON format (key/name/hex entries and ramps), or a Lospec JSON export ({colors:[...]}). */
export function parsePaletteJson(text: string, fallbackName?: string): Palette {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new PaletteError(`palette JSON does not parse: ${(e as Error).message}`);
  }
  if (typeof data !== 'object' || data === null) throw new PaletteError('palette JSON must be an object');
  const o = data as Record<string, unknown>;
  const name = typeof o.name === 'string' && NAME_RE.test(o.name) ? o.name : fallbackName ?? 'palette';
  if (Array.isArray(o.colors)) {
    // Lospec: {"name": "...", "colors": ["rrggbb", ...]}
    return fromColours(name, o.colors.map((c, i) => {
      const hex = typeof c === 'string' ? normaliseHex(c) : null;
      if (!hex) throw new PaletteError(`colors[${i}]: '${String(c)}' is not a hex colour`);
      return { hex };
    }));
  }
  if (!Array.isArray(o.entries)) throw new PaletteError(`palette JSON needs an 'entries' array (or Lospec 'colors')`);
  const entries = o.entries.map((raw, i): PaletteEntry => {
    const e = raw as Record<string, unknown>;
    const hex = typeof e.hex === 'string' ? normaliseHex(e.hex) : null;
    if (!hex) throw new PaletteError(`entries[${i}]: missing or bad 'hex'`);
    if (typeof e.key !== 'string' || typeof e.name !== 'string') throw new PaletteError(`entries[${i}]: needs 'key' and 'name' strings`);
    return { key: e.key, name: e.name, hex };
  });
  const ramps: Record<string, string[]> = {};
  if (o.ramps !== undefined) {
    if (typeof o.ramps !== 'object' || o.ramps === null || Array.isArray(o.ramps)) throw new PaletteError(`'ramps' must be an object`);
    for (const [k, v] of Object.entries(o.ramps)) {
      if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) throw new PaletteError(`ramp '${k}' must be a list of entry names`);
      ramps[k] = v as string[];
    }
  }
  return validatePalette({ name, entries, ramps });
}

/** Lospec .hex: one rrggbb per line. */
export function parseHexPalette(text: string, name: string): Palette {
  const colours: { hex: string }[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith(';') || t.startsWith('//')) return;
    const hex = normaliseHex(t);
    if (!hex) throw new PaletteError(`line ${i + 1}: '${t}' is not a hex colour`);
    colours.push({ hex });
  });
  return fromColours(name, colours);
}

/** GIMP .gpl: a 'GIMP Palette' header, optional Name/Columns, then 'R G B name' lines. */
export function parseGpl(text: string, fallbackName: string): Palette {
  const lines = text.split(/\r?\n/);
  if (!lines[0] || lines[0].trim() !== 'GIMP Palette') throw new PaletteError(`line 1: a .gpl file starts with 'GIMP Palette'`);
  let name = fallbackName;
  const colours: { hex: string; name: string }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (!t || t.startsWith('#')) continue;
    const meta = /^(Name|Columns):\s*(.*)$/.exec(t);
    if (meta) {
      if (meta[1] === 'Name') {
        const n = meta[2]!.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
        if (n && NAME_RE.test(n)) name = n;
      }
      continue;
    }
    const m = /^(\d+)\s+(\d+)\s+(\d+)\s*(.*)$/.exec(t);
    if (!m) throw new PaletteError(`line ${i + 1}: expected 'R G B name', got '${t}'`);
    const [r, g, b] = [m[1], m[2], m[3]].map(Number) as [number, number, number];
    if (r > 255 || g > 255 || b > 255) throw new PaletteError(`line ${i + 1}: channel above 255`);
    colours.push({ hex: hexOf(r, g, b), name: m[4] ?? '' });
  }
  return fromColours(name, colours);
}

/** Import by file extension: .json (palette or Lospec), .hex, .gpl. */
export function importPalette(fileName: string, text: string): Palette {
  const base = fileName.replace(/^.*[\\/]/, '');
  const stem = base.replace(/\.[^.]*$/, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'palette';
  const name = /^[a-z]/.test(stem) ? stem : 'p' + stem;
  const ext = base.slice(base.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'json') return parsePaletteJson(text, name);
  if (ext === 'hex') return parseHexPalette(text, name);
  if (ext === 'gpl') return parseGpl(text, name);
  throw new PaletteError(`unknown palette format '.${ext}' (use .json, .hex or .gpl)`);
}

/** The palette JSON format, with stable key order and one entry per line. */
export function paletteToJson(p: Palette): string {
  const entries = p.entries.map((e) => '    ' + JSON.stringify({ key: e.key, name: e.name, hex: e.hex })).join(',\n');
  const ramps = Object.entries(p.ramps).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
  return `{\n  "name": ${JSON.stringify(p.name)},\n  "entries": [\n${entries}\n  ],\n  "ramps": {${ramps ? '\n' + ramps + '\n  ' : ''}}\n}\n`;
}
