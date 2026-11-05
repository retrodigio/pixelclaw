# Kiln Hollow: style guide

Red clay, sage and smoke under a warm morning sun from the top left.

- **Palette.** `kiln-hollow` only. Ramps run dark to light: clay (5), sage (4), stream (4), stone
  (4), wood (3), glaze (4), ember (3); `ink` for outlines, `smoke` for smoke. The blue glaze is the
  one bright accent: glazed pots, the stall's awning, nothing else.
- **Light** from the top left (nw). Lit sides one ramp step up, far sides one step down; no pillow
  shading.
- **Outline.** Props, objects and figures: a 1-px `ink` outline all round. Ground tiles: none.
- **Clusters.** Ground texture in clusters of 2-6 pixels, one or two ramp steps apart, never on a
  lattice; no stray single pixels on props.
- **Sizes.** The grid is 24 px; the game draws at 2x, 60 ticks a second. Props are 24x24 and
  stand on the bottom rows; objects keep the grid (a kiln is 24x48: one cell on the ground, its
  neck over the cell above). Heights in the manifest are the drawn shape's: an urn 14 px, the
  potter 21, a kiln 44.
- **Ground tiles** tile seamlessly with no stripes or grid; the clay shows cracks and a few pale
  pebbles.
- **Readability.** Everything that stands on the clay keeps its edge at least 15 L* from it.
- **Round pots** step their shading bands with the curve of the belly (the blind review asked
  for the lit and far sides 2-3 px deep): `jaggies` allows 2 such steps on the urns; their
  outline stays clean.
