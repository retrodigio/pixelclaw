# Checks

Every check reads an asset's flat art and returns a score, pass or fail against a threshold,
and the pixels it flags. The checks of one image run on **every frame**: the
result is the worst frame's, its detail starts `frame N:`, and every flagged pixel names its
frame (the watch view and marked images circle those on the frame shown). `coverage`, `anim` and
`views` look at the whole document at once. Thresholds come from the project's style guide
(`project.json` `style.checks`), with the defaults below. Checks never change the document; the
server, the CLI and the watch view compute them with the same code from the same style guide, so
they always agree.

- MCP: every `run` result ends with a one-line summary (over every frame; on a large canvas,
  above 262,144 pixels counting every frame, only the frame being drawn on, and the detail says
  so: `check` always covers every frame); `check(asset)` gives the table with
  coordinates and an image with the flagged pixels circled in magenta; `check()` without an
  asset gives one line per asset. `view(..., marks="failing")` circles them on any view.
- CLI: `pixelclaw check <project> [asset...] [--checks a,b] [--frame N] [--ground g] [--ref r]
  [--marks]` prints the table and exits 1 if anything fails; `run` prints the summary.
- Watch view: a chip per check in the header. Click one to circle its pixels on the canvas and
  open its details; *📌 note* pins its flagged pixels as notes for the agent (one per cluster).

| Check | Applies to | Score | Default threshold | What it flags |
|---|---|---|---|---|
| `palette` | all | pixels outside the allowed colours | ≤ 0 | Pixels whose colour is not in the style palettes (`style.palettes`; unset: any colour of the document's palette). In role art, pixels that are not a role. Icons by their export mode: a `tone` icon wants every pixel a role, a `full` icon none, a `channel` icon only pure channel colours (each of R, G and B 0 or 255). **Reservations**: `style.reserved` (`{ "lantern": ["lamp", "lighthouse"] }`) keeps an entry for the assets listed; any other asset that uses it is flagged. |
| `orphans` | all | stray pixels per 100 opaque pixels | ≤ 1 (tiles ≤ 2) | **The 2 px rule:** a pixel is a stray when no pixel beside it (up, down, left, right) has its colour and the 8-connected group of its colour it belongs to is 1 or 2 px: a lone pixel (no neighbour, diagonals included, shares its colour) or a diagonal pair (two pixels touching only at a corner). A group of 3 px or more is not a stray, even when it touches only by corners (a pixel on a diagonal line); nor is any pixel with a same-colour side neighbour (a 2x1 dash is fine). Each stray pixel counts, so a diagonal pair counts 2. On tiles a stray one ramp step from the colour most of its side neighbours have is texture and allowed (`keep=texture` on `clean orphans` keeps those too). `clean orphans [size=1]` repaints strays with their surroundings. A pixel or region marked with `keep <x,y> [WxH]` (an eye, a mouth) is meant to stand alone and is not counted; the detail says how many were kept. |
| `jaggies` | all but fonts | defects | ≤ 0 (tiles ≤ 2 per 24x24 px of cell: 8 at 48 px; sprites and objects one more per `area` 1152 px of art: 0 at 24x24, 2 at 48x48, 8 at 96x96, an object's art being all its cells) | Doubled L-corners (a line zig-zags through a corner a pixel-perfect line would step diagonally past), irregular step runs (a run longer or shorter than both neighbours by 2 or more: 1-2-1-3), and on sprites spikes and notches on the silhouette. On tiles the ground colour between marks is not a line. It judges outlines and lines of one colour: steps between neighbouring entries of one ramp inside a shape are **shading** and not counted (a doubled corner whose inner corner is the next or previous step of the same ramp, or the outline the band runs along; a thin run between steps of its own ramp); the detail says how many were left out. |
| `banding` | sprites | pillow share, 0 to 1 | ≤ 0.5 | Pillow shading, per material (ramp): ramp steps that follow the outline and get lighter (or darker) inward on every side alike. Light from one side makes the sides disagree. |
| `outline` | sprites | share of the silhouette edge in ink | ≥ 0.85 | Edge pixels not in the outline colour (`style.outline`, else entries named ink, outline or black; in role art the `black` role). |
| `seam` | tiles, families | the seam metric (below) | ≤ 1 | Tiles: the edge columns or rows that stand out. Families: the same metric over a composed map (the 12x10 island of seed 1, the `map` view's default), no pixels flagged; `view map` shows it. |
| `coverage` | all | missing items | ≤ 0 | A size other than the style's (`style.sizes`), a size that is not whole cells, empty frames, empty cells of a sheet. Families: every variant the scheme names and both textures drawn, on every frame (an outside left empty on purpose, over a drawn inside, is fine: the ground below shows). A density copy is held to its level's sizes (d times the style's). |
| `readability` | sprites | edge contrast share | ≥ 0.8 | Edge pixels within ΔL* 15 of the ground under them (the usual ground tile, repeated). Also: the silhouette's IoU with each asset of its set (≤ 0.9; a palette-swap recolour of it is not compared), and the lightness spread inside (L* p95 − p5 ≥ 25). |
| `revert` | with `ref=` | share of pixels unchanged from the reference | ≤ 0.15 | Pixels with the same colour as the reference asset at the same place. |
| `repetition` | tiles | ΔL* × √width of the worst band | ≤ 3, raised by the band's spread | The most visible stripe when the tile is repeated: a band of 1 to 6 rows (up to a quarter of the tile; from 48 px, 6 per 24 px: 12 at 48; widths count in lines of a 24 px tile, so a 2-line band at 48 px scores as a 1-line band at 24) (or columns) lighter or darker than the rest. **The limit scales with the band's own contrast**: it is the larger of `max` (3) and `contrast` (3) × the band's lightness spread along its length (the standard deviation of its cross-section means) × √(width / length). A band that differs because of one mark on a calm tile (a pebble, a crack) varies a lot along its length and reads as a dotted row of that mark, not a stripe; a band even along its length keeps 3. The band reported is the one nearest to failing (score over its limit; a raised limit is shown, `≤ 4.4`, and said in the detail). `contrast: 0` is the old rule. Flags the marks that make it. |
| `anim` | 2 frames or more | the worst frame-to-frame change | 8–35 % (tiles 3–35 %) | Per sequence (tags, views; mirror views are their source): **frame diff** (changed pixels over the union of both silhouettes; good walk cycles change 16-19 %): too little (a held frame or one that barely moves) or too much (a jump), flagging the changed pixels; the **loop seam** of a cycle (last frame back to the first) in the same band; sprites also: **pivot drift** (the silhouette's centre column moving by more than 1 px between frames: it slides), **ground drift** (the lowest row off the ground line, or off the first frame's: it floats or sinks; 0 px), and **area jumps** (the silhouette growing or shrinking by more than 15 %). Thresholds `minDiff`, `maxDiff`, `maxPivot`, `maxGround`, `maxArea`. |
| `fit` | objects and oversized tiles | problems | ≤ 0 | Footprint cells with nothing drawn, and art outside the footprint that is not a roof (`r`): an actor walking behind would be drawn over it. Skips one-cell assets without a footprint, families, overlays and sheets. |
| `variant` | assets with `variant of=` | L1 of the colour shares; mean ΔL* | < 0.3; < 2 | A variant whose colour mix strays from its base reads as a patch on a map. Flags the border pixels that differ from the base's (a seam where they meet, unless the textures blend). |
| `density` | copies with `density of=` | share of the base's pixels the reduction changes | ≤ 25 % | The copy reduced by its factor with the style's reducer (`style.density`: `reducer` ink-vote, mode or nearest; `ink`; `share`) against its authored base; flags the copy's blocks that reduce to another colour. A lower copy is authored, so some difference is expected: the report says where. See [profiles.md](profiles.md#densities). |
| `consistency` | everything but families and overlays; maps | outlier measures | ≤ 0 | Held to the rest of its set (the manifest's set, else tiles with tiles and figures and props with figures and props) and to the manifest: the drawn shape's **height** against the manifest's (± `heightTol` 2); **lightness** (mean L*) against the set's median among assets drawn mostly in the same ramp (± `maxL` 18); **outline share** (± `maxOutline` 0.3); the **light** direction from the shading gradient inside each ramp against `style.light`, else the set's (≤ `maxAngle` 90°); **cluster size** (mean same-colour cluster over the square root of the drawn area, within × `maxCluster` 3 of the median); **ramp steps** used per material (± `maxSteps` 1.5 outside the set's middle half, its first to third quartile, so one more member does not flip an asset that was inside it; an entry drawn on fewer than 3 px or 1% of the art, a lone accent such as a glint, is not a step). Set measures need two others; each asset is held to the median of the whole set, itself included, so on a small set the odd one out fails rather than the two that disagree with it. Palette-swap recolours (the same pixels through a one-to-one colour mapping) are not compared with each other. On a map: the objects standing on it, each against the others; flags the cells of the one that stands out. Flags a shape's top and bottom rows when its height is off. Only like is held to like within a set: ground tiles, figures (sprites, props, objects) and icons. **Icons** also: **stroke weight** (the median over drawn pixels of the shorter drawn run through it, across and down; ± `maxStroke` 1 px of the set's), **box fill** (the share of the canvas the drawn box covers; ± `maxFill` 0.2) and the **optical centre** (the drawn pixels' centre of mass, ≤ `maxCentre` 1.5 px from the canvas centre, even without a set); flags the drawn box. Limits in pixels are set for 16 px icons and 24 px cells and grow with bigger ones: `maxStroke` and `maxCentre` × size/16 on icons over 16 px (3 and 4.5 px at 48), the height tolerance × cell/24 over 24 px. |
| `margin` | sprites and icons (objects: turn it on) | px on an edge | ≤ 0 | Art touching an edge of its cell (an object's: its canvas): cut by the canvas, or no room for its outline. The bottom edge, where a sprite stands, is allowed unless `bottom` is false. Objects fill their map cells by design, so it is off for them. Flags the pixels on each edge. |
| `pieces` | sprites and objects | parts | ≤ 0 | Parts of the art that touch nothing else (8-connected, per cell; an object's art is all its cells), of at least `min` 4 px: a floating lamp room, a hat beside its head. Smaller specks are `orphans`' business. Turn it off for an asset that is meant to float. Flags each part with its box. |
| `font` | fonts | problems | ≤ 0 | A glyph sheet's metrics: one **cap height** for the capitals (A-Z less Q, measured from the baseline up), one **x-height** for the lowercase letters without ascenders (a c e m n o r s u v w x z), letters and digits without descenders **standing on the baseline**, every glyph but spaces **drawn**, nothing drawn **past its advance**, and the **line height** no shorter than the glyphs' rows and within `maxLine` (the profile's limit; 0: none). Flags the top row of an odd glyph, the bottom row of one off the baseline, pixels past an advance. |
| `views` | 2 views or more | the least difference between two views | ≥ 20 % | Directions that look too alike: each pair of views is compared on its first frame, by colour over both silhouettes. Mirror views count as their source, and views facing each other left to right (E and W) are not compared. |

Checks that do not apply are skipped (seam on a sprite, outline on a tile, revert without a
reference), as are checks a style guide turns off.

**Fonts**. A glyph sheet's single pixels, diagonals and empty cells are its letters, so
`orphans`, `jaggies`, `banding`, `outline`, `coverage`, `fit`, `readability`, `repetition` and
`consistency` skip it (`not checked on a font`); `palette` and `font` judge it.

**Families and overlays**. A family is ground, not a figure: `outline`, `banding` and
`readability` skip it, and so does `jaggies` (its textures are tiles, checked as tiles, and its
band's staircases are curves by design); `orphans` uses the tile allowance; `anim` wants at least
1 % of the sheet to change (most of it is still terrain). An overlay is an effect drawn over
ground: no `outline`, `readability`, `banding` or `orphans` (its lone pixels are its art), and
any frame-to-frame change is fine.

## The seam metric

Tile the art 3x3 into an image of class indices (palette entries;
transparent its own class, grey 0); each class has a grey value, its Rec. 601 luma (0-255). For
the x axis, with tile width `t` and image width `W`:

- `mis[k]`: the share of rows where column k differs from column k+1, k = 0..W-2.
- Border pairs are k = t-1, 2t-1, ...: `jump = (mean(mis[border]) - mean(mis[other])) /
  (std(mis[other]) + 0.02)` (population std).
- `colm[x]`: the mean grey of column x. Touching columns are x = t-1, 2t-1, ... and t, 2t, ...,
  except x = 0 and W-1: `line = |mean(colm[touching]) - mean(colm[other])| / (std(colm[other]) + 2)`.
- The y axis is the same on the transpose; `seam = max(jx, jy, lx, ly, 0)`. About 1 or less reads
  as no seam.

Hand-checked in `core/test/checks.test.ts`: a solid tile scores 0; an 8 px tile with a one-pixel
ink frame scores `line = 0.9d / (0.3d + 2)` (d = the ink columns' grey against the others'), 2.6447
in the test palette; a tile half moss, half leaf scores `jump = (1 - 1/7) / (sqrt(1/7 · 6/7) +
0.02)` = 2.3171; random noise stays under 1.

## The style guide

`project.json`:

```json
"style": {
  "palettes": ["mossy-ruins", "ruins-props"],
  "outline": ["ink"],
  "ground": "grass",
  "drawScale": 2,
  "camera": "384x216",
  "sizes": { "tile": "24x24", "sprite": "24x24" },
  "light": "nw",
  "shadow": { "c": "darker", "dir": "se" },
  "reserved": { "lichen": ["glowcap"] },
  "sets": { "props": { "checks": { "orphans": { "max": 1.5 } } } },
  "checks": { "orphans": { "max": 1.5, "tile": { "max": 3 } }, "jaggies": { "off": true } },
  "assets": { "stone_floor": { "checks": { "repetition": { "off": true } }, "ground": "...", "set": ["..."] } }
},
"themes": { "lantern": { "light": "#f2d27a", "dark": "#b0702c", "darkest": "#4a2410" } }
```

Each check's parameters merge in this order: the defaults for every kind, the defaults for the
asset's kind, `style.checks.<check>`, `style.checks.<check>.<kind>`, the asset's manifest set's
`style.sets.<set>.checks.<check>`, then `style.assets.<asset>.checks.<check>`. `light` is
the light direction `consistency` holds the art to and `shade`, `pebbles` and `tufts` use when it is
not given; `shadow` is the `shadow` helper's colour (an entry) and maps' objects layers'
shadows (an entry, or `darker`: a step down the ramps of the ground under it), `dir` where they fall
(default: away from `light`); see
[pipeline.md](pipeline.md#style-guide-defaults-and-thresholds). The parameter names are the ones in the table (`max`,
`min`), plus `off`, and for some checks more: `orphans.texture` (allow one-step strays),
`banding.minEdges`, `readability.delta`, `readability.maxIou`, `readability.minSpread`. The server
reads `project.json` again when it changes, and tells the watch view.

**Overrides for one asset.** Any check can be tuned or turned off for one asset under
`style.assets.<asset>.checks`, for example a hand-drawn figure whose frames differ little, and an
object that fills its cells on purpose:

```json
"assets": {
  "reaper_walk": { "checks": { "anim": { "minDiff": 0.02, "maxPivot": 2 } } },
  "market_hall": { "checks": { "margin": { "off": false, "max": 24 } } }
}
```

`anim` takes `minDiff`, `maxDiff`, `maxPivot`, `maxGround`, `maxArea` and `off`; `margin` takes `max`,
`bottom` (`false`: the bottom edge may touch) and `off` (`false` turns it on for an object, which is
off by default). An asset's own value wins over the project's and its set's.

`style.md` beside it is the style guide in words, for people and for prompts; the review bundle
includes it.

## The review bundle

`review(assets?, set?, name?)` (CLI: `pixelclaw review <project> [asset...] [--set s] [--name n]`; `set`
reviews a manifest set's drawn assets and adds `brief.md`, the theme and what each piece is meant
to be, see [pipeline.md](pipeline.md#the-review-hand-off)) writes
`reviews/<date>-<set>/`: each asset enlarged with rulers (for coordinates) and at game scale,
tiles repeated 3x3, sprites on their ground beside their set, the colours the art uses, the style
guide and `rubric.md` (readability, cohesion, seams and repetition, style-guide fit, defects with
coordinates in the form `<asset> <x>,<y> [<w>x<h>] "text"`). It names no method or author and
holds no tape, so the reviewer judges blind. The tool calls no model: hand the folder to a fresh
agent with no other context, and pin its findings on the pixels with `note` commands. The demo's
round is in [examples/drawing-and-checks.md](../examples/drawing-and-checks.md).

Families are not shown as sheets: each goes on a map (`maps/<set>.png` at game scale, a GIF at
1x when anything moves, and `maps/<set>.tiles.txt` naming the tile at each column and row), with
every variant among its neighbours (`sets/<set>.png`). The rubric's seventh question asks whether
the edge reads as one natural edge without the tile grid showing; map findings come back as
`<set> map <col>,<row> <x>,<y> "text"`, which the agent turns into notes on that variant's cell.
`--size CxR --seed N` (MCP `size`, `seed`) choose the island (default 16x12, seed 1).

**Maps**. A map document is checked on the map composed from the assets it names (the
assets' own checks judge their pixels; those are skipped on the map). Hot spots are cells, and
`view map marks="failing"` outlines them.

| Check | Score | Default threshold | What it flags |
|---|---|---|---|
| `seam` | the seam metric over the composed ground (terrain, tiles and overlays, before objects) | ≤ 1 | Nothing: the score says whether the tile grid shows anywhere on the map. |
| `repetition` | the longest straight run of one edge tile; the most cells one textured tile fills in a 4x4 window | run ≤ 4 (`edgeRun`); ≤ 10 of 16 (`motif`) | **Edge runs**: a family's edge tile (not its plain inside or outside), identical pixel for pixel, in a straight line of more than 4 cells: a long shore or lane repeating one tile's detail. **Motif hot spots**: windows where one textured tile (cells nearly one colour are left out; the open ground a terrain layer fills the map with, like the sea, counts too: one water tile filling it is the weave a reviewer saw) fills more than 10 of the 16 cells. Texture variants (`variant of=`) fix both. Per map: `style.checks.repetition.map`. |
| `lattice` | the share of one ground's cells that show a mark at the same spot of the cell, each cell counted by how much of its marking that mark is | ≤ 30% (`max`; `contrast` 18 ΔE) | **Map-scale lattices**: a mark (an 8-connected group of pixels at least `contrast` ΔE, CIE76, from its cell's median colour, so a blue puddle on brown of the same lightness is one) that comes back at the same spot cell after cell reads as a grid of dots across the ground, even when every tile passes its own checks and the map mixes several tiles (the marks sit on the tile pitch whichever cells have them). Plain ground cells only (not edges, not nearly one colour), grouped by the ground they show (an asset and its texture variants are one ground; at least 8 cells). A mark is at the spot of its centre; a cell shows it when one of its marks is centred within t/16 − 1 px (0 at 16 and 24, 2 at 48), and counts by that mark's share of the cell's marked pixels: 1 for a lone pebble, about a tenth for one pebble of a dense shingle. So forks that share their border ring (as they should, for clean seams) but differ inside are not failed for the border alone, while a lone mark in every fork still is. Sizes in pixels scale with the tile: a mark is at least t²/128 px (2 at 16 px, 5 at 24, 18 at 48); a group longer than three quarters of the cell is structure (mortar, plank lines), not a mark. Flags the cells that show the worst mark and names where in the cell it is (and, when it is one mark among several, its average share). A dense texture of one tile filled alone is repetition's 4x4 motif, not a lattice. Fix: texture variants that move or leave out the mark, filled as a mix (`tiles <layer> fill mix=`). |
| `footprint` | problems | ≤ 0 | An object whose asset is missing, off the map, overlapping another, placed with a footprint that has since changed (place it again), or standing on the outside ground of a terrain layer that fills the map (the sea) or on that layer's edge tiles (the surf), unless that layer is `walkable=on` (its filled ground is ground, a meadow or a stream bed, not sea). |
| `draworder` | problems | ≤ 0 | Art outside an object's footprint that is not a roof (actors behind would be drawn over it), and a roof that hides part of an object standing in front of it. Objects draw in order of their footprint's bottom row; roof cells draw last. |
| `coverage` | missing items | ≤ 0 | A missing asset or variant, and cells whose tile is not drawn (a variant the map needs that its family lacks). |
