# Mossy ruins: style guide

Old stone half taken back by moss, under a soft light from the top left.

- **Palette.** `mossy-ruins` for ground and stone, `ruins-props` (its wood and brass) for props.
  Nothing else.
- **Light** from the top left. Light the lit side of a shape, shade the far side; never shade
  every side the same way (no pillow shading).
- **Outline.** Props and figures have a 1-px `ink` outline all round. Tiles have none.
- **Clusters.** No stray single pixels on props. On ground tiles a fleck one ramp step from its
  surroundings is texture.
- **Ground tiles** tile seamlessly, and no row or column of marks may line up into a stripe when
  the tile is repeated. Marks vary in shape and size; they should not sit on a regular lattice.
  The laid stone floor is the exception: its courses are its pattern.
- **Readability.** A prop must stand out from the grass at 1x: its edge at least 15 L* from the
  ground everywhere.
- **Size.** 24x24 for tiles and props; the game draws them at 2x.
