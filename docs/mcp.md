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

All ten tools (`project`, `run`, `view`, `check`, `review`, `plan`, `export`, `import`, `history`, `changes`) go through the writer's queue. Errors come back as tool errors (`isError`) with a
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
| `view` | `render` \| `grid` \| `tile3x3` \| `diff` \| `game` \| `recolour`, optional | Also return this view of the result. |
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
checks: palette 0 ✓ · orphans 0.5% ✓ · jaggies 0 ✓ · seam 0.41 ✓ · coverage 0 ✓ · repetition 3.4 ✗  (1 failing: `check` gives coordinates)
```

If any line has an error, nothing is applied and every error is listed with its line and column:

```
2:10: error: unknown colour 'gold' (palette 'mossy-ruins': ink, stone0, …, none)
1 error; nothing was applied.
```

Warnings so far: `the batch changed no pixels`. The last line is the check summary: every check that
applies to the asset, with its score and ✓ or ✗ against the style guide (see [checks.md](checks.md)).

### `view`

| Argument | Type | Does |
|---|---|---|
| `asset` | string | |
| `mode` | `render` (default) \| `grid` \| `tile3x3` \| `diff` \| `game` \| `recolour` \| `anim` \| `map` \| `family` | See [commands.md, Views](commands.md#views). `game` shows the sprite's other directions beside it. `anim` returns the contact sheet (a row per sequence; each frame with its ticks, the frame before it tinted red underneath, the pivot and ground line in cyan, and the share of pixels changed from the frame before), the numbers as text, and saves `views/<asset>.anim.gif` (every sequence side by side at the project's tick rate) for the person. `map` puts a family on a random island (a tile: repeated; an overlay: over the first family or `ground=`) at the game's draw scale, with the seam score over the map and the variants it used as text, and saves `views/<asset>.map.gif` (at most four seconds) when its frames or overlays move. `family` shows every variant among the 3x3 neighbours that call for it, and lists where every cell is on the sheet. `map` of a **map document**: the whole map at 1x (or `region=` cells, or `camera=` the engine's screen around a cell, at the draw scale), its layers and placements and every cell as a character grid; `marks="failing"` outlines the map checks' hot spots. `map` of an **object**: it stands on its ground (`ground=`) among plain tiles at game scale, its footprint in words. `diff` of a map: before and after of the cells that changed, at game scale, and what moved, was placed or taken away, or painted. |
| `scale` | 1..64, optional | `render` and `diff`. Default: about 192 px on the long side. |
| `region` | string, optional | `grid`: `"x,y WxH"`, e.g. `"8,0 12x10"`. `map` of a map document: cells to show at game scale. |
| `camera` | string, optional | `map` of a map document: `"x,y"`, the camera's view around that cell (project.json `style.camera`, default `384x216` art pixels), at game scale. |
| `since` | integer, optional | `diff` only: compare with the document after this command (default: before the latest group). |
| `frame` | integer from 1, optional | The frame to show. Default: the frame the agent draws on (`frame <n>`). |
| `marks` | string, optional | `render`, `tile3x3`, `game`: circle the pixels checks flag in magenta: `"failing"`, or check names (`"orphans,jaggies"`). |
| `theme` | string, optional | `render`, `tile3x3`, `game`: show role entries under this preview theme. |
| `themes` | string[], optional | `recolour`: the themes to show (default: the first six). |
| `ground` | string, optional | `game`: the ground tile (default: the style guide's, else the first tile). |
| `with` | string[], optional | `game`: the assets beside this one (default: its set, the same kind and size). `map`: overlays to play over the map. |
| `size` | string, optional | `map`: the map's size in tiles, `"16x12"` (default 12x10). |
| `seed` | integer, optional | `map`: the random island's seed (default 1). |

Images come back inline (`image/png`) with a line giving their size and the file they were saved
to (`<project>/views/<asset>.<mode>.png`, overwritten each time). The grid comes back as text and
is saved as `.txt`. The diff comes back as an image plus the list of changed pixels. Every image returned to the agent, from `view` or from `run`'s `view`, becomes
"Claude's eye" in the watch view.

### `check`

The full check table for an asset (see [checks.md](checks.md)): each check's mark, score,
threshold and finding, and under a failing one the pixels it flags, by what is wrong with them.
With failures it also returns the render (tile3x3 for tiles) with those pixels circled in magenta.

| Argument | Type | Does |
|---|---|---|
| `asset` | string, optional | The asset to check. Without one: one summary line per asset. |
| `checks` | string[], optional | Only these checks. |
| `frame` | integer from 1, optional | Only this frame (default: every frame; flagged pixels name their frame, and the image shows the frame of the first failing check). |
| `ground` | string, optional | `readability`: the ground tile. |
| `ref` | string, optional | `revert`: the reference asset. |
| `set` | string[], optional | `readability`: the assets its silhouette must differ from. |
| `image` | boolean, optional | Return the marked image (default: when something fails). |

```
glowcap: 5 of 7 checks failing
  ✗  palette     4      ≤ 0     4 px outside the style palettes (mossy-ruins, ruins-props): glow #ff4fd8 is not in the style palettes (4)
       glow #ff4fd8 is not in the style palettes: 9,7 10,7 14,9 15,9
  ✗  orphans     1.2%   ≤ 1%    3 stray px in 245 (3 lone, 0 near-orphans)
       lone pixel (no neighbour shares its colour): 6,2 20,20 3,21
  …
  ✓  coverage    0      ≤ 0     1 frame, every cell drawn, size 24x24 (autotile names come with schemes)
  –  seam        skipped: not a wrap (tile) document
```

### `review`

Write a blind review bundle under `reviews/<date>-<set>/` (see [checks.md](checks.md#the-review-bundle)):
`assets` (default all), `set` (a manifest set: its drawn assets, with `brief.md` from the manifest)
and `name` (default the set, else `all`); for families, `size` and `seed` choose the
island they are shown on (default 16x12, seed 1). Hand the folder to a fresh agent with no other
context, ask it to follow `rubric.md`, and pin its findings on the pixels with `note` commands.

### `plan`

The asset plan (`manifest.json`) and each planned asset's status by set: planned, drafted,
checked, reviewed, approved, exported, with what it needs next and why it is not further on
(failing checks, a stale mark or export, changes a person asked for); `set` shows one set.
`manifest` writes a manifest, checked against its schema first (nothing is written when it has
problems, each listed with its path). `templates: true` draws the flat templates (the mockup
screen, returned inline, and a coverage map per family) into `templates/`. The result ends with
the dashboard's link. See [pipeline.md](pipeline.md).

### `export`

Write assets through an export profile (see [profiles.md](profiles.md)); each asset written is
recorded in `exported.json` for its status: `profile` is a built-in
(`png`, `atlas`, `tiled`, `godot`, `aseprite-json`, `aseprite`), one of the project's
(`profiles/*.json`) or a profile file's path (default `png`); `assets` (default all; a map brings
the families, tiles and objects it draws, and every asset its texture variants and density
copies); `dest` (a game folder; default `<project>/exports/<profile>/`). The result lists the
files and notes (levels scaled or reduced for want of an authored copy, two entries written as one
colour). `format=split|png` with `asset` writes one asset G8's way instead: `split`, an oversized
tile or object as one-cell pieces `<name>_<cx>_<cy>.png` plus `<name>.stamp.json` (each cell's
block, roof and footprint flags); `png`, a map composed at 1x or an asset's first frame. CLI:
`pixelclaw export <project> [<asset>...] [--profile <name>] [--out <dir>]`, or
`pixelclaw export <project> <asset> --format split|png`.

### `import`

Bring art in (see [profiles.md](profiles.md#import)). `path` is a PNG (a new asset quantised to
`palette`, default the project's; `build: true` makes a palette from the image; `grid: "24x24"`
slices a sheet into frames, `cells: true` keeps it one image with that cell grid), an `.aseprite`
file (layers, frames, durations, tags, views), or with `profile` a folder an export wrote: each
image read back by name into the asset it came from, and the result says which assets read back
exactly and which differ; images no asset exports become new assets. `as` names a new asset
(default the file's name), `kind` sets its kind (default `sprite`), `replace` starts an existing
asset's tape again. A new asset's tape starts with `import` commands; the file is kept under
`blobs/`. CLI: `pixelclaw import <project> <path> [--profile] [--as] [--kind] [--palette|--build] [--grid WxH [--cells]] [--replace]`.

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

Open the link (with its token). Two tabs in the header: **Editor** (below) and **Dashboard**, the
plan by set with each asset's status, where a person approves work or asks for changes (both are
`mark` commands on the asset's tape with their name; see [pipeline.md](pipeline.md#the-dashboard)).
`&tab=dashboard` in the link opens it. The editor shows:

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
  layer and frame; the flags beside a layer toggle hidden, locked and reference. Above the cels:
  each frame's number and ticks, the views (a mirror shows as `W ⇋ E`) and the tags. Linked cels
  show as ◆, mirror frames as ⇋. ▶ (or Enter) plays the chosen sequence at the game's speed;
  the onion skin shows the frame before (red) and after (blue) yours in its view or tag; ⌖ shows
  the pivot and ground line. Playing, the onion skin and the guides only change what you see.
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
- **Checks** (header): a chip per check that applies, green or red, with its score. Click one to
  circle its flagged pixels on the canvas in magenta and open its details under the toolbar: the
  finding, the flagged pixels by kind and their coordinates, and **📌 note**, which pins them as
  notes for the agent (one per cluster of pixels, in one undo group). Checks are worked out in the
  page with the project's style guide, so they follow time travel and match the agent's `check`.
- **Preview** (right): `3x3` for tiles (the tile repeated, at 1x and 2x), `game` for sprites (on
  the ground beside the set, at 1x and the draw scale), and `themes` (the art under the preview
  themes). Role art also gets a **theme** menu under the palette, which recolours the canvas;
  only for looking, nothing is written. Double-click a swatch to give an entry a role (`palette
  set <entry> role=…`).
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
  ✕ removes it. Shift+click frame numbers to choose a run of them; double-click a frame number
  to set its ticks (or the chosen frames': `frame set 1-2 ticks=9`). For the chosen frames: ⛓
  links your layer's cels (`cel link 1-2 layer=main`), ⛓̸ unlinks them, *view…* makes them a
  direction (`view E frames=1-2`), *mirror…* adds a live mirror (`view W mirror=E`), and a name in
  *tag* tags them (`tag add walk 1-2 loop=cycle`). On the bands: ↻/⇄ switches a tag's loop
  (`tag set walk loop=pingpong`), ✕ removes a tag or view or ends a mirror. The ⌖ tool (P) sets
  the pivot with a click (`pivot 11,22`) and the ground line with Shift+click (`ground 22`).
- **Undo / Redo** (buttons, Ctrl/⌘+Z, Ctrl/⌘+Shift+Z or Ctrl+Y) take back only your own groups:
  they write `undo by=human:<you>` and `redo by=human:<you>`, which the tape records as
  `undo group=h3` and `redo group=h7`.

### Families and the timeline

On a family the toolbar switches the middle of the page between **sheet** (the canvas: draw on the
pieces, layer `band` by default; the toolbar names the cell under the pointer, as `@cell(<name>)`
takes it), **variants** (every variant in the middle of the neighbours that call for it, pieces
and detached variants marked, with *detach*/*attach* on each, and *coverage map* and *cut from
map* when the family has a map area) and **map** (a random island at the game's draw scale, its
size and seed to choose, the project's overlays to play over it, the seam score and the variants
used above it). Detach, attach, coverage and cut are commands on the tape; the map's size, seed,
overlays and playing only change what you see. The preview panel shows a small island for a
family, and an overlay over the first family.

Every row of the timeline folds (only for looking): click *frame · ticks*, *views*, *tags* or
*layers* (folded, only the layer you draw on stays), or ▾ at the left of its bar to fold the
whole timeline away.

### Maps

A map document opens in the **map editor** instead of the canvas: the map drawn from the assets
it names, at 1x or the game's scale. *✎ paint* and *⌫ erase* drag over cells of the chosen terrain
layer (`terrain <layer> brush …`), *▭ rect* paints a rectangle (Shift: erases it), *⊕ place* puts
the chosen object or tile by its anchor cell (its footprint outlined under the pointer; an overlap
is refused with the reason), *✣ move* drags something placed to another cell (`move x,y x,y`),
*✕ remove* takes it away. Each is one line on the tape, written as you. *▣ camera* stands the
camera on a cell (the engine's screen outlined; *camera view* shows only it, at game scale),
and *hot spots* outlines the cells the map checks flag; the zoom, the camera and the hot spots
are only for looking. The line under the tools names the cell under the pointer: its ground
tile and anything placed on it.

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
