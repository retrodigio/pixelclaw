# PixelClaw: notes for agents working on the code

PixelClaw is a pixel art editor built for an AI agent to drive by command (an MCP server and a
CLI), with a live browser view where people watch and edit. Indexed colour only. TypeScript, pnpm
workspaces: `core`, `server`, `ui`, `cli`, plus `skill/` (the Claude Code skill). Start with
[README.md](README.md), [docs/design.md](docs/design.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Layout

- `core/`: the document model, command language, replay, checks, renders, schemes, families,
  maps, profiles, PNG/GIF. Pure TypeScript, no DOM or Node APIs. Data: `core/schemes/*.json`
  (autotile schemes), `core/profiles/*.json` (export profiles).
- `server/`: the project folder, the single writer, views, MCP (stdio and HTTP), the HTTP +
  WebSocket server for the watch view, the worker.
- `ui/`: the watch view, editor and dashboard (Vite + React + canvas 2D); it replays tapes with
  `core`.
- `cli/`: the `pixelclaw` command; `pnpm build` bundles everything into `cli/dist`.
- `docs/`: reference docs. `examples/`: example projects, walkthroughs and the stand-in agents
  that drive them. `scripts/`: the build, scheme generation and screenshot scripts.

## Conventions

- **Core is deterministic.** Integer maths, the seeded PCG generator (`core/src/pcg.ts`), no
  `Date`, `Math.random`, DOM or Node APIs in `core`. Replaying a tape must be byte-identical on
  every machine; golden tests and `pixelclaw verify` depend on it.
- **Every edit is a command.** New features are commands on the tape (with a normal form, so the
  tape replays exactly), not side channels. A person's action in the UI writes a command too.
- **Game-specific knowledge is data.** Schemes and export profiles are JSON; ship only generic
  ones. Examples, fixtures and docs use invented content (an original demo theme such as "mossy
  ruins"), never names, art or palettes from an existing game.
- **Few, permissive dependencies** (MIT, BSD, Apache-2.0, ISC). `test/licences.test.ts` checks
  every installed package.
- Comments explain the code; docs describe the tool. Name tests, examples and screenshots by the
  feature they cover.

## Running things

Node 22.18 or later (TypeScript runs directly through Node's type stripping) and pnpm 10.

```sh
pnpm install
pnpm build                 # the UI (vite) and the bundled CLI in cli/dist
pnpm typecheck             # tsc over core, server, cli, ui and e2e
pnpm test:unit             # vitest
pnpm test:e2e              # Playwright (needs pnpm build, and `npx playwright install chromium` once)
pnpm test                  # build + vitest + Playwright: must pass before every commit
node cli/bin/pixelclaw.js --help
```

- Golden images: `UPDATE_GOLDEN=1 pnpm test:unit` rewrites them; look at every changed PNG before
  committing. A golden change means the pixels changed, so it needs a reason.
- The stand-in agents (`examples/*-agent.ts`) drive `pixelclaw serve` over MCP the way Claude
  Code would; they write into `out/` (ignored).
- Never open GUI windows or leave servers running when you finish; Playwright specs and tests
  start their own servers on temporary projects and stop them.
