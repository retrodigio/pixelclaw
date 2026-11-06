---
name: pixelclaw
description: Make pixel art for a game with PixelClaw, an indexed-colour editor driven by commands through its MCP tools (project, run, seeds, view, check, changes, history, plan, work, review, export, import), while a person watches, edits and asks for work in the browser. Use when asked to draw or fix tiles, sprites, autotile families, maps or a game's whole art set, to plan a set from a theme (manifest and style guide), to review pixel art blind, or to export it to a game.
---

# PixelClaw

You draw pixel art by writing commands. Every pixel is a palette entry; every command goes on the
asset's tape, so a document is its tape replayed and every edit (yours and the person's) can be
read back. You see your work through `view` (images and exact text grids) and `check` (numbers
with pixel coordinates). The person watches the same document live, and can draw, leave notes and
approve work in the dashboard.

If the tools are missing, the server is not connected:
`claude mcp add pixelclaw -- npx pixelclaw serve --project <folder>.pclaw` (then restart Claude Code).

## Every session

1. `project` (with `path` to open or create a project). Give the person the watch link it prints,
   and the dashboard (`…&tab=dashboard`) when there is a plan.
2. `changes` at the start of every turn while someone watches, and whenever they say they did
   something. Carry on from their edits; never silently redo their pixels. Close a note you have
   dealt with: `note done <id>`.
3. `plan` at the start of the session and again after each finished asset: it lists the
   **requests** people made in the dashboard first, then what is left and what is failing.
   If you are driving a project served with `pixelclaw serve` and a person may be watching, start
   a background wait right away and keep one running between tasks:
   `pixelclaw await <project folder>` (run it in the background; it blocks, prints what people asked
   for and a cursor, then exits). When it exits, handle what it printed (`work` for a request,
   `changes` for an approval or rejection), then **start it again with `--since <cursor>`**. Exit
   code 3 means nothing happened; restart it the same way. Without it, nobody knows you are there
   and a request the person filed just sits. `plan` tells you when open requests have no listener.
4. **Requests before planned work.** `work` claims the next open request and says what is asked
   (draw a planned asset, change a drawn one, or a new asset the person added to the manifest).
   Do it, then `work(action="done", text=<what changed>)`. If you cannot go on without the person
   (a choice only they can make), `work(action="blocked", text=<one clear question>)` and move on;
   their answer opens the request again. Post `work(action="progress", text=…)` on long ones: the
   person sees it on the card. Without PixelClaw's MCP tools, the same actions are
   `pixelclaw work <project> claim | progress "…" | done "…" | block "…"` (below).

## House rules

- **Look, then verify.** After each meaningful batch, look once at an image (`render`, `tile3x3`
  for tiles, `game` for sprites, `map` for families and maps), then use `grid` (or a region of it)
  to confirm exact pixels. Never judge a tile alone when it will be seen tiled; never judge a sprite
  away from its ground.
- **Small exact shapes as `paint` blocks** (up to about 32x32), outlines and silhouettes from
  primitives, `mirror … live` for symmetric shapes. Count and quote coordinates.
- **Texture by generators, not by hand:** `noise` (clustered, on a ramp), `scatter`, `voronoi`,
  `bricks`; tiles are `wrap=on` so they tile by construction. Another seed is another variant.
- **Structure by generators too:** `pebbles ramp=<stone ramp>` (stones with a shadow side and a lit
  pixel) and `tufts ramp=<grass ramp>` (blades) are lit from the style guide's light, never
  overlap, and keep the tile's rows and columns even, so they pass `repetition`, `seam` and
  `jaggies` at 16, 24 and 48 px with their defaults. Lay them over a calm `noise` ground.
- **Choose seeds by the checks, not by hand:** `seeds(asset, line, count=8)` tries a generator
  line with N seeds as dry runs and ranks them (fewest failing, least over, most room);
  `apply=true` keeps the best. **Try before you keep:** `run(…, dry=true)` applies to a copy,
  checks it, and keeps nothing (a pebble, a walkable flag, a `family cut`).
- **Helpers apply the style guide exactly:** `outline` (the style guide's ink when you leave out
  `c=`), `shade` (its light when you leave out `light=`), `clean orphans`, pixel-perfect lines,
  `shadow` (an ellipse under a sprite, away from the light, in `style.shadow.c`). On maps, set
  `style.shadow` (`{"c": "darker"}`) and every objects layer casts shadows on the ground (`layer add
  props objects` writes `shadow=darker shadowdir=se`); do not also bake a shadow into those objects.
- **Keep the checks green, but do not stop at green.** Look at the 3x3 or the game view and judge
  it as a player would. Fix by coordinates from `check`, not by redrawing.
- **Keep art inside its cell and in one piece:** `margin` fails a sprite touching the top or sides
  of its cell (it stands on the bottom), `pieces` a part floating apart (a lamp room above its
  tower: join it). Colours meant for one thing only (a lantern's glow, a gem) go in
  `style.reserved` (`{"glow": ["lantern"]}`); `palette` then flags them anywhere else.
- **One light, one outline rule, one level of detail across a set.** The `consistency` check
  compares each asset with its set; a recolour (palette swap) is recognised and not compared with
  its source.
- **Never fake a pass.** If a check is wrong for an asset, say so and turn it off for that asset in
  the style guide (`style.assets.<name>.checks`) with the reason in style.md; do not draw to
  satisfy a number.
- Native grid 24 px is fully verifiable; 48 px needs regions and helpers; 96 px needs an underlay
  and region work, with a hand-made 24 px copy beside it.

## Per-size defaults

Set the project's grid first (`project(grid=48)`, or `pixelclaw new <dir> --grid 48`): the project
summary's second line says what follows from it.

| | 16 px | 24 px (default) | 48 px |
|---|---|---|---|
| `new map` without `tile=` | 16 (grid 16) | 24 | 48 |
| camera (`style.camera` unset) | 256x144 | 384x216 | 768x432 (16x9 cells) |
| draw scale (`style.drawScale` unset) | 2x | 2x | 1x (the game view shows the scene once) |
| `noise` specks (no `cluster=`) | 1..3 | 1..3 | 2..6 |
| tile `jaggies` allowance | 2 | 2 | 8 (per 24x24 px) |
| `repetition` band widths | 1..4 lines | 1..6 | 1..12, counted in lines of 24 px |
| map `lattice`: a mark is at least | 2 px | 5 px | 18 px, ±2 px counts as the same spot |
| icon stroke / centre limits | 1 / 1.5 px | 1.5 / 2.25 px on 24 px icons | 3 / 4.5 px on 48 px icons |

At 48 px: look with `view grid region=` (a whole 48x48 grid is long), `render` comes back at 4x
(192 px) and `tile3x3` at 4x (576 px). Make texture variants by **forking the base and changing
only its inside** (`fork moor moor_b`, `variant of=moor`, then `noise 4,4 40x40 … base=keep
wrap=off` and your own marks): two independent noise tiles side by side show a seam where their
bigger specks are cut at the border. With the structure generators the fork can lay the same
ground again and only change the generator's seed, keeping its `edges=` (`examples/ember-moor.pclaw`
uses three looks of noise and `tufts edges=2`, map seam 0.17, lattice 12%).
Expect more `jaggies` from long curves: a big ellipse is fine alone, but where a second shape meets
its outline the step runs go uneven; let one shape make the silhouette and shade inside it.

## Workflows

### A theme → a whole set (the project pipeline)

1. **Write the style guide**: `style.md` (palette and ramps, light direction, outline rule,
   dithering, cluster size, sizes, what each material looks like) and the matching settings in
   `project.json` `style` (`palettes`, `outline`, `light`, `ground`, `drawScale`, `sizes`,
   `checks`, `sets`). The palette goes in `palettes/<name>.json` (keys, names, hex, ramps).
2. **Write the manifest** with `plan(manifest=…)`: the theme paragraph, the sets, and every asset
   with its kind, size, set, a one-line description (what it is meant to read as), and as needed
   scheme, inside/outside and band (families), frames and views (sprites), cells (objects), the
   drawn height in pixels (props and figures: this is what keeps a chest smaller than a person),
   `recolourOf`/`variantOf`, and `flat` (its colour in templates). See manifest.md. The tool
   checks it against its schema and writes nothing if it has problems.
3. **Flat templates**: `plan(templates=true)` draws a mockup screen and a coverage map per family
   in `templates/`. Show the person the mockup; adjust sizes and sets before drawing.
4. **Author** each asset. A planned asset's `new` line can leave out its size, palette and scheme
   (`new sprite urn`): the manifest fills them in and the line records them.
5. **Derive** the families, **compose** sample maps (`view map`), run every check.
6. **Review**: the blind review below, then `mark reviewed "<what was found and fixed>"` on each
   asset; the person approves in the dashboard (`mark approved`) or asks for changes
   (`mark rejected "…"`: read it with `changes`, fix, review again).
7. **Export** with the game's profile (`export(profile=…, dest=…)`); `plan` shows `exported`.

Statuses are worked out, never set by hand: planned → drafted (exists) → checked (every check
passes) → reviewed → approved → exported. A change to the art after a mark or an export sends the
asset back down, and `plan` says why.

### Requests from the dashboard

People ask for work without talking to you: "Draw this" on a planned card, "Ask for changes" on
a drawn one (also a `mark rejected "…"` on its tape), "Add an asset" (a new manifest entry). They
wait in `requests.jsonl`; `plan` lists them first and `work` hands them out one at a time. The
person's card reads *sent* until something hands it to you, then *seen by claude*: keep a background
`pixelclaw await <project>` running (restart it after each exit, `--since` the cursor it printed) so
that happens as soon as they press the button, and the card never claims more than is true.

1. `work` → read what is asked, the asset's plan entry and status, and any answer to an earlier
   question.
2. Draw or change it as for any asset (the house rules, the checks, a look at the game view).
   For a change, `changes` shows the person's own edits and notes on it.
3. `work(action="done", text="…")` with what you did in a sentence the person can check against
   the card; or `blocked` with a question. `done` is refused while the asset fails a check: the
   reply lists them; fix them, or block with a question when only the person can decide. Then `plan`, and `work` again until it says there are
   no open requests; then carry on with planned work.

**No PixelClaw MCP tools in this session** (the project is served with `serve --no-mcp`, or you
only have a shell): the same routine with the CLI, which goes through the running server so the
cards move live:

```sh
pixelclaw work <project> list                         # the open requests (now seen by claude)
pixelclaw work <project> claim                        # step 1: the next open one (or claim r3)
pixelclaw work <project> progress "<a short note>"
pixelclaw work <project> done "<what changed>"        # step 3; refused while a check fails
pixelclaw work <project> block "<one clear question>"
```

Draw with `pixelclaw run <project> -e "…"` (or a script file), look with `pixelclaw view`, check
with `pixelclaw check`; `pixelclaw plan <project>` for what is left.

A headless worker (`pixelclaw work <project> start`, or Start Claude in the dashboard when the project enables
it) follows the same routine with no one at the keyboard: never ask in chat, ask with `blocked`.
It has only the PixelClaw tools (no shell, files or web; files outside the project are refused),
its system prompt ends with every command of the language, and a session that makes no tool call
for a while is stopped (docs/worker.md).

### Importing existing art

`import(path=<sheet.png>, slice="24x24", set=…)` cuts a sheet into one asset per non-empty cell
(names by `pattern`, a `names` list, or `namesFrom="manifest"` for the planned entries of a set);
a folder imports every PNG and .aseprite in it. New assets get manifest entries and every check
is run; fix what fails by coordinates like any drafted asset.

### A tile

`new tile <name> 24x24 bg=<base>` → `seeds` on its `noise`/`scatter` line (apply the best) →
`view tile3x3` → fix stripes and repeated marks (`check` repetition, seam; one mark on a calm
tile is fine: the limit rises with the band's spread) → a variant or two by `seeds` from another
`from=` (`new tile <name>_b …`, `variant of=<name>`) so maps do not weave.

A structured ground (shingle, grass with tufts): the calm ground, then `pebbles`/`tufts` (its line
says `edges=<n>`); each look is a fork of it (`fork shingle shingle_b`, `variant of=shingle`), the
ground laid again and the same generator with **the same `edges=` and another seed** (rank it with
`seeds`): every look then has the same stones across its edges and its own inside, so a map can
`fill mix=` them in any order with no seam and no lattice.

### A sprite or prop

Silhouette first (`paint` or primitives), then materials in ramp steps, `shade`, `outline`,
`clean orphans`; `view game` on its ground beside its set; `check` readability (edge contrast,
distinct silhouette, lightness spread) and consistency. Animation: frames with ticks, `view S
frames=…`, `view W mirror=E`, `view anim`; the anim check (8-35 % change per frame, no drift).

### An autotile family

`new family <name> 24x24 scheme=blob47` (or the manifest's), `family texture inside|outside
from=<tile>`, `family band 3:outside 1:foam 2:sand1 radius=3 jitter=2` (jitter: edges that are not
ruler-straight; pick its seed with `seeds`), then hand-detail the pieces on the band layer (`paint
@cell(o) …`); every variant follows. Judge on `view map` (seam ≤ 1, ideally ≤ 0.5) and `view
family`. The family follows the tiles its textures came `from=`: fix the tile, and the family is
copied again. Rounder corners: `scheme=blob47-round` (built in; fillets). Cliffs: `scheme=face`, paint
the faces on the band layer: south faces `@cell(face_o)` (ends), `@cell(face_ew)` (the middle),
`@cell(face_ie_iw)` (inner corners, where the face meets the terrain beside it); side faces
`@cell(side_e)`/`@cell(side_e_ns)` on the cell's west half (the terrain's east side) and
`side_w`/`side_w_ns` on its east half; `@cell(corner_ew)` where a side meets the south face's end.
Give a long cliff other looks: `family detach face_ew_b` (and `face_ew_c`, `side_e_ns_b`,
`side_w_ns_b`) and draw them; a map spreads them by cell. Roads and rivers that widen or step
diagonally: `scheme=lane` (a wide lane has a plain middle; a diagonal step draws a strip to the
corner). A texture variant that should follow later band fixes:
`fork <f> <f>_b`, `variant of=<f> band=inherit`, then change only its textures. After a `family
cut`, heed the seam warning.

### A map

`new map <name> 40x30 tile=24`, `tiles floor fill <ground tile>` (the floor in one line; `tiles floor fill mix=bed:2,bed_b:1,bed_c:1`
scatters several looks by weight, the cure for a failing `lattice`), terrain
layers per family (`walkable=on` when a layer's filled ground is ground objects stand on, not sea;
terrain that runs off the map has no band along the border unless `border=not`; `mix=meadow:2,clover:1`
draws the terrain's inside as a scatter of tiles that match its inside texture, a clean border and a
varied inside),
`terrain … rect|ellipse|brush`, `place`, `road`, `scatter`; look at it with `view map camera=x,y` (a player's screen); fix
repetition hot spots with texture variants, and a failing `lattice` (one mark at the same spot of
most cells, a grid of dots at map scale) with variants that move or leave out the mark; consistency on a map compares the objects standing on
it.

### A mockup underlay, snapped (optional; costs money with a real provider)

On a sheet the size of the scene (`new sheet yard 144x96 cell=24x24`):
`underlay generate "<the theme, the scene, top-down pixel art>" layout=templates/mockup.png`
(OpenAI, the person's `OPENAI_API_KEY`; about $0.05 an image at the default; a cost cap per call,
every call in `logs/underlay-costs.jsonl`; ask before spending) or `underlay import <file.png>
layout=…`. Show the person the underlay; then `snap`. Read its line: block R² ≥ 0.8 and material
≥ 0.85, else reroll (another prompt) or trace over the underlay by hand instead. Cut tiles from the
draft (`new tile <t>` then `import 0,0 asset=yard region=<x,y>,24x24 layer=draft`), clean them by
coordinates (`clean orphans size=2`, then what `check` flags) until every check passes, and hold
them to the set (`consistency`). Never ship a snapped draft unchecked; small fixes are commands,
not another generation.

### A font

`new font <name> 5x7 chars="ABC…"` (or the manifest's), a `glyph <c> << rows >>` per character
(letters and digits as themselves, others as `U+0021`), `font set line= spacing=`. The `font` check
holds cap height, x-height, the baseline and advances; the preview's text tab sets it. Export with
`export(asset, format=strip|bmfont)` or the profile's `fonts`.

### Icons

`new icon <name> 16x16`, `icon mode=tone|full|channel` (tone: roles, recoloured by the game; full:
as drawn; channel: pure-RGB masks), then as a small sprite. Plan the icons as one manifest set:
`consistency` holds them to one stroke weight and box fill, each optically centred.

## The judge (optional; experimental)

If the project has `"judge": { "provider": "jev" }` in `project.json` (and the person has put
`TYPESAFE_API_KEY` in the environment), `judge` gives a cheap second opinion on how the art
*reads*: is a sprite recognisable as itself among its set, does it show what the manifest's
`reads` say (`"a readable face"`), are there seams on a tile or map, does it match the approved
mockup, is it still the same object after your last change, where is a stray blob (a box, marked
on a render). Use it:

- after a sprite passes its code checks and before you call it done, when the person cares how it
  reads (not on every edit: a run costs a little and asks only what changed);
- after a fix to something already approved: the `identity` question tells you if you changed
  what it is;
- to place a problem by pixels: a failing `stray` gives `marks`.

Answers are probabilities. At 0.7 or more it says yes, at 0.3 or less no, between is **unsure**:
look yourself, do not treat unsure as pass or fail. It is advisory unless the project gates on it
(then `done` is refused while it fails or has not answered). `check` shows its last answers.
If `judge` says it is off or has no key, say so to the person; do not set it up yourself: it
sends images to a third-party API and spends their money. Never put a key in a file or a
command. docs/judge.md.

## The blind review hand-off

The tool calls no model. You hand its bundle to a fresh agent and bring the findings back:

1. `review(set=<set>)` (or `assets=[…]`) writes `reviews/<date>-<set>/`: each asset at game scale
   and enlarged with rulers, tiles 3x3, sprites on their ground, maps, scenes, the palette, the
   style guide, the brief (the theme and what each piece is meant to be) and `rubric.md`. It names
   no author and no method, so the reviewer judges the art alone.
2. Start a **fresh-context** agent (the Agent tool, no conversation history) with only:
   *"Review the pixel art in <folder> by following rubric.md in it. Report as rubric.md asks."*
   Do not tell it who made the art, how, or what you think of it.
3. Save its answer as `reviews/<date>-<set>/findings.md`.
4. Pin each finding on its pixels: `note <x>,<y> [<W>x<H>] "<finding>"` on that asset (scene
   findings by cell, map findings by tile and pixel). Fix them by coordinates and close each note
   (`note done <id>`), or leave it open with a reason the person can read.
5. `mark reviewed "<n> findings; fixed …; left open …"` on each reviewed asset.

## Tools in one line each

`project` open/list · `run` a batch (one undo group; any error applies nothing; ends with a check
summary; `dry=true` keeps nothing) · `seeds` rank a generator line's seeds by the checks · `view` render, grid, diff, tile3x3, game, recolour, anim, map, family, density ·
`check` the full table with coordinates · `judge` the optional model's second opinion · `changes` the person's edits and notes · `history` the
tape · `plan` the manifest and statuses (write a manifest, draw templates) · `review` a blind
bundle · `export` / `import` through profiles. The command language: commands.md beside this
file, or `docs/commands.md` in the PixelClaw repo.
