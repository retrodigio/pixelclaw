// The diff view (plan §2 item 3): what changed between two documents, as a list of up to 60
// pixels and as before / after images with the changed pixels marked.

import { describe, expect, it } from 'vitest';
import { diffPixels, diffText, encodePng, renderDiff } from '../src/index.ts';
import { EMPTY, decodePng, golden, run } from './helpers.ts';

const before = run(EMPTY, 'new tile t 8x8 bg=stone\nrect 1,1 6x6 c=moss outline');
const after = run(before, 'px 2,2 3,3 c=ink\npx 1,1 c=none\nnote 2,2 "check"', 'human:chris');

describe('diff', () => {
  it('lists the changed pixels by name', () => {
    const ch = diffPixels(before.doc, after.doc!);
    expect(ch.map((c) => `${c.x},${c.y}`)).toEqual(['1,1', '2,2', '3,3']);
    expect(diffText(before.doc, after.doc!, ch)).toBe('3 px changed:\n  1,1 moss→none\n  2,2 stone→ink\n  3,3 stone→ink');
    expect(diffText(before.doc, before.doc!, [])).toBe('no pixels changed');
  });

  it('draws before and after with the changes marked', () => {
    const img = renderDiff(before.doc, after.doc!);
    expect([img.width, img.height]).toEqual([8 + 128 + 8 + 128 + 8, 8 + 128 + 8]);
    golden('diff.png', encodePng(img));
    // The changed pixel's centre keeps its colour; its border is magenta.
    const { rgba, width } = decodePng(encodePng(img));
    const at = (x: number, y: number) => [...rgba.slice((y * width + x) * 4, (y * width + x) * 4 + 3)];
    const ax = 8 + 128 + 8;
    expect(at(ax + 2 * 16 + 8, 8 + 2 * 16 + 8)).toEqual([0x14, 0x16, 0x1c]);
    expect(at(ax + 2 * 16, 8 + 2 * 16 + 8)).toEqual([255, 0, 200]);
  });

  it('adds a change map when more than 60 pixels changed, and treats a missing before as all new', () => {
    const big = run(before, 'rect 0,0 8x8 c=ink fill');
    expect(renderDiff(before.doc, big.doc!).width).toBe(8 + (128 + 8) * 3);
    expect(diffText(before.doc, big.doc!, diffPixels(before.doc, big.doc!))).toBe('64 px changed (more than 60: see the image)');
    expect(diffPixels(null, after.doc!).length).toBe(64);
  });
});
