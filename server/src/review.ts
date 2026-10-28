// The blind review bundle (plan §5): a folder a reviewer with no other context can judge from.
// Each asset at game scale and with rulers (for coordinates), tiles repeated 3x3, sprites on
// their ground beside their set, the palette, the style guide and a rubric. It names no method
// and no author, and holds no tape, so the reviewer judges the art alone. The tool calls no
// model: the agent hands the folder to a fresh agent and brings the findings back as notes.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  animGifFrames, composeMap, drawScaleOf, encodeGif, encodePng, flatten, groundOf, islandTerrain, mapGifFrames, renderAnimSheet, renderFamilyView, renderGame, renderMap,
  renderScaled, renderTile3x3, schemeOf, setOf, type AssetDoc, type Doc,
} from '@pixelclaw/core';
import { ProjectError } from './project.ts';
import type { Writer } from './writer.ts';

function rubric(o: { project: string; tiles: string[]; sprites: string[]; animated: string[]; families: string[]; scale: number; tickRate: number; style: string | null }): string {
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
- \`maps/<name>.png\`: each autotile set laid out as a small map at the game's draw scale (${o.scale}x),
  the way the game will place its tiles; \`maps/<name>.gif\` plays it when anything moves, and
  \`maps/<name>.tiles.txt\` says which tile is at each column and row of the map.
- \`sets/<name>.png\`: every tile of each autotile set, each in the middle of the neighbours that
  call for it (the neighbours dimmed), named.
- \`palette.md\`: the colours the art uses.${o.style ? '\n- `style.md`: the style guide.' : ''}

Tiles:
${list(o.tiles)}

Sprites:
${list(o.sprites)}

Animated:
${list(o.animated)}

Autotile sets (judge them on their maps):
${list(o.families)}

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
7. **Autotiling.** On each map, does the edge between the two grounds read as one natural edge
   (a shore, a border), with convincing outer and inner corners? Does the map show the tile grid
   (lines or blocks every tile), or the same corner piece repeating too obviously?

## How to report

End with a list of defects, one per line, each pinned to pixels in the asset's own coordinates
(x from the left, y from the top, as the rulers show), in this form:

\`\`\`
<asset> <x>,<y> "what is wrong and what to do"
<asset> <x>,<y> <w>x<h> "for a region"
\`\`\`

For a map, point at the tile by its column and row on the map (from 0 at the top left; each
tile is the set's tile size at 1x), and at the pixel inside that tile:

\`\`\`
<set> map <col>,<row> <x>,<y> "what is wrong and what to do"
\`\`\`

Only list what you can point at. If an asset is fine, say so.
`;
}

/**
 * Write a review bundle for some assets (default: all) under reviews/<date>-<name>/ and return
 * its folder and the files written.
 */
export function writeReview(w: Writer, o: { assets?: string[]; name?: string; map?: { cols?: number; rows?: number; seed?: number } } = {}): { dir: string; files: string[] } {
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
  const families = chosen.filter((a) => a.doc.family);
  const overlays = chosen.filter((a) => a.doc.overlay).map((a) => a.doc);
  const sprites = chosen.filter((a) => !a.doc.wrap && !a.doc.family && !a.doc.overlay);
  for (const a of chosen) {
    if (a.doc.family) continue;
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
  // Autotile sets on a map (their own overlays and the chosen ones playing over it), and every tile among its neighbours.
  if (families.length) { mkdirSync(join(dir, 'maps'), { recursive: true }); mkdirSync(join(dir, 'sets'), { recursive: true }); }
  for (const a of families) {
    const mo = { cols: o.map?.cols ?? 16, rows: o.map?.rows ?? 12, seed: o.map?.seed ?? 1, overlays, scale };
    save(`maps/${a.name}.png`, encodePng(renderMap(a.doc, mo)));
    const frames = mapGifFrames(a.doc, { ...mo, tickRate: w.project.json.tickRate ?? 60 });
    if (frames.length > 1) save(`maps/${a.name}.gif`, encodeGif(frames));
    const s = schemeOf(a.doc.family!);
    const m = composeMap(a.doc, islandTerrain(s, mo.cols, mo.rows, mo.seed), 0);
    const rows = Array.from({ length: mo.rows }, (_, r) => `${String(r).padStart(2)}: ` + Array.from({ length: mo.cols }, (_, c) => {
      const v = m.variants[r * mo.cols + c];
      return v === undefined || v === null ? '-' : s.variants[v]!.name;
    }).join(' '));
    save(`maps/${a.name}.tiles.txt`, `The tile at each column and row of maps/${a.name}.png ('-': the plain outside ground).\n\n${rows.join('\n')}\n`);
    save(`sets/${a.name}.png`, encodePng(renderFamilyView(a.doc, { scale: 1 })));
  }
  const animated = chosen.filter((a) => a.doc.frameCount > 1 && !a.doc.family);
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
    project: w.project.json.name, tiles: tiles.map((a) => a.name), sprites: sprites.map((a) => a.name), animated: animated.map((a) => a.name),
    families: families.map((a) => a.name), scale, tickRate, style: styleText,
  }));
  return { dir, files };
}
