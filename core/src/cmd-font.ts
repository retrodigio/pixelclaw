// Glyph sheets and icons as commands. `glyph <char>` draws one glyph from rows
// of palette keys into its cell (on the author's layer and frame) and sets or clears its own
// advance; `font set` changes the metrics; `icon mode=` sets how an icon is exported.

import { Args, blockText, drawable, fn, needDoc, registerCommand, type CommandSpec } from './commands.ts';
import { ICON_MODES, TRANSPARENT, ctxOf, type Doc, type IconMode } from './doc.ts';
import { charText, glyphCell } from './font.ts';
import { DiagError, type ParsedCommand, type Token } from './parser.ts';

function fontDoc(cmd: ParsedCommand, doc: Doc): Doc & { font: NonNullable<Doc['font']> } {
  if (!doc.font) throw new DiagError(cmd.line, cmd.col, `${cmd.name}: '${doc.name}' is a ${doc.kind}, not a font (new font <name> <W>x<H> chars=…)`);
  return doc as Doc & { font: NonNullable<Doc['font']> };
}

/** A glyph named by a letter or digit, U+XXXX, or a quoted character. */
function charOf(t: Token | undefined, cmd: ParsedCommand): number {
  if (!t) throw new DiagError(cmd.line, cmd.col + cmd.name.length + 1, `glyph: expected a character (a letter or digit, U+XXXX, or "c")`);
  const s = t.t === 'word' || t.t === 'string' ? t.v : t.t === 'int' ? String(t.v) : '';
  const m = /^U\+([0-9A-Fa-f]{1,6})$/.exec(s);
  if (t.t !== 'string' && m) return parseInt(m[1]!, 16);
  if ([...s].length === 1 && (t.t === 'string' || /^[A-Za-z0-9]$/.test(s))) return s.codePointAt(0)!;
  throw new DiagError(t.line, t.col, `glyph: '${s}' is not one character (letters and digits as themselves; anything else as U+XXXX or "c")`);
}

const glyphCmd: CommandSpec = {
  name: 'glyph',
  summary: 'glyph <char> [advance=<n>|auto] [<< rows of palette keys >>]   (a font\'s glyph: the rows replace its cell from the top-left on your layer and frame; <char> is a letter or digit, U+XXXX or "c"; advance= sets its width, auto measures its ink)',
  normalise(cmd, ctx) {
    const doc = fontDoc(cmd, drawable(cmd, ctx));
    const a = new Args(cmd, ['advance']);
    const cp = charOf(a.positional[0], cmd);
    const charTok = a.rest()[0]!;
    const block = a.positional.find((t) => t.t === 'block') as Extract<Token, { t: 'block' }> | undefined;
    for (const t of a.positional.slice(1)) if (t !== block) throw new DiagError(t.line, t.col, `glyph: unexpected '${t.t === 'word' ? t.v : '…'}'`);
    const i = doc.font.chars.indexOf(cp);
    if (i < 0) throw new DiagError(charTok.line, charTok.col, `glyph: ${charText(cp)} is not one of the font's characters`);
    const advOpt = a.opts.get('advance');
    let adv: number | 'auto' | null = null;
    if (advOpt) {
      if (advOpt.value === 'auto') adv = 'auto';
      else if (/^\d+$/.test(advOpt.value) && Number(advOpt.value) <= 1024) adv = Number(advOpt.value);
      else throw new DiagError(advOpt.line, advOpt.vcol, `advance= is a width in pixels (0..1024) or auto`);
    }
    if (!block && adv === null) throw new DiagError(cmd.line, cmd.col, `glyph: give rows (<< … >>), advance= or both`);
    const keyIndex = new Map(doc.palette.entries.map((e, k) => [e.key, k]));
    const rows = block ? block.rows.map((r) => {
      if ([...r.text].length > doc.cellW) throw new DiagError(r.line, r.col + doc.cellW, `glyph: a row is wider than the ${doc.cellW} px cell`);
      return [...r.text].map((ch, k) => {
        if (ch === '.' || ch === ' ') return TRANSPARENT;
        const idx = keyIndex.get(ch);
        if (idx === undefined) throw new DiagError(r.line, r.col + k, `glyph: '${ch}' is not a key in palette '${doc.palette.name}'`);
        return idx;
      });
    }) : null;
    if (rows && rows.length > doc.cellH) throw new DiagError(block!.line, block!.col, `glyph: ${rows.length} rows; the cell is ${doc.cellH} high`);
    const text = `glyph ${charText(cp)}${adv !== null ? ` advance=${adv}` : ''}${block ? ` <<\n${blockText(block.rows.map((r) => r.text))}>>` : ''}`;
    return {
      text,
      op: fn((d, by) => {
        if (rows) {
          const c = ctxOf(d, by);
          const cel = d.cels[c.layer]![c.frame]!;
          const [x0, y0] = glyphCell(d, i);
          for (let y = 0; y < d.cellH; y++) for (let x = 0; x < d.cellW; x++) cel[(y0 + y) * d.width + x0 + x] = rows[y]?.[x] ?? TRANSPARENT;
        }
        if (adv === 'auto') delete d.font!.advances[cp];
        else if (adv !== null) d.font!.advances[cp] = adv;
      }),
    };
  },
};

const fontCmd: CommandSpec = {
  name: 'font',
  summary: 'font set [baseline=<row>] [line=<px>] [spacing=<px>]   (a font\'s metrics: the cell row glyphs stand on, the line height, the pixels after each advance)',
  normalise(cmd, ctx) {
    const doc = fontDoc(cmd, needDoc(cmd, ctx));
    const a = new Args(cmd, ['baseline', 'line', 'spacing']);
    const sub = a.take('word', 'set');
    if (sub.v !== 'set') throw new DiagError(sub.line, sub.col, `font: expected 'set'`);
    a.done();
    const f = doc.font;
    const val = (k: 'baseline' | 'line' | 'spacing', hi: number): number => {
      const o = a.opts.get(k);
      if (!o) return f[k];
      if (!/^\d+$/.test(o.value) || Number(o.value) > hi || (k === 'line' && Number(o.value) < 1)) throw new DiagError(o.line, o.vcol, `${k}= must be ${k === 'line' ? 1 : 0}..${hi}`);
      return Number(o.value);
    };
    if (!a.opts.size) throw new DiagError(cmd.line, cmd.col, `font set: give baseline=, line= or spacing=`);
    const baseline = val('baseline', doc.cellH - 1), line = val('line', 1024), spacing = val('spacing', 64);
    return { text: `font set baseline=${baseline} line=${line} spacing=${spacing}`, op: fn((d) => { Object.assign(d.font!, { baseline, line, spacing }); }) };
  },
};

const iconCmd: CommandSpec = {
  name: 'icon',
  summary: 'icon mode=tone|full|channel   (how an icon is exported: tone art is recoloured by the game through role entries; full art is drawn as is; channel art is pure-RGB channel masks)',
  normalise(cmd, ctx) {
    const doc = needDoc(cmd, ctx);
    if (doc.kind !== 'icon') throw new DiagError(cmd.line, cmd.col, `icon: '${doc.name}' is a ${doc.kind}, not an icon`);
    const a = new Args(cmd, ['mode']);
    a.done();
    if (!a.opts.get('mode')) throw new DiagError(cmd.line, cmd.col, `icon: give mode=${ICON_MODES.join('|')}`);
    const mode = a.choice('mode', [...ICON_MODES], 'full') as IconMode;
    return { text: `icon mode=${mode}`, op: fn((d) => { d.iconMode = mode; }) };
  },
};

for (const c of [glyphCmd, fontCmd, iconCmd]) registerCommand(c);
