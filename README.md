# PixelClaw

A pixel art editor built for an AI agent to drive by command. The agent draws with exact
commands, sees exact feedback (images, text grids of palette keys, scores with pixel coordinates)
and checks its own work. People watch and edit in a live browser view, and every human edit is
written down as a command, so the agent reads what changed and carries on from there. All art is
indexed colour.

Every edit is a line of a small command language. A document *is* its tape of commands replayed,
and replay is deterministic (integer maths, seeded randomness), so the same tape always gives the
same pixels. How it fits together: [docs/design.md](docs/design.md).

![The watch view mid-playback: the canvas, and the agent's commands on the tape beside it](docs/screenshots/watch-playback.png)

What it does:

- **Draw by command**: pixels, lines, shapes, fills, layers and frames, selections, symmetry,
  dithering, ramps and shading helpers, seeded texture generators, stamps and macros.
- **Check the work**: stray pixels, jaggies, pillow shading, outlines, seams and repetition on
  tiles, readability, animation, consistency across a set and more, each against the project's
  style guide and pointing at the pixels it flags ([docs/checks.md](docs/checks.md)).
- **Game art**: tiles, sprites with directions and animation, objects bigger than a cell,
  autotile families from data-driven schemes, maps, fonts and icons.
- **A whole set from a theme**: a manifest of every asset a game needs, each asset's status
  worked out from the project, blind review bundles, and a dashboard where people approve work
  and ask for more ([docs/pipeline.md](docs/pipeline.md)).
- **Export and import** through profiles (PNG, atlas, Tiled, Godot, Aseprite, or a game's own)
  ([docs/profiles.md](docs/profiles.md)).

## Quick start

You need Node.js 22.18 or later.

### Install

PixelClaw is not on npm yet. Build it from source (pnpm 10):

```sh
git clone https://github.com/retrodigio/pixelclaw.git
cd pixelclaw
pnpm install
pnpm build                 # builds the watch view and the bundled CLI in cli/dist
cd cli && npm pack && npm install -g ./pixelclaw-0.1.0.tgz && cd ..   # optional: `pixelclaw` on your PATH
```

Without the global install, run `node cli/dist/pixelclaw.js` wherever this README says
`pixelclaw`. Once it is published, `npm install -g pixelclaw` (or `npx pixelclaw`) will do.

### Make a project

```sh
pixelclaw new ~/art/my-game.pclaw --palette examples/src/mossy-ruins.json
pixelclaw new ~/art/my-game.pclaw tile slab 16x16 bg=stone1
pixelclaw run ~/art/my-game.pclaw --asset slab -e "rect 1,1 14x14 c=stone3 fill
line 1,1 14,1 c=stone4 ; line 1,14 14,14 c=stone2"
pixelclaw view ~/art/my-game.pclaw slab all     # renders into ~/art/my-game.pclaw/views
pixelclaw check ~/art/my-game.pclaw
```

Palettes can be `.json`, Lospec `.json`, `.hex` or `.gpl` files. The command language is in
[docs/commands.md](docs/commands.md).

### Connect Claude Code over MCP

Register the server with Claude Code, pointing at a project folder (created if missing):

```sh
claude mcp add pixelclaw -- pixelclaw serve --project ~/art/my-game.pclaw --port 7417
pixelclaw skill install          # the Claude Code skill: workflows, house rules, the review hand-off
```

(From a source checkout without the global install: `claude mcp add pixelclaw -- node
/path/to/pixelclaw/cli/dist/pixelclaw.js serve --project …`.) Start `claude` and ask it to draw.
Its tools are `project`, `run`, `view`, `check`, `seeds`, `changes`, `history`, `plan`,
`request`, `work`, `await_requests`, `review`, `export` and `import` ([docs/mcp.md](docs/mcp.md)).

### Feedback from the dashboard

A request made in the dashboard (*Draw this*, *Ask for changes*, *Add an asset*) is a note in the
project until an agent hears of it. An agent that works the project keeps a wait running in the
background and restarts it each time it exits:

```sh
pixelclaw await ~/art/my-game.pclaw          # blocks; prints what was asked and a cursor; exits
pixelclaw await ~/art/my-game.pclaw --since <cursor>
```

(or the MCP tool `await_requests`). The cards say **sent**, **seen by claude**, **working**, **done**,
and when nobody is listening they say that, with a prompt to paste into Claude Code. While a
server runs, `pixelclaw run` and the other writing commands are sent to it, so the dashboard keeps
updating live.

### Watch, edit and approve in the browser

The server prints a watch link to stderr, and the `project` tool returns it:
`http://127.0.0.1:7417/?token=…`. It listens on localhost only and needs the token. Open it to
watch the agent draw command by command. Draw in the page too, or pin a note on a pixel: the
agent's `changes` tool returns your lines, your notes and a diff image. The **Dashboard** tab shows
every planned asset by set with its status; approve work or ask for changes there.
`pixelclaw serve --project <dir> --no-mcp` opens a project in the browser without an agent.

![The dashboard: an example's planned assets by set, three of them drawn, reviewed, approved and exported](docs/screenshots/theme-dashboard.png)

### The worker (off by default; it spends money)

People can ask for work from the dashboard while no agent session is open. The optional
**worker** then runs a headless Claude Code session that has only PixelClaw's tools (no shell, no
files, no web) to work the queue. It is **off by default** because it **spends money on your
Anthropic account** through your Claude Code login. Turn it on per project in `project.json` with
a spending cap that covers every run (`"worker": { "enabled": true, "cap": 5 }`), then press
**Start Claude** in the dashboard or run `pixelclaw work <project>`. See
[docs/worker.md](docs/worker.md).

### Underlays from an image model (optional, OpenAI)

`underlay generate` can ask an image model for a reference picture to put under the canvas, which
`snap` then turns into a palette-true draft layer. The provider is OpenAI and needs your own key
in the environment, `OPENAI_API_KEY`; it is read from the environment only and never written to
disk. Each request is priced against a cost cap and logged. Nothing calls OpenAI unless you use
`underlay generate` with the `openai` provider; `underlay import <file.png>` works with any image
and no key. See [docs/mcp.md](docs/mcp.md#underlays-and-the-openai-provider).

## Walkthroughs

Each walkthrough comes with a stand-in agent script that drives `pixelclaw serve` over MCP the way
Claude Code would, so you can run it without an agent or an API key.

- [Watch and edit](examples/watch-and-edit.md): the agent draws a tile while you watch; you fix
  pixels and leave a note, and the agent reads them with `changes`.
- [Drawing, checks and a blind review](examples/drawing-and-checks.md): the drawing toolkit on a
  grass tile, its variants and a chest; the checks, fixes by coordinates and a blind review.
- [Animation and sprites](examples/animation.md): a walking figure in four directions and a
  shimmering water tile, played at the game's speed.
- [Tile sets, autotiling and maps](examples/tilesets-and-maps.md): a 47-variant shore family from
  a band profile and three pieces, then a village map with objects bigger than a cell.
- [Export, import and densities](examples/export-import.md): export through a sample profile and
  read it back exactly, Tiled maps, re-importing a sheet, and a house at twice the density.
- [From a theme to a whole set](examples/theme-to-set.md): a palette, style guide and manifest
  from one paragraph; assets taken from planned to exported; an underlay snapped into tiles; a
  pixel font and an icon set.
- [The work queue](examples/work-queue.md): a person imports a sheet and asks for work from the
  dashboard; the agent takes the requests; the fenced worker.
- [Map variety, 48 px tiles and art help](examples/map-variety.md): seed search and dry runs, the
  map-scale lattice check and mixed fills, 48 px sets, the pebble and tuft generators, cliff
  faces, lanes and shadows.

The example projects are checked in: [`examples/mossy-ruins.pclaw`](examples/mossy-ruins.pclaw)
(an original 16-colour "mossy ruins" set at 24 px), [`examples/kiln-hollow.pclaw`](examples/kiln-hollow.pclaw)
(a planned set with a manifest) and [`examples/ember-moor.pclaw`](examples/ember-moor.pclaw) (48 px).

## The CLI

| Command | Does |
|---|---|
| `pixelclaw new <project> [--palette <file>]...` | Create a project folder. Palettes can be `.json`, Lospec `.json`, `.hex` or `.gpl`. |
| `pixelclaw new <project> <kind> <name> <W>x<H> [opts]` | Create an asset (a `new` command). |
| `pixelclaw run <project> <script.pclaw>\|-\|-e "..." [--asset <name>] [--replace] [--by <who>] [--view <mode>] [--dry]` | Apply commands as one undo group. Any error applies nothing. `underlay generate`/`underlay import` lines are resolved first (an image provider or a file; the key from `OPENAI_API_KEY`). `--dry` applies to a copy, prints the checks and keeps nothing. |
| `pixelclaw seeds <project> <asset> <generator line> [--count N] [--from N] [--checks a,b] [--apply]` | Try the line with each seed as a dry run and rank the seeds by the checks; `--apply` runs the best. |
| `pixelclaw view <project> <asset> [render\|grid\|tile3x3\|diff\|game\|recolour\|anim\|map\|family\|density\|all] [--scale N] [--region x,y,WxH] [--frame N] [--marks failing] [--theme t]` | Write views and print the text grid (or the diff's list of changes). |
| `pixelclaw check <project> [<asset>...] [--checks a,b] [--marks]` | Run the quality checks against the style guide; exits 1 if any fails. See [docs/checks.md](docs/checks.md). |
| `pixelclaw export <project> [<asset>...] [--profile <name>] [--out <dir>]` | Write assets through an export profile (built-in `png`, `atlas`, `tiled`, `godot`, `aseprite-json`, `aseprite`, or the project's own). Refused while a server owns the project (export through its MCP `export`). See [docs/profiles.md](docs/profiles.md). |
| `pixelclaw export <project> <asset> --format split\|png\|strip\|bmfont [--out <dir>]` | One asset on its own: one-cell pieces, a PNG, or a font as a glyph strip or BMFont. |
| `pixelclaw import <project> <file.png\|file.aseprite\|folder> [--profile <name>] [--as <name>] [--grid WxH] [--slice WxH] [--set s] [--palette <p>\|--build]` | Make new assets from an image (quantised; a grid of frames, or `--slice` into one asset per cell, with manifest entries and checks), a folder of images or an `.aseprite` file, or read a profile's export back and compare. |
| `pixelclaw review <project> [<asset>...] [--set s] [--name n]` | Write a blind review bundle (images, palette, style guide, brief, rubric). |
| `pixelclaw plan <project> [--set s] [--order set\|scene] [--json] [--manifest <file>] [--templates]` | Requests from the dashboard first, then the asset plan and each asset's status, by set or scene by scene; write a manifest (checked first); draw the flat templates. See [docs/pipeline.md](docs/pipeline.md). |
| `pixelclaw request <project> [draw <asset> \| change <asset> --note "…" \| add <name> --kind k --size WxH …]`, `pixelclaw reply <project> <id> "<answer>"`, `pixelclaw cancel <project> <id>` | File, answer or withdraw requests as the dashboard does (validated the same way); without a kind, list what is open. See [docs/pipeline.md](docs/pipeline.md#requests-from-the-cli-and-mcp). |
| `pixelclaw work <project> [--port N]` | Work the request queue with a headless Claude Code session that has only PixelClaw's tools (no shell, files or web), up to the project's budget cap; only when the project enables it. See [docs/worker.md](docs/worker.md). |
| `pixelclaw skill install [--dest <dir> \| --project <dir>]` | Install the Claude Code skill (default `~/.claude/skills/pixelclaw`). |
| `pixelclaw verify <project> [<asset>...]` | Replay every tape and compare it with the saved state, the preview, the checkpoints and the state cache. |
| `pixelclaw upgrade <project> [<asset>...]` | Rewrite tapes from tape language 1 in language 2 (the palette in the `new` line); written only if the replay gives the same pixels, then verified. |
| `pixelclaw await <project \| watch-url> [--timeout s] [--since cursor]` | Wait for requests and feedback from the dashboard, print them, exit (3 on timeout). |
| `pixelclaw serve --project <project> [--port 7417] [--no-mcp]` | Own the project: MCP on stdin/stdout and the live watch view on localhost (the link, with its token, is printed to stderr). See [docs/mcp.md](docs/mcp.md). |

The command language is described in [docs/commands.md](docs/commands.md).

## A project folder

```
my-art.pclaw/
  project.json              name, tick rate, default palette, the style guide's check settings, preview themes
  style.md                  the style guide in words
  manifest.json             the asset plan (docs/pipeline.md)
  exported.json             each asset's last export (profile, folder, art hash), for its status
  templates/                flat templates drawn from the manifest: mockup screen, coverage maps
  palettes/<name>.json      entries (key, name, hex or role) and ramps
  assets/<name>/
    asset.json              kind, size, cell grid, wrap, palette, layers, frames, stamps, macros, open notes, fork link, state hash
    tape.jsonl              the history: one command per line, with its author
    preview.png             the current image at 1x (frame 1)
    checkpoints/            the state every 200 commands (NNNNNN.gwc): fast loading, checked by verify
  views/                    renders written by 'pixelclaw view' and the MCP 'view' and 'changes' tools
  reviews/<date>-<set>/     blind review bundles (and the findings brought back)
  reads.json                how far each agent has read each tape (for 'changes')
  .pixelclaw.lock           present while a server owns the project (not for git; no token in it)
  .cache/state/<asset>.gwc  each asset's state after its tape, keyed by the tape (never committed)
```

## Packages

- `core`: the document (layers, frames, each author's context), palettes, the command parser and
  normaliser, raster operations, helpers and generators, tape and replay, a PCG random generator,
  the checks, renders and previews, autotile schemes (data in `core/schemes`), families, maps,
  export profiles (data in `core/profiles`), and PNG and GIF encoders. It uses no DOM or Node
  APIs, so it runs anywhere.
- `server`: the project folder, the single writer (one queue for every command), views, the MCP
  server and the HTTP + WebSocket server for the watch view, and the worker.
- `ui`: the watch view, editor and dashboard (Vite + React + canvas 2D). It replays the tape with
  `core` itself, and its tools write commands that `core` previews before they are sent.
- `skill/`: the Claude Code skill (`pixelclaw skill install`).
- `cli`: the `pixelclaw` command. `pnpm build` bundles it with `core`, `server` and the built UI
  into `cli/dist` (no runtime dependencies), which is what the npm package ships.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) (and [CLAUDE.md](CLAUDE.md) for coding agents). Report
security problems as described in [SECURITY.md](SECURITY.md). Changes are listed in
[CHANGELOG.md](CHANGELOG.md).

## Licence

MIT. See [LICENSE](LICENSE). The built package bundles a few permissively licensed packages (the
MCP SDK, zod, React); their licences are written to `cli/dist/THIRD_PARTY_LICENSES.txt`.
