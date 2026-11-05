# Export profiles, import and densities

A profile is a JSON file that says how a game wants its art: what every image is called, how the
images are laid out (loose files, an atlas page with records, sheets, Tiled or Godot tile sets,
Aseprite files), which density levels it reads, the colours role entries are written as, and the
text entries (snippets) it wants beside the art. Game-specific knowledge lives in profiles, not in
the tool. The same profile reads its files back: **exporting and then importing
gives the same palette indices**.

- Built-in profiles: `png`, `atlas`, `tiled`, `godot`, `aseprite-json`, `aseprite`
  (`core/profiles/*.json`).
- A project's own profiles: `<project>/profiles/*.json`, and any paths listed in `project.json`
  `profiles` (a profile kept with the game, outside the project).
- The sample profile `examples/mossy-ruins.pclaw/profiles/bramble.json` writes for an invented
  engine, "Bramble", and uses every feature below.

```
pixelclaw export <project> [<asset>...] [--profile <name|file.json>] [--out <dir>]
pixelclaw import <project> <folder> --profile <name>
```

MCP: `export(profile, assets?, dest?)`, `import(path, profile?)` (see [mcp.md](mcp.md)).

## The format

```json
{
  "format": "pixelclaw-profile",
  "version": 1,
  "name": "bramble",
  "description": "…",
  "layout": "atlas",
  "include": ["sprite", "tile", "house"],
  "exclude": ["stone_floor"],
  "names": { "single": "{asset}", "frame": "{asset}_{n}", "view": "{asset}_{view}{n}", "piece": "{asset}_{cx}_{cy}", "start": 1 },
  "autotile": { "blob47": { "names": { "o": "{asset}_lone" }, "template": "{asset}_{sides}{corners}", "sides": "nsew", "corners": "nw,ne,se,sw" }, "path": { "template": "{asset}_{sides}", "shapes": { "end": "{asset}_end_{sides}" } }, "*": { "template": "{asset}_{variant}" } },
  "variants": "frames",
  "mirrors": "flag",
  "oversized": "sprite",
  "roles": { "black": "#000000", "white": "#ffffff", "light": "#c8c8c8", "dark": "#707070", "darkest": "#2a2a2a" },
  "colours": { "ink": "black", "moss2": "dark", "stone4": "#a0a0a0" },
  "density": { "levels": [1, 2, 4], "plain": 1, "suffix": "@{d}x", "reduce": true, "reducer": "ink-vote", "ink": ["ink"], "share": [1, 4] },
  "page": { "name": "bramble", "file": "{page}.png", "width": 384, "padding": 1, "trim": true, "columns": 8 },
  "records": { "format": "csv", "file": "{page}.csv", "header": true, "columns": ["sprite", "x", "y", "w", "h", "cropX", "cropY", "frameW", "frameH", "pivotX", "pivotY"] },
  "image": "{name}.png",
  "snippets": { "file": "entries.txt", "header": "…", "footer": "…", "join": "\n", "templates": { "sprite": "…", "tile": "…", "family": "…", "object": "…", "default": "…" } }
}
```

Only `name` and `layout` are required.

| Field | Meaning | Default |
|---|---|---|
| `layout` | `loose` (one PNG per image), `atlas` (one page per density with records), `sheet` (one sheet per asset), `tiled`, `godot`, `aseprite-json`, `aseprite` | — |
| `include`, `exclude` | Asset names or kinds. Density copies are never exported on their own (they are their base's levels). | every asset; maps only for `tiled`; families only for `godot` |
| `names` | Templates for an image's name (below). `start` is the first number of a numbered set. | `{asset}`, `{asset}_{n}`, `{asset}_{view}_{n}`, `{asset}_{cx}_{cy}`, 0 |
| `autotile` | Per scheme name (or `*`): `names` maps a variant (or `inside`, `outside`) to a template; other variants use `template` when their name is side letters plus corners. `sides` orders the side letters; `corners` orders the corner suffixes, the four of `ne,se,sw,nw` comma-separated (`nw,ne,se,sw` writes `nesw_nw_ne_se_sw`; default: as the variant name has them). `shapes` gives a template per shape of a side-letter variant, by its joined sides: `lone` (none), `end` (one: a path's dead end), `straight` (two opposite), `corner` (two beside), `tee` (three), `cross` (four); a shape without one uses `template`. So a path's dead ends are named apart from its straights. | `{asset}_{variant}`, `{asset}_inside`, `{asset}_outside` |
| `variants` | Texture variants (`variant of=`): `frames` numbers them after their base's frames (`moss_1`, `moss_2` for moss; `moss_3`, `moss_4` for moss_b); `names` exports each under its own name. | `frames` |
| `mirrors` | Mirror views (`view W mirror=E`): `bake` writes their flipped frames; `flag` leaves them out and marks the source's images (`mirror` column, `{mirror}` in snippets) for an engine that flips at draw time. | `bake` |
| `oversized` | Assets larger than one cell or with a footprint: `sprite` writes one image with its footprint and pivot in the records; `split` writes one-cell pieces named by `names.piece`. | `sprite` |
| `roles` | The colour each role (`black`, `white`, `light`, `dark`, `darkest`) is written as. Import reads those colours back as the role entries. Two entries written as one colour are reported. | the entries' own colours |
| `colours` | A per-colour output map: a palette entry (by name, or `<palette>.<entry>`) to `#rrggbb` or a role (written as `roles` gives it, which must give it). An engine that draws in tones is targeted by mapping each colour to its tone, without a script. Over `roles`. Import reads the colours back; entries written as one colour are reported and read back as the first. | none |
| `density` | The levels written (each exactly d times the base frame). File names get `suffix` except at the `plain` level. A level with an authored copy (`density of=`) uses it; else, with `reduce`, the highest authored copy above it is reduced with `reducer`; else the base is scaled up (nearest neighbour). Notes say which. | `[1]` |
| `page` | Atlas: the page's name and file, its width at 1x (times d per level), padding between images, and whether images are trimmed to their opaque pixels. Sheets: `columns` (a family keeps its own sheet layout). | `atlas`, `{page}.png`, 256, 1, trim on |
| `records` | `csv` or `json` beside a page (or a sheet, or loose files), the file template and the columns. | atlas: CSV, `{page}.csv`, the columns below |
| `image` | Loose and sheet file names: `{name}` (loose) or `{asset}` (sheet). | `{name}.png`, `{asset}.png` |
| `fonts` | Fonts: `format` `strip` (a glyph strip `{asset}.png` and its characters `{asset}.txt`), `bmfont` (`{asset}.fnt` and `{asset}_0.png`), `both`, or `sheet` (the glyph sheet as an ordinary image); `separator`, the strip's separator colour; `maxLine`, the line-height limit (an export over it is noted). | `strip`, `#ff0000` |
| `snippets` | One text file; a template per asset kind (`sprite`, `tile`, `object`, `overlay`, `icon`, `sheet`, `font`), `family`, or `default`. | none |

Icons are written in their export mode: `tone` icons through `roles` like any role art,
`full` and `channel` icons in their palette colours exactly as drawn. The record column `mode` and
the snippet variable `{mode}` give an icon's mode (empty for other kinds).

### Templates

`{var}` is replaced; `{{` and `}}` are literal braces (a Lua table is `{{ … }}`); any other `{` is
literal. An unknown placeholder is an error when the profile loads.

Image names: `{asset}` (the asset, or the base of a variant set), `{n}` (the number in a numbered
set), `{view}` (lower case, `s`), `{variant}` (a family's generic variant name, `nes_ne`),
`{sides}` (its side letters in `sides` order, empty for `o`), `{corners}` (its corners, `_ne_se`,
in `corners` order), `{shape}` (`lone`, `end`, `straight`, `corner`, `tee` or `cross`),
`{cx}`, `{cy}` (a split piece's cell). Files: `{page}`, `{d}`, `{name}`, `{asset}`.

Snippets: `{asset}`, `{name}`, `{first}` (the first image's name), `{names}` (every image, quoted,
comma-separated), `{frames}` (how many), `{ticks}`, `{ms}`, `{frameTicks}` (the first frame's),
`{loop}`, `{tags}`, `{views}`, `{directions}` (views, or 1), `{mirror}` (`W=E`), `{w}`, `{h}`,
`{cols}`, `{rows}` (the footprint), `{anchorX}`, `{anchorY}`, `{pivotX}`, `{pivotY}`, `{variants}`
(the base and its texture variants), `{scheme}`, `{kind}`.

### What becomes an image

- A tile, sprite, icon or object: one image per frame. One frame: `names.single`; more, or texture
  variants numbered with it: `names.frame`. With views: `names.view` per view, numbered from
  `start` within each view.
- A family: every cell of its sheet that a game uses (inside, outside, every variant), per frame;
  named through `autotile`. The coverage map is not exported.
- An oversized asset: one image (`sprite`), or its cells (`split`).
- A map: only `tiled` writes maps (`.tmx`).

Two images with one name are refused, with both sources named.

## The CSV page layout

The atlas records are one row per image, in the order the images are listed (assets by name, then
frames). With the default columns:

```
sprite,x,y,w,h,cropX,cropY,frameW,frameH,pivotX,pivotY
a,1,1,4,4,0,0,4,4,2,3
b,6,1,2,3,1,0,4,4,,
```

- `sprite`: the image's name. `x`, `y`, `w`, `h`: its trimmed box on the page (0,0,0,0 when it
  has no opaque pixel).
- `cropX`, `cropY`: where that box sits in the full frame; `frameW`, `frameH`: the full frame (d
  times the base frame at level d).
- `pivotX`, `pivotY`: the asset's pivot at this level (`pivot x,y` at 1x is
  `x*d + d/2, y*d + d-1` at level d), empty when it has none.
- Packing: images sorted by height, then width (largest first), then name; placed left to right on
  shelves, `padding` pixels apart and from the page's edges, the page `width` times d wide (wider
  if an image needs it). Each level has its own page and records: `bramble.png`, `bramble.csv`,
  `bramble@2x.png`, `bramble@2x.csv`.
- Other columns: `page`, `asset`, `frame` (from 1), `n`, `view`, `mirror`, `ticks`, `ms`, `d`,
  `cols`, `rows`, `anchorX`, `anchorY`, `flags` (footprint rows joined by `/`), `variant`, `kind`.
- A cell holding a comma or a quote is quoted, with `""` for a quote. `header: false` leaves the
  header row out (import then reads the columns from the profile).

JSON records: `{ "page": "<file>", "size": [W, H], "d": <level>, "sprites": [ { <column>: <value>, … } ] }`
with empty values left out.

## The layouts

- **loose**: `image` per image (and level). Import reads every file the profile would write;
  other PNGs come back as new art, named by their file stem.
- **atlas**: a page and its records per level.
- **sheet**: one sheet per asset (a family keeps its sheet layout, frames below each other).
- **tiled**: a `.tsx` per family (its sheet with the frames stacked, each frame of a tile a Tiled
  animation; each tile's `name` and `variant` as properties; a wang set: `mixed` for 8-neighbour
  schemes, `corner` for `wang16-corner`, `edge` for `path`), a collection tileset `tiles.tsx` of
  every other image (`tiles/<name>.png`), and a `.tmx` per map: a tile layer per ground layer whose
  gids are the families' tiles for each cell's variant, an object group per objects layer (tile
  objects placed by their bottom-left, with cell, footprint, anchor and flags as properties).
- **godot**: a `TileSet` resource per family: one atlas source (frames side by side, as tile
  animations with `animation_separation`), one terrain set (`mode` 0 match corners and sides for
  8-neighbour schemes, 1 corners, 2 sides), each variant's peering bits, and each tile's name in
  the custom data layer `name`.
- **aseprite-json**: per asset, a sheet PNG and the JSON Aseprite's sheet export writes (frames
  with their boxes and durations; tags, and views as tags named `view S` or `view W mirror E`).
- **aseprite**: an `.aseprite` file per asset (and `<asset>@<d>x.aseprite` per density copy).

## Import

- `import <file.png>`: a new asset quantised to a palette (`palette=`, default the project's;
  `build` makes a palette from the image's colours in the order they appear). `grid=WxH` slices a
  sheet into frames in reading order (empty cells skipped); with `cells` it stays one image with
  that cell grid.
- `import <file.aseprite>`: a new asset with the file's layers (normal ones; groups and tilemaps
  are skipped), frames and durations, tags, and views from tags named `view …`. Indexed, RGBA and
  greyscale files are read.
- `import <folder> profile=<name>`: the images a profile wrote, read back by name into the assets
  that export them, and compared: the result lists the assets that read back exactly and those
  that differ. Images no asset exports become new assets.

Quantising: an exact colour match first (role entries by the profile's colours); else the nearest
entry by a weighted RGB distance; alpha below 128 is transparent. The result says how many pixels
were not palette colours and the worst distance. The new asset's tape starts with `new` (the palette
in the line) and `import` commands carrying the pixels, so it replays on its own; the file is kept
as `blobs/<sha256>.<ext>` and named in the line (`from="…" blob=<sha256>`).

## Densities

A density set is one asset at 1x, 2x and 4x:

```
fork house house_2x
scale 2                      # nearest-neighbour: every layer, frame and stamp, the cell grid, pivot, ground, notes
density of=house d=2         # this asset is house at twice the size
```

then detail the copy. A lower copy is authored, not reduced. The `density` check reduces the copy
by d with a reducer and compares it with its base: the share of the base's pixels that differ
(default limit 25 %), and the copy's blocks that differ are flagged. `view density` shows every
level side by side at one size on screen and the reduction with its differences marked; the watch
view's preview has a density tab.

Reducers (`style.density` in `project.json`, or a profile's `density`):

| Reducer | A d×d block becomes |
|---|---|
| `ink-vote` (default) | the ink entry when it covers at least `share` of the block (default 1/4; `ink` names the entries, default ink, outline or black), else the most common colour |
| `mode` | the most common colour; ties go to the darker entry, then the lower index |
| `nearest` | the pixel at the block's centre |

More reducers can be registered in code (`registerReducer(name, fn)`).

## Fonts

A font (a glyph sheet, [commands.md](commands.md#fonts)) is written in one of two formats.

**The glyph strip** is one row of glyphs as tall as a cell. Each glyph is its advance wide, drawn
from its cell's left edge, and a **separator column** stands before the first glyph, between every
two and after the last: `width = 1 + Σ (advance + 1)`. The separator colour is the top-left
pixel's (default `#ff0000`); every pixel of a separator column is that colour and no glyph pixel
may be (the export refuses one that is). Anything not drawn is transparent. A reader takes the top-left pixel's colour and splits the
strip at the columns of that colour; the glyphs are the characters in the sheet's order, written
beside the strip in `{asset}.txt` (UTF-8, one line). This is the image-font format several engines
read (LÖVE's `newImageFont`, for one).

**BMFont** is the AngelCode text format: `{asset}.fnt` with an `info` line (face, size = the cell
height), `common` (`lineHeight` = the font's line, `base` = baseline row + 1, the page size),
`page id=0 file="{asset}_0.png"`, `chars count=N` and a `char` line per glyph: its ink box on the
page (`x y width height`), the box's offset from the cell's top-left (`xoffset yoffset`) and
`xadvance` = advance + spacing; then `kernings count=0`. The page packs the ink boxes in rows a
pixel apart. A space has a zero box and its advance.

## Project schemes

A project's own autotile schemes live in `<project>/schemes/*.json` (the format of
`core/schemes/*.json`). `new family <name> <T>x<T> scheme=<name>` copies a project scheme into the
line (`def="…"`, its JSON), like the palette, so the tape replays without the file. A project
scheme with a built-in's name wins over the built-in.

`blob47-round` (built in; the example project keeps its own copy, so its lines still carry `def=`) is blob47 with rounder inner corners: a diagonal counts
when either side next to it is the terrain, so an edge knows the terrain turns an inner corner at
its end and bends into it, the inner corner's arcs widen, and the cell outside the corner gets the
rounding's tip (15 fillet variants drawn in outside cells). `family band … fillet=<px>` says how
much wider (default the band's width); on a terrain layer that does not fill its outside, only the
fillets' terrain pixels are drawn.
