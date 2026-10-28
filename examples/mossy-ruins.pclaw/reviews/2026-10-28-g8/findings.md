# Review: mossy-ruins, G8 (house, tree, well; meadow, lane, shore; village)

I looked at the game-scale images first (assets/*.game.png, scenes/*.png, the nine village screens, the three maps and shore.gif), then the enlarged grids, the sets and the text files. I read pixel values straight from the PNGs to pin coordinates, check the palette and measure edge contrast.

## Summary

The house and the tree are the strongest pieces. They read instantly at 1x, have clean ink outlines and are lit from the top left. The grass texture is good: varied, and no seams. The weak points are the ground, not the props:
- The open sea is a single water tile repeated into a visible diagonal weave.
- The sand tile carries a dark "+" mark that lines up across every repeat.
- The meadow and shore edges are ruler-straight with almost square corners, so at game scale the island and the grass read as stacks of 24 px cells.

The well is the weakest sprite: its basin is pillow-shaded, its water is flat and its bucket is a flat block.

Checks I ran:
- **Palette:** every pixel in the three sprites, the three maps and the village scene is in the palette (0 colours outside it).
- **Edge contrast:** I placed all 27 objects in the village (22 trees, 4 houses, 1 well) and compared each edge pixel with the ground pixel next to it. No pair is closer than 15 L*.
- **Scene repetition:** apart from water, the most any one tile fills a 4x4 window is 9 cells (meadow fill), so that rule passes. Water fills 16 of 16 in every open-sea window.

## Scores

1. **Readability: 4.** The house (red roof, cream wall, door and two windows, front facing south) and the tree (round crown on a trunk) read at a glance at 1x on grass, and their outlines clear the ground everywhere. The well is the weak one. At 1x it is a grey bowl under a brown bar with an orange dot. It reads as a basin or a fountain more than a well, because the frame is thin and the bucket is a flat 3x3 square.

2. **Cohesion: 3.** All three share the palette, the 1 px ink outline and similar detail. The house and the tree are lit from the top left. The well's basin is shaded dark on both sides and the bottom, so it breaks the shared light. Only the tree has a ground shadow. The shadow has an ink outline and sits centred under the trunk, not falling to the lower right, so it reads as a dark plate. The house and the well have no shadow at all.

3. **Seams and repetition: 2.**
   - No seam lines: the grass variants join invisibly.
   - Water: the same water tile fills the whole sea. Its marks are one motif ("WW" over "V..V" plus 3 px water0 dashes) laid on a diagonal stride, so the sea reads as a woven diagonal lattice. This is plain on screens 3, 7 and 9.
   - Sand: the sand tile has two sand0 "+" crosses (two ramp steps darker than the field) at 19,6 and 5,16. They repeat every 24 px into a dotted grid. Column 6 of the village has 10 identical sand cells in a row (rows 8-17), and row 23 has 9 (columns 16-24).

4. **Style-guide fit: 3.**
   - Followed: palette, sizes (48x48 house, 24x48 tree, 24x24 well), outlines on props and none on tiles, the shore band (water, broken foam, a sand0/sand1 wet strip, dry sand), and glints scattered out of step.
   - Breaches:
     - Nine lone roof3 pixels on the house roof and two lone stone1 pixels on the chimney. The guide forbids stray single pixels on props.
     - Pillow shading on the well basin, and a dark rim on the tree crown's lit left side.
     - Shore corners are "rounded, never square" in name only: inner corners are a 1 px bevel and outer corners are a straight 4 px chamfer.
     - The lane is drawn in the sand ramp. The guide gives the sand ramp only to the shore (ruins-shore), so if the lane counts as ground it should use the soil ramp. I am not certain of this one, since palette.md lists sand as in use.

5. **Defects: 3.** There are no broken outlines and no doubled corners. Problems:
   - Stray pixels on the house roof and chimney.
   - The roof edge steps unevenly (runs of 3 rows with two runs of 4).
   - The roof's lit/shaded split is a dead-vertical line at x=34 that does not follow the hip.
   - The house foundation is a flat 3-row stone2 band.
   - The tree crown has a 6 px straight moss1 dash and a bright 2x2 moss3 square in its shaded lower half.
   - The well has pillow shading, a flat pool and a flat bucket.

6. **Animation: n/a.** There are no animated assets. The shore map GIF (4 frames of 15 ticks) ripples the water evenly with no hitch at the loop (frame 4 to frame 1 changes about as much as any other step). The foam is static.

7. **Autotiling: meadow 2, lane 3, shore 3.**
   - **Meadow:** the grass sits on the sand like a cut-out carpet. It has a continuous, perfectly straight moss1 rim with only a few 1 px tufts. Outer corners are a 2 px chamfer and inner corners are square (for example map 7,3), so every step of the map's outline shows the tile grid.
   - **Lane:** pieces join cleanly and the end caps are good. A lane is a connection scheme, though, so any 2x2 block of lane cells leaves a grass hole at the shared corner. The test map becomes a lattice of grass squares, one per tile corner. That is fine for one-cell paths (which is all the village uses), but there is no piece for a filled area such as a yard or square.
   - **Shore:** this is the best of the three. The band reads as a beach, the foam is broken, the outer corners are chamfered and the inner lake joins up. The straight runs are dead straight, though, and the inner corners are near-square, so the coast is a staircase of cells rather than one natural coastline.

8. **Scenes: 3.**
   - What works: the village reads as one place on one island. Every object sits exactly in its cells, bases meet the grass, sizes agree (a tree is about as tall as a cottage; the well frame is about door height), light is consistent apart from the well, and depth order is right (tree crowns drawn over the lane and the sand).
   - The ground grid shows. The coast and the meadow edge are staircases of whole cells with long straight runs: the east coast is straight for 7 cells (column 34, rows 14-20) and the meadow's west edge for 8 (column 7, rows 9-16). The sea is one repeated tile.
   - The 22 trees are one identical sprite, and three sit on one row (row 8, columns 20, 24, 26).
   - The tree at 21,16 comes within 1 px of the house beside it.
   - Every lane stops 1-3 cells short of the beach, and two houses (15,10 and 23,21) face no lane.
   - Note: cells.txt labels `s` as "sea", but those cells are drawn as sand beach. The sea is the `.` cells. The legend should say "shore" or "sand".

## Fine as is

- The house's walls, windows, door, posts and eave shadow.
- The tree's outline and trunk.
- The grass fill and its variants (no seams, no lattice).
- The lane's straight, corner, T and cross pieces.
- The shore's foam and wet-sand band.
- Object placement and draw order in the village.

## Defects

```
house 6,6 24x17 "nine lone roof3 pixels (11,6 26,7 12,10 19,10 8,14 23,14 15,18 6,22 29,22) are stray single pixels on a prop; pair each with a neighbour into a 2-3 px shingle highlight sitting on the course line below, or remove"
house 34,3 "lone stone1 pixel in the chimney face; remove or extend into a 2 px mortar joint"
house 36,5 "lone stone1 pixel in the chimney face; remove or join it to 34,3 as one joint line"
house 34,7 1x19 "lit/shaded roof split is a dead-vertical line from y7 to y25 that ignores the slanted right edge; step the boundary outward with the roof edge (a hip plane) so the shaded side widens toward the eave"
house 5,7 1x4 "roof edge steps run 3,3,4,3,3,3,4,3 rows (x5 y7-10 and x1 y20-23 are 4 long, mirrored at x42 and x46); even the runs out so the slope is one clean angle"
house 5,44 38x3 "foundation is a flat stone2 band; add stone1 block joints and lighten its left end to stone3"
tree 1,14 1x8 "moss1 rim just inside the outline on the lit left side (x1 y14-21, x2 y19-21); with the dark right and bottom this shades every side (pillow); lift the left edge to moss2/moss3"
tree 7,20 6x1 "straight 6 px moss1 dash across the crown reads as a scratch; break it into an irregular cluster underside of 2-3 px pieces"
tree 13,22 2x2 "bright moss3 square in the shaded lower half reads as a hole of light; drop to moss2 or shape it as the lit top of a small lower cluster"
tree 14,9 2x1 "lichen highlight sits right of centre, against the top-left light; move it up and left onto the lit mass (around 9,6)"
tree 3,42 18x6 "ground shadow is ring-outlined in ink and centred under the trunk, so it reads as a dark plate; drop the ink ring (moss0 only) and shift it toward the lower right"
well 2,14 2x6 "basin is shaded stone2 on the left as well as the right (x21) and bottom: pillow shading; light the left side (stone3/stone4) and keep stone2/stone1 on the right and bottom"
well 5,12 14x6 "pool is one flat colour; add a short stone4 glint at its upper left (as the house windows have) and a darker row under the back rim"
well 11,9 3x3 "bucket is a flat wood2 square with no rim or shade; give it a wood0/ink rim and shade its right column wood1"
meadow map 7,3 1,1 "inner corner is square; round it with a 3-4 px curve of grass so the border reads as growth, not a cut"
meadow map 7,2 4,2 "outer corner is only a 2 px chamfer and the moss1 rim runs ruler-straight along every edge; round the outer corners more and let the rim wobble 1-2 px with more tufts crossing it"
meadow map 0,0 19,6 "sand0 '+' cross (and its twin at 5,16) is the darkest mark in the sand tile and repeats every 24 px into a dotted grid; soften to sand1 or make sand variants that move it"
lane map 8,3 0,0 "any 2x2 block of lane cells leaves a grass hole at the shared corner, so a filled area becomes a grid of grass squares; add filled-area pieces or keep lanes one cell wide"
lane map 7,2 17,18 "the lane is drawn in the sand ramp, which the style guide gives only to the shore; if the lane is ground, redraw it in the soil ramp (or confirm the sand ramp is allowed here)"
shore map 7,3 2,2 "inner corner is a 1 px bevel and reads square; the guide asks for rounded corners, so curve it over 3-4 px"
shore map 0,0 9,4 "water tile is one motif ('WW' over 'V..V' plus 3 px water0 dashes) laid on a diagonal stride; repeated, the sea reads as a woven lattice; break the stride and add 2-3 water variants"
village cell 0,27 "open sea is one water tile in every cell (16 of 16 in each 4x4 window, over the limit of 10) and the diagonal weave shows on screens 3, 7 and 9; scatter water variants"
village cell 34,14 "east coast runs dead straight for 7 cells (column 34, rows 14-20); vary the edge inset or use edge variants so the coastline wanders"
village cell 7,9 "meadow's west edge is one straight line for 8 cells (column 7, rows 9-16) with square steps at both ends; vary the edge or let the meadow spill unevenly into the sand"
village cell 6,8 "10 identical sand cells in a column (rows 8-17) and 9 in a row at row 23 (columns 16-24) line up the sand '+' marks into stripes; needs sand variants"
village cell 21,16 "tree crown comes within 1 px of the house's left eave at 22,16 and the two outlines nearly merge; move the tree a cell west"
village cell 20,8 "22 trees are one identical sprite, three on this row (20, 24, 26); add a mirrored or second tree shape"
village cell 18,6 "lanes end in open meadow 1-3 cells short of the beach at every end (18,6, 18,21, 9,17, 31,17), and houses 15,10 and 23,21 face no lane; run the lanes to the shore or to the doors"
```
