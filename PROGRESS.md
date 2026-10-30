# Progress

Status of plan features touched so far. Steps refer to the build plan (§10).

| Feature | Plan | Status | Validated by | Note |
|---|---|---|---|---|
| Repo skeleton: pnpm workspaces, TypeScript strict, vitest | §8.1, G1 | done | `pnpm test`, `pnpm typecheck` | Node ≥ 22.18 runs the `.ts` sources directly (type stripping). vitest 4 + vite 7 keep every installed dependency permissively licensed. |
| Dependency licences | CLAUDE.md | done | `test/licences.test.ts` | Every installed package is MIT, ISC, Apache-2.0 or BSD (checked on each test run). |
| Indexed document: cell grid, wrap flag (layers and frames: G4 below) | §3.1, §3.2 | done | `commands.test.ts` (wrap/clip), `golden.test.ts` (`wrap`, `sheet`) | Stored as layers × frames of cels, ready for G4/G6. `TRANSPARENT = 0xffff`. |
| Palettes: JSON (key/name/hex, ramps) | §3.1 | done | `palette.test.ts` | Keys are one character; `.`, space and `|` are reserved. Names are identifiers; `none` is reserved. |
| Palette import: `.hex`, `.gpl`, Lospec JSON | §3.1 | done | `palette.test.ts`, `cli.test.ts` | Keys are assigned automatically (0-9, a-z, A-Z, punctuation, then Latin-1). |
| Role palettes and preview themes | §3.1, §4.8, G5 | done | `g5.test.ts`, `checks.spec.ts` | `palette add <name> role=…`, `palette set <entry> role=…\|none`; roles black, white, light, dark, darkest. Built-in themes plus project.json `themes`. The five-tone encoding margin is an export-profile matter (G9). |
| Command parser: tokens, comments, `;`, blocks, `@cell` | §3.3 | done | `parser.test.ts` | |
| Normaliser: defaults, canonical colours, seeds written into the line | §3.3 | done | `commands.test.ts` (normal forms, idempotency, seed plumbing via a test-only generator) | |
| Parse and semantic errors with line and column; a batch with any error applies nothing | §8.2 `run` | done | `batch.test.ts`, `commands.test.ts`, `parser.test.ts`, `cli.test.ts` | Every error in a batch is reported, not just the first. |
| `new` | §3.3 | done | `commands.test.ts`, `cli.test.ts` | Kinds: tile, sprite, sheet, icon. |
| `px` | §3.3 | done | golden `px` | |
| `line` (pixel-perfect, no doubled L-corners) | §3.3, §3.4 | done | `line.test.ts` (all endpoint pairs in a 11×11 box; even runs; symmetry; polyline joints), goldens `line-*` | Lines share pixels evenly among rows, not by nearest-pixel Bresenham. See PLAN_QUESTIONS. |
| `rect` (outline or fill) | §3.3 | done | goldens `rect-outline`, `rect-fill` | |
| `ellipse` (centre+radii or box) | §3.3 | done | goldens `ellipse-*` | Zingl's integer algorithm. Checked: exact bounding box and mirror symmetry for 1..20 × 1..20. |
| `fill` (flood, `mode=global`, `conn=4/8`) | §3.3 | done | goldens `fill-*`, `wrap` | The flood crosses edges on wrap documents. |
| `paint` (ASCII block) | §3.3 | done | golden `paint`, `parser.test.ts` | Common indent is removed; `|` margins for significant spaces. |
| `undo` by group (and redo by undoing an undo) | §1.3, §3.3 | done | `undo.test.ts`, `cli.test.ts` | Selective undo of any group still in effect. |
| `tape.jsonl` and replay | §7.1 | done | `replay.test.ts` (byte-identical, JSONL round trip, normal-form check) | Header `{"pclaw":"tape","lang":1}`. |
| Seeded PCG32 generator | §8.1 | done | `pcg.test.ts` (reference pcg32 outputs) | BigInt state; the normaliser derives default seeds from it. |
| PNG encoder (no native deps) | §8.1 | done | `png.test.ts` (zlib round trip, indexed + RGBA, CRC) | Deflate with fixed Huffman codes is written here. Images with 256 colours or fewer are written as indexed PNGs. |
| Render: scaled PNG with pixel grid and rulers | §2 (1) | done | goldens `*.png`, `g5/marks.png` | Check marks (magenta rings) since G5. A selection overlay is not needed by any view yet. |
| Render: text index grid with region | §2 (2) | done | goldens `*.txt`, `paint.region.txt`, `cli.test.ts` | Includes a legend with pixel counts. |
| Render: `tile3x3` at 1x and 4x | §2 (4) | done | golden `wrap.tile3x3.png` | |
| Project folder (§7.1): project.json, palettes/, assets/<name>/ | §7.1 | done | `cli.test.ts` | style.md, manifest, schemes, profiles, blobs, exports and reviews come in later steps. |
| Checkpoints | §7.1, G3 notes | done | `checkpoints.test.ts` (written every 200, loaded from, damaged and stale ones fail verify, removed on restart) | `NNNNNN.gwc`: a header with the tape prefix's SHA-256, then the state bytes. See G4 below. |
| CLI `new`, `run`, `view`, `check`, `review`, `verify`, `export`, `import` | §8.1, G1, G5, G9 | done | `cli.test.ts`, `check.test.ts`, `example.test.ts`, `g9.test.ts` | `check` exits 1 when a check fails; `import --profile` exits 1 when an asset reads back differently. |
| Demo: 24x24 seamless stone floor from a script | G1 | done | `example.test.ts` (verify, plus a rebuild from the script) | `examples/mossy-ruins.pclaw`, script `examples/scripts/stone_floor.pclaw`. |
| Server package: project I/O moved from the CLI; the single writer (one queue, in-memory states) | §8.1, G2 | done | `mcp.test.ts`, `cli.test.ts` | Every batch from MCP, the CLI or (G3) a page goes through `Writer.run`. |
| Single writer across processes: `.pixelclaw.lock` | §8.1 | done | `mcp.test.ts` (CLI refuses; lock released on exit) | Pid and URL without the token. CLI `new`/`run` refuse while a live server holds it. |
| `pixelclaw serve --project <dir> [--port] [--no-mcp]` | §8.2, G2 | done | `mcp.test.ts`, `pack.test.ts` | Creates the project if missing. Stops when stdin closes or on a signal. |
| MCP over stdio (official TS SDK v2), server instructions | §8.2 | done | `mcp.test.ts` | Serves both protocol eras (2025 `initialize` checked by hand). Instructions carry a command cheat sheet and ask the agent to share the watch link. |
| MCP `project` | §8.2 | done | `mcp.test.ts`, `g9.test.ts` | Palettes, assets, watch link; open/create another folder; add palette files; project schemes and export profiles (G9). |
| MCP `run` | §8.2 | done | `mcp.test.ts`, `g5.test.ts` (server) | One undo group; applied lines, pixels changed, warnings, a check summary, an optional view; errors with line:col apply nothing. |
| MCP `view` | §8.2, §2 | done | `mcp.test.ts`, `edits.test.ts`, `g5.test.ts`, `g6.test.ts` (server) | `render`, `grid`, `tile3x3`, `diff`, `game`, `recolour`, `anim`, `map`, `family` (G7); `marks`, `theme`, `ground`, `with`, `size`, `seed`; `density` (G9). |
| MCP `history` | §8.2 | done | `mcp.test.ts` | Range by number or last N; undone groups marked. |
| HTTP + WebSocket on localhost, token | §1.2, §8.1 | done | `mcp.test.ts`, `watch.spec.ts` | 127.0.0.1 only, host-name check, random token for the page, `/api/state` and `/ws`. Port 7417 or the next free one. Small RFC 6455 server side, no dependency. |
| UI shell: canvas, zoom 1–64x, pixel and cell grids | §8.3, G2 | done | `watch.spec.ts` (canvas equals the core render at two zooms, with and without the grid) | Draws core's `renderFlat`; checkerboard under transparent pixels. Wrap ghosts and onion skin come later. |
| Tape panel streaming live with author colouring | §8.3, G2 | done | `watch.spec.ts` | Grouped by undo group; undone groups struck through. |
| Live playback, speed, pause, jump to live | §8.3, G2 | done | `watch.spec.ts` (every command shown in turn; pause holds; jump shows all) | Pages replay lines with core's new `TapeCursor`. Follows the asset being drawn. |
| Time travel (read-only) | §8.3, G2 | done | `watch.spec.ts` | Click a line to see the document after it. "Branch here" is G3 (below). |
| Claude's eye | §8.3, G2 | done | `watch.spec.ts` | The last image returned to the agent (`view`, or `run` with a view). |
| Asset list (and palette swatches) | §8.3 | done | `watch.spec.ts` | Busy dot on assets with commands to play. |
| Two browsers receive the same stream | §1.2, G2 | done | `mcp.test.ts` (two sockets), `watch.spec.ts` (two browsers) | |
| Build step: bundled `pixelclaw` package; `npx pixelclaw serve` from a tarball | §8.1, G2 | done | `pack.test.ts` | esbuild bundle + built UI in `cli/dist`; no runtime dependencies; third-party licences included. Still `private` (plan §12). |
| Playwright | G2 | done | `e2e/watch.spec.ts` (6 tests) | `pnpm test` builds, then runs vitest and Playwright. Needs `npx playwright install chromium` once. |
| Demo: the agent draws a tile through MCP while a person watches | G2 | done | `examples/demo-g2.md`, `examples/demo-g2-agent.ts` (run by hand; its tape verifies, same state hash as the G1 tile) | Screenshots in `docs/screenshots/`. |
| Docs: "Use it from Claude Code", docs/mcp.md | G2 | done | — | |
| Edits from pages: WebSocket `run` as `human:<name>`, through the single writer | §1.2, §1.3, G3 | done | `edits.test.ts`, `edit.spec.ts` | The sender gets a `result`; every page gets the batch. Pages can't restart an asset; names must be `human:<name>`. |
| Human groups `h<N>` with their own counter | §1.3, G3 | done | `authors.test.ts`, `edits.test.ts`, `edit.spec.ts` | Per tape, like `g<N>`. |
| UI tools: pencil (pixel-perfect), eraser, line, rect, ellipse, fill, picker, rectangle select and move | §8.3, G3 | done | `edit.spec.ts` (each tool driven with the mouse; the logged lines checked; core's replay of the server's tape equals the canvas after every action) | New commands `stroke pencil\|eraser`, `select rect\|all\|none`, `deselect`, `shift`. A stroke is one line, one group. Previews are the batch applied by core. Picker and an unused selection log nothing (they don't change the document). |
| Keyboard shortcuts in tooltips | §8.3, G3 | done | `edit.spec.ts` (B, E, L, U, Shift+U, F, G, I, Alt+click, M, V, arrows, Delete, Esc, N, Ctrl+Z, Ctrl+Shift+Z) | Aseprite-style. `[ ]` frames (G4), Enter plays and P is the pivot tool (G6). |
| Selections clip drawing | §3.2 | done | `edit.test.ts`, `edit.spec.ts`, `g4.test.ts` | Every kind from G4; per author. |
| Palette editing as tape commands | §3.1, G1 q3, G3 | done | `edit.test.ts`, `edit.spec.ts` | `palette set <entry> hex=`, `palette add [<name>] hex= [key=]` edit the document's own copy; the project palette file is untouched. |
| Notes pinned to pixels or regions | §1.3, §8.3, G3 | done | `edit.test.ts`, `edits.test.ts`, `edit.spec.ts` | `note x,y [WxH] "text" id=nK`, `note done nK`. In the state, `asset.json`, on the canvas (labels and outlines), in a Notes panel and in `changes`. |
| Undo and redo per author from the UI | §1.3, G3 | done | `authors.test.ts`, `edits.test.ts`, `edit.spec.ts` (two people) | `undo by=<author>`, new `redo [group=\|by=]`. The agent's plain `undo` is unchanged. |
| "Branch here" (`fork`) and the branching tape format | §7.2, §8.3, G3 | done | `authors.test.ts`, `edits.test.ts` (verify), `edit.spec.ts` | `fork <from> <to> at=<n>` after a copied prefix; documented in docs/commands.md. Also from MCP `run`. |
| MCP `changes` | §8.2, G3 | done | `edits.test.ts`, `edit.spec.ts` (exactly the person's lines and note, then nothing new) | Per-agent read position in `reads.json`. Other authors' lines per asset, open notes, a diff text and image (saved path; becomes Claude's eye). |
| Diff view (before/after, changed pixels marked) | §2 (3) | done | `diff.test.ts` (golden), `edits.test.ts` | Up to 60 changes as text; above that a third panel maps them. Notes outlined in yellow. |
| Time travel snapshot cache | G2 notes, G3 | done | `authors.test.ts` (Timeline equals replay), `edit.spec.ts` (10,000 lines) | `Timeline` in core: a snapshot every 100 commands, in the page and the writer, seeded from checkpoint files on load. |
| Virtualised tape list | G2 notes, G3 | done | `edit.spec.ts` (10,000 lines: load ~0.4 s, travel ~0.1 s, a stroke ~0.25 s; under 150 rows in the page) | Fixed row heights; long lines are cut with an ellipsis (the tooltip has the whole line). |
| Two browsers editing at once | §1.2, G3 | done | `edit.spec.ts` (overlapping drags; both canvases equal core's replay; both tapes equal the server's) | |
| Command line under the tape | §8.3 | done | `edit.spec.ts` | Runs commands as the page's author. |
| Demo: the person fixes three pixels and leaves a note; `changes` returns them; the agent carries on | G3 | done | `edit.spec.ts` (same scenario), `examples/demo-g3-agent.ts --simulate` (run by hand) | `examples/demo-g3.md`; screenshots in `docs/screenshots/g3-*.png`. |
| Each author's editing context: layer, frame, selection, live symmetry, brush | §3.2, G3 notes | done | `g4.test.ts` (an agent's selection does not clip a person; layer, frame, mirror, brush per author; home layer and frame), `toolkit.spec.ts` | Authors without one draw on a home layer and frame that move with their layer and frame. The page sends `layer`/`frame`/`mirror`/`brush` lines with your next edit only when they change. |
| Layers: add, choose, hidden, locked, reference, rename, move, merge, remove | §3.2, G4 | done | goldens `g4/layers*`, `g4.test.ts`, `toolkit.spec.ts` | Bottom to top. Reference layers are not art: views show them faded under it. A locked layer refuses drawing. |
| Frames scaffolding: add (copy or empty), choose, remove, move | §3.2, §4.4, G4 | done | goldens `g4/frames.f1..f3`, `g4.test.ts`, `toolkit.spec.ts` | Numbered from 1. Views take `frame` (default: the agent's). Durations, tags, linked cels, onion skin: G6 (below). |
| Selections: rect, ellipse, lasso, wand (contiguous or global), colour, layer, all, none, invert; add, sub, and; `clear` | §3.2, G4 | done | goldens `g4/select-*`, `toolkit.spec.ts` | In the page, selections are commands at once (undoable), not local as in G3. |
| Transforms: `shift` (`wrap` within the box or canvas), `flip`, `rotate` | §3.3, G4 | done | goldens `g4/transforms`, `g4/shift-wrap`, `toolkit.spec.ts` | On the selection or the author's layer. |
| Symmetry: `mirror … live`, `mirror … from=` | §3.3, G4 | done | goldens `g4/mirror-*`, `toolkit.spec.ts`; guides in `g4-symmetry.png` | Axes at whole or half pixels; one or two axes. |
| Curves and polygons | §3.3, G4 | done | goldens `g4/curve`, `g4/polygon` | Bezier sampled in exact integers, pixel-perfect; polygon fill by pixel centres (even-odd). |
| Dithering (`dither`), gradients (`gradient`), ramps (`ramp`) | §3.3, §3.4, G4 | done | goldens `g4/dither`, `g4/gradient*`, `toolkit.spec.ts` | Patterns anchored to the canvas (seamless on tiles). Gradients banded or dithered between ramp steps, linear or radial. |
| Palette locking; `palette save` to the project | §3.1, G3 notes | done | `g4.test.ts`, `checkpoints.test.ts`, `toolkit.spec.ts` | Lock refuses palette and ramp edits. Save writes a new project palette and refuses to replace a different one. |
| `outline`, `shade`, `clean orphans` | §3.4, G4 | done | goldens `g4/outline*`, `g4/shade`, `g4/clean`, `toolkit.spec.ts` | |
| Generators: `noise`, `scatter`, `voronoi`, `bricks` | §3.4, G4 | done | goldens `g4/noise*`, `g4/scatter`, `g4/voronoi*`, `g4/bricks*`; `g4.test.ts` (same seed reproduces, another changes, missing seeds written in) | `wrap=on` works on a torus, so textures tile by construction. Wave and ripple bands are not in G4's list; left for later. |
| Stamps and brushes | §3.3, G4 | done | goldens `g4/stamps`, `g4/brush`, `toolkit.spec.ts` | Stamps live in the document (from a box or a paint block). Brushes: square, circle, a stamp's shape. |
| Macros: `def` / `call` | §3.3, G4 | done | golden `g4/macro`, `g4.test.ts` | Parameters, arithmetic, nested calls (8 deep); a call is one tape line with its seed. |
| Undo replays from snapshots | G3 notes | done | `g4.test.ts` (undo and redo on a long tape equal a full replay) | `ReplayCache`: snapshots kept as the tape is written; an undo replays from the last one before the first group whose state changed. |
| State bytes (PCLAWDOC 2) and `deserializeDoc` | §7.1 | done | `g4.test.ts` (every golden's state round-trips), `checkpoints.test.ts` (G1-G3 hashes still verify) | Complete: palette and ramps, lock, layers, frames, contexts, home, notes, stamps, macros. |
| UI: selection tools, transforms, symmetry and guides, brush, gradient and dither tools, outline and clean, stamps, timeline (layers by frames), wrap ghosts, palette lock | §8.3, G4 | done | `toolkit.spec.ts` (each control's logged lines, then core's replay equals the canvas), `edit.spec.ts` | Shortcuts: Shift+M, Q, W, Shift+G, D, S, Shift+H/V/R, X, [ ]. Screenshots `docs/screenshots/g4-*.png`. |
| Demo: a seamless grass tile with two variants and a 24x24 chest | G4 | done | `example.test.ts` (verify, and a rebuild from the scripts) | `examples/demo-g4.md`, `examples/demo-g4-agent.ts` (run by hand), scripts in `examples/scripts/`; assets in `examples/mossy-ruins.pclaw`. |
| Tape language 2: the palette in the `new` line | §13, G5 | done | `lang.test.ts` (language 1 tapes verify and can be drawn on; a palette file change breaks only them; a branch keeps its language; a wrong header is refused), `g5.test.ts` (core) | Language 1 tapes replay by reading the project palette. The example project was rebuilt in language 2; a language 1 copy is a test fixture (`cli/test/fixtures/lang1.pclaw`). |
| Checks: `palette`, `orphans`, `jaggies`, `banding`, `outline`, `seam`, `coverage`, `readability`, `revert`, `repetition` | §5, G5 | done | `checks.test.ts` (a fixture per check with known answers) | Score, pass or fail against the style guide, flagged pixels by kind. `anim` and `views` in G6 (below); `density`, `consistency` are G9, G10. See docs/checks.md. |
| The seam metric, exactly | §13, G5 | done | `checks.test.ts` (solid 0; ink frame `0.9d/(0.3d+2)` = 2.6447; half-and-half `jump` = 2.3171; noise < 1) | Tiles (wrap documents). Over composed maps with G7/G8. |
| Style-guide thresholds | §5, §7.1, G5 | done | `checks.test.ts`, `g5.test.ts` (server), `checks.spec.ts` | project.json `style` (palettes, outline, ground, drawScale, sizes, checks per kind and per asset) and `style.md`. Read again when the file changes; pages are told. |
| MCP `check` | §8.2, G5 | done | `g5.test.ts` (server) | The table with coordinates and a marked image; without an asset, a line per asset. |
| Previews `game` and `recolour` | §2 (4), G5 | done | goldens `g5/game.png`, `g5/recolour.png`, `g5.test.ts` (server) | Game: on the ground at 1x and the draw scale, beside the set. Recolour: role art under 3-6 themes. |
| `review` bundle (blind review hook) | §5, G5 | done | `g5.test.ts` (server: the files, and no author or method names), `check.test.ts` | MCP `review` and `pixelclaw review`. Used for real in the demo (a fresh agent; findings in `reviews/2026-10-28-g5/findings.md`). |
| Diff and `changes` across frames | G4 notes, G5 | done | `g5.test.ts` (core golden `g5/diff-frames.png`; server: a person's edit on frame 2 in `changes`) | A row per changed frame; `f2 x,y a→b` in the text. |
| UI: check chips, marks, details, pin as notes; preview panel (3x3, game, themes); role colours and a theme menu | §8.3, G5 | done | `checks.spec.ts` (chips agree with `check`; marks on the canvas; pinning logs a note; the role control logs palette commands that replay; the theme and tabs log nothing; the style guide's changes reach the page) | Checks run in the page with core. |
| A tidier toolbar and options bar on narrow windows | G4 notes, G5 | done | screenshot `g5-narrow.png` | Narrower side panels below 1350 px, shorter labels, groups kept together. |
| Playback never skips a command on a slow frame | G2, G5 | done | `watch.spec.ts` (every command shown in turn) | At most one command a frame up to 60/s. |
| Demo: checks flag a test sprite's defects and the G4 art's weak spots; fixed by coordinates; a blind review round | G5 | done | `example.test.ts` (rebuild from scripts; every check passes) | `examples/demo-g5.md`, `examples/demo-g5-agent.ts`; screenshots `docs/screenshots/g5-*.png`. |
| Frame durations in ticks; the project's tick rate | §4.4, §7.1, G6 | done | `anim.test.ts` (defaults, ranges, new frames take their source's; old documents keep their state bytes) | `frame set <n>\|<a>-<b>\|all ticks=`; `tickRate` in project.json (60). Default 10 ticks (the engine profile's `frameTicks`). |
| Tags with `cycle` and `pingpong` loops | §3.2, §4.4, G6 | done | `anim.test.ts` (follow frames added, removed, moved) | `tag add\|set\|remove`. |
| Linked cels | §3.2, §4.4, G6 | done | `anim.test.ts` (drawing on one draws on all; survive clone, replay, state bytes; unlink; undo) | One shared pixel array; `cel link\|unlink`, `frame add link=`. Written in the state as links, only when there are any. |
| Directional views and live mirror links | §4.4, G6 | done | `anim.test.ts` (mirror frames added at the end, flipped; follow drawing, new source frames, ticks; drawing on a mirror refused; `mirror=off`), `g6.test.ts` (server), `anim.spec.ts` (canvas) | `view <dir> frames=`, `view W mirror=E`. The mirror is kept after every command. Export (draw-time or baked) is G9. |
| Pivot and ground line | §4.4, §4.9, G6 | done | `anim.test.ts`, `anim.spec.ts` | `pivot x,y`, `ground y`; in the anim sheet and the watch view in cyan. |
| `anim` view: contact sheet with onion skin, and a GIF | §2 (4), G6 | done | goldens `g6/anim-walker.png`, `g6/anim-water.png`, `g6/anim-walker.gif`, `g6/anim-water.gif`; `anim-render.test.ts` (GIF decoded back; delays at 60 ticks/s; sequences of different lengths share a loop); `g6.test.ts` (server) | GIF encoder in core (LZW, one table). The sheet: a row per sequence, ticks, the frame before tinted, pivot and ground, the change from the frame before. |
| `anim` checks: frame diff share, loop seam, pivot and ground drift, area jumps | §4.4, §5, G6 | done | `anim-checks.test.ts` (fixtures with exact answers) | Band 8-35 % (tiles 3-35 %); drift ≤ 1 px; ground 0 px; area ≤ 15 %. Per sequence; mirrors skipped. |
| View distinctness check (`views`) | §4.4, §5, G6 | done | `anim-checks.test.ts` | Colour difference over both silhouettes ≥ 20 % between views (first frames); E/W not compared. |
| Checks and the run summary over every frame | §14, G6 | done | `anim-checks.test.ts` (a stray on frame 2 found and named), `g6.test.ts` (server) | Worst frame's score; flagged pixels carry their frame; marks drawn on the frame shown. |
| Throttled checks on large canvases | §14, G6 | done | `anim-checks.test.ts` (over the budget only the focus frame) | Run summaries and the page check every frame up to 262,144 px (w × h × frames), else the frame being drawn on; the page also recomputes at most twice a second while commands play on large canvases. |
| `pixelclaw upgrade` (language 1 tapes to language 2) | §14, G6 | done | `lang.test.ts` (same state, verified, no longer reads the palette file; a second run does nothing) | Replayed before and after; written only if the state bytes are the same; checkpoints rewritten. |
| UI: timeline with ticks, views, tags, linked cels; playback at game speed; onion skin; pivot and ground tool | §8.3, G6 | done | `anim.spec.ts` (each control's logged line, then core's replay equals the canvas; a mirror follows the agent; playback frame times at 60 ticks/s within 120 ms; playing and onion log nothing) | Enter plays; Shift+click frame numbers chooses frames; P is the ⌖ tool. Screenshots `docs/screenshots/g6-*.png`. |
| Review bundle with animations | §5, G6 | done | `g5.test.ts` (no author or method names) | `anim/<asset>.png` and `.gif`, every direction in the scenes, a sixth rubric question. |
| Stone floor redrawn as a floor | §14, G6 | done | `example.test.ts`; a blind review round (`reviews/2026-10-28-g6/findings.md`) | Flagstones with `voronoi`; the repetition exception stays (its joints are its pattern). |
| Demo: a 4-direction, 2-frame walking figure and a 4-frame water shimmer, played at game speed; the anim checks green | G6 | done | `example.test.ts` (rebuild from scripts; every check passes), `anim.spec.ts` | `examples/demo-g6.md`, `examples/demo-g6-agent.ts`; GIFs `docs/screenshots/g6-walker.gif`, `g6-water.gif`. |
| Autotile schemes as data: `blob47`, `wang16-corner`, `path`, `bridge8`, `single`, `face` | §4.2, G7 | done | `schemes.test.ts` (blob47 against a reference table for all 256 neighbourhoods built without the resolver: the published 47 values, keys by weights, quadrants from the 2x2 cells at each corner; face, path, bridge8, wang16 and single keys; every scheme's pieces hold every quadrant; a broken scheme is refused) | `core/schemes/*.json`, written by `scripts/gen-schemes.ts`. Generic names (`ne_ne`); the engine's naming is G9's profile. Project schemes are not read yet (plan question 85). |
| Family documents: sheet, named cells, live derivation | §4.2, G7 | done | `family.test.ts` (a 1-px band lands exactly on the terrain pixels touching the outside in all 256 blob47 neighbourhoods and all 16 corner Wang tiles; detail on a piece reaches the 5 variants with that quadrant; detach and attach; state bytes and replay) | `new family <n> <T>x<T> scheme= [map=]`; `@cell(<name>)`; layers `ground` and `band`; derived after every command like mirror views. |
| Route 1: band profile, textures re-projected | §4.2, G7 | done | `family.test.ts` (every variant's ground is the texture at the same pixel; a texture change reaches every variant), golden `g7/blob47.png` | `family band 3:outside 1:foam 2:sand0 radius=3`; `family texture inside from=<tile>` records the pixels in the line. |
| Route 2: quadrant pieces | §4.2, G7 | done | goldens `g7/path.png`, `g7/wang16.png`, `g7/bridge8.png`, `family.test.ts` | The pieces are variants (blob47: `o`, `nesw`, `ew`, `ns`, interior); drawn on layer band. |
| Route 3: cut from a painted map | §4.2, G7 | done | `family.test.ts` (cut from a map painted with the derivation gives every variant back; golden `g7/cut.png`), `g7.test.ts` (server) | `family coverage` then paint the map area, then `family cut [textures=on]`: medoids, band only, detached. |
| Coverage maps from the scheme | §4.2, §7.3, G7 | done | `schemes.test.ts` (every reachable variant on a map for every scheme; same seed same map; too small refused) | Flat template on a reference layer; blob47 needs about 14x12. |
| Sample maps, the seam score over maps, the `map` view | §2 (4), §4.2, G7 | done | `family.test.ts` (island golden `g7/island.png`, map text, the seam sees a band on the tile border), `g7.test.ts` (server: view map with size, seed, overlays and a GIF) | Random islands (seeded value noise); a family's `seam` check is the score over the 12x10 island of seed 1. |
| `family` view (each variant among its neighbours) | §4.2, §8.3, G7 | done | golden `g7/blob47.family.png`, `g7.test.ts` | Also lists every cell's place for `@cell`. |
| Overlay documents (liquids) | §4.3, G7 | done | `family.test.ts` (cycle, pingpong, wave, sparkle play on the map; golden `g7/overlay-wave.gif`), `g7.test.ts` | `new overlay`; `overlay set mode= on= anchor= spread= every= rest= seed=`. Checked as effects. |
| Animated families | §4.3, §15, G7 | done | `family.test.ts` (a two-frame texture plays on the map), `example.test.ts` (the shore shimmers in four frames) | Frames, `sequences()` and linked cels as in G6. |
| Family checks: coverage of every variant, seam over the map | §4.2, §5, G7 | done | `family.test.ts`, `example.test.ts` | `jaggies` skips families (plan question 94). |
| Delta GIFs for maps | G7 | done | `anim-render.test.ts` (a delta GIF decodes to the same pictures, smaller) | Map GIFs: one loop, at most 4 s, in 3-tick steps. |
| Review bundle with families | §5, G7 | done | `g7.test.ts` (maps, the tile at each place, sets; no author or method names) | `maps/<set>.png` and `.gif`, `maps/<set>.tiles.txt`, `sets/<set>.png`, a seventh rubric question; `--size`, `--seed`. |
| UI: a family's sheet, variants and map; folding timeline rows | §8.3, §15, G7 | done | `family.spec.ts` (detach, attach, coverage and cut log their commands and core's replay equals the canvas; a stroke on a piece reaches its variants; the views, map controls and folding log nothing) | Screenshots `docs/screenshots/g7-*.png`. |
| Demo: a shore family (47 variants) from a band profile and three hand-detailed pieces, on a random island with a seam score ≤ 0.5; a blind review round | G7 | done | `example.test.ts` (rebuild from scripts; every check passes), `examples/demo-g7-agent.ts` | `examples/demo-g7.md`; the island (16x12, seed 6) scores 0.18 after the blind review round (`reviews/2026-10-28-g7/findings.md`). |
| Map documents: a grid of cells holding names; terrain, tiles, objects and overlay layers | §4.11, G8 | done | `map.test.ts` (replay byte-identical with map gen, road, scatter and a note; state bytes round-trip) | `new map <n> <C>x<R> tile=<T>`; `layer add <n> terrain=<family> [outside=on] \| tiles \| objects \| overlay=<o> on=<where>`. The art is read from the named assets when drawn (`MapWorld`), never on the tape. |
| Terrain painting through the autotile schemes | §4.11, G8 | done | `map.test.ts` (six random terrains: every cell's pixels are the variant `resolveVariant` gives, from the family's sheet) | `terrain <layer> rect\|ellipse\|brush\|fill\|paint\|clear [erase]`; reuses `resolveMap`. Terrains stack (meadow over shore). |
| Placing tiles and multi-cell objects by name, with footprint collision | §4.10, §4.11, G8 | done | `map.test.ts` (overlaps on one and on two objects layers, off the map, move and remove; replay needs no other asset), `g8.test.ts` (refused through MCP) | `place`, `move`, `remove`; the footprint goes into the line (`cells= anchor=`). A family's variant by name (`shore.ns`). |
| `map gen`, `road`, `scatter` on maps | §4.11, G8 | done | `map.test.ts` (smoothed land: no one-cell spits, the edge clear) | island, village, dungeon; `scatter <assets> on= off= minDist= fp=`. |
| Footprints, anchors, block and roof flags | §4.10, G8 | done | `map.test.ts` (normal form; `fit`) | `footprint <C>x<R> [at=] [anchor=] << . b r x >>`; kind `object`. |
| Draw order: objects by base row, roofs last | §4.10, G8 | done | `map.test.ts` (an overhang that is not a roof; a roof hiding a pole in front) | `draworder` check. |
| `split` into one-cell pieces and reassembly | §4.10, G8 | done | `map.test.ts` (identity for three assets; flags on the stamp), `g8.test.ts` | `export format=split`: `<name>_<cx>_<cy>.png` + `<name>.stamp.json`. |
| Texture variants | §4.1, G8 | done | `map.test.ts` (variants break an edge run; the `variant` check), `example.test.ts` | `variant of=<base>`; maps pick per cell. `variant` check (L1 < 0.3, ΔL* < 2). |
| Map checks: seam, repetition hot spots (edge runs, motifs), footprint, draw order, coverage | §4.11, §14, G8 | done | `map.test.ts`, `g8.test.ts`, `example.test.ts` (the village passes) | Hot spots are cells; `marks=failing` outlines them. |
| Map views at game scale: whole, region, camera; an object on its ground; map diffs | §4.11, §4.10, G8 | done | `g8.test.ts` | `view map [region=] [camera=x,y]`; `style.camera` (384x216). `changes` on a map: what moved, before and after. |
| Tiled `.tmx` export | §4.11, G8, G9 | done | `map.test.ts` (every gid is the family tile of the composed cell; objects with footprints), `g8.test.ts` | Since G9 through the `tiled` profile: the ground layers point at the families' `.tsx` wang sets (G8's baked tileset is gone). |
| Review bundle with scenes | §5, G8 | done | `g8.test.ts` (no method names) | `scenes/<map>.png`, screens at game scale, `cells.txt`; an eighth rubric question. |
| UI: the map editor (paint terrain, place, move, remove; camera, zoom, hot spots) | §8.3, G8 | done | `map.spec.ts` (each control's logged line; core's composition of the replayed tape equals the canvas; looking logs nothing) | Screenshots `docs/screenshots/g8-*.png`. |
| Demo: a 40x30 coastal village from the G7 shore plus a meadow and a lane, a 48x48 house, a 24x48 tree and a well; viewed at game scale; repetition hot spots found and fixed with texture variants; a person moves the well in the UI and `changes` reads it; a blind review round | G8 | done | `example.test.ts` (rebuild from scripts, the person's move included; every check passes), `examples/demo-g8-agent.ts` (a headless browser plays the person) | `examples/demo-g8.md`; repetition run 12 · 16/16 → run 4 · 10/16, seam 0.07; review findings in `reviews/2026-10-28-g8/findings.md`, five scene notes left open (sea, sand, straight coast, square corners, lanes short of the beach). |
| The profile format and engine | §4.9, §7, §17, G9 | done | `profile.test.ts` (round trip through every built-in profile and the sample; names, numbering, mirrors flagged, roles, density pages, snippets; duplicate names refused) | `core/src/profile.ts`; reference in docs/profiles.md. Naming templates, autotile naming per scheme, numbered sets, views, texture variants as frames, oversized as sprites or pieces, role encoding, density levels (authored, reduced or scaled), records CSV or JSON, snippets. |
| Layouts: loose PNGs, atlas page plus CSV or JSON, sheets, Tiled `.tsx` wang sets and `.tmx`, Godot terrains, Aseprite JSON, `.aseprite` | §4.9, G9 | done | `profile.test.ts` (each built-in profile round-trips; Tiled wang sets and map gids), `map.test.ts`, `g8.test.ts` | Built-in profiles in `core/profiles/`. Godot writes families only (terrains); untested in Godot itself. |
| The CSV page layout | §7.4, G9 | done | `profile.test.ts` (a hand-worked page: trimmed boxes, crops, frame sizes, pivots at 1x and 2x, shelf packing) | docs/profiles.md "The CSV page layout". |
| Sample profile with invented names exercising every feature | §17, G9 | done | `profile.test.ts`, `g9.test.ts`, `example.test.ts` | `examples/mossy-ruins.pclaw/profiles/bramble.json` (an invented engine, Bramble). The engine's own profile (§7.4) is for a reader to write. |
| Import: PNG (quantised, sliced by a grid), `.aseprite`, a profile's export read back by name | §4.9, G9 | done | `g9.test.ts` (a sheet with an off-palette pixel; an .aseprite with layers, ticks and a tag; the sample profile's folder reads back exactly), `profile.test.ts` | New assets start from `import` commands carrying the pixels (`cmd-io.ts`); files kept as `blobs/<sha256>.<ext>`. Profile imports compare, not overwrite. |
| `.aseprite` read and write | §4.9, §9, G9 | done | `profile.test.ts` (layers, frames, durations, linked cels, tags, views back exactly) | Indexed; index 0 transparent, so 255 colours. Reads RGBA and greyscale too. |
| PNG reader and inflate in core; quantising | §4.9, G9 | done | `profile.test.ts` (encoder round trip, zlib streams of every block type) | Exact match, then nearest by a weighted RGB distance; palettes built from images. |
| Density sets: `scale`, `density of=`, the `density` check, a pluggable reducer, the density view | §4.7, §5, G9 | done | `profile.test.ts` (ink-vote, mode and nearest against a hand-made fixture; the check flags the right block), `g9.test.ts`, `density.spec.ts` | Reducers `ink-vote` (default), `mode`, `nearest`; `registerReducer`. `style.density` in project.json. The preview panel's density tab. |
| Project schemes read and written into the tape | §16, §17, G9 | done | `profile.test.ts` (def= in the line; replays without the file), `g9.test.ts` | `schemes/*.json`; `new family … scheme=<s> def="<json>"`. |
| Rounder inner corners: a scheme option | §17, G9 | done | `profile.test.ts` (fillet variants resolve), `example.test.ts` | `blob47-round` (cornerRule `either`, vround/hround quadrants, 15 fillets; `family band … fillet=`). Shipped as the example's own scheme; the shore and the meadow use it. |
| The open sea in the repetition check's motif windows; water and sand variants | §17, G9 | done | `example.test.ts` (the village passes) | `water_b/c/d`, `sand_b/c`, `shore_c/d`. |
| The village's five open notes closed | §17, G9 | done | `example.test.ts` | Sea, sand stripes, straight coast, square corners, lanes to the beach (the lanes' outside left empty). |
| Demo: the G6-G8 art through the sample profile into a scratch game folder, read back; the village for Tiled; a sheet re-imported and edited | G9 | done | `examples/demo-g9-agent.ts` (run by hand) | `examples/demo-g9.md`; screenshots `docs/screenshots/g9-*.png`. |
| State cache: each asset's state after its tape, keyed by the tape, the engine and (language 1) the palettes | §18, G10 | done | `cache.test.ts` (every asset of the example byte-identical to a full replay, cached and loaded; a changed tape or a broken file replays; verify catches a cache that differs) | `.cache/state/<asset>.gwc`, its own `.gitignore`. Example: all states 1018 → 75 ms; a CLI run 1.55 → 0.62 s; the example test 49 → 10 s; the unit suite 58 → 20 s. |
| Manifest and schema validation | §7.3, G10 | done | `g10.test.ts` (core: a good manifest; every problem with its path), `g10.test.ts` (server: nothing written when invalid) | `manifest.json`; written by `plan(manifest=)` or `pixelclaw plan --manifest`; docs/pipeline.md. |
| Statuses planned → drafted → checked → reviewed → approved → exported | §7.3, G10 | done | `g10.test.ts` (core ladder and stale marks; server: up the ladder through MCP, a person's approval, an export, down on a change, back on undo) | Worked out, never stored. `mark reviewed\|approved\|rejected` on the tape with the art's hash; exports recorded in `exported.json`. |
| Marks (`mark <name> ["text"]`) | §7.2, G10 | done | `g10.test.ts` (normal form, replay, undo, art hash ignores notes) | Part of the state only when present (old hashes unchanged). |
| Style-guide-driven defaults and thresholds | §7.3, G10 | done | `g10.test.ts` (`new` without a size, palette or scheme; `outline` without `c=`; `shade` without `light=`; replay needs no defaults), `g10.test.ts` (server: `new sprite urn` takes the manifest's size) | Written into the line. `style.light`, `style.sets.<set>.checks`. |
| `consistency` check across sets | §5, G10 | done | `g10.test.ts` (fixtures: the one lit from the wrong side, a height off the plan), `g10.test.ts` (server: a planned height), `example.test.ts` (every example asset passes) | Height against the manifest (G6's note), lightness within a material, outline share, light from the shading gradient, cluster size, ramp steps; objects on a map (§4.11). |
| Palette-swap recolours recognised | §4.8, G10 | done | `g10.test.ts` (a swap is, a copy and a reshuffle are not; readability no longer fails a recolour's IoU 1) | Not compared in consistency or readability's distinctness. |
| Flat templates: mockup screen and coverage maps from the manifest (blob47-round included) | §7.3, G10 | done | `g10.test.ts` (every scheme's coverage holds every variant, blob47-round's 176; golden `g10/coverage-blob47-round.png`; the mockup places every object, same seed same image; golden `g10/mockup.png`), `g10.test.ts` (server) | `templates/`; `plan(templates=true)`, `pixelclaw plan --templates`. |
| The dashboard tab | §7.3, §8.3, G10 | done | `dashboard.spec.ts` (cards by status; Approve and Ask for changes log their marks and core's status from the replayed tape is the card's; filters and opening log nothing) | Screenshots `docs/screenshots/g10-*.png`. |
| The MCP `plan` tool | §7.3, §8.2, G10 | done | `g10.test.ts` (server), `mcp.test.ts` | By set; writes a manifest; draws templates; the dashboard's link. |
| `review` bundles of a manifest set, with a brief; no author or method names | §5, G10 | done | `g10.test.ts` (server: every text file free of author and method names, no PNG text chunks) | `review(set=)`, `pixelclaw review --set`; `brief.md`. |
| The Claude Code skill and its install | §8.1, G10 | done | `g10.test.ts` (server: installs, holds the workflows and the hand-off) | `skill/SKILL.md`, `skill/manifest.md`; `pixelclaw skill install [--dest\|--project]`; bundled in `cli/dist/skill`. |
| Demo: a theme, a manifest and style guide, 20 planned assets on the dashboard, three end to end | G10 | done | `kiln-hollow.test.ts` (verify, rebuild from the scripts, 3 exported and 17 planned (since G11: 8 checked and 15 planned of 26), every check passes) | `examples/demo-g10.md`, `examples/demo-g10-agent.ts`, `examples/kiln-hollow/`, `examples/kiln-hollow.pclaw`; a real blind review (`findings.md`). |
| `jaggies` judges outlines and one-colour lines; steps between neighbouring entries of one ramp inside a shape are shading | §19 (question 138), G11 | done | `g11.test.ts` (core: a shaded ball passes; the same bands with no shared ramp, or two steps apart, fail; an ink doubled corner still fails) | The urns' allowance dropped; the example's urns pass at 0. The detail counts the steps left out. |
| `underlay` command: an image on a reference layer, never art | §6, G11 | done | `g11.test.ts` (core: layer at the bottom, state round trip, art hash unchanged, generate refused in core), `g11.test.ts` (server: the render view shows it) | `underlay <layer> blob=<sha256> image=WxH at= size= [layout=] [from= prompt= provider= model= quality= cost=]`; blobs in `blobs/`. |
| `underlay generate` with an OpenAI image provider; the key from the environment; a cost cap and a cost log per call; a fake provider | §6, §19, G11 | done | `g11.test.ts` (server: a planted fake key never in any project file, log line or result, also when the error echoes it; the request carries it only in its header; the cap refuses before any request; no price refused; usage priced by tokens) | `server/src/underlay.ts`; `/v1/images/edits` with a layout, else `/generations`; `gpt-image-1.5` medium by default ($0.05 est.); cap $0.25 (`cap=`, `PIXELCLAW_UNDERLAY_CAP`, project.json `underlay`); `logs/underlay-costs.jsonl`. Not run live (no key, §19). |
| `underlay import` (any PNG, with a layout) | §6, G11 | done | `g11.test.ts` (server), `kiln-hollow.test.ts` | Resolved by the server (MCP `run`, watch view, `pixelclaw run`) before the batch. |
| `snap`: grid fit, layout match, palette quantise into a draft layer | §6, G11 | done | `g11.test.ts` (core: synthetic grids of known pitch and offset, blurred and noisy, recovered within 0.03 px pitch and 0.35 px offset, ≥ 99 % of pixels back, with and without a hint; noise gives a low R²; the material match; replay without the image), `g11.test.ts` (server: a fake draft of a layout snaps to its materials; the reroll warning) | Pitch from the edge profile's spectrum (mean removed), offset from its phase; block medians; R² ≥ 0.8 and material ≥ 0.85 or a warning. The line records the rows. |
| `import … asset= region= [layer=]`: a tile cut from another asset | §6 workflow, G11 | done | `g11.test.ts` (core) | The pixels go into the line, so replay reads no other asset. |
| Glyph-sheet documents (`new font … chars= cols= baseline= line= spacing=`, `glyph`, `font set`) | §4.6, G11 | done | `g11.test.ts` (core: normal forms, cells in chars order, advances) | Kind `font`; a cell per character; advances by ink unless set. |
| The glyph strip | §4.6, §7.4, G11 | done | `g11.test.ts` (core: the format spec: separator columns before, between and after, every pixel of them `#ff0000`, the top-left pixel the separator, widths the advances, glyph pixels exactly the cells', a glyph in the separator colour refused) | docs/profiles.md "Fonts". With `{asset}.txt` (the characters). |
| BMFont export | §4.6, G11 | done | `g11.test.ts` (core: info/common/page/chars lines, a char line per glyph with box, offsets and advance, the page holds each box), `g11.test.ts` (server) | Text format; ink boxes packed in rows. |
| The `font` check | §4.6, G11 | done | `g11.test.ts` (core: cap height, baseline, advance, line height, maxLine; sprite checks skip fonts) | Cap height, x-height, baseline, drawn glyphs, advances, line height (`maxLine` the profile's limit). |
| `font` in the manifest (`chars`) | §4.6, §7.3, G11 | done | `kiln-hollow.test.ts` (a valid manifest with a font), demo | `new font <name>` takes the cell and chars from the manifest. |
| Icon export modes (`icon mode=tone\|full\|channel`) | §4.5, G11 | done | `g11.test.ts` (core: tone through roles, full and channel as drawn; the palette check per mode; the `mode` record column) | Profiles: `exportColours`; `{mode}` in snippets. |
| Icon-set checks in `consistency`: stroke weight, box fill, optical centre | §4.5, §5, G11 | done | `g11.test.ts` (core: a consistent set passes; a thick, small, off-centre icon fails all three; alone it is still held to the centre), demo | Like with like within a set (tiles, figures, icons; fonts never peers). |
| Fonts in profiles (`fonts.format strip\|bmfont\|both\|sheet`, `separator`, `maxLine`) and `export --format strip\|bmfont` | §4.6, §7.4, G11 | done | `g11.test.ts` (core and server) | docs/profiles.md. |
| UI: underlays drawn faded under the art; a font's sheet on a dark checkerboard and its text preview | §8.3, G11 | done | screenshots `docs/screenshots/g11-*.png`; the Playwright suite unchanged and green | `/api/blob/<sha>.png` (token). |
| Demo: an offline mockup underlay for a 6x4-tile scene, snapped and cleaned into tiles; a 5x7 font as a strip and BMFont; an icon set checked | G11 | done | `kiln-hollow.test.ts` (verify; rebuild the G11 work from the scripts and the mockup; 3 exported, 8 checked, 15 planned of 26; every check passes) | `examples/demo-g11.md`, `examples/demo-g11-agent.ts`, `examples/kiln-hollow/make-yard-mockup.ts`; how to run a live underlay is in the demo. |
| Requests: `requests.jsonl` records and their state machine (open, claimed, blocked, done, cancelled) | §21 (1), G12 | done | `g12.test.ts` (core: every transition, refused records, a bad line skipped, ids, queue order) | Core `foldRequests`/`requestProblem`; server `requests.ts`. `reply` and `cancel` are the person's (question 153). |
| Dashboard requests: Draw this, Ask for changes (with its `mark`), Add an asset (a validated manifest entry); each request's state live on its card | §21 (1), G12 | done | `g12.spec.ts` (the buttons' records fold to the states the cards show; Claude is working on this; done; blocked, answered, open again; withdraw), `g12.test.ts` (server: through a page's socket; refusals) | WebSocket `request` messages; every page hears `requests`. "Claude is working on this": the claimer wrote the asset's latest line after the claim (question 155). |
| MCP `work` (claim the next or a named request, progress, done, blocked, list); `plan` lists requests first | §21 (2), G12 | done | `g12.test.ts` (server, over the HTTP endpoint) | One claimed request at a time per agent. The skill's routine: `plan` at the start and after each asset; requests before planned work. |
| MCP over HTTP at `/mcp` (bearer: the watch token) | §21 (2), G12 | done | `g12.test.ts` (every MCP call there goes over it) | The worker's connection to the running server (question 156). |
| `pixelclaw work` and Start Claude: a headless `claude -p` worker with the MCP server and the skill; a budget cap; one per project; a log on the dashboard; only when `worker.enabled` | §21 (2), G12 | done | `g12.test.ts` (a fake claude: disabled from the button and the CLI, enabled to an empty queue, the cap, one at a time, stop, a blocked request), `g12.spec.ts` (the button only when enabled; its log) | `server/src/worker.ts`, `server/test/fake-claude.ts`; docs/worker.md. Not run with the real CLI (question 158). |
| The gallery: game scale, animated, filters (set, kind, status, failing check), sort, compare, one click to the editor; maps use assets, assets used by maps | §21 (3), G12 | done | `g12.spec.ts` (scale, frames, filters, related, compare) | `/api/strip/<asset>.png` (frames side by side; maps composed). Screenshots `docs/screenshots/g12-gallery*.png`. |
| Import into the gallery: a sheet sliced into assets, a folder, `.aseprite`; the slice dialog (cell, offset, gap, names by pattern or from the plan, palette or adopt); manifest entries; every check run | §21 (4), G12 | done | `g12.test.ts` (server: a sheet with an empty cell and an off-palette pixel into five assets, entries, checks, tapes; names from the manifest; a clash makes nothing), `g12.spec.ts` (the dialog), `kiln-hollow.test.ts` | Same import from MCP (`slice`, `names`, `namesFrom`, `set`), the CLI (`--slice`, `--set`) and `POST /api/import`. Core `sliceCells`, `sliceNames`. |
| Scenes in the manifest; their gaps on the dashboard; `plan(order="scene")` | §21 (5), G12 | done | `g12.test.ts` (core: validation, gaps with the map's uses; server: the report and the text) | Question 163. |
| `map gen` places manifest objects | §21 (6), G10 notes, G12 | done | `g12.test.ts` (core: on the inner ground, off the lanes, apart, replayed byte for byte; the manifest's objects written into the line; refusals; server: through MCP) | `objects=`, `layer=`, `fp=` in the line (question 164). |
| `plan` faster: check results cached by state hash | §21 (6), G11 notes, G12 | done | `g12.test.ts` (server: the cached plan equals a plan with no cache, and is faster; a changed tape runs its checks again) | `.cache/checks/<asset>.json` (question 165). A CLI `plan` on mossy-ruins: 3.8 s with no check cache, 0.8 s with it; Kiln Hollow 1.0 s and 0.7 s (most of what is left is Node starting). |
| Demo: a person imports a sheet into the gallery, asks for two planned assets and a change; the agent takes them through `plan` and `work`: one done, one blocked, one in progress | G12 | done | `kiln-hollow.test.ts` (verify; rebuild of the G12 work; the requests fold to done, blocked, claimed; 3 exported, 9 checked, 3 drafted, 14 planned of 29) | `examples/demo-g12.md`, `examples/demo-g12-agent.ts` (run by hand); screenshots `docs/screenshots/g12-*.png` and `scripts/screenshots-g12.ts` (the worker with the fake). |
| `repetition`: the limit scales with the band's spread along its length (one mark on a calm tile is not a stripe) | §23 (1), G13 | done | `core/test/checks.test.ts` (G13 case), `cli/test/check.test.ts` | `contrast` 3 standard errors (0: the old rule); the band reported is the one nearest to failing, so grass_b's faint rows now read "rows 1-2 … 3.7" (still failing). |
| MCP `seeds` and `pixelclaw seeds`: a generator line tried with N seeds as dry runs, ranked by the checks | §23 (1), G13 | done | `server/test/g13.test.ts`, `cli/test/g13.test.ts` | Fewest failing, then least over the limits, then most room. `apply` runs the best; `before` runs commands first; any line the normaliser writes a seed into (noise, scatter, voronoi, bricks, map gen, family coverage, family band jitter). |
| `run dry=true` and `pixelclaw run --dry` | §23 (1), G13 | done | `server/test/g13.test.ts`, `cli/test/g13.test.ts` | The checks see the copy in place of the asset; nothing reaches the tape, the files, the caches or the watchers. Underlay generate/import refused in a dry run. |
| Face cells drawn on maps whatever the terrain layer's fill | §23 (2), G13 | done | `core/test/g13.test.ts` (item 2) | With `outside=off` a face cell draws its face art (every layer but the ground textures). Also: `family band draw=on` leaves face pieces alone (found in the demo). |
| Underlays sized from the placed area | §23 (3), G13 | done | `server/test/g13.test.ts` (item 3) | `size=` (else the canvas) picks 1536x1024, 1024x1536 or 1024x1024; a layer layout is cut to the area; the fake draft's grid is the area. |
| Snap on the placement's grid; a seam warning after `family cut` | §23 (4), G13 | done | `server/test/g13.test.ts` (item 4), `cli/test/kiln-hollow.test.ts` | `fit=placement` (default): one block per placed pixel, only the offset fitted; `fit=free` is G11's search. The cut warning runs the family's seam over a sample island (also in dry runs). |
| `tiles <layer> fill <tile> [box] [replace]`; `walkable=on` terrain layers | §23 (5), G13 | done | `core/test/g13.test.ts` (item 5), `e2e/map.spec.ts` (G13) | One-cell tiles; the cells are worked out when the line is written. Walkable: the layer's filled ground and edges are ground for `footprint`. Map editor: ▦ fill tool and a walkable box. |
| Profiles: `autotile.<scheme>.corners`, `shapes` and `{shape}`; `colours` (per-colour output map) | §23 (6), G13 | done | `core/test/g13.test.ts` (item 6) | Shapes: lone, end, straight, corner, tee, cross (a path's dead ends apart from its straights). `colours`: entry (or palette.entry) to `#rrggbb` or a role `roles` gives; import reads them back. |
| `family band … jitter=<n> [seed=]` | §23 (7), G13 | done | `core/test/g13.test.ts` (item 7) | A 1-D value-noise field along each edge (vertical edges vary with y, horizontal with x), repeating every tile, integer maths; every band edge moves with it. |
| `variant of=<base> band=inherit`, `family band from=<family>`, the writer's follow-up | §23 (8), G13 | done | `server/test/g13.test.ts` (item 8) | The band (geometry, detached, band layer) is copied into the variant's tape; after every batch that changes the base the writer writes `family band from=<base>` on each inheriting variant (same author, its own group). Band layer locked; band edits refused there; `band=own` undoes it. |
| No part of the key written; input-image tokens priced | §23 (9), G13 | done | `server/test/g13.test.ts` (item 9), `server/test/g11.test.ts` | Scrubs the key, `sk-…` shapes (masked too) and any run of 4+ of its first or last characters. An edit's estimate adds the layout's input tokens (and the prompt's). Token prices added for gpt-image-1.5 and -mini (to be checked by a reader); the line's cost is now usage-based for 1.5. |
| Smaller items: consistency on small sets; face coverage template; review `cells.txt`; CLI export refused under a server | §23 (10), G13 | done | `core/test/g13.test.ts` (item 10), `cli/test/g13.test.ts`, `server/test/g9.test.ts` | The whole set's median (itself included); faces drawn in the template's top half; `mapCellsText` (ground as shown, objects as capitals); `export` (profile and format) call the server lock check. |
| Demo: Fern Ledge (items 1-8) | §23, G13 | done | `examples/demo-g13-agent.ts` (run by hand), `examples/demo-g13.md` | Screenshots `docs/screenshots/g13-*.png` (`scripts/screenshots-g13.ts`). Every asset of the set passes its checks; the pillar is left a draft on purpose. |
| Map-scale `lattice` check | §24 (1), G14 | done | `core/test/g14.test.ts` (item 1: fails Fern Ledge's floor at 47%, passes it mixed; scales at 48 px), `server/test/g14.test.ts` | A mark (≥ 18 ΔL* off its cell's median, ≥ t²/128 px, under ¾ of a cell) at the same spot (± t/16 − 1 px) in more than 30% of one ground's cells (an asset and its variants). In `check`, map `run` summaries, chips and hot spots. Plan question 185. |
| `tiles <layer> fill mix=<tile>:<weight>,…` and the fill tool's mix | §24 (2), G14 | done | `core/test/g14.test.ts` (item 2), `e2e/map.spec.ts` (G14 test) | Seeded; equal neighbours avoided where another tile is left; counts follow the weights; weights shared with unnamed variants (`variants=spread`); cells drawn exactly as named (`exact` entries). Plan questions 187-189. |
| Inheriting variants record only pieces and detached cells | §24 (3), G14 | done | `server/test/g14.test.ts` (item 3), `server/test/g13.test.ts` (item 8, line form updated) | `family band from=… cells=<names> <<` rows side by side `>>`; 33,110 → 4,348 bytes per sync on a 24 px blob47 sheet; the G13 form still replays. Plan question 190. |
| 48 px audit: the project's grid and what assumed 16 or 24 px | §24 (4), G14 | done | `server/test/g14.test.ts` (item 4), `core/test/g14.test.ts` (item 4), `cli/test/cli.test.ts` (`--grid`), `e2e/g14.spec.ts` | `--grid` / `project(grid=)`; `new map` tile, camera (16x9 cells), draw scale (1x from 48), family map and camera view at the draw scale, game view once at 1x, noise specks, repetition bands, jaggies allowance, icon/height limits, preview island, gallery scale, map cells text layer order. Plan questions 191-194. |
| 48 px example `examples/ember-moor.pclaw`; the skill's per-size defaults | §24 (5), G14 | done | `cli/test/ember-moor.test.ts` (verify, every check, scripts rebuild it, the skill's table) | Original palette and theme (`examples/ember-moor/`); moor + 2 forked variants, bog, blob47 pool, waystone, 20x12 map with `fill mix=`. |
| Demo: Fern Ledge's floor before and after a mix; the 48 px set on a map | §24, G14 | done | `examples/demo-g14-agent.ts` (run by hand), `examples/demo-g14.md` | Screenshots `docs/screenshots/g14-*.png` (`scripts/screenshots-g14.ts`). The G13 stand-in is left as the "before" (plan question 195). |
| The worker's sandbox: no built-in tools, only PixelClaw's | §26 (1), G15 | done | `server/test/g15.test.ts` (`pixelclaw work` with a recording `claude` on the PATH; the installed CLI's `--help` names every flag; the real Claude Code against a stand-in model refuses `Bash`, `Read`, `Glob`, `Grep`, `Write`, `Edit`, the web, `Agent`/`Task`, `NotebookEdit`) | `--tools ""`, every built-in in `--disallowedTools`, `--allowedTools mcp__pixelclaw`, `--permission-mode dontAsk`, `--setting-sources user`, `--strict-mcp-config`. `args` only `--model`/`--fallback-model`/`--effort`; `command` may not pass tool or permission flags. What it can and cannot reach: docs/worker.md. Plan questions 196-199. |
| The worker's MCP connection fenced to the project | §26 (1), G15 | done | `server/test/g15.test.ts` (probes: another project, palettes, import, export dest and profile, underlay import and layout outside, underlay generate, a path as an asset name; the watch token not fenced; a stranger's token refused) | A token per run; no `request` tool on it. Plan question 198. |
| `work done` refused while the asset fails a check | §26 (1), G15 | done | `server/test/g15.test.ts` (worker discipline), `e2e/g12.spec.ts` (done refused once) | The reply lists the failing checks; not drawn is refused too; `blocked` always open. Plan question 200. |
| Stall watchdog; spend ledger; command reference in the prompt | §26 (1), G15 | done | `server/test/g15.test.ts` (stalled and resumed; stalled twice and blocked; three runs to the cap and a refused start; the reference is every command) | `worker.stall` minutes; `--resume <session>`; an estimate at the dearest rates for a stopped session; `worker-spend.jsonl`, the cap a total; dashboard "$x of $y cap spent". Plan questions 201-203. |
| Requests from the CLI and MCP | §26 (2), G15 | done | `cli/test/g15.test.ts` (draw, change with its mark, add with its entry, the list, refusals, reply, cancel, a server owning the project), `server/test/g15.test.ts` (MCP `request`; not on the worker's connection) | `pixelclaw request draw\|change\|add`, `reply`, `cancel`; MCP `request`. Plan question 204. |
| Lattice: ΔE, marks by centre, weighed by their share | §26 (3), G15 | done | `core/test/g15.test.ts` (item 3: Fern Ledge fails then passes after its mix; a puddle grid fails, 0% → 100%; a dense four-fork pebble floor passes, 100% → 10%) | Example maps: mossy-ruins village 1% → 1%; ember-moor moor_map 0% → 26% (its purple heather clump, which ΔL* could not see); Fern Ledge (out/, G13's stand-in) floor 47% → 47%, glade 46% → 46%; after G14's mixes 23% → 23% and 28% → 28%. Plan questions 205-206. |
| Terrain on maps: border rule, inside mix, textures follow their tiles, blob47-round built in | §26 (4), G15 | done | `core/test/g15.test.ts` (item 4), `core/test/map.test.ts` (random terrains under all three border rules), `server/test/g15.test.ts` (textures follow, frame by frame), `e2e/g15.spec.ts` (the terrain tools) | `layer add\|set … border=same\|terrain\|not`, `mix=…`; the map editor's terrain tools set both. Plan questions 207-210. |
| A two-tile mix is not a strict checkerboard | §26 (5), G15 | done | `core/test/g15.test.ts` (item 5) | Two tiles: no 2x2 block of one; three or more keep G14's rule. Plan question 211. |
| `plan` EPIPE; `view render` region, `tile3x3` scale; one region format; orphans' 2 px rule | §26 (6), G15 | done | `cli/test/g15.test.ts` (the smaller items) | docs/checks.md (orphans), docs/commands.md (views, regions). Plan question 212. |
| Demo: requests from the CLI, the worker with a stand-in model, a terrain map | §26, G15 | done | `examples/demo-g15-agent.ts` (run by hand), `examples/demo-g15.md` | The real Claude Code with a stand-in model; screenshots `docs/screenshots/g15-*.png` (`scripts/screenshots-g15.ts`). Plan question 213. |
| Generators for structure: `pebbles`, `tufts` | §26 G16 (1) | done | `core/test/g16.test.ts` (item 1: normal forms and the style's light; seeded; every pebble size clean under four lights; tufts lit on the light's side; at 16, 24 and 48 px four looks with one `edges=` on a mixed floor pass jaggies, orphans, repetition, seam, lattice and the map's repetition and seam, two seeds each; looks share what crosses their edges), `cli/test/g16.test.ts` (`seeds` ranks them; the style guide's light in the line) | Placement evens rows and columns by the repetition and seam measures (moves, tones, heights; a few attempts on small tiles); `edges=<seed>` shares the shapes across a tile's edges between looks; noise of a shape's colour beside it is cleared. Plan questions 215-217. |
| Face scheme: side faces, inner corners, alternate looks; the `lane` scheme (a filled path, diagonal turns) | §26 G16 (2) | done | `core/test/g16.test.ts` (item 2: the face scheme resolves 9 south faces, 12 side faces and 3 corners; side faces and corners drawn beside the terrain with outside on and off; alternates placed by cell, a copy of the middle until detached and drawn; the coverage template draws them; a three-wide lane has a plain middle where `path` shows grass at every inside corner; a diagonal lane is one connected strip whose rows all cross the same run, clean 45° steps), `core/test/schemes.test.ts` (updated: 75 face variants; a face beside terrain is now `face_ie`, not `face_o`) | `scripts/gen-schemes.ts` writes `core/schemes/face.json` (47 + 28) and `lane.json` (82 + 15). Faces (`on: face\|side\|corner`) are drawn on maps whatever the layer's fill; lane strips are measured across a row. Plan questions 218-220. |

## Notes for G8

- **Map documents** should reuse `resolveMap`, `composeMap` and `Terrain` (core/src/schemes.ts,
  family.ts): terrain painting is a terrain grid per layer resolved through the family's scheme.
  A map that names families by asset reads them at render time (as `view map with=` does for
  overlays), not on its tape.
- **Repetition and motifs on maps** (§14): the shore's island shows the sand tile's two pebbles on
  a 24 px lattice, and every long straight shore repeats the same `ew`/`ns` detail every tile.
  The map checks' hot spots should catch both; texture variants (`variant add`, §4.1) are the fix.
- **Islands are blocky**: blob47 coasts follow the tile grid. Map layout helpers (`map gen`) could
  smooth the terrain (no single-tile spits) and offer other shapes than an island.
- **Overlays on map documents**: an overlay's `on=` knows outside, terrain and all; a map with
  several terrains will want `on=<terrain or variant>`.
- **Project schemes**: a project's `schemes/*.json` is not read yet (plan question 85); a tape that
  uses one must carry it, like the palette.
- **bridge8's north-south single** can only be placed by name: map documents' `place` will need it.
- **Faces** draw in the cell below the terrain; a map's draw order (§4.10 roofs and canopies)
  should take the face scheme's faces as the first case of art spilling into another cell.

## Notes for G9

- **Export profiles** should take over G8's two stopgap exports: `split` names pieces
  `<name>_<cx>_<cy>` and writes a stamp JSON; `tmx` bakes every distinct composed tile into one
  tileset. A profile's naming template (`root_<letters>_<diagonals>`) and the engine's footprint
  fields (block, roof, anchor, pivot) are already on the assets (`footprint`, `pivot`) and on the
  split stamp; Tiled `.tsx` wang sets from families and Godot terrains are G9's list.
- **Variants on export**: a map picks among an asset and its variants per cell (`variant of=`);
  an engine profile must either export each variant as a numbered frame of one tile
  (`<name>_<n>`) or bake the map. The `variant` check's border report says which variants keep
  their base's edges (safe to mix in any order).
- **Density**: objects are 24-px-grid art (house 48x48, tree 24x48); the `density` check and
  2x/4x copies should handle oversized assets and their footprints (a 2x house is 96x96 with the
  same footprint in cells).
- **Maps and palettes**: a map composes many palettes (merged by name and colour, `MapPalette`);
  an export of a scene PNG uses that merged palette. Role art on maps is drawn in its own colours
  (no theme yet).
- **Project schemes** are still not read (plan question 85); a map's terrain layer reads its
  family's scheme when drawn, so a project scheme would only need the family's tape to carry it.
- **Readability of objects on each ground and screen-wide consistency** (§4.11's last map
  checks) are left for G10's `consistency`.
- **Open notes from the G8 review** (on the village): the open sea is one water tile (the
  `repetition` motif measure leaves out a filling layer's outside ground, plan question 109; the
  reviewer saw its diagonal weave), the sand's darkest mark lines up on the beach, the coast and
  the meadow's edges run straight with near-square inner corners (blob47's inner corner is as
  round as the band is wide), and the lanes stop short of the beach (a lane's outside is grass).
  Water and sand variants, and a scheme option for rounder inner corners, would close them.
- **Objects as variants**: `tree_b` is a variant of `tree`, so a map mixes them per cell; an
  export must write both (and say which cell got which, for a `.tmx` this is baked already).

## Notes for G10

- **Speed**: every CLI call replays every asset (tapes under 200 commands have no checkpoints), and
  the `blob47-round` families are heavy (176 cells, four frames, four looks of the shore): a CLI
  run on the example takes about 1.6 s and the example test 50 s. A state cache (the last state
  bytes beside each tape, checked against the tape's hash) would make the manifest and dashboard
  of G10 cheap.
- **Manifest and statuses**: `exported` can be recorded by `export` (the profile and the folder);
  the `plan` tool can list assets whose last export is older than their tape.
- **Style-guide defaults**: `style.density` (reducer, ink, share) and the sizes per density level
  are in place; the master density per project is still `grid` with levels relative to 1x; a
  4x-first workflow (author 4x, reduce to 1x as a draft) would want an `import` of the reduction.
- **Consistency** (§5, G10): a recolour shares its source's silhouette (the demo's `walker_sheet`
  fails readability with IoU 1); palette-swap variants (§4.8) should be recognised as such.
- **Exports at scale**: the whole example through an atlas profile is one 384-px-wide page 5,700 px
  tall (the shore's four looks are 2,848 images). Pages per family or a page height limit, and
  leaving fillet cells out for engines that do not round corners, are profile options to add when a
  real engine profile asks.
- **Not built in G9**: GIF and contact-sheet layouts in profiles (§4.9 lists them; the `anim` view
  writes both), writing an import back into an existing asset's tape (imports create assets;
  profile imports compare), the encoding margin of §5's palette check (needs the engine's
  thresholds, so the engine profile), a coverage map for `blob47-round` (161 variants need a large
  one), Godot and Tiled files opened in the real applications.
- **The engine's own profile** (§7.4) is for a reader to write outside the repo, from the sample
  `bramble.json`: CSV columns, `@2x` and `@1x` levels, five-tone `roles`, autotile names (`root`,
  `root_surrounded`, `root_<letters>_<diagonals>`), numbered sets, Lua snippets.

## Notes for G11

- **Underlays follow the templates**: §6's workflow is code-drawn flat layout → mockup underlay →
  snap. `templates/mockup.png` (a camera-sized screen from the manifest) and the coverage maps are
  that flat layout; `underlay generate … layout=` can take them, and a snapped coverage map can be
  cut into a family (`family cut`).
- **Icons and fonts in the manifest**: `kind` follows the document kinds (no `font` yet); the
  icon-set checks (stroke weight, bounding-box fill, optical centre) fit `consistency`, which
  already holds a set to its median (icons are compared with icons).
- **`jaggies` on shading inside a ramp** (plan question 138): a round form's stepped bands count as
  doubled corners; the urns have a style-guide allowance.
- **`map gen` from the manifest** (§4.11): it still lays out terrain only; the manifest now lists
  the terrains and objects a scene `uses`.
- **Cost of the plan**: `plan` runs every check on every drawn asset (2 s on the mossy-ruins
  example; kept in the server until something they read changes). The state cache is 8 MB there,
  uncompressed.
- **Cost of this step**: not measured.

## Notes for A1

What the acceptance project (§10 A1) will need, from G11's side:

- **A live underlay.** Arm (b) needs real mockups: the user's `OPENAI_API_KEY` in the environment
  of the server (or of `pixelclaw run`); how is in `examples/demo-g11.md` ("A live underlay with
  your own key"). Not run by the builder (no key, §19). The default is `gpt-image-1.5` at medium,
  1536x1024, about $0.05 an image by the price table plus the layout's input tokens; the cap is
  $0.25 a call; every call is in `logs/underlay-costs.jsonl`, which is how A1 records its image
  cost. Check the price table against OpenAI's page first (`DEFAULT_PRICES` in
  `server/src/underlay.ts`, or project.json `underlay.prices`).
- **Snap on real drafts is the open risk.** Snap was proven on synthetic grids and on the offline
  fake draft (R² 0.97, material 0.98). A generated image seldom keeps a crisp pixel grid at the
  document's resolution; expect low R² and rerolls. Things to try in A1, in this order: a prompt
  that names the grid ("crisp square pixels, 24 px tiles, 144x96 pixels"); `quality=low` for
  cheap rerolls; snapping a scene sheet whose size matches what the image really shows; tracing at
  24 px over the underlay instead (§6 allows both; A1 compares them).
- **Cleaning snapped tiles.** Cut tiles need `clean orphans size=2` and stripe fixes before they
  pass `repetition`, `seam` and `consistency` (the demo's `*_clean.pclaw`). A cell with a low seam
  is worth picking before cleaning (the demo tried several). For families, cut a snapped
  coverage map with `family cut` (G7) rather than tiles one by one; not tried with an underlay yet.
- **Fonts and icons** are ready for the engine profile: the strip with `#ff0000` separators (§7.4)
  is the default for fonts in every profile (`fonts.separator`, `fonts.maxLine` carry the
  engine's rule); icons export in their mode, `tone` through the profile's `roles`. The engine's
  own profile (§7.4) still has to be written by a reader.
- **jaggies** now leaves ramp shading alone; A1's round forms need no per-asset allowances.
- **Time and cost.** The full suite takes about 30 s (vitest) plus 75 s (Playwright); a snap of a
  1536x1024 image takes about 1-2 s. `plan` still runs every check on every drawn asset.
- **Cost of this step**: not measured.


## Notes for the next step (after G12)

- **Run the worker once for real.** The builder has no reason to spend money and used a fake
  `claude` that takes the same arguments. A reader should enable `worker` on a scratch copy of
  Kiln Hollow with a small `cap` (1), ask for one planned prop, press Start Claude, and check: the
  flags are accepted by the installed Claude Code (`--max-budget-usd`, `--allowedTools
  mcp__pixelclaw`, `--append-system-prompt`, `--strict-mcp-config`), the HTTP MCP connection
  works (Claude Code's `"type": "http"` with a bearer header), the reported `total_cost_usd` lands
  in the log and the panel, and the session asks with `blocked` rather than in chat.
- **The open requests in the example.** Kiln Hollow keeps r2 (the goat, blocked on horns and
  colour) and r3 (the jar's wider mouth, claimed by claude, a note pinned) on purpose, to show the
  states. Answer r2 and finish r3 when the example is next carried on; the shards need their
  jaggies fixed (drafted).
- **Imports and set consistency.** Importing into an existing set changes its medians: the shards
  in `props` would have failed the urn's consistency (ramp steps). The import result lists each new
  asset's checks but not what the import did to the set's other assets; a line for those would
  help.
- **Gallery at scale.** The gallery loads every asset's strip at once and the page replays every
  tape on connect; fine for Kiln Hollow (30 assets), worth paging or lazy loading past a few
  hundred. Maps are composed by the server per request (not cached by state).
- **Worker log retention.** `logs/worker.log` grows without bound (the dashboard shows the last
  200 lines); rotate it if runs become routine.
- **Cost of this step**: not measured.

## Notes for the next step (after G13)

- **Check the new token prices.** `DEFAULT_PRICES` now has token prices for `gpt-image-1.5`
  ($5 text in, $8 image in, $32 image out per million) and `gpt-image-1-mini` ($2, $2.50, $8),
  from memory of OpenAI's page. With usage reported, a line's `cost=` is the usage price: a reader
  should compare one live call's `logs/underlay-costs.jsonl` with the bill before A1's arm (b).
- **Arm (b) with a working key.** Snap now fits the placement's grid by default, and the image is
  asked for in the area's shape; the open risk stays a generated draft without a crisp grid (low
  R²). `fit=free` is still there to compare.
- **Inheriting variants are followed by the writer, not by replay.** A variant's tape holds a copy
  of the band at each change (big lines on large sheets: about 30 KB for a 24 px blob47 sheet). If
  many variants follow one base, consider recording only the pieces and detached cells.
- **`seeds` ranks, it does not judge.** It orders by failing checks and how far over; two seeds that
  both pass are ordered by the room left on their closest check. A look at the 3x3 still decides.
- **Repetition's reported band** is now the band nearest to failing, not the darkest stripe; a pass
  may name a faint row of the noise rather than a mark. The detail says when a limit was raised.
- **Map views and `cells.txt`** differ on purpose: `view map`'s text is by layer (what the agent
  paints); a review's `cells.txt` is by what each cell shows.
- **Cost of this step**: not measured.


## Notes for the next step (after G14)

- **The lattice limit (30%) is a judgement.** It fails Fern Ledge's floor (47%) and passes mixes
  where each look carrying a mark is a quarter or less. A reader should look at a map near the
  limit (the glade after the fix is 28%) and say whether the pebbles still read as a grid; the
  limit is `style.checks.lattice.max`, the mark's contrast `contrast`.
- **`fill mix=` pins each cell to the tile drawn for it.** A variant added later is not used by a
  mixed floor until it is filled again (`replace`); a plain `fill <tile>` still picks among all of
  a tile's variants at draw time.
- **48 px variants: fork, then change the inside.** Independent noise tiles side by side seam at
  48 px (the moor's three looks scored 1.1-1.5 on the map before they were forked; 0.35 after):
  bigger specks are cut by the border. The skill says so; a `variant` helper that keeps the border
  ring automatically would make it the default.
- **The map editor at 48 px** has 1x and 2x only: a 20x12 map at 1x (960 px) is wider than the
  pane and scrolls. A "fit" zoom would help larger maps at any size.
- **A2's 48 px run** should start with `project(grid=48)` (or `--grid 48`): the camera, the draw
  scale and new maps follow it; the manifest's sizes still say each asset's own size.
- **A map's preview.png** (the dashboard card) is the cell grid, one pixel per cell: dark and
  tiny at any size. Showing the composed map there would help the dashboard.
- **Cost of this step**: not measured.


## Notes for the next step (after G15)

- **Run the fenced worker once for real** (a reader, cap $1 on a scratch copy): the flags were checked
  against Claude Code 2.1.312's help and its behaviour with a stand-in model, not with a real model.
  Watch that the session still does its work with only PixelClaw's tools (it has never had a shell
  to lean on now), that `done` refusals are fixed rather than turned into `blocked`, and that the
  log's first session line says `tools: 12 PixelClaw, nothing else`.
- **The stall estimate's prices** are Opus 4's list rates from memory, chosen as an upper bound;
  compare one stopped session's estimate with the account's usage. The default `stall` (10 min)
  is a guess too; A2's one stall lasted 57 minutes.
- **The ledger is for the project, forever.** Raising `worker.cap` is the only way on once it is
  spent; a reset (or a ledger per month) may be wanted if the worker becomes routine.
- **User-level context still reaches the worker**: your `~/.claude/CLAUDE.md` and user settings
  (hooks included) load into its session, as for any Claude Code session. `--bare` would drop them
  but breaks OAuth logins; a worker-specific `CLAUDE_CONFIG_DIR` could be an option.
- **Lattice weights**: a mark now counts by its share of its cell's marking. Ember Moor's map rose
  to 26% (its heather clump, now seen in colour), close to the 30% limit; the demo's hollow sits at
  26% too (clover's lichen dots). A reader should look at both.
- **The border rule changed every composed map** whose terrain touches the edge (on purpose):
  composed views and checks differ, tapes and exports do not. Mossy Ruins' village passes every check
  as it did.
- **Kiln Hollow's `shards_*`** still fail `jaggies` (imported drafts since G12).
- **Cost of this step**: not measured.
