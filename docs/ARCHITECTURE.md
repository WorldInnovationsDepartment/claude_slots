# Claude Slots — Architecture

A Claude Code plugin that replaces the spinner ("Working…", "Thinking…") with an animated ASCII slot machine.

- The lever is pulled when the user submits a message.
- The reels spin for as long as the model is working.
- When the model finishes, the reels stop, a combo is revealed, and a combo-specific animation plays.

Target: Claude Code **2.1.263** (verified). Everything below is grounded in the generated plugin API
(`/plugin-types` → `claude-code.d.ts`) and live pseudo-terminal tests, not guesses.

## 1. What Claude Code actually exposes (verified)

| Surface | Verified behaviour | Used for |
|---|---|---|
| **Function hooks** (early access) — a JS module named in `hooks/hooks.json` `"modules"` exporting `register(on, options)` | Enabled by env `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` (or GrowthBook flag). `ui.render` hook can replace built-in components, including **`Spinner`** (props `{word, message, mode}`) and **`TurnDuration`** (props `{word, durationMs}`, the "Baked for 3s" line closing a turn). Redraw via `$.ui.invalidate("ui.render")`, floor 100 ms (≤10 fps). Timers `$.clock.every/after`. Events `prompt.submit`, `turn.start`, `turn.step`, `turn.complete {reason: answer/aborted/refusal/error, durationMs}`. Persistent KV `$.store`. Optional `$.audio.play`, `$.ui.toast`. Terminal-only for Spinner/TurnDuration. | **Tier 1** — the real spinner replacement, 10 fps |
| **statusLine** (stable, documented) | Multi-line ANSI (truecolor OK), re-run on events + `refreshInterval` (hard floor 1 s). Receives JSON on stdin (session_id, model, cost, context_window, …) and env `COLUMNS`/`LINES`. Plugins **cannot** set it; the user's settings must point at our script. | **Tier 2** — fallback machine at 1 fps |
| **Classic command hooks** (`hooks/hooks.json` `"hooks"`) | `UserPromptSubmit`, `MessageDisplay`, `Stop`, `SessionStart`, `SessionEnd` fire with full stdin JSON; `async: true` keeps them non-blocking; env `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA` set. | Tier 2 state machine driver |
| `spinnerVerbs` / `spinnerTipsEnabled` settings | Verb sampled **once per turn**, never animates. | Tier 2 cosmetics only ("Pulling the lever…") |

Not possible: plugins setting `statusLine`/`spinnerVerbs` themselves; drawing to `/dev/tty` (fights the renderer).

## 2. Two tiers, one engine

```
                     ┌──────────────────────────────┐
                     │  lib/  (pure ESM, no Node, no $) │
                     │  symbols · rng · economy         │
                     │  machine (state → Frame)         │
                     │  art (chassis, lever, outcomes)  │
                     │  render-tree · render-ansi       │
                     └───────────┬──────────┬───────────┘
                                 │          │
     Tier 1 (function hooks) ────┘          └──── Tier 2 (statusLine + command hooks)
     hooks/slots.js                              bin/claude-slots-hook.js   (writes state file)
     ui.render Spinner / TurnDuration            bin/claude-slots-statusline.js (renders frame @1fps)
     10 fps via $.clock.every + invalidate       spinnerVerbs replaced via /claude-slots:setup
```

The **Frame** model is the contract between engine and renderers:

```js
// lib/frame.js
// A Frame is rectangular: every line has the same display width.
Frame = { width: number, lines: Span[][] }
Span  = { text: string, color?: string /* '#rrggbb' */, bold?: boolean, dim?: boolean,
          inverse?: boolean, bg?: string /* '#rrggbb' */ }
```

- `render-tree.js`: Frame → `{type:'Box', props:{flexDirection:'column'}, children:[{type:'Text', children:[...spans as nested Text]}]}` using **only** allow-listed props (`color`, `backgroundColor`, `bold`, `dimColor`, `inverse`).
- `render-ansi.js`: Frame → string with `\x1b[38;2;r;g;bm` (or 256-color fallback when `COLORTERM` lacks truecolor), reset per span, one `\n` per line, no trailing spaces trimmed (the statusline trims each line — so never rely on leading/trailing spaces for alignment; use a visible chassis border on both sides).

## 3. Machine state machine (`lib/machine.js`)

Pure and time-driven so both tiers compute the same frame from `(state, nowMs)`:

```
IDLE ──pullLever(now)──▶ LEVER (0–800 ms) ──▶ SPINUP (–1200 ms) ──▶ SPINNING (until stop)
SPINNING ──stop(now, reason)──▶ STOPPING (reel 1 locks +0, reel 2 +300, reel 3 +600 ms;
                                           near-miss adds a 1-frame overshoot on reel 3)
STOPPING ──▶ REVEAL (200 ms) ──▶ OUTCOME (1.5–4 s, per outcome class) ──▶ RESULT (static)
reason 'aborted' ──▶ JAM (reels brake, "INTERRUPTED", credit refunded) ──▶ RESULT
reason 'error'   ──▶ MALFUNCTION ──▶ RESULT
```

- The **outcome is rolled at lever pull** (`rng.roll(seed)`) — outcome-first: pick class by probability
  table, resolve payline symbols, fill non-payline rows from each reel's canonical circular strip.
  Spinning shows pseudo-random strip positions; STOPPING lands each reel on its target stop.
- `frame(state, now, {size:'compact'|'standard'|'grand', columns, info:{elapsedMs, tokens, mode, credits, lastWin}})`
  returns a Frame. Size auto-selects from `columns` (≥ 90 → grand if enabled, ≥ 62 → standard, else compact).
- Economy: start 100 credits, 1 per spin, payouts per class, never blocks the user; at 0 credits spins are
  "ON THE HOUSE". Stats: spins, wins by class, jackpots, best streak.

Visual/art details (symbols, strips, paytable, probabilities, every storyboard, colors, exact chassis
frames): **`docs/ART-SPEC.md`** — transcribe it literally.

## 4. Tier 1 — function-hooks module (`hooks/slots.js`)

Registered in `hooks/hooks.json` as `"modules": ["./slots.js"]`. Rules the static scanner enforces (module is
refused otherwise): `register` is a same-file exported function; the identifiers bound to `$`, `on`, `next`
may only be used as `$.noun.method(...)` or passed whole to a top-level function **in the same file**;
never stored, spread, exported, destructured, shadowed, or passed to an imported function. Ordinary data is
unrestricted. Keep `$`-touching code in `slots.js`; everything else lives in `lib/`.

Event wiring:

| Event | Action |
|---|---|
| `session.start` | load `credits`/`stats` from `$.store`; write `tier1.sessions[sessionId]=now` marker (Tier 2 reads it to avoid double accounting); set machine IDLE |
| `prompt.submit` | `const result = await next(e)` FIRST, then only if `!result.drop`: `machine.pullLever(now, seed)`; start ticker `$.clock.every(100, tick)`; `return result` (a downstream hook can legitimately stop the turn with `{drop}`, in which case `turn.start`/`turn.complete` never fire — pulling the lever unconditionally beforehand would wedge the machine in SPINNING forever with no time cap) |
| `turn.start` | remember `turnId` |
| `turn.step` | optional: brief sparkle pulse per tool use |
| `ui.render {component:'Spinner'}` | `return renderTree(machine.frame(state, now, {columns: e.viewport?.columns, mode: e.props.mode, ...}))` — includes info strip: elapsed, mode label, credits, "esc to interrupt" |
| `turn.complete` | `machine.stop(now, e.reason)`; queue this spin's result for the next unbound `TurnDuration`; apply payout, persist to `$.store`; keep ticker alive until OUTCOME ends (+~4 s) then cancel; jackpot → `$.ui.toast`; `return next(e)` |
| `ui.render {component:'TurnDuration'}` | bind `e.requestId` → pending spin (match `e.props.durationMs` to `turn.complete.durationMs`, else FIFO); while animating return the full machine frame (STOPPING→REVEAL→OUTCOME), afterwards the compact 1–2 line **result line** (stays in the transcript). Unbound instance → `return next(e)` |
| `ui.render {component:'AbovePrompt'}` | optional idle machine (option `idle: off|compact|full`, default `compact`): attract mode + credits + last result while idle; `return next(e)` when a survey holds the band |

Options (`plugin.json` `userConfig` → `register(on, options)`): `size` (auto|compact|standard|grand), `idle`,
`theme` (classic|emoji), `sound` (off|on — uses `$.audio.play` with bundled `fx/*.wav`, default off),
`startCredits`.

Live-measured facts the module must respect (spike `fh2-plugin`, 5 pty runs, default + fullscreen TUI):

- `Spinner` `requestId` **equals the session id**; `TurnDuration` `requestId` is a fresh per-mount id every
  turn — key inter-turn state by `turnId`, bind a TurnDuration instance to its spin by `durationMs` (exact
  match to `turn.complete.durationMs`) with FIFO fallback.
- **`TurnDuration` never renders for an aborted turn** (Esc). The JAM/"INTERRUPTED" animation therefore plays
  in the `AbovePrompt` band (and, when `idle: off`, as a one-line `$.ui.status` for ~3 s); credits refunded.
- Redraw cadence measured 97–106 ms per tick (≈9.8 fps). TurnDuration keeps re-rendering on every
  `invalidate` after the turn — the module **must cancel its own ticker** when the outcome animation ends.
- All tested props are accepted: hex `#rrggbb` and `rgb()` pass through as truecolor, `ansi256(n)` stays
  256-color, `backgroundColor`, `bold`, `inverse`, `dimColor` (renders as gray `#999999`, not SGR faint),
  `borderStyle:'round'`, `padding`, `marginLeft`. Named colors (`magenta`) and theme keys (`claude`) resolve
  through the active theme — **always use hex** for the machine's palette. Because a `dim` span always
  renders as flat gray regardless of its own hue, `lib/symbols.js`'s `abortedText`/`errorText` roles
  deliberately drop `dim` (unlike ART-SPEC §9's literal table) so ERROR/ABORTED stay visually distinct
  instead of collapsing into the same generic gray — see ART-SPEC.md §9's "Implementation note".
- Spinner `mode` values seen: `responding`, `thinking`, `tool-input`, `tool-use`.
- `AbovePrompt.maxRows` is 40 in default TUI but **13 in fullscreen** — the idle machine must fit `maxRows`
  (compact 2-line form when `maxRows < 12`).
- Hook latency 0.4–12 ms per render; first call ~60 ms (worker warm-up).
- `claude plugin validate` performs the static `$`-flow analysis and prints the hooked events and `$` calls.

### 4.1 Fixed: stale transcript digits inside the chassis (fullscreen)

**Symptom (live pty, `"tui":"fullscreen"`, Tier 1, a fast-streaming model):** a pyte reconstruction of the
real terminal screen occasionally showed the model's own streamed text (e.g. counting output) persisting
*inside* the chassis's supposedly-blank interior columns, e.g. `║ 385      ┌─────┐ ┌─────┐ ┌─────┐    ●   ║`
— the digits `385`/`386`/`387`/`388` sitting where the reel bay's left padding should be.

**Root cause, confirmed at the byte level (not a pyte artifact):** the `Spinner`/`AbovePrompt` chassis
renders *inline* in the same scrolling transcript region the model's text streams into (both live inside one
`ESC[2;31r` … `ESC[…S` scroll region — confirmed via a raw capture: `ESC[H ESC[2;31r ESC[6S ESC[r ESC[H` before
each batch of new transcript lines). Every interior chassis line was built by `frame.js`'s `compose()` with
the *default* fill style — plain, unstyled space characters for the gaps between reel boxes/marquee bulbs/info
fields. Claude Code's Ink-based renderer treats a run of plain unstyled whitespace as safe to skip with a
cursor-forward/CHA jump (`ESC[nG`) instead of actually emitting space bytes — confirmed by grepping the raw
capture for the `┌─────┐` sequence: `\x1b[12G` `┌─────┐` `\x1b[20G` `┌─────┐` `\x1b[28G` `┌─────┐` `\x1b[39G` `●`, with
**no** `ESC[nX` (erase-character), `ESC[K` (erase-in-line), or literal space bytes between the jumps. That
optimization is only safe if the destination cells are already correctly blank; when the chassis lands on a
transcript row that a moment earlier held streamed digits, those digits are never overwritten — because
nothing was ever painted "over" them, only jumped past. Confirmed real (not a pyte compatibility gap): pyte
0.8.2 correctly implements `ECH` (`Screen.erase_characters`), `DECSTBM` (`Screen.set_margins`), `CHA`, and
`CSI S`/`T` (scroll) — see `pyte/streams.py`'s `csi` dispatch table — so pyte's reconstruction of the raw
bytes is exactly what a real terminal renders. The artifact also reproduced identically when reconstructing
the *entire* captured byte stream sequentially (no wall-clock/chunk sampling involved) and persisted to the
end of the capture, ruling out a synchronized-output (`ESC[?2026h/l`) timing quirk.

**Control experiment:** the same prompt run in fullscreen *without* the plugin (native spinner/TurnDuration,
`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` unset) never showed the artifact — the native spinner/TurnDuration lines
are simple, tightly-packed single-style runs with no wide internal gaps, so Ink never has an unstyled
whitespace run to skip in the first place. This is specific to our chassis's box-with-internal-gaps layout,
not a general Claude Code bug we're merely exposing.

Separately, the default (non-fullscreen) TUI's *ANSI-stripped* capture showing collapsed spacing
(`║┌─────┐┌─────┐┌─────┐●║`) is unrelated and **is** a tooling artifact, confirmed by design: `scripts`/
`verify/strip_ansi.py`-style naive stripping removes every `ESC[...]` sequence — including plain cursor
movement like `ESC[1B` (next row) and `ESC[nG` (column jump) — without reconstructing what those movements
mean, so unrelated rows' (or unrelated columns') printable characters end up concatenated with zero
separator. A full terminal emulation (pyte) does not exhibit this; only a regex-based stripper does.

**Fix (`lib/art.js`, `lib/art-storyboards.js`):** every `compose()` call that builds a chassis interior line
(`buildBoxFrame`'s marquee/reel-row/info-strip lines, and `art-storyboards.js`'s `compactLine`) now passes an
explicit `fillStyle: { bg: COLORS.background.hex }` (`#0E0E12`, `lib/symbols.js`'s already-specified-but-
previously-unused §9 "dark ground" role) instead of the default unstyled fill. `resultLine`'s trailing
width-pad span gets the same treatment. This isn't cosmetic-only: giving every interior cell an explicit
background forces the renderer to actually paint it on each redraw (verified live — the fixed capture's raw
bytes show `ESC[48;2;14;14;18m` + literal space bytes + `ESC[49m` where the old capture showed a bare
`ESC[nG` jump), so any stale content left by a transcript scroll landing on the same row gets overwritten
instead of skipped. Re-verified live post-fix with the same repro (haiku, `"Count from 1 to 60/400..."`,
fullscreen, Tier 1): no stray transcript characters inside the chassis across the full capture (checked both
the final reconstructed screen and every intermediate terminal state, chunk by chunk). `node --test` (102/102)
and `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin validate <plugin.json>` both stay green.

## 5. Tier 2 — statusLine fallback

Active when function hooks are not enabled. Everything is driven by wall-clock time from a per-session state
file `${CLAUDE_PLUGIN_DATA}/sessions/<session_id>.json`:

- `bin/claude-slots-hook.js` (command hook, `async: true`, exit 0, silent): `UserPromptSubmit` → pullLever +
  roll outcome; `MessageDisplay`/`PostToolUse` → touch activity; `Stop` → stop + payout; `SessionStart` →
  init + prune stale files; `SessionEnd` → delete. Skips accounting when the Tier 1 marker names this session.
- `bin/claude-slots-statusline.js`: reads stdin JSON + state file → `renderAnsi(machine.frame(state, Date.now(), …))`.
  If a previous user statusLine command was saved by setup, runs it first and prints its output as line 1
  (preserves the user's existing status line). Respects `COLUMNS`. Must finish in < 50 ms.
- `/claude-slots:setup` (slash command) runs `bin/claude-slots-setup.js`: backs up `~/.claude/settings.json`,
  saves the previous `statusLine`/`spinnerVerbs` into `${CLAUDE_PLUGIN_DATA}/config.json`, then sets
  `statusLine {type:'command', command:'node <root>/bin/claude-slots-statusline.js', refreshInterval:1}`,
  `spinnerVerbs {mode:'replace', verbs:[…slot verbs]}`, `spinnerTipsEnabled:false`. Prints how to enable Tier 1
  (`export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`). `/claude-slots:teardown` restores everything.

## 6. Repository layout

```
.claude-plugin/plugin.json        name "claude-slots" (+ marketplace.json for local install)
hooks/hooks.json                  {"modules":["./slots.js"], "hooks":{...tier-2 command hooks...}}
hooks/slots.js                    Tier 1 module (only file that touches $)
lib/*.js                          engine (ESM, browser/Bun/Node-safe, zero deps)
bin/*.js                          Tier 2 scripts, setup/teardown, demo (Node ≥ 18, ESM)
commands/*.md                     /claude-slots:setup, :teardown, :stats, :demo
fx/*.wav                          optional sounds (tiny, generated)
tests/*.test.js                   node:test — rng, rectangularity, renderers, scanner-compat
scripts/dev/pty-smoke.py          live pseudo-terminal smoke test for both tiers
docs/ARCHITECTURE.md, docs/ART-SPEC.md, README.md
```

## 7. Verification gates

1. `node --test` green: probabilities sum to 1 and match within tolerance over 100k rolls; every frame for
   every (size × phase × outcome × 12 time samples) is rectangular and ≤ width budget; tree renderer emits
   only allow-listed props; ANSI renderer round-trips to the same visible text.
2. `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin validate .` passes (scanner + manifest).
3. Live pty run, Tier 1: machine replaces the spinner during a turn; result line closes the turn; Esc → JAM.
4. Live pty run, Tier 2 (flag off, `--settings` pointing statusLine at our script): machine renders in the
   status line at 1 fps; hooks drive lever/stop; user's previous status line preserved as line 1.
5. Adversarial review: API compliance, scanner compliance, narrow terminals (40 cols), reduced-motion
   setting, `/clear`, concurrent sessions, budget limits (toasts, store size).
