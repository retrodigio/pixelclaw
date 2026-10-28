# Checks

Every check reads an asset's flat art and returns a score, pass or fail against a threshold,
and the pixels it flags (plan §5). The checks of one image run on **every frame** (since G6): the
result is the worst frame's, its detail starts `frame N:`, and every flagged pixel names its
frame (the watch view and marked images circle those on the frame shown). `coverage`, `anim` and
`views` look at the whole document at once. Thresholds come from the project's style guide
(`project.json` `style.checks`), with the defaults below. Checks never change the document; the
server, the CLI and the watch view compute them with the same code from the same style guide, so
they always agree.

- MCP: every `run` result ends with a one-line summary (over every frame; on a large canvas,
  above 262,144 pixels counting every frame, only the frame being drawn on, and the detail says
  so: `check` always covers every frame); `check(asset)` gives the table with
  coordinates and an image with the flagged pixels circled in magenta; `check()` without an
  asset gives one line per asset. `view(..., marks="failing")` circles them on any view.
- CLI: `pixelclaw check <project> [asset...] [--checks a,b] [--frame N] [--ground g] [--ref r]
  [--marks]` prints the table and exits 1 if anything fails; `run` prints the summary.
- Watch view: a chip per check in the header. Click one to circle its pixels on the canvas and
  open its details; *📌 note* pins its flagged pixels as notes for the agent (one per cluster).

| Check | Applies to | Score | Default threshold | What it flags |
|---|---|---|---|---|
| `palette` | all | pixels outside the allowed colours | ≤ 0 | Pixels whose colour is not in the style palettes (`style.palettes`; unset: any colour of the document's palette). In role art, pixels that are not a role. |
| `orphans` | all | stray pixels per 100 opaque pixels | ≤ 1 (tiles ≤ 2) | Lone pixels (no 8-neighbour shares the colour) and diagonal pairs. A pixel on a diagonal line is not a stray. On tiles a stray one ramp step from its surroundings is texture and allowed. |
| `jaggies` | all | defects | ≤ 0 (tiles ≤ 2) | Doubled L-corners (a line zig-zags through a corner a pixel-perfect line would step diagonally past), irregular step runs (a run longer or shorter than both neighbours by 2 or more: 1-2-1-3), and on sprites spikes and notches on the silhouette. On tiles the ground colour between marks is not a line. |
| `banding` | sprites | pillow share, 0 to 1 | ≤ 0.5 | Pillow shading, per material (ramp): ramp steps that follow the outline and get lighter (or darker) inward on every side alike. Light from one side makes the sides disagree. |
| `outline` | sprites | share of the silhouette edge in ink | ≥ 0.85 | Edge pixels not in the outline colour (`style.outline`, else entries named ink, outline or black; in role art the `black` role). |
| `seam` | tiles | the pilot's metric (below) | ≤ 1 | The edge columns or rows that stand out. |
| `coverage` | all | missing items | ≤ 0 | A size other than the style's (`style.sizes`), a size that is not whole cells, empty frames, empty cells of a sheet. Autotile names come with schemes (G7). |
| `readability` | sprites | edge contrast share | ≥ 0.8 | Edge pixels within ΔL* 15 of the ground under them (the usual ground tile, repeated). Also: the silhouette's IoU with each asset of its set (≤ 0.9), and the lightness spread inside (L* p95 − p5 ≥ 25). |
| `revert` | with `ref=` | share of pixels unchanged from the reference | ≤ 0.15 | Pixels with the same colour as the reference asset at the same place. |
| `repetition` | tiles | ΔL* × √width of the worst band | ≤ 3 | The most visible stripe when the tile is repeated: a band of 1 to 6 rows (or columns) lighter or darker than the rest. Flags the marks that make it. |
| `anim` | 2 frames or more | the worst frame-to-frame change | 8–35 % (tiles 3–35 %) | Per sequence (tags, views; mirror views are their source): **frame diff** (changed pixels over the union of both silhouettes; the pilot's good pairs changed 16-19 %): too little (a held frame or one that barely moves) or too much (a jump), flagging the changed pixels; the **loop seam** of a cycle (last frame back to the first) in the same band; sprites also: **pivot drift** (the silhouette's centre column moving by more than 1 px between frames: it slides), **ground drift** (the lowest row off the ground line, or off the first frame's: it floats or sinks; 0 px), and **area jumps** (the silhouette growing or shrinking by more than 15 %). Thresholds `minDiff`, `maxDiff`, `maxPivot`, `maxGround`, `maxArea`. |
| `views` | 2 views or more | the least difference between two views | ≥ 20 % | Directions that look too alike (the pilot's player directions did): each pair of views is compared on its first frame, by colour over both silhouettes. Mirror views count as their source, and views facing each other left to right (E and W) are not compared. |

Checks that do not apply are skipped (seam on a sprite, outline on a tile, revert without a
reference), as are checks a style guide turns off.

## The seam metric

Exactly the pilot's (plan §13). Tile the art 3x3 into an image of class indices (palette entries;
transparent its own class, grey 0); each class has a grey value, its Rec. 601 luma (0-255). For
the x axis, with tile width `t` and image width `W`:

- `mis[k]`: the share of rows where column k differs from column k+1, k = 0..W-2.
- Border pairs are k = t-1, 2t-1, ...: `jump = (mean(mis[border]) - mean(mis[other])) /
  (std(mis[other]) + 0.02)` (population std).
- `colm[x]`: the mean grey of column x. Touching columns are x = t-1, 2t-1, ... and t, 2t, ...,
  except x = 0 and W-1: `line = |mean(colm[touching]) - mean(colm[other])| / (std(colm[other]) + 2)`.
- The y axis is the same on the transpose; `seam = max(jx, jy, lx, ly, 0)`. About 1 or less reads
  as no seam.

Hand-checked in `core/test/checks.test.ts`: a solid tile scores 0; an 8 px tile with a one-pixel
ink frame scores `line = 0.9d / (0.3d + 2)` (d = the ink columns' grey against the others'), 2.6447
in the test palette; a tile half moss, half leaf scores `jump = (1 - 1/7) / (sqrt(1/7 · 6/7) +
0.02)` = 2.3171; random noise stays under 1.

## The style guide

`project.json`:

```json
"style": {
  "palettes": ["mossy-ruins", "ruins-props"],
  "outline": ["ink"],
  "ground": "grass",
  "drawScale": 2,
  "sizes": { "tile": "24x24", "sprite": "24x24" },
  "checks": { "orphans": { "max": 1.5, "tile": { "max": 3 } }, "jaggies": { "off": true } },
  "assets": { "stone_floor": { "checks": { "repetition": { "off": true } }, "ground": "...", "set": ["..."] } }
},
"themes": { "lantern": { "light": "#f2d27a", "dark": "#b0702c", "darkest": "#4a2410" } }
```

Each check's parameters merge in this order: the defaults for every kind, the defaults for the
asset's kind, `style.checks.<check>`, `style.checks.<check>.<kind>`, then
`style.assets.<asset>.checks.<check>`. The parameter names are the ones in the table (`max`,
`min`), plus `off`, and for some checks more: `orphans.texture` (allow one-step strays),
`banding.minEdges`, `readability.delta`, `readability.maxIou`, `readability.minSpread`. The server
reads `project.json` again when it changes, and tells the watch view.

`style.md` beside it is the style guide in words, for people and for prompts; the review bundle
includes it.

## The review bundle

`review(assets?, name?)` (CLI: `pixelclaw review <project> [asset...] [--name set]`) writes
`reviews/<date>-<set>/`: each asset enlarged with rulers (for coordinates) and at game scale,
tiles repeated 3x3, sprites on their ground beside their set, the colours the art uses, the style
guide and `rubric.md` (readability, cohesion, seams and repetition, style-guide fit, defects with
coordinates in the form `<asset> <x>,<y> [<w>x<h>] "text"`). It names no method or author and
holds no tape, so the reviewer judges blind. The tool calls no model: hand the folder to a fresh
agent with no other context, and pin its findings on the pixels with `note` commands. The demo's
round is in [examples/demo-g5.md](../examples/demo-g5.md).
