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
| CLI `new`, `run`, `view`, `check`, `review`, `verify` | §8.1, G1, G5 | done | `cli.test.ts`, `check.test.ts`, `example.test.ts` | `check` exits 1 when a check fails. `export` and `import` come with G9. |
| Demo: 24x24 seamless stone floor from a script | G1 | done | `example.test.ts` (verify, plus a rebuild from the script) | `examples/mossy-ruins.pclaw`, script `examples/scripts/stone_floor.pclaw`. |
| Server package: project I/O moved from the CLI; the single writer (one queue, in-memory states) | §8.1, G2 | done | `mcp.test.ts`, `cli.test.ts` | Every batch from MCP, the CLI or (G3) a page goes through `Writer.run`. |
| Single writer across processes: `.pixelclaw.lock` | §8.1 | done | `mcp.test.ts` (CLI refuses; lock released on exit) | Pid and URL without the token. CLI `new`/`run` refuse while a live server holds it. |
| `pixelclaw serve --project <dir> [--port] [--no-mcp]` | §8.2, G2 | done | `mcp.test.ts`, `pack.test.ts` | Creates the project if missing. Stops when stdin closes or on a signal. |
| MCP over stdio (official TS SDK v2), server instructions | §8.2 | done | `mcp.test.ts` | Serves both protocol eras (2025 `initialize` checked by hand). Instructions carry a command cheat sheet and ask the agent to share the watch link. |
| MCP `project` | §8.2 | partial | `mcp.test.ts` | Palettes, assets, watch link; open/create another folder; add palette files. Profiles come with G9. |
| MCP `run` | §8.2 | done | `mcp.test.ts`, `g5.test.ts` (server) | One undo group; applied lines, pixels changed, warnings, a check summary, an optional view; errors with line:col apply nothing. |
| MCP `view` | §8.2, §2 | partial | `mcp.test.ts`, `edits.test.ts`, `g5.test.ts`, `g6.test.ts` (server) | `render`, `grid`, `tile3x3`, `diff`, `game`, `recolour`, `anim`, `map`, `family` (G7); `marks`, `theme`, `ground`, `with`, `size`, `seed`. `density` G9. |
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
| Tiled `.tmx` export | §4.11, G8 | done | `map.test.ts` (every gid is the composed cell's tile; objects with footprints), `g8.test.ts` | MCP `export`, `pixelclaw export`. Godot and `.tsx` wang sets are G9's. |
| Review bundle with scenes | §5, G8 | done | `g8.test.ts` (no method names) | `scenes/<map>.png`, screens at game scale, `cells.txt`; an eighth rubric question. |
| UI: the map editor (paint terrain, place, move, remove; camera, zoom, hot spots) | §8.3, G8 | done | `map.spec.ts` (each control's logged line; core's composition of the replayed tape equals the canvas; looking logs nothing) | Screenshots `docs/screenshots/g8-*.png`. |

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
