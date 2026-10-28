# The MCP server and the watch view

`pixelclaw serve` owns one project folder. It is the project's single writer: every command, from
the agent or (from G3) a browser, goes through one queue in the order it arrives, is saved to the
tape, and is then streamed to every open page.

```
pixelclaw serve --project <dir> [--port 7417] [--no-mcp]
```

- **MCP** on stdin/stdout, through the official TypeScript SDK (`@modelcontextprotocol/server`).
  Both the 2025 (`initialize`) and the newer protocol openings are served.
- **The watch view** on `http://127.0.0.1:<port>/?token=<token>`. The port is 7417 by default; if
  it is taken, the next free one up to 7436 is used. `--port 0` picks any free port.
- Logs go to **stderr** (stdout carries MCP): `pixelclaw: watch at http://127.0.0.1:7417/?token=…`.
- If the folder has no `project.json`, an empty project is created. Add palettes with the
  `project` tool.
- When the agent disconnects (stdin closes), or on Ctrl-C, the server stops.
- `--no-mcp` serves only the watch view, for looking at a project without an agent.

## Connecting Claude Code

From a clone of this repo (`pnpm install && pnpm build`):

```sh
claude mcp add pixelclaw -- node /path/to/pixelclaw/cli/dist/pixelclaw.js serve --project ~/art/mossy-ruins.pclaw --port 7417
```

From a packed tarball (`cd cli && pnpm pack` writes `pixelclaw-0.2.0.tgz`):

```sh
claude mcp add pixelclaw -- npx -y --package /path/to/pixelclaw-0.2.0.tgz pixelclaw serve --project ~/art/mossy-ruins.pclaw --port 7417
```

Once the package is on npm, this is the plan's line:

```sh
claude mcp add pixelclaw -- npx -y pixelclaw serve --project ~/art/mossy-ruins.pclaw --port 7417
```

Claude Code starts the server with the session. The server's instructions ask Claude to call
`project` first and give you the watch link; you can also ask for it ("give me the PixelClaw
link").

## Tools

All four tools go through the writer's queue. Errors come back as tool errors (`isError`) with a
plain message.

### `project`

Show the open project: its palettes (each entry as `key=name`, and the ramps), its assets (kind,
size, wrap, palette, commands and groups) and the watch link.

| Argument | Type | Does |
|---|---|---|
| `path` | string, optional | Open another project folder and make it the current one. Open pages switch to it. |
| `create` | boolean, optional | With `path`: create the project if it does not exist. |
| `name` | string, optional | With `create`: the project's name (default: the folder name without `.pclaw`). |
| `palettes` | string[], optional | Palette files (`.json`, Lospec `.json`, `.hex`, `.gpl`) to add. The first becomes the default if the project has none. |

```
project 'mossy-ruins' at /Users/me/art/mossy-ruins.pclaw
watch live: http://127.0.0.1:7417/?token=3f9c…  (give this link to the person watching)

palette mossy-ruins (default): 16 colours
  k=ink 0=stone0 1=stone1 2=stone2 3=stone3 4=stone4 5=stone5 a=moss0 …
  ramps: stone [stone0 stone1 stone2 stone3 stone4 stone5]; moss [moss0 moss1 moss2 moss3 lichen]; …

assets (1):
  stone_floor: tile 24x24 wrap, palette mossy-ruins, 71 commands in 8 groups
```

### `run`

Apply command text (see [commands.md](commands.md)) to an asset as one undo group.

| Argument | Type | Does |
|---|---|---|
| `asset` | string | The asset to draw on. To create it, start the commands with `new <kind> <asset> <W>x<H> …`. |
| `commands` | string | One or more lines of the command language. |
| `view` | `render` \| `grid` \| `tile3x3`, optional | Also return this view of the result. |
| `replace` | boolean, optional | With a leading `new` for an asset that exists: start its tape again. |

The result lists the commands as written to the tape (normal form, with their numbers), the
pixels changed, the totals and any warnings, then the view if one was asked for:

```
stone_floor: applied 6 commands as group g2; 462 px changed
#2 claude g2  rect 6,1 10x7 c=stone3 fill
#3 claude g2  rect 17,1 12x7 c=stone3 fill
…
tape: 7 commands in 2 groups
warnings: none
```

If any line has an error, nothing is applied and every error is listed with its line and column:

```
2:10: error: unknown colour 'gold' (palette 'mossy-ruins': ink, stone0, …, none)
1 error; nothing was applied.
```

Warnings so far: `the batch changed no pixels`. The check summary of plan §8.2 joins the result
when the checks exist (G5).

### `view`

| Argument | Type | Does |
|---|---|---|
| `asset` | string | |
| `mode` | `render` (default) \| `grid` \| `tile3x3` | See [commands.md, Views](commands.md#views). |
| `scale` | 1..64, optional | `render` only. Default: about 192 px on the long side. |
| `region` | string, optional | `grid` only: `"x,y WxH"`, e.g. `"8,0 12x10"`. |

Images come back inline (`image/png`) with a line giving their size and the file they were saved
to (`<project>/views/<asset>.<mode>.png`, overwritten each time). The grid comes back as text and
is saved as `.txt`. Every image returned to the agent, from `view` or from `run`'s `view`, becomes
"Claude's eye" in the watch view.

### `history`

Read an asset's tape.

| Argument | Type | Does |
|---|---|---|
| `asset` | string | |
| `from`, `to` | integer, optional | Command numbers (inclusive). |
| `last` | integer, optional | Only the last N of the selection. Default 50 when neither `from` nor `to` is given. |

```
stone_floor: 73 commands in 10 groups; undone: g9
#72 claude g9  px 0,0 c=ink   (undone)
#73 claude g10  undo group=g9
```

Undo is a command: `run` with `undo` or `undo group=g4`.

## The watch view

Open the link (with its token). The page shows:

- **Assets** (left), with a dot on assets that have commands still to play, and the palette of the
  asset on show. With **follow** on (the default), the view moves to whichever asset the agent is
  drawing on once the current one has caught up.
- **The canvas**: zoom 1–64x (−/+, Fit, or Ctrl/⌘ + wheel), a pixel grid from 4x (stronger every
  8 px) and the cell grid (magenta) on sheets. Transparent pixels show as a grey checkerboard.
- **The tape** (right): every command, grouped by undo group and coloured by author (the agent in
  orange, people in blue from G3). Each batch plays command by command at the chosen speed
  (1–60 commands a second, or instant); the line being drawn is highlighted and lines still to play
  are dimmed. **Pause** holds playback (new commands keep arriving); **Jump to live** shows
  everything at once and resumes.
- **Time travel**: click any tape line to see the document right after it, read-only. **Back to
  live** returns.
- **Claude's eye**: the last image the agent was shown. Click it to enlarge.

Several browsers can watch at once; they all receive the same stream.

### Security

- The server listens on 127.0.0.1 only and answers only to `127.0.0.1`, `localhost` and `[::1]`
  host names (so a web page can't reach it through DNS rebinding).
- A random token is made at each start. The page, `/api/state` and the WebSocket `/ws` need it;
  without it the page explains where to find the link. The page's scripts and styles
  (`/assets/…`) are public: they hold no art.
- While running, the server writes `<project>/.pixelclaw.lock` (its pid and URL, without the
  token). CLI commands that write (`new`, `run`) refuse to touch a project a live server owns;
  `view` and `verify` still work. Add `.pixelclaw.lock` to a project's `.gitignore`.

### The stream

The page and the server talk JSON over the WebSocket (types in
[`server/src/protocol.ts`](../server/src/protocol.ts)):

| Message | When |
|---|---|
| `hello` | On connect, and when `project` switches folders: palettes, every asset's tape, the last eye image. |
| `batch` | After each applied batch: the asset, author, group, the new tape entries (or the whole tape after a `new`, with `reset`), and the pixels changed. |
| `eye` | When an image view is returned to the agent: the PNG (base64), its size and path. |
| `palettes` | When palettes are added. |

The page replays tape lines itself with the core library, so what it draws is what the core
computes; the server sends commands, not pixels.
