# Pixel Claw

A pixel art editor built for an AI agent to drive by command. The agent draws with exact
commands, sees exact feedback, and checks its own work. People can watch, and later edit, in a
live browser view. All art is indexed colour.

Every edit is a line of a small command language. A document *is* its tape of commands replayed,
and replay is deterministic (integer maths, seeded randomness), so the same tape always gives the
same pixels.

**Status: step G2.** The core library and CLI (G1), plus the MCP server and the live watch view:
an agent draws through MCP while people watch the canvas fill in and the commands scroll past.
Editing in the browser comes in G3. See [PROGRESS.md](PROGRESS.md).

![The watch view: the canvas, the tape with the line being drawn, and Claude's eye](docs/screenshots/g2-live.png)

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
`http://127.0.0.1:7417/?token=…`. Open it, then ask Claude to draw. The tools are `project`, `run`,
`view` and `history`; see [docs/mcp.md](docs/mcp.md). [examples/demo-g2.md](examples/demo-g2.md)
walks through a session, and has a script that stands in for the agent.

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
| `pixelclaw view <project> <asset> [render\|grid\|tile3x3\|all] [--scale N] [--region x,y,WxH]` | Write views and print the text grid. |
| `pixelclaw verify <project> [<asset>...]` | Replay every tape and compare it with the saved state and preview. |
| `pixelclaw serve --project <project> [--port 7417] [--no-mcp]` | Own the project: MCP on stdin/stdout and the live watch view on localhost (the link, with its token, is printed to stderr). See [docs/mcp.md](docs/mcp.md). |

The command language is described in [docs/commands.md](docs/commands.md).

## A project folder

```
my-art.pclaw/
  project.json              name, tick rate, default palette
  palettes/<name>.json      entries (key, name, hex) and ramps
  assets/<name>/
    asset.json              kind, size, cell grid, wrap, palette, state hash
    tape.jsonl              the history: one command per line
    preview.png             the current image at 1x
    checkpoints/            fast-load snapshots (written from a later step)
  views/                    renders written by 'pixelclaw view' and the MCP 'view' tool
  .pixelclaw.lock           present while a server owns the project (not for git)
```

## The demo

[`examples/mossy-ruins.pclaw`](examples/mossy-ruins.pclaw) uses an original 16-colour "mossy
ruins" palette. Its seamless 24x24 stone floor tile is drawn by
[`examples/scripts/stone_floor.pclaw`](examples/scripts/stone_floor.pclaw). The tile's views are
checked in:

- [the 8x render](examples/mossy-ruins.pclaw/views/stone_floor.render.png)
- [the index grid](examples/mossy-ruins.pclaw/views/stone_floor.grid.txt)
- [the 3x3 preview](examples/mossy-ruins.pclaw/views/stone_floor.tile3x3.png)

The G2 demo ([examples/demo-g2.md](examples/demo-g2.md)) draws the same tile through MCP while you
watch.

## Packages

- `core`: the document, palettes, command parser and normaliser, raster operations, tape and
  replay, a PCG random generator, renders and a PNG encoder. It uses no DOM or Node APIs, so it
  runs anywhere.
- `server`: the project folder, the single writer (one queue for every command), views, the MCP
  server (stdio) and the HTTP + WebSocket server for the watch view.
- `ui`: the watch view (Vite + React + canvas 2D). It replays the tape with `core` itself.
- `cli`: the `pixelclaw` command. `pnpm build` bundles it with `core`, `server` and the built UI
  into `cli/dist` (no runtime dependencies), which is what `pnpm pack` ships.

## Licence

MIT. See [LICENSE](LICENSE). The built package bundles a few permissively licensed packages (the
MCP SDK, zod, React); their licences are written to `cli/dist/THIRD_PARTY_LICENSES.txt`.
