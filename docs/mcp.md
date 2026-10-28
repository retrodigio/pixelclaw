# The MCP server and the watch view

`pixelclaw serve` owns one project folder. It is the project's single writer: every command, from
the agent or from a person in a browser, goes through one queue in the order it arrives, is saved
to the tape with its author, and is then streamed to every open page.

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

All five tools go through the writer's queue. Errors come back as tool errors (`isError`) with a
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
  stone_floor: tile 24x24 wrap, palette mossy-ruins, 75 commands in 12 groups; open notes: n1
```

### `run`

Apply command text (see [commands.md](commands.md)) to an asset as one undo group.

| Argument | Type | Does |
|---|---|---|
| `asset` | string | The asset to draw on. To create it, start the commands with `new <kind> <asset> <W>x<H> …`. |
| `commands` | string | One or more lines of the command language. |
| `view` | `render` \| `grid` \| `tile3x3` \| `diff`, optional | Also return this view of the result. |
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
| `mode` | `render` (default) \| `grid` \| `tile3x3` \| `diff` | See [commands.md, Views](commands.md#views). |
| `scale` | 1..64, optional | `render` and `diff`. Default: about 192 px on the long side. |
| `region` | string, optional | `grid` only: `"x,y WxH"`, e.g. `"8,0 12x10"`. |
| `since` | integer, optional | `diff` only: compare with the document after this command (default: before the latest group). |
| `frame` | integer from 1, optional | `render`, `grid`, `tile3x3`: the frame to show. Default: the frame the agent draws on (`frame <n>`). |

Images come back inline (`image/png`) with a line giving their size and the file they were saved
to (`<project>/views/<asset>.<mode>.png`, overwritten each time). The grid comes back as text and
is saved as `.txt`. The diff comes back as an image plus the list of changed pixels. Every image returned to the agent, from `view` or from `run`'s `view`, becomes
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

### `changes`

What people did in the watch view since the agent last called `changes` (plan §1.3, §8.2).

| Argument | Type | Does |
|---|---|---|
| `asset` | string, optional | Only this asset (default: every asset). |
| `since` | integer, optional | Read from after this command instead of the stored position. |

For each asset with new lines by other authors, it returns:

- the lines, each with its number, author and group (the agent's own lines are left out; how many
  were in the same range is said, since the diff includes them);
- the open notes, with the new ones marked;
- the diff, as text (up to 60 pixels as `x,y from→to`) and as an image: before and after, changed
  pixels outlined in magenta, notes in yellow. The image is saved as `views/<asset>.diff.png` and
  becomes Claude's eye in the watch view.

```
Changes since you last looked: 1 asset (stone_floor).
stone_floor: 4 commands (4 by human:chris) since #71; now at #75
#72 human:chris h1  stroke pencil c=moss1 pp=on 12,8
#73 human:chris h2  stroke pencil c=moss1 pp=on 13,8
#74 human:chris h3  stroke pencil c=moss1 pp=on 14,8
#75 human:chris h4  note 9,8 3x1 "carry the moss on along this joint, a shade darker (moss0)" id=n1
open notes (1):
  n1 at 9,8 3x1: "carry the moss on along this joint, a shade darker (moss0)"  (new)
diff #71 → #75: 3 px changed:
  12,8 stone1→moss1
  13,8 stone1→moss1
  14,8 stone1→moss1
[image]
diff image: 408x208 px, saved /…/views/stone_floor.diff.png
```

Then the read position moves to the end of every tape, so a second call says `No changes since
you last looked.` The positions are kept per agent in `<project>/reads.json` (so a restarted
server still knows them; leave it out of git if you like). On a tape the agent has never read,
reading starts after the agent's own first commands (it wrote them), and on a branch it starts at
the fork point. The agent's own commands straight after its position count as read too.

The server's instructions ask the agent to call `changes` at the start of each turn while someone
is watching, to carry on from what they did, and to close notes it has dealt with (`note done n1`).

## The watch view

Open the link (with its token). The page shows:

- **Assets** (left), with a dot on assets that have commands still to play (branches show `⑂`
  and their source). With **follow** on (the default), the view moves to whichever asset the
  agent is drawing on once the current one has caught up. Follow turns off when you start editing,
  so the canvas never switches away under you.
- **Tools**, the **palette** and the document's **stamps** (left), for editing; see below.
- **The canvas**: zoom 1–64x (−/+, Fit, or Ctrl/⌘ + wheel), a pixel grid from 4x (stronger every
  8 px) and the cell grid (magenta) on sheets. Transparent pixels show as a grey checkerboard;
  visible reference layers show faded underneath. On wrap documents, **wrap ghosts** show half a
  tile of the neighbouring copies all round (you can draw on them; the strokes wrap). Your
  selection has marching ants, other authors' selections are tinted, and live symmetry shows
  its axes as dashed guides.
- **The timeline** (under the canvas): layers (top first) by frames. Click a cel to draw on that
  layer and frame; the flags beside a layer toggle hidden, locked and reference.
- **The tape** (right): every command, grouped by undo group and coloured by author (the agent in
  orange, people in blue). The list is virtualised, so a tape of 10,000 lines scrolls freely. Each batch plays command by command at the chosen speed
  (1–60 commands a second, or instant); the line being drawn is highlighted and lines still to play
  are dimmed. **Pause** holds playback (new commands keep arriving); **Jump to live** shows
  everything at once and resumes.
- **Time travel**: click any tape line to see the document right after it, read-only. **Back to
  live** returns. **Branch here** makes a new asset from that point (a `fork`) and opens it.
  Earlier states come from snapshots kept every 100 commands, so travelling is quick on long tapes.
- **The command line** under the tape runs any commands on the shown asset, as you.
- **Notes**: the open notes, with who wrote them; ✓ closes one.
- **Claude's eye**: the last image the agent was shown (a view, or the diff `changes` returned).
  Click it to enlarge.

Several browsers can watch, and edit, at once; they all receive the same stream.

### Editing

Your edits are written as `human:<name>`: click **you:** in the header to set the name (it is
remembered in the browser; `?name=chris` in the link sets it too). Every action becomes the same
command text the agent would write (see [commands.md](commands.md)), sent to the single writer as
one batch, one undo group (`h1`, `h2`, …). While you drag, the canvas shows the batch applied by
core to a copy, so what you see is exactly what will be logged. Editing is off while time
travelling.

| Tool | Key | Writes |
|---|---|---|
| Pencil | B | `stroke pencil c=… pp=on x,y …` (one drag; pixel-perfect can be turned off) |
| Eraser | E | `stroke eraser x,y …` |
| Line | L | `line a b c=…` |
| Rectangle | U | `rect x,y WxH c=… outline` (F toggles `fill`) |
| Ellipse | Shift+U | `ellipse x,y WxH c=… outline` (F toggles `fill`) |
| Fill | G | `fill x,y c=…` |
| Gradient | Shift+G | drag from where colour A starts to where colour B ends: `gradient <your selection's box, or the canvas> ramp=<A to B along their ramp> dir=… pattern=…` |
| Dither | D | drag a box: `dither x,y WxH a=<B> b=<A> pattern=… level=…` |
| Colour picker | I, or Alt+click | nothing: it picks colour A |
| Rectangle select | M | `select rect x,y WxH`; drag inside it to move it (`shift dx,dy`) |
| Ellipse select | Shift+M | `select ellipse x,y WxH` |
| Lasso | Q | `select lasso x,y x,y …` (the drag, straight runs merged) |
| Magic wand | W | `select wand x,y mode=contiguous\|global conn=4` (on your layer; **whole colour** in the options bar is `global`) |
| Move | V | `shift dx,dy` (your selection, or your whole layer); arrow keys nudge by 1 |
| Stamp | S | click: `stamp <name> x,y` (the stamp chosen in **Stamps**, centred on the click) |
| Note | N | click a pixel or drag a region, write, **Pin note**: `note x,y [WxH] "text"` |

With the selection tools, Shift adds to your selection and Alt subtracts (`… add`, `… sub`).
Selections are commands at once and they are yours alone: they clip only your drawing, and
Ctrl/⌘+Z takes them back like any edit (as in Aseprite). Esc or Ctrl/⌘+D writes `deselect`,
Ctrl/⌘+A `select all`, Ctrl/⌘+Shift+I `select invert`; Delete clears the selected pixels (`clear`).

The **options bar** under the toolbar holds the tool's options (filled, pixel-perfect, the brush
shape and size, whole colour, the gradient and dither patterns and level), **mirror** ⇹ ⇵ (live
symmetry across the middle, with guides on the canvas), and actions on your selection or, with
nothing selected, your whole layer: flip ⇋ (Shift+H) and ⇵ (Shift+V), rotate 90° (Shift+R),
outline in colour A (`outline c=…`), and `clean orphans`.

Your **layer, frame, symmetry and brush** are kept in the page. When they differ from yours in the
document, your next edit starts with the lines that set them (`layer rim`, `frame 2`, `mirror
x=11.5 live`, `brush square 2`, or `mirror off`, `brush off`), in the same group. So choosing a
layer or turning symmetry on writes nothing by itself, and never changes what the agent draws on.

- **Palette**: click a swatch for colour A (drawing), right-click for colour B (the end of a
  gradient, the ground of a dither); X swaps them. `none` draws transparent. Double-click a swatch
  to change its colour (`palette set`), or **+** to add one (`palette add`). **lock** writes
  `palette lock` (then editing is off until **unlock**).
- **Stamps**: the document's stamps; click one, then click the canvas (S). **+ from selection**
  saves your selection's box as a new stamp (`stamp save <name> x,y WxH`; unselected pixels are
  left out).
- **Timeline**: **+** adds a layer above yours (`layer add <name> above=…`), ↑ ↓ move yours
  (`layer move`), ⤓ merges it into the one below (`layer merge`), ✕ removes it; the flags write
  `layer set <name> hidden=|locked=|reference=on|off`; double-click a name to rename it. Frames:
  ◀ ▶ (or [ and ]) step through them, **+** adds a copy of yours after it (`frame add n copy=m`),
  ✕ removes it.
- **Undo / Redo** (buttons, Ctrl/⌘+Z, Ctrl/⌘+Shift+Z or Ctrl+Y) take back only your own groups:
  they write `undo by=human:<you>` and `redo by=human:<you>`, which the tape records as
  `undo group=h3` and `redo group=h7`.

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
| `result` | To one page only: the answer to its `run` (ok with the group, or the errors). |

A page sends:

| Message | Does |
|---|---|
| `{"type":"run","id":7,"asset":"slab","commands":"…","by":"human:chris"}` | Apply the commands as one batch. `by` must be `human:<name>` (letters, digits, `.`, `_`, `-`). A page cannot start an existing asset's tape again. The batch goes to every page like any other; the `result` with the same `id` goes back to the sender. |
| `{"type":"ping"}` | Answered with `pong`. |

The page replays tape lines itself with the core library, so what it draws is what the core
computes; the server sends commands, not pixels. A person's batch is shown at once rather than
played command by command.
