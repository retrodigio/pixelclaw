# Progress

Status of plan features touched so far. Steps refer to the build plan (§10).

| Feature | Plan | Status | Validated by | Note |
|---|---|---|---|---|
| Repo skeleton: pnpm workspaces, TypeScript strict, vitest | §8.1, G1 | done | `pnpm test`, `pnpm typecheck` | Node ≥ 22.18 runs the `.ts` sources directly (type stripping). vitest 4 + vite 7 keep every installed dependency permissively licensed. |
| Dependency licences | CLAUDE.md | done | `test/licences.test.ts` | Every installed package is MIT, ISC, Apache-2.0 or BSD (checked on each test run). |
| Indexed document: one layer, one frame, cell grid, wrap flag | §3.1, §3.2 | done | `commands.test.ts` (wrap/clip), `golden.test.ts` (`wrap`, `sheet`) | Stored as layers × frames of cels, ready for G4/G6. `TRANSPARENT = 0xffff`. |
| Palettes: JSON (key/name/hex, ramps) | §3.1 | done | `palette.test.ts` | Keys are one character; `.`, space and `|` are reserved. Names are identifiers; `none` is reserved. |
| Palette import: `.hex`, `.gpl`, Lospec JSON | §3.1 | done | `palette.test.ts`, `cli.test.ts` | Keys are assigned automatically (0-9, a-z, A-Z, punctuation, then Latin-1). |
| Role palettes, palette locking | §3.1 | deferred | — | Roles in G5, locking in G4. Every colour already has to be in the palette. |
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
| Checkpoints | §7.1 | stub | `cli.test.ts` (verify reports none) | The `checkpoints/` folder is created and `serializeDoc` is the planned body. Nothing is written yet; `verify` flags any `.gwc` files it cannot check. |
| CLI `new`, `run`, `view`, `verify` | §8.1, G1 | done | `cli.test.ts`, `example.test.ts` | Runs on the server package's writer since G2. `check`, `export` and `import` come in later steps. |
| Demo: 24x24 seamless stone floor from a script | G1 | done | `example.test.ts` (verify, plus a rebuild from the script) | `examples/mossy-ruins.pclaw`, script `examples/scripts/stone_floor.pclaw`. |
| Server package: project I/O moved from the CLI; the single writer (one queue, in-memory states) | §8.1, G2 | done | `mcp.test.ts`, `cli.test.ts` | Every batch from MCP, the CLI or (G3) a page goes through `Writer.run`. |
| Single writer across processes: `.pixelclaw.lock` | §8.1 | done | `mcp.test.ts` (CLI refuses; lock released on exit) | Pid and URL without the token. CLI `new`/`run` refuse while a live server holds it. |
| `pixelclaw serve --project <dir> [--port] [--no-mcp]` | §8.2, G2 | done | `mcp.test.ts`, `pack.test.ts` | Creates the project if missing. Stops when stdin closes or on a signal. |
| MCP over stdio (official TS SDK v2), server instructions | §8.2 | done | `mcp.test.ts` | Serves both protocol eras (2025 `initialize` checked by hand). Instructions carry a command cheat sheet and ask the agent to share the watch link. |
| MCP `project` | §8.2 | partial | `mcp.test.ts` | Palettes, assets, watch link; open/create another folder; add palette files. Profiles come with G9. |
| MCP `run` | §8.2 | partial | `mcp.test.ts` | One undo group; applied lines, pixels changed, warnings, optional view; errors with line:col apply nothing. The check summary joins in G5. |
| MCP `view` | §8.2, §2 | partial | `mcp.test.ts` | `render`, `grid` (with region), `tile3x3`; image inline plus saved path, text for the grid. Other modes come with their steps (`diff` G3, `game`/`recolour` G5, `anim` G6, `map` G7, `density` G9). |
| MCP `history` | §8.2 | done | `mcp.test.ts` | Range by number or last N; undone groups marked. |
| HTTP + WebSocket on localhost, token | §1.2, §8.1 | done | `mcp.test.ts`, `watch.spec.ts` | 127.0.0.1 only, host-name check, random token for the page, `/api/state` and `/ws`. Port 7417 or the next free one. Small RFC 6455 server side, no dependency. |
| UI shell: canvas, zoom 1–64x, pixel and cell grids | §8.3, G2 | done | `watch.spec.ts` (canvas equals the core render at two zooms, with and without the grid) | Draws core's `renderFlat`; checkerboard under transparent pixels. Wrap ghosts and onion skin come later. |
| Tape panel streaming live with author colouring | §8.3, G2 | done | `watch.spec.ts` | Grouped by undo group; undone groups struck through. |
| Live playback, speed, pause, jump to live | §8.3, G2 | done | `watch.spec.ts` (every command shown in turn; pause holds; jump shows all) | Pages replay lines with core's new `TapeCursor`. Follows the asset being drawn. |
| Time travel (read-only) | §8.3, G2 | done | `watch.spec.ts` | Click a line to see the document after it. "Branch here" (fork) is G3. |
| Claude's eye | §8.3, G2 | done | `watch.spec.ts` | The last image returned to the agent (`view`, or `run` with a view). |
| Asset list (and palette swatches) | §8.3 | done | `watch.spec.ts` | Busy dot on assets with commands to play. |
| Two browsers receive the same stream | §1.2, G2 | done | `mcp.test.ts` (two sockets), `watch.spec.ts` (two browsers) | |
| Build step: bundled `pixelclaw` package; `npx pixelclaw serve` from a tarball | §8.1, G2 | done | `pack.test.ts` | esbuild bundle + built UI in `cli/dist`; no runtime dependencies; third-party licences included. Still `private` (plan §12). |
| Playwright | G2 | done | `e2e/watch.spec.ts` (6 tests) | `pnpm test` builds, then runs vitest and Playwright. Needs `npx playwright install chromium` once. |
| Demo: the agent draws a tile through MCP while a person watches | G2 | done | `examples/demo-g2.md`, `examples/demo-g2-agent.ts` (run by hand; its tape verifies, same state hash as the G1 tile) | Screenshots in `docs/screenshots/`. |
| Docs: "Use it from Claude Code", docs/mcp.md | G2 | done | — | |
| Editing in the UI, notes, `changes`, fork | §1.3, G3 | deferred | — | The writer already takes an author per batch; pages only receive in G2. |
