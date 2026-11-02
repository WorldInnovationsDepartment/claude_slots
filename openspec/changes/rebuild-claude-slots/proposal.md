# Proposal

## Why

The current plugin no longer loads on the installed Claude Code (2.1.316): `claude plugin validate` rejects the plugin name `claude-slots` (the `claude-` prefix is now reserved for Anthropic) and rejects `hooks/slots.js` because the `turn.step` hook must now be an async generator. The spinner-replacement API it was built on has also graduated: "function hooks" became **mods**, on by default since 2.1.287 with no env gate, so the whole Tier 2 statusline fallback and its setup/teardown machinery exist to solve a problem that is gone. Rather than patch a chassis-glyph machine that was designed around those constraints, rebuild it as what the user now wants: a small, high-quality, neon-cyberpunk-styled machine that shows only the credit balance, keeps animating while the agent works, and whose art is generated from a Remotion composition that also produces a satirical launch video.

## What Changes

- **BREAKING** Rename the plugin and marketplace (`claude-slots` → `slots`, marketplace `slots-local`, commands `/slots:*`). The old name cannot be loaded by Claude Code 2.1.316 at all, so no user is left behind.
- **BREAKING** Drop Tier 2 entirely: the statusline renderer, the classic command-hook state-file driver, `/claude-slots:setup` and `/claude-slots:teardown`, the `.claude-slots-runtime/` pointer file, and the related tests. Mods are on by default, so the fallback has no audience. Users who installed Tier 2 can remove the `statusLine` entry from their settings by hand (the old setup script wrote a backup beside the settings file).
- Drop the `AbovePrompt` idle machine and the `idle`, `size`, `theme` options. The machine lives only in the `Spinner` site while a turn runs; `TurnDuration` draws a one-line result.
- Port the mod module to the 2.1.316 contract: `turn.step` as `async function*`, new Spinner `mode` value `requesting`, no env gate, validated with `claude plugin validate`.
- Replace the box-drawing chassis and the multi-row payline/last-win readout with a **truecolor half-block pixel-art sprite** of a small cabinet: three reels that keep turning for the whole turn (the "swinging"), a single credit-balance readout, and nothing else. Visual language: neon palette (acid yellow, cyan, magenta on near-black) with film grain, scanlines and occasional glitch frames.
- Make a **Remotion composition the single source of truth for the art**: `art/` holds a React/SVG machine component with phases (spin loop, spin-up, stop, win, lose, abort, error). A build script renders PNG frames at sprite resolution and quantizes them into a half-block sprite sheet (`lib/sprites.json`) that the mod plays back at 10 fps. The same component renders at 1080p for the video.
- Keep the credit economy but simplify what is shown: start at 100, minus 1 per prompt, payout on wins, refund on abort/error, persisted in `$.store`. Outcomes stay deterministic from a per-turn seed.
- Add a **launch demo video** (`art/` composition, rendered to `docs/launch.mp4` with ffmpeg-friendly h264): a satire in which the viewer pulls the trigger, waits, and may win a FEATURE, a CLIENT, or a LIFE. Music is a Cyberpunk 2077-inspired track **synthesized in Node** (industrial synthwave, no licensed audio) by extending the approach of `scripts/dev/make-fx.js`.
- Replace glyph golden tests with sprite-level tests (frame counts, dimensions, palette membership, determinism) and keep the PTY smoke harness as the live verification gate.
- Rewrite README, ARCHITECTURE, and ART-SPEC for the new design; remove the Python art-gen scripts and `docs/preview.html` (superseded by Remotion Studio).

## Capabilities

### New Capabilities
- `spinner-slot-machine`: what the terminal shows while a turn runs and how it resolves: the sprite machine in the Spinner site, continuous reel motion, the credit readout, the TurnDuration result line, and abort/error presentation.
- `credit-economy`: the balance rules (start, cost per spin, payouts, refunds), persistence across sessions, and the deterministic outcome roll.
- `sprite-art-pipeline`: the contract of the art build: a Remotion composition rendered to a half-block sprite sheet with fixed dimensions, phases, palette, and determinism, plus the preview/verification commands.
- `launch-demo-video`: the satirical launch video deliverable: scenes, duration, format, synthesized soundtrack, and frame-level verification.

### Modified Capabilities
_None. The project has no existing specs; the Tier 2 behaviors being removed were never captured as specs._

## Impact

- **Removed**: `bin/claude-slots-hook.js`, `bin/claude-slots-statusline.js`, `bin/claude-slots-setup.js`, `commands/setup.md`, `commands/teardown.md`, `tests/tier2.test.js`, `tests/setup.test.js`, `tests/golden/*`, `tests/golden.test.js`, `tests/art-storyboards.test.js`, `lib/art.js`, `lib/art-storyboards.js`, `scripts/dev/art-gen/`, `scripts/dev/build-preview.js`, `scripts/dev/preview-template.html`, `docs/preview.html`, `previews/`, `.claude-slots-runtime/`.
- **Rewritten**: `hooks/slots.js` (mod module), `hooks/hooks.json` (modules only, no command hooks), `.claude-plugin/plugin.json` and `marketplace.json` (new name, trimmed `userConfig`), `lib/machine.js` (phase timing only, no glyph frames), `lib/symbols.js` (outcome classes only), `bin/claude-slots-demo.js` → `bin/demo.js` (sprite playback via ANSI), `commands/demo.md`, `commands/stats.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/ART-SPEC.md`.
- **New**: `art/` Remotion project (package.json with `remotion`, `@remotion/cli`, `react`, `react-dom` as dev-only deps of that subfolder; the plugin itself stays zero-dependency), `scripts/dev/build-sprites.js` (PNG → half-block JSON), `scripts/dev/make-music.js` (synthesized soundtrack), `lib/sprites.json`, `lib/sprite-frame.js` (sprite + digits → Frame), `tests/sprites.test.js`, `docs/launch.mp4`, plugin icon `.claude-plugin/icon.png` (validator warning today).
- **Kept**: `lib/frame.js`, `lib/render-tree.js`, `lib/render-ansi.js`, `lib/width.js`, `lib/rng.js`, `lib/economy.js`, `fx/*.wav`, `scripts/dev/pty-smoke.py` (Tier 1 path only), `/stats` command.
- **Dependencies**: Remotion and its bundled Chromium are confined to `art/` and `scripts/dev/`; nothing the mod loads at runtime gains a dependency. ffmpeg (present on this machine) is used only for muxing the synthesized track if Remotion's own audio mixing is not used.
- **Users**: anyone on the old plugin must reinstall under the new name; the Tier 2 `statusLine` entry in their settings becomes a dangling command and must be removed by hand.
- **Working tree**: the 17 uncommitted files from the amber retheme are checkpointed in a commit before any rebuild work so the retheme remains recoverable in history.
