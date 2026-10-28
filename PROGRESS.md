# Progress

Status of plan features touched so far. Steps refer to the build plan (§10).

| Feature | Plan | Status | Validated by | Note |
|---|---|---|---|---|
| Repo skeleton: pnpm workspaces, TypeScript strict, vitest | §8.1, G1 | done | `pnpm test`, `pnpm typecheck` | Node ≥ 22.18 runs the `.ts` sources directly (type stripping). vitest 4 + vite 7 keep every installed dependency permissively licensed. |
| Dependency licences | CLAUDE.md | done | `test/licences.test.ts` | Every installed package is MIT, ISC, Apache-2.0 or BSD (checked on each test run). |
| Indexed document: cell grid, wrap flag (layers and frames: G4 below) | §3.1, §3.2 | done | `commands.test.ts` (wrap/clip), `golden.test.ts` (`wrap`, `sheet`) | Stored as layers × frames of cels, ready for G4/G6. `TRANSPARENT = 0xffff`. |
| Palettes: JSON (key/name/hex, ramps) | §3.1 | done | `palette.test.ts` | Keys are one character; `.`, space and `|` are reserved. Names are identifiers; `none` is reserved. |
| Palette import: `.hex`, `.gpl`, Lospec JSON | §3.1 | done | `palette.test.ts`, `cli.test.ts` | Keys are assigned automatically (0-9, a-z, A-Z, punctuation, then Latin-1). |
| Role palettes | §3.1 | deferred | — | G5. |
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
| Render: scaled PNG with pixel grid and rulers | §2 (1) | done | goldens `*.png` | Overlays (selection, check marks) come with G5. |
| Render: text index grid with region | §2 (2) | done | goldens `*.txt`, `paint.region.txt`, `cli.test.ts` | Includes a legend with pixel counts. |
| Render: `tile3x3` at 1x and 4x | §2 (4) | done | golden `wrap.tile3x3.png` | |
| Project folder (§7.1): project.json, palettes/, assets/<name>/ | §7.1 | done | `cli.test.ts` | style.md, manifest, schemes, profiles, blobs, exports and reviews come in later steps. |
| Checkpoints | §7.1, G3 notes | done | `checkpoints.test.ts` (written every 200, loaded from, damaged and stale ones fail verify, removed on restart) | `NNNNNN.gwc`: a header with the tape prefix's SHA-256, then the state bytes. See G4 below. |
| CLI `new`, `run`, `view`, `verify` | §8.1, G1 | done | `cli.test.ts`, `example.test.ts` | Runs on the server package's writer since G2. `check`, `export` and `import` come in later steps. |
| Demo: 24x24 seamless stone floor from a script | G1 | done | `example.test.ts` (verify, plus a rebuild from the script) | `examples/mossy-ruins.pclaw`, script `examples/scripts/stone_floor.pclaw`. |
| Server package: project I/O moved from the CLI; the single writer (one queue, in-memory states) | §8.1, G2 | done | `mcp.test.ts`, `cli.test.ts` | Every batch from MCP, the CLI or (G3) a page goes through `Writer.run`. |
| Single writer across processes: `.pixelclaw.lock` | §8.1 | done | `mcp.test.ts` (CLI refuses; lock released on exit) | Pid and URL without the token. CLI `new`/`run` refuse while a live server holds it. |
| `pixelclaw serve --project <dir> [--port] [--no-mcp]` | §8.2, G2 | done | `mcp.test.ts`, `pack.test.ts` | Creates the project if missing. Stops when stdin closes or on a signal. |
| MCP over stdio (official TS SDK v2), server instructions | §8.2 | done | `mcp.test.ts` | Serves both protocol eras (2025 `initialize` checked by hand). Instructions carry a command cheat sheet and ask the agent to share the watch link. |
| MCP `project` | §8.2 | partial | `mcp.test.ts` | Palettes, assets, watch link; open/create another folder; add palette files. Profiles come with G9. |
| MCP `run` | §8.2 | partial | `mcp.test.ts` | One undo group; applied lines, pixels changed, warnings, optional view; errors with line:col apply nothing. The check summary joins in G5. |
| MCP `view` | §8.2, §2 | partial | `mcp.test.ts`, `edits.test.ts` | `render`, `grid` (with region), `tile3x3`, `diff` (G3, with `since`); image inline plus saved path, text for the grid and the diff's list. Other modes come with their steps (`game`/`recolour` G5, `anim` G6, `map` G7, `density` G9). |
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
| Keyboard shortcuts in tooltips | §8.3, G3 | done | `edit.spec.ts` (B, E, L, U, Shift+U, F, G, I, Alt+click, M, V, arrows, Delete, Esc, N, Ctrl+Z, Ctrl+Shift+Z) | Aseprite-style. `[ ]` frames come with G6. |
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
| Frames scaffolding: add (copy or empty), choose, remove, move | §3.2, §4.4, G4 | done | goldens `g4/frames.f1..f3`, `g4.test.ts`, `toolkit.spec.ts` | Numbered from 1. Views take `frame` (default: the agent's). Durations, tags, linked cels, onion skin: G6. |
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
