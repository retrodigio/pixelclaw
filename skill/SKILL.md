---
name: pixelclaw
description: Make pixel art for a game with PixelClaw, an indexed-colour editor driven by commands through its MCP tools (project, run, view, check, changes, history, plan, review, export, import), while a person watches and edits in the browser. Use when asked to draw or fix tiles, sprites, autotile families, maps or a game's whole art set, to plan a set from a theme (manifest and style guide), to review pixel art blind, or to export it to a game.
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
3. `plan` when the project has a manifest: it says what is left and what is failing.

## House rules

- **Look, then verify.** After each meaningful batch, look once at an image (`render`, `tile3x3`
  for tiles, `game` for sprites, `map` for families and maps), then use `grid` (or a region of it)
  to confirm exact pixels. Never judge a tile alone when it will be seen tiled; never judge a sprite
  away from its ground.
- **Small exact shapes as `paint` blocks** (up to about 32x32), outlines and silhouettes from
  primitives, `mirror … live` for symmetric shapes. Count and quote coordinates.
- **Texture by generators, not by hand:** `noise` (clustered, on a ramp), `scatter`, `voronoi`,
  `bricks`; tiles are `wrap=on` so they tile by construction. Another seed is another variant.
- **Helpers apply the style guide exactly:** `outline` (the style guide's ink when you leave out
  `c=`), `shade` (its light when you leave out `light=`), `clean orphans`, pixel-perfect lines.
- **Keep the checks green, but do not stop at green.** Look at the 3x3 or the game view and judge
  it as a player would. Fix by coordinates from `check`, not by redrawing.
- **One light, one outline rule, one level of detail across a set.** The `consistency` check
  compares each asset with its set; a recolour (palette swap) is recognised and not compared with
  its source.
- **Never fake a pass.** If a check is wrong for an asset, say so and turn it off for that asset in
  the style guide (`style.assets.<name>.checks`) with the reason in style.md; do not draw to
  satisfy a number.
- Native grid 24 px is fully verifiable; 48 px needs regions and helpers; 96 px needs an underlay
  and region work, with a hand-made 24 px copy beside it.

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

### A tile

`new tile <name> 24x24 bg=<base>` → `noise`/`scatter` on its ramp → `view tile3x3` → fix stripes
and repeated marks (`check` repetition, seam) → a variant or two with another seed
(`fork`, `variant of=<name>`) so maps do not weave.

### A sprite or prop

Silhouette first (`paint` or primitives), then materials in ramp steps, `shade`, `outline`,
`clean orphans`; `view game` on its ground beside its set; `check` readability (edge contrast,
distinct silhouette, lightness spread) and consistency. Animation: frames with ticks, `view S
frames=…`, `view W mirror=E`, `view anim`; the anim check (8-35 % change per frame, no drift).

### An autotile family

`new family <name> 24x24 scheme=blob47` (or the manifest's), `family texture inside|outside
from=<tile>`, `family band 3:outside 1:foam 2:sand1 radius=3`, then hand-detail the pieces on the
band layer (`paint @cell(o) …`); every variant follows. Judge on `view map` (seam ≤ 1, ideally
≤ 0.5) and `view family`. Rounder corners: a scheme with fillets (`blob47-round`).

### A map

`new map <name> 40x30 tile=24`, terrain layers per family, `terrain … rect|ellipse|brush`,
`place`, `road`, `scatter`; look at it with `view map camera=x,y` (a player's screen); fix
repetition hot spots with texture variants; consistency on a map compares the objects standing on
it.

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
summary) · `view` render, grid, diff, tile3x3, game, recolour, anim, map, family, density ·
`check` the full table with coordinates · `changes` the person's edits and notes · `history` the
tape · `plan` the manifest and statuses (write a manifest, draw templates) · `review` a blind
bundle · `export` / `import` through profiles. The command language: commands.md beside this
file, or `docs/commands.md` in the PixelClaw repo.
