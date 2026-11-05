# Drawing, checks and a blind review

This walkthrough has 2 parts:

1. [the drawing toolkit](#part-1)
2. [checks and in-context previews](#part-2)

## Part 1: the drawing toolkit<a id="part-1"></a>

The agent makes a seamless grass tile with two variants and a 24x24 chest sprite, using the
toolkit: generators with seeds, stamps, a macro, forks for variants, palette edits and locking,
ramps, shading, live symmetry, a layer, the lock detail and an outline. After each piece it looks
at the result in context and reads the grid view, the exact pixels, to check it.

You need Node 22.18 or later and pnpm. Build once, from the repo:

```sh
pnpm install
pnpm build
```

### With Claude Code

Register the server and open the watch link as in [watch-and-edit.md](watch-and-edit.md) (steps 1 and 2), then
ask Claude for the two pieces, for example: *Make a seamless 24x24 grass tile for the mossy
ruins, with two variants, and a 24x24 treasure chest with an outline, shading and a lock. Check
both in the grid view.* The scripts below are one way to do it; Claude writes its own.

### With the stand-in agent

```sh
node examples/toolkit-agent.ts            # --pause <ms> between batches (default 1500), --linger <s>
```

It starts `pixelclaw serve` on `out/toolkit.pclaw` exactly as Claude Code would, prints the watch
link (open it to watch), and runs the scripts in [examples/scripts/](scripts/) batch by batch:

1. **The grass tile** ([grass.pclaw](scripts/grass.pclaw)). Two stamps (a curved blade and a
   tuft, each as a paint block), and a macro `grass()` that fills the tile: a calm `noise` base on
   the moss ramp, a few soft darker patches, then `scatter` blades and tufts at least 5 and 10 px
   apart, and two lichen flowers. Every generator works with `wrap=on`, so the tile is seamless
   by construction. `call grass seed=11` draws it. The agent looks at `tile3x3` and prints the
   grid.

   ![The grass tile with wrap ghosts, its stamps, and the agent's 3x3 view](../docs/screenshots/toolkit-grass.png)

2. **Two variants** ([grass_b.pclaw](scripts/grass_b.pclaw), [grass_c.pclaw](scripts/grass_c.pclaw)).
   Each forks the grass tape after the macro is defined (`fork grass grass_b at=4`) and calls it
   with another seed. The agent compares the colour mix of the three from their grid legends:

   ```
   colour      grass  grass_b  grass_c
   moss1          47       48       55
   moss2         484      478      474
   moss3          43       48       45
   lichen          2        2        2
   ```

   ![A variant's 3x3 view, enlarged from Claude's eye](../docs/screenshots/toolkit-variants.png)

3. **The chest** ([chest.pclaw](scripts/chest.pclaw)). It adds wood and brass ramps to its own
   palette, locks the palette (no stray colours from here on) and saves it to the project as
   `ruins-props` for the next props. The body is a rounded lid (an ellipse over a rectangle) on a
   box of planks, lit with `shade light=nw ramp=wood`, with a light lid lip and a dark base. The
   iron straps go on their own `metal` layer, drawn once with `mirror x=11.5 live`, and lit from the
   same side. The lock is a paint block: a brass plate with a keyhole over the seam. Then the
   metal layer is merged down and `outline c=ink` draws the 1-px outline.

   ![The chest before the merge: the metal layer in the timeline, the palette locked](../docs/screenshots/toolkit-chest-layers.png)

   The grid the agent reads to check the lock and the straps (keyhole at 11,12 and 11,13, straps
   mirrored at 6-7 and 16-17, rivets at 6,14 / 17,14 and 6,18 / 17,18):

   ```
       0         1         2
       012345678901234567890123
    2  ........kkkkkkkk........
    3  .....kkkZZZZZZZYkkk.....
    4  ....kZ32YYYYYYYY32Yk....
   10  ..kZYY31YYYCCYYY31YYXk..
   11  ..kZZZ31ZZCDDCZZ31ZZXk..
   12  ..kXWW31WWCkDCWW31WWWk..
   13  ..kYXX31XXCkCCXX31XXWk..
   14  ..kYXX51XXXBBXXX35XXWk..
   20  ..kXWW21WWWWWWWW21WWWk..
   21  ...kkkkkkkkkkkkkkkkkk...
   ```

   ![The finished chest](../docs/screenshots/toolkit-chest.png)

The same four assets are checked in, in [examples/mossy-ruins.pclaw](mossy-ruins.pclaw) (with earlier
fixes on top since then: see [drawing-and-checks.md](drawing-and-checks.md)), with their
views (`views/grass.tile3x3.png`, `views/chest.render.png`, the grids); a test rebuilds them from
the scripts and checks the tapes, states and previews.

### In the watch view

Everything the agent does, you can do in the page, and every control writes a command:

- **Selections**: M (rectangle), Shift+M (ellipse), Q (lasso), W (magic wand; *whole colour* for
  all of a colour). Shift adds, Alt subtracts. Your selection is yours: it never clips the agent.
- **Transforms** in the options bar: flip ⇋ ⇵, rotate ⟳ (Shift+H, Shift+V, Shift+R), on your
  selection or your layer; the move tool and arrow keys shift it.
- **Symmetry**: mirror ⇹ ⇵ in the options bar, with dashed guides on the canvas.
- **Brush** size and shape for the pencil, eraser, lines and outlines.
- **Gradient** (Shift+G): colour A (click a swatch) to colour B (right-click a swatch) along their
  ramp, through your selection. **Dither** (D) with a pattern and level.
- **Outline** and **clean orphans** buttons.
- **Stamps**: save your selection as one, then place it with S.
- **Layers and frames** in the timeline under the canvas: add, move, merge, remove, and the hidden,
  locked and reference flags; frames with + / ✕ and [ ].
- **Wrap ghosts** around a tile: draw across its edges from the neighbouring copies.

![Live symmetry: the guide and a mirrored stroke on a sprite with a reference layer](../docs/screenshots/toolkit-symmetry.png)
![A wand selection plus a lasso being added](../docs/screenshots/toolkit-lasso.png)
![A gradient through the selection](../docs/screenshots/toolkit-gradient.png)
![A stamp from the selection, placed on frame 2](../docs/screenshots/toolkit-stamps-frames.png)

## Part 2: checks and in-context previews<a id="part-2"></a>

The agent checks its art against the project's style guide and fixes what the checks find, by
the coordinates they give, until every check is green; it looks at each piece in context (the
tile repeated 3x3, the sprite on its ground at game scale) and fixes what it sees there too.
First a test sprite with five deliberate defects, then the weak spots in the grass tiles and
chest and the stone floor. Last, a blind reviewer (a fresh agent that sees only a review
bundle) judges the set, and its findings come back as notes on the pixels.

You need Node 22.18 or later and pnpm. Build once, from the repo:

```sh
pnpm install
pnpm build
```

### The style guide

[mossy-ruins.pclaw/project.json](mossy-ruins.pclaw/project.json) gained a `style` section (the
palettes the art may use, the outline colour, the usual ground for sprites, the game's draw
scale, the sizes, and one exception: the laid stone floor's courses are its pattern, so it is not
held to the repetition check), and [style.md](mossy-ruins.pclaw/style.md) says the same in words.
The checks and their thresholds are in [docs/checks.md](../docs/checks.md).

### With Claude Code

Register the server and open the watch link as in [watch-and-edit.md](watch-and-edit.md) (steps 1 and 2), then
ask, for example: *Check every asset. Fix what fails by the coordinates the checks give, until
everything is green, and look at each tile's 3x3 and each prop's game view: fix what still looks
wrong. Then write a review bundle and have a fresh agent review it blind.*

### With the stand-in agent

```sh
node examples/checks-agent.ts            # --pause <ms> between batches (default 1500), --linger <s>
```

It starts `pixelclaw serve` on `out/checks.pclaw` exactly as Claude Code would, prints the watch
link, rebuilds the earlier art from its scripts, and then works through the scripts in
[examples/scripts/](scripts/) (`*_fix.pclaw`, `*_review.pclaw`) batch by batch, printing the check
summary after each.

#### 1. A test sprite with five deliberate defects

[glowcap.pclaw](scripts/glowcap.pclaw) draws a mushroom with one defect per check: the cap shaded
in rings (pillow shading), spots in a colour from outside the style guide, a crack drawn freehand
with doubled corners, the outline painted over down the cap's right side, and three stray specks.
The summary after the last batch:

```
checks: palette 4 ✗ · orphans 1.2% ✗ · jaggies 5 ✗ · banding 0.85 ✗ · outline 0.78 ✗ · coverage 0 ✓ · readability 1 ✓  (5 failing: `check` gives coordinates)
```

`check` gives each failure with its pixels:

```
glowcap: 5 of 7 checks failing
  ✗  palette     4      ≤ 0     4 px outside the style palettes (mossy-ruins, ruins-props): glow #ff4fd8 is not in the style palettes (4)
       glow #ff4fd8 is not in the style palettes: 9,7 10,7 14,9 15,9
  ✗  orphans     1.2%   ≤ 1%    3 stray px in 245 (3 lone, 0 near-orphans)
       lone pixel (no neighbour shares its colour): 6,2 20,20 3,21
  ✗  jaggies     5      ≤ 0     5 doubled L-corners, 0 irregular step runs, 0 spikes, 0 notches
       doubled L-corner: 8,4 15,4 6,5 8,5 15,5 5,6 6,6 7,6 16,6 4,7 5,7 6,7 7,7 16,7 17,7 11,16 11,17
  ✗  banding     0.85   ≤ 0.5   ramp soil: 58 ramp steps along the outline; inward west +1, top +0.85, east +1, bottom +1 (the same on every side: light one side and shade the other)
       pillow shading in ramp soil: it gets lighter inward on every side: 9,4 10,4 11,4 …
  ✗  outline     0.78   ≥ 0.85  43 of 55 silhouette edge px are ink; 12 gaps
       silhouette edge not in the outline colour (ink): 6,2 18,5 19,6 20,7 21,8 21,9 21,10 20,11 19,12 18,13 20,20 3,21
```

(The cap's rings also count as jagged: thin bands of colour stepping with doubled corners.)

![The test sprite in the watch view: five red chips; the outline's gaps and the strays circled](../docs/screenshots/checks-chips.png)

In the watch view, *📌 note* under a check pins its pixels as notes for the agent, one per cluster:

![The outline's gaps pinned as notes](../docs/screenshots/checks-pin-note.png)

[glowcap_fix.pclaw](scripts/glowcap_fix.pclaw) fixes it by those coordinates: the specks go, the
outline's gaps are inked, the crack's doubled corner at 11,16 goes, the cap is flattened to one
tone and lit from the top left (`shade light=nw`), the spots come back in lichen. Green after
that pass, the cap was still flat, so it gets a broad highlight on the lit side and a shadowed
underside; that left one stray at 8,14, which the next summary caught. All seven checks pass.

#### 2. The weak spots in the art and the floor

`check` with no asset, before:

```
chest: palette 0 ✓ · orphans 2.4% ✗ · jaggies 0 ✓ · banding 0 ✓ · outline 1 ✓ · coverage 0 ✓ · readability 1 ✓
grass: palette 0 ✓ · orphans 0.7% ✓ · jaggies 0 ✓ · seam 0.39 ✓ · coverage 0 ✓ · repetition 3.4 ✗
grass_b: palette 0 ✓ · orphans 0.9% ✓ · jaggies 1 ✓ · seam 0.98 ✓ · coverage 0 ✓ · repetition 4.1 ✗
grass_c: palette 0 ✓ · orphans 1.7% ✓ · jaggies 1 ✓ · seam 0.59 ✓ · coverage 0 ✓ · repetition 3.3 ✗
stone_floor: palette 0 ✓ · orphans 2.4% ✗ · jaggies 1 ✓ · seam 1.68 ✗ · coverage 0 ✓
```

- **The grass tiles** ([grass_fix](scripts/grass_fix.pclaw), [grass_b_fix](scripts/grass_b_fix.pclaw),
  [grass_c_fix](scripts/grass_c_fix.pclaw)). Each had one row of marks lighter or darker than
  the rest, which repeats as a stripe across a tiled floor: in grass_b, seven dark marks along row
  1 (`0,1 3,1 12,1 13,1 19,1 22,1 23,1`), the "faint rows" the first draft left. The fixes move a few marks
  between the busiest and the calmest rows (each mark moves its row's lightness by about 0.6 L*)
  until the most visible stripe is under 3. Green, but the 3x3 still showed the three tufts as the
  same V on a lattice (all one stamp), so each tuft loses a different blade tip and a pixel of its
  root.

  ![grass_b's stripe: the dark marks on row 1, on the canvas and in the 3x3 preview](../docs/screenshots/checks-repetition.png)

- **The chest** ([chest_fix](scripts/chest_fix.pclaw)): nine strays, all in the straps. The
  rivets were single pixels (each is now a head across the strap) and the straps' ends were lone
  greys (they carry the strap's edge on).
- **The stone floor** ([stone_floor_fix](scripts/stone_floor_fix.pclaw)): its moss flecks were
  single pixels of four tones (now small clumps), and the tile's edge ran along a course of stone
  tops, a line at every seam (`seam 1.68`): `shift 0,4 wrap` puts the seam inside the stones
  (`0.72`).

After: every asset, every check green (`check` exits 0; `examples/mossy-ruins.pclaw` is checked
in at this point, with the review round below).

#### 3. A blind review

`review` writes reviews/<date>-checks/: each asset
enlarged with rulers and at game scale, the tiles 3x3, the props on their ground, the palette,
the style guide and a rubric. It names no method or author. A fresh agent was given only the
folder ("Review the art in this folder by following rubric.md"); its report is kept beside it as
its findings. It found what no check
measures: the glowcap's cap is close in value to the grass and nothing says *glow*, its crack
reads as a letter and its two spots as a face; single lichen pixels in the grass repeat as a dot
grid; a straight 4-px dash gives grass_c's repeat away; the floor's vertical joints are darker
than its mortar. It also found two of the tool's own faults: the bundle's palette listed an entry
no pixel used, and the style guide was unclear about what props may use. Both are fixed.

The `*_review.pclaw` scripts pin each finding as a note where the reviewer pointed, fix it, and
close the note: the glowcap's cap moves to the props' wood ramp with brass spots of three sizes,
the lichen dots soften to moss3, the dash breaks up, the joints take the mortar's colour. Every
check is still green.

![The glowcap after the fixes and the review: every chip green, the game view in the preview](../docs/screenshots/checks-fixed.png)

### In the watch view

- **Check chips** in the header, computed in the page with the project's style guide (the same
  answers as the agent's `check`, and they follow time travel). Click one to circle its pixels
  and open its details; *📌 note* pins them for the agent.
- **Preview** (right): the 3x3 for tiles, the game view for sprites (on the ground at 1x and 2x,
  beside the set), and the art under every preview theme.
- **Role colours** (recolourable art): double-click a swatch to give it a role; a **theme** menu
  under the palette shows the canvas under a theme, writing nothing.

  ![Role art under the project's lantern theme, and under every theme in the preview](../docs/screenshots/checks-themes.png)

- On narrow windows the side panels narrow, the toolbar's labels shorten and the options bar keeps
  its groups on one row:

  ![The watch view at 1100 px wide](../docs/screenshots/checks-narrow.png)

Screenshots: `node scripts/screenshots-checks.ts`.
