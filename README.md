# Claude Slots

A Claude Code plugin that replaces the spinner ("Working…", "Thinking…") with an animated ASCII
slot machine. Pull the lever when you submit a prompt, watch the reels spin while Claude works,
and cash in when the turn completes.

```
╔══════════════ Lucky Prompt ═══════════════╗
║   ● ● ● ● ● ● ● ● ● ● ● ● ● ● ● ● ● ● ●  ║
║  ▐  ✻     BAR     ★  ▌  [ 1.2k tok ]     ║
║   ● ● ● ● ● ● ● ● ● ● ● ● ● ● ● ● ● ● ●  ║
║  CREDITS: 097   LAST WIN: 008            ║
╚═══════════════════════════════════════════╝
```
*(a compact sketch of the idle machine — see `docs/ART-SPEC.md` for the literal, golden frames.)*

## Screenshots

Open `docs/preview.html` in any browser for a live, in-browser preview of the machine (the
unmodified `lib/` engine running client-side — no build step, no network requests, nothing
installed). It has size/outcome/seed/FPS controls, a "play all outcomes" demo, and a scrolling
transcript of past results — the fastest way to see every storyboard without a live Claude Code
session.

_TODO: capture and embed a GIF/asciicast of a live spin (`hooks/slots.js` and
`bin/claude-slots-statusline.js` are both implemented now; only the recording itself is
outstanding)._

## How it works — two tiers, one engine

| Tier | Surface | When it's active | Frame rate |
|---|---|---|---|
| **Tier 1** | Function hooks (`ui.render` replacing `Spinner`/`TurnDuration`/`AbovePrompt`) | `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` | ~10 fps, full animation |
| **Tier 2** | `statusLine` + classic command hooks | Always available, the fallback | 1 fps, still animated |

Both tiers share one pure engine (`lib/`: symbols, RNG, the state machine, chassis art, and the
Frame → tree/ANSI renderers) — see `docs/ARCHITECTURE.md` for the full design and
`docs/ART-SPEC.md` for every symbol, strip, probability, and golden frame. The outcome of a spin
is rolled the instant the lever is pulled; every phase after that (spin-up, spinning, reels
locking one by one, reveal, the outcome-specific animation) is a deterministic function of that
outcome plus elapsed time, so a 10 fps renderer and a 1 fps renderer are just sampling the same
state machine at different rates — they never disagree about what should be on screen.

The lever is pulled on `prompt.submit` / `UserPromptSubmit`. The reels spin for as long as the
model is working. When the turn completes, the reels stop, a combo is revealed, and a
combo-specific animation plays (coin rain for a win, a lever-jam "INTERRUPTED" state if you hit
Esc, credits refunded either way for an aborted or errored turn).

## Install

### Option A — from GitHub (recommended)

This repo doubles as a one-plugin marketplace (`.claude-plugin/marketplace.json`, name
`claude-slots-local`) at
[`WorldInnovationsDepartment/claude_slots`](https://github.com/WorldInnovationsDepartment/claude_slots).
From inside Claude Code:

```
/plugin marketplace add WorldInnovationsDepartment/claude_slots
/plugin install claude-slots@claude-slots-local
```

(the full URL form `/plugin marketplace add https://github.com/WorldInnovationsDepartment/claude_slots`
works too). `/claude-slots:setup`, `/claude-slots:teardown`, `/claude-slots:stats`,
`/claude-slots:demo` become available once the install finishes.

For a non-interactive install (e.g. rolling this out via a shared `settings.json`), add:

```json
{
  "extraKnownMarketplaces": {
    "claude-slots-local": {
      "source": { "source": "github", "repo": "WorldInnovationsDepartment/claude_slots" }
    }
  },
  "enabledPlugins": {
    "claude-slots@claude-slots-local": true
  }
}
```

to `~/.claude/settings.json` (user-wide) or `.claude/settings.json` (project-scoped).

### Option B — point Claude Code straight at a local checkout

```bash
git clone https://github.com/WorldInnovationsDepartment/claude_slots.git
claude --plugin-dir /path/to/claude_slots
```

Everything works immediately: the plugin loads inline, hooks fire, and the same
`/claude-slots:*` commands are all available.

### Option C — as a local marketplace

Same as Option A, but pointed at a local clone instead of GitHub:

```
/plugin marketplace add /path/to/claude_slots
/plugin install claude-slots@claude-slots-local
```

## Enabling Tier 1 (the real animated spinner)

Tier 1 is early-access and gated behind an environment variable:

```bash
export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1
```

Add that to your shell profile (`~/.zshrc` or `~/.bashrc`) and restart Claude Code. With it set,
`hooks/hooks.json`'s `"modules": ["./slots.js"]` loads as a function-hooks module and the machine
replaces the built-in `Spinner`/`TurnDuration`/`AbovePrompt` components directly in the terminal
UI at up to ~10 fps. Without it, the module has zero effect (verified: gating a live run with the
flag unset produces byte-identical output to the built-in spinner) and you're on Tier 2 only.
`node bin/claude-slots-setup.js` also detects and reports which tier is active.

## Setting up Tier 2 (the statusLine fallback)

Tier 2 needs `~/.claude/settings.json`'s `statusLine` pointed at this plugin's renderer. Run:

```
/claude-slots:setup
```

which shells out to `bin/claude-slots-setup.js`. **By default it only prints a dry-run diff and
changes nothing.** Re-run with `--apply` (`/claude-slots:setup --apply`, or
`node bin/claude-slots-setup.js --apply`) to actually install it. Setup:

- backs up your current `~/.claude/settings.json` to `<path>.claude-slots.bak-<ISO timestamp>`,
- saves your previous `statusLine` / `spinnerVerbs` / `spinnerTipsEnabled` into
  `${CLAUDE_PLUGIN_DATA}/config.json` so they can be restored later,
- points `statusLine` at `node <plugin root>/bin/claude-slots-statusline.js` with
  `refreshInterval: 1` (the lowest the host allows),
- replaces `spinnerVerbs` with ten slot-themed phrases ("Pulling the lever", "Spinning the
  reels", "Reels whirring", "Chasing sevens", "Feeling lucky", …), and
- turns off `spinnerTipsEnabled` so the tip line doesn't fight the machine for the same row.

If you had your own `statusLine` command already, Tier 2's renderer runs it first and prints its
output as line 1, so your existing status line is preserved above the machine, not replaced by it.

Undo everything with:

```
/claude-slots:teardown
```

which restores the exact `statusLine` / `spinnerVerbs` / `spinnerTipsEnabled` you had before (or
removes the keys entirely if you never had them) and deletes the saved config. Setup/teardown are
idempotent: running `--apply` twice in a row does not overwrite the *original* saved values with
the plugin's own, and running `--restore` with nothing to restore is a safe no-op.

Useful flags on `bin/claude-slots-setup.js`: `--dry-run` (default), `--apply`, `--restore`,
`--no-statusline`, `--no-verbs`, `--settings-path <path>` (point at a different settings file,
mainly for testing).

## Commands

| Command | Does |
|---|---|
| `/claude-slots:setup [--apply] [--dry-run] [--no-statusline] [--no-verbs]` | Install (or preview installing) the Tier 2 statusLine fallback |
| `/claude-slots:teardown` | Restore your previous `statusLine`/`spinnerVerbs`/`spinnerTipsEnabled` |
| `/claude-slots:stats` | Show credits, spins, wins, and jackpots from whichever tier has data |
| `/claude-slots:demo [outcome] [size]` | Render a one-off spin animation in the transcript, no real turn or credits involved — good for previewing art (`outcome` ∈ jackpot/medallion/triple/double/near-miss/lose, `size` ∈ compact/standard/grand) |

## Options

Configured via Claude Code's plugin `userConfig` (`/plugin` UI, or
`pluginConfigs["claude-slots"].options` in settings). `register(on, options)` in `hooks/slots.js`
receives them as `options.<key>` — **Tier 1 only**. Tier 2's command hooks and `bin/` scripts do
not currently read `userConfig` at all (there is no `CLAUDE_PLUGIN_OPTION_<KEY>` mechanism — Tier 2
always auto-sizes from `COLUMNS`, starts new sessions at the default 100 credits, and uses the
classic theme regardless of what's configured for Tier 1; `idle` and `sound` don't apply to Tier 2
in the first place, since it has no `AbovePrompt` band or `$.audio.play`). If you need Tier 2 to
honor `size`/`startCredits`, that's open follow-up work, not something to expect today.

> Note: `userConfig`'s `options` field (a dropdown of preset values in the config UI) requires
> Claude Code v2.1.271+. This plugin targets the verified baseline, 2.1.263, so every option here
> is a free-text `string`/`number` field with the allowed values documented in its description —
> `claude plugin validate` rejects an `options` array at this version.

| Option | Type | Default | Values |
|---|---|---|---|
| `size` | string | `auto` | `auto` \| `compact` \| `standard` \| `grand` — chassis size; `auto` picks from the terminal's column count (≥90 → grand if enabled, ≥62 → standard, else compact) |
| `idle` | string | `compact` | `off` \| `compact` \| `full` — what the `AbovePrompt` band shows between turns (Tier 1 only) |
| `theme` | string | `classic` | `classic` \| `emoji` — glyph set (`docs/ART-SPEC.md` §14 covers the emoji theme) |
| `sound` | string | `off` | `off` \| `on` — play the bundled `fx/*.wav` clips via `$.audio.play` (Tier 1 only) |
| `startCredits` | number | `100` | starting credit balance for a new session (1 credit spent per spin, never blocks a spin — see `docs/ART-SPEC.md` §10) |

## Repository layout

```
.claude-plugin/plugin.json        manifest: name, version, userConfig, etc.
.claude-plugin/marketplace.json   makes this repo a one-plugin local marketplace
hooks/hooks.json                  {"modules":["./slots.js"], "hooks":{...tier-2 command hooks...}}
hooks/slots.js                    Tier 1 module — the only file that touches `$`
lib/*.js                          the shared engine (pure ESM: runs in Node, a browser, or the
                                   hooks worker unchanged — no Node/DOM APIs)
bin/*.js                          Tier 2 scripts + setup/teardown/stats/demo (Node ≥18, ESM)
commands/*.md                     /claude-slots:setup, :teardown, :stats, :demo
fx/*.wav                          tiny generated sound effects (lever click, coin ding, jackpot chord)
tests/*.test.js                   node:test — rng, rectangularity, renderers, scanner-compat
scripts/dev/pty-smoke.py          live pseudo-terminal smoke test, both tiers, one CLI
scripts/dev/make-fx.js            regenerates fx/*.wav (pure Node PCM synthesis, no deps)
scripts/dev/build-preview.js      rebuilds docs/preview.html from the unmodified lib/ engine
docs/preview.html                 self-contained, in-browser preview (see Screenshots above)
docs/ARCHITECTURE.md              the design (read this first)
docs/ART-SPEC.md                  every symbol, strip, probability, chassis frame, storyboard (golden)
jsconfig.json                     lets editors type-check hooks/slots.js against .claude/types
```

## Development / testing

Zero runtime dependencies, plain Node ESM (`package.json` has `"type": "module"`).

```bash
node --test                            # unit tests: rng, frame rectangularity, renderers
# (equivalently: npm test, which runs `node --test tests/*.test.js`. On some Node builds,
#  passing the bare directory — `node --test tests/` — misresolves it as a CJS module path
#  instead of a test root; the glob form and the no-args form both avoid that.)
node scripts/dev/make-fx.js            # regenerate fx/*.wav
node bin/claude-slots-setup.js --dry-run --settings-path /tmp/some-settings.json
```

Live end-to-end smoke test (drives a real `claude` process through a PTY, both tiers):

```bash
python3 scripts/dev/pty-smoke.py --tier 1 --tui default \
  --prompt "Count to 10." --seconds 20 --out /tmp/run1

python3 scripts/dev/pty-smoke.py --tier 2 --tui fullscreen \
  --prompt "Count to 10." --seconds 20 --out /tmp/run2
```

Each run writes `<out>.bin` (raw capture), `<out>.stripped.txt` (ANSI stripped), and
`<out>.timeline.json` (event timeline), and prints a head/tail excerpt plus a count of lines
containing the `╔` chassis corner glyph as a quick tier-agnostic "did it actually render" signal.
Always pass `--model haiku` for these (the script defaults to it) and make sure no stray `claude`
process from a prior run is still alive:

```bash
pkill -f "claude --plugin-dir /path/to/claude_slot"
```

Verification gates this plugin is held to (`docs/ARCHITECTURE.md` §7):

1. `node --test` green — probabilities sum to 1 (200k-roll tolerance check), every frame for every
   (size × phase × outcome × time sample) is a true rectangle within its width budget, the tree
   renderer only ever emits allow-listed props, the ANSI renderer round-trips to the same visible
   text.
2. `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin validate .` passes (scanner + manifest).
3. Live PTY run, Tier 1: the machine replaces the spinner during a turn; a result line closes the
   turn; Esc mid-turn produces the JAM/"INTERRUPTED" state and a refund.
4. Live PTY run, Tier 2 (flag off, `statusLine` pointed at the script): the machine renders in the
   status line at 1 fps; hooks drive lever/stop; a pre-existing user status line is preserved as
   line 1 above it.
5. Adversarial review: API compliance, scanner compliance, 40-column terminals, reduced-motion,
   `/clear`, concurrent sessions, budget limits (toasts, store size).

## Troubleshooting

- **Nothing changed, spinner looks the same.** Check which tier you expect: Tier 1 needs
  `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` set *and Claude Code restarted*; Tier 2 needs
  `/claude-slots:setup --apply` to have actually run (dry-run alone changes nothing).
- **My old status line disappeared.** It should be preserved as line 1 above the machine. If it
  isn't, check `${CLAUDE_PLUGIN_DATA}/config.json` — your original `statusLine` command is saved
  there and `/claude-slots:teardown` will put it straight back.
- **I ran setup twice and I'm worried I lost my real settings.** You didn't: `--apply` only saves
  the *original* values into `config.json` on the *first* run; a second `--apply` re-applies the
  plugin's own values on top without touching the saved originals. Every `--apply`/`--restore`
  also leaves a timestamped `settings.json.claude-slots.bak-<ISO>` backup next to your settings
  file regardless.
- **Setup/teardown exits with "contains invalid JSON".** `claude-slots-setup.js` refuses to guess
  at a `settings.json`/`config.json` it can't parse (a stray hand-edit, or a half-written file left
  over from an earlier crash) — it leaves the file untouched and exits non-zero rather than
  crashing or overwriting it. Fix or remove the named file and re-run.
- **`claude plugin validate` fails.** Run it with `--json` for a structured report; the most
  common cause during development is a `userConfig` field using an unsupported schema key for
  your Claude Code version (see the Options note above about `options` needing v2.1.271+).
- **A hook seems to hang or error.** Every hook body is wrapped so a throw falls back to `next(e)`
  (Tier 1) or a silent `exit 0` (Tier 2 command hooks) — a broken plugin should never block a
  prompt or crash a session. If you see otherwise, please file an issue with the debug log
  (`~/.claude/debug/<session-id>.txt`, read-only, never touched by this plugin).

## Uninstall

1. `/claude-slots:teardown` (or `node bin/claude-slots-setup.js --restore`) to put back your
   original `statusLine`/`spinnerVerbs`/`spinnerTipsEnabled`.
2. Remove the plugin: `/plugin uninstall claude-slots@claude-slots-local` (marketplace install) or
   simply stop passing `--plugin-dir` (inline install).
3. Optionally remove `${CLAUDE_PLUGIN_DATA}` (`~/.claude/plugins/data/claude-slots*/`) and any
   `~/.claude/plugins/store/claude-slots*.json` files to clear saved credits/stats.

## License

MIT — see `LICENSE`.
