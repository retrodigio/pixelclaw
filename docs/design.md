# PixelClaw design

This document describes what PixelClaw is, how its parts fit together and why they are built the
way they are. The reference documents go deeper on each part: [commands.md](commands.md) (the
command language), [checks.md](checks.md), [mcp.md](mcp.md) (the server, its tools and the watch
view), [pipeline.md](pipeline.md) (manifest, statuses, requests, review and the skill),
[profiles.md](profiles.md) (export, import and densities) and [worker.md](worker.md).

## Goals

PixelClaw is a pixel art editor whose main user is an AI agent. The agent draws by writing exact
commands, reads exact feedback (images, text grids of palette keys, scores with pixel
coordinates) and checks its own work. People watch the same documents live in a browser and can
draw in them too.

The design follows from a few observations about how an agent makes pixel art well:

- **Exact edits beat redrawing.** An agent is good at structure (grids, edges, coordinates) and
  can fix a single pixel if it can name it. So every edit is a command with coordinates, and the
  agent sees results as numbers as well as pictures.
- **History is the document.** Every edit, the agent's or a person's, is a line in a command log
  (the *tape*). A document is its tape replayed. Anyone can read what changed, undo it, or carry
  on from it.
- **People and agents share one document.** A person's pencil drag in the browser is written to
  the tape as a command, attributed to that person, so the agent reads it with the same tools it
  uses to read its own work.
- **Quality is measured, not guessed.** Checks score stray pixels, jagged lines, seams, repetition,
  readability, animation smoothness, consistency across a set and more, each against thresholds
  from the project's style guide, and each pointing at the pixels it flags.
- **Game-specific knowledge is data.** Autotile schemes, export profiles and palettes are JSON
  files. The tool ships generic ones; a game brings its own.
- **Image generation is optional.** An image model can provide a reference underlay, but the
  pixels are always drawn by commands.

## Architecture

PixelClaw is TypeScript, in a pnpm workspace:

| Package | Role |
|---|---|
| `core` | The document model, palettes, the command parser and normaliser, raster operations, generators, tape replay, checks, renders, autotile schemes, families, maps, export profiles, PNG and GIF encoding. Pure and deterministic: no DOM or Node APIs. |
| `server` | The project folder on disk, the single writer, views, the MCP server (stdio and HTTP) and the HTTP + WebSocket server for the watch view. |
| `ui` | The browser watch view, editor and dashboard (React, canvas 2D). It replays tapes with `core` itself. |
| `cli` | The `pixelclaw` command. The published package bundles `core`, `server` and the built UI into one file with no runtime dependencies. |
| `skill/` | A Claude Code skill that teaches an agent the workflows and house rules. |

## The command language and the tape

Commands are short lines: `rect 1,1 14x14 c=stone3 fill`, `line 1,1 14,1 c=stone4`,
`fill 7,9 c=moss1`, `select rect 0,0 8x8`, `mirror x`, `noise 0,0 24x24 ramp=moss density=0.07 seed=7`.
A `run` applies a batch of lines as one undo group; if any line has an error, nothing is applied
and every error is reported with its line and column.

The language covers primitives (pixels, lines, rectangles, ellipses, curves, polygons, fills),
layers and frames, selections and transforms, symmetry, dithering and gradients, colour ramps,
helpers (outlines, shading, cleanup of stray pixels), seeded texture generators, stamps, brushes
and macros, notes pinned to pixels, marks (named milestones such as *reviewed* or *approved*),
undo and redo, and forks (a new asset that starts from another's state).

Each asset's tape is a JSON Lines file. Every entry records the command in a **normal form**
(colours by name, options in a fixed order, defaults written out), its author (`claude`, or
`human:<name>` for a person) and its undo group. Normal form means the tape is a stable,
diff-friendly record, and replaying it always reproduces the same document. The palette itself is
written into the tape's first line, so a tape replays without any other file.

Every author has their own editing context (layer, frame, selection, symmetry, brush), so the
agent's selection never clips a person's strokes. Checkpoints of the full state are saved every
few hundred commands so long tapes load quickly; a state cache keyed by the tape's hash makes
reading a project fast. `pixelclaw verify` replays every tape twice and compares the result with
the saved state hash, preview image and checkpoints.

## Indexed colour and palettes

All art is indexed: every pixel is a palette entry or transparent. A palette entry has a
one-character key (used in text grids), a name and either a colour or a **role**. Role entries let
a game recolour art at run time (a tone or channel that the engine maps to a colour); preview
themes show role art in sample colours. Palettes are organised into **ramps** (dark to light
steps of one material), which the shading helpers, the checks and the consistency measures use.

Palettes can be imported from JSON, Lospec JSON, `.hex` and `.gpl` files. Commands refuse colours
that are not in the palette, and palette locking keeps chosen entries from being used or changed.
A style guide can reserve an entry for named assets only.

## Documents and kinds

Every asset has a kind, a size, a cell grid and optional wrap-around:

- **tile**: seamless ground; drawn with wrap on, previewed 3x3, checked for seams and repetition.
  Texture variants (`variant of=`) are held to their base's colour mix.
- **sprite**: a figure or prop with an outline, a pivot and a ground line; directions (views,
  including mirrored ones) and animation tags.
- **object**: art larger than a map cell, with a footprint of cells it stands on and an optional
  roof that actors walk behind.
- **family**: an autotile sheet (below).
- **map**: layers of tiles, terrain and objects (below).
- **font**: a glyph sheet with metrics (cap height, x-height, baseline, advances).
- **icon**: HUD and UI art, with an export mode (full colour, tones or channels).
- **overlay**: an effect drawn over ground (water glints, for example).
- **sheet**: a grid of frames or cells, often from an import.

Animation is frames with durations, tags for sequences, and onion-skin and contact-sheet views.
Density copies (`density of=<asset> d=2`) hold a larger version of an asset for higher
resolutions, checked against the original by reduction.

## Seeing the work

Views are images and text: an enlarged render with a grid and rulers, a text grid of palette
keys, a 3x3 tile preview, a diff against an earlier state, a *game view* (the asset at game scale
on its usual ground), recolour previews, animation sheets and GIFs, map and family views, and
density levels. Any view can circle the pixels a failing check flags.

## Checks

A check reads an asset's flat art and returns a score, a pass or fail against a threshold, and the
pixels it flags. The checks include: palette use, stray pixels (orphans), jaggies (irregular
line steps and doubled corners, with ramp shading left out), pillow shading (banding), outline
coverage, seams and visible repetition on tiles, coverage (sizes, empty frames, missing family
variants), readability against the ground, how much an edit left unchanged from a reference,
animation (frame-to-frame change, loop seams, pivot and ground drift), footprint fit, variant
drift, density reduction, consistency with the rest of a set (height, lightness, outline share,
light direction, cluster size, ramp steps; stroke weight and optical centre for icons), art on a
cell's edge (margin), detached parts (pieces), font metrics, and directions that look too alike.
Maps add map-scale checks for repeating patterns (lattices) and objects that stand out.

Thresholds come from the project's style guide (`project.json`), with defaults that scale with the
tile size. The server, the CLI and the browser all run the same check code, so they always agree.
Every `run` result ends with a one-line check summary, so the agent sees a regression as soon as
it makes one. A *dry run* applies commands to a copy and reports the checks without keeping
anything; *seed search* tries a generator line with many seeds and ranks them by the checks.

## Families and autotile schemes

A **family** is every variant an autotile scheme needs for one terrain meeting another, built
from two textures (inside and outside), a **band profile** (how the edge between them is shaped
and shaded) and optional hand-drawn pieces. Schemes are JSON data describing which neighbours
count, each variant's name and how it is composed from quarter-tile pieces. Built-in schemes
include a 47-variant blob scheme (with a rounded variant), a 16-variant corner scheme, paths,
bridges, cliff faces (side faces, corners and inner corners) and lanes. A project can bring its
own. The family view shows each variant among its neighbours, and its seam check scores a
composed sample map.

## Maps

A **map** is a grid of cells with layers: tile layers, terrain layers (painted by cell and
resolved through a family's scheme), object layers (objects placed by footprint, casting shadows
away from the style's light) and overlays. Commands paint terrain, lay roads, scatter objects,
fill a layer with a weighted mix of tile looks, and generate starting layouts from a seed.
Map views show the whole map, a region, or a camera's screen at game scale; map checks find
lattices, hot spots of repetition and objects that do not match their neighbours. Ground can be
marked walkable for export.

## Profiles, export and import

An **export profile** is a JSON file describing how a game wants its art: file names, layout
(loose images, an atlas page with records, sheets, Tiled or Godot tile sets, Aseprite files),
density levels, how role entries are written, corner orders for autotiles, and text snippets
written beside the art. The tool ships generic profiles (`png`, `atlas`, `tiled`, `godot`,
`aseprite-json`, `aseprite`); a game keeps its own profile with the game. A profile also reads
its output back, and exporting then importing gives the same palette indices.

**Import** quantises a PNG to the palette, slices a sheet into frames or into one asset per cell,
reads Aseprite files, or reads a profile's export back for comparison. Imported pixels are written
into the tape as an `import` command that carries the pixels, so the tape still replays alone.

## The server, MCP and the watch view

`pixelclaw serve --project <dir>` owns one project folder. It is the **single writer**: every
command, from the agent or a browser, goes through one queue in arrival order, is written to the
tape with its author, and is streamed to every open page. A lock file stops the CLI from writing
to a project a server owns.

The agent connects over **MCP** (stdio, or HTTP for the worker). The tools are `project` (open a
folder, add palettes, get the watch link), `run`, `view`, `check`, `seeds`, `history`, `changes`
(what others changed since the agent last looked, with their notes and a diff image), `plan`,
`request`, `work`, `review`, `export` and `import`.

The **watch view** is a local web page: the canvas in the middle, the tape scrolling beside it,
layers, frames and a timeline, check chips that circle flagged pixels, and editing tools whose
every action is written as a command. The page replays tape lines with the core library itself, so
what it shows is exactly what the core computes. Further tabs hold the family and map editors, a
gallery of every asset at game scale, an import dialog and the dashboard.

## The manifest and the pipeline

For a whole art set, the agent writes a **style guide** (words in `style.md`, check settings in
`project.json`) and a **manifest**: the theme, sets, scenes and every planned asset with its kind,
size and description. The manifest is validated against its schema and the project before it is
written.

Each asset's **status** is worked out from the project every time, never set by hand: planned,
drafted, checked (every check passes), reviewed, approved (by a person, in the dashboard) and
exported. Reviews and approvals are marks on the tape that keep a hash of the art, so changing
the pixels afterwards makes them stale. The **dashboard** shows every planned asset by set or by
scene with its status, and **flat templates** (a mockup screen, coverage maps for families) are
drawn from the manifest to plan layouts before drawing.

## Requests and the worker

People ask for work from the dashboard (*draw this*, *ask for changes*, *add an asset*), from the
CLI or over MCP. Requests are records in `requests.jsonl` with a small state machine: open,
claimed (with progress notes), blocked on a question (open again once answered), done and
cancelled. An agent takes them with
the `work` tool, and `plan` lists open requests first.

When no agent session is open, the optional **worker** works the queue: a headless Claude Code
session connected to the project's server with only PixelClaw's tools. It is **off by default**
because it spends money on the user's Anthropic account; a project turns it on in `project.json`
with a spending cap that covers every run. The worker has no built-in tools (no shell, no file
access, no web), cannot load project-level settings, gets an MCP token of its own, and its
PixelClaw tools are fenced to the project folder. A request is only *done* when its asset's checks
pass. A watchdog stops a stalled session, and a ledger records spend. See
[worker.md](worker.md).

## Underlays and snap

An **underlay** is a reference image under the canvas: any PNG, or one generated by an image
provider (an optional OpenAI provider, using a key from the environment, with a cost cap and a
cost log; the key is never written to disk). `snap` fits an underlay's pixel grid and quantises it
to the palette in a draft layer, which the agent then cleans up by coordinates.

## The review hand-off

The tool calls no model to judge art. Instead, `review` writes a **blind review bundle**: the
images at review scale, the palette, the style guide, a brief from the manifest and a rubric,
naming no author or method. The agent hands the folder to a fresh-context reviewer, saves the
findings beside the bundle, pins each finding as a note on its pixels, fixes them by coordinates,
closes the notes and marks the asset reviewed.

## Determinism

`core` uses integer maths, a seeded PCG random generator, and no clocks, `Math.random`, DOM or
Node APIs. Generators take explicit seeds. Replaying a tape is byte-identical on every machine,
which makes it possible to:

- store a document as its history and rebuild it anywhere;
- verify a project by replaying it and comparing hashes;
- let the browser replay the same tape the server writes and agree pixel for pixel;
- keep golden renders in the test suite that must not change.

Timestamps and authors are recorded on the tape but ignored by replay.
