// Slicing a sheet into assets (plan §21 "Import into the gallery"): a grid of cells (a size, an
// offset to the first cell, a gap between cells), the cells read in reading order, empty ones
// skipped, and a name for each from a pattern (`{name}_{n}`, `{name}_{col}_{row}`) or from a list
// (the manifest's planned entries, in order). The dashboard's slice dialog and the server's import
// use the same functions, so what the dialog shows is what is made.

export interface SliceGrid {
  cell: [number, number];
  offset?: [number, number];
  gap?: [number, number];
}

export interface SliceCell {
  col: number;
  row: number;
  x: number;
  y: number;
}

/** Every whole cell of the grid that fits the image, in reading order. */
export function sliceCells(width: number, height: number, g: SliceGrid): SliceCell[] {
  const [cw, ch] = g.cell;
  const [ox, oy] = g.offset ?? [0, 0];
  const [gx, gy] = g.gap ?? [0, 0];
  if (cw < 1 || ch < 1 || ox < 0 || oy < 0 || gx < 0 || gy < 0) return [];
  const out: SliceCell[] = [];
  for (let row = 0, y = oy; y + ch <= height; row++, y += ch + gy) {
    for (let col = 0, x = ox; x + cw <= width; col++, x += cw + gx) out.push({ col, row, x, y });
  }
  return out;
}

export const DEFAULT_SLICE_PATTERN = '{name}_{n}';

/** An asset name from any text: lower case, a-z 0-9 _ -, starting with a letter. */
export function assetIdent(s: string, dflt = 'imported'): string {
  return s.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^[^a-z]+/, '').replace(/_+$/, '') || dflt;
}

/**
 * Names for the kept cells: from `names` in order (an error when there are too few), else from the
 * pattern: {name} the file's name, {n} the cell's number among those kept (from 1), {col} and
 * {row} its place in the grid (from 0). Names must come out different.
 */
export function sliceNames(cells: SliceCell[], o: { base: string; pattern?: string; names?: string[] }): string[] | string {
  let out: string[];
  if (o.names) {
    if (o.names.length < cells.length) return `${cells.length} cells but only ${o.names.length} names`;
    out = o.names.slice(0, cells.length);
  } else {
    const pattern = o.pattern?.trim() || DEFAULT_SLICE_PATTERN;
    out = cells.map((c, i) => assetIdent(pattern.replace(/\{name\}/g, o.base).replace(/\{n\}/g, String(i + 1)).replace(/\{col\}/g, String(c.col)).replace(/\{row\}/g, String(c.row)), o.base));
  }
  const seen = new Set<string>();
  for (const n of out) {
    if (seen.has(n)) return `the name '${n}' comes out twice (put {n}, or {col} and {row}, in the pattern)`;
    seen.add(n);
  }
  return out;
}
