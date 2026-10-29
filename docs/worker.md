# The worker: Claude Code without a session

People ask for work in the dashboard (plan §21; [pipeline.md](pipeline.md#requests-from-the-dashboard)),
but an MCP server cannot wake a Claude session. When nobody has Claude Code open on the project,
the **worker** works the queue: a headless Claude Code session (`claude -p`) connected to the
project's PixelClaw server and given the PixelClaw skill, which takes requests with the `work`
tool until there are none left or its budget cap is reached.

It is **off by default**, because it spends money on your Anthropic account.

## Turning it on

In the project's `project.json`:

```json
"worker": {
  "enabled": true,
  "cap": 5,
  "maxSessions": 10,
  "command": ["claude"],
  "args": ["--model", "sonnet"]
}
```

| setting | default | |
|---|---|---|
| `enabled` | `false` | the **▶ Start Claude** button shows, and `pixelclaw work` runs, only when this is `true` |
| `cap` | `5` | US dollars one run may spend, over all its sessions |
| `maxSessions` | `10` | sessions one run may start |
| `command` | `["claude"]` | the Claude Code CLI (a path, or a wrapper) |
| `args` | `[]` | more arguments for it, e.g. a model |

The file is read fresh each time, so no restart is needed (reload the dashboard to see the button).
You need Claude Code installed and logged in (`claude` on the PATH, or its path in `command`).

## Running it

- **From the dashboard**: **▶ Start Claude** (top right; only when enabled). The panel shows
  what it has spent of the cap and which session it is on; **Log** shows its log as it is
  written; **■ Stop Claude** ends the session in progress.
- **From a shell**: `pixelclaw work <project> [--port N]` starts its own server (the watch view's
  link is printed, so you can watch) and runs until the queue is empty or the cap is reached. If a
  server already holds the project, use that server's dashboard button instead.

Only one worker runs per project: a second start is refused (the server keeps one, and
`.pixelclaw-worker.lock` beside the project's lock holds the pid of the process running it).

## What it runs

Each session is one Claude Code process:

```sh
claude -p "<the worker prompt>" \
  --output-format stream-json --verbose \
  --mcp-config <a private temporary file> --strict-mcp-config \
  --allowedTools mcp__pixelclaw \
  --max-budget-usd <what is left of the cap> \
  --append-system-prompt "<skill/SKILL.md>" \
  <args>
```

- The MCP config points at the running server's HTTP endpoint with its token
  (`{"mcpServers":{"pixelclaw":{"type":"http","url":"http://127.0.0.1:<port>/mcp","headers":{"Authorization":"Bearer <token>"}}}}`);
  it is written to a temporary file readable only by you and removed when the session ends.
  `--strict-mcp-config` keeps your other MCP servers out of it.
- `--allowedTools mcp__pixelclaw` lets it use the PixelClaw tools without asking; nothing else is
  allowed (no shell, no file edits).
- The prompt tells it to loop: `work` (claim the next request), do it, finish it with `done` or
  `blocked` (a question for you; nobody reads its chat), and `work` again until none are left.
- Its batches are written by `claude`, like any agent's, so the cards show **Claude is working on
  this** and `changes` and the tape read as usual.

## The cap

The cap is checked twice. Each session gets `--max-budget-usd` set to what is left of the run's
cap, so Claude Code itself stops a session that would go over. After each session, the worker adds
the cost the session reports (`total_cost_usd` in its final `result` line) and starts no new
session once the cap is reached. A session that ends without reporting its cost (it crashed, or
was stopped) counts as having spent the rest of the cap, and the run stops. A run also stops when
the queue is empty, when a session leaves the queue as it was (no progress), when it reaches
`maxSessions`, or when you stop it.

## The log

`logs/worker.log` in the project (not committed): when the run started and who started it, each
session's budget, Claude's text and tool calls (`→ work {}`, `→ run {"asset":"urn_blue",…}`),
tool errors, each session's cost and the running total, and why the run stopped. The dashboard's
**Log** shows the last lines and follows new ones.

## Tests

The tests never call a model: a fake `claude` (`server/test/fake-claude.ts`) takes the same
arguments, connects to the MCP endpoint named in `--mcp-config`, works the queue with the `work`
tool and prints stream-json lines ending in a made-up cost. `server/test/g12.test.ts` runs the
worker with it disabled (refused, from the button and the CLI), enabled (the queue worked through
MCP until empty), against the cap (the third session gets $0.20 of $1.00 and the run stops at
the cap), and twice at once (refused while one runs; stop ends it); `e2e/g12.spec.ts` presses
the button.
