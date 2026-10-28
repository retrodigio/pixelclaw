# Pixel Claw

A pixel art editor built for an AI agent to drive by command. The agent draws with exact
commands, sees exact feedback, and checks its own work. People can watch, and later edit, in a
live browser view. All art is indexed colour.

Every edit is a line of a small command language. A document *is* its tape of commands replayed,
and replay is deterministic (integer maths, seeded randomness), so the same tape always gives the
same pixels.

**Status: step G1.** This step has the core library and the CLI: draw a tile and look at it. The
MCP server and the live browser view come in G2. See [PROGRESS.md](PROGRESS.md).

![The demo stone floor tile, repeated 3x3 at 1x and 4x](examples/mossy-ruins.pclaw/views/stone_floor.tile3x3.png)

## Quick start

Requires Node 22.18 or later. The TypeScript sources run directly, with no build step.

```sh
pnpm install
pnpm test

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
  views/                    renders written by 'pixelclaw view'
```

## The demo

[`examples/mossy-ruins.pclaw`](examples/mossy-ruins.pclaw) uses an original 16-colour "mossy
ruins" palette. Its seamless 24x24 stone floor tile is drawn by
[`examples/scripts/stone_floor.pclaw`](examples/scripts/stone_floor.pclaw). The tile's views are
checked in:

- [the 8x render](examples/mossy-ruins.pclaw/views/stone_floor.render.png)
- [the index grid](examples/mossy-ruins.pclaw/views/stone_floor.grid.txt)
- [the 3x3 preview](examples/mossy-ruins.pclaw/views/stone_floor.tile3x3.png)

## Packages

- `core`: the document, palettes, command parser and normaliser, raster operations, tape and
  replay, a PCG random generator, renders and a PNG encoder. It uses no DOM or Node APIs, so it
  runs anywhere.
- `cli`: the `pixelclaw` command over the project folder.
- `server`, `ui`: stubs, built in G2.

## Licence

MIT. See [LICENSE](LICENSE).
