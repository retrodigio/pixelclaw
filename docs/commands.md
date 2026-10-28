# Command reference (language version 1)

PixelClaw documents are edited with a small line-based command language. The same text works from
the CLI (`pixelclaw run`), the MCP server (`run`) and the watch view, whose tools write these
commands too. Every command is written to the asset's tape in its **normal form** (defaults filled
in, colours by name), so replaying the tape gives the same pixels even if a default changes later.

## Syntax

- One command per line, or several on a line separated by `;`.
- `#` starts a comment at the start of a line or after a space. `c=#aabbcc` is a colour, not a
  comment.
- Points are `x,y` from the top-left (negative values are allowed). Sizes are `WxH`.
- Options are `key=value`; flags are bare words (`fill`, `outline`).
- `@cell(cx,cy)` after the command name offsets every coordinate to that cell of the cell grid.
- On a `wrap=on` document, coordinates past an edge wrap around; otherwise they are clipped.

### Colours

`c=` takes a palette entry **name** (`c=stone3`), its one-character **key** (`c=3`), the exact
**hex** of an entry (`c=#6c7570`), or `none` (transparent). A hex that is not in the palette is
refused: `c=#ff00ff is not in palette 'mossy-ruins'`. The tape always records the name.

### Batches and errors

A `run` is one batch, logged as one undo group. If any line has an error, nothing in the batch is
applied, and every error is reported with its line and column:

```
floor.pclaw:2:10: error: unknown colour 'gold' (palette 'mossy-ruins': ink, stone0, ...)
floor.pclaw:3:10: error: line: expected an end point x,y
2 errors; nothing was applied.
```

### Authors and groups

Every tape line records its author (`by`): `claude` for the agent, `human:<name>` for a person in
the watch view. Groups are numbered per kind of author, each with its own counter: the agent's
(and scripts') groups are `g1`, `g2`, …, and people's are `h1`, `h2`, …. One action in the watch
view (a pencil drag, a fill, a move, a palette edit, a note) is one group.

## Commands

| Command | Normal form | Notes |
|---|---|---|
| `new <kind> <name> <W>x<H> [palette=] [wrap=] [cell=] [bg=]` | `new tile floor 24x24 palette=mossy-ruins wrap=on cell=24x24 bg=none` | First command of a tape only. Kinds: `tile`, `sprite`, `sheet`, `icon`. `wrap` defaults to `on` for tiles, `off` otherwise. `cell` defaults to the canvas size. `palette` defaults to the project's default palette. |
| `px <x,y> [<x,y> ...] c=` | `px 3,4 4,4 c=ink` | Single pixels. |
| `line <x,y> <x,y> [<x,y> ...] c= [pp=on\|off]` | `line 3,10 9,7 c=stone2 pp=on` | A line or polyline. See *Lines* below. |
| `rect <x,y> <W>x<H> c= [outline\|fill]` | `rect 2,2 20x6 c=stone3 outline` | Outline by default. |
| `ellipse <cx,cy> r=<RX>x<RY> c= [outline\|fill]` | `ellipse 12,12 r=5x3 c=moss2 outline` | Centre and radii (`r=5` means `r=5x5`); spans `2*RX+1` pixels. |
| `ellipse <x,y> <W>x<H> c= [outline\|fill]` | `ellipse 2,2 6x4 c=moss2 fill` | Inscribed in a box, so even sizes work. |
| `fill <x,y> c= [mode=contiguous\|global] [conn=4\|8]` | `fill 7,9 c=stone3 mode=contiguous conn=4` | Flood fill (crosses edges on wrap documents). `mode=global` replaces every pixel of that colour. |
| `paint <x,y> <<` rows `>>` | see below | An ASCII block of palette keys. |
| `stroke pencil c= [pp=on\|off] <x,y> ...` | `stroke pencil c=ink pp=on 12,4 12,5 13,6` | One freehand drag through the sampled points. See *Strokes*. |
| `stroke eraser <x,y> ...` | `stroke eraser 3,3 4,4` | The same, clearing to transparent. |
| `select rect <x,y> <W>x<H>` | `select rect 2,2 6x4` | Select a rectangle. See *Selections*. |
| `select all`, `select none`, `deselect` | `select all`, `select none`, `deselect` | |
| `shift <dx,dy>` | `shift 2,-1` | Move the selected pixels (or the whole canvas). |
| `palette set <entry> hex=#rrggbb` | `palette set stone3 hex=#7a8a80` | Change a colour of this asset's palette. See *Palette edits*. |
| `palette add [<name>] hex=#rrggbb [key=<k>]` | `palette add gold hex=#e0b040 key=g` | Add a colour to this asset's palette. |
| `note <x,y> [<W>x<H>] "text"` | `note 12,5 "beak too long" id=n1` | Pin a note to a pixel or a region. See *Notes*. |
| `note done <id>` | `note done n1` | Close a note. |
| `undo [group=<g>] [by=<author>]` | `undo group=g4` | See *Undo and redo* below. |
| `redo [group=<g>] [by=<author>]` | `redo group=h5` | Take back an undo. |
| `fork <from> <to> [at=<n>]` | `fork chest chest_b at=20` | Start asset `<to>` as a branch of `<from>`. See *Forks*. |

### Lines

Lines are pixel-perfect:

- Each step moves one pixel along the major axis, so a line is 8-connected with no doubled
  L-corners.
- The pixels are shared out evenly among the rows (or columns) the line crosses: `0,0 11,3` is
  runs of 3-3-3-3 and `0,0 8,2` is 3-3-3. Uneven counts are spread symmetrically (`0,0 6,2` is
  2-3-2).
- The pixels depend only on the two endpoints, not on the direction drawn.
- With `pp=on` (the default), a polyline drops the doubled L-corner pixels where its segments
  join. The exception is a right angle between straight horizontal and vertical segments, which
  is kept. `pp=off` keeps every joint pixel.

### Paint blocks

```
paint 8,4 <<
  ..kkk..
  .k333k.
  k34443k
>>
```

Each character is a palette key. `.` leaves the pixel as it is, and a space clears it to
transparent. The rows' shared indentation is removed. When spaces at the start or end of a row
matter, wrap every row in `|` margins; the text between the margins is used exactly:

```
paint 0,0 <<
  | k |
  |k k|
>>
```

The normal form uses a two-space indent, or `|` margins when a row starts or ends with a space.

### Strokes

`stroke` is what the pencil and eraser write: one drag, one line, one group. The points are the
pixels the pointer passed over, in order; consecutive points are joined by pixel-perfect segments.
With `pp=on` (the default) a doubled L-corner is dropped wherever the path makes one, as
Aseprite's pixel-perfect pencil does, so a drag that steps right and then down draws a diagonal.
Unlike `line`'s polylines, no right angle is kept. `pp=off` keeps every pixel. `stroke eraser`
takes no colour and never drops pixels. A stroke may run past the canvas: it clips, or wraps on a
`wrap=on` document.

### Selections

`select rect` selects a rectangle (on a `wrap=on` document it may cross an edge and wrap).
While something is selected, **every drawing command is clipped to it**, flood fills included
(`fill` starts only inside the selection and never leaves it; `mode=global` replaces only
selected pixels). `deselect` (or `select none`) ends it; `select all` selects everything.

`shift dx,dy` moves the selected pixels by dx,dy, and the selection with them. The pixels left
behind become transparent; pixels moved past an edge clip, or wrap on a `wrap=on` document. With
nothing selected, `shift` moves the whole canvas.

The watch view's rectangle select stays in the page until it is used. Moving it writes one group:

```
select rect 4,7 6x5
shift 2,1
deselect
```

and drawing inside it wraps the drawing command in `select rect …` / `deselect` the same way.
More selection kinds (ellipse, lasso, wand, by colour) come in G4.

### Palette edits

A document holds its own copy of its palette, taken from the project when `new` runs. `palette
set` and `palette add` edit that copy, as commands on the tape, so replaying the tape gives the
same colours even if the project's palette file changes later. Entries are never removed or
reordered (pixels store entry numbers); the names on the tape stay valid.

- `palette set <entry> hex=#rrggbb` changes an entry's colour. The entry may be named by its name
  or its key; the tape records the name.
- `palette add [<name>] hex=#rrggbb [key=<k>]` appends an entry. Without a name it is called
  `c<N>` (N = its position); without a key it gets the first free one (`0-9`, `a-z`, `A-Z`, then
  punctuation). The normal form always records both.

`#` would start a comment after a space, so colours are written as `hex=#…`.

### Notes

`note 12,5 "too dark"` pins a note to a pixel; `note 8,0 12x10 "…"` to a region (inside the
canvas). Notes are for whoever reads the tape next: people pin them in the watch view, and the
agent reads them through `changes` (see [mcp.md](mcp.md)). The normal form adds the note's id,
`id=n1`, one past the highest id on the tape, so ids are never reused, even after an undo. Open
notes are part of the document's state (they appear in `asset.json` and the state hash) and show
on the canvas. `note done n1` closes one. Undoing a note's group removes it.

### Undo and redo

- `undo` takes back the latest group that is still in effect and is not itself an undo. The
  chosen group is written into the line (`undo group=g4`).
- `undo group=g2` takes back any earlier group still in effect. Later groups stay.
- `undo by=human:chris` takes back that author's latest drawing group still in effect, whoever
  drew after it. The watch view's Undo button (Ctrl/⌘+Z) writes this for the person using it.
- `redo` takes back an undo: the latest undo still in effect (`by=<author>`: that author's), as
  long as nothing new was drawn after it (by that author). Drawing something new ends the redo
  chain, as in any editor. `redo group=h5` takes back undo group `h5`. The line records the group:
  `redo group=h5`. Undoing an undo group with `undo group=…` is the same thing.
- The group that created the document (with `new` or `fork`) cannot be undone. A batch cannot undo
  its own group.

The agent's plain `undo` is unchanged: the latest group in effect, whoever wrote it.

### Forks

`fork <from> <to> [at=<n>]` starts asset `<to>` as a branch of `<from>` at command `<n>` (default:
its last). It must be the first command of a batch run on the new asset (in MCP:
`run(asset: "chest_b", commands: "fork chest chest_b at=20")`; in the watch view: time travel to a
line, then **Branch here**). The source is not touched.

#### The branching tape format

A branch's `tape.jsonl` is self-contained. It holds:

1. the source's entries 1..`at`, copied exactly (same `seq`, `by`, `at`, `group` and `cmd`), so
   the branch keeps who drew what;
2. the fork line, numbered `at+1`, in the forking author's next group: `fork chest chest_b at=20`;
3. the branch's own commands after it.

```
{"pclaw":"tape","lang":1}
{"seq":1,"by":"claude","at":"…","group":"g1","cmd":"new sprite chest 12x12 palette=mossy-ruins wrap=off cell=12x12 bg=none"}
{"seq":2,"by":"claude","at":"…","group":"g1","cmd":"rect 1,3 10x8 c=soil1 fill"}
{"seq":3,"by":"claude","at":"…","group":"g1","cmd":"rect 1,3 10x8 c=ink outline"}
{"seq":4,"by":"human:chris","at":"…","group":"h1","cmd":"fork chest chest_b at=3"}
{"seq":5,"by":"human:chris","at":"…","group":"h2","cmd":"fill 3,5 c=moss2 mode=contiguous conn=4"}
```

Replay is the ordinary replay: the copied prefix rebuilds the source's document as it was at
`at`, and the fork line renames it to the branch. When replayed, the fork line checks that the
document is `<from>` and that `at` is the command just before it, so a tape whose prefix was
edited does not replay. The fork's group cannot be undone (it made this asset); the copied groups
can, as on any tape. The source's later history, or even its tape being started again, never
changes a branch. `asset.json` records the link: `"links": [{"fork": {"from": "chest", "at": 3}}]`.

## Views

`pixelclaw view <project> <asset> [render|grid|tile3x3|diff|all]` (`all` is the first three):

- **render**: a nearest-neighbour PNG. The default scale gives about 192 px on the long side
  (8x for a 24 px tile). It has a faint pixel grid, stronger lines every 8 px, rulers labelled
  every 8 px, magenta cell lines on sheets, and a grey checkerboard for transparent pixels.
- **grid**: the text index grid. There is one character per pixel (its key; `.` for transparent),
  with column and row numbers and a legend of the keys used with pixel counts.
  `--region x,y,WxH` shows part of the canvas.
- **tile3x3**: the document repeated 3x3, at 1x and at 4x side by side, to show seams and
  repetition.
- **diff**: before and after side by side at the render scale. Each changed pixel is outlined in
  magenta on both, and open notes are outlined in yellow dashes. With more than 60 changed pixels a
  third panel shows them as a map (the after image dimmed, changes solid magenta). The text lists
  up to 60 changes as `x,y from→to` by entry name. By default it shows what the latest group
  changed; the MCP `view` takes `since=<n>` and `changes` uses the agent's read position.

Views are written to `<project>/views/<asset>.<mode>.png` (or `.txt`), or to `--out <dir>`.

## The tape

`assets/<name>/tape.jsonl` starts with a version header, then one entry per command:

```
{"pclaw":"tape","lang":1}
{"seq":1,"by":"claude","at":"2026-10-27T12:00:00Z","group":"g1","cmd":"new tile floor 24x24 palette=mossy-ruins wrap=on cell=24x24 bg=stone1"}
```

`by` is the author (the CLI's `--by`, default `claude`; `human:<name>` from the watch view), and
`at` is stamped by the writer. Replay ignores both, except that `undo by=` and `redo by=` are
resolved by author when first written (the tape records the group they chose).
`pixelclaw verify` checks four things:

- every line replays and is still in normal form;
- two replays give the same bytes;
- the result matches the state hash in `asset.json`;
- the result re-renders to the committed `preview.png`.

## Seeds

Commands that use randomness (the generators from G4 on) take `seed=<n>`. If it is left out, the
normaliser picks one from the command's tape position and writes it into the logged line, so a
replay never depends on a default.
