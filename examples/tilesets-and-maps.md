# Tile sets, autotiling and maps

This walkthrough has 2 parts:

1. [tile sets and autotiling](#part-1)
2. [maps and scenes, oversized tiles](#part-2)

## Part 1: tile sets and autotiling<a id="part-1"></a>

The agent builds a shore: a `blob47` autotile family of 47 variants where sand meets water. It
draws one seamless sand tile, declares the band between sand and water (water, a line of foam,
wet sand, dry sand; round corners), and the tool draws every variant from that profile over the
two shared textures, which it copies from the sand tile and, frame by frame, from earlier
shimmering water, so the whole shore shimmers. The agent then details three of the five pieces by
hand, and every variant built from them follows at once. It looks at the shore on a random island,
with the seam score over the map (0.18; the demo asks for at most 0.5) and glints sparkling on the
water, and a blind reviewer judges the island.

You need Node 22.18 or later and pnpm. Build once, from the repo:

```sh
pnpm install
pnpm build
```

### With Claude Code

Register the server and open the watch link as in [watch-and-edit.md](watch-and-edit.md) (steps 1 and 2), then
ask, for example: *Make a seamless 24x24 sand tile for the mossy ruins, then a blob47 shore family
where the sand meets the water tile: water, a broken line of foam, wet sand, dry sand, round
corners. Detail three pieces by hand, show it on a random island with the seam score, add glints
on the water, and run a blind review on the island.*

### With the stand-in agent

```sh
node examples/families-agent.ts            # --pause <ms> between batches (default 1500), --linger <s> (default 600)
```

It starts `pixelclaw serve` on `out/families.pclaw` (the mossy ruins palette and style guide),
prints the watch link, rebuilds the water tile, and then works as below, printing each batch's
intent and check summary.

### 1. The sand

[sand.pclaw](scripts/sand.pclaw) adds a sand ramp (saved as `ruins-shore`) and lays clustered
noise on the tile as a torus, with two small pebbles in the sand's own colours (grey ones showed
as dots on a grid when tiled). The seeds were picked from a few by the checks:

```
checks: palette 0 ✓ · orphans 0.5% ✓ · jaggies 1 ✓ · seam 0.36 ✓ · coverage 0 ✓ · repetition 2.5 ✓
```

### 2. The shore, from a band profile

[shore.pclaw](scripts/shore.pclaw):

```
new family shore 24x24 scheme=blob47 palette=ruins-shore
family texture inside from=sand frame=1
frame add copy=1   (three times) ; frame set all ticks=15 ; cel link 1-4 layer=band
frame 1 ; family texture outside from=water frame=1    (and frames 2-4 from the water's frames 2-4)
family band 3:outside 1:foam 2:sand0 radius=3
```

The sheet holds the two textures on its first row, then the 47 variants. `family texture … from=`
copies a tile into a texture cell and writes its pixels into the line, so the tape replays alone.
`family band` gives the band from the water's edge in: 3 px where the water carries on into the
sand tile (so the edge never sits on the tile border), a pixel of foam, 2 of wet sand, then the
sand; the band's inner edge rounds with radius 3 at outer corners. It draws the band on the five
**pieces** (`o`, `nesw`, `ew`, `ns` and the interior); every other variant's band is built from
the pieces' quadrants after every command, and every variant's ground is the sand or the water
texture *at the same pixel* (the textures are re-projected, so the variants tile with each other
and with the plain tiles).

Then three pieces are detailed by hand on layer `band` (`px @cell(ew) …`): the long north and south
edges (`ew`), west and east (`ns`) and the outer corners (`o`), kept off each quadrant's edges so
the quadrants still join. Each line reaches every variant with that quadrant at once:

```
checks: palette 0 ✓ · orphans 0.9% ✓ · seam 0.2 ✓ · coverage 0 ✓ · anim 2.6% ✓
```

`coverage` counts all 47 variants and both textures drawn on all four frames; `seam` is the
seam metric over a 12x10 island (below). `view family` shows every variant in the middle of the
neighbours that call for it, and says where each cell is:

![The 47 shore variants, each among its neighbours; the pieces labelled in cyan](../docs/screenshots/families-shore-family.png)

### 3. Glints

[glint.pclaw](scripts/glint.pclaw) is an **overlay**: a 5x5 sparkle in three frames that flashes
now and then on the water tiles of a map (`overlay set mode=sparkle on=outside every=3
spread=8x8 rest=150`), each at its own seeded moment and place.

### 4. The island

`view(mode="map", size="16x12", seed=6, with=["glint"])`:

```
16x12 tiles of 24 px, a random island (seed 6); seam 0.18 (jump x -0.91 y -1.43, line x 0.1 y 0.18; about 1 or less reads as no seam)
27 of 47 variants on the map: o×1 e×2 ne×1 ne_ne×4 … nesw_ne_se_sw_nw×25
overlays: glint (sparkle on outside, every 3)
animated GIF at game speed: …/views/shore.map.gif
```

![The shore on a random island at the game's draw scale](../docs/screenshots/families-shore-map.png)

The [GIF](../docs/screenshots/families-shore-map.gif) plays the water's four frames and the glints at
the game's speed.

### 5. The blind review

`review(assets=["shore","sand","water","glint"], name="g7", size="16x12", seed=6)` writes a bundle
in which each family is a map at game scale (and a GIF), with the tile at each column and row and
every variant among its neighbours, and a seventh rubric question: does the edge read as one
natural edge, without the tile grid showing? A fresh agent judged it blind: the island reads as land, the
corners are round and the set is cohesive (4/5), but the wet sand read as a dark outline, the foam
was an unbroken line, the long edges repeated pixel for pixel, the sand's marks bunched at its
edges, a corner kept a stray, and the glint vanished at its largest. The findings came back as
notes on the pieces and tiles they came from and were fixed by coordinates
([shore_review.pclaw](scripts/shore_review.pclaw), [sand_review.pclaw](scripts/sand_review.pclaw),
[glint_review.pclaw](scripts/glint_review.pclaw)): the band redrawn with a one-pixel waterline and
a wider drying strip, the foam in dashes, the waterline dipping and rising differently on each
side, the sand's marks spread, the glint fading out. Copying the reviewed sand in again changed
all 47 variants at once. The island now scores 0.18, every check green. The water's findings (earlier
tile: one crest stamp, a conveyor motion) are left as open notes, and the shore's edges still
repeat their piece every tile (one `ew` and one `ns`): texture variants and map hot spots are earlier.

### 6. In the watch view

Pick `shore`. The toolbar switches the middle between the **sheet** (draw on the pieces; the
toolbar names the cell under the pointer), the **variants** (each among its neighbours, pieces and
detached variants marked, detach and attach on each) and a **map** (size, seed and overlays to
choose, only for looking; the seam score above it). The timeline's rows fold away.

![The shore's sheet](../docs/screenshots/families-sheet.png)
![Every variant among its neighbours](../docs/screenshots/families-variants.png)
![The map in the watch view, glints playing](../docs/screenshots/families-map.png)
![The timeline folded](../docs/screenshots/families-folded.png)

Detach, attach, *coverage map* and *cut from map* are commands on the tape with your name; a stroke
on a piece reaches every variant built from it as soon as it lands.

### The other routes

- **Quadrant pieces**: draw the pieces (`paint @cell(o) 0,0 << … >>` on layer `band`) without a
  band profile, or after one with `draw=off`.
- **Cut from a painted map**: `new family … map=14x12`, `family coverage` (a map laid out so every
  variant appears, with a flat template on a reference layer), paint the map area, then
  `family cut` (each variant becomes the medoid of its tiles on the map, its band only).

### In the CLI

```sh
node cli/bin/pixelclaw.js view examples/mossy-ruins.pclaw shore map --size 16x12 --seed 6 --with glint
node cli/bin/pixelclaw.js view examples/mossy-ruins.pclaw shore family
node cli/bin/pixelclaw.js review examples/mossy-ruins.pclaw shore sand --size 16x12 --seed 6
```

## Part 2: maps and scenes, oversized tiles<a id="part-2"></a>

The agent builds a coastal village from its own tiles and judges the set as a whole. It draws
three objects bigger than a cell (a 48x48 house, a 24x48 tree, a well), each with a footprint that
says which cells block and which are roofs; two more families (a meadow of grass on sand, a lane of
sand through grass); then paints a 40x30 map with them on top of the shore, places the houses and
the well, and scatters trees. It looks at the village whole and at game scale through the camera,
runs the map checks, finds where the map repeats (long straight edges showing the same tile, the
meadow's middle one tile over and over) and fixes it with texture variants. A person moves the
well in the watch view and the agent reads the move through `changes`. Then a blind reviewer
judges the village at game scale.

You need Node 22.18 or later and pnpm. Build once, from the repo:

```sh
pnpm install
pnpm build
```

### With Claude Code

Register the server and open the watch link as in [watch-and-edit.md](watch-and-edit.md) (steps 1 and 2), then
ask, for example: *Using the shore, grass and sand of the mossy ruins, make a 48x48 house, a 24x48
tree and a well with footprints, a meadow and a lane family, and paint a 40x30 coastal village with
them. Look at it at game scale, run the map checks, fix what repeats, then tell me when to move
the well and read what I did. Finish with a blind review of the village.*

### With the stand-in agent

```sh
node examples/maps-agent.ts                 # a headless browser plays the person
node examples/maps-agent.ts --person no     # you move the well yourself in the watch view
```

It starts `pixelclaw serve` over stdio as Claude Code would, prints the watch link, rebuilds the
stage from its scripts (the grass and its two variants, the water, the sand, shore and glints),
then works through the steps below with a check summary after each batch, in
`out/maps.pclaw`. `--pause <ms>` sets the time between batches (default 1200).

### 1. Objects bigger than a cell

[house.pclaw](scripts/house.pclaw): `new object house 48x48 cell=24x24`, a pitched roof of red
tiles (a new `ruins-village` palette: roof and plaster ramps over the props colours) over a
plastered front with a timber frame, a door and two windows, lit from the top left, an ink outline.
Its footprint is all four cells, the wall row blocking and the roof row a roof:

```
footprint 2x2 at=0,0 anchor=0,1 <<
  rr
  bb
>>
```

[tree.pclaw](scripts/tree.pclaw) is 24x48 and stands on one cell (`footprint 1x1 << r / b >>`): its
crown overhangs the cell above as a canopy, drawn above actors walking behind it.
[well.pclaw](scripts/well.pclaw) is one cell that blocks. The `fit` check (every footprint cell
drawn, overhangs marked as roofs) passes on all three. `view map` of an object stands it on its
ground among plain tiles at game scale:

![The house on the grass at game scale](../docs/screenshots/maps-house-scene.png)
![The tree on the grass](../docs/screenshots/maps-tree-scene.png)

### 2. Two more families

[meadow.pclaw](scripts/meadow.pclaw): blob47, grass inside, sand outside, the band 2 px of sand and
a dark rim of moss, with tufts drawn over the rim on three pieces. [lane.pclaw](scripts/lane.pclaw):
the `path` scheme, sand inside, grass outside, a moss rim and a line of wet sand, wheel ruts on the
straight pieces. A meadow stacks on the shore because its outside texture is the shore's inside
(the sand); a lane on the meadow because its outside is the meadow's inside (the grass).

### 3. The village

[village.pclaw](scripts/village.pclaw):

```
new map village 40x30 tile=24 palette=ruins-shore
layer add land terrain=shore outside=on above=floor
layer add meadow terrain=meadow above=land
layer add lanes terrain=lane above=meadow
layer add glints overlay=glint on=land:out above=lanes
layer add props objects above=glints
map gen village seed=8
place house 15,16 layer=props
…
place well 20,15 layer=props
scatter tree count=22 on=meadow off=lanes minDist=2 layer=props seed=31
```

A map holds names, not pixels: each terrain layer says which cells are its family's terrain, and
the family's scheme picks every edge tile when the map is drawn (as the sample maps do). `map gen
village` lays out an island (smoothed: no one-cell spits), a meadow two cells in from the beach and
two lanes crossing it. Each `place` writes the footprint it read into its line (`place house 15,16
layer=props cells=2x2 anchor=0,1`), so the tape replays without reading another asset, and a
footprint may not overlap another. `view map` gives the whole map at 1x, its layers, what is placed
where, and every cell as a letter; `camera="19,15"` gives the engine's screen (384x216) around a
cell at the game's draw scale:

![The village at 1x](../docs/screenshots/maps-village.png)
![The camera at game scale](../docs/screenshots/maps-village-camera.png)

### 4. Where it repeats

```
✗  repetition  run 12 · 16/16  run ≤ 4, ≤ 10/16  longest straight run of one edge tile: 12 (lane.ew ×8 at 10,17 8x1;
   lane.ew ×12 at 19,17 12x1; meadow.new_ne_nw ×5 at 10,19 5x1; …); most of one textured tile in a 4x4 window:
   16 of 16 (hot spots: meadow.nesw_ne_se_sw_nw on 243 cells)
     12 lane.ew in a row at 19,17 12x1: 19,17 20,17 … 30,17
     10 lane.ns in a row at 18,7 1x10: …
     6 shore.nsw_sw_nw in a row at 34,14 1x6: …
```

The map checks find two kinds of hot spot: a family's edge tile repeating pixel for pixel along a
straight edge (both lanes, the meadow's and the beach's long sides), and one textured tile filling a
whole 4x4 window (the meadow's middle, where the grass's tufts sit on a 24 px lattice). `view map
marks="failing"` outlines them:

![The hot spots before the variants](../docs/screenshots/maps-hotspots.png)
![The same at game scale](../docs/screenshots/maps-hotspots-camera.png)

### 5. The fix: texture variants

Each repeating family gets variants: [lane_b](scripts/lane_b.pclaw) and [lane_c](scripts/lane_c.pclaw)
(forked from the lane, the band drawn again, the ruts and stones moved),
[meadow_b](scripts/meadow_b.pclaw) and [meadow_c](scripts/meadow_c.pclaw) (the grass variants from
first grass inside, the tufts moved), [shore_b](scripts/shore_b.pclaw) (the spray, breaks and wet-sand lobes
moved). Each declares `variant of=<family>`; the `variant` check holds its colour mix to the base's
(L1 < 0.3, ΔL* < 2). The village's tape does not change: the map picks among a family and its
variants cell by cell, and redraws itself:

```
✓  seam        0.04   ≤ 1
✓  repetition  run 4 · 10/16   longest straight run of one edge tile: 4; most of one textured tile in a 4x4 window: 10 of 16
```

### 6. A person moves the well

In the watch view the village opens in the map editor. The person picks *✣ move* and drags the
well from 20,15 down beside the crossroads; the tape gets one line, written by them:

```
#14 human:chris h1  move 20,15 20,18 layer=props
```

and the agent's `changes` says what moved, with the cells before and after at game scale:

```
diff #13 → #14: 2 cells look different; moved: well 20,15 → 20,18 (layer props)
```

![The move in the watch view](../docs/screenshots/maps-move.png)
![What changes returns](../docs/screenshots/maps-diff.png)

### 7. The blind review

`review(assets=["village","house","tree","well","meadow","lane","shore"], name="g8")` writes a bundle
with the village as a scene: whole at 1x, nine screens of it at game scale (which cells each
shows), every cell as a letter, and an eighth rubric question: does the scene read as one coherent
place, things sitting on their ground, in a sensible order front to back, without the grid showing?
A fresh agent judged it blind:
the village reads as one place on one island, every object sits in its cells with its base on the
grass, sizes and depth order agree (scenes 3/5); the house and tree read at a glance (readability
4/5); but the house had nine lone highlight pixels and a dead-vertical roof split, the tree a
pillow rim, a scratch-like dash and a painted shadow ringed in ink, the well pillow shading and a
flat bucket, all 22 trees were one sprite, one tree touched a house, two houses faced no lane, and
the ground still showed its grid: the open sea one water tile, the sand's darkest mark lining up,
the coast and the meadow edge in long straight runs with near-square corners (seams and repetition
2/5).

The findings came back as notes on the pixels and cells they name and were fixed by coordinates
([house_review](scripts/house_review.pclaw), [tree_review](scripts/tree_review.pclaw),
[well_review](scripts/well_review.pclaw), [meadow_review](scripts/meadow_review.pclaw),
[village_review](scripts/village_review.pclaw)), plus a second tree,
[tree_b](scripts/tree_b.pclaw), a texture variant of the first (a taller crown in two masses),
which the map picks cell by cell like any variant. On the village a tree moved off the house and
`road` laid paths to the two doors. Every check is green. Five notes stay open on the village for
later steps: the sea (the water tile needs variants), the sand's mark (the sand), the coast's and
the meadow's straight runs and square corners (the schemes' geometry), and the lanes ending short of
the beach.

![The village at game scale after the review](../docs/screenshots/maps-village-camera.png)

### 8. In the watch view

Pick `village`. The middle of the page is the map editor: *✎ paint*, *▭ rect* (Shift erases) and
*⌫ erase* paint the chosen terrain layer; *⊕ place* puts the chosen object by its anchor cell (its
footprint outlined under the pointer; an overlap is refused with the reason); *✣ move* drags,
*✕ remove* takes away. Each is a line on the tape with your name. *▣ camera* stands the camera on a
cell (*camera view* shows its screen at game scale), *hot spots* outlines what the map checks
flag; neither logs anything.

![The map editor, placing a tree](../docs/screenshots/maps-editor.png)
![The camera view](../docs/screenshots/maps-camera.png)
![Hot spots in the watch view (variants switched off)](../docs/screenshots/maps-hotspots-ui.png)

### In the CLI

```sh
node cli/bin/pixelclaw.js view examples/mossy-ruins.pclaw village map --camera 19,15
node cli/bin/pixelclaw.js check examples/mossy-ruins.pclaw village
node cli/bin/pixelclaw.js export examples/mossy-ruins.pclaw village --format tmx
node cli/bin/pixelclaw.js export examples/mossy-ruins.pclaw house --format split
```

`tmx` writes a Tiled map (a tile layer per ground layer over one tileset of every distinct tile,
objects as tile objects with their footprint, anchor and flags as properties); `split` writes the
house as four one-cell pieces and the stamp that puts them back.
