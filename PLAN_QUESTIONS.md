# Plan questions

Points where the plan was unclear or silent. Each has the reading that was followed.

## G1

1. **`.pclaw` names both scripts and projects.** §1.1 runs `pixelclaw run file.pclaw` (a script)
   and §7.1 names the project folder `<name>.pclaw/`.
   *Reading:* both. A project is a folder (by convention named `*.pclaw`), a script is a file, and
   the CLI takes the project folder first: `pixelclaw run <project> <script>`.

2. **Where view images go.** §2 says images are "saved as PNG files Claude can Read later", but
   §7.1 has no folder for them.
   *Reading:* `<project>/views/<asset>.<mode>.png|txt`, overwritten on each view (`--out`
   changes it). The demo's views are checked in. Other projects may want `views/` in
   `.gitignore`.

3. **How colours are written on the tape.** §3.3 says lines are normalised but doesn't say how
   colours are written.
   *Reading:* by entry name (`c=stone3`), whatever form was typed (key, hex or name). Names read
   well as the tape streams past. Renaming or reordering palette entries would change what an old
   tape means; `verify` catches that through the state hash. Palette edits (G3) should probably
   become tape commands or palette snapshots. G3 decides.

4. **What a "random" seed is.** §3.3 says "a random seed is chosen and written into the line", but
   core has no `Math.random`.
   *Reading:* the seed comes from the PCG generator, seeded by the command's tape position and the
   document name. It is still written into the line, so replay never depends on how it was chosen,
   and running the same script twice gives the same art. No G1 command uses a seed; the path is
   tested with a test-only generator.

5. **What "pixel-perfect line" means.** The plan says pixel-perfect and "no doubled L-corners".
   *Reading:* the line is 8-connected (no L-corners), and its pixels are shared out evenly among
   the rows it crosses (`0,0 11,3` is 3-3-3-3, where nearest-pixel Bresenham gives 2-4-4-2).
   Uneven counts are spread symmetrically. For polylines, the doubled L-corner at a joint is
   removed (as Aseprite's pixel-perfect stroke does), except at a right angle between straight
   horizontal and vertical segments, which is meant. `pp=off` turns the joint filter off.

6. **Undo semantics.** §1.3 has `undo group=g17` but doesn't say what undoing an older group does.
   *Reading:* selective undo. Undoing any group still in effect removes its commands from the
   replay and keeps later groups. Undoing an undo group redoes it. Plain `undo` picks the latest
   drawing group still in effect and writes that group into the line. The group that holds `new`
   cannot be undone.

7. **Group names.** §1.3 shows `g17` for the agent and `h88` for a human.
   *Reading:* G1 numbers every batch `g<N>` per asset. Group ids are treated as opaque strings,
   so G3 can add prefixes for human strokes.

8. **Timestamps.** §7.1 tape lines have `"at"`, but core has no clock.
   *Reading:* the CLI stamps `at` (UTC, whole seconds). Replay ignores `at` and `by`.

9. **Checkpoints in G1.** §7.1 has checkpoints every 200 commands, verified by replay; G1 asks for
   them stubbed.
   *Reading:* `checkpoints/` is created and `serializeDoc` (a header plus raw u16 cels) is the
   planned body. Nothing is written yet; `verify` compares against a SHA-256 of that serialisation
   stored in `asset.json`, and reports any `.gwc` file as not yet checkable.

10. **Transparent in the grid view vs `paint`.** The grid shows transparent pixels as `.`, as in
    the plan's §2 example. In a `paint` block `.` means "leave as is" and a space means "clear"
    (§3.3).
    *Reading:* both as written. Pasting a grid into a `paint` block therefore leaves transparent
    pixels alone rather than clearing them.

11. **Paint block indentation.** A space in a block means "clear", so leading indentation is
    ambiguous.
    *Reading:* the rows' common indentation is removed. Rows wrapped in `|` margins are taken
    exactly, and the normal form uses margins when a row starts or ends with a space.

12. **Dependency licences vs vitest.** vitest 5 needs vite 8, which depends on `lightningcss`
    (MPL-2.0). CLAUDE.md asks for permissive licences only.
    *Reading:* pin vitest 4 and vite 7, where lightningcss is an optional peer, and set
    `autoInstallPeers: false` so it is not installed. Every installed package is MIT, ISC,
    Apache-2.0 or BSD. G2's UI (Vite) should stay on vite 7 or check this again.
    *G2:* the UI stays on vite 7 and uses no React plugin (`@vitejs/plugin-react` 6 needs vite 8;
    esbuild compiles the JSX). A test now checks every installed package's licence.

13. **Running TypeScript.** The plan doesn't say how the CLI is built.
    *Reading:* no build step for now. Node ≥ 22.18 runs the `.ts` sources directly, and imports use
    `.ts` extensions (`erasableSyntaxOnly`). Publishing to npm (`npx pixelclaw`) will need a build
    step, because Node does not strip types inside `node_modules`.

## G2

14. **Which MCP SDK.** The plan says "the official TypeScript MCP SDK". Its current stable line (v2)
    is split into `@modelcontextprotocol/server` and `/client`; the single `@modelcontextprotocol/sdk`
    package is v1.
    *Reading:* v2 (`@modelcontextprotocol/server`, Apache-2.0, depends only on zod). Its
    `serveStdio` answers both the 2025 `initialize` opening (what Claude Code sends today) and the
    newer one.

15. **Where the watch link is printed.** §8.2 says starting the MCP server "prints its URL", but
    stdout carries MCP, and Claude Code doesn't show a server's stderr to the person.
    *Reading:* the URL (with its token) goes to stderr, and the `project` tool returns it too. The
    server's MCP instructions ask the agent to call `project` first and give the person the link
    (the skill will say the same, G10).

16. **`localhost` or `127.0.0.1`.** §1.2 shows `http://localhost:7417/?token=…`.
    *Reading:* the server listens on 127.0.0.1 only and prints `http://127.0.0.1:7417/…`, because
    `localhost` can resolve to `::1` first. It answers to the host names `127.0.0.1`, `localhost`
    and `[::1]` and nothing else (no DNS rebinding).

17. **What the token protects.** "Required by the UI".
    *Reading:* the page itself, `/api/state` and the WebSocket need the token. The page's built
    scripts and styles (`/assets/…`) are public, since they hold no project data. A page opened
    without the token explains where the link comes from.

18. **A port that is taken.** The default is 7417; two sessions on two projects would collide.
    *Reading:* try the given port, then the next 19, and print the one used. `--port 0` takes any
    free port (the tests use it).

19. **The single writer across processes.** §8.1 makes the server the single writer, but the CLI
    can still write the same files.
    *Reading:* a running server writes `<project>/.pixelclaw.lock` (pid and URL, not the token).
    `pixelclaw new` and `run` refuse to write a project a live server holds; `view` and `verify`
    still work. A lock left by a dead process is ignored.

20. **`serve` on a folder that is not a project.** §8.2's line passes `--project` for a project that
    may not exist yet.
    *Reading:* `serve` creates an empty project (no palettes) and logs it. The `project` tool adds
    palette files, and can open or create another folder (`path`, `create`).

21. **What `run` returns before checks exist.** §8.2 lists "warnings, a check summary".
    *Reading:* G2 returns warnings (so far only "the batch changed no pixels"); the check summary
    joins with G5.

22. **Which views G2's `view` has.** §8.2 lists nine modes; G2 builds the tool.
    *Reading:* the three that exist (`render`, `grid`, `tile3x3`). Each later mode arrives with its
    step (`diff` with `changes` in G3).

23. **What "Claude's eye" shows.** "The last image Claude was shown."
    *Reading:* the last image returned through MCP, from `view` or `run` with `view`. Text grid
    views don't replace it; CLI views are not shown to the agent and don't count.

24. **How the page plays a batch.** "Plays it command by command."
    *Reading:* the server streams tape lines, not pixels. The page replays each line with core (a
    new step-by-step `TapeCursor`), so the browser draws exactly what core computes. The first
    command of a batch shows at once and the rest follow at the chosen speed (default 8 a second).
    On connect, history is shown at once rather than replayed. With "follow" on, the view moves to
    the asset the agent is drawing once the current one has caught up.

25. **Time travel while commands arrive.** Not covered.
    *Reading:* the canvas stays at the chosen line; new lines still arrive on the tape (dimmed past
    the chosen point). "Back to live" or "Jump to live" returns. Time travel is per asset.

26. **Authors.** §1.3 shows `claude` and `human:chris`.
    *Reading:* every MCP batch is written `by: claude`. Other agents (or a configurable name) can
    come later; the writer already takes the author per batch.

27. **The npm package.** §8.1 says "easy to publish (npm, `npx pixelclaw`)"; §12 keeps the repo
    private until A1.
    *Reading:* the `cli` package is named `pixelclaw` and is what `pnpm pack` ships (bundled, no
    runtime dependencies, third-party licences included), but it stays `"private": true`. The
    README gives the `npx pixelclaw` line for later and working lines for a clone or a tarball.
