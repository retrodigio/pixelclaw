# PixelClaw

A pixel art editor built for an AI agent to drive by command. The agent draws with exact
commands, sees exact feedback, and checks its own work. People watch and edit in a live browser
view, and every human edit is written down as a command, so the agent reads what changed and
carries on from there. All art is indexed colour.

Every edit is a line of a small command language. A document *is* its tape of commands replayed,
and replay is deterministic (integer maths, seeded randomness), so the same tape always gives the
same pixels.

**Status: step G4.** The core library and CLI (G1); the MCP server and the live watch view (G2);
editing in the browser, with every action a command on the tape and the agent's `changes` tool
(G3); and the drawing toolkit (G4): layers (with reference layers), frames, every kind of
selection, transforms, symmetry, curves and polygons, dithering, gradients and ramps, palette
locking, `outline`, `shade` and `clean`, seeded generators (`noise`, `scatter`, `voronoi`,
`bricks`), stamps and brushes, and macros. Each author draws on their own layer and frame with
their own selection. See [PROGRESS.md](PROGRESS.md).

![The G4 chest sprite in the watch view: the tape of commands that drew it, and the agent's render as Claude's eye](docs/screenshots/g4-chest.png)

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
| `pixelclaw view <project> <asset> [render\|grid\|tile3x3\|diff\|all] [--scale N] [--region x,y,WxH] [--frame N]` | Write views and print the text grid (or the diff's list of changes). |
| `pixelclaw verify <project> [<asset>...]` | Replay every tape and compare it with the saved state, the preview and the checkpoints. |
| `pixelclaw serve --project <project> [--port 7417] [--no-mcp]` | Own the project: MCP on stdin/stdout and the live watch view on localhost (the link, with its token, is printed to stderr). See [docs/mcp.md](docs/mcp.md). |

The command language is described in [docs/commands.md](docs/commands.md).

## A project folder

```
my-art.pclaw/
  project.json              name, tick rate, default palette
  palettes/<name>.json      entries (key, name, hex) and ramps
  assets/<name>/
    asset.json              kind, size, cell grid, wrap, palette, layers, frames, stamps, macros, open notes, fork link, state hash
    tape.jsonl              the history: one command per line, with its author
    preview.png             the current image at 1x (frame 1)
    checkpoints/            the state every 200 commands (NNNNNN.gwc): fast loading, checked by verify
  views/                    renders written by 'pixelclaw view' and the MCP 'view' and 'changes' tools
  reads.json                how far each agent has read each tape (for 'changes')
  .pixelclaw.lock           present while a server owns the project (not for git)
```

## The demo

[`examples/mossy-ruins.pclaw`](examples/mossy-ruins.pclaw) uses an original 16-colour "mossy
ruins" palette. Its seamless 24x24 stone floor tile is drawn by
[`examples/scripts/stone_floor.pclaw`](examples/scripts/stone_floor.pclaw); a seamless grass tile
with two variants and a treasure chest sprite by the G4 scripts beside it. The views are checked
in:

- the stone floor: [8x render](examples/mossy-ruins.pclaw/views/stone_floor.render.png),
  [index grid](examples/mossy-ruins.pclaw/views/stone_floor.grid.txt),
  [3x3 preview](examples/mossy-ruins.pclaw/views/stone_floor.tile3x3.png)
- the grass: [3x3 preview](examples/mossy-ruins.pclaw/views/grass.tile3x3.png) (and
  [grass_b](examples/mossy-ruins.pclaw/views/grass_b.tile3x3.png),
  [grass_c](examples/mossy-ruins.pclaw/views/grass_c.tile3x3.png)),
  [index grid](examples/mossy-ruins.pclaw/views/grass.grid.txt)
- the chest: [8x render](examples/mossy-ruins.pclaw/views/chest.render.png),
  [index grid](examples/mossy-ruins.pclaw/views/chest.grid.txt)

The G2 demo ([examples/demo-g2.md](examples/demo-g2.md)) draws the same tile through MCP while you
watch. In the G3 demo ([examples/demo-g3.md](examples/demo-g3.md)) you fix three pixels and leave a
note, and the agent reads them with `changes` and carries on. The G4 demo
([examples/demo-g4.md](examples/demo-g4.md)) draws the grass, its variants and the chest.

## Packages

- `core`: the document (layers, frames, each author's context), palettes, command parser and
  normaliser, raster operations, helpers and generators, tape and replay, a PCG random generator,
  renders and a PNG encoder. It uses no DOM or Node APIs, so it
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
