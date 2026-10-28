# Findings

From a fresh agent given only this folder, with the prompt: "Review the art in this folder by
following rubric.md in it. Read only the files inside that folder (the GIF files you may skip,
the anim/*.png contact sheets show the same frames); do not run any programs." Its report, as it
came back. The findings on the G6 art were then pinned as notes on the pixels it pointed at; the
soil dash, the thin moss and the dark boots were fixed and their notes closed
(examples/scripts/stone_floor_g6review.pclaw, walker_review.pclaw). The rest are left open for a
later polish pass (see the end).

---

The art is solid overall: both sprites read clearly and the animation timings follow the style
guide. The weakest areas are cohesion (the flat stone floor, and the chest's size next to the
figure) and repetition on the stone floor and water tiles.

## 1. Readability: 4/5
At 1x on grass the chest reads at once: rounded lid, iron straps, brass lock. The walker reads as
a person, and its front, back and side views are clear. Both have a full ink outline, which
separates them from the grass. Two weak spots: the boots are drawn in ink, so the feet merge into
the outline as a black lump. The side views are mostly hair, with only a sliver of face.

## 2. Cohesion: 3/5
- Lighting: the chest and walker are lit from the top left, while the stone floor flags are flat
  single-tone fills with no light at all.
- Scale: the chest is as tall as the walker (about 20 px each), so beside the figure it looks
  like a wardrobe.
- Polish: the chest is noticeably cleaner and more finished than the walker.
- Mirroring: west is a mirror of east, so the west figure is lit from the top right. The style
  guide asks for this, so it isn't a defect, but it is a visible inconsistency.

## 3. Seams and repetition: 3/5
No edge lines on any of the three tiles. Grass: the best; its brightest cluster near the top right
is the one mark you can spot repeating. Stone floor: its joints are allowed to repeat, but a
red-brown soil dash sits in the same spot in every tile and makes an obvious dotted grid in the
3x3. Water: almost every mark is a 2-3 px horizontal dash of the same size; in the 3x3 they form a
regular scatter with a faint diagonal weave.

## 4. Style-guide fit: 4/5
Colours, sizes, outlines, four directions of two frames at 12 ticks with west mirroring east, the
walker's frame changes (14 % and 25 %, inside 8-35 %), feet on row 22 with nothing sliding, and
the water's 4 x 15-tick loop with an even 17 % change including the wrap all match the guide.
Short of it: the floor doesn't show the top-left light; "half taken back by moss" barely appears
on the floor; the water marks don't vary in shape.

## 5. Defects: 4/5
No stray pixels on the props and no pillow shading. The chest's lid corners step 4-1-1. The ink
boots are a heavy black block. The floor flags are flat, airless areas.

## 6. Animation: 3/5
East/west: the walk reads as a stride, legs apart then passing. South/north: only the legs swap
(14 %); it reads as stepping in place. The four directions look like one figure and are easy to
tell apart. Water: a gentle drift with no hitch where it loops.

## Defect list
```
stone_floor 1,2 3x1 "soil1 dash floats mid-flag and is the most obvious repeated mark in the 3x3; move it into a joint, vary it, or remove it"
stone_floor 0,0 24x24 "flags are flat single-tone fills with no light; give each flag a lit top-left edge and a darker bottom-right edge"
stone_floor 6,13 3x1 "moss is two straight 1-px horizontal dashes (also 17,9 2x1); grow irregular moss clusters along the joints"
water 0,0 24x24 "nearly every mark is a 2-3 px horizontal dash of the same size; vary lengths (1-6 px), join some into longer ripple lines, leave some calm areas"
grass 15,0 7x8 "densest moss3 cluster in the tile; the one mark that repeats obviously in the 3x3"
chest 2,2 20x20 "chest is as tall as the walker and reads as furniture-sized beside him; shrink it to about 14-16 px tall"
chest 3,3 5x3 "lid corner steps 4-1-1 (mirrored at 16,3); use an even 3-2-1 curve"
walker 7,20 10x3 "boots are drawn in ink and merge with the outline; draw them in soil0/wood0 inside the ink outline"
walker 7,13 11x6 "in south/north frames only the legs change (14%); add arm swing or a 1-px body bob"
walker(E) 14,6 3x5 "side view shows a 1-2 px sliver of face under a large hair mass; widen the profile by a pixel"
```

---

## What was done

- **Fixed:** the floor's soil dash (gone; the joint is stone1 again) and its moss (four small
  clumps of moss1 and moss2 on joint pixels); the walker's boots (soil1, a step lighter, in every
  frame; frames 2 and 3 already had it).
- **Not done (left for polish, outside G6's list):** a lit edge on the flags (a bevel on every
  side is what made the G5 floor read as a wall; a top-left edge alone is worth trying), the water's
  dash lengths, the walker's arm swing and side-view face (notes n2 and n3 on the walker stay
  open), the chest's size and lid corners, and the grass's bright cluster.
