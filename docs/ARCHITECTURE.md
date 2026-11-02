# Architecture

Claude Slots is a Claude Code **mod**: a hooks module (`hooks/slots.js`)
that draws the machine in the `AbovePrompt` band, pinned to the
bottom-right of the screen for the whole session, and takes over the
`TurnDuration` site for the one-line result when a turn ends. Everything else is a dependency-free,
time-driven engine in `lib/` and a Remotion project in `art/` that is the
single source of the machine's pixels.

```
prompt.submit ──► pullLever(now, seed) ──► ticker $.clock.every(100ms) ──► $.ui.invalidate('ui.render')
                                                                                  │
ui.render AbovePrompt ◄──────── machine.frame(state, now) ◄── sprite-frame.js ◄───┘
turn.complete ──► stop(now, reason) ──► economy settles ──► $.store.set('slots.economy')
ui.render TurnDuration ──► resultLine()
```

## 1. The mod module (`hooks/slots.js`)

The only file that may touch `$`, `on` and `next`; `claude plugin validate`
runs a static scanner over it. Rules it keeps to:

- `register(on, options)` is the only export.
- `$` is used only as `$.noun.method(...)` inside hook bodies or top-level
  helpers in the same file, or passed whole to such a helper.
- `next(e)` is called inline in the hook that received it; `turn.step` is an
  `async function*` that does `const r = yield* next(e)` and returns `r`.
- Imports are code files only (`lib/*.js`); the sprite sheet is therefore
  imported as `lib/sprites.js`, a generated module twin of `lib/sprites.json`.

Hooks registered:

| Event | What it does |
| --- | --- |
| `session.start` | Resets transient state, loads the persisted economy from `$.store`, invalidates once so the band shows the idle machine. |
| `prompt.submit` | Awaits `next(e)` first; unless the chain dropped the prompt, pulls the lever (seed = session id : turn count : now) and starts the 100 ms ticker. |
| `turn.step` | Streams every chunk through unchanged; timestamps a tool pulse. Ignored for subagent loops (`e.agentId`). |
| `turn.complete` | `machine.stop(now, reason)`, snapshot for TurnDuration, persist, toast on A LIFE, `$.ui.status` refund notice on abort/error (cleared after 3 s), poll until the animation ends and stop the ticker. Ignored for subagent loops. |
| `ui.render AbovePrompt` | Terminal surface only; yields to a survey. Draws `machine.frame` through `renderTree` inside a full-width row Box with `justifyContent: flex-end`, so the sprite sits at the band's right edge; below 40 columns or 10 rows of band it draws the one-line fallback instead. Always on: idle at rest between turns, spinning during one, outcome overlay when it ends. The built-in Spinner is untouched. |
| `ui.render TurnDuration` | Binds the instance to the finished spin by `durationMs` (its `requestId` is fresh per mount) and draws the static result line. |

Platform facts this build relies on (Claude Code 2.1.316):

- `$.clock.now()` resolves a promise; `$.session.turns()` counts prompts.
- `turn.*` events fire for subagent loops too, with `e.agentId` set.
- The ticker is `$.clock.every(100, …)`; `$.ui.invalidate` is budgeted at
  10 redraws/s, which is the sprite's frame rate.
- `TurnDuration` never mounts for an aborted turn, hence the status line.
- The Ink renderer skips unstyled whitespace with cursor jumps, so a cell
  without a colour can show stale transcript text. Every sprite cell is a
  `▀` with both `color` and `backgroundColor` set; the PTY smoke test checks
  the rectangle is fully painted.
- A `Raster` element with `$.ui.blit` (cell grid, up to 120 blits/s) exists
  on the terminal surface. It is a possible future path for the sprite; the
  current build uses plain `Text` spans, which were verified live.

## 2. The engine (`lib/`)

Pure ESM, no dependencies, no Node APIs: the same code runs in the mod's
worker, in `bin/demo.js`, and under `node --test`.

- **`machine.js`**: `createState`, `pullLever(state, now, seed)`,
  `stop(state, now, reason)`, and pure queries of `(state, now)`:
  `phaseAt`, `reelOffsets`, `overlayAt`, `isAnimating`, `frame`,
  `resultLine`, `fallbackLine`. Phases:
  `IDLE → SPINUP → SPINNING → STOPPING → OUTCOME → RESULT`, or
  `SPINNING → JAM | MALFUNCTION → RESULT` on abort/error. Timing constants
  live in `TIMINGS` and are documented in ART-SPEC.md.
- **`sprite-frame.js`**: decodes the sheet once, composes
  cabinet → scrolled reel windows → digits → overlay into a 20 × 40 pixel
  grid, then packs pixel rows 2k/2k+1 into one row of `▀` cells with runs of
  identical (top, bottom) colour pairs coalesced. Mirrors
  `art/src/machine/compose.ts`.
- **`symbols.js`, `rng.js`, `economy.js`**: the tables, the seeded
  outcome-first roll, and the credit rules.
- **`frame.js`**: the rectangular `Frame = { width, lines: Span[][] }`
  contract between the engine and the two renderers.
- **`render-tree.js`** (Ink element tree for the mod) and
  **`render-ansi.js`** (truecolor ANSI with a 256-colour fallback for the
  demo and the PTY harness).
- **`mod-helpers.js`**: option parsing, store merge, the TurnDuration spin
  queue, refund notice text. Pure, so `tests/mod-helpers.test.js` covers the
  module's logic without the scanner constraints.

## 3. The art pipeline (`art/` → `lib/sprites.json`)

`art/` is its own npm project (Remotion 4.0.540, React 19). The machine is
drawn on a 40 × 20 unit grid by pure grid builders
(`cabinet-grid.ts`, `strip-grid.ts`, `digits-grid.ts`, `overlay-grid.ts`,
`compose.ts`) and rendered by `Pixels.tsx` as crisp SVG rectangles at
`scale` px per unit: 1 for the sprite stills, 27 for the video.

`scripts/dev/build-sprites.js` bundles the project once with
`@remotion/bundler`, renders every `Sprite*` still and `Overlay*` sequence
with `@remotion/renderer`, decodes the PNGs with the pure-JS codec in
`scripts/dev/png.js`, quantises each pixel to an **exact** palette index
(any off-palette pixel fails the build), and writes `lib/sprites.json`,
`lib/sprites.js` and `docs/sprites-contact.png`. There is no randomness in
the composition (grain comes from a seeded hash), so two builds are
byte-identical.

## 4. Verification gates

1. `claude plugin validate .` → zero errors.
2. `node --test tests/*.test.js` → sheet geometry/palette/seams/overlays,
   compositor, machine phases and landings, rng distribution, economy,
   renderers, mod helpers.
3. `node scripts/dev/build-sprites.js` twice → identical `lib/sprites.json`.
4. `node bin/demo.js --outcome=<each>` plays through.
5. `scripts/dev/pty-smoke.py --tui default|fullscreen` → the 40 × 10
   rectangle is fully painted while the turn runs, the result line lands
   in the transcript, nothing remains after.
6. Video: frames extracted at every scene start and reel stop, `ffprobe`
   for format and duration, `silencedetect` for audio gaps.
