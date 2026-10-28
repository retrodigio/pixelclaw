# Findings: G7 review round (blind)

A fresh agent with no other context was given this folder and asked to follow `rubric.md`. Its
report, as given (it read the GIFs' frames with a small script of its own):

## Scores

1. **Readability: 4.** There are no sprites, so this applies only to the ground. Sand and water are very different in lightness, and the shore reads clearly at 1x and 2x. The weak spot is the glint's first frame: one water3 pixel on water1, which you can barely see.
2. **Cohesion: 4.** Sand and water use the same language of short marks, the palette is used the same way everywhere, and the shore band is drawn the same in every variant. All the pieces look like one set.
3. **Seams and repetition: 2.** Both tiles wrap with no seam line, but both repeat too obviously. Sand: the marks bunch in columns 0–5 and 17–23, with a near-empty strip down the middle; repeated, this gives plain squares framed by marks. A vertical line plus a light cross shows up on every tile, and marks pile onto the column 23/0 seam. Water: every crest is the same 2-pixel stamp, one on every even row, on a diagonal lattice that shows as diamonds in the 3x3.
4. **Style-guide fit: 3.** Palette and rounded corners are right. The "wet sand" is two rows of the darkest sand right against the base sand on every side, so it reads as a dark outline (the guide says tiles have no outline). The foam is an almost unbroken 1-pixel line, not the broken line the guide asks for. Most glints are staggered, but at about 1.5 s six of them flash within 150 ms.
5. **Defects: 3.** Stray foam pixels at the square corners of left-side convex corners; dark sand pebbles two shades from their neighbours; water marks that break up where a crest is drawn over a dash.
6. **Animation: 3.** Water: the loop is seamless, but only the crests move, all jumping 6 px right together every 15 ticks: a conveyor more than a shimmer. Glint: it grows dot, small plus, big plus, then vanishes at full size. Map GIF: its 4 s loop cuts four glints off mid-flash.
7. **Autotiling: 3.** Outer and inner corners are rounded and the edge is one consistent band all round, so the island reads as land. But each straight edge piece repeats pixel for pixel every 24 px; with the ruler-straight band and the dark outline, the tile grid shows along long coasts. The left corners have a foam stray the right corners don't.

## Defects

```
sand 6,9 11x15 "columns 6-16 are almost plain sand2 below row 9 while x0-5 and x17-23 are busy; repeated, it makes plain squares framed by marks (the tile grid). Move some marks into the middle and thin the edge columns"
sand 17,18 1x6 "6-px vertical sand1 line, with the sand3 cross at 21,21 beside it: a '|+' shape that repeats on every tile. Break the line into 2-3 px pieces and drop or shrink the cross"
sand 23,10 1x7 "column 23 (rows 10-16) and column 0 (rows 10,13,16) stack marks that meet across the tile edge, drawing a dotted line on every vertical seam. Move some of them off the edge"
sand 19,6 "sand0 pebble right against sand2 on three sides (two shades apart); give it a sand1 neighbour or lighten it to sand1"
sand 5,16 "sand0 pebble right against sand2 below and right (two shades apart); give it a sand1 neighbour or lighten it to sand1"
water 9,4 4x2 "every crest is this same 2-px crest over a 4-px trough (11 copies, one per even row); they line up in diamonds when tiled. Vary crest width (1-3 px), drop a few, break the every-other-row rhythm"
water 10,2 "lone water0 pixel touching the crest at 11,2, left over from a dash the crest covered; make it water1"
water 2,7 5x1 "frame 3: the crest's trough is drawn over the dash, leaving specks (also 0,13, 8,15, 14,17, 0,19 on frames 2-4)"
water 0,0 24x24 "all crests jump 6 px right together every 15 ticks while the dashes stay still; reads as a conveyor"
glint 0,0 5x5 "the loop ends on its largest frame (frame 3) and vanishes (100% change); add frame 2 then frame 1 after it so the flash fades out"
glint 2,2 "frame 1 is one water3 pixel on water1, barely visible; start on foam or skip the frame"
shore map 1,2 3,3 "stray foam pixel at the square corner, cut off from the rounded foam curve; remove it and close the curve (also map 4,1 and map 2,10)"
shore map 1,2 2,20 "foam pixel one column outside the shoreline at the bottom-left corner; remove it (also map 2,10)"
shore map 5,1 0,3 24x4 "top-edge piece repeats exactly along cols 5-9: the same foam gaps, flecks and bumps every 24 px show the grid. Add edge variants or let the waterline wander a pixel or two"
shore map 12,5 18,0 4x24 "right-edge piece is the same in rows 3-6: a ruler-straight 2-px sand0 band with foam gaps always in the same rows"
shore map 5,1 0,4 24x2 "wet sand is two rows of sand0 straight against sand2, the same on every side; at game scale it reads as a dark outline round the island. Make the strip sand1 with sand0 only at the waterline, wavy"
shore map 5,1 0,3 24x1 "foam is a nearly unbroken 1-px line; break it into 2-6 px dashes with gaps"
shore map 8,3 7,13 "glint peaks in the same frame as several others (about 1.5 s); spread their start times"
shore map 8,9 17,11 "glint is mid-flash when the 4-s map loop restarts and vanishes; end the glint schedule on a quiet frame or make its period divide the loop"
```

## What was done with them

The findings came back as notes on the pixels (map findings on the piece each tile is built from:
`ew` for the north and south edges, `ns` for east and west, `o` for the outer corners), then:

- **Shore** ([shore_review.pclaw](../../../scripts/shore_review.pclaw)): the band redrawn with the
  waterline one pixel of `sand0` and a wider strip of drying `sand1` (no dark outline); the long
  edges' foam broken into dashes, the waterline dipping and rising, the wet strip in lobes, placed
  differently on each of the four sides; the stray corner foam gone (the band redraw cleared it);
  the reviewed sand copied in again, and every variant followed. Notes closed. The island (16x12,
  seed 6) scores 0.18.
- **Sand** ([sand_review.pclaw](../../../scripts/sand_review.pclaw)): marks moved into the middle,
  the line and cross broken up, the seam columns thinned, the pebbles' dark sides given a `sand1`
  neighbour. Notes closed.
- **Glint** ([glint_review.pclaw](../../../scripts/glint_review.pclaw)): it starts on foam and fades
  out (a ping-pong, 1 2 3 2) instead of vanishing at its largest; another seed spreads the
  flashes. Notes closed.
- **Water** (G6's tile; [water_review.pclaw](../../../scripts/water_review.pclaw)): its three
  findings are pinned as open notes, polish for the water tile beyond G7's demo.
- **Left as they are**: every long straight shore still repeats its piece's detail every tile
  (one `ew` and one `ns` per family; the fix is texture variants and map hot spots, G8), and the
  map GIF's four-second loop can cut a sparkle mid-flash (a preview limit, not the art).
