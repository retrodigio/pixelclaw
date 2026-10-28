# Demo G9: export, import and densities

The agent takes the art of G6, G7 and G8 out to a game and back. It exports the walker, the water,
the stone floor, the sand, the shore and its glints, the house, the tree, the well, the meadow and
the lane through a sample profile for an invented engine, "Bramble", into a scratch game folder:
an atlas page per density with CSV records, names from the profile's templates, the walker's west
view left for the engine to mirror, role colours encoded, and the engine's text entries. It reads
the folder back and every asset comes back with the same palette indices. It writes the village
for Tiled (a wang set per family), and re-imports a sheet another tool wrote, then edits it. Before
that it shows G9's art follow-up: the village with its five open notes closed, and the house at
twice the density with the density check.

You need Node 22.18 or later and pnpm. Build once, from the repo:

```sh
pnpm install
pnpm build
```

## With Claude Code

Register the server on a copy of `examples/mossy-ruins.pclaw` and open the watch link as in
[demo-g2.md](demo-g2.md), then ask, for example: *Export the walker, the water, the stone floor,
the shore and the village's assets through the bramble profile into ~/scratch/game/art, read them
back and tell me whether anything changed. Then export the walker as an Aseprite sheet, import
that PNG as a new asset sliced by 24x24, give it back its views and timing, and make it a second
villager.*

## With the stand-in agent

```sh
node examples/demo-g9-agent.ts            # --pause <ms> between steps, --linger <s> to keep the server up
```

It copies the example project to `out/demo-g9.pclaw` (ignored by git), starts `pixelclaw serve`
over stdio as Claude Code would, prints the watch link, and writes the game folder to
`out/game-g9/`. Below is what it printed.

## 1. The village, its notes closed

G8's blind review left five notes on the village: the open sea one water tile whose troughs and
crests wove a lattice; identical sand cells lining the sand's marks up into stripes; the east
coast and the meadow's west edge running straight with near-square inner corners; and lanes
stopping short of the beach. G9 closed them:

- The repetition check's motif windows now count the open sea (plan §17). With one water tile it
  fails, so the water got three variants (`water_b`, `water_c`, `water_d`: its troughs and its
  crests moved by different amounts on every frame), the sand two (`sand_b`, `sand_c`), and the
  shore two more looks (`shore_c`, `shore_d`); with `shore_b` they mix four waters and three sands
  cell by cell.
- Rounder inner corners are a scheme option: `blob47-round`, a project scheme
  (`schemes/blob47-round.json`, copied into each family's tape). A diagonal counts when either
  side next to it is the terrain, so an edge knows the terrain turns a corner at its end and bends
  into it, and the water cell outside the corner rounds it off. The shore and the meadow are on it
  (`family band … fillet=12`, `fillet=10`).
- The lanes' outside is left empty, so a lane runs over whatever ground is under it; the roads go
  on one cell into the sand at each end. The east coast and the meadow's west edge were broken up.

```
  village: map 40x30 cell 1x1, palette ruins-shore, 38 commands in 4 groups; layers floor, land, meadow, lanes, glints, props
  village: a map of 40x30 cells of 24 px (960x720 px); seam over the ground 0.57 (about 1 or less reads as no seam)
  layer land: terrain of shore (+ variants shore_b, shore_c, shore_d), 592 cells; its outside ground fills the rest
    ✓  seam        0.57   ≤ 1     the tile grid over the whole ground: jump x 0.57 y -0.07, line x 0.01 y 0.04
    ✓  repetition  run 2 · 10/16 run ≤ 4, ≤ 10/16 longest straight run of one edge tile: 2; most of one textured tile in a 4x4 window: 10 of 16
```

No notes are left open on the village. Pictures: [the village](../docs/screenshots/g9-village.png),
[a screen on the south beach at game scale](../docs/screenshots/g9-village-camera.png),
[rounder corners up close](../docs/screenshots/g9-round-corners.png),
[in the map editor](../docs/screenshots/g9-village-editor.png).

## 2. The house at twice the density

`house_2x` is `fork house`, `scale 2` (a nearest-neighbour scale-up), `density of=house d=2`, then
courses of roof tiles, flecks in the plaster and the door's planks split again. The density check
reduces it back with the style guide's reducer (ink-vote: ink wins at a quarter of a block) and
compares it with the 1x house:

```
    ✓  density     9%     ≤ 25%   reduced by 2 with ink-vote: 169 of house's pixels differ (9%)
    ✓  coverage    0      ≤ 0     1 frame, every cell drawn, size 48x48|48x96|96x96 (autotile names come with schemes)
    ✓  fit         0      ≤ 0     2x2 cells, footprint 2x2 at 0,0 drawn
```

The differences are the 2x detail itself: a one-pixel course line covers half of each block it
crosses, and the reducer keeps it. The [density view](../docs/screenshots/g9-house-density.png)
shows 1x, 2x and the reduction with those pixels marked; the watch view has the same in the
preview's [density tab](../docs/screenshots/g9-density-tab.png).

## 3. Export through the sample profile

`examples/mossy-ruins.pclaw/profiles/bramble.json` uses every profile feature (see
[docs/profiles.md](../docs/profiles.md)): an atlas page per density (1x, 2x, 4x; `@2x` and `@4x`
in the names) with CSV records `sprite,x,y,w,h,cropX,cropY,frameW,frameH,pivotX,pivotY`, numbered
sets from 1, views as `<asset>_<view><n>` with the mirror view flagged for the engine, texture
variants numbered after their base's frames, autotile names per scheme (`shore_full`,
`shore_nsew`, `shore_ne_ne`, `lane_dot`…), roles written as the engine's colours, oversized
objects as one sprite with their footprint, and a text entry per asset.

```
  bramble: 3469 images, wrote 7 files into …/out/game-g9/art
  notes:
    6937 images at a higher density were scaled (no authored copy at that level)
    art/bramble-entries.txt
    art/bramble.csv
    art/bramble.png
    art/bramble@2x.csv
    art/bramble@2x.png
    art/bramble@4x.csv
    art/bramble@4x.png
  the 1x page's records (the first lines):
    sprite,x,y,w,h,cropX,cropY,frameW,frameH,pivotX,pivotY
    glint_1,374,5746,1,1,2,2,5,5,,
    glint_2,370,5746,3,3,1,1,5,5,,
    glint_3,364,5746,5,5,0,0,5,5,,
    house,1,1,48,48,0,0,48,48,,
  the entries for the engine (bramble-entries.txt):
    overlay "glint" { frames = { "glint_1", "glint_2", "glint_3" }, ticks = { 6, 6, 6 } }
    object "house" { image = "house", size = { 48, 48 }, footprint = { 2, 2 }, anchor = { 0, 1 }, variants = 1 }
    terrain "shore" { scheme = "blob47-round", first = "shore_fill_1", tiles = 2848, frameTicks = 15 }
    sprite "walker" { frames = { "walker_s1", "walker_s2", "walker_n1", "walker_n2", "walker_e1", "walker_e2" }, ticks = { 12, 12, 12, 12, 12, 12 }, directions = 4, mirror = "W=E", pivot = { 11, 22 } }
    tile "water" { frames = { "water_1", … "water_16" }, frameTicks = 15 }
```

The house's 2x page holds the authored `house_2x`; every other image at 2x and 4x is scaled up
from 1x, and the note says so. The shore with its three variants is 2,848 images: four looks, 176
cells, four frames (an engine profile might `exclude` the fillets or split families onto pages of
their own). A smaller export of the walker, the house and the glints is committed in
`examples/mossy-ruins.pclaw/exports/bramble/`.

## 4. Read back

```
  read back exactly: glint, house, house_2x, lane, lane_b, lane_c, meadow, meadow_b, meadow_c, sand, sand_b, sand_c, shore, shore_b, shore_c, shore_d, stone_floor, tree, tree_b, walker, water, water_b, water_c, water_d, well
```

Every image was cut from its page by its record, quantised to its asset's palette (role colours
decoded through the profile), and put back in its frame; the walker's west frames, left out of the
export, were rebuilt by flipping the east ones. The tests do the same for every built-in profile.

## 5. The village for Tiled

The `tiled` profile writes a `.tsx` per family (its sheet, the frames as tile animations, a wang
set), a collection tileset for the other images and a `.tmx` whose ground layers point at the
families' tiles, so a person can repaint the village with Tiled's terrain brush:

```
   <tileset firstgid="1" source="lane.tsx"/>
   …
   <tileset firstgid="625" source="shore.tsx"/>
   <tileset firstgid="3569" source="tiles.tsx"/>
```

Committed in `examples/mossy-ruins.pclaw/exports/tiled/`.

## 6. A sheet comes back, and is edited

The walker goes out as Aseprite's sheet export (a PNG of its eight frames in a row and Aseprite's
JSON) and the PNG comes back as a new asset, sliced by a 24x24 grid and quantised to the
`ruins-folk` palette. Its tape starts from the import: the palette in the `new` line, then one
`import` command per frame carrying the pixels (the PNG is kept as a blob):

```
  created walker_sheet: every pixel a palette colour
  #32 claude g1  import 0,0 from="walker.png" blob=4756af93… << …
```

A PNG has no directions, timing or pivot, so the agent gives them back (`view S frames=1-2` … ,
`frame set all ticks=12`, `pivot 11,22`, `ground 22`), then swaps the tunic's three shades for
stone shades on every frame, a second villager in a grey cloak:

```
  walker_sheet: applied 72 commands as group g2; 228 px changed
  checks: palette 0 ✓ · orphans 0.6% ✓ · jaggies 0 ✓ · banding 0 ✓ · outline 1 ✓ · coverage 0 ✓ · readability 1 ✗ · anim 14.3% ✓ · views 45.4% ✓
```

`readability` is right to complain: the new villager has the walker's silhouette exactly (IoU 1),
so at game scale the two read as one character in two coats. A hood or a hat is the fix; it is left
for the person. [The imported sheet in the watch view](../docs/screenshots/g9-imported.png).
