# Command reference (language version 2)

PixelClaw documents are edited with a small line-based command language. The same text works from
the CLI (`pixelclaw run`), the MCP server (`run`) and the watch view, whose tools write these
commands too. Every command is written to the asset's tape in its **normal form** (defaults filled
in, colours by name), so replaying the tape gives the same pixels even if a default changes later.

## Syntax

- One command per line, or several on a line separated by `;`.
- `#` starts a comment at the start of a line or after a space. `c=#aabbcc` is a colour, not a
  comment.
- Points are `x,y` from the top-left (negative values are allowed). Sizes are `WxH`.
- Options are `key=value`; flags are bare words (`fill`, `outline`).
- `@cell(cx,cy)` after the command name offsets every coordinate to that cell of the cell grid.
- On a `wrap=on` document, coordinates past an edge wrap around; otherwise they are clipped.
- Fractions (`level=`, `density=`) are written `0.25`, `3/16` or `25%`. Ranges are `2..4`.
- `{ ... }` holds a macro's body (see *Macros*); it may span lines and hold `;`.

### Colours

`c=` takes a palette entry **name** (`c=stone3`), its one-character **key** (`c=3`), the exact
**hex** of an entry (`c=#6c7570`), or `none` (transparent). A hex that is not in the palette is
refused: `c=#ff00ff is not in palette 'mossy-ruins'`. The tape always records the name.

### Batches and errors

A `run` is one batch, logged as one undo group. If any line has an error, nothing in the batch is
applied, and every error is reported with its line and column:

```
floor.pclaw:2:10: error: unknown colour 'gold' (palette 'mossy-ruins': ink, stone0, ...)
floor.pclaw:3:10: error: line: expected an end point x,y
2 errors; nothing was applied.
```

### Authors and groups

Every tape line records its author (`by`): `claude` for the agent, `human:<name>` for a person in
the watch view. Each author has their own **editing context** in the document: the layer and
frame they draw on, their selection, their live symmetry and their brush. `layer`, `frame`,
`select`, `mirror` and `brush` change only the author's own context, so the agent's selection
never clips a person's strokes, and a person choosing a layer never moves the agent. An author
who has not chosen draws on the *home* layer and frame (at first the bottom layer, `main`, and
frame 1; they move with their layer and frame when others are added, moved or removed). Groups are numbered per kind of author, each with its own counter: the agent's
(and scripts') groups are `g1`, `g2`, …, and people's are `h1`, `h2`, …. One action in the watch
view (a pencil drag, a fill, a move, a palette edit, a note) is one group.

### Autotile families

A **family** is a sheet of every variant an autotile scheme can produce (plan §4.2), with the two
textures they share. `new family shore 24x24 scheme=blob47 [map=14x12]` makes one: the size is
the tile's (square, even); the canvas is the sheet. Row 0 holds the `inside` texture (the
family's terrain) and the `outside` texture; then the variants, in the scheme's order, so many to
a row; then, with `map=`, a coverage map of that many tiles to paint. Cells are named:
`@cell(inside)`, `@cell(outside)`, `@cell(<variant>)` work in every drawing command, and `view
family` lists where each is.

**Schemes** are data (`core/schemes/*.json`): which neighbours count, each variant's name and the
reduced neighbourhood it answers to, and how it is built from four 12x12 (half-tile) quadrants.

| Scheme | Neighbours | Variants | Pieces (drawn by hand) |
|---|---|---|---|
| `blob47` | 8, a corner counts only when both sides beside it are the terrain | 47 | `o`, `nesw`, `ew`, `ns`, `nesw_ne_se_sw_nw` |
| `wang16-corner` | the tile's four corners; the edge runs through the middle of the tile | 16 | 7 (see the file) |
| `path` | 4; a strip through the middle (inset a quarter of the tile) | 16 | `o`, `nesw`, `ew`, `ns` |
| `bridge8` | along one axis, east-west first | 8 (`v`, the north-south single, is placed by name) | `h`, `h_ew`, `v`, `v_ns` |
| `single` | none | 1 | `o` |
| `face` | blob47, plus a south face in the cell below the terrain, joined east and west | 47 + 4 | blob47's and `face_o`, `face_ew` |

Variant names are the joined sides (`n e s w`, `o` for none), then each counted corner:
`ne_ne` is joined north and east with the corner between them, `nesw_ne_se_sw_nw` the interior.

**How the variants are made.** A family has two layers. `ground` holds the textures; on every
variant it is laid again after every command: each pixel shows the inside or the outside texture
*at the same pixel of the tile*, by the band geometry, so every variant tiles with the plain
textures and with each other (the textures are *re-projected*). `band` holds the band's art: the
**pieces** are drawn by hand (the agent and people draw on `band` by default), and every other
variant's band is assembled from the pieces' quadrants after every command, so detail drawn on a
piece shows at once on every variant that uses that quadrant. A variant can be **detached** to
draw it by hand.

| Command | Normal form | Notes |
|---|---|---|
| `family texture inside\|outside from=<tile> [frame=<n>]` | `family texture inside from=sand frame=1 <<` rows `>>` | Copies a tile asset (the family's tile size; colours matched by name, else by exact colour) into the texture cell on your frame. The line records the pixels, so replay needs no other asset; a block of rows can be given instead of `from=`. **The family follows the tile** (G15): when the tile changes, the server copies it in again, on each family frame whose latest texture line for that side came `from=` it (one undo group by the same author, the author's frame put back), like `variant of=<base> band=inherit`. A texture drawn from rows is the family's own and is left alone. |
| `family band <w>:<fill> ... [radius=] [inset=] [jitter=<n> [seed=]] [draw=on\|off]` | `family band 3:outside 1:foam 2:sand0 radius=3 inset=0 jitter=2 seed=6 draw=on` | **Route 1, a band profile**: the band from the terrain's edge inward, each part a width and a colour, `outside` (the outside texture carries on) or `inside`; then the inside texture. `radius` rounds the band's inner edge at outer corners (the outer contours are wider arcs about the same centre); `inset` moves the edge in from the tile's (path and bridge strips; default the scheme's). Inset, band and radius must fit in half a tile. With `draw=on` it draws the colours on every piece's band layer (clearing what was there; the face scheme's face pieces are left alone, they are drawn by hand); `draw=off` only sets the geometry. `jitter=<n>` (G13) moves every band edge in or out by up to n px, along each edge, by a seeded field that repeats every tile, so the edges are not ruler-straight and the tiles still join; the seed is written in (try several with the `seeds` tool). |
| `family band from=<family>` | `family band from=shore 3:outside 1:foam radius=3 inset=0 detached=none frames=1 cells=o,nesw,ew,ns,nesw_ne_se_sw_nw <<` rows `>>` | Copies another family's band (same scheme and tile): its geometry, its detached variants and its band layer. The line records it, so replay reads no other asset. Since G14 it records only the cells the family does not build from its pieces (`cells=`: the pieces, the detached variants and any other cell with band art, their rows side by side, frame after frame); the other variants are built again from the pieces after the line, as the source's were. On a 24 px blob47 sheet a sync went from 33 KB of tape to 4 KB. The G13 form without `cells=` (the whole sheet's rows) still replays. A texture variant with `variant of=<base> band=inherit` gets this line after every change to the base (see *Oversized assets, maps and scenes*). |
| `family detach\|attach <variant>\|all` | `family detach ne_ne` | A detached variant's band layer is its own (drawn by hand or cut); attach builds it from the pieces again. Pieces are always drawn by hand. |
| `family coverage [seed=] [copies=] [fill=on\|off]` | `family coverage seed=7 copies=1 fill=off` | Lays out the coverage map so every variant the scheme can produce appears `copies` times (a seeded search; refused, with what to try, when the map is too small: blob47 needs about 14x12), and draws its flat template (inside, outside and the band's colours) on a reference layer `template`. `fill=on` also paints the map with the current variants, to start from. |
| `family cut [textures=on\|off]` | `family cut textures=off` | **Route 3, cut from a painted map**: every variant takes the medoid of the map tiles that resolve to it (the tile with the fewest differing band pixels to the others), keeping only its band (`family band … draw=off` says how wide; the textures stay the shared ones), and is detached. `textures=on` also takes the textures from the map's all-inside and all-outside tiles. |

**Route 2, quadrant pieces**: draw the pieces themselves (`paint @cell(o) 0,0 << … >>` on layer
`band`); every variant follows. Animated families use frames as any document does: copy each
frame of an animated texture into the same frame of the family, and link the band layer's cels
(`cel link 1-4 layer=band`) so hand detail shows on every frame.

**Overlays** (plan §4.3) are small sprites played over a map's tiles: `new overlay glint 5x5`, its
frames and ticks as usual, then

| Command | Normal form | Notes |
|---|---|---|
| `overlay set [mode=] [on=] [anchor=] [spread=] [every=] [rest=] [seed=]` | `overlay set mode=sparkle on=outside anchor=centre spread=8x8 every=3 rest=150 seed=11` | `mode`: `cycle` and `pingpong` (every instance in step), `wave` (the phase moves across the map), `sparkle` (each instance plays once, then rests `rest` ticks, at its own moment). `on`: the family's outside tiles, its terrain, or all. `anchor`: the overlay's top-left in the tile (default centred); `spread`: a seeded offset per tile up to that many pixels either way; `every`: one tile in that many. |

`view map` shows a family on a random island (or a tile repeated), with overlays given in
`with=`; see *Views*.

### Oversized assets, maps and scenes

**Oversized tiles and objects** (plan §4.10) are any asset bigger than a cell of the grid:
`new object house 48x48 cell=24x24` is two cells by two. Its **footprint** says where it stands on
a map:

| Command | Normal form | Notes |
|---|---|---|
| `footprint <C>x<R> [at=<cx,cy>] [anchor=<x,y>] [<< flags >>]` | `footprint 2x2 at=0,0 anchor=0,1 <<` rows `>>` | The footprint is `C` x `R` cells of the art grid (the canvas in cells), starting at art cell `at` (default: the bottom-left of the art). `anchor` is the footprint cell it is placed by (default its bottom-left). The block has a row per art row, a character per art cell: `.` nothing, `b` blocks movement, `r` a roof or canopy (drawn above actors), `x` both. Footprint cells that do not block are walkable. Without a block, the footprint blocks and nothing is a roof. `footprint off` removes it (an asset without one stands on its whole art grid, by its bottom-left cell). |
| `variant of=<asset> [band=inherit\|own]`, `variant off` | `variant of=lane band=inherit` | This asset is a **texture variant** of another (plan §4.1): maps pick among an asset and its variants cell by cell (a hash of the cell, moved on when it would repeat both the cell to the left and the one above). Make one with `fork`, then change the inside (keep the border, or redraw a family's band and move its detail). The `variant` check compares their colour mix. **`band=inherit`** (G13, families): the band stays the base's: the variant's band layer is locked, its own band edits (`family band`, `cut`, `detach`, `attach`) are refused, and after every batch that changes the base the server writes `family band from=<base>` on the variant's tape (one undo group, by the same author), so later fixes reach it; only its textures are its own. `band=own` makes the band its own again. |

A 24x48 tree with `footprint 1x1 << r / b >>` stands on one cell; its crown overhangs the cell
above as a canopy. The `fit` check flags an empty footprint cell and art outside the footprint
that is not a roof.

**Map documents** (plan §4.11) are grids of cells that hold names, not pixels: `new map village
40x30 tile=24` is 40 x 30 cells of 24 px. Its canvas is the grid of cells (one "pixel" per cell,
so notes and coordinates are cells), and its layers say what they hold:

| Command | Normal form | Notes |
|---|---|---|
| `new map <name> <C>x<R> [tile=<T>] [palette=]` | `new map village 40x30 tile=24 palette=ruins-shore <<` rows `>>` | Starts with one tiles layer, `floor`. `tile=` defaults to the project's grid (project.json `grid`, 24 unless set; G14). |
| `layer add <name> terrain=<family> [outside=on\|off] [walkable=on\|off] [border=same\|terrain\|not] [mix=<tile>:<weight>,... [variants=spread\|named] [seed=]]` | `layer add sea terrain=shore outside=on above=floor` | A terrain layer: cells are the family's terrain or not; when the map is drawn the family's scheme picks every edge tile, exactly as `resolveMap` does for sample maps. With `outside=on` the cells outside the terrain show the family's outside texture (the layer fills the map); otherwise they show what is below (a face scheme's faces are drawn either way). **`walkable=on`** (G13): the filled ground and its edges are ground, not sea: objects may stand on them (the `footprint` check). **`border=`** (G15): past the map's edge a cell counts as the edge cell's own value (`same`, the default: terrain that runs off the map has no edge band along the border), as terrain, or as not terrain (`not`, the rule before G15: a band runs round the terrain at the border). **`mix=`** (G15): the terrain's fully inside cells are drawn as a seeded scatter of one-cell tiles by weight instead of the family's inside (each tile's weight shared with its texture variants unless `variants=named`, as `tiles fill mix=`); each cell's tile comes from a hash of its place, drawn again when it would equal both the cell to its left and the one above, so painting terrain elsewhere does not reshuffle it. Edges still come from the family, so mix tiles that match the family's inside texture join cleanly. `layer set <name> walkable=on\|off`, `border=…`, `mix=…\|none` change them. |
| `tiles <tiles layer> fill <tile>\|<family>.<variant> [<x,y> <W>x<H>] [replace]` | `tiles floor fill grass 0,0 40x30 cells=1x1 anchor=0,0` | (G13) A one-cell tile on every empty cell of the layer (or the box): the floor in one line. `replace` also covers one-cell tiles already there; multi-cell tiles stay. The cells are worked out when the line is written, so replay reads no other asset; the map picks among the tile's texture variants cell by cell. |
| `tiles <tiles layer> fill mix=<tile>:<weight>,... [<x,y> <W>x<H>] [replace] [variants=spread\|named] [seed=]` | `tiles floor fill mix=bed:1,bed_b:2,bed_c:1 0,0 12x8 cells=1x1 anchor=0,0 variants=named seed=812` | (G14) A seeded scatter of several one-cell tiles by weight (a weight left out is 1): each cell draws a tile, leaving out the tile to its left and the one above where another is left to draw, weighted by what each tile still has to lay of its share, so the counts follow the weights as closely as that rule allows (a tile over half the mix cannot avoid equal neighbours). **Two tiles** (G15): that rule left no choice, a strict checkerboard; a cell now leaves out only the tile that would complete a 2x2 block of one, so two looks scatter (a two-tile line written before G15 replays the new way). Each tile's weight is shared evenly with its texture variants the mix does not name (`variants=spread`, the default): `mix=bed:3,gravel:1` with bed's variants bed_b and bed_c is written `mix=bed:1,bed_b:1,bed_c:1,gravel:1`. The line is written with the shared-out weights, `variants=named` and the seed, so it replays without reading any asset. Each cell shows exactly the tile drawn for it (the map does not pick among its variants again). Fixes a failing `lattice`. |
| `layer add <name> tiles`, `layer add <name> objects` | `layer add props objects above=lanes` | Things placed by name. Objects on every objects layer are drawn in order of their footprint's bottom row (then layer, then column), above all the ground; roof cells are drawn again last. A footprint may not overlap another on any objects layer (on a tiles layer, on that layer). |
| `layer add <name> overlay=<overlay> on=<where>` | `layer add glints overlay=glint on=sea:out` | An overlay played over the cells `on=` names: a terrain layer (its terrain), `<layer>:out` (outside it), or `all`. |
| `terrain <layer> rect <x,y> <W>x<H> [erase]` | `terrain sea rect 0,20 40x10` | Also `ellipse <x,y> <W>x<H>`, `brush <x,y>... [size=<n>]` (a line through the points), `fill <x,y>` (4-connected), `paint <x,y> <<` rows of `#` (terrain), `-` (not) and `.` (leave) `>>`, and `clear`. |
| `place <asset>\|<family>.<variant> <x,y> [layer=] [cells=<C>x<R> anchor=<x,y>]` | `place house 12,8 layer=props cells=2x2 anchor=0,1` | By its anchor cell, on your layer or `layer=`. The line records the footprint the asset had, so replay reads no other asset. A family's variant by name (`shore.ns`, bridge8's `bridge.v`) goes on a tiles layer. |
| `move <x,y> <x,y> [layer=]` | `move 20,15 20,18 layer=props` | Moves what is placed on the first cell (any cell of its footprint) so its anchor is on the second. |
| `remove <x,y> [layer=]` | `remove 20,18 layer=props` | Takes away what is placed on that cell. |
| `road <terrain layer> <x,y> <x,y> ... [width=<n>]` | `road lanes 4,4 20,4 20,12 width=1` | Lays the terrain along x, then y, between each pair of points (4-connected, so path schemes join it up). |
| `scatter <asset>[,<asset>] [<x,y> <W>x<H>] count=<n> [on=<terrain layer>] [off=<terrain layer>] [minDist=<n>] [layer=] [seed=]` | `scatter tree count=22 on=meadow off=lanes minDist=2 layer=props fp=1x1:0,0 seed=31` | Places at seeded spots, each footprint on `on=`'s terrain, off `off=`'s, free, and `minDist` cells (Chebyshev) from the others; fewer when no more fit. `fp=` records each asset's footprint (cells and anchor). On other documents `scatter` is the stamp generator. |
| `map gen island\|village\|dungeon [layers=<a>,<b>,...] [objects=<asset>[:<n>],...] [layer=<objects layer>] [seed=]` | `map gen village layers=sea,meadow,lanes objects=well,house:2 seed=8` | Lays out the terrain layers for a quick test scene (then edit it): island, the land (seeded value noise, smoothed: no one-cell spits); village, the land, a ground two cells in from the shore and lanes crossing it; dungeon, rooms joined by corridors on the first layer. Default layers: the map's terrain layers in order. `objects=` stands objects (n of each, default 1) on the objects layer (default: the map's first): larger footprints first, every footprint cell on the inner ground (village: off the lanes; island: a cell in from the shore; dungeon: a cell in from the walls), with a free cell between any two. Without `objects=`, a map the manifest plans stands the drawn objects and sprites its `uses` lists, once each; the line records them, with their footprints (`fp=`), so replay needs neither the manifest nor the assets. |

Drawing commands (`px`, `rect`, …) are refused on a map. `view map` shows a map whole at 1x, a
region of cells (`region=`) or the camera (`camera=x,y`: the engine's screen, project.json
`style.camera`, default 16x9 cells of the project's grid: `384x216` at 24 px, `768x432` at 48, around that cell) at the game's draw scale, with the cells as
text; `export` writes a map for Tiled (the `tiled` profile) and splits an oversized asset (see docs/mcp.md and docs/profiles.md).

## Commands

| Command | Normal form | Notes |
|---|---|---|
| `new <kind> <name> <W>x<H> [palette=] [wrap=] [cell=] [bg=] [<< rows >>]` | `new tile floor 24x24 palette=mossy-ruins wrap=on cell=24x24 bg=none <<` palette rows `>>` | First command of a tape only. Kinds: `tile`, `sprite`, `sheet`, `icon`, `object`, `family`, `overlay` (see *Autotile families*), `map` (see *Oversized assets, maps and scenes*). `wrap` defaults to `on` for tiles, `off` otherwise. `cell` defaults to the canvas size. `palette` defaults to the project's default palette, and the line records the whole palette in a block (see *The palette in the tape*). The size (and palette, a family's scheme, an object's cell grid) may be left out for an asset the manifest plans (`new sprite urn`), or a kind the style guide sizes (`style.sizes`); the line records what was filled in ([pipeline.md](pipeline.md)). |
| `px <x,y> [<x,y> ...] c=` | `px 3,4 4,4 c=ink` | Single pixels. |
| `line <x,y> <x,y> [<x,y> ...] c= [pp=on\|off]` | `line 3,10 9,7 c=stone2 pp=on` | A line or polyline. See *Lines* below. |
| `curve <x,y> <x,y> <x,y> [<x,y>] c= [pp=on\|off]` | `curve 2,20 8,12 16,14 c=soil2 pp=on` | A quadratic (3 points) or cubic (4 points) Bezier. See *Curves and polygons*. |
| `rect <x,y> <W>x<H> c= [outline\|fill]` | `rect 2,2 20x6 c=stone3 outline` | Outline by default. |
| `ellipse <cx,cy> r=<RX>x<RY> c= [outline\|fill]` | `ellipse 12,12 r=5x3 c=moss2 outline` | Centre and radii (`r=5` means `r=5x5`); spans `2*RX+1` pixels. |
| `ellipse <x,y> <W>x<H> c= [outline\|fill]` | `ellipse 2,2 6x4 c=moss2 fill` | Inscribed in a box, so even sizes work. |
| `polygon <x,y> <x,y> <x,y> [...] c= [outline\|fill]` | `polygon 1,1 14,4 10,14 c=moss2 fill` | Closed. See *Curves and polygons*. |
| `fill <x,y> c= [mode=contiguous\|global] [conn=4\|8]` | `fill 7,9 c=stone3 mode=contiguous conn=4` | Flood fill (crosses edges on wrap documents). `mode=global` replaces every pixel of that colour. |
| `paint <x,y> <<` rows `>>` | see below | An ASCII block of palette keys. |
| `stroke pencil c= [pp=on\|off] <x,y> ...` | `stroke pencil c=ink pp=on 12,4 12,5 13,6` | One freehand drag through the sampled points. See *Strokes*. |
| `stroke eraser <x,y> ...` | `stroke eraser 3,3 4,4` | The same, clearing to transparent. |
| `layer add <name> [above=\|below=<layer>] [reference]` | `layer add rim above=main` | A new empty layer, by default above yours. See *Layers and frames*. |
| `layer <name>` | `layer rim` | Draw on that layer from now on (you only). |
| `layer set <name> [hidden=] [locked=] [reference=]` | `layer set rim locked=on` | Each `on` or `off`; only the flags given change. |
| `layer rename <name> <new>`, `layer move <name> above=\|below=<layer>`, `layer merge <name>`, `layer remove <name>` | `layer move rim below=main` | `merge` draws the layer onto the one below, in every frame, and removes it. |
| `frame add [<n>] [copy=<m>\|empty]` | `frame add 2 copy=1` | A new frame at position n (default: last), a copy of frame m (default: yours) or empty. Frames count from 1. |
| `frame <n>` | `frame 2` | Draw on (and see) that frame from now on (you only). |
| `frame remove <n>`, `frame move <n> to=<m>` | `frame move 3 to=1` | |
| `frame add [<n>] link=<m>` | `frame add link=1` | A new frame whose cels are linked to frame m's. |
| `frame set <n>\|<a>-<b>\|all ticks=<t>` | `frame set 1-4 ticks=12` | Durations in game ticks (the project's `tickRate`, 60 by default); new frames take their source's (default 10). |
| `tag add <name> <a>-<b> [loop=cycle\|pingpong]` | `tag add idle 1-2 loop=pingpong` | A named run of frames. Also `tag set <name> [frames=<a>-<b>] [loop=]`, `tag remove <name>`. |
| `view <dir> frames=<a>-<b>` | `view S frames=1-2` | A direction (S N E W SE SW NE NW) and its frames. `view remove <dir>`. |
| `view <dir> mirror=<dir>\|off` | `view W mirror=E` | A live mirror: the other view flipped left to right, kept up to date; its frames are added at the end. |
| `cel link <a>-<b> [layer=<name>\|all]`, `cel unlink …` | `cel link 1-4 layer=main` | Linked cels share their pixels (drawing on one draws on all). |
| `pivot <x,y>\|off`, `ground <y>\|off` | `pivot 11,22` | The pixel the sprite stands on and the row its feet rest on. |
| `select rect <x,y> <W>x<H> [add\|sub\|and]` | `select rect 2,2 6x4` | Select a rectangle. See *Selections*. |
| `select ellipse <cx,cy> r=<RX>x<RY>`, `select ellipse <x,y> <W>x<H>` | `select ellipse 8,8 r=6x4` | |
| `select lasso <x,y> <x,y> <x,y> ...` | `select lasso 1,1 14,3 9,14` | A polygon (pixel centres inside, and its edge). |
| `select wand <x,y> [mode=contiguous\|global] [conn=4\|8]` | `select wand 2,2 mode=contiguous conn=4` | Touching pixels of that palette index on your layer (or all of them). |
| `select colour c=<colour>` | `select colour c=moss2` | Every pixel of that colour on your layer. |
| `select layer [<name>]` | `select layer main` | The opaque pixels of a layer (default: yours). |
| `select all`, `select none`, `select invert`, `deselect` | | |
| `clear` | `clear` | Clear the selected pixels of your layer (or all of it) to transparent. |
| `shift <dx,dy> [sel] [wrap]` | `shift 2,-1`, `shift 5,0 wrap` | Move the selected pixels (or your whole layer). See *Transforms*. |
| `flip h\|v [sel]` | `flip h` | Mirror them within their box. |
| `rotate 90\|180\|270 [sel]` | `rotate 90` | Clockwise, about the middle of their box. |
| `mirror [x=<a>] [y=<b>] live` | `mirror x=11.5 live` | Live symmetry: later strokes are mirrored until `mirror off`. See *Symmetry*. |
| `mirror x=<a> from=left\|right`, `mirror y=<b> from=top\|bottom` | `mirror x=11.5 from=left` | Copy one side over the other, once. |
| `dither <x,y> <W>x<H> a= b= [pattern=] [level=]` | `dither 0,0 24x8 a=pool b=moss1 pattern=bayer4 level=0.25` | See *Dithering and gradients*. |
| `gradient <x,y> <W>x<H> ramp= [dir=] [steps=] [pattern=]` | `gradient 0,0 24x24 ramp=moss dir=down steps=5 pattern=none` | |
| `ramp <name> = <entry> <entry> ...` | `ramp wood = wood0 wood1 wood2` | Define or replace a ramp of this document's palette, darkest first. |
| `outline c= [mode=outer\|inner] [corners=on\|off] [from=<layer>]` | `outline c=ink mode=outer corners=off` | See *Helpers*. Without `c=`: the style guide's outline colour (`style.outline`). |
| `shade light= [ramp=<ramp>\|all] [edge=<n>]` | `shade light=nw ramp=wood edge=1` | Without `light=`: the style guide's (`style.light`). |
| `clean orphans [size=<n>] [keep=none\|texture]` | `clean orphans size=1 keep=none` | |
| `noise [<x,y> <W>x<H>] ramp= ...` | `noise 0,0 24x24 ramp=moss weights=0,3,12,1,0 cluster=1..2 density=0.07 base=moss2 wrap=on seed=7` | See *Generators*. |
| `scatter [<x,y> <W>x<H>] stamp=\|c= count= ...` | `scatter 0,0 24x24 stamp=tuft count=3 minDist=10 flip=on wrap=on seed=3` | |
| `voronoi [<x,y> <W>x<H>] cells= ramp= ...` | `voronoi 0,0 24x24 cells=7 ramp=stone weights=1,1,1,1,1,1 gap=ink relax=1 wrap=on seed=5` | |
| `bricks [<x,y> <W>x<H>] size=<W>x<H> ramp= ...` | `bricks 0,0 24x24 size=8x4 ramp=stone weights=1,1,1,1,1,1 gap=ink offset=4 seed=4` | |
| `stamp save <name> <x,y> <W>x<H>`, `stamp save <name> <<` rows `>>` | `stamp save tuft 4,4 3x3` | See *Stamps and brushes*. |
| `stamp <name> <x,y> [flip=none\|h\|v\|hv]` | `stamp tuft 10,12 flip=none` | Placed by its top-left corner. |
| `stamp remove <name>` | | |
| `brush square <n>`, `brush circle <n>`, `brush stamp <name>`, `brush off` | `brush circle 3` | |
| `def <name>(<param>,...) { ... }` | `def tuft(x,y) { px $x,$y c=moss3 }` | A macro. See *Macros*. |
| `call <name> <args...> [seed=<n>]` | `call tuft 5,18` | |
| `palette set <entry> hex=#rrggbb` | `palette set stone3 hex=#7a8a80` | Change a colour of this asset's palette. See *Palette edits*. |
| `palette add [<name>] hex=#rrggbb [key=<k>]` | `palette add gold hex=#e0b040 key=G` | Add a colour to this asset's palette. |
| `palette lock`, `palette unlock` | | See *Palette locking*. |
| `palette save as=<name>` | `palette save as=ruins-props` | Write this asset's palette to the project as a new palette. |
| `note <x,y> [<W>x<H>] "text"` | `note 12,5 "beak too long" id=n1` | Pin a note to a pixel or a region. See *Notes*. |
| `note done <id>` | `note done n1` | Close a note. |
| `mark <name> ["text"]` | `mark reviewed "fixed the rim"` | A named point on the tape; `reviewed`, `approved`, `rejected` set the status. See *Marks*. |
| `undo [group=<g>] [by=<author>]` | `undo group=g4` | See *Undo and redo* below. |
| `redo [group=<g>] [by=<author>]` | `redo group=h5` | Take back an undo. |
| `fork <from> <to> [at=<n>]` | `fork chest chest_b at=20` | Start asset `<to>` as a branch of `<from>`. See *Forks*. |
| `underlay generate "<prompt>" [layout=] [image=] [provider=] [model=] [quality=] [cap=] [layer=]`, `underlay import <file.png> [layout=] [layer=]` | `underlay mockup blob=<sha256> image=1536x1024 at=0,0 size=144x96 layout=<sha256> prompt="…" provider=openai model=gpt-image-1.5 quality=medium cost=0.05` | An image under the art on a reference layer; resolved by the server. See *Underlays and snap*. |
| `snap [from=<layer>] [into=<layer>]` | `snap from=mockup into=draft at=0,0 grid=144x96 pitch=5.333x5.334 offset=0.66,0.65 r2=0.97 material=0.98 <<` | The underlay quantised into a new draft layer. |
| `import <x,y> asset=<name> region=<x,y,WxH> [layer=]` | `import 0,0 from="yard:draft 120,0,24x24" <<` | A region of another asset, its pixels in the line. |
| `new font <name> <W>x<H> [chars=] [cols=] [baseline=] [line=] [spacing=]` | `new font hud 5x7 palette=… wrap=off cell=5x7 bg=none chars=65-90,48-57 cols=16 baseline=6 line=8 spacing=1 <<` | A glyph sheet. See *Fonts*. |
| `glyph <char> [advance=<n>\|auto] [<< rows >>]` | `glyph U+0021 <<` | One glyph's cell (and its advance). |
| `font set [baseline=] [line=] [spacing=]` | `font set baseline=6 line=9 spacing=1` | |
| `icon mode=tone\|full\|channel` | `icon mode=full` | How an icon is exported. See *Icons*. |

Commands that draw (everything that writes pixels) draw on your layer and frame, clipped by your
selection, and are refused while your layer is locked: `layer 'rim' is locked (layer set rim
locked=off to draw on it)`.

### Lines

Lines are pixel-perfect:

- Each step moves one pixel along the major axis, so a line is 8-connected with no doubled
  L-corners.
- The pixels are shared out evenly among the rows (or columns) the line crosses: `0,0 11,3` is
  runs of 3-3-3-3 and `0,0 8,2` is 3-3-3. Uneven counts are spread symmetrically (`0,0 6,2` is
  2-3-2).
- The pixels depend only on the two endpoints, not on the direction drawn.
- With `pp=on` (the default), a polyline drops the doubled L-corner pixels where its segments
  join. The exception is a right angle between straight horizontal and vertical segments, which
  is kept. `pp=off` keeps every joint pixel.

### Paint blocks

```
paint 8,4 <<
  ..kkk..
  .k333k.
  k34443k
>>
```

Each character is a palette key. `.` leaves the pixel as it is, and a space clears it to
transparent. The rows' shared indentation is removed. When spaces at the start or end of a row
matter, wrap every row in `|` margins; the text between the margins is used exactly:

```
paint 0,0 <<
  | k |
  |k k|
>>
```

The normal form uses a two-space indent, or `|` margins when a row starts or ends with a space.

### Strokes

`stroke` is what the pencil and eraser write: one drag, one line, one group. The points are the
pixels the pointer passed over, in order; consecutive points are joined by pixel-perfect segments.
With `pp=on` (the default) a doubled L-corner is dropped wherever the path makes one, as
Aseprite's pixel-perfect pencil does, so a drag that steps right and then down draws a diagonal.
Unlike `line`'s polylines, no right angle is kept. `pp=off` keeps every pixel. `stroke eraser`
takes no colour and never drops pixels. A stroke may run past the canvas: it clips, or wraps on a
`wrap=on` document.

### Layers and frames

Layers are listed bottom to top. The flat image (what views, previews and exports show) takes the
topmost non-transparent pixel of the **art layers**: those that are neither hidden nor
`reference`. A reference layer is a guide or an underlay for tracing: views and the watch view
show it faded underneath the art, and it is never exported. `layer add` puts a new empty layer
above yours (or `above=`/`below=` another); the normal form always names the place. Layer names
are letters, digits, `_` and `-` (not `add`, `set`, `rename`, `move`, `merge` or `remove`).

Frames are the animation (plan §4.4): every layer has a cel per frame. `frame add` inserts a
copy of your frame (or `copy=m`, `link=m`, or `empty`) and `frame <n>` chooses the frame you draw
on. Views show the frame the agent draws on (`frame=` in the MCP `view`, `--frame` in the CLI);
`preview.png` shows frame 1.

### Animation

- **Durations** are in game ticks: `frame set 2 ticks=6`, `frame set all ticks=12`. The project
  sets the tick rate (`tickRate` in project.json, 60 a second); playback, the `anim` view and its
  GIF run at it. A frame added later takes the ticks of the frame it copies.
- **Tags** name runs of frames (`walk`, `idle`) and say how they loop: `cycle` (1 2 3 1 2 3) or
  `pingpong` (1 2 3 2 1 2 3). A frame added strictly inside a tag (or a view) makes it longer;
  removing frames shortens it, and one left with no frames goes.
- **Views** are directions: `view S frames=1-2`, `view N frames=3-4`, `view E frames=5-6`. Views
  never overlap, and a frame cannot be moved out of its view. `view W mirror=E` makes W a **live
  mirror** of E: W gets as many frames as E (added at the end the first time), each of its cels is
  E's flipped left to right, and its durations are E's. It follows every change to E (drawing,
  frames added or removed, ticks) after every command. Drawing on a mirror frame is refused with
  the frame to draw on instead; `view W mirror=off` keeps W's pixels as its own. Only views facing
  the other way left to right mirror each other (E/W, SE/SW, NE/NW).
- **Linked cels** are one cel shown in several frames: `cel link 1-4` gives frames 2-4 of your
  layer frame 1's pixels, shared, so drawing on any of them draws on all; `cel unlink 2-3` gives
  each its own copy again. `layer merge` unlinks the layer below first.
- **Sequences.** Playback, the `anim` view and the `anim` checks step through every tag, every view
  with no tag inside it, or (with neither) all the frames as one cycle.
- **Pivot and ground line**: `pivot 11,22` (the pixel the sprite stands on, an export field) and
  `ground 22` (the row the feet rest on). The `anim` check measures ground drift from the ground
  line (or the first frame's lowest row) and pivot drift as the silhouette's centre column moving
  between frames. Both are drawn in cyan in the anim sheet and the watch view.

### Selections

Every author has their own selection. While it exists, **every drawing command that author
writes is clipped to it**, flood fills and generators included (`fill` starts only inside the
selection and never leaves it; `mode=global` replaces only selected pixels). Nobody else's drawing
is clipped by it. `deselect` (or `select none`) ends it.

- `select rect`, `select ellipse` (centre and radii, or a box) and `select lasso` (a polygon:
  pixel centres inside it, plus its edge) select shapes; on a `wrap=on` document they may cross an
  edge and wrap.
- `select wand x,y` selects the pixels of that palette index touching x,y on your layer, as it is
  when the line runs (`conn=8` counts diagonals; `mode=global` takes every pixel of the index).
  `select colour c=…` is the same as a global wand by colour. `select layer` takes a layer's
  opaque pixels in your frame.
- A trailing `add`, `sub` or `and` combines the new shape with your current selection (union,
  difference, intersection). `select invert` swaps selected and unselected; `select all` selects
  everything. A selection that ends up empty is no selection.
- `clear` sets the selected pixels of your layer to transparent.

The watch view's selection tools write these commands as soon as a selection is made, so a
selection is undone and redone like any edit.

### Transforms

`shift dx,dy`, `flip h|v` and `rotate 90|180|270` act on the selected pixels of your layer, or, with
nothing selected, on all of it. The pixels move (transparent ones too); the places they leave
become transparent; the selection moves with them. Past an edge they clip, or wrap on a `wrap=on`
document.

- `flip` mirrors them within their bounding box; `rotate` turns them clockwise about the middle of
  the box (a quarter turn swaps the box's sides, keeping its middle, rounded up and left).
- `shift dx,dy wrap` wraps within the selection's box, or within the canvas with nothing selected,
  on any document: `shift 12,0 wrap` moves a tile's seam into its middle, where you can see and
  fix it, and `shift -12,0 wrap` moves it back.
- The word `sel` (`shift 0,-1 sel`, `flip h sel`) insists on a selection: with none, the command
  is refused instead of moving the whole layer.

### Symmetry

`mirror x=11.5 live` turns on live symmetry for you: every later drawing command you write that
places shapes (`px`, `line`, `curve`, `rect`, `ellipse`, `polygon`, `stroke`, `paint`, `stamp`, and
`fill`, which starts again at each mirrored point) is drawn again mirrored across the axis, until
`mirror off`. The axis is a pixel position: `x=11.5` lies between pixels 11 and 12 (the middle of a
24 px canvas), `x=12` runs through pixel 12. `y=` adds a horizontal axis; with both, strokes are
drawn four times. `mirror live` alone means the vertical middle. Generators and helpers are not
mirrored.

`mirror x=11.5 from=left` copies the left half over the right once (`from=right` the other way;
`y=… from=top|bottom` for a horizontal axis), inside your selection if you have one.

### Curves and polygons

`curve` draws a quadratic Bezier through its first and last points, pulled by the middle one, or a
cubic with two middle points. It is sampled in exact integer arithmetic (each sample rounded to
the nearest pixel), joined by pixel-perfect segments, and, with `pp=on`, its doubled L-corners are
dropped as on a pencil stroke.

`polygon` closes its points. The outline is the closed polyline (pixel-perfect, right angles kept);
`fill` adds every pixel whose centre is inside (even-odd rule), so the filled shape and its outline
always agree. With a brush, outlines (`rect`, `ellipse`, `polygon` outline, and lines, curves and
strokes) draw with it; filled shapes do not.

### Dithering and gradients

Patterns are ordered threshold matrices anchored to the canvas, not to the box, so dithered areas
line up across a tile's edges and between boxes: `checker`, `bayer2`, `bayer4`, `bayer8`, `hlines`,
`vlines`.

- `dither x,y WxH a=<colour> b=<colour> pattern=… level=…` paints the box in `a`, with `b` on the
  share `level` of its pixels (0 to 1; default 0.5; `bayer4` by default).
- `gradient x,y WxH ramp=<ramp> dir=down|up|right|left|radial steps=<n> pattern=…` runs along a
  ramp from its first colour to its last (`radial`: from the middle of the box out to its corners).
  `steps` colours of the ramp are used, spread evenly from first to last (default: all of them).
  With `pattern=none` (the default) the bands meet with a hard edge; with a pattern, each band
  dithers into the next. `ramp=` names a palette ramp, or lists entries: `ramp=stone1,stone2,stone4`.

### Ramps

A ramp is an ordered run of palette entries, darkest first (plan §3.1). Palette files define
ramps; `ramp <name> = <entry> ...` defines or replaces one in this document's palette (entries by
name or key). Ramps drive `gradient`, `shade`, `noise`, `voronoi`, `bricks` and `clean ...
keep=texture`, and the watch view's gradient tool.

### Helpers

- `outline c=<colour>` draws a 1-px outline around the shapes on your layer: `mode=outer` (the
  default) colours the transparent pixels next to a shape; `mode=inner` colours the shape's own
  edge pixels. `corners=off` (the default) looks at the four side neighbours, `on` at all eight.
  `from=<layer>` outlines the shapes on another layer, onto yours (an outline layer under the art).
- `shade light=<n|ne|e|se|s|sw|w|nw>` lights each shape: a pixel whose colour is in a ramp, within
  `edge` pixels (default 1) of the shape's boundary on the lit side, goes a ramp step lighter; on
  the far side, a step darker. A shape is a run of pixels of the same ramp; anything else is its
  boundary. With a diagonal light, both of its sides count (nw: north and west are lit). A pixel
  lit from one side and shaded from the other (a 1-px part) stays. `ramp=all` (the default) shades
  each colour along the first ramp it is in.
- `clean orphans` replaces each pixel whose colour no 4-neighbour shares (a lone pixel; transparent
  counts as a colour) with the colour most common around it. `size=n` takes clusters of up to n
  pixels. `keep=texture` keeps a stray that is one ramp step from its surroundings: specks within
  a material are texture, not mistakes.

### Generators

Every generator writes its seed into the line: give `seed=` to choose one, or leave it out and the
normaliser picks one (from the command's place on the tape) and records it. The same seed always
gives the same pixels; another seed is another variant. The box is optional (default: the whole
canvas). With `wrap=on` (the default on `wrap=on` documents) a generator treats the box as a torus,
so a texture fills a tile seamlessly by construction.

- `noise ramp=<ramp> weights=<w,...> cluster=a..b density=<share> base=<entry>|keep`: fills the box
  with `base` (default: the entry with the largest weight; `keep` leaves the pixels as they are),
  then grows clusters of a..b pixels (default 1..3; on cells of 48 px and up it scales with the cell, 2..6 at 48, G14) in the other ramp colours, chosen by weight,
  until about `density` of the box is covered (default 0.15).
- `scatter stamp=<name>[,<name>...] count=<n> minDist=<d>`: places stamps (chosen at random from
  the list) at points at least `minDist` apart (on a torus with wrap), each by its middle;
  `flip=on` flips some of them left-right. `c=<colour>` scatters single pixels instead.
- `voronoi cells=<n> ramp=<ramp> weights=… gap=<colour>|none relax=<n>`: stones. Each pixel
  belongs to the nearest of n spread-out points (moved `relax` times to their cell's centre,
  default 1); each cell takes a ramp colour by weight, and `gap` draws 1-px joints between cells.
  Follow it with `shade` for bevelled stones.
- `bricks size=<W>x<H> ramp=<ramp> weights=… gap=<colour>|none offset=<n>`: courses of bricks
  W by H with 1-px joints (included in the size), every other course shifted by `offset` (default
  half a brick). A box a whole number of bricks wide repeats seamlessly.

### Stamps and brushes

A stamp is a piece of art kept in the document. `stamp save <name> x,y WxH` copies a box of your
layer (with a selection, unselected pixels are left out); `stamp save <name> <<` takes a paint
block (`.` and space are transparent). `stamp <name> x,y` draws it with its top-left at x,y; its
transparent pixels leave the canvas alone; `flip=h|v|hv` mirrors it. `scatter` places stamps
procedurally, and `brush stamp <name>` draws with one's shape.

`brush square <n>` and `brush circle <n>` (1 to 32 px) make lines, curves, strokes, single pixels
and outlines draw a square or round dot at every pixel; `brush stamp <name>` draws the stamp's
opaque shape, in the command's colour; `brush off` (or size 1) goes back to single pixels. The
brush is yours alone and stays until you change it.

### Macros

```
def tuft(x,y) { px $x,$y $x+1,$y-1 c=moss3 ; px $x+2,$y c=moss2 }
call tuft 5,18
```

`def` keeps a body of commands in the document; `call` runs it with values for its parameters (a
point `5,18` fills two). In the body, `$x` is a parameter, `$x+1` is arithmetic on it (`+ - * /`,
left to right, `/` rounding down), and `$(x*2+y)` is any integer expression of the parameters.
Words work too: `def row(y,c) { line 0,$y 23,$y c=$c }` then `call row 4 moss1`. A body may span
lines and call other macros (8 deep at most); it may not hold `new`, `fork`, `undo`, `redo`, `note`
or `def`. The `def` is checked when it is written (its body must parse).

The tape records the `def` (body normalised: shared indentation removed) and each `call` as one
line, not its expansion; replay expands it again. A generator in a body without `seed=` takes
its seed from the call's: the call's line then records `seed=<n>`, and `call … seed=<n>` with
another number gives another variant of the whole macro.

### The palette in the tape

Since language version 2 a tape does not depend on the project's palette files: its `new` line
carries the palette, as it was when the asset was made, in a block of rows. One row per entry,
`<key> <name> #rrggbb [role=<role>]`, then one per ramp, `ramp <name> <entries...>`:

```
new sprite chest 24x24 palette=mossy-ruins wrap=off cell=24x24 bg=none <<
  k ink #17181d
  0 stone0 #272a30
  ...
  ramp stone stone0 stone1 stone2 stone3 stone4 stone5
>>
```

You write `new sprite chest 24x24` (the project palette is read once, and written down), or give
the block yourself. A tape in language 1 (made before G5: its `new` line has no block) still
replays, reading the project palette as it did; a branch of such a tape stays in language 1. Its
header says which (`{"pclaw":"tape","lang":1}`), and `verify` refuses a header that does not match
the tape. So changing or saving a project palette (`palette save`) affects only assets made later.

### Underlays and snap

An **underlay** is a full-colour image under the art (plan §6): a generated mockup, a sketch, a
photo of a drawing. It sits on a reference layer, stretched over a rectangle of the document, is
shown faded under transparent pixels (the `render` view, the watch view) and is never part of the
art or an export. Images are kept as content-addressed blobs (`blobs/<sha256>.png`).

- `underlay generate "<prompt>" [layout=<template.png>|<layer>] [image=1536x1024] [provider=openai|fake] [model=<m>] [quality=low|medium|high] [cap=<usd>] [layer=mockup] [at=x,y] [size=WxH]`
  asks an image provider for one image. `layout=` is the flat template it should follow (a PNG in
  the project such as `templates/mockup.png`, or a layer of the asset drawn in flat colours): it
  is sent as the image to edit, and kept as a blob for snap's material match. `image=` is the size
  to ask for (default: the one of 1024x1024, 1536x1024 and 1024x1536 nearest the document's
  shape). The default provider is `openai` (model `gpt-image-1.5`, quality `medium`; project.json
  `underlay` changes the defaults); `fake` draws an offline draft of the layout (tests and demos).
  The key, the cost cap and the cost log are described in [mcp.md](mcp.md#underlays-and-the-openai-provider).
- `underlay import <file.png> [layout=<template.png>|<layer>] [layer=underlay] [at=x,y] [size=WxH]`
  takes any PNG (relative to the project, or an absolute path).
- The size `underlay generate` asks for follows **the placed area** (`size=`, else the canvas;
  G13): the supported size nearest its shape (1536x1024 landscape, 1024x1536 portrait, 1024x1024
  square), so a 16x32 placement on a 48x32 sheet asks for a portrait image. A layer layout is cut
  to that area too.
- Both run through the server (the MCP `run` tool, the watch view's command line, `pixelclaw run`)
  before the batch, and are written as **`underlay <layer> blob=<sha256> image=<W>x<H> at=<x,y> size=<W>x<H> [layout=<sha256>] [from="…"] [prompt="…" provider=… model=… quality=… cost=…]`**:
  the tape holds only the image's hash, where it was placed and where it came from. The layer is
  made at the bottom as a reference layer (or an empty reference layer of that name is reused).
  Each such command goes on a line of its own.
- `snap [from=<underlay layer>] [into=draft] [fit=placement|free]` reads the underlay back into
  pixel art on a **new draft layer** (on top): it fits the image's pixel grid. With
  `fit=placement` (the default since G13) the grid is the placement's: the pitch is the image's
  size over the placed size, exactly one block per placed pixel, and only the offset is fitted
  (the edge profile's phase at that pitch), so the draft lands on the placement pixel for pixel.
  `fit=free` searches the pitch too (the edge profile's strongest period within ±15 % of the
  placement's; G11's rule), which can drift to a nearby period on a draft without a crisp grid.
  Then
  it takes each block's colour (the median of its middle), quantises it to the palette, and reports
  **block R²** (how much of the image's colour the blocks explain) and, when the underlay has a
  layout, the **material match** (the share of blocks nearest the mean colour of their own layout
  colour's blocks). The line records the result:
  `snap from=mockup into=draft at=0,0 grid=144x96 pitch=5.333x5.334 offset=0.66,0.65 r2=0.97 material=0.98 << rows >>`,
  so replay never reads the image. Below R² 0.8 or material 0.85 the run warns: reroll the
  underlay, or trace over it instead.
- `import <x,y> asset=<name> region=<x,y,WxH> [layer=<layer>]` copies a region of another asset (one
  of its layers, or its flat art) onto your layer: a tile cut from a snapped scene. The line
  records the pixels (`import 0,0 from="yard:draft 120,0,24x24" << rows >>`).

### Fonts

A **font** is a glyph sheet (plan §4.6): one cell per character, in the order given.

- `new font <name> <W>x<H> [chars="ABC…"|32-126,160] [cols=16] [baseline=<row>] [line=<px>] [spacing=1]`:
  `W`x`H` is a glyph cell; the canvas is `cols` cells across and as many rows as the characters
  need. `chars=` is the characters themselves (quoted), or code points and ranges (decimal or
  `U+hex`); the normal form writes code points and ranges in the given order
  (`chars=65-90,48-57,32`). `baseline` is the cell row glyphs stand on (default the last), `line`
  the line height (default the cell height + 1), `spacing` the pixels after each advance.
- `glyph <char> [advance=<n>|auto] [<< rows >>]` draws one glyph: the rows (palette keys, `.` or a
  space for nothing) replace its cell from the top-left, on your layer and frame. Letters and
  digits are written as themselves; anything else as `U+0021` (or quoted, `"!"`). A glyph's
  advance is its ink width (the rightmost drawn column + 1) unless `advance=` sets it; an empty
  glyph (a space) is half a cell unless set.
- `font set [baseline=] [line=] [spacing=]` changes the metrics.
- Any drawing command works on the sheet too (`paint @cell(3,1) …`).
- Exports: the **glyph strip** and **BMFont** (see [profiles.md](profiles.md#fonts)), with
  `pixelclaw export <project> <font> --format strip|bmfont`, MCP `export(asset, format)`, or a
  profile's `fonts`.

### Icons

`icon mode=tone|full|channel` sets how an icon is exported (plan §4.5): **tone** art is recoloured
by the game (role entries, written through the profile's role colours), **full** art is drawn as
is (often a white silhouette), **channel** art is pure-RGB channel masks (every colour's channels
0 or 255, written exactly). Without it an icon is `tone` when its palette has roles, else `full`.
The `palette` check holds the art to its mode; `consistency` holds an icon set to one stroke
weight, box fill and optical centre ([checks.md](checks.md)).

### Palette edits

A document holds its own copy of its palette, taken from the project when `new` runs. `palette
set` and `palette add` edit that copy, as commands on the tape, so replaying the tape gives the
same colours even if the project's palette file changes later. Entries are never removed or
reordered (pixels store entry numbers); the names on the tape stay valid.

- `palette set <entry> hex=#rrggbb` changes an entry's colour. The entry may be named by its name
  or its key; the tape records the name.
- `palette add [<name>] hex=#rrggbb [key=<k>]` appends an entry. Without a name it is called
  `c<N>` (N = its position); without a key it gets the first free one (`0-9`, `a-z`, `A-Z`, then
  punctuation). The normal form always records both.
- **Roles** (recolourable art, plan §3.1): `palette add <name> role=<role>` and `palette set
  <entry> role=<role>|none`. The roles are `black`, `white`, `light`, `dark` and `darkest`. A role
  entry stands for a colour a theme gives it; its own `hex` (by default the grey theme's) is only
  what it looks like without a theme. In role art (a palette with any role entry) the `palette`
  check wants every pixel to be a role, and the `black` role counts as outline ink. Themes are for
  looking only: the watch view's theme menu and the `recolour` and `theme=` views. Built-in themes:
  `grey`, `moss`, `ember`, `tide`, `dusk`, `sand`; a project adds its own in `project.json`
  (`"themes": { "lantern": { "light": "#f2d27a", "dark": "#b0702c", "darkest": "#4a2410" } }`).

`#` would start a comment after a space, so colours are written as `hex=#…`.

### Palette locking

`palette lock` locks this document's palette: `palette set`, `palette add` and `ramp` are refused
(`palette 'mossy-ruins' is locked (palette unlock to change it)`) until `palette unlock`. Colours
outside the palette are always refused (`c=#ff00ff is not in palette 'mossy-ruins'`), locked or
not. Importing images (G9) will quantise to a locked palette.

`palette save as=<name>` writes this document's palette, as it is at that line, to the project as
`palettes/<name>.json`, for other assets to use (`new ... palette=<name>`). It is refused if the
project already has a different palette of that name, because every tape made with that palette
would then replay differently; saving an identical one again is fine. The line stays on the tape
as a record; replay does not write the file again, and undoing it does not remove the file.

### Notes

`note 12,5 "too dark"` pins a note to a pixel; `note 8,0 12x10 "…"` to a region (inside the
canvas). Notes are for whoever reads the tape next: people pin them in the watch view, and the
agent reads them through `changes` (see [mcp.md](mcp.md)). The normal form adds the note's id,
`id=n1`, one past the highest id on the tape, so ids are never reused, even after an undo. Open
notes are part of the document's state (they appear in `asset.json` and the state hash) and show
on the canvas. `note done n1` closes one. Undoing a note's group removes it.

### Marks

`mark <name> ["text"]` names this point on the tape (plan §7.2): `mark reviewed "blind review
g10: 5 findings fixed"`. Names are words (a-z, 0-9, `_`, `-`). Three set an asset's status
(see [pipeline.md](pipeline.md#statuses)): `reviewed` (the agent, after a blind review's findings
are dealt with), `approved` and `rejected` (a person, from the dashboard). Each mark keeps the
art's hash, so a later change to the pixels makes it stale. Marks are part of the state (written
only when there are any); undoing the group takes the mark away.

### Undo and redo

- `undo` takes back the latest group that is still in effect and is not itself an undo. The
  chosen group is written into the line (`undo group=g4`).
- `undo group=g2` takes back any earlier group still in effect. Later groups stay.
- `undo by=human:chris` takes back that author's latest drawing group still in effect, whoever
  drew after it. The watch view's Undo button (Ctrl/⌘+Z) writes this for the person using it.
- `redo` takes back an undo: the latest undo still in effect (`by=<author>`: that author's), as
  long as nothing new was drawn after it (by that author). Drawing something new ends the redo
  chain, as in any editor. `redo group=h5` takes back undo group `h5`. The line records the group:
  `redo group=h5`. Undoing an undo group with `undo group=…` is the same thing.
- The group that created the document (with `new` or `fork`) cannot be undone. A batch cannot undo
  its own group.

The agent's plain `undo` is unchanged: the latest group in effect, whoever wrote it.

### Forks

`fork <from> <to> [at=<n>]` starts asset `<to>` as a branch of `<from>` at command `<n>` (default:
its last). It must be the first command of a batch run on the new asset (in MCP:
`run(asset: "chest_b", commands: "fork chest chest_b at=20")`; in the watch view: time travel to a
line, then **Branch here**). The source is not touched.

#### The branching tape format

A branch's `tape.jsonl` is self-contained. It holds:

1. the source's entries 1..`at`, copied exactly (same `seq`, `by`, `at`, `group` and `cmd`), so
   the branch keeps who drew what;
2. the fork line, numbered `at+1`, in the forking author's next group: `fork chest chest_b at=20`;
3. the branch's own commands after it.

(This example is a language 1 tape; in language 2 the `new` line also carries its palette block.)

```
{"pclaw":"tape","lang":1}
{"seq":1,"by":"claude","at":"…","group":"g1","cmd":"new sprite chest 12x12 palette=mossy-ruins wrap=off cell=12x12 bg=none"}
{"seq":2,"by":"claude","at":"…","group":"g1","cmd":"rect 1,3 10x8 c=soil1 fill"}
{"seq":3,"by":"claude","at":"…","group":"g1","cmd":"rect 1,3 10x8 c=ink outline"}
{"seq":4,"by":"human:chris","at":"…","group":"h1","cmd":"fork chest chest_b at=3"}
{"seq":5,"by":"human:chris","at":"…","group":"h2","cmd":"fill 3,5 c=moss2 mode=contiguous conn=4"}
```

Replay is the ordinary replay: the copied prefix rebuilds the source's document as it was at
`at`, and the fork line renames it to the branch. When replayed, the fork line checks that the
document is `<from>` and that `at` is the command just before it, so a tape whose prefix was
edited does not replay. The fork's group cannot be undone (it made this asset); the copied groups
can, as on any tape. The source's later history, or even its tape being started again, never
changes a branch. `asset.json` records the link: `"links": [{"fork": {"from": "chest", "at": 3}}]`.

## Views

`pixelclaw view <project> <asset> [render|grid|tile3x3|diff|game|recolour|anim|map|family|all]` (`all` is the
first three):

- **render**: a nearest-neighbour PNG. The default scale gives about 192 px on the long side
  (8x for a 24 px tile). It has a faint pixel grid, stronger lines every 8 px, rulers labelled
  every 8 px, magenta cell lines on sheets, and a grey checkerboard for transparent pixels.
  `--region` shows part of the canvas (G15), at the scale given, the rulers keeping the canvas's
  coordinates.
- **grid**: the text index grid. There is one character per pixel (its key; `.` for transparent),
  with column and row numbers and a legend of the keys used with pixel counts.
  `--region` shows part of the canvas.
- **tile3x3**: the document repeated 3x3, at 1x and at 4x (or `--scale`) side by side, to show
  seams and repetition.

A region is written the same way everywhere (G15): `x,y WxH`, `x,y,WxH` or `x,y,W,H`, in
`--region`, MCP `view region=`, and `import … region=` (quote the form with a space:
`region="0,0 24x24"`).
- **diff**: before and after side by side at the render scale. Each changed pixel is outlined in
  magenta on both, and open notes are outlined in yellow dashes. With more than 60 changed pixels a
  third panel shows them as a map (the after image dimmed, changes solid magenta). The text lists
  up to 60 changes as `x,y from→to` by entry name. By default it shows what the latest group
  changed; the MCP `view` takes `since=<n>` and `changes` uses the agent's read position. On
  documents with frames it compares every frame: one row per frame that changed (numbered at the
  left), and the text says which (`f2 12,5 ink→wood2`).
- **game**: the asset on its usual ground tile (repeated under it) beside the rest of its set,
  at 1x (real size) and again at the engine's draw scale (`style.drawScale`, default 2, or 1 when the project's grid is 48 px or more; at 1 the scene is shown once). The
  ground is `--ground`, else the style guide's (`style.ground`, or per asset), else the first
  tile; the set is `--with` (repeatable), else every other asset of the same kind and size that
  does not wrap, leaving out branches of the same asset. A sprite with views shows its other
  directions (each view's first frame) beside it first.
- **anim**: the contact sheet (plan §2): one row per sequence (tags, views, or all frames), each
  frame with its number and ticks above it, the frame before it in the sequence tinted red under
  it (the onion skin), the pivot and ground line in cyan, and under it the share of pixels changed
  from the frame before (`2>3 17%`; under the first frame of a cycle, the loop seam). The text gives
  each sequence's frames, ticks, loop time at the project's tick rate and every frame-to-frame
  change. It also writes `<asset>.anim.gif`: every sequence side by side, looping at the game's
  speed (tiles 3x3).
- **recolour**: role art under several preview themes side by side (`--themes a,b,c`, default the
  first six), each with a strip of its role colours.
- **map**: a sample map built with a family's scheme (plan §2, §4.2): a random island of
  `--size CxR` tiles (default 12x10) from `--seed N` (default 1), each tile its variant, at the
  game's draw scale (`--scale`, default 2). The text gives the seam score over the map (the same
  metric as a tile's, over the composed map) and how often each variant appears. Overlays given
  with `--with` play over it; when the family's frames or the overlays move it also writes
  `<asset>.map.gif` (one loop of everything, at most four seconds). A tile's map is the tile
  repeated; an overlay's is over the first family (or `--ground`).
- **family**: every variant of a family in the middle of the 3x3 map that resolves to it (the
  neighbours dimmed), labelled (pieces in cyan, detached variants in amber); the text says where
  every cell is on the sheet.

`--marks failing` (or check names: `--marks orphans,jaggies`) circles the pixels those checks flag
in magenta, on `render`, `tile3x3` (the middle copy of the enlarged one) and `game`. `--theme
<name>` shows role entries under a theme. See [checks.md](checks.md) for the checks.

Views show the art layers of one frame (`--frame N`, default 1 in the CLI; the agent's frame in
MCP), with visible reference layers faded underneath in `render`. Views are written to
`<project>/views/<asset>.<mode>.png` (or `.txt`), or to `--out <dir>`.

## The tape

`assets/<name>/tape.jsonl` starts with a version header, then one entry per command:

```
{"pclaw":"tape","lang":2}
{"seq":1,"by":"claude","at":"2026-10-27T12:00:00Z","group":"g1","cmd":"new tile floor 24x24 palette=mossy-ruins wrap=on cell=24x24 bg=stone1 <<\n  k ink #17181d\n ...\n>>"}
```

`by` is the author (the CLI's `--by`, default `claude`; `human:<name>` from the watch view), and
`at` is stamped by the writer. Replay ignores both, except that `undo by=` and `redo by=` are
resolved by author when first written (the tape records the group they chose).
`pixelclaw verify` checks five things:

- every line replays and is still in normal form;
- two replays give the same bytes;
- the result matches the state hash in `asset.json` (a hash written before G4, in the older state
  format, is accepted until the asset is saved again);
- the result re-renders to the committed `preview.png`;
- every checkpoint matches the replay at its point, byte for byte, and none is missing.

### Checkpoints

Every 200 commands the writer saves `checkpoints/NNNNNN.gwc`: the document after the first N
commands. The file is a header line, `PCLAWCKPT 1 <N> <sha256 of those N tape lines>`, then the
document's state bytes (the same bytes the state hash in `asset.json` is taken of: palette, layers,
frames, every cel, each author's context, notes, stamps and macros). Loading an asset starts from
the newest checkpoint whose tape lines still match and replays only the rest. Starting a tape
again removes its checkpoints.

### Import and densities

| Command | Normal form | Notes |
|---|---|---|
| `import <x,y> [from="<file>"] [blob=<sha256>] << rows >>` | `import 0,0 from="sheet.png" blob=3f… <<` rows `>>` | An imported image's pixels on your layer and frame: each row is palette keys, `.` transparent; the rectangle is replaced. `pixelclaw import` and MCP `import` write these (see [profiles.md](profiles.md#import)); the line carries the pixels, so the tape replays without the file. |
| `scale <n>` | `scale 2` | The whole document n times larger (2..8), nearest neighbour: every layer, frame and stamp, the cell grid (a footprint keeps its cells), the pivot, the ground line and notes. Selections and symmetry are dropped. Not on families or maps. A higher density starts this way. |
| `density of=<asset> d=<n>` / `density off` | `density of=house d=2` | This asset is `<asset>` at n times its size: the `density` check reduces it and compares, the density view shows the levels, and exports write it as that level. |

`new family <name> <T>x<T> scheme=<s>` with a scheme of the project's own (`schemes/*.json`)
writes it into the line as `def="<its JSON>"`, like the palette, so the tape replays without the
file. A fillet scheme (`blob47-round`) takes `family band … fillet=<px>`: how much wider every
inner corner turns (kept by later `family band` lines unless given again).

## Seeds

Commands that use randomness (`noise`, `scatter`, `voronoi`, `bricks`, `map gen`, `family
coverage`, `family band … jitter=`, and `call` when its macro uses them) take `seed=<n>`. The MCP
`seeds` tool (and `pixelclaw seeds`) tries one such line with several seeds as dry runs and ranks
them by the checks; `run` with `dry=true` (`pixelclaw run --dry`) tries any batch and keeps
nothing. If it is left out, the normaliser picks one from the command's tape
position and writes it into the logged line, so a replay never depends on a default.
