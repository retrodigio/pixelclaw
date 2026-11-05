# Contributing to PixelClaw

Thanks for your interest. Bug reports, ideas and pull requests are welcome.

## Before you start

- Read [docs/design.md](docs/design.md) for how the parts fit together, and
  [CLAUDE.md](CLAUDE.md) for the conventions (it is written for coding agents but applies to
  everyone).
- For anything larger than a small fix, open an issue first so we can agree on the approach.
- By contributing you agree that your work is released under the [MIT licence](LICENSE), and to
  follow the [code of conduct](CODE_OF_CONDUCT.md).

## Setting up

You need Node.js 22.18 or later and pnpm 10.

```sh
pnpm install
npx playwright install chromium     # once, for the browser tests
pnpm test                           # build, then unit tests (vitest) and browser tests (Playwright)
pnpm typecheck
```

`node cli/bin/pixelclaw.js <command>` runs the CLI from source (Node strips the TypeScript types),
so you only need `pnpm build` for the watch view and the bundled package.

## Ground rules

- **Determinism.** `core` uses integer maths and the seeded PCG generator; no `Date`,
  `Math.random`, DOM or Node APIs. A tape must replay to the same bytes everywhere.
- **Every edit is a command.** New drawing features are commands with a normal form, written to
  the tape, documented in [docs/commands.md](docs/commands.md).
- **Goldens do not change by accident.** If a golden image changes (`UPDATE_GOLDEN=1`), explain
  why in the pull request and look at the new image.
- **Data, not code, for game specifics.** Autotile schemes and export profiles are JSON. Only
  generic ones ship with the tool.
- **Original content only.** Examples, fixtures and docs use invented themes, names, palettes and
  art. Do not add names, art or text from existing games.
- **Few, permissive dependencies.** New dependencies need a good reason and an MIT, BSD, ISC or
  Apache-2.0 licence (`test/licences.test.ts` checks this).
- **Tests.** Add or update tests for what you change: vitest in `core/test`, `server/test`,
  `cli/test`; Playwright in `e2e/` for the browser. Name test files by the feature they cover.

## Pull requests

1. Fork, branch from `main`, and keep the change focused.
2. Run `pnpm typecheck` and `pnpm test`; both must pass.
3. Update the docs (`docs/`, the README or a walkthrough) when behaviour changes, and add a line
   to [CHANGELOG.md](CHANGELOG.md) under *Unreleased*.
4. Fill in the pull request template.

## Reporting security problems

Please do not open a public issue; see [SECURITY.md](SECURITY.md).
