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

## G4

41. **Selections per author** (G3 item 30's open point).
    *Reading:* every author has their own editing context in the document: the layer and frame
    they draw on, their selection, their live symmetry and their brush. `layer`, `frame`, `select`,
    `mirror` and `brush` change only the author's own; drawing uses the author's. An author with no
    context draws on a *home* layer and frame (at first layer 1 `main`, frame 1), which move with
    their layer and frame when others are inserted, moved or removed, so adding a reference layer
    below does not move anyone onto it. Replay uses each line's `by` for this (before G4 it ignored
    `by` except when `undo by=` was first written).

42. **Layer order, and what "reference" means for views.** §3.2: "composited top-first";
    reference layers are "never exported; used for underlays and guides".
    *Reading:* layers are listed bottom to top; the flat art is the topmost opaque pixel of the
    visible non-reference layers. Views and the watch view show visible reference layers faded
    under the art (the agent traces over them, §3.4); the grid view, `preview.png` and the state
    show only art. A locked layer refuses drawing commands (an error, nothing applied); hidden ones
    may still be drawn on.

43. **Frames scaffolding.** §3.3 has `frame add 2 copy=1 ; frame 2`.
    *Reading:* frames count from 1 in the language. `frame add [<n>] [copy=<m>|empty]` defaults to
    the end and to a copy of the author's frame; `frame <n>` chooses the author's frame. Views take
    a frame (MCP `frame`, default the agent's; CLI `--frame`); `preview.png` is frame 1. Durations,
    tags, linked cels and onion skin are G6.

44. **What transforms act on.** `flip h sel ; rotate 90 ; shift 5,0 wrap`.
    *Reading:* the author's selection, or with none their whole layer (not every layer). The word
    `sel` insists on a selection. `shift … wrap` wraps within the selection's box, or the canvas,
    on any document (on wrap documents a plain shift already wraps at the canvas edge). `rotate`
    is clockwise about the middle of the box, rounded up and left.

45. **`mirror … live` and a mirror without `live`.**
    *Reading:* `live` turns on symmetry for the author's later commands that place shapes (px,
    lines, curves, shapes, strokes, paint, stamps; fill starts again at the mirrored point), not
    generators or helpers, until `mirror off`. Without `live`, `mirror x=… from=<side>` copies one
    side over the other once. Axes are whole or half pixel positions; `mirror live` alone means the
    vertical middle (written into the line).

46. **What palette locking adds**, since every colour already had to be in the palette (G1).
    *Reading:* `palette lock` refuses `palette set`, `palette add` and `ramp` until `palette
    unlock`; the "not in palette" refusal is as before. Quantising imports to a locked palette comes
    with import (G9). `palette save as=<name>` (G3 notes: save a palette back) writes a new project
    palette and refuses to replace a different one: `new … palette=<name>` reads the project's
    palette again on every replay, so changing a palette file changes every tape made with it.
    *For later:* snapshotting the palette into the tape's `new` line would make tapes independent of
    palette files; it changes the `new` normal form, so it is left as a question.

47. **The generators' parameters.** §3.3 sketches `noise … weights=1,6,2 cluster=2..4
    density=0.12`, `scatter stamp=… count=5 minDist=6`, and §3.4 "Voronoi stones and bricks".
    *Reading:* `noise` fills the box with a base colour (the heaviest-weighted entry, or `base=`,
    or `keep`) and grows clusters of the other ramp colours, by weight, until `density` of the box
    is covered. `scatter` places stamps (or single pixels, `c=`) by their middle at points at
    least `minDist` apart (Poisson-like rejection). `voronoi` is cells of the nearest of n
    spread-out points (one Lloyd relaxation by default), each a ramp colour, with optional 1-px
    gaps; `bricks` is courses with joints. All take `wrap=on|off` (default: the document's) and
    work on a torus when on. Wave and ripple bands (§3.4) are not in G4's list and are left for later.

48. **`shade` and `clean`.** `shade light=nw ramp=wood edge=1`, `clean orphans keep=texture`.
    *Reading:* `shade` treats a run of pixels of one ramp as a shape; within `edge` pixels of its
    boundary on the lit side a pixel goes one ramp step lighter, on the far side one darker (a
    diagonal light counts both its sides; a pixel lit and shaded at once stays). `clean orphans`
    gives each pixel (or cluster up to `size=`) that shares no 4-neighbour's colour the colour most
    common around it; `keep=texture` keeps strays one ramp step from that colour.

49. **Brushes.** G4 lists "stamps and brushes"; the plan does not define brushes.
    *Reading:* `brush square|circle <n>` and `brush stamp <name>` give the author a brush that
    outline-like commands draw with (px, line, curve, stroke, and the outlines of rect, ellipse
    and polygon); filled shapes and generators ignore it. Stamps are kept in the document.

50. **Macros on the tape.** `def tuft(x,y) { … }`, `call tuft 5,18`.
    *Reading:* `def` is a line on the tape (body normalised) and the macro is document state; each
    `call` is one line, expanded again on replay. `$x`, `$x+1` (left to right) and `$(…)` integer
    expressions; words are allowed as values. Generators inside take seeds from the call's
    `seed=`, which is then written into the call's line (so another seed is another variant of
    the whole macro). Macros cannot hold `new`, `fork`, `undo`, `redo`, `note` or `def`.

51. **Selections and context in the watch view** (changes G3 item 30).
    *Reading:* since selections are now per author, the page writes them at once (`select …`;
    Shift adds, Alt subtracts; Esc `deselect`), so they undo like any edit, as in Aseprite. Moving
    writes `shift`, Delete writes `clear`. The layer, frame, symmetry and brush chosen in the page
    are sent with the person's next edit, only when they differ from theirs in the document, so
    choosing them writes nothing by itself.

52. **Checkpoint files** (G1 item 9, G3 item 40).
    *Reading:* every 200 commands (the count of tape lines), `checkpoints/NNNNNN.gwc` holds a
    header line with N and the SHA-256 of those N tape lines, then the state bytes. The writer
    loads from the newest one whose prefix matches, and `verify` compares each with the replay.
    The state bytes became complete (`PCLAWDOC 2`: ramps, lock, layers' flags, contexts, home,
    stamps, macros) so a checkpoint can be loaded; `verify` still accepts an `asset.json` hash in
    the G1-G3 format until the asset is saved again. Undo now replays from in-memory snapshots
    kept as the tape is written (G3 notes), not from the start.

53. **"A seamless grass tile with two variants".** §4.1 has `variant add from=sand seed=…` and an
    acceptance rule on colour mix; G4 does not list variants.
    *Reading:* the demo makes variants with what G4 has: the texture is a macro, and each variant
    forks the tape after the macro is defined and calls it with another seed. The demo prints the
    three colour mixes side by side; `variant add` and its acceptance rule are left for G5/G7 with
    the seam and consistency checks.

## G5

54. **The palette snapshot (§13, item 46).** "The `new` line (or a `palette` header block right after
    it) carries the full palette."
    *Reading:* in the `new` line itself, as a block: `new … palette=<name> <<` then one row per
    entry (`<key> <name> #rrggbb [role=<role>]`) and per ramp (`ramp <name> <entries…>`), then
    `>>`. The normaliser reads the project palette once and writes it down; a script may give the
    block itself. A tape's language is read from its first line (no block: language 1), and the
    header must agree; language 1 tapes replay by reading the project palette, and a branch of one
    stays in language 1. The example project was rebuilt in language 2 (same pixels); a language 1
    copy is kept as a test fixture.

55. **Role entries and themes (§3.1, §4.8).** An entry "may be a role instead of a fixed colour".
    *Reading:* an entry keeps a `hex` (what it looks like without a theme; by default the grey
    theme's colour for its role) and gains `role` (black, white, light, dark, darkest), set by
    `palette add … role=` and `palette set … role=|none`. Themes give the roles colours, for
    looking only (views and the watch view); the generic built-ins are `grey`, `moss`, `ember`,
    `tide`, `dusk`, `sand` (from the triad formula of §7.4, with invented hues), and a project
    adds its own in `project.json` `themes`. In role art the `palette` check wants every pixel to
    be a role, and the `black` role counts as outline ink. The "encoding margin" part of `palette`
    needs an export profile's thresholds and is left for G9.

56. **Where thresholds live.** "A threshold (set in the project's style guide)"; §7.1 puts
    thresholds in project.json and the guide's words in style.md.
    *Reading:* `project.json` `style`: `palettes`, `outline`, `ground`, `drawScale`, `sizes`,
    `checks` (per check, per kind, `off`), and `assets.<name>` overrides (the stone floor's
    courses are its pattern, so it is not held to `repetition`). Defaults are in docs/checks.md.
    The server reads project.json again when it changes and tells the pages.

57. **What the checks measure, where §5 is a sketch.** Each reading is in docs/checks.md; the
    ones worth questioning:
    - `orphans`: a pixel no 4-neighbour shares *and* whose 8-connected cluster is at most two
      pixels (a lone pixel or a diagonal pair). Read literally, "no 4-neighbour shares its colour"
      flags every pixel of a diagonal line and every diagonal step of an outline. Score: strays per
      100 opaque pixels (so the A1 bar "sprite strays < 1" reads as under 1 %). On tiles a stray one
      ramp step from its surroundings is texture.
    - `jaggies`: a doubled L-corner is a corner a line zig-zags through (it steps the same way
      before and after); a corner where a line turns and carries on (a box, a hook) is meant.
      Irregular runs: a run longer or shorter than both neighbours by 2 or more (1-2-1-3), never
      counting the cut runs at a segment's ends; on thin lines of at least 6 px and on silhouette
      contours. Spikes and notches (a notch needs solid shape two pixels deep behind it). On
      tiles the ground colour is not a line. Tiles allow 2.
    - `banding`: pillow shading is judged per ramp: the ramp steps that follow the outline get
      lighter (or darker) inward on every side alike. A rim light on the lit side only (what
      `shade` draws) is not banding. Score: the weakest side's agreement (0 to 1); fail above 0.5.
    - `outline`: the share of the silhouette edge in the outline colour; the gaps are the other
      edge pixels. Outline thickness is not checked.
    - `readability`: ΔL* of each edge pixel against the ground under it (the usual ground tile,
      repeated), at least 15 for 80 % of the edge; silhouette IoU with the set at most 0.9; L*
      spread (p95 − p5) at least 25. The set is every other asset of the same kind and size that
      does not wrap, leaving out branches of the same asset.
    - `revert`: by colour (palettes may differ), over the union of opaque pixels; only with
      `ref=`.
    - `coverage` in G5: the style's sizes, whole cells, empty frames and cells. Autotile names
      need schemes (G7); frame counts per asset need the manifest (G10).

58. **The repetition check for tiles.** §13 asks it to "catch grass_b's faint rows".
    *Reading:* every band of 1-6 whole rows (or columns) repeats across a tiled floor as a
    stripe; the score is the worst band's lightness difference from the tile's mean, in L*, times
    the square root of its width (wider bands show at lower contrast), at most 3. Measuring
    against random noise was tried and rejected: random noise of the same contrast makes
    stripes too, and they show. A motif repeating (the same tuft every 24 px) did not separate
    from noise by any simple measure tried (a hot-spot ratio scored noise higher than the grass);
    that is left to the eye, the blind reviewer and G8's map hot spots.

59. **The check summary in every `run`.** *Reading:* every check that applies, on the agent's
    frame, after every batch (cheap at these sizes), one line. The CLI's `run` prints it too.

60. **The `game` view's neighbours and scale.** "Next to its neighbours in the set (all
    characters in a row, all directions of one character)."
    *Reading:* the set as in item 57 (up to seven), or `with=`; directions come with G6's views.
    Sprites stand on a common baseline on the ground tile, repeated; 1x and `style.drawScale`
    (default 2).

61. **The review bundle (§5).** *Reading:* `reviews/<date>-<set>/` with each asset enlarged with
    rulers and at game scale, tiles 3x3, sprites on their ground beside their set, the colours the
    art uses, style.md and rubric.md (asking for defects as `<asset> x,y [WxH] "text"`, ready to
    become notes). No tape, no author or method names; the date is the writer's clock. The tool
    calls no model; the agent's findings can be kept beside the bundle (`findings.md`, as in the
    demo). The first bundle listed every palette entry, including one no pixel used, and the
    reviewer took it as a clue; it now lists only the colours used.

62. **Checks in the watch view.** *Reading:* the page computes them with core from the same style
    guide (so they follow time travel and agree with `check`). Chips toggle magenta rings on the
    canvas; a check's details pin its pixels as notes, one per cluster (a box around scattered
    pixels would cover the whole sprite).

63. **Diff across frames** (G4 notes). *Reading:* the diff compares every frame; one row of
    before/after per frame that changed, numbered; the text prefixes `f<n>` on documents with
    frames. A new empty frame is not a change; a copied one is (its pixels are new).

64. **Playback speed.** G2 item 24 plays "at the chosen speed". A slow first frame (over 33 ms at
    60/s) made the page skip a command. *Reading:* up to 60 commands a second, at most one per
    frame, so a slow frame delays playback instead of skipping.

65. **Variants' acceptance rule** (§4.1, item 53). Still not built: it compares a variant's colour
    mix with its base, which belongs with `consistency` (G10) or the family tools (G7).
