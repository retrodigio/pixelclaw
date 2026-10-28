# Findings

From a fresh agent given only this folder, with the prompt: "Review the art in this folder by
following rubric.md in it. Read only the files inside the folder; do not run any programs."
Its report, as it came back. The findings were then pinned as notes on the pixels it pointed at,
fixed, and the notes closed (examples/scripts/*_review.pclaw).

---

The set is competent but not yet consistent. The chest is the best piece. The glowcap is the
weakest: it does not glow and has a stray mark on its stem. The grass tiles join without seams but
each has a few bright pixels that repeat visibly when tiled. The stone floor's mortar is
inconsistent and its moss patches repeat on an obvious grid.

## 1. Readability: 3/5
- **Chest (4/5):** At 1x on grass it reads at once as a domed chest, front-on, with a brass lock
  and iron straps. The wood is lit from the left, the right side is dark, and the ink outline
  separates it from the grass.
- **Glowcap (2/5):** The pale stem reads, but the cap is a dark, low-contrast brown blob close in
  value to the grass. Nothing tells a player this is a special "glow" cap: the `glow` colour in the
  palette is not used anywhere.
- **Edge contrast:** the outline is `ink` (L* about 8). It clears 15 L* against `moss1` (about 27)
  and `moss2` (about 41). Against `moss0` (about 17) it is only about 9.

## 2. Cohesion: 3/5
- Both props have a 1-px ink outline, so the outline rule is shared.
- The chest uses 4-5 ramp steps with clean highlights on the left. The glowcap uses about 3 muddy
  dark steps; it looks like it came from a different, flatter artist.

## 3. Seams and repetition: 3/5
- No visible seam lines on any of the four tiles.
- The repetition tells are single bright `lichen` pixels and a few over-regular marks, which land
  on an exact 24-px grid in the 3x3 (grass_c's yellow dots and a straight 4-px dark dash most).
- stone_floor: the saturated moss patches sit in the same three places in every tile, a diagonal
  grid of green spots across the 3x3.

## 4. Style-guide fit: 3/5
- Sizes and outlines are right; no off-palette colours by eye.
- The guide says props use `ruins-props` (wood and brass), "nothing else", yet the chest's straps
  and the glowcap's stem use the stone ramp. The guide should say which.
- Single `lichen` pixels on `moss2` are two ramp steps away, outside the guide's texture exception.

## 5. Defects: 3/5
- Glowcap: a hooked glyph on the stem, eye-like lichen dashes on the cap, shading that ignores the
  top-left light.
- Stone floor: the vertical joints are 1-px near-black slots while the horizontal mortar is a 2-px
  mid-grey band: two different materials.
- Chest: clean.

## Defect list
```
glowcap 10,16 5x5 "hooked dark-grey glyph on the stem reads as a letter or scratch; remove it"
glowcap 9,7 2x1 "lichen dash reads as an eye or noise"
glowcap 14,9 2x1 "second lichen dash, same problem; it pairs with 9,7 into a face"
glowcap 3,4 18x10 "cap is dark, flat and lit evenly; nothing marks this as a glowcap"
glowcap 9,15 6x7 "stem uses the stone ramp on a prop; confirm the props palette allows it"
chest 6,3 2x18 "iron strap in the stone ramp; fine if ruins-props includes the ground ramps"
grass 4,4 "single lichen pixel on moss2 is two ramp steps, a hotspot that repeats every 24 px"
grass 21,20 "same lone lichen pixel"
grass_b 14,8 "lone lichen pixel, two steps from moss2; repeats as a visible dot grid"
grass_b 6,18 "lone lichen pixel, same fix"
grass_c 14,23 "lone lichen pixel; the most visible repeating dot in the 3x3"
grass_c 5,18 "lone lichen pixel, same fix"
grass_c 12,8 4x1 "straight 4-px dark dash is the most regular mark in the tile"
stone_floor 16,10 3x4 "brightest moss patch, repeats on an exact lattice"
stone_floor 3,18 5x3 "moss clump on the same diagonal lattice"
stone_floor 8,0 1x4 "vertical joint in near-black, darker than the 2-px horizontal mortar"
```

What changed in response: the cap moved to the props' wood ramp with brass spots of three sizes
(the glowcap), the crack went, lone lichen dots became moss3, grass_c's dash broke up, the floor's
joints took the mortar's colour and its brightest moss patch went down a step. The style guide now
says what props may use, and the bundle's palette lists only the colours the art uses (it listed
the unused `glow` entry). Not done: the floor's moss lattice and its "wall more than floor" look
(a redraw of the G1 tile, for later); `moss0` against the outline only matters where a prop
stands on it, which none does.
