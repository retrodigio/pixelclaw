# Changelog

All notable changes to PixelClaw are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0]

The first public release.

### The editor and its language
- An indexed-colour document model: palettes with keys, names, ramps and roles; layers, frames
  and cels; each author's own layer, frame, selection, symmetry and brush.
- A command language (version 2) with a normal form: pixels, lines, rectangles, ellipses,
  curves, polygons, fills, strokes, selections, transforms, symmetry, dithering and gradients,
  ramps, outline, shading and cleanup helpers, seeded texture generators (noise, scatter,
  `pebbles`, `tufts`), stamps, brushes, macros, notes, marks, undo and redo, and forks.
- Tapes: every edit a JSON Lines entry with its author and undo group; the palette written into
  the tape; deterministic replay; checkpoints; a state cache; `pixelclaw verify`; `pixelclaw
  upgrade` for language 1 tapes.

### Seeing and checking
- Views: scaled renders with grid and rulers, text grids of palette keys, 3x3 tile previews,
  diffs, game-scale and recolour previews, animation sheets and GIFs, family, map and density
  views, flagged pixels circled.
- Checks against the project's style guide: palette (with reserved colours), orphans, jaggies,
  banding, outline, seam, coverage, readability, revert, repetition, anim, fit, variant, density,
  consistency, margin, pieces, font and views; map checks including the map-scale lattice.
- Dry runs and seed search ranked by the checks; blind review bundles.

### Game art
- Tiles with wrap-around and texture variants; sprites with directions, animation tags, pivots
  and ground lines; objects larger than a cell with footprints and roofs; fonts; icons with
  export modes; overlays; densities.
- Autotile families built from a band profile and pieces, with data-driven schemes: blob47 (and
  a rounded variant), wang16 corners, paths, bridges, cliff faces with side faces and corners,
  and lanes.
- Maps: tile, terrain and object layers, roads, scatter, mixed fills, generated layouts,
  walkable ground, shadows, and a camera at game scale.

### Projects and pipeline
- Project folders with a style guide, a validated manifest of planned assets, scenes, statuses
  worked out from the project (planned, drafted, checked, reviewed, approved, exported), and flat
  templates.
- Export profiles (png, atlas, tiled, godot, aseprite-json, aseprite, or a project's own) that
  read their output back; import of PNGs, sheets and Aseprite files.
- Underlays from any PNG or an optional OpenAI image provider (key from the environment, a cost
  cap and a cost log), and `snap` into a palette-true draft layer.

### Server, browser and agents
- `pixelclaw serve`: the single writer for a project, an MCP server (stdio and HTTP) with the
  `project`, `run`, `view`, `check`, `seeds`, `history`, `changes`, `plan`, `request`, `work`,
  `review`, `export` and `import` tools, and a token-protected watch view on localhost.
- The watch view: live playback of the tape, editing tools that write commands, notes, check
  chips, the timeline, family and map editors, a gallery, an import dialog and a dashboard for
  approvals and requests.
- Requests from the dashboard, the CLI or MCP, and an optional worker (off by default, with a
  spending cap) that works them in a fenced headless Claude Code session.
- A Claude Code skill (`pixelclaw skill install`).

[Unreleased]: https://github.com/retrodigio/pixelclaw/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/retrodigio/pixelclaw/releases/tag/v0.1.0
