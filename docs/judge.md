# The judge (optional, experimental)

The code checks (`docs/checks.md`) measure pixels. They cannot say whether a sprite *reads* as a
urn, whether a face is legible, or whether a fix kept the same object. The **judge** asks a model
those questions and shows its answers beside the code checks, as probabilities.

It is **off by default**, advisory when on, and **experimental**: the model it uses
([TypeSafe's Jev](https://docs.typesafe.ai)) treats images as a preview feature, its request format
and accuracy can change, and it is known to be weak at counting.

## Privacy and cost, before you turn it on

- **Images are sent to a third-party API** (`api.typesafe.ai`): the asset's picture, and the
  approved mockup if you set one. Nothing is sent unless a project turns the judge on, and it is
  turned on **per project**, in that project's `project.json`.
- The API key comes **only from the environment** (`TYPESAFE_API_KEY`). It is never written to the
  project, the history, the request log, a view or any tool's output, and the headless worker's
  session does not inherit it.
- Cost is per input token only (output is free). A small asset's picture is a few hundred
  tokens, so a run over a whole asset costs a few thousandths of a cent. Every run prints the tokens
  it used and a rough dollar figure at the published rate ($0.042 per million input tokens).
- Answers that are still current are **not asked again**: a run only asks what the art or the
  questions changed.

## Setup

1. Get a key from TypeSafe and export it where the server or the CLI runs:
   `export TYPESAFE_API_KEY=…`
2. Add a `judge` setting to the project's `project.json`:

   ```json
   "judge": { "provider": "jev", "model": "jev-1.14.0", "gate": false, "mockup": "templates/approved.png" }
   ```

   | field | |
   |---|---|
   | `provider` | `"none"` (the default) or `"jev"` |
   | `model` | the model name (default `jev-1.14.0`; boxes need Jev 1.14) |
   | `gate` | `true`: failing judge answers block `done` like failing checks (default `false`: advisory) |
   | `mockup` | optional: a PNG inside the project that is the approved look; the style question compares with it |

3. Ask: `pixelclaw judge my-art.pclaw [<asset>...] [--questions id,id] [--fresh]`, or the MCP `judge`
   tool. `check` (CLI and MCP) then shows the last answers as a separate **judge** table, and the
   dashboard shows them on each card.

## What it asks

One request per asset per run: all of that asset's questions go together with its picture(s),
each picture once. The picture is the asset at its pixels, enlarged by a whole number with no
smoothing (to about 512 px; the API takes 280–1568 px a side), with transparent areas and any
padding a flat grey. The default questions (all of them are data, see below):

| id | asks | applies to |
|---|---|---|
| `recognisable` | a **choice** over the names (and descriptions) of the assets in its manifest set: which of these is this? A sprite not picked as itself fails; two sprites picked as each other are called out. | sprites, objects, icons |
| `reads.N` | one yes/no per entry of the asset's `"reads"` in `manifest.json` (`"reads": ["a readable face"]`) | any asset with `reads` |
| `seams` | are there visible seams or an obvious repeat on the 3x3 tile view? (no is good) | tiles |
| `map-seams` | the same on the sample map | families, maps |
| `style` | is the style consistent with the approved mockup (given as the example of yes)? | any asset, when `judge.mockup` is set |
| `identity` | is this the same object as the version before the last change? | sprites, objects, icons with an earlier version |
| `stray` | is there a stray blob or loose pixels? When it is a clear yes, a **box** question places it and the box becomes marked pixels. | sprites, objects, icons |

An asset marked `"reference": true` in the manifest is left out of the options and of the
"set" a question compares with.

## Answers, thresholds and "unsure"

Each question has a probability *p* (for a yes/no, the chance of yes). Thresholds are **0.7 for
yes and 0.3 for no** by default; between them the answer is **unsure**, and says so. Unsure
never blocks anything. For a question where *no* is the good answer (seams) the test is turned
round. A model answer that is missing or malformed, a network failure, an HTTP 4xx/5xx and a
missing key are **errors, never answers**: they are shown as errors and nothing about the asset is
recorded.

```
urn: 2 pass, 1 fail (3 asked, 1 from the cache)
  ✓  recognisable   0.91  ≥ 0.70  picked as itself (0.91)
  ?  reads: a rim   0.50  ≥ 0.70  unsure: 0.50 yes
  ✗  stray          0.92  ≤ 0.30  0.92 yes
       marks: 8,4 9,4 10,4 11,4 8,5 11,5 8,6 11,6 8,7 9,7 10,7 11,7
```

`marks` are the outline of the box the model drew, in canvas pixels; `judge` also writes a render
with them circled in magenta. (Boxes on maps and families are kept as fractions only.)

## The questions file

`judge/questions.json` in the project replaces the default set; without it the built-in set above
is used. A broken file is reported and the default set is used.

```json
{
  "format": "pixelclaw-judge-questions",
  "version": 1,
  "thresholds": { "yes": 0.7, "no": 0.3 },
  "questions": [
    { "id": "face", "type": "noul", "kinds": ["sprite"], "assets": ["guard", "reaper"],
      "text": "Does `render` show a face with two eyes?", "yes": 0.8, "locate": "the face" },
    { "id": "readable", "type": "score", "text": "How readable is `render` at its size?",
      "levels": ["unreadable", "readable with effort", "clear"] },
    { "id": "recognisable", "type": "recognisable", "kinds": ["sprite", "object"] },
    { "id": "style", "type": "style" }
  ]
}
```

| field | |
|---|---|
| `id` | letters, digits, `_ - .`, unique |
| `type` | `noul` (yes/no), `choice` (`options` and `want`), `score` (`levels`, low to high; held to the thresholds as a share of the top level), or a built-in: `recognisable`, `reads`, `style`, `identity` |
| `text` | the question (required for noul, choice, score). Placeholders `{name}` `{kind}` `{description}` `{theme}`. Name the picture in backticks: `` `render` `` (default), `` `tile3x3` ``, `` `map` ``, `` `game` ``, `` `before` ``, `` `after` `` |
| `kinds`, `sets`, `assets`, `skip` | which assets it applies to (all empty: every asset); `skip` names are left out |
| `image` | the picture used when the text names none |
| `expect` | `"yes"` (default) or `"no"`: which answer is good |
| `yes`, `no` | thresholds for this question |
| `locate` | what to place (`"the stray blob"`): when the question fails, a box question finds it and marks it |
| `off` | `true` leaves a built-in out |

## Where the answers show

- `pixelclaw judge …` and the MCP `judge` tool ask, and print the table.
- `check` (CLI and MCP) prints the **judge** table of the last answers under the code checks. It
  never calls the API. Answers for art that has changed since are listed as "not asked yet".
- The dashboard card shows an **advisory** (or **gates**) badge with a chip per answer; "unsure" is
  shown as unsure. Requests on a card are on the same card. The MCP tool refreshes the dashboard; after
  `pixelclaw judge` (a separate process) reload the page.
- With `"gate": true`, `done` on a request is refused while a judge question fails, and while
  there is no current answer (run the judge first). Unsure answers do not block.

## What is kept

`.cache/judge/results/<asset>.json` (answers by question, with what they were asked about) and
`.cache/judge/requests.jsonl` (each request exactly as sent, with every picture replaced by its
size and hash, and no key, so a request can be rerun). `.cache/` is never committed.

## Trying it for real

`server/test/judge-live.test.ts` is a smoke test against the real API on one of the repo's own
example assets. It is skipped unless `TYPESAFE_API_KEY` is set, and never runs in CI:

```sh
TYPESAFE_API_KEY=… pnpm vitest run server/test/judge-live.test.ts
```
