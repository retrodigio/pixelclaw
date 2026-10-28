# Command reference (language version 1)

PixelClaw documents are edited with a small line-based command language. The same text works from
the CLI (`pixelclaw run`) now and from the MCP server later. Every command is written to the
asset's tape in its **normal form** (defaults filled in, colours by name), so replaying the tape
gives the same pixels even if a default changes later.

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

A `run` is one batch, logged as one undo group (`g1`, `g2`, ...). If any line has an error,
nothing in the batch is applied, and every error is reported with its line and column:

```
floor.pclaw:2:10: error: unknown colour 'gold' (palette 'mossy-ruins': ink, stone0, ...)
floor.pclaw:3:10: error: line: expected an end point x,y
2 errors; nothing was applied.
```

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
| `undo [group=<g>]` | `undo group=g4` | See *Undo* below. |

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

### Undo

- `undo` takes back the latest group that is still in effect and is not itself an undo. The
  chosen group is written into the line (`undo group=g4`).
- `undo group=g2` takes back any earlier group still in effect. Later groups stay.
- Undoing an undo group redoes what it undid.
- The group that created the document cannot be undone. A batch cannot undo its own group.

## Views

`pixelclaw view <project> <asset> [render|grid|tile3x3|all]`:

- **render**: a nearest-neighbour PNG. The default scale gives about 192 px on the long side
  (8x for a 24 px tile). It has a faint pixel grid, stronger lines every 8 px, rulers labelled
  every 8 px, magenta cell lines on sheets, and a grey checkerboard for transparent pixels.
- **grid**: the text index grid. There is one character per pixel (its key; `.` for transparent),
  with column and row numbers and a legend of the keys used with pixel counts.
  `--region x,y,WxH` shows part of the canvas.
- **tile3x3**: the document repeated 3x3, at 1x and at 4x side by side, to show seams and
  repetition.

Views are written to `<project>/views/<asset>.<mode>.png` (or `.txt`), or to `--out <dir>`.

## The tape

`assets/<name>/tape.jsonl` starts with a version header, then one entry per command:

```
{"pclaw":"tape","lang":1}
{"seq":1,"by":"claude","at":"2026-10-27T12:00:00Z","group":"g1","cmd":"new tile floor 24x24 palette=mossy-ruins wrap=on cell=24x24 bg=stone1"}
```

`by` comes from `--by` (default `claude`). `at` is stamped by the CLI; replay ignores both.
`pixelclaw verify` checks four things:

- every line replays and is still in normal form;
- two replays give the same bytes;
- the result matches the state hash in `asset.json`;
- the result re-renders to the committed `preview.png`.

## Seeds

Commands that use randomness (the generators from G4 on) take `seed=<n>`. If it is left out, the
normaliser picks one from the command's tape position and writes it into the logged line, so a
replay never depends on a default.
