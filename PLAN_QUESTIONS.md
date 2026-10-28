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

13. **Running TypeScript.** The plan doesn't say how the CLI is built.
    *Reading:* no build step for now. Node ≥ 22.18 runs the `.ts` sources directly, and imports use
    `.ts` extensions (`erasableSyntaxOnly`). Publishing to npm (`npx pixelclaw`) will need a build
    step, because Node does not strip types inside `node_modules`.
