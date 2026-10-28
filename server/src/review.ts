// The blind review bundle (plan §5): a folder a reviewer with no other context can judge from.
// Each asset at game scale and with rulers (for coordinates), tiles repeated 3x3, sprites on
// their ground beside their set, the palette, the style guide and a rubric. It names no method
// and no author, and holds no tape, so the reviewer judges the art alone. The tool calls no
// model: the agent hands the folder to a fresh agent and brings the findings back as notes.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  animGifFrames, drawScaleOf, encodeGif, encodePng, flatten, groundOf, renderAnimSheet, renderGame, renderScaled, renderTile3x3, setOf, type AssetDoc, type Doc,
} from '@pixelclaw/core';
import { ProjectError } from './project.ts';
import type { Writer } from './writer.ts';

function rubric(o: { project: string; tiles: string[]; sprites: string[]; animated: string[]; scale: number; tickRate: number; style: string | null }): string {
  const list = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join('\n') : '- (none)');
  return `# Review: ${o.project}

You are reviewing pixel art for a game, with fresh eyes. Judge only what you see in this folder.

## What is here

- \`assets/<name>.png\`: each asset enlarged with a pixel grid and rulers (numbers every 8 pixels,
  from 0 at the top left), for reading coordinates.
- \`assets/<name>.game.png\`: each asset at its real size (1x) and at the game's draw scale (${o.scale}x).
- \`tiles/<name>.3x3.png\`: each tile repeated 3x3, at 1x and 4x, as it will cover the ground.
- \`scenes/<name>.png\`: each sprite on its usual ground beside the rest of its set, at 1x and ${o.scale}x.
- \`anim/<name>.png\`: each animated asset's frames, one row per sequence (a direction or a named
  loop), each frame with its length in game ticks (${o.tickRate} a second) and the frame before it
  tinted red underneath; \`anim/<name>.gif\` plays them at the game's speed.
- \`palette.md\`: the colours the art uses.${o.style ? '\n- `style.md`: the style guide.' : ''}

Tiles:
${list(o.tiles)}

Sprites:
${list(o.sprites)}

Animated:
${list(o.animated)}

## How to judge

Look at the game-scale images first, as a player would, then at the enlarged ones for detail.
Score each part from 1 (poor) to 5 (excellent) and say why in a sentence or two:

1. **Readability.** At 1x on its ground, does each sprite read at a glance: its shape, what it
   is, its front? Is its edge clear of the ground?
2. **Cohesion.** Do the pieces look like one set: the same light direction, outline rule,
   shading depth, level of detail and palette use?
3. **Seams and repetition.** Do the tiles join without visible lines at their edges? Does the
   3x3 show stripes, a grid, or a mark that repeats too obviously?
4. **Style-guide fit.** Does the art follow the style guide and use only the palette?
5. **Defects.** Stray pixels, jagged lines (uneven steps), doubled corners, pillow shading
   (shading that follows the outline on every side), muddy or flat areas, broken outlines.
6. **Animation.** Does the motion read (a walk, a shimmer)? Does a figure slide, float or jump
   from frame to frame? Does each loop join its end to its start without a hitch? Do the
   directions of a figure look like one figure, and different enough to tell apart?

## How to report

End with a list of defects, one per line, each pinned to pixels in the asset's own coordinates
(x from the left, y from the top, as the rulers show), in this form:

\`\`\`
<asset> <x>,<y> "what is wrong and what to do"
<asset> <x>,<y> <w>x<h> "for a region"
\`\`\`

Only list what you can point at. If an asset is fine, say so.
`;
}

/**
 * Write a review bundle for some assets (default: all) under reviews/<date>-<name>/ and return
 * its folder and the files written.
 */
export function writeReview(w: Writer, o: { assets?: string[]; name?: string } = {}): { dir: string; files: string[] } {
  const all = w.assetDocs();
  const names = o.assets ?? all.map((a) => a.name);
  const chosen: AssetDoc[] = names.map((n) => {
    const a = all.find((x) => x.name === n);
    if (!a) throw new ProjectError(`no asset '${n}' to review`);
    return a;
  });
  if (!chosen.length) throw new ProjectError('no assets to review');
  const date = w.stamp().slice(0, 10);
  const dir = join(w.project.dir, 'reviews', `${date}-${o.name ?? 'all'}`);
  mkdirSync(join(dir, 'assets'), { recursive: true });
  const files: string[] = [];
  const save = (rel: string, data: Uint8Array | string) => {
    writeFileSync(join(dir, rel), data);
    files.push(rel);
  };
  const style = w.project.json.style;
  const scale = drawScaleOf(style);
  const tiles = chosen.filter((a) => a.doc.wrap);
  const sprites = chosen.filter((a) => !a.doc.wrap);
  for (const a of chosen) {
    save(`assets/${a.name}.png`, encodePng(renderScaled(a.doc, { scale: Math.max(4, Math.min(16, Math.floor(256 / Math.max(a.doc.width, a.doc.height)))) })));
    save(`assets/${a.name}.game.png`, encodePng(renderGame([{ doc: a.doc }], { scale })));
  }
  if (tiles.length) mkdirSync(join(dir, 'tiles'), { recursive: true });
  for (const a of tiles) save(`tiles/${a.name}.3x3.png`, encodePng(renderTile3x3(a.doc)));
  if (sprites.length) mkdirSync(join(dir, 'scenes'), { recursive: true });
  for (const a of sprites) {
    const ground = groundOf(a.name, all, style);
    const set: Doc[] = setOf(a.name, a.doc, all, style).slice(0, 7).map((x) => x.doc);
    // Every direction of the sprite (each view's first frame), then the rest of its set.
    const dirs = a.doc.views.length ? a.doc.views.map((v) => ({ doc: a.doc, frame: v.from })) : [{ doc: a.doc }];
    save(`scenes/${a.name}.png`, encodePng(renderGame([...dirs, ...set.map((d) => ({ doc: d }))], { ground: ground?.doc ?? null, scale })));
  }
  const animated = chosen.filter((a) => a.doc.frameCount > 1);
  const tickRate = w.project.json.tickRate ?? 60;
  if (animated.length) mkdirSync(join(dir, 'anim'), { recursive: true });
  for (const a of animated) {
    save(`anim/${a.name}.png`, encodePng(renderAnimSheet(a.doc)));
    save(`anim/${a.name}.gif`, encodeGif(animGifFrames(a.doc, { tickRate })));
  }
  // The colours the art uses (an entry no pixel uses would only mislead the reviewer).
  const pals = new Map<string, string>();
  for (const a of chosen) {
    const used = new Set<number>();
    for (let f = 0; f < a.doc.frameCount; f++) for (const v of flatten(a.doc, f)) used.add(v);
    a.doc.palette.entries.forEach((e, i) => { if (used.has(i)) pals.set(e.name, e.hex + (e.role ? ` (role: ${e.role})` : '')); });
  }
  save('palette.md', `# Palette\n\nThe colours the art uses:\n\n${[...pals].map(([n, h]) => `- ${n}: ${h}`).join('\n')}\n`);
  const styleFile = join(w.project.dir, 'style.md');
  const styleText = existsSync(styleFile) ? readFileSync(styleFile, 'utf8') : null;
  if (styleText) save('style.md', styleText);
  save('rubric.md', rubric({
    project: w.project.json.name, tiles: tiles.map((a) => a.name), sprites: sprites.map((a) => a.name), animated: animated.map((a) => a.name), scale, tickRate, style: styleText,
  }));
  return { dir, files };
}
