# Blind review, G10 (2026-10-28): clay, urn, kiln

A fresh-context agent was given only the review bundle (`reviews/2026-10-28-g10/`, copied to a
neutral folder) and asked to follow `rubric.md`. Its report, verbatim:

---

**1. Readability: 4.** The kiln reads at a glance as a bottle kiln: a tall bottle shape with a glowing mouth that clearly marks its front. The urn reads as a squat pot with a dark rim. Both edges are clear because of the ink outline. However, both bodies are filled mostly with clay2, the same colour as the ground. At 1x on the clay, each sprite reads mainly as an outline with ground colour inside, and the kiln looks more like a plain clay bottle than fired brick.

**2. Cohesion: 4.** They look like one set: the same palette, the same 1-px ink outline, light from the top left, and the same rim treatment (clay4 on top, dark underneath). Two small differences: the urn uses clay0 under its rim and a clay4 highlight on its body, while the kiln uses clay1 under its rim and no colour above clay3 on its body. The kiln's far-side shading on the shoulder is also drawn differently from the rest of the set (see the defects).

**3. Seams and repetition: 3.** There are no hard seam lines. But the bottom five rows of the tile are much busier than the rest, so the 3x3 shows a horizontal band along the bottom of every tile. The three pebbles have the same shape and sit on an even diagonal, so they repeat as an obvious grid of grey dots. A light mark sits on the tile corner, which marks the grid at every corner.

**4. Style-guide fit: 4.** Only palette colours are used, the outline rule is followed, the light comes from the top left, and the heights are right (urn 14 px, kiln 44 px, kiln on the bottom row). The tile breaks the cluster rule: its bottom band is single-pixel noise rather than clusters of 2-6 pixels, and the pebbles are on a lattice. The urn's base sits one row above the bottom of its cell.

**5. Defects: 3.** There are doubled ink corners on the urn, a false second outline on the kiln's shadow side, a hard angle at the kiln's shoulder, flat body fills, and noise on the tile. They are listed below.

**6. Animation:** does not apply (no animated assets). **7. Autotiling:** does not apply (no autotile sets). **8. Scenes:** does not apply (no scenes).

```
clay 0,19 16x5 "bottom band of alternating clay1/clay3 single pixels (13,20 14,20 15,20; 7,21 8,21 9,21) is noise, not 2-6 px clusters, and makes every tile's bottom denser than the rest, which shows as a horizontal stripe in the 3x3; merge it into two or three cracks and move some marks into the bare rows 7-8, 11-12 and 17"
clay 5,13 3x2 "the three pebbles (5,13 / 12,9 / 21,4) all have the same pale-top-left, dark-bottom-right shape and sit on an even diagonal, so tiled they form a regular grid of grey dots; vary their size and shape and break the spacing"
clay 21,2 3x1 "light clay3 mark wraps around the tile corner ((21-23,2), (0,2), (23,23)-(23,1)), which marks the grid at every corner in the 3x3; move it off the corner"
clay 2,23 2x1 "the crack at (2-3,20-23) is cut off at the bottom edge, and (2-3,0) above it is plain clay2; continue it into rows 0-1 or end it at row 22"
clay 9,6 4x1 "cracks are straight horizontal dashes (also 5,10 3x1 and 18,13 2x1) and read as streaks; give them a kink or branch so they read as fine cracks"
urn 8,12 "doubled corner: an extra ink pixel inside the outline under the rim (with 7,12); make it clay3"
urn 15,12 "doubled corner under the rim (with 16,12); make it clay1"
urn 8,20 "doubled corner: ink L-shape with 7,20 and 8,21 squares off the base; make it clay2"
urn 15,20 "doubled corner: ink L-shape with 16,20 and 15,21; make it clay1"
urn 14,13 5x3 "the upper right of the body is plain clay2 ((16,13) and (14-18,14-15)); the clay1 far-side shade only starts at 18,16; carry it up the right edge"
urn 5,13 14x8 "the body is mostly flat clay2, the ground's own colour, so at 1x on the clay it reads as an ink ring; widen the clay1 shadow to 2-3 px on the right and bottom and the clay3 lit side on the left"
urn 9,22 6x1 "the base ends at row 22, so the urn floats one row above its cell's bottom while the kiln stands on its last row; move it down 1 px"
kiln 15,12 7x16 "the far side on the shoulder is a 1-px clay1 line with a clay2 column between it and the ink (15,12-13; 16,16-17; 17,18-19; 18,20-21; 19,22-23; 20,24-25; 21,26-27), which reads as a second outline; make that column clay1 so the shadow is solid, as on rows 14-15 and 28-46"
kiln 1,24 2x3 "the 2:1 cone meets the vertical wall at a hard angle (2,24-1,26, and 21,24-22,26 on the right), so the bottle looks like a cone on a box; round the shoulder with longer steps (3-4 rows) for the last steps"
kiln 4,8 16x16 "no brickwork on the neck or cone; mortar dashes only start at row 24, so at 1x the kiln reads as plain clay, not fired brick; continue offset courses up the body"
kiln 4,26 16x13 "the body is flat clay2, the same as the ground, so it separates only by its outline; shift the brick toward clay1 or clay0 with clay2 mortar so the kiln stands out from the clay"
kiln 7,5 10x2 "the rim highlight is symmetric: the right end (15-16,5-6) is as light as the left; darken the right end to clay2, and consider a clay0/ink opening on top so it reads as an open chimney, not a capped bottle"
```

Nothing else in the three assets needs fixing. The kiln's fire-mouth (8,39 8x8) is centred and reads well.

---

## What was done

Every finding was pinned as a note on its pixels, fixed by coordinates and closed:

- **clay**: the bottom band is one crack (ending at row 22) and one cluster; the corner mark is
  gone; the long crack kinks; one pebble is removed, one shrinks to two pixels, one new one sits
  off the diagonal; marks fill the bare rows. The two short cracks already step down a row, so
  they stay. Repetition 2.6, seam 0.33.
- **urn**: the doubled corners are gone, the lit side and the far side and bottom are two to three
  pixels deep, and the urn stands on the cell's bottom row. The stepped shading bands of the round
  belly count as two doubled corners for `jaggies`; the style guide allows two on the urns (their
  outline stays clean).
- **kiln**: redrawn by the reviewer's points: clay1 brick with clay2 mortar in staggered courses
  up the cone and neck, a solid two-pixel far side, the shoulder rounded in three-row steps, the
  lip darker on the right with the chimney's mouth open on top.
