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

## G6

66. **G5's "Notes for G6".** They were in G5's final report, not in the repo; §14 carries the
    items the reader kept (upgrade, checks over every frame, throttling, the floor). *Reading:* §14
    is the list.

67. **Views and frames.** §4.4: "views S, N, E, W, each holding its own frames".
    *Reading:* a view is a named run of the document's frames (`view S frames=1-2`), so the
    timeline, the cels and every frame command stay one list; views never overlap and a frame
    cannot move out of its view. Directions are S N E W and the four diagonals.

68. **Live mirror links.** `view W mirror=E` "updates live". *Reading:* after every command the
    mirror view has as many frames as its source (added or removed at its own end), each layer's
    cel is the source's flipped left to right about the canvas (x → W−1−x), and its durations are
    the source's. Drawing on a mirror frame is refused with the frame to draw on; `mirror=off`
    keeps the pixels. Only views facing the other way left to right may mirror (E/W, SE/SW,
    NE/NW). How a mirror exports (draw-time or baked) is G9's profile.

69. **Linked cels.** *Reading:* as in Aseprite, one cel shown in several frames: a shared pixel
    array, so any author drawing on any of the frames changes all. `cel link a-b` takes frame a's
    pixels; `cel unlink` copies. `layer merge` unlinks the layer below first.

70. **Durations and the tick rate.** *Reading:* every frame has ticks (default 10, the engine
    profile's `frameTicks`); `tickRate` in project.json (already 60 since G1) sets the speed of
    playback, the anim view's text and the GIF. A new frame takes its source's ticks; `frame set`
    over a range sets every frame that is not a mirror's.

71. **Sequences.** Playback, the anim view and the anim checks need "what loops". *Reading:*
    every tag; every view with no tag inside it; or, with neither, all frames as one cycle. A
    ping-pong plays there and back without repeating its ends (1 2 3 2).

72. **The anim checks' numbers.** §4.4 gives the pilot's good pairs (16-19 % changed) but no
    limits. *Reading:* frame diff share = pixels whose colour differs (opacity included) over the
    union of both frames' silhouettes, 8-35 % for sprites (3-35 % for tiles, whose shimmer is
    subtle); pivot drift = the spread of the silhouette's centre column over a sequence, ≤ 1 px;
    ground drift = the lowest row against the ground line (or the first frame's lowest row), 0 px;
    area jumps ≤ 15 %; the loop seam (last frame back to the first, cycles only) in the same band.
    The pivot itself is an export field: drift is measured between frames, not from it.

73. **The view distinctness check.** *Reading:* a separate check, `views`: each pair of views,
    by their first frames, must differ by colour over both silhouettes by ≥ 20 %; mirror views
    count as their source and views facing each other left to right are not compared.

74. **Checks over every frame** (§14). *Reading:* every check of one image runs on every frame;
    the result is the worst frame's, its detail starts `frame N:`, each flagged group carries its
    frame, and views draw the marks of the frame shown. `check frame=` still checks one frame.

75. **Throttled checks** (§14). *Reading:* run summaries (and the page) check every frame up to
    262,144 pixels (w × h × frames) and otherwise only the frame being drawn on, saying so; `check`
    always covers every frame. The page also recomputes at most twice a second while a batch plays
    on such a canvas.

76. **Onion skin and playback in the UI.** "Every new UI control replays from its logged
    command". *Reading:* controls that change the document log commands (ticks, tags, views,
    mirrors, links, pivot, ground); playing, the onion skin and the guides only change what the
    person sees, like zoom and the theme in G5, and log nothing (tested). The onion skin shows the
    frames before and after yours in its view or tag.

77. **`pixelclaw upgrade`** (§14). *Reading:* only the `new` line changes (it takes the palette
    it read from the project); the tape is replayed before and after and written only when the
    state bytes are the same, then verified; checkpoints are written again (their prefix hashes
    change). A tape already in language 2 is left alone.

78. **The stone floor as a floor** (§14). *Reading:* redrawn on its own tape (the history stays)
    as flagstones from above; G5's reviewer found the bevelled courses read as a wall. The
    repetition check fails every jointed slab layout tried (about thirty): the joints make rows
    and columns darker. The style guide's exception for this tile stays, reworded ("its joints
    are its pattern"). G6's blind reviewer reads it as flagstones; its other findings (a lit edge
    on the flags, more moss) are polish.

79. **New palettes for the demo.** The walker and the water need skin, cloth and water colours.
    *Reading:* as the chest did in G4, each tape adds its entries and saves them as a project
    palette (`ruins-folk`, `ruins-water`), and the style guide lists them.

80. **`view … all` in the CLI.** docs/commands.md said `all` is the first three views; the code
    wrote every view but the diff (and so, from G6, the anim GIF too). *Reading:* the docs:
    `all` is render, grid and tile3x3.

## G7

81. **What a family document is.** §4.2 has "family documents" and three routes but no layout.
    *Reading:* `new family <name> <T>x<T> scheme=<s> [map=<C>x<R>]` makes a sheet: row 0 holds the
    `inside` (the terrain) and `outside` textures, then every variant of the scheme in its order,
    then an optional coverage map area. Cells have names (`@cell(inside)`, `@cell(ne_ne)`). Two
    layers: `ground` (the textures, laid again on every variant after every command) and `band`
    (the band's art: the pieces drawn by hand, the other variants assembled from their quadrants
    after every command, as mirror views are kept). Detail on a piece therefore propagates live;
    a variant can be detached to draw it by hand. Authors draw on `band` by default.

82. **Texture re-projection.** "Every variant is assembled from 12x12 quadrants and re-projected
    onto the shared textures." *Reading:* the textures are never copied with a piece. Each
    variant's ground layer is, pixel by pixel, the inside or the outside texture *at the same
    pixel of the tile*, chosen by the band geometry; so every variant tiles with the plain
    textures and with each other, and changing a texture changes every variant. A cut keeps only
    the band's pixels for the same reason.

83. **The band profile's syntax and geometry.** The plan writes `band shallow: 6 sand1, 1 foam,
    fill shal1; radius 4`. *Reading:* `family band <w>:<fill>…` from the terrain's edge inward,
    each fill a colour, `outside` (the outside texture carries on into the tile, so the edge sits
    inside it, off the tile border) or `inside`; after the listed widths, the inside texture.
    Distances are measured per quadrant (in half pixels, integers): along an edge, the distance
    from it; at an outer corner, concentric arcs whose innermost (the band's inner edge) has
    `radius`; at an inner corner, the distance from the corner point. Inset, band and radius must
    fit in half a tile. The profile is stored (for the ground and for cuts); its colours are drawn
    once on the pieces (`draw=on`), so hand detail is never overwritten by a later command.

84. **Quadrant pieces** (route 2; "the 5 quadrant kinds"). *Reading:* the pieces are themselves
    variants whose four quadrants are all one kind: blob47's `o` (outer corners), `nesw` (inner),
    `ew` (horizontal edges), `ns` (vertical) and `nesw_ne_se_sw_nw` (interior); a scheme lists
    its pieces and the loader proves they hold every quadrant the other variants need (the
    corner Wang scheme needs seven, found by a greedy cover). Hand-detailing "the band on the 5
    quadrant kinds" is drawing on these cells.

85. **Schemes as data.** *Reading:* `core/schemes/*.json` (written by `scripts/gen-schemes.ts`,
    kept so they can be checked): `neighbours` (8 with the corner rule, 4, an axis, the tile's
    corners, none), each variant's name, reduced key and four quadrant kinds (in, out, outer,
    inner, horiz, vert, or aliases like bridge ends, each facing a corner), the pieces and the
    sheet's columns. Names are generic (`ne_ne`); the engine's `root_<letters>_<diagonals>` comes
    from an export profile's template in G9. Project schemes (`schemes/*.json` in a project) are
    not read yet: a tape would need the scheme written into it, as the palette is (§13). Left for
    G9/G10 with profiles and the manifest.

86. **bridge8 and face.** The plan names them without variants. *Reading:* bridge8 is a deck
    joined along one axis (east-west first): single, both ends and the middle of each axis; the
    north-south single cannot come from neighbours alone (no bridge beside it reads as the
    east-west single), so it is placed by name and coverage maps leave it out. face is blob47 plus
    four south faces (single, west end, middle, east end), drawn in the cell *below* the terrain
    when that cell is not terrain, joined to the faces beside it; their ground is the outside
    texture and their art is drawn by hand (pieces `face_o` and `face_ew`).

87. **Coverage maps.** "Generated from the scheme's coverage rules." *Reading:* `family coverage
    [seed=] [copies=]` lays out the family's map area so every variant the scheme can produce
    appears `copies` times: each variant's smallest neighbourhood is stamped where it changes the
    fewest cells and keeps every variant already placed, in a seeded order, then a seeded hill
    climb finishes what did not fit. blob47 needs about 14x12 tiles (12x10 fails for most
    seeds); the command refuses, saying so, when no layout is found. The flat template (inside,
    outside and the band's colours) goes on a reference layer `template`; `fill=on` also paints
    the map with the current variants to start from.

88. **Cut from a map** (route 3). *Reading:* `family cut` gives each variant the medoid of the
    map tiles that resolve to it (fewest differing band pixels to the others), keeps its band
    only and detaches it; `textures=on` also takes the textures from the map's all-inside and
    all-outside tiles. The painted map lives in the family's own map area, so the tape stays
    self-contained; painting it from an underlay is G11's.

89. **Copying a texture from another asset.** Route 1 lays "the inside and outside textures",
    which are tiles of their own. *Reading:* `family texture inside from=sand` copies the tile's
    pixels into the texture cell, and the line records them (a block of rows), so replay never
    reads another asset (§13's rule for palettes). Colours are matched by name, else by exact
    colour; a colour the family's palette lacks is refused.

90. **The map preview and the seam score over maps.** *Reading:* `view map`: a random island
    (seeded value noise on a 2-tile grid with a fall-off from the middle; the edge always
    outside) of 12x10 tiles by default, at the draw scale, with the seam score of §13 computed on
    the composed map (tile size t, no 3x3 tiling) and the variants it used. A family's `seam`
    check is that score on the 12x10 island of seed 1. Given terrains and map documents are G8.

91. **Overlays** (§4.3). *Reading:* an overlay is its own document (`new overlay`), with frames
    and ticks as any, and `overlay set mode= on= anchor= spread= every= rest= seed=`: cycle and
    ping-pong play in step; wave shifts the phase by an eighth of a loop per tile along x+y;
    sparkle plays once per `rest` ticks at a seeded moment per tile. Instances go on the outside
    tiles, the terrain, or all, one tile in `every`, offset by a seeded amount within `spread`.
    They play over `view map` (`with=`), the watch view's map, and the review's map GIF. An
    overlay's checks treat it as an effect (no outline, readability or stray rule).

92. **Animated families** (§15: "reuse `sequences()` and linked cels"). *Reading:* a family has
    frames like any document; derivation runs per frame and per layer; the map and its GIF play
    the family's first sequence. The demo copies each frame of the water into the same frame of
    the shore and links the band layer's cels, so hand detail shows on every frame.

93. **Map GIFs.** A sparkle overlay with a long rest and a 4-frame family make loops of many
    seconds; the first map GIF was 13 MB. *Reading:* one loop, at most four seconds, in steps of
    at least 3 ticks; the GIF encoder writes only the box that changed in each frame after the
    first (`delta`, used for maps; the G6 anim GIFs are unchanged). The review bundle's map GIF
    is at 1x.

94. **Checks on a family sheet.** *Reading:* a family is judged on its map: `seam` over the
    island, `coverage` as every named variant and both textures drawn; `jaggies` is skipped (its
    textures are tiles, checked as tiles, and its band's curves step unevenly by design: 118
    "defects" on the demo's shore); `anim` asks only 1 % of the sheet to change (most of it is
    still terrain).

95. **"A family view showing every variant against its neighbourhood".** *Reading:* the watch
    view's toolbar switches a family between its sheet, its variants (each in the middle of the
    3x3 map that resolves to it, neighbours dimmed, with detach and attach) and a map (size, seed
    and overlays, only for looking); `view family` gives the agent the same picture with the
    sheet's layout in words. "Collapsible timeline rows" (§15): each timeline row and the whole
    timeline fold, only for looking.

## G8

96. **What a map document is.** §4.11: "a grid of cells … several layers … every cell holding a
    tile name, not pixels, so a map redraws itself whenever a tile changes." *Reading:* `new map
    <name> <C>x<R> tile=<T>` makes a document whose canvas is the grid of cells (one "pixel" per
    cell, so notes and coordinates are cells, and undo, replay, time travel and the state bytes
    work unchanged). Each layer says what it holds: `terrain=<family>` (1 where the terrain is),
    `tiles` and `objects` (an index into the map's table of names at each thing's anchor cell),
    `overlay=<overlay> on=<where>`. The art is read from the named assets only when the map is
    drawn or checked, never on the tape (G7's note). Drawing commands are refused on a map.

97. **Several terrains.** *Reading:* one family per terrain layer, layered bottom to top; a layer
    with `outside=on` also draws its outside texture on the cells outside its terrain (the sea
    under an island), the others draw only their terrain's cells. Terrains stack seamlessly when
    the upper family's outside texture is the lower's inside texture (the meadow is grass on sand,
    on the shore's sand). A corner scheme on a map reads each cell's top-left corner from the cell
    (the last row and column repeated): one bit per cell, like the edge schemes.

98. **Footprints, anchors, flags** (§4.10). *Reading:* `footprint <C>x<R> [at=] [anchor=] << flags
    >>` on any asset: the footprint is a rectangle of the art grid (the canvas in cells), by
    default its bottom-left corner; the anchor is a footprint cell (default bottom-left); the
    flags are per art cell (`.` `b` blocks `r` roof/canopy `x` both), so a crown above a one-cell
    footprint can be a canopy. Walkable is "in the footprint and not blocking". The pivot in
    pixels is G6's `pivot`. An asset without a footprint stands on its whole art grid.

99. **Placing without reading other assets on replay.** *Reading:* `place` writes the footprint
    it read into its line (`cells=2x2 anchor=0,1`), `scatter` writes one per asset (`fp=`), so the
    tape replays alone (as `family texture from=` records its pixels). If an asset's footprint
    later changes, the `footprint` check says so ("place it again"). Footprints may not overlap
    on any objects layer (on a tiles layer, on that layer); the batch is refused with the cell and
    what holds it.

100. **Draw order** (§4.10 "draw-order rules"). *Reading:* ground layers (terrain, tiles,
     overlays) in layer order; then every object of every objects layer by its footprint's bottom
     row, then layer, then column; then every roof cell again. Problems the `draworder` check
     reports: art outside a footprint that is not a roof (an actor behind would be drawn over it),
     and a roof hiding part of an object that stands in front. Faces (G7's note) already draw in
     the cell below their terrain through the scheme; objects on them are not special-cased.

101. **The map checks** (§4.11). *Reading:* `seam` (§13's metric over the composed ground);
     `repetition` as two hot-spot measures: a family's edge tile, identical pixel for pixel, in
     a straight run of more than 4 cells, and one textured tile filling more than 10 of the 16
     cells of a 4x4 window (cells nearly one colour, and the open ground a terrain layer fills
     the map with, are left out: the sea is judged as its own tile); `footprint` (missing, off the
     map, overlapping, changed since placed, or on the filling layer's outside ground or edge
     tiles: not in the sea or the surf; a house on the meadow's sandy edge is fine); `draworder`;
     `coverage` (missing assets or variants, undrawn tiles the map needs). The assets' own checks
     are skipped on the map. Readability of objects on each ground and consistency across the
     screen (§4.11's last two) are left for G10's `consistency`.

102. **Texture variants** (§4.1 "`variant add from=sand seed=…`"). *Reading:* a variant is an
     asset of its own declaring `variant of=<base>` (made with `fork`, then the generator run
     again with another seed, or the detail moved; for a family, its band drawn again and its
     detail placed elsewhere, or another inside texture). Maps pick among an asset and its
     variants cell by cell (a hash of the cell, moved on when it would repeat both the left and
     upper neighbours). The pilot's acceptance rule is the `variant` check (colour-share L1 < 0.3,
     mean ΔL* < 2); differing border pixels are reported, not failed (noise textures blend; the
     map's seam score judges it).

103. **`map gen`.** "From the manifest's terrains and objects" — there is no manifest before
     G10. *Reading:* `map gen island|village|dungeon [layers=…] seed=` lays out only terrain
     layers (by default the map's, in order): an island (value noise with a fall-off, smoothed by
     a majority pass and with one-cell spits and notches removed, the G7 note's "blocky" islands);
     a village (the island, an inner ground two cells in, two lanes crossing it a cell in from its
     edge); a dungeon (rooms joined by corridors). Objects come from `place` and `scatter`.

104. **The camera.** *Reading:* project.json `style.camera` is the engine's screen in art pixels
     (default `384x216`, 16x9 cells of 24); `view map camera=x,y` shows it around a cell, kept on
     the map, at the draw scale.

105. **Tiled `.tmx`.** *Reading:* one tileset image of every distinct tile the map draws
     (composed, so variants and families' edges are baked), a CSV tile layer per ground layer, an
     object group per objects layer with tile objects from an image collection (gids from
     100001) placed by their bottom-left as Tiled does, with cell, footprint, anchor and flags as
     properties. Overlays are left out (an engine effect). Wang sets (`.tsx`) and Godot are G9's.

106. **`split`.** *Reading:* every cell of the art grid becomes `<name>_<cx>_<cy>` (empty ones too,
     marked `empty`, so reassembly is identity), with `<name>.stamp.json` holding each piece's
     offset and flags, the footprint and the anchor. The naming template is G9's profile.

107. **`seam` on an oversized asset's border** (§4.10). *Reading:* not a number in G8: `view map`
     of an object stands it on its ground among plain tiles at game scale, and the `footprint`
     check keeps bases off edges; objects are outlined sprites, so §13's metric does not apply.

108. **The map in the UI.** *Reading:* a map opens in a map editor in place of the canvas (paint,
     rectangle, erase, place, move, remove; camera, zoom and hot spots only for looking); layers
     are added with the command line (`layer add …`), and the timeline is hidden for maps. A map's
     `changes` diff shows the composed cells before and after and says what moved.

109. **What the blind review found that the checks did not.** The reviewer saw the open sea's
     single water tile as a woven lattice; `repetition` leaves a filling layer's outside ground out
     of its motif windows (so the sea, one tile everywhere, does not fail every map). *Reading:* kept
     for G8 (the sea is G6's tile and is checked as a tile), noted on the village for water
     variants; a lighter weight for open ground rather than none is a choice for A1. The reviewer
     also asked whether lanes may use the sand ramp: the style guide now says lanes are beaten sand.

## G9

110. **What a profile is** (§4.9, §7, §17). *Reading:* one JSON file per target, with one `layout`
     (loose, atlas, sheet, tiled, godot, aseprite-json, aseprite) and data for naming, numbering,
     views, variants, oversized assets, roles, densities, records and snippets; reference in
     docs/profiles.md. §4.9 also lists GIFs and contact sheets as profile outputs; they are not in
     §10's G9 list and the `anim` view already writes both, so they are left out.

111. **Density pages "with optional @2x and @1x reduced levels"** (§7.4). *Reading:* `density.levels`
     lists the levels written, each exactly d times the base frame; file names carry `suffix`
     (`@{d}x`) except at the `plain` level. A level uses the authored copy at that level if there
     is one (`density of=`), else (with `reduce`) the highest authored copy above it reduced with
     the profile's reducer, else the 1x art scaled up; the export's notes say how many were reduced
     or scaled. Levels are relative to the 1x copy; a project's `grid` stays its native grid.

112. **Role encoding.** *Reading:* `roles` maps each role to the colour it is written as; import reads
     those colours back as the role entries. Two entries written as one colour are reported (the
     import takes the first). §5's encoding margin (no exported colour within 10 levels of an
     engine threshold) needs the engine's thresholds, so it waits for the engine profile.

113. **Mirror views "baked or flagged"** (§4.4, §15). *Reading:* `bake` writes a mirror view's frames
     flipped; `flag` leaves them out and marks the source's images (`mirror` column, `{mirror}` in
     snippets as `W=E`). Import rebuilds the left-out frames by flipping the source's, so the round
     trip is exact either way.

114. **Variants on export** (G8's notes). *Reading:* `variants: frames` numbers an asset's texture
     variants after its own frames (`moss_1`, `moss_2`, then `moss_b` as `moss_3`, `moss_4`); a
     family's variants number each cell the same way; `names` exports each under its own name. An
     export of named assets brings their texture variants and density copies; a map brings what it
     draws.

115. **Oversized assets.** *Reading:* `oversized: sprite` writes one image with its frame size,
     pivot and footprint (records `cols`, `rows`, `anchorX`, `anchorY`, `flags`; snippets); `split`
     writes one-cell pieces named by `names.piece`. G8's `export format=split` (with its stamp
     JSON) and `format=png` stay as single-asset exports.

116. **Tiled `.tsx` wang sets "replacing G8's baked tileset".** *Reading:* the `tiled` profile writes
     a `.tsx` per family (its sheet with frames stacked as tile animations, each tile's name and
     variant as properties, a wang set: `mixed` for 8-neighbour schemes, `corner` for wang16-corner,
     `edge` for path; fillet and face variants are tiles but not in the wang set), every other image
     in a collection `tiles.tsx`, and a `.tmx` per map whose ground layers hold each cell's family
     tile (texture variants of a family are families of their own, so their own `.tsx`). G8's
     `mapToTmx` and `format=tmx` are removed.

117. **Godot terrains.** *Reading:* one `TileSet` `.tres` per family: one atlas source (frames side by
     side as tile animations with `animation_separation`), one terrain set (mode 0 for 8-neighbour
     schemes, 1 for corners, 2 for sides), peering bits from each variant's key, the image's name
     as custom data so it reads back. Other assets are left out (noted). Written from Godot 4's
     resource format; not opened in Godot here.

118. **`.aseprite` read and write.** *Reading:* files are written indexed (8 bits), file index 0
     transparent and entry i as i+1, so at most 255 colours; layers with hidden and reference
     flags, frame durations in ms (ticks at the project's tick rate, rounded both ways), linked cels,
     tags (forward, ping-pong) and views as tags named `view S` / `view W mirror E`. Reading also
     takes RGBA and greyscale files (quantised); group and tilemap layers, cel opacity and blend
     modes, slices and user data are ignored.

119. **"Re-import a sheet and edit it".** *Reading:* imports make new assets (a PNG sliced by a grid
     into frames, or kept whole with that cell grid; an `.aseprite`), whose tapes start with the
     palette in the `new` line and an `import` command per layer and frame carrying the pixels
     (keys, `.` transparent) with the file's name and blob hash for the record; the file is kept in
     `blobs/`, and replay never reads it. A profile import reads a game folder back and reports
     which assets match exactly; it does not write into existing tapes (a person can `fork` and
     replace).

120. **Quantising.** *Reading:* exact colour first, else the nearest entry by a weighted ("redmean")
     RGB distance in integers; alpha below 128 is transparent; the result says how many pixels were
     off-palette and the worst distance. A locked palette is the target palette (imports always
     quantise to it, §3.1). `build` makes a palette of the image's colours in first-seen order (the
     256 most used when there are more).

121. **Density sets.** *Reading:* a higher copy is an asset of its own: `fork`, `scale <n>` (every
     layer, frame and stamp, the cell grid, pivot, ground and notes; the footprint keeps its cells)
     and `density of=<base> d=<n>`, then detailed. The `density` check reduces it and compares with
     the base (share of the base's pixels that differ, default ≤ 25 %, the copy's blocks flagged);
     reducers `ink-vote` (ink wins at a quarter, §4.7), `mode`, `nearest`, registrable;
     `style.density` chooses. The `density` view and a watch-view preview tab show the levels and
     the reduction. Coverage holds a copy to d times the style's sizes.

122. **Project schemes "written into the tape like the palette"** (§16). *Reading:* `schemes/*.json`
     are found by name when a `new family` line is first run, and the line records the scheme as
     `def="<canonical JSON>"`; the family's state keeps it, so replay, maps and exports never read
     the file.

123. **"A scheme option for rounder inner corners"** (§17). A blob47 inner corner can only be as
     round as the band is wide: the edges beside it cannot see the corner (the corner rule drops a
     diagonal when a side next to it is not terrain). *Reading:* the option is `cornerRule:
     "either"` (a diagonal counts when either side is terrain) plus `fillets: true`: edges with
     terrain on that diagonal bend into the corner (quadrant kinds `vround`, `hround`), the inner
     corner's arcs widen, and the outside cell gets the rounding's tip (15 fillet variants keyed by
     corners, drawn in outside cells; a terrain layer that does not fill its outside draws only
     their terrain pixels). `family band … fillet=<px>` sets how much wider. 161 + 15 variants.
     Built-in schemes are unchanged; `blob47-round` ships as the example project's own scheme (it
     also exercises project schemes). Its coverage map is not tried.

124. **The open sea and the village's notes** (§17). *Reading:* the motif windows now count a filling
     layer's outside ground. Water and sand variants are the tiles with their layers moved round
     the torus by different amounts (the colour mix is the base's exactly; the motif and seam
     checks judge the borders); four looks of the shore mix them. Lanes reach the beach by leaving
     the lane's outside empty (it is drawn over the ground below; coverage accepts an empty outside
     over a drawn inside). The straight coast and meadow edge were broken with `terrain` edits.

125. **The sample profile.** *Reading:* `examples/mossy-ruins.pclaw/profiles/bramble.json`, for an
     invented engine "Bramble" (no names from any real engine): atlas plus CSV in §7.4's column
     order, levels 1/2/4 with reduction, five role colours (not the engine's), autotile naming in
     the style of `root_<letters>_<diagonals>`, numbered sets from 1, flagged mirrors, Lua-like
     snippets.

## G10

126. **The replay or state cache** (§18). *Reading:* a state cache rather than more checkpoints:
     each asset's state after its whole tape in `<project>/.cache/state/<asset>.gwc`, keyed by the
     SHA-256 of the tape file, of the engine (core's sources and built-in schemes from the repo,
     the bundle when packed) and, for a language 1 tape, of the palettes it reads. It is a cache,
     not history: never committed (its own `.gitignore`), rebuilt by any replay, compared by
     `verify`. Checkpoints stay as they are (§7.1).

127. **Statuses.** *Reading:* worked out from the project every time, never written by hand or
     stored: planned (in the manifest only), drafted (exists), checked (every check passes),
     reviewed (`mark reviewed` on the tape), approved (`mark approved`, a person in the
     dashboard), exported (`exported.json`). Each needs the ones before it. A mark keeps the art's
     hash (frames as they look; notes, marks and selections leave it), so a later change makes it
     stale and the status falls back, with the reason in `plan`. `mark rejected "…"` after an
     approval sends it back to reviewed; undoing a mark's group takes it away.

128. **"Exported"** (G9's note). *Reading:* recorded outside the tape, since exporting does not
     change the document: `exported.json` keeps each asset's last profile, folder, time and art
     hash; an asset is exported while that hash is its art's.

129. **The manifest's fields** (§7.3: kind, size, scheme, frames, views, band, status).
     *Reading:* `manifest.json` with `format`, `version`, `theme` (the paragraph), `sets`,
     `export`, and per asset `name`, `kind`, `size`, `set` (default: the kind), `description`,
     `palette`, `scheme`, `inside`, `outside`, `band`, `frames`, `ticks`, `views`, `mirror`,
     `cells`, `height`, `variantOf`, `recolourOf`, `uses`, `flat`. Unknown fields are errors.
     The status is not a field (127). `height` (the drawn shape's height) is how size
     consistency is planned (G6's note: a chest as tall as the walker).

130. **Style-guide-driven defaults and thresholds.** *Reading:* `new` without a size, palette or
     scheme takes the manifest's entry (else the style guide's size for the kind; an object's
     cell grid is the project's grid); `shade` without `light=` takes `style.light`; `outline`
     without `c=` the first of `style.outline` the palette has. Defaults are written into the
     line, so replay never reads them. Thresholds: `style.sets.<set>.checks`, between the style
     guide's and the asset's own.

131. **`consistency`** (§5: colour usage per material, light direction, outline share, cluster
     sizes, mean lightness per family). *Reading:* each asset against the rest of its set (the
     manifest's set, else ground tiles with tiles and figures and props together) and the plan:
     height (± 2), lightness compared only among assets mostly in the same ramp ("per family" as
     per material: sand is lighter than moss by nature), outline share, the light from the
     shading gradient between neighbours of one ramp (lighter toward the light) against
     `style.light`, cluster size over the square root of the drawn area, ramp steps per material.
     An outlier is one beyond a limit from the set's median (two others needed). Families and
     overlays are judged on their maps; on a map, the objects standing on it are held to each
     other (§4.11's "consistency of light and palette across everything on screen"; G8 left it
     here).

132. **Palette-swap recolours** (§4.8, G9's note). *Reading:* `b` is a recolour of `a` when both
     have the same size and opaque pixels on every frame and each of `a`'s colours is always one
     of `b`'s and no two share one (a bijection), with at least one colour different. They are not
     compared with each other in consistency or in readability's silhouette distinctness.

133. **Flat templates** (§7.3 step 3). *Reading:* drawn from the manifest alone into
     `templates/`, not as assets: the mockup screen is one camera-sized screen in flat colours
     (each asset's `flat`, else a fixed list), the first plain tile as the ground, each family's
     terrain over it through the scheme's own geometry and band (a road for path schemes, a blob
     for the others), objects and figures at their planned sizes on free ground; a coverage map
     per family through `coverageTerrain`, sized so the first try places every variant
     (blob47-round: 25x19 tiles for its 176).

134. **The dashboard** (§7.3, §8.3). *Reading:* a second tab of the watch view, not a separate
     page: cards by set, coloured by status, with failing checks and what each needs next. A
     person's two controls are tape commands (`mark approved`, `mark rejected "…"`); filters and
     opening an asset log nothing. Thumbnails are each asset's `preview.png`.

135. **The `plan` tool** ("returns the same as text"). *Reading:* also the way to write a manifest
     (validated) and to draw the templates, so the tool count stays at ten; Claude Code can
     equally write `manifest.json` with its own file tools.

136. **`review` of a set, with a brief.** *Reading:* `review(set=)` takes a manifest set's drawn
     assets and adds `brief.md` (the theme and each piece's description and planned size), so
     the reviewer can say whether a piece reads as what it is meant to be. The text is the
     agent's; the skill tells it to keep method names out, and the test holds the bundle to it.

137. **The skill, "installable by a documented command".** *Reading:* `skill/` in the repo
     (`SKILL.md` with the session routine, house rules, workflows and the blind-review hand-off;
     `manifest.md`), installed by `pixelclaw skill install` into `~/.claude/skills/pixelclaw`
     (`--project <dir>` or `--dest <dir>` elsewhere) with `docs/commands.md` beside it; the
     bundle carries a copy.

138. **`jaggies` on shading inside a shape.** The checks read every colour's contours, so a round
     form's stepped shading bands (which the blind reviewer asked for, two to three pixels deep)
     count as doubled L-corners. *Reading:* allowed per asset in the style guide with the reason
     (the urns: 2), as G8 did for the trees' leaf clusters. A reader may prefer `jaggies` to skip
     boundaries between steps of one ramp on sprites.

139. **"Claude completes three end to end (drawn, checked, reviewed, exported)".** *Reading:*
     the ladder puts a person's approval before the export (§7.3 step 7), so the stand-in's
     headless browser approves them in the dashboard. The blind review was run once by a real
     fresh-context agent on the bundle (copied to a neutral folder); the stand-in replays its
     report (`examples/kiln-hollow/findings.md`) instead of calling a model.

140. **The demo's theme.** *Reading:* an original one, *Kiln Hollow* (a potters' hamlet in a clay
     valley), with an original 29-colour palette; it lives beside the mossy-ruins example as a
     second project, `examples/kiln-hollow.pclaw`, whose tapes carry the stand-in run's times.

## G11

141. **Where an underlay lives** (§6 "saved as a blob and placed on a reference layer"). *Reading:*
     the image is a blob (`blobs/<sha256>.png`); the layer is a reference layer whose cels stay
     empty, carrying the blob's hash, its size and the document rectangle it is stretched over
     (state only when present, so old hashes are unchanged). Views compose it under transparent
     pixels (faded like reference pixels). The tape line holds the hash, the placement and where
     the image came from (`from=`, or `prompt= provider= model= quality= cost=`), never pixels;
     the art, checks and exports never see it.

142. **Generate and import in the tape** (core is deterministic and calls no network). *Reading:*
     `underlay generate` and `underlay import` are resolved by the server (MCP `run`, the watch
     view's command line, `pixelclaw run`) before the batch: the provider is called or the file
     read, the blob saved, and the line rewritten as `underlay <layer> blob=…`. Core refuses the
     two forms with a message. If resolving fails, nothing is applied. Each such command must be
     on a line of its own.

143. **The OpenAI provider** (§19: key from the environment, a cost cap and a cost log per
     call). *Reading:* `OPENAI_API_KEY`; with a layout the Images API's edit endpoint (the layout
     stretched to the request size as the image), else generations; default `gpt-image-1.5`,
     `medium`, the size of 1024x1024, 1536x1024 and 1024x1536 nearest the document's shape. The
     cap is checked against an estimate from a price table before the call (default $0.25;
     `cap=`, `PIXELCLAW_UNDERLAY_CAP`, project.json `underlay.cap`); a model without a price is
     refused rather than run uncapped. The log is `logs/underlay-costs.jsonl` in the project, one
     line per call, refused or made. Provider errors are scrubbed of the key. The price table
     holds the per-image prices published for gpt-image-1.5, gpt-image-1 and gpt-image-1-mini as
     far as the builder could find them (not verified against OpenAI's page); project.json
     `underlay.prices` overrides it.

144. **The fake provider and the demo's mockup** (§19: "an original image the builder makes
     itself"). *Reading:* one function draws both: the layout resampled to the art grid, each art
     pixel the nearest palette colour moved a ramp step lighter or darker in patches (seeded by
     the prompt), enlarged with a sub-pixel offset, blurred 3x3, with noise. The demo's mockup
     (`examples/kiln-hollow/yard-mockup.png`, 768x512, checked in) was made with it by
     `make-yard-mockup.ts` and is brought in with `underlay import`; `provider=fake` is for tests.

145. **"The ported snap"** (the pilot's `snap.py`, which the builder cannot read). *Reading:*
     written from §6's description: grid pitch and offset per axis from the edge profile (its
     strongest period within ±15 % of the pitch the underlay's placement implies, its phase for
     the offset; without a hint, the longest strong period); each block's colour the median of
     its middle half; **block R²** = the share of the image's colour variance the blocks explain;
     **material match** = the share of blocks whose colour is nearest the mean colour of their own
     layout colour's blocks (a nearest-centroid test, so a generator's restyled colours still
     match); thresholds 0.8 and 0.85 from §6; quantised with the import's colour distance. The
     result rows go into the line (`snap … << rows >>`), so replay never needs the image. A draft
     layer is new (`into=`, default `draft`), on top.

146. **"Cleaned into tiles"**. *Reading:* tiles are cut from the snapped scene with a new form of
     `import` (`asset= region= [layer=]`, the pixels written into the line) and cleaned with
     ordinary commands until every check passes; the demo's cleaning is `clean orphans size=2`
     plus coordinate fixes of the repetition check's stripe. The scene sheet stays as a working
     document (its draft turned into a reference layer; its coverage turned off in the style
     guide with the reason).

147. **The glyph strip format** (§4.6 "separator columns marked by the top-left pixel's colour").
     *Reading:* one row as tall as a cell; a separator column before the first glyph, between
     glyphs and after the last, every pixel of it the separator colour (default `#ff0000`, §7.4),
     which is the top-left pixel's; each glyph its advance wide from its cell's left edge;
     transparent elsewhere; no glyph pixel may be the separator colour. The characters go beside
     it in `{asset}.txt`. This is the image-font layout LÖVE reads; the line-height rule is the
     font check's `maxLine` (and the profile's `fonts.maxLine`, noted at export).

148. **Glyph sheets** (§4.6 "a grid of cells, one per code point, with baseline and line
     height"). *Reading:* kind `font`; `new font <name> <W>x<H> chars=…` (the size is the cell);
     `glyph <c> << rows >>` draws a cell; advances are the ink width unless set (`advance=`), a
     space half a cell; `baseline` (the cell row glyphs stand on), `line` and `spacing` in the
     state. Letters and digits are written bare, other characters as `U+XXXX`. A TTF via an
     outline tracer is "later" in §4.6 and not built.

149. **Font checks** (§4.6: cap height, x-height, advance widths, the line height against a
     limit). *Reading:* the `font` check: one cap height (A-Z but Q, from the baseline), one
     x-height (lowercase letters without ascenders), letters and digits standing on the baseline
     (descenders exempt), every non-space glyph drawn, nothing drawn past its advance, and the
     line height no less than the glyphs' rows and within `maxLine`. Sprite checks that read
     letters as defects skip fonts.

150. **Icon export modes** (§4.5). *Reading:* `icon mode=tone|full|channel` on an icon (default:
     tone when the palette has roles, else full). Tone art is role art written through the
     profile's role colours; full and channel art are written exactly as drawn (roles are not
     encoded); the palette check holds each mode (tone: roles only; full: no roles; channel: every
     channel 0 or 255). The mode is a record column and a snippet variable.

151. **The icon-set checks** (§4.5: stroke weight, bounding-box fill, optical centre; "extending
     consistency"). *Reading:* stroke weight = the median over drawn pixels of the shorter drawn
     run through it (across and down), ± 1 px of the set's median; box fill = the drawn box's
     share of the canvas, ± 0.2; optical centre = the drawn pixels' centre of mass within 1.5 px
     of the canvas centre (held even without a set). "Legibility at 1x on the HUD background" is
     left to `readability` (its ground is the style guide's). Within a manifest set only like is
     compared with like (ground tiles, figures, icons): the HUD set mixes icons and a font.

152. **`jaggies` and shading** (§19). *Reading:* a doubled corner is shading when the pixel is not
     an outline colour, touches no transparency across its sides, and its inner corner is the next
     or previous step of the same ramp (or the outline the band runs along, with a ramp neighbour
     beside it); a thin one-colour run is shading when every other-coloured neighbour is a
     neighbouring step of its ramp (outline pixels allowed). Outlines and lines on anything else
     are judged as before. The urns' allowance is gone.
