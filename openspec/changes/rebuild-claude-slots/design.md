# Design

## Context

See proposal.md for motivation. Facts that shape the approach, all verified on this machine on 2026-11-02:

- Claude Code is 2.1.316. Mods (formerly function hooks) are on by default since 2.1.287; the `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` gate is ignored. Module shape is unchanged: `hooks/hooks.json` → `"modules"` → `register(on, options)`; hooks are `($, e, next)`; the static scanner still requires `$`/`on`/`next` to be used only as `$.noun.method(...)` inside the module file.
- `claude plugin validate .` currently fails on two points: the `claude-` name prefix is reserved, and `turn.step` must be `async function* ($, e, next)` (it streams).
- Render sites available: `Spinner` (props `word`, `message`, `suffix`, `mode` where mode now includes `requesting`), `TurnDuration` (`word`, `durationMs`), `AbovePrompt`, plus a docked `Pane` (capped at 45 % of terminal width) and `$.ui.status(text)` (one line under the prompt). Invalidate budget is 10/s in general, 30/s for the visible terminal pane.
- Measured earlier and still true: `TurnDuration` never renders for an aborted turn; its `requestId` is fresh per mount, so a spin is bound to it by matching `durationMs`.
- Ink renderer skips unstyled whitespace with cursor jumps, so unpainted cells can show stale transcript text. Every sprite cell must carry an explicit colour.
- The existing engine already has what the sprite path needs: a rectangular `Frame` of `Span`s with `color` and `bg`, `render-tree.js` (Ink tree with `backgroundColor`), `render-ansi.js` (truecolor with 256-colour fallback), `width.js` (block glyphs measure as one column), `rng.js` (seeded outcome roll), `economy.js`.
- Remotion skills installed locally are at 4.0.540; Node 22, ffmpeg, and Bun are present. Remotion brings its own Chromium.
- Visual brief: acid yellow, cyan and magenta neon on near-black with chromatic glitch, textured with film grain, scanlines and blocky flat colours.

## Goals / Non-Goals

**Goals:**
- One Remotion composition is the only place machine pixels are authored; the terminal sprite and the video are two renders of it.
- The mod stays zero-dependency at runtime and keeps all `$`-touching code in one file so the scanner passes.
- Motion in the terminal is time-driven and deterministic from `(state, now)`, so the demo, the tests, and the live mod agree frame for frame.
- Verification is mechanical: validator, sprite tests, PTY smoke run, frame extraction and ffprobe for the video.

**Non-Goals:**
- No Tier 2 / statusline path, no idle machine, no theme or size variants.
- No sound in the terminal beyond what already exists (`fx/*.wav` stays optional and off by default).
- No support for terminals without truecolor beyond the existing 256-colour fallback in the ANSI renderer.
- The video is a deliverable, not a feature of the plugin: it is not rendered at install time.

## Decisions

### D1. Surface: `Spinner` for the machine, `TurnDuration` for the result, `$.ui.status` for aborts
The Spinner site exists exactly while a turn runs and disappears when it ends, which is the requested lifetime. `TurnDuration` is the natural home for the one-line result that stays in the transcript. Because `TurnDuration` never mounts for an aborted turn and the `AbovePrompt` band is being dropped, the `INTERRUPTED · refunded` / `MALFUNCTION · refunded` notice goes through `$.ui.status` for about three seconds, cleared by a `$.clock.after`.
*Alternatives:* a docked `Pane` (persistent, but takes up to 45 % of the width and stays after the turn, the opposite of "small, until the agent is done"); `AbovePrompt` (would keep the idle-machine complexity the user asked to remove).

### D2. Pixel art via half-block cells, 40 × 20 px in 40 × 10 cells
Each cell is `▀` with `color` = top pixel and `bg` = bottom pixel. Cells are roughly 1:2, so the two pixels are near-square and the sprite reads as pixel art. 40 columns fits any sane terminal; 10 rows is below the old compact chassis. Every cell is painted (both colours always set), which also fixes the stale-text artefact by construction.
*Alternatives:* box-drawing glyph chassis (what exists; cannot be generated from Remotion and looks like a terminal widget, not pixel art); sextant/quadrant glyphs (more resolution but patchy font support); Kitty/iTerm image protocols (not reachable from an Ink tree).

### D3. Layered sprite sheet, compositing in the engine
The build emits `lib/sprites.json`:

```
{
  "palette": ["#0b0b10", "#f3e600", ...],          // <= 24 entries
  "w": 40, "h": 20,
  "cabinet": { "frames": [ <pixels>, x4 grain variants ], "windows": [{x,y,w,h} x3], "readout": {x,y} },
  "strip":   { "symbols": ["FEATURE","CLIENT","LIFE","SKULL","EDDIES","CHIP"], "symbolH": 8, "pixels": <window-width x (6*8)> },
  "digits":  { "w": 3, "h": 5, "glyphs": [ <pixels> x10 ] },
  "overlays": { "win-life": [...], "win-client": [...], "win-feature": [...], "lose": [...], "abort": [...], "error": [...] }
}
```
`<pixels>` is a string of palette indices (one char per pixel, base-36), so the whole sheet is tens of KB. Index `-` means transparent in overlays and windows. `lib/sprite-frame.js` composes a `Frame` per tick: pick cabinet grain variant by `floor(t/100) mod 4`, scroll each reel window by its pixel offset, stamp the balance digits, then stamp the active overlay frame. Reel offsets are computed in `lib/machine.js` from phase timing: constant velocity during `SPINNING`, eased deceleration to the target symbol's declared offset during `STOPPING` (reel 1 at +0 ms, reel 2 at +300 ms, reel 3 at +600 ms, same cadence as today).
*Alternatives:* bake every phase as full frames (simple playback, but a seamless stop from an arbitrary loop position needs a stop sequence per (loop phase × target symbol × reel), which explodes the sheet and still looks like a cut); render reels as separate Remotion compositions per target (same problem).

### D4. Remotion project in `art/`, isolated from the plugin runtime
`art/` is its own npm project (`remotion`, `@remotion/cli`, `react`, `react-dom`, `zod`). It holds:
- `src/theme.ts`: the single palette and easing object (the ≤24-colour palette lives here and is exported for the sprite build).
- `src/machine/*`: `Cabinet`, `ReelStrip`, `Digits`, `Overlay` components drawn as SVG rectangles on a 40 × 20 grid, with a `scale` prop so the same components render at 1 px per unit for the sprite and 27 px per unit for 1080p.
- `src/Root.tsx`: `Still`s for each sprite layer (`SpriteCabinet` ×4 seeds, `SpriteStrip`, `SpriteDigits`) and short `Composition`s for each overlay sequence, plus the `Launch` composition for the video.
- `src/timeline.json`: the video's beat grid and reel-stop frames, shared with the music script.
The plugin never imports from `art/`; only `scripts/dev/build-sprites.js` does, via `npx remotion render --frames ... --image-format=png` then PNG decode (pure-JS PNG reader, no native deps) → nearest-palette quantisation → `lib/sprites.json` + `docs/sprites-contact.png`. Determinism comes from no randomness at render time: grain variants use a seeded hash in the component, not `Math.random`.
*Alternatives:* a Canvas drawn in Node without Remotion (cheaper, but discards the user's explicit ask and the video would need a second drawing of the machine); putting Remotion at the repo root (would make the plugin directory carry `node_modules`, which the marketplace install would copy).

### D5. Remotion renders the sprite layers at native 1 px per unit
Rendering 40 × 20 directly avoids resampling blur. `Still` compositions set `width: 40, height: 20` and the components use `shapeRendering="crispEdges"`. The strip is rendered as one tall still (window width × symbols × symbol height). Season 2 texture is authored in the composition at pixel scale: grain as single-pixel palette-index perturbations from a seeded hash, scanlines as a darker palette entry applied on odd rows.

### D6. Economy stays, readout shrinks
`lib/economy.js` is kept as is (start 100, cost 1, on-the-house at 0, payouts per class, refund on abort/error). Only the presentation changes: the sprite shows three digits of balance (clamped display `999`, actual value unbounded), the `TurnDuration` line shows outcome, delta, balance. Symbols become the satire set: `FEATURE`, `CLIENT`, `LIFE` as the three win classes (LIFE is the jackpot), plus three filler symbols. Payouts and probabilities are declared in `docs/ART-SPEC.md` and mirrored in `lib/symbols.js`; the spec's probability test guards the mirror.

### D7. Mod module layout
`hooks/slots.js` keeps every `$` call and registers: `session.start` (load store, write nothing else), `prompt.submit` (await `next` first, then pull lever and start `$.clock.every(100, tick)`), `turn.start`, `turn.step` as `async function*` that yields through every chunk and returns `next`'s result unchanged (it only timestamps a tool pulse), `turn.complete` (stop, settle economy, persist, schedule ticker stop after the overlay ends, `$.ui.status` on abort/error), `ui.render Spinner` (compose sprite Frame → `renderTree`), `ui.render TurnDuration` (bind by `durationMs`, animate until overlay ends, then result line). Narrow viewport (< 40 columns) returns the one-line text fallback from the spec.

### D8. Launch video and music
`Launch` composition, 1920 × 1080, 30 fps, 60 s target. Scenes from the spec, built with the motion-graphics skill's five-layer stack (mesh background, assets, type, grade, grain + vignette), spring entrances, staggered reveals, and the machine component at 27× scale. The terminal scene is a mock terminal frame showing the real sprite output (the sprite layers composited in React exactly as the engine does, so the video shows what the terminal shows). Music: `scripts/dev/make-music.js` extends the `make-fx.js` WAV writer to a 60 s stereo track at 140 BPM driven by `art/src/timeline.json`: kick on every beat, side-chained saw bass with soft clipping, a 16th-note arpeggio on a detuned square, a noise riser before each stop, and an accent hit at every reel-stop frame. Output `art/public/launch-track.wav`, placed with `<Audio src={staticFile(...)}>`; `npx remotion render` muxes to AAC. The reference song the user named did not reach this session (the paste was cut off), so the style is driven by the genre brief, not by a specific track.

### D9. Verification gates, in order
1. `claude plugin validate .` → zero errors (name, hooks module, manifest).
2. `node --test tests/*.test.js` → sprite geometry, palette, determinism, compositing, economy, rng distribution, machine phases.
3. `node bin/demo.js --outcome=life` plays in a terminal (ANSI renderer).
4. `python3 scripts/dev/pty-smoke.py --tier 1 --tui default|fullscreen` → the sprite's top-left marker cell appears during the turn and disappears after; no stale digits inside the sprite rectangle in a pyte reconstruction.
5. Video: `npx remotion render --frames` at every scene start and reel stop into `docs/review/`, inspected visually; `ffprobe` for format and duration; `ffmpeg -af silencedetect` for gaps.

## Risks / Trade-offs

- [Half-block art depends on the terminal font rendering `▀` with full-cell coverage] → Test in iTerm2, Terminal.app, and the VS Code terminal in the PTY run; the fallback line covers unsupported cases, and the palette avoids relying on sub-pixel detail.
- [Ink may merge adjacent `Text` spans with the same style and still skip "blank" runs] → Every cell has both colours set and no cell is a plain space; the PTY smoke test asserts no stale text inside the rectangle.
- [10 fps with 400 cells per frame, each a `Text` node, could cost render time] → Spans are coalesced per run of identical (top, bottom) colours, cutting nodes by roughly 5–10×; measured hook latency budget is well under the 100 ms tick.
- [Remotion Chromium download may fail in a sandbox] → The build script accepts `--browser-executable`; the sheet is committed, so the plugin never needs Remotion at install or run time.
- [Quantisation to 24 colours could flatten the grade] → The palette is authored in `theme.ts` and the composition only ever uses those colours, so quantisation is exact, not approximate.
- [Synthesized music may sound thin next to the reference the user had in mind] → The script exposes BPM, bass drive, and arpeggio pattern as constants at the top; the review step plays the track for the user before the final render.
- [Removing Tier 2 strands users who ran the old setup] → README migration note explains removing `statusLine` from settings; the old backups remain beside their settings file.
- [Abort notice via `$.ui.status` is a plain line, not the sprite] → Accepted; abort is rare and the notice is explicit.

## Migration Plan

1. Commit the current working tree (the amber retheme) as a checkpoint so it stays recoverable.
2. Rename plugin, marketplace, and commands; delete Tier 2 files; update manifests; validator must pass before any art work.
3. Build `art/`, the sprite sheet, and the engine; land tests with each group.
4. Rewrite docs; render the video last, since it reuses the finished composition.
5. Rollback: revert to the checkpoint commit. Nothing outside the repo is written by the new plugin except `$.store` keys under a new namespace (`slots.*`), so old and new state never collide.

## Open Questions

- The reference song name was cut from the user's message. It does not change the pipeline (synthesized, genre-driven), but if the user supplies it later the music constants can be tuned toward it.
- Plugin icon artwork (512–2048 px PNG) is only a validator warning; a still of the cabinet from the composition will be used unless the user prefers something else.
