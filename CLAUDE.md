# pixelclaw

PixelClaw: a pixel art editor built for an AI agent to drive by command (an MCP server and a CLI),
with a live browser view where people watch and edit. Indexed colour only. TypeScript, pnpm
workspaces (`core`, `server`, `ui`, `cli`, `skill/`).

## The plan

The design plan is `PIXELTOOL.md`; its local path is in `CLAUDE.local.md` (not committed). It is read-only; never edit it. Section 12 holds
the owner's decisions and overrides anything earlier. Build plan steps are §10 (G1..G11). If the
plan is unclear, write the question into `PLAN_QUESTIONS.md` with your reading, follow the reading,
and say so in your report.

## Keep the repo publishable

This repo will be made public with its full history, so every commit must be safe to publish:
- No names, art, palettes or text from any existing game, and none of the plan's project-specific
  names (the game the plan was written for, its test packs, local folders under `~/projects/`).
  Examples, fixtures and docs use invented content (an original demo theme, e.g. "mossy ruins").
- Game-specific knowledge is data (autotile schemes, export profiles); ship only generic ones.
- Do not read anything outside this repo except the plan file above. Dependencies must have
  permissive licences (MIT, BSD, Apache-2.0, ISC) and be few.

## Working conventions

- Core is deterministic: integer maths, a seeded PCG generator, no `Date`, `Math.random` or DOM/Node
  APIs in `core`. Replay of a tape is byte-identical.
- Tests: vitest (and Playwright from G2). `pnpm test` must pass before every commit.
- Track status in `PROGRESS.md`: one row per plan feature you touch (done, partial, deferred), the
  test that validates it, and a short note.
- Commit at the end of each coherent piece of work, with a clear message ending in the attribution
  lines the task gives you.
- Never open GUI windows or leave servers running when you finish.
