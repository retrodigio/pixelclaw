// Golden renders per primitive: an 8x PNG with grid and rulers, plus the text grid, for each case.
// UPDATE_GOLDEN=1 pnpm test rewrites them; look at the PNGs before committing new ones.

import { describe, it } from 'vitest';
import { encodePng, renderGrid, renderScaled, renderTile3x3 } from '../src/index.ts';
import { EMPTY, golden, run } from './helpers.ts';

const CASES: Record<string, string> = {
  px: 'new sprite px 16x16\npx 1,1 3,1 5,2 14,14 0,15 c=ink\npx 8,8 c=rust',
  'line-shallow': 'new sprite line-shallow 16x16\nline 0,1 15,1 c=ink\nline 0,3 11,6 c=ink\nline 0,8 13,11 c=moss\nline 0,13 6,15 c=rust\nline 9,15 15,13 c=rust',
  'line-steep': 'new sprite line-steep 16x16\nline 1,0 1,15 c=ink\nline 3,0 6,11 c=ink\nline 8,0 10,8 c=moss\nline 8,15 15,8 c=rust\nline 12,0 15,3 c=rust',
  'line-polyline-pp': 'new sprite line-polyline-pp 16x16\nline 0,0 5,2 8,8 14,10 15,15 c=ink pp=on\nline 0,15 4,9 10,6 c=moss pp=on',
  'line-polyline-raw': 'new sprite line-polyline-raw 16x16\nline 0,0 5,2 8,8 14,10 15,15 c=ink pp=off\nline 0,15 4,9 10,6 c=moss pp=off',
  'line-right-angle': 'new sprite line-right-angle 16x16\nline 2,2 13,2 13,13 2,13 2,4 c=ink\nline 5,5 10,10 c=rust',
  'rect-outline': 'new sprite rect-outline 16x16\nrect 1,1 14x6 c=ink\nrect 3,9 1x1 c=rust\nrect 6,9 2x5 c=moss\nrect 10,9 5x5 c=ink',
  'rect-fill': 'new sprite rect-fill 16x16 bg=sky\nrect 1,1 14x6 c=stone fill\nrect 3,3 4x2 c=ink fill\nrect 9,9 6x6 c=moss fill\nrect 12,12 8x8 c=rust fill',
  'ellipse-outline': 'new sprite ellipse-outline 16x16\nellipse 0,0 5x5 c=ink\nellipse 6,0 10x5 c=ink\nellipse 4,10 r=3x2 c=moss\nellipse 12,11 r=3 c=rust',
  'ellipse-fill': 'new sprite ellipse-fill 16x16 bg=sky\nellipse 7,7 r=7x5 c=moss fill\nellipse 2,2 6x4 c=leaf fill\nellipse 11,11 4x4 c=rust fill',
  'fill-contiguous': 'new sprite fill-contiguous 16x16\nrect 0,0 16x16 c=ink\nline 1,14 14,1 c=ink\nfill 2,2 c=leaf\nfill 13,13 c=moss conn=8',
  'fill-global': 'new sprite fill-global 16x16 bg=sky\npx 1,1 4,4 8,2 12,12 c=ink\nrect 6,6 4x4 c=ink\nfill 0,0 c=stone mode=global\nfill 1,1 c=rust mode=global',
  paint: 'new sprite paint 16x16 bg=sky\npaint 4,4 <<\n  ..000..\n  .01110.\n  0122210\n  .01110\n  ..000..\n>>\npaint 2,12 <<\n  |r r r|\n  |.r.r.|\n>>',
  wrap: 'new tile wrap 16x16 bg=stone\nrect 12,12 8x8 c=moss fill\nline 10,3 20,3 c=ink\nellipse 0,8 r=3x3 c=rust\nfill 8,8 c=sky',
  sheet: 'new sheet sheet 32x16 cell=16x16\nrect @cell(0,0) 2,2 12x12 c=moss fill\nrect @cell(1,0) 2,2 12x12 c=rust\npx @cell(1,0) 7,7 c=ink',
};

describe('golden renders per primitive', () => {
  for (const [name, script] of Object.entries(CASES)) {
    it(name, () => {
      const doc = run(EMPTY, script).doc!;
      golden(`${name}.png`, encodePng(renderScaled(doc, { scale: 8 })));
      golden(`${name}.txt`, renderGrid(doc));
    });
  }

  it('tile3x3', () => {
    golden('wrap.tile3x3.png', encodePng(renderTile3x3(run(EMPTY, CASES.wrap!).doc!)));
  });

  it('grid region', () => {
    golden('paint.region.txt', renderGrid(run(EMPTY, CASES.paint!).doc!, { x: 3, y: 3, w: 9, h: 7 }));
  });
});
