# Ember Moor (an original demo theme, 48 px)

A high heather moor at dusk: olive moor grass with tufts of purple heather, dark bog pools with
peat banks, and lichen-spotted standing stones that mark the old ways across it. Tiles are 48 px
and the game draws them at 1x (the project's grid is 48, so the camera is 16x9 cells, 768x432).

The set (G14, built by the scripts in `scripts/` through the CLI, as an agent's `run` would):
- `moor`, `moor_b`, `moor_c`: the ground and two texture variants (forked from the moor, so their
  borders are its border; each changes only its inside).
- `bog`: the pool's water texture.
- `pool`: a blob47 edge family (bog inside, moor outside, a peat bank with a jittered edge).
- `waystone`: a standing stone, one cell standing, its top cell a roof.
- `moor_map`: 20x12 cells, the floor a `fill mix=` of the three moor looks, two pools, three stones.
