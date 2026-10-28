# Mossy ruins: style guide

Old stone half taken back by moss, under a soft light from the top left.

- **Palette.** `mossy-ruins` for ground and stone. Props use `ruins-props`: the same colours
  plus a wood ramp and a brass ramp (so iron straps in the stone ramp are fine). Figures use
  `ruins-folk` (the same colours plus skin and cloth ramps); water uses `ruins-water` (plus a
  water ramp up to foam); the shore uses `ruins-shore` (water plus a sand ramp). Nothing else.
- **Light** from the top left. Light the lit side of a shape, shade the far side; never shade
  every side the same way (no pillow shading).
- **Outline.** Props and figures have a 1-px `ink` outline all round. Tiles have none.
- **Clusters.** No stray single pixels on props. On ground tiles a fleck one ramp step from its
  surroundings is texture.
- **Ground tiles** tile seamlessly, and no row or column of marks may line up into a stripe when
  the tile is repeated. Marks vary in shape and size; they should not sit on a regular lattice.
  The flagstone floor is the exception: its joints are its pattern.
- **Readability.** A prop must stand out from the grass at 1x: its edge at least 15 L* from the
  ground everywhere.
- **Size.** 24x24 for tiles, props and figures; the game draws them at 2x, at 60 ticks a second.
- **Animation.** Figures walk in four directions, two frames each, 12 ticks a frame; west is east
  mirrored. Feet stay on the ground line (row 22) in every frame and the figure does not slide.
  Each frame changes about a sixth of the figure (8-35 %). Water loops without a seam.
- **Shore.** Where sand meets water: the water's edge, a broken line of foam, a strip of wet sand,
  then dry sand. Corners are rounded, never square; the edge should read as one coastline, with
  no tile grid showing. Glints flash now and then on the water, never in step.

## Objects and scenes (G8)

- Objects sit on the 24 px grid: a house is 48x48 (2x2 cells), a tree 24x48 (one cell on the
  ground, its crown over the cell above), small props 24x24. Their footprints say which cells block
  and which are roofs or canopies (drawn above actors).
- A tree's crown is leaf clusters: its clusters' steps (and the waist between two masses) are
  texture, so jaggies allows up to 12 on the trees.
- Lanes are beaten sand: they use the shore's sand ramp.
- Scenes are judged at game scale: no straight edge repeats one tile more than 4 times, and no
  textured tile fills more than 10 cells of any 4x4 window (texture variants break both up).
