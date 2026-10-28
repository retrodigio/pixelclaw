# PixelClaw

A pixel art editor built for an AI agent to drive by command. The agent draws with exact
commands, sees exact feedback, and checks its own work. People watch and edit in a live browser
view, and every human edit is written down as a command, so the agent reads what changed and
carries on from there. All art is indexed colour.

Every edit is a line of a small command language. A document *is* its tape of commands replayed,
and replay is deterministic (integer maths, seeded randomness), so the same tape always gives the
same pixels.

**Status: step G7.** The core library and CLI (G1); the MCP server and the live watch view (G2);
editing in the browser, with every action a command on the tape and the agent's `changes` tool
(G3); the drawing toolkit (G4): layers, frames, selections, transforms, symmetry, curves,
dithering, gradients, `outline`, `shade`, `clean`, seeded generators, stamps, brushes and macros;
and checks and in-context previews (G5): palette, orphans, jaggies, banding, outline, the seam
score, coverage, readability, revert and repetition against the project's style guide, with the
flagged pixels circled in magenta in images and in the watch view; the `game` and `recolour`
previews, role palettes and preview themes; a blind review bundle; and tapes that carry their
own palette; and animation and sprites (G6): frame durations in game ticks, tags with cycle and
ping-pong loops, linked cels, directional views with live mirror links, pivots and ground lines,
the `anim` contact sheet and GIF, the `anim` and `views` checks, checks over every frame, a
timeline with playback at the game's speed and an onion skin, and `pixelclaw upgrade`; and tile
sets and autotiling (G7): autotile schemes as data (`blob47`, `wang16-corner`, `path`,
`bridge8`, `single`, `face`), family documents whose 47 (or 16, or 8) variants are built live from
a band profile and a few hand-drawn pieces over shared textures, or cut from a painted coverage
map; sample maps with the seam score over them, overlays (glints, ripples) played over a map, and
in the watch view each variant among its neighbours and a map to roll. See
[PROGRESS.md](PROGRESS.md).

![A shore family on a random island in the watch view: sand meeting shimmering water through a band of foam and wet sand, the seam score over the map above it, every check green](docs/screenshots/g7-map.png)

## Use it from Claude Code

Build once (Node 22.18 or later, pnpm):

```sh
pnpm install
pnpm build
```

Register the MCP server with Claude Code, pointing at a project folder (created if missing):

```sh
claude mcp add pixelclaw -- node /path/to/pixelclaw/cli/dist/pixelclaw.js serve --project ~/art/mossy-ruins.pclaw --port 7417
```

Once the package is published to npm, the same thing is
`claude mcp add pixelclaw -- npx -y pixelclaw serve --project ~/art/mossy-ruins.pclaw --port 7417`
(until then, `npx -y --package /path/to/pixelclaw-0.2.0.tgz pixelclaw serve …` works from a tarball
made with `cd cli && pnpm pack`).

Start `claude` and ask for the watch link: the `project` tool returns
`http://127.0.0.1:7417/?token=…`. Open it, then ask Claude to draw. Draw in the page too, or pin a
note on a pixel, and tell Claude: its `changes` tool returns your lines, your notes and a diff
image. The tools are `project`, `run`, `view`, `history` and `changes`; see
[docs/mcp.md](docs/mcp.md). [examples/demo-g2.md](examples/demo-g2.md),
[examples/demo-g3.md](examples/demo-g3.md) and [examples/demo-g4.md](examples/demo-g4.md) walk
through sessions, with scripts that stand in for the agent.

## Quick start (CLI)

The TypeScript sources run directly under Node 22.18+; `pnpm build` is only needed for the watch
view and the packaged `pixelclaw`.

```sh
pnpm install
pnpm test        # builds, then runs vitest and the Playwright browser tests

# make a project with a palette, then a 16x16 tile
node cli/bin/pixelclaw.js new my-art.pclaw --palette examples/src/mossy-ruins.json
node cli/bin/pixelclaw.js new my-art.pclaw tile slab 16x16 bg=stone1

# draw, then look
node cli/bin/pixelclaw.js run my-art.pclaw --asset slab -e "rect 1,1 14x14 c=stone3 fill
line 1,1 14,1 c=stone4 ; line 1,14 14,14 c=stone2"
node cli/bin/pixelclaw.js view my-art.pclaw slab all

# replay every tape and check it against the saved state
node cli/bin/pixelclaw.js verify my-art.pclaw
```

`pnpm pixelclaw <args>` is the same as `node cli/bin/pixelclaw.js <args>`.

## The CLI

| Command | Does |
|---|---|
| `pixelclaw new <project> [--palette <file>]...` | Create a project folder. Palettes can be `.json`, Lospec `.json`, `.hex` or `.gpl`. |
| `pixelclaw new <project> <kind> <name> <W>x<H> [opts]` | Create an asset (a `new` command). |
| `pixelclaw run <project> <script.pclaw>\|-\|-e "..." [--asset <name>] [--replace] [--by <who>] [--view <mode>]` | Apply commands as one undo group. Any error applies nothing. |
| `pixelclaw view <project> <asset> [render\|grid\|tile3x3\|diff\|game\|recolour\|anim\|map\|family\|density\|all] [--scale N] [--region x,y,WxH] [--frame N] [--marks failing] [--theme t]` | Write views and print the text grid (or the diff's list of changes). |
| `pixelclaw check <project> [<asset>...] [--checks a,b] [--marks]` | Run the quality checks against the style guide; exits 1 if any fails. See [docs/checks.md](docs/checks.md). |
| `pixelclaw export <project> [<asset>...] [--profile <name>] [--out <dir>]` | Write assets through an export profile (built-in `png`, `atlas`, `tiled`, `godot`, `aseprite-json`, `aseprite`, or the project's own). See [docs/profiles.md](docs/profiles.md). |
| `pixelclaw import <project> <file.png\|file.aseprite\|folder> [--profile <name>] [--as <name>] [--grid WxH] [--palette <p>\|--build]` | Make a new asset from an image (quantised, sliced by a grid) or an `.aseprite` file, or read a profile's export back and compare. |
| `pixelclaw review <project> [<asset>...] [--name set]` | Write a blind review bundle (images, palette, style guide, rubric). |
| `pixelclaw verify <project> [<asset>...]` | Replay every tape and compare it with the saved state, the preview and the checkpoints. |
| `pixelclaw upgrade <project> [<asset>...]` | Rewrite tapes from tape language 1 (G1-G4) in language 2 (the palette in the `new` line); written only if the replay gives the same pixels, then verified. |
| `pixelclaw serve --project <project> [--port 7417] [--no-mcp]` | Own the project: MCP on stdin/stdout and the live watch view on localhost (the link, with its token, is printed to stderr). See [docs/mcp.md](docs/mcp.md). |

The command language is described in [docs/commands.md](docs/commands.md).

## A project folder

```
my-art.pclaw/
  project.json              name, tick rate, default palette, the style guide's check settings, preview themes
  style.md                  the style guide in words
  palettes/<name>.json      entries (key, name, hex or role) and ramps
  assets/<name>/
    asset.json              kind, size, cell grid, wrap, palette, layers, frames, stamps, macros, open notes, fork link, state hash
    tape.jsonl              the history: one command per line, with its author
    preview.png             the current image at 1x (frame 1)
    checkpoints/            the state every 200 commands (NNNNNN.gwc): fast loading, checked by verify
  views/                    renders written by 'pixelclaw view' and the MCP 'view' and 'changes' tools
  reviews/<date>-<set>/     blind review bundles (and the findings brought back)
  reads.json                how far each agent has read each tape (for 'changes')
  .pixelclaw.lock           present while a server owns the project (not for git)
```

## The demo

[`examples/mossy-ruins.pclaw`](examples/mossy-ruins.pclaw) uses an original 16-colour "mossy
ruins" palette and a style guide. Its seamless 24x24 stone floor tile is drawn by
[`examples/scripts/stone_floor.pclaw`](examples/scripts/stone_floor.pclaw); a seamless grass tile
with two variants and a treasure chest sprite by the G4 scripts beside it; a test sprite, the
glowcap, by G5's. G5's `*_fix.pclaw` and `*_review.pclaw` scripts fix what the checks and a blind
reviewer found, and G6's [`stone_floor_redraw.pclaw`](examples/scripts/stone_floor_redraw.pclaw)
lays the floor again as flagstones. G6 adds a walking figure in four directions
([`walker.pclaw`](examples/scripts/walker.pclaw)) and a shimmering water tile
([`water.pclaw`](examples/scripts/water.pclaw)). Every check passes on every asset. The views are
checked in:

- the stone floor: [8x render](examples/mossy-ruins.pclaw/views/stone_floor.render.png),
  [index grid](examples/mossy-ruins.pclaw/views/stone_floor.grid.txt),
  [3x3 preview](examples/mossy-ruins.pclaw/views/stone_floor.tile3x3.png)
- the grass: [3x3 preview](examples/mossy-ruins.pclaw/views/grass.tile3x3.png) (and
  [grass_b](examples/mossy-ruins.pclaw/views/grass_b.tile3x3.png),
  [grass_c](examples/mossy-ruins.pclaw/views/grass_c.tile3x3.png)),
  [index grid](examples/mossy-ruins.pclaw/views/grass.grid.txt)
- the chest: [8x render](examples/mossy-ruins.pclaw/views/chest.render.png),
  [game view](examples/mossy-ruins.pclaw/views/chest.game.png),
  [index grid](examples/mossy-ruins.pclaw/views/chest.grid.txt)
- the glowcap: [8x render](examples/mossy-ruins.pclaw/views/glowcap.render.png),
  [game view](examples/mossy-ruins.pclaw/views/glowcap.game.png)
- the walker: [anim sheet](examples/mossy-ruins.pclaw/views/walker.anim.png),
  [GIF](examples/mossy-ruins.pclaw/views/walker.anim.gif),
  [game view](examples/mossy-ruins.pclaw/views/walker.game.png)
- the water: [anim sheet](examples/mossy-ruins.pclaw/views/water.anim.png),
  [GIF](examples/mossy-ruins.pclaw/views/water.anim.gif),
  [3x3 preview](examples/mossy-ruins.pclaw/views/water.tile3x3.png)
- the shore (a blob47 family of 47 variants, sand meeting the shimmering water):
  [on an island](docs/screenshots/g7-shore-map.png), [playing with glints](docs/screenshots/g7-shore-map.gif),
  [every variant among its neighbours](docs/screenshots/g7-shore-family.png)
- the village (a 40x30 map: the shore, a meadow and lanes, four 48x48 houses, 24x48 trees and a
  well): [whole at 1x](docs/screenshots/g8-village.png), [a screen at game scale](docs/screenshots/g8-village-camera.png),
  [the hot spots before the variants](docs/screenshots/g8-hotspots.png), [in Tiled's format](examples/mossy-ruins.pclaw/exports/tiled/village.tmx);
  since G9 with rounder corners and its notes closed: [whole](docs/screenshots/g9-village.png), [a screen on the beach](docs/screenshots/g9-village-camera.png)
- the house at 2x, a density copy: [the levels and the reduction](docs/screenshots/g9-house-density.png); the walker,
  house and glints through the sample profile: [atlas page and CSV](examples/mossy-ruins.pclaw/exports/bramble/)

The G2 demo ([examples/demo-g2.md](examples/demo-g2.md)) draws the same tile through MCP while you
watch. In the G3 demo ([examples/demo-g3.md](examples/demo-g3.md)) you fix three pixels and leave a
note, and the agent reads them with `changes` and carries on. The G4 demo
([examples/demo-g4.md](examples/demo-g4.md)) draws the grass, its variants and the chest. The G5
demo ([examples/demo-g5.md](examples/demo-g5.md)) checks them, fixes them by coordinates, and runs
a blind review. The G6 demo ([examples/demo-g6.md](examples/demo-g6.md)) animates the walker and
the water and plays them in the watch view at the game's speed. The G7 demo
([examples/demo-g7.md](examples/demo-g7.md)) builds a shore family of 47 variants from a band
profile and three hand-drawn pieces, puts it on a random island with the seam score over it, and
runs a blind review on the island. The G8 demo ([examples/demo-g8.md](examples/demo-g8.md)) builds
a coastal village map from those families plus a house, a tree and a well bigger than a cell,
finds where it repeats with the map checks and fixes it with texture variants; you move the well
in the watch view and the agent reads the move; then a blind review of the village at game scale.
The G9 demo ([examples/demo-g9.md](examples/demo-g9.md)) exports the G6-G8 art through a sample
export profile into a scratch game folder and reads it back exactly, writes the village for Tiled,
re-imports a sheet and edits it, and shows the village with its review notes closed and the house
at twice the density. Export profiles, import and densities: [docs/profiles.md](docs/profiles.md).

## Packages

- `core`: the document (layers, frames, each author's context), palettes, command parser and
  normaliser, raster operations, helpers and generators, tape and replay, a PCG random generator,
  the checks, renders and previews, autotile schemes (data in `core/schemes`), families, maps and
  overlays, and PNG and GIF encoders. It uses no DOM or Node APIs, so it
  runs anywhere.
- `server`: the project folder, the single writer (one queue for every command), views, the MCP
  server (stdio) and the HTTP + WebSocket server for the watch view.
- `ui`: the watch view and editor (Vite + React + canvas 2D). It replays the tape with `core`
  itself, and its tools write commands that `core` previews before they are sent.
- `cli`: the `pixelclaw` command. `pnpm build` bundles it with `core`, `server` and the built UI
  into `cli/dist` (no runtime dependencies), which is what `pnpm pack` ships.

## Licence

MIT. See [LICENSE](LICENSE). The built package bundles a few permissively licensed packages (the
MCP SDK, zod, React); their licences are written to `cli/dist/THIRD_PARTY_LICENSES.txt`.
