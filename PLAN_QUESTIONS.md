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

## G3

28. **Palette edits and replay.** G1 item 3 left it to G3: should palette edits change the project's
    palette file, or be tape commands?
    *Reading:* tape commands that edit the document's own copy of its palette (`palette set <entry>
    hex=#…`, `palette add [<name>] hex=#… [key=…]`). Changing the project file would change how
    every other tape replays. Entries are only changed or added, never removed or reordered, since
    pixels store entry numbers. Saving a document's palette back to the project can come with
    palette locking (G4). `#` starts a comment after a space, so colours are written `hex=#…`.

29. **The `stroke` line.** §1.3 shows `stroke pencil c=ink 12,4 12,5 13,6`.
    *Reading:* that order (options before the points, so the colour stays in view on long strokes),
    with the default filled in: `stroke pencil c=ink pp=on 12,4 12,5 13,6`. The points are the
    pixels the pointer passed over; core joins them and drops doubled L-corners (Aseprite's
    pixel-perfect pencil; no right angle is kept, unlike `line`). The eraser is `stroke eraser
    x,y …`.

30. **What "rectangle select and move" logs.** A selection changes no pixels, and §3.2 says a
    selection clips every drawing command until `deselect`.
    *Reading:* in core, `select rect|all|none`, `deselect` and `shift dx,dy` exist, and the selection
    clips drawing and fills. In the page the selection stays local until used: a move writes one
    group `select rect …; shift dx,dy; deselect`, Delete writes `rect … c=none fill`, and drawing
    inside a selection is wrapped in `select rect …` / `deselect`. Moved pixels leave transparent
    pixels behind. The picker writes nothing either. "Every UI action replays" is tested for every
    action that changes the document. Open point for G4: a selection the agent leaves active
    clips people's strokes too (and a page's clipped batch ends with `deselect`); selections may
    need to be per author.

31. **`shift`.** §3.3 has `shift 0,-1` after a selection, `shift 5,0 wrap` and `shift sel 0,-1`.
    *Reading:* G3 has `shift dx,dy`: the selection if there is one, else the whole canvas; past an
    edge it wraps on `wrap=on` documents and clips otherwise. The `wrap` flag and `sel` word come
    with G4's transforms.

32. **Where notes live.** "Stored in the project, visible on the canvas and returned to the agent."
    *Reading:* a note is a tape command (`note x,y [WxH] "text"`, as in §1.3), so it has an author,
    a group and undo. The normal form adds an id (`id=n1`, never reused). Open notes are document
    state: in the state hash, in `asset.json` (`notes`), on the canvas and in `changes`. The plan
    has no way to close a note; `note done <id>` is added so the agent (or a person) can mark one
    dealt with.

33. **Where `changes` starts.** "Since Claude's last call", but there is no last call the first time,
    and the agent's own commands are mixed in.
    *Reading:* a read position per agent and asset, kept in `<project>/reads.json` (so a restart,
    or a person editing with `--no-mcp`, loses nothing). With no position the agent has read
    nothing, except that its own commands at the start count as read (it wrote them); on a branch
    reading starts at the fork point. Each call lists only other authors' lines and moves the
    position to the end. The diff runs from the position to now, so it includes any of the agent's
    own commands in between; the result says how many. `since` overrides the position. Every MCP
    call is the agent `claude` (G2 item 26).

34. **Undo and redo per author.** §1.3 has only `undo group=…`; G3 asks for undo and redo per author
    "and the agent's undo stays as it is".
    *Reading:* `undo by=<author>` takes back that author's latest drawing group still in effect, and
    a new `redo [group=|by=]` takes back an undo, latest first; both record the group they chose
    (`undo group=h3`, `redo group=h7`). Drawing something new ends that author's redo chain, as in
    any editor. The agent's plain `undo` still takes the latest group in effect, whoever wrote it.

35. **The branching tape format.** §7.2: "`fork chest chest_b` copies an asset with its tape".
    *Reading:* the branch's tape is self-contained: the source's entries up to the fork point copied
    exactly (authors and groups kept), then `fork <from> <to> at=<n>` in the forking author's
    group, then the branch's own commands. Replay rebuilds the source's state and the fork line
    renames it; it checks the name and that `at` is the line before. Nothing is written on the
    source's tape (it is not changed by being forked); `asset.json` links the branch to it. A fork
    is the first command of a batch on the new asset (from MCP `run`, or "Branch here").

36. **Who a person is.** §1.3 shows `human:chris`; there are no accounts.
    *Reading:* the page asks for a name (header, `?name=`, remembered in the browser; default
    `human:guest`). The server only checks the form `human:<name>`. Anyone with the token is
    trusted, so one person could write as another; that is fine for a local tool.

37. **How people's edits play.** G2 plays every batch command by command.
    *Reading:* a person's batch shows at once on every page (it is one action, not a script to
    watch). Follow (G2 item 24) turns off when you start editing, so the canvas does not switch to
    whatever the agent draws next while you work.

38. **The command line.** §8.3 has one at the bottom of the tape; it is not in G3's list.
    *Reading:* added, since pages send commands anyway. It runs as the page's author.

39. **The diff's "heat map".** §2 says more than about 60 changed pixels come back as a heat map
    beside before and after.
    *Reading:* with no notion of how much a pixel changed in an indexed image, the map is binary:
    the after image dimmed with the changed pixels solid magenta, as a third panel. Before and
    after always have the changed pixels outlined. The scale is the render view's.

40. **Snapshot caching vs checkpoints.** §7.1's checkpoints are files every 200 commands; G2's notes
    asked for snapshot caching for time travel.
    *Reading:* an in-memory `Timeline` in core (a snapshot every 100 commands, checked against the
    tape) serves time travel in the page and earlier states in the writer (`changes`, the diff,
    forks). Checkpoint files stay a stub until load time needs them.
