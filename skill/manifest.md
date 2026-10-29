# The manifest (manifest.json)

The asset plan a project is built from. Write it with the `plan` tool (`plan(manifest=…)`) or
`pixelclaw plan <project> --manifest <file>`; either checks it against the schema first and writes
nothing when it has problems (each reported with its path, like `assets[3].size`).

```json
{
  "format": "pixelclaw-manifest",
  "version": 1,
  "theme": "One paragraph: the game's place, mood, light and materials.",
  "sets": {
    "ground": { "description": "floors and terrain" },
    "props": { "description": "things that stand on the ground" }
  },
  "export": { "profile": "png" },
  "assets": [
    { "name": "clay", "kind": "tile", "size": "24x24", "set": "ground", "description": "packed red clay", "flat": "clay2" },
    { "name": "bank", "kind": "family", "size": "24x24", "set": "ground", "scheme": "blob47", "inside": "clay", "outside": "grass", "band": "2:outside 1:ink 2:clay0 radius=2" },
    { "name": "urn", "kind": "sprite", "size": "24x24", "set": "props", "height": 14, "description": "a squat glazed urn" },
    { "name": "urn_blue", "kind": "sprite", "size": "24x24", "set": "props", "recolourOf": "urn", "height": 14 },
    { "name": "potter", "kind": "sprite", "size": "24x24", "set": "folk", "frames": 2, "ticks": 12, "views": ["S", "N", "E", "W"], "mirror": { "W": "E" }, "height": 21 },
    { "name": "kiln", "kind": "object", "size": "48x48", "set": "props", "cells": "2x1", "height": 44 },
    { "name": "hollow", "kind": "map", "size": "40x30", "uses": ["bank", "kiln", "urn"] }
  ]
}
```

| Field | For | Meaning |
|---|---|---|
| `name` | all | a-z, 0-9, `_`, `-`; unique; the asset's name |
| `kind` | all | tile, sprite, sheet, icon, family, overlay, object, map, font |
| `size` | all | pixels `WxH` (a family: its tile, square and even; a map: cells `CxR`; a font: a glyph cell) |
| `set` | all | the group it is judged, reviewed and shown with (default: its kind); must be in `sets` when `sets` is given |
| `description` | all | what it is meant to read as (the reviewer's brief shows it) |
| `palette` | all | a project palette (default: the project's) |
| `scheme`, `inside`, `outside`, `band` | family | the autotile scheme (built in or `schemes/*.json`), the tiles on each side, the band profile |
| `frames`, `ticks` | animated | frames (per view), ticks per frame |
| `views`, `mirror` | sprite, object | directions (S, N, E, W) and mirrors (`{ "W": "E" }`) |
| `cells` | object | the footprint in cells `CxR` |
| `height` | props, figures | the drawn shape's height in pixels; `consistency` holds the art to it (± 2) |
| `variantOf`, `recolourOf` | all | a texture variant or a palette-swap recolour of another planned asset of the same kind |
| `uses` | map | the assets it is built from |
| `flat` | all | its colour in the flat templates: a palette entry name or `#rrggbb` |
| `chars` | font | its characters (the characters themselves, or `"32-126"`, `"U+0041-U+005A"`) |

Scenes (optional, top level): `"scenes": [{ "name": "kiln_yard", "description": "…", "uses":
["clay", "urn", …], "map": "hollow" }]`: the places the game shows, the assets each needs, and the
map document that builds it (its own `uses` count too). The dashboard shows each scene's missing
assets; `plan(order="scene")` lists the work scene by scene.

What the manifest gives the tools:
- `new <kind> <name>` with no size, palette or scheme takes them from the asset's entry (and an
  object's cell grid is the project's grid); the line records them, so replay never reads the
  manifest.
- `consistency` compares an asset with the rest of its set (like with like: ground tiles, figures,
  icons) and with its `height`; plan icons as one set so they share a stroke weight and box fill; a set's check
  thresholds can be set in `project.json` `style.sets.<set>.checks`.
- `map gen …` on a map the manifest plans stands the objects its `uses` lists (drawn objects and
  sprites, once each) on the generated ground; the line records them as `objects=… fp=…`.
- `review(set=…)` reviews a set's drawn assets, with a brief from the theme and descriptions.
- `plan(templates=true)` draws `templates/mockup.png` (one game screen in flat colours, the
  camera's size), `mockup@2x.png` (labelled) and `mockup.txt`, and `<family>.coverage.png|txt`
  (every variant of the scheme laid out in flat colours, to paint over or cut from).
