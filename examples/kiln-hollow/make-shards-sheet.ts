// Makes the G12 demo's sheet to import: "an existing tile set" a person brings in, made
// here so it is original. Three 24x24 heaps of broken pots (shards in the clay and glaze ramps,
// inked) on a 2x2 grid of cells, the last cell left empty, as an artist's PNG sheet would be.
//   node examples/kiln-hollow/make-shards-sheet.ts
// writes examples/kiln-hollow/shards.png (48x48).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRgba, encodePng, renderFlat, runBatch, type Palette } from '../../core/src/index.ts';

const DIR = import.meta.dirname;
const palette = JSON.parse(readFileSync(join(DIR, 'kiln-hollow.json'), 'utf8')) as Palette;
const palettes = { get: (n: string) => (n === palette.name ? palette : undefined), defaultName: palette.name };
const HEAPS = [
  // a curved rim piece and two flat shards
  ['polygon 4,16 11,13 13,17 7,20 c=clay2 fill', 'polygon 12,18 19,15 20,19 14,21 c=clay3 fill', 'polygon 9,10 15,9 16,12 10,13 c=clay1 fill', 'line 4,16 11,13 c=clay4'],
  // a broken neck with a glazed piece beside it
  ['rect 9,8 6x9 c=clay2 fill', 'line 9,8 14,8 c=clay4', 'rect 13,9 2x8 c=clay1 fill', 'polygon 3,18 9,17 10,21 4,21 c=glaze1 fill', 'line 4,18 8,17 c=glaze3', 'polygon 15,19 21,17 21,21 16,21 c=clay3 fill'],
  // a scatter of small chips
  ['polygon 5,12 9,11 9,14 c=clay3 fill', 'polygon 13,15 18,14 17,18 c=clay2 fill', 'polygon 7,18 11,17 12,20 7,21 c=glaze2 fill', 'polygon 16,8 20,9 18,11 c=clay1 fill'],
];
const sheet = createRgba(48, 48);
HEAPS.forEach((cmds, k) => {
  const r = runBatch({ doc: null, entries: [] }, [`new sprite shard 24x24 palette=${palette.name}`, ...cmds, 'outline c=ink'].join('\n'), { by: 'maker', palettes });
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join('; '));
  const img = renderFlat(r.state.doc!);
  const ox = (k % 2) * 24, oy = Math.floor(k / 2) * 24;
  for (let y = 0; y < 24; y++) sheet.data.set(img.data.subarray(y * 96, y * 96 + 96), ((oy + y) * 48 + ox) * 4);
});
writeFileSync(join(DIR, 'shards.png'), encodePng(sheet));
