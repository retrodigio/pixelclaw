# Demo G15: the worker, requests and maps

The second acceptance run (plan §26: a fresh agent and the worker made a whole 48 px set from a
theme) showed where the tool left the worker and the maps without help. G15 fences the worker in,
lets an agent or a script file requests, and fixes the map problems the run found.

| Item | What changed | Where in the demo |
|---|---|---|
| 1 | **The worker's sandbox and discipline**: no built-in Claude Code tool at all (no shell, no files, no web, no subagents), only PixelClaw's, over a connection fenced to the project; the command reference in its system prompt; `work done` refused while a check fails; a stall watchdog; a spend ledger, so the cap is a total | part 2: the stand-in model's done refused while the outline check fails, then finished; its `Bash` and `Read` refused; the ledger; a setting that would hand it a shell refused |
| 2 | **Requests from the CLI and MCP**: `pixelclaw request draw\|change\|add`, `reply`, `cancel`; MCP `request` | part 1 |
| 3 | **Lattice**: ΔE, not lightness alone; marks matched by their centres and weighed by their share of the cell's marking | part 3: the meadow's lattice before (47%) and after (26%); the numbers for every example map are in PROGRESS.md |
| 4 | **Terrain on maps**: past the map's edge a cell counts as its own (no band along the border; `border=` to choose); a terrain's inside takes `mix=`; families follow the tiles their textures came from; `blob47-round` built in | part 3 |
| 5 | **Mixes**: a two-tile mix is not a strict checkerboard | not in the log (`core/test/g15.test.ts`) |
| 6 | **Smaller**: `plan \| head` ends quietly; `view render` takes a region and `tile3x3` a scale on tiles too; one region format; the orphans 2 px rule documented | not in the log (`cli/test/g15.test.ts`) |

## Run it

```sh
pnpm build
node examples/demo-g15-agent.ts      # out/demo-g15.pclaw
node scripts/screenshots-g15.ts      # docs/screenshots/g15-*.png from it
```

The worker part runs **the real Claude Code** (`claude` on the PATH) with the worker's own command
line, but its model is a stand-in: a small local server that answers the model API
(`server/test/fake-model-api.ts`), with a throwaway `HOME` and a dummy key, so no account is used and
nothing is spent (the ledger's $0.002 is what Claude Code computes from the stand-in's made-up token
counts). The stand-in plays a careless agent: it draws each request without an outline, tries to
finish, outlines it when `done` is refused, finishes, and then asks for a shell and a file. Without
`claude` installed, the tests' fake `claude` (in its `fix` mode) stands in for both.

## The log

```
G15: the worker, requests and maps. Project: out/demo-g15.pclaw

1. Requests filed from the CLI, checked as the dashboard checks them
    $ pixelclaw request out/demo-g15.pclaw draw urn --note "squat, with a lip" --by human:chris
      r1 draw urn: "squat, with a lip" (from human:chris at 2026-10-29T23:27:09Z; open)
    $ pixelclaw request out/demo-g15.pclaw add lantern --kind sprite --size 16x16 --set props --description "an iron lantern on a hook" --height 12 --by human:chris
      r2 new asset lantern (from human:chris at 2026-10-29T23:27:10Z; open)
    $ pixelclaw request out/demo-g15.pclaw draw well --by human:chris
      error: 'well' is not planned in manifest.json
    $ pixelclaw request out/demo-g15.pclaw
      r1 draw urn: "squat, with a lip" (from human:chris at 2026-10-29T23:27:09Z; open)
      r2 new asset lantern (from human:chris at 2026-10-29T23:27:10Z; open)

2. The worker (`pixelclaw work`), with a stand-in model
    (the real Claude Code, its model a local stand-in; worker: { "enabled": true, "cap": 2 })
    $ pixelclaw work out/demo-g15.pclaw
      pixelclaw: worker stopped: the queue is empty
    logs/worker.log:
      run started by cli: cap $2.00 ($0.00 spent before), at most 10 sessions, stall 10 min, command claude
      session 1: budget $2.00; 2 requests waiting
      session started (claude-opus-5-5); tools: 12 PixelClaw, nothing else
      → work {}
      → run {"asset":"urn","commands":"new sprite urn\nellipse 3,3 10x10 c=stone3 fill"}
      → work {"action":"done","text":"drew urn"}
      ← error: "error: r1 is not done: urn fails 2 checks:\n  outline 0 (limit ≥ 0.85): 0 of 24 silhouette edge px are ink; 24 gaps\n  readability: edge contrast: no ground tile to judge against;…
      → run {"asset":"urn","commands":"outline c=ink"}
      → work {"action":"done","text":"drew urn"}
      → work {}
      → run {"asset":"lantern","commands":"new sprite lantern\nellipse 4,2 8x12 c=stone3 fill"}
      → work {"action":"done","text":"drew lantern"}
      ← error: "error: r2 is not done: lantern fails 2 checks:\n  outline 0 (limit ≥ 0.85): 0 of 24 silhouette edge px are ink; 24 gaps\n  readability: edge contrast: no ground tile to judge agai…
      → run {"asset":"lantern","commands":"outline c=ink"}
      → work {"action":"done","text":"drew lantern"}
      → work {}
      → Bash {"command":"find / -maxdepth 1","description":"look around"}
      ← error: "<tool_use_error>Error: No such tool available: Bash. Bash is disabled for this session, in subagents as well as here.</tool_use_error>"
      → Read {"file_path":"<repo>/package.json"}
      ← error: "<tool_use_error>Error: No such tool available: Read. Read is disabled for this session, in subagents as well as here.</tool_use_error>"
      session 1: $0.00; $0.00 of $2.00 spent
      run stopped: the queue is empty
    worker-spend.jsonl:
      {"at":"2026-10-29T23:27:15Z","run":"2026-10-29T23:27:14Z","session":1,"cost":0.00196}
    $ pixelclaw request out/demo-g15.pclaw
      no open requests
    $ pixelclaw check out/demo-g15.pclaw urn lantern --checks outline
      urn: all 1 checks pass
        ✓  outline     1      ≥ 0.85  28 of 28 silhouette edge px are ink
      lantern: all 1 checks pass
        ✓  outline     1      ≥ 0.85  28 of 28 silhouette edge px are ink
    $ pixelclaw work out/demo-g15.pclaw
      pixelclaw: serving <repo>/out/demo-g15.pclaw
      pixelclaw: watch at http://127.0.0.1:<port>/?token=…
      error: worker.args may hold only --model, --fallback-model, --effort with a value (not '--allowedTools'): the worker's tools and reach are fixed (docs/worker.md)

3. A terrain map through MCP: a meadow running off every edge round a pond
   With G14's rules (`border=not`, the family's own inside): a bank runs round the map's edge, and one meadow tile fills the land
    ✓  seam        0.32   ≤ 1     the tile grid over the whole ground: jump x -0.25 y 0, line x 0.32 y 0.24
    ✗  repetition  run 14 · 16/16 run ≤ 4, ≤ 10/16 longest straight run of one edge tile: 14 (bank.esw_se_sw ×14 at 1,0 14x1; bank.new_ne_nw ×14 at 1,9 14x1; bank.nes_ne_se ×8 at 0,1 1x8; bank.nsw_sw_nw ×8 at 15,1 1x8); most of one textured tile in a 4x4 window: 16 of 16 (hot spots: bank.nesw_ne_se_sw_nw on 84 cells); texture variants (an asset with variant of=<base>) break the pattern: the map picks among them cell by cell
    ✗  lattice     47%    ≤ 30%   a mark at 0,7 13x11 of the cell (bank ×86) comes back on the tile pitch: 86 of the 86 cells of bank's ground show it at the same spot (as 47% of their marking, on average); give bank texture variants that move or leave out the mark (variant of=bank) and fill with a mix of them (tiles <layer> fill mix=bank:1,<variant>:2,...; a terrain's inside: layer set <layer> mix=…), or soften the mark
   G15: past the map's edge the land goes on (border=same, the default now), and the inside is a mix of meadow, its fork and clover
    #5 claude g2  layer set land border=same mix=meadow:1,meadow_b:1,clover:1 variants=named seed=3
    ✓  seam        0.53   ≤ 1     the tile grid over the whole ground: jump x -0.63 y -0.01, line x 0.28 y 0.53
    ✓  repetition  run 2 · 8/16 run ≤ 4, ≤ 10/16 longest straight run of one edge tile: 2; most of one textured tile in a 4x4 window: 8 of 16
    ✓  lattice     26%    ≤ 30%   the mark most often at one spot: at 6,12 13x7 of the cell (clover ×40): 40 of the 40 cells of clover's ground show it at the same spot (as 26% of their marking, on average)
    layer land: terrain of bank, 152 cells; its outside ground fills the rest; inside: mix=meadow:1,meadow_b:1,clover:1 seed=3
   The meadow gains a tuft; the bank, whose inside was copied from it, follows:
    brought up to date: bank (variants that inherit the band, families whose textures came from=meadow)
    #5 claude g2  family texture inside from=meadow frame=1
```

## What it shows

- **Requests from a shell** are checked exactly as the dashboard checks them (`well` is not planned,
  so nothing is written); the person's name is on each, and `request` without a kind lists what is
  open.
- **The worker had only PixelClaw's twelve tools.** Its first log line says so (`tools: 12
  PixelClaw, nothing else`). Asked for `Bash` and `Read`, Claude Code answered that no such tool
  exists. Its connection is fenced too: another project, files outside this one and the image
  provider are refused (`server/test/g15.test.ts` probes each). A setting that would add a tool is
  refused before anything runs.
- **Done means the checks pass.** The stand-in tried to finish the urn and the lantern with no
  outline; the reply named the failing checks, it fixed them, and only then was the request done.
  `check` confirms both.
- **The spend is the project's**, in `worker-spend.jsonl`: the next run starts from it.
- **The border and the inside.** With G14's rules (`border=not`) the bank's band runs round the
  map's edge as if the land stopped there (a run of 14 edge tiles along the top), and the family's
  one inside tile fills the land (16 of 16 in a 4x4 window, and a 47% lattice of its tuft). With
  G15's default the land runs off the map, and `layer set land mix=meadow:2,clover:1` scatters the
  meadow, its fork and clover over the inside: every map check passes.
- **The family follows its tile.** The bank's inside was copied `from=meadow`; when the meadow gains
  a tuft, the server copies it into the bank again (one undo group, by the same author).

![The hollow as G14 drew it: a band along the map's edge, one meadow tile everywhere](../docs/screenshots/g15-hollow-before.png)
![The hollow as G15 draws it: no band along the edge, the inside a mix](../docs/screenshots/g15-hollow-after.png)

![The map editor's terrain tools: border and inside mix](../docs/screenshots/g15-map-terrain-tools.png)

![The dashboard's worker panel: the run's log, and what the worker has spent of the project's cap](../docs/screenshots/g15-worker-log.png)
