# Progress

Status of plan features touched so far. Steps refer to the build plan (§10).

| Feature | Plan | Status | Validated by | Note |
|---|---|---|---|---|
| Repo skeleton: pnpm workspaces, TypeScript strict, vitest | §8.1, G1 | done | `pnpm test`, `pnpm typecheck` | Node ≥ 22.18 runs the `.ts` sources directly (type stripping), with no build step. vitest 4 + vite 7 keep every installed dependency permissively licensed. |
| `server`, `ui` packages | §8.1 | stub | — | Built in G2. |
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
| CLI `new`, `run`, `view`, `verify` | §8.1, G1 | done | `cli.test.ts`, `example.test.ts` | `check`, `export`, `import` and `serve` come in later steps. |
| Demo: 24x24 seamless stone floor from a script | G1 | done | `example.test.ts` (verify, plus a rebuild from the script) | `examples/mossy-ruins.pclaw`, script `examples/scripts/stone_floor.pclaw`. |
