# Changelog

All notable changes to PixelClaw are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.1] - 2026-11-10

### Fixed
- On Linux, a CLI command could not reach a server an MCP client had started: the token file went under
  `$XDG_RUNTIME_DIR`, which MCP clients do not pass to the servers they start, so the two looked in different
  folders. The token file is now always in `~/.pixelclaw/run` (or `PIXELCLAW_STATE_DIR`).

### Release
- Published from GitHub Actions by npm trusted publishing, with a provenance statement.

## [0.3.0] - 2026-11-06

### An optional judge beside the code checks (experimental)
- `pixelclaw judge <project> [<asset>...] [--questions a,b] [--fresh]` and the MCP `judge` tool
  ask a model (TypeSafe's Jev) typed questions about an asset's pictures and return probabilities:
  recognisable as itself among its manifest set (and which sprites are read as each other), the
  manifest's new `"reads"` per asset (`"a readable face"`), seams on tiles and maps, style against
  an approved mockup, "the same object after the last change", and a box that places a stray blob
  as marked pixels. Thresholds are 0.7 yes / 0.3 no per question; between is shown as unsure.
- Off by default and per project: `"judge": { "provider": "none" | "jev", "model", "gate": false }`
  in `project.json`. The key is only `TYPESAFE_API_KEY` from the environment (not stored, logged
  or shown; the headless worker does not inherit it). Images are sent to a third-party API.
- Questions are data: `judge/questions.json` (documented in docs/judge.md) over a generic default
  set. One request per asset per run, each picture once, upscaled nearest-neighbour and padded to
  the API's limits; answers that are current are not asked again; every request is logged for
  rerun (without image bytes or key). Failures are errors, never answers.
- `check` (CLI and MCP) prints the last judge answers as a separate table; the dashboard shows an
  advisory badge on each card ("unsure" as unsure). With `"gate": true` failing answers block
  `done` on a request like failing checks.
- docs/judge.md; an opt-in live smoke test (`server/test/judge-live.test.ts`, runs only with
  `TYPESAFE_API_KEY` set and never in CI).

### Smaller changes
- `import <x,y> asset=<name> region=… frame=<n>` copies a chosen frame of the source asset.
- A manifest asset can be `"reference": true` (a sheet to copy from, a study): the code checks that
  compare an asset with its set, and the judge's recognisability options, leave it out.
- `keep <x,y> [<W>x<H>]` (also `keep remove`, `keep clear`) marks single pixels that are meant to stand
  alone, an eye or a mouth; the `orphans` check leaves them out and says how many it kept.
- Per-asset overrides for the `anim` and `margin` checks (`style.assets.<name>.checks`) are
  documented with an example and covered by tests.
- `outline` with `corners=off` (the default) round a diagonal stroke: the `jaggies` check no longer
  counts the outline wrapping round the stroke's tips as spikes, so the command's own output passes.
- `pixelclaw --version`, and `pixelclaw <command> --help` (also `help <command>`) prints that
  command's usage, including `await`, `serve`, `work` and `judge`.

## [0.2.0] - 2026-11-06

### Feedback from the dashboard reaches an agent
- `pixelclaw await <project-folder | watch-url> [--timeout <s>] [--since <cursor>]` waits on the
  running server and **exits** with what people did: a request, a reply, a withdrawn request, or
  an approval, rejection or review mark written in the dashboard. It prints each event with its
  next step (`work` claims a request, `changes` reads a change) and a cursor for the next call.
  Exit 0 with events, 3 on timeout, 1 if the server cannot be reached. An agent runs it in the
  background; its exit is what wakes the model. It works with `serve --no-mcp`.
- The MCP tool `await_requests` is the same wait (timeout capped at 2 minutes) for agents that
  prefer to stay in a tool call.
- The server finds clients by the project's lock plus a token file only the user can read (mode
  0600, in a 0700 folder outside the project, removed when the server stops).
- Requests have a `seen` record: when `await`, `plan` or `work` hands an open request to an agent
  it is written to `requests.jsonl` (once per agent). Files without it read as before.
- Cards say what is true: **sent**, **seen by <agent>**, **Claude is working on this**, **done**.
  With no agent listening, or a request unseen for two minutes, the card and the header say so,
  with *Copy prompt for Claude* and, when the project allows the worker, *Start the worker*.
  Filing a request with nobody listening says so at once.
- The dashboard header shows whether an agent is listening (a waiting `await`, an MCP session that
  called `work`, `plan` or `await` in the last five minutes, or the running worker).
- `plan` (CLI and MCP) says when open requests have no listener.
- Agents without PixelClaw's MCP tools work requests with the CLI: `pixelclaw work <project>
  list | claim [<id>] | progress [<id>] "…" | block [<id>] "<question>" | done [<id>] "<what
  changed>"` [--by <agent>], the MCP `work` tool's actions with the same rules (`done` only when
  the asset passes its checks; an error writes nothing). Through a running server the card moves
  live and the agent counts as listening. The headless worker is now `pixelclaw work <project>
  start`; `pixelclaw work <project>` with no action still starts it.
- `pixelclaw request <project>` (the list) and `plan` say `seen by <agent>` for an open request
  an agent has been handed, as the card does. `await` prints the CLI command next to `work` for
  each request.
- *Copy prompt for Claude* tells the session to use the MCP work tool if it has it, and otherwise
  gives the exact `pixelclaw work` commands; the project folder is shown as `~/…` when it is
  under the home folder.

### The CLI writes through a running server
- `new`, `run`, `seeds --apply`, `export`, `import`, `review`, `plan --manifest/--templates`,
  `request`, `reply` and `cancel` used to refuse while `pixelclaw serve` held the project. They
  now send the command to the server (found through its lock and the token file), so it goes
  through the same writer queue, undo groups and checks as MCP `run`, and a connected dashboard
  updates live instead of dropping to "reconnecting". Output and exit codes match the direct
  path; a refused command applies nothing. If the server cannot be reached (a stale lock, a dead
  process) the command runs directly as before. Read-only commands still read the files. The new
  `work` actions are sent the same way.

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

[Unreleased]: https://github.com/retrodigio/pixelclaw/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/retrodigio/pixelclaw/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/retrodigio/pixelclaw/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/retrodigio/pixelclaw/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/retrodigio/pixelclaw/releases/tag/v0.1.0
