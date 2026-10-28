# Review: demo-g10

You are reviewing pixel art for a game, with fresh eyes. Judge only what you see in this folder.

## What is here

- `assets/<name>.png`: each asset enlarged with a pixel grid and rulers (numbers every 8 pixels,
  from 0 at the top left), for reading coordinates.
- `assets/<name>.game.png`: each asset at its real size (1x) and at the game's draw scale (2x).
- `tiles/<name>.3x3.png`: each tile repeated 3x3, at 1x and 4x, as it will cover the ground.
- `scenes/<name>.png`: each sprite on its usual ground beside the rest of its set, at 1x and 2x.
- `anim/<name>.png`: each animated asset's frames, one row per sequence (a direction or a named
  loop), each frame with its length in game ticks (60 a second) and the frame before it
  tinted red underneath; `anim/<name>.gif` plays them at the game's speed.
- `maps/<name>.png`: each autotile set laid out as a small map at the game's draw scale (2x),
  the way the game will place its tiles; `maps/<name>.gif` plays it (at 1x) when anything moves, and
  `maps/<name>.tiles.txt` says which tile is at each column and row of the map.
- `sets/<name>.png`: every tile of each autotile set, each in the middle of the neighbours that
  call for it (the neighbours dimmed), named.
- `scenes/<map>.png`: each scene (a place built from the tiles and objects) whole, at 1x;
  `scenes/<map>.screen<n>.png`: screens of it at the game's draw scale (2x), what a player
  sees, `scenes/<map>.screens.txt` says which cells each shows; `scenes/<map>.cells.txt` maps every cell (a letter per
  ground, a capital where an object stands).
- `palette.md`: the colours the art uses.
- `style.md`: the style guide.
- `brief.md`: the game's theme and what each piece is meant to be.

Tiles:
- clay

Sprites:
- urn
- kiln

Animated:
- (none)

Autotile sets (judge them on their maps):
- (none)

Scenes:
- (none)

## How to judge

Look at the game-scale images first, as a player would, then at the enlarged ones for detail.
Score each part from 1 (poor) to 5 (excellent) and say why in a sentence or two:

1. **Readability.** At 1x on its ground, does each sprite read at a glance: its shape, what it
   is (is it what brief.md says it is?), its front? Is its edge clear of the ground?
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
8. **Scenes.** At game scale, does each scene read as one coherent place? Do the buildings,
   trees and props sit on their ground (bases meeting it, sizes that agree, one light), in a
   sensible order front to back? Does any stretch of ground or edge repeat so that the grid shows?

## How to report

End with a list of defects, one per line, each pinned to pixels in the asset's own coordinates
(x from the left, y from the top, as the rulers show), in this form:

```
<asset> <x>,<y> "what is wrong and what to do"
<asset> <x>,<y> <w>x<h> "for a region"
```

For a scene, point at the cell by its column and row (as `cells.txt` numbers them):

```
<scene> cell <col>,<row> "what is wrong and what to do"
```

For a map, point at the tile by its column and row on the map (from 0 at the top left; each
tile is the set's tile size at 1x), and at the pixel inside that tile:

```
<set> map <col>,<row> <x>,<y> "what is wrong and what to do"
```

Only list what you can point at. If an asset is fine, say so.
