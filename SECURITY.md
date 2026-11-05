# Security

PixelClaw runs on your machine, reads and writes a project folder, serves a local web page, and
can, if you turn them on, spend money through two paid services (your Anthropic account through
Claude Code, and OpenAI's image API). This page says what protects you and how to report a
problem.

## Reporting a vulnerability

Please report security problems privately through GitHub's private vulnerability reporting: the
**Security** tab of [github.com/retrodigio/pixelclaw](https://github.com/retrodigio/pixelclaw),
then **Report a vulnerability**. Do not open a public issue. Include what you found, how to
reproduce it and what an attacker could do with it. You should get an answer within a week.
Fixes go into the latest release; there are no long-term support branches.

## The local server

- `pixelclaw serve` listens on `127.0.0.1` only, and answers only to the host names `127.0.0.1`,
  `localhost` and `[::1]`, so a web page cannot reach it through DNS rebinding.
- A random **token** is made at each start. The watch page, its API and its WebSocket need it; the
  link with the token is printed to stderr and returned by the MCP `project` tool. Treat the link
  as a password while the server runs: anyone with it can edit the project.
- The lock file `<project>/.pixelclaw.lock` records the server's pid and URL without the token.

## The worker: Claude Code without a session

The worker lets people's requests from the dashboard be worked by a headless Claude Code session.

- It is **off by default**. A project turns it on in `project.json` (`"worker": { "enabled":
  true, "cap": 5 }`). Every session spends money on **your Anthropic account** (your Claude Code
  login).
- **The cap** is a total in US dollars over every run on the project, kept in a ledger
  (`worker-spend.jsonl`); a spent cap refuses to start. A watchdog stops a stalled session.
- **The fence**: the session has no built-in tools at all (no shell, no file reads or writes, no
  web, no subagents), only PixelClaw's MCP tools over a connection with its own token. Through
  that connection it cannot open another project, read or write files outside the project folder
  (symlinks are resolved before the check), or call the image provider. It loads only your
  user-level Claude Code settings, never a project's `.claude/` settings, hooks or `CLAUDE.md`,
  so a project folder you were sent cannot widen it, and `project.json` settings that would add
  tool or permission flags are refused.
- The exact flags and how each rule is tested: [docs/worker.md](docs/worker.md).

## API keys

- The optional OpenAI underlay provider reads its key from the `OPENAI_API_KEY` environment
  variable of the PixelClaw process. **No part of the key is ever written**: not to the project,
  the tape, the cost log, a result or an error message. Provider errors that echo the key, whole
  or masked, are scrubbed. Each call is priced against a cost cap first and logged.
- PixelClaw never handles your Anthropic credentials; the worker runs your installed `claude`,
  which uses its own login.

## Opening projects from others

A project folder is data: tapes of commands, palettes, JSON and PNGs. Replaying a tape cannot run
code. Export profiles and schemes are JSON. Still, review a project you were sent before turning
its worker on, since the worker spends your money on the requests in it.
