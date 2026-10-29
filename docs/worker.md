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
  "stall": 10,
  "command": ["claude"],
  "args": ["--model", "sonnet"]
}
```

| setting | default | |
|---|---|---|
| `enabled` | `false` | the **▶ Start Claude** button shows, and `pixelclaw work` runs, only when this is `true` |
| `cap` | `5` | US dollars the worker may spend **on this project in all**, over every run (the ledger below) |
| `maxSessions` | `10` | sessions one run may start |
| `stall` | `10` | minutes without a tool call before the watchdog stops a session |
| `command` | `["claude"]` | the Claude Code CLI (a path, or a wrapper); it may not carry the flags listed under "Settings cannot widen it" |
| `args` | `[]` | only `--model`, `--fallback-model` and `--effort`, each with its value |

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

## What it can reach, and what it cannot

The worker is a Claude Code session with **no built-in tools**. Exactly:

**It can**
- call the twelve PixelClaw MCP tools (`project`, `run`, `view`, `seeds`, `history`, `changes`,
  `check`, `export`, `import`, `work`, `review`, `plan`) of the server that started it, and nothing
  else: they read and write this project's folder (tapes, assets, the manifest, requests, views,
  reviews, exports, blobs);
- read what Claude Code puts in every session's context: the worker prompt, the skill and the
  command reference (below), the MCP server's instructions, and your **user-level** Claude Code
  settings and `~/.claude/CLAUDE.md` (your own files; Claude Code loads them for any session).

**It cannot**
- run a shell or any program: no `Bash`, `PowerShell`, `Monitor` or background tasks;
- read, list, search or write any file through Claude Code: no `Read`, `Write`, `Edit`,
  `NotebookEdit`, `Glob` or `Grep` (not even inside the project: the project is reached only
  through PixelClaw's tools);
- reach the web: no `WebFetch` or `WebSearch` (PixelClaw's tools make no network call for it
  either; see below);
- start subagents, skills, workflows or scheduled tasks: no `Agent`/`Task`, `Skill`, `Workflow`,
  `Cron*`, `SendMessage`;
- use another MCP server: only the one in its own config (`--strict-mcp-config`);
- load the project folder's `.claude/` settings, hooks or `CLAUDE.md`, or any parent folder's
  (`--setting-sources user`): a project you were sent cannot pre-approve tools or add hooks;
- through PixelClaw's tools: open another project (`project path=`), read or write a file outside
  the project folder (`project palettes=`, `import path=`, `export dest=` and `profile=<file>`,
  `underlay import <file>` and `layout=<file.png>`; symlinks are followed before the check), name an
  asset with a path in it, or call the image provider (`underlay generate`, which spends money on
  another account).

How each is enforced:

| flag or rule | what it does |
|---|---|
| `--tools ""` | the session has no built-in tool at all (Claude Code answers "No such tool available") |
| `--disallowedTools Bash,Read,Write,…` | every built-in denied by name too: a second lock, should a version ignore the first |
| `--allowedTools mcp__pixelclaw` | the PixelClaw tools run without asking |
| `--permission-mode dontAsk` | anything not pre-approved is refused, never asked (nobody is there to answer) |
| `--setting-sources user` | only your user settings: not the project's or its parents' `.claude/` settings and `CLAUDE.md` |
| `--strict-mcp-config` + `--mcp-config <file>` | only the PixelClaw server |
| a token of its own | each run gets a fresh MCP token (not the watch link's); the server gives that connection the fenced tools above, and refuses it once the run ends |
| `args` and `command` checked | the worker refuses to start if a setting would add or change any of these flags (below) |

`--allowedTools` alone (G12) only pre-approved PixelClaw's tools: the built-in ones stayed in the
session, and Claude Code lets read-only shell commands and reads inside the working folder run
without asking, so A2's worker ran `find`, `grep` and `python` and read another checkout.

### Settings cannot widen it

`args` may hold only `--model`, `--fallback-model` and `--effort` (with a value). `command` may be
any program, but may not pass any of: `--tools`, `--allowedTools`, `--disallowedTools`,
`--permission-mode`, `--permission-prompt-tool`, `--dangerously-skip-permissions`,
`--allow-dangerously-skip-permissions`, `--add-dir`, `--mcp-config`, `--strict-mcp-config`,
`--settings`, `--setting-sources`, `--plugin-dir`, `--plugin-url`, `--agents`, `--agent`,
`--chrome`, `--ide`, `--system-prompt` (and the append and file forms), `--resume`, `--continue`,
`--fork-session`, `--worktree`, `--file`, `--bare`, `--safe-mode`, `--restricted`,
`--remote-control`, `--cloud`, `--bg`. Start is refused with the reason. (`command` itself is
trusted: it is the program you chose. A wrapper script can do anything; so can you.)

## What it runs

Each session is one Claude Code process:

```sh
claude -p "<the worker prompt>" \
  --output-format stream-json --verbose \
  --mcp-config <a private temporary file> \
  --tools "" --disallowedTools "Bash,BashOutput,…,ReportFindings" \
  --allowedTools mcp__pixelclaw --permission-mode dontAsk \
  --setting-sources user --strict-mcp-config \
  --max-budget-usd <what is left of the cap> \
  --append-system-prompt "<skill/SKILL.md, then every command of the language>" \
  <args>
```

- The MCP config points at the running server's HTTP endpoint with the run's own token
  (`{"mcpServers":{"pixelclaw":{"type":"http","url":"http://127.0.0.1:<port>/mcp","headers":{"Authorization":"Bearer <token>"}}}}`);
  it is written to a temporary file readable only by you and removed when the session ends.
- The prompt tells it to loop: `work` (claim the next request), do it, finish it with `done` or
  `blocked` (a question for you; nobody reads its chat), and `work` again until none are left.
- The system prompt is the skill followed by **every command of the language**, one line each,
  straight from the editor's command registry (`commandReference()`), so it never guesses syntax.
- Its batches are written by `claude`, like any agent's, so the cards show **Claude is working on
  this** and `changes` and the tape read as usual.
- The log's first line for each session says what tools it was given: `tools: 12 PixelClaw,
  nothing else`.

## Done means the checks pass

`work(action="done")` is refused while the request's asset fails any check (or is not drawn yet).
The reply lists each failing check with its score, limit and detail, and says to fix them or block:

```
r1 is not done: jar fails 1 check:
  outline 0 (limit ≥ 0.85): 0 of 24 silhouette edge px are ink; 24 gaps
Fix it (check shows the pixels) and finish again, or work(action="blocked", text=<one clear question>) if you cannot.
```

`blocked` is always open. This holds for any agent using the `work` tool, not only the worker.

## The watchdog

A session that makes no tool call (no tool use or result in its stream) for `stall` minutes is
stopped and **resumed once** (`claude -p "<carry on>" --resume <its session id>`, same flags). If the
resumed session stalls too, the request it holds is marked **blocked** ("The worker stalled on this
(no tool call for N min, twice): please look at <asset>, then reply to open it again.") and the run
goes on to the next request. A stopped session reports no cost: it is charged an estimate from the
token counts it streamed, at the dearest Claude rates ($15 in, $18.75 cache writes, $1.50 cache
reads, $75 out per million tokens), so the estimate is an upper bound.

## The cap and the ledger

The cap is a **total for the project**, over every run. Each session's cost is appended to
`worker-spend.jsonl` in the project (`{"at","run","session","cost"}`, plus `"estimated": true` for an
estimate); what the worker has spent is the sum. Each session gets `--max-budget-usd` set to what
is left of the cap, so Claude Code itself stops a session that would go over; after each session
the worker records the cost the session reports (`total_cost_usd` in its final `result` line) and
starts no new session once the cap is reached. Start is refused when the cap is spent ("the worker
has spent $5.00 of its $5.00 cap on this project; raise worker.cap in project.json to go on").

A session that ends without reporting its cost (it crashed, or was stopped) is charged its estimate
and the run stops. A run also stops when the queue is empty, when a session leaves the queue as it
was (no progress), when it reaches `maxSessions`, or when you stop it.

## The log

`logs/worker.log` in the project (not committed): when the run started, who started it and what
was spent before, each session's budget and tools, Claude's text and tool calls (`→ work {}`,
`→ run {"asset":"urn_blue",…}`), tool errors, the watchdog, each session's cost and the running
total, and why the run stopped. The dashboard's **Log** shows the last lines and follows new ones.

## Tests

The tests never call a model.

- A fake `claude` (`server/test/fake-claude.ts`) takes the same arguments, records them, connects
  to the MCP endpoint named in `--mcp-config`, works the queue with the `work` tool and prints
  stream-json lines ending in a made-up cost. `server/test/g12.test.ts` runs the worker with it
  disabled, enabled, against the cap, twice at once, and blocked.
- `server/test/g15.test.ts` starts `pixelclaw work` with a `claude` on the PATH that records its
  arguments (the flags above, each once; the command reference in the system prompt); refuses
  settings that would widen it; probes the fenced MCP connection with paths outside the project;
  refuses `done` while a check fails; stalls a session (resumed and finished; stalled twice and
  blocked); and spends across three runs to the cap.
- When Claude Code is installed, the same file checks that its `--help` documents every flag the
  worker passes, and runs **the real Claude Code** with the worker's command line against a fake
  model API on localhost (a throwaway `HOME`, a dummy key, so nothing is spent and no account is
  used). The fake model asks, one call a turn, for `Bash` (inside and outside the project),
  `Read`, `Glob`, `Grep`, `Write`, `Edit`, `WebFetch`, `WebSearch`, `Agent`, `Task` and
  `NotebookEdit`, then for PixelClaw's `project` with another folder, then draws and finishes a
  request. The test checks that the model was only ever offered PixelClaw's twelve tools, that
  every built-in call came back "No such tool available", that the other project was refused, that
  nothing from outside the project (a file, a parent folder's `CLAUDE.md`) reached the model, and
  that the request was done and its cost entered in the ledger. With G12's flags the same model
  ran `cat project.json` in a shell.
