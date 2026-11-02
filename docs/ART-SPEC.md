# Art spec

The contract between the Remotion composition in `art/`, the sprite sheet in
`lib/sprites.json`, the engine in `lib/`, and the launch video. Numbers here
are mirrored in code (`art/src/palette.ts`, `art/src/machine/layout.ts`,
`lib/symbols.js`, `lib/machine.js`) and guarded by tests.

## 1. Brief

Neon cyberpunk. Base: near-black with acid yellow, cyan and
magenta neon. Season 2 texture: film grain that flickers frame to frame,
scanlines on alternate pixel rows, chromatic glitch on abort. The machine is
small, shows only the credit balance, and keeps moving for as long as the
agent works.

## 2. Palette (24 colours, `art/src/palette.ts`)

| # | name | hex | use |
| --- | --- | --- | --- |
| 0 | ink | `#07070B` | background, overlay bands |
| 1 | void | `#0E0E16` | reel windows, readout interior |
| 2 | voidScan | `#09090F` | reserved: window scanline |
| 3 | body | `#1C1B2A` | cabinet body, even rows |
| 4 | bodyScan | `#15141F` | cabinet body, odd rows (scanline) |
| 5 | bodyGrain | `#232236` | grain speck |
| 6 | bodyLight | `#2E2D44` | grain highlight |
| 7 | steel | `#4A4A62` | frame, bezels |
| 8 | steelLight | `#7A7A9A` | top edge highlight |
| 9 | yellow | `#F3E600` | hero: marquee, digits, LIFE |
| 10 | yellowDark | `#A89E00` | yellow shade |
| 11 | yellowPale | `#FFF68A` | yellow tint, sparkles |
| 12 | cyan | `#00E5FF` | FEATURE, left neon tube |
| 13 | cyanDark | `#00889A` | cyan shade |
| 14 | cyanPale | `#9AF4FF` | cyan tint |
| 15 | magenta | `#FF2BD6` | CLIENT, right neon tube |
| 16 | magentaDark | `#9A1682` | magenta shade |
| 17 | magentaPale | `#FF9BEA` | magenta tint |
| 18 | white | `#F4F4F8` | token body, blade edge |
| 19 | grey | `#9A9AAE` | fixer face, "no match" |
| 20 | red | `#FF2A4A` | blade tip, error |
| 21 | redDark | `#8A0F22` | error speckle |
| 22 | green | `#39FF88` | banknote |
| 23 | orange | `#FF8A00` | reserved (unused by the current symbols) |

Every pixel of the sheet is one of these; the build fails on anything else.
Pixel strings in the sheet use one base-36 character per pixel (`0`–`9`,
`a`–`n`) and `-` for transparent.

## 3. Geometry (`art/src/machine/layout.ts`)

- Sprite: **40 × 20 px**, shown as **10 rows × 40 cells** of `▀` (top pixel
  = foreground colour, bottom pixel = background colour).
- Reel windows (x, y, w, h): `(3,3,10,8)`, `(15,3,10,8)`, `(27,3,10,8)`.
- Strip: 10 px wide, 64 px tall, eight symbols of 8 px each in strip order.
  A window at pixel offset `o` shows strip rows `o … o+7` (wrapping), so a
  symbol is centred when `o` equals its declared offset.
- Readout: three 3 × 5 digits at stride 4 starting at `(15, 13)`, inside a
  14 × 7 bezel at `(13, 12)`. Balance is displayed clamped to `999`.
- Cabinet (rows): 0 top edge, 1 marquee stripe (a travelling dark gap per
  variant), 2–11 reel bezels, 12–18 readout bezel with cyan (x 5–7) and
  magenta (x 32–34) neon tubes, a yellow trigger stud at (38, 15–16),
  19 bottom edge. Four grain variants; the engine shows variant
  `floor(now / 100 ms) mod 4`.

## 4. Symbols (`art/src/machine/symbol-grid.ts`)

| id | offset | what it is |
| --- | --- | --- |
| FEATURE | 0 | an optic implant, cyan iris in a steel socket: the new chrome you shipped |
| CLIENT | 8 | a green banknote with an E watermark: somebody who pays |
| LIFE | 16 | a casino token, cyan notches: the chip you finally cash out (the jackpot) |
| PILLS | 24 | a two-tone capsule and a loose tablet (filler) |
| GUN | 32 | a compact pistol with a magenta grip panel (filler) |
| AGENT | 40 | a fixer: dark hair, cyan visor, magenta tie (filler) |
| DECK | 48 | a cyberdeck: magenta screen over a key row (filler) |
| BLADE | 56 | a drawn blade, red at the tip (filler) |

## 5. Outcomes, probabilities, payouts (`lib/symbols.js`)

| class | P | payline | pays | overlay |
| --- | --- | --- | --- | --- |
| LIFE | 0.01 | ♥ ♥ ♥ | 100 | `win-life` (20 frames) |
| CLIENT | 0.04 | 💼 💼 💼 | 20 | `win-client` (15) |
| FEATURE | 0.10 | ◆ ◆ ◆ | 5 | `win-feature` (15) |
| LOSE | 0.85 | any triple that is not three of a kind | 0 | `lose` (10) |
| ABORTED | — | reels frozen | refund | `abort` (12) |
| ERROR | — | reels frozen | refund | `error` (12) |

Spin cost 1 credit, charged at the lever; at 0 the spin is on the house. The
outcome class is rolled first (mulberry32 seeded from
`hash(sessionId:turns:now)`), then the payline is resolved to match it, so
the table is exact by construction. `tests/rng.test.js` checks 100 000
sequential seeds against it within 10 % relative error.

## 6. Timing (`lib/machine.js` `TIMINGS`)

| constant | value |
| --- | --- |
| tick / frame | 100 ms (10 fps) |
| spin-up ramp | 400 ms, velocity ramps linearly from 0 |
| reel speed | 44 / 50 / 56 px per second (reels 1–3), offsets decrease (symbols travel down) |
| stop stagger | reel 1 at +0 ms, reel 2 at +300 ms, reel 3 at +600 ms after `stop()` |
| stop duration | 600 ms per reel, ease-out cubic onto the target offset |
| minimum stop travel | 64 px (one full strip) |
| all reels stopped | 1200 ms after `stop()` |
| overlay | 100 ms per frame, frame counts in §5 |
| abort / error | reels freeze at `stop()`, the glitch overlay plays at once |

Reel 1 lands on its target at `stop + 600 ms`, reel 2 at `+900 ms`, reel 3 at
`+1200 ms`; the overlay starts at `+1200 ms`. The next spin starts from the
offsets the last one landed on.

## 7. Overlays (`art/src/machine/overlay-grid.ts`)

Transparent except where they paint; stamped over the composed cabinet, so
the reels stay visible. Win overlays flash the frame and bezels in the
class colour on even frames and blink a label band over the readout rows
(`FEATURE`, `CLIENT`, `A LIFE` plus sparkles); `lose` shows `NO MATCH` in
grey for 8 frames; `abort` tears cyan/magenta bars across random rows with a
`JAMMED` band; `error` flashes red with `ERROR` and red speckle.

## 8. Sheet layout (`lib/sprites.json`, mirrored as `lib/sprites.js`)

```
{ "palette": ["#07070B", …],  "w": 40, "h": 20,
  "cabinet": { "frames": [<800 chars> ×4], "windows": [{x,y,w,h} ×3], "readout": {x,y} },
  "strip":   { "symbols": [8 ids], "symbolH": 8, "w": 10, "h": 64, "offsets": {id: px}, "pixels": <640 chars> },
  "digits":  { "w": 3, "h": 5, "stride": 4, "glyphs": [<15 chars> ×10] },
  "overlays": { "win-feature": [<800 chars> ×15], "win-client": [×15], "win-life": [×20],
                "lose": [×10], "abort": [×12], "error": [×12] } }
```

Budget 400 KB; the committed sheet is about 72 KB.

## 9. Result presentation

- Transcript line (`TurnDuration`): `◈ <label>  <delta>  balance NNN`, where
  label is `A LIFE` / `CLIENT` / `FEATURE` / `no match`, delta is `+N cr`,
  `−N cr`, `on the house` or `refunded`.
- Narrow viewport (< 40 columns): `[ ◈ SPINNING · 097 cr ]` with the phase
  or outcome word.
- Abort / error: `INTERRUPTED · refunded` / `MALFUNCTION · refunded` in the
  status line for 3 s.

## 10. Launch video (`art/src/Launch.tsx`, `art/src/timeline.json`)

1920 × 1080, 30 fps, 60 s, H.264 + AAC, written to `docs/launch.mp4`. Scenes
in order: a title cold open, a mock terminal showing the real sprite
composition while an agent works, a losing pull, a FEATURE pull, a CLIENT
pull, and a LIFE pull with a deadpan payoff card. The soundtrack is
synthesized by `scripts/dev/make-music.js` (140 BPM, four-on-the-floor kick,
side-chained saw bass with soft clipping, detuned-square 16th arpeggio, noise
risers before stops, an accent hit on every reel-stop frame) from the same
`timeline.json`, so each reel stop coincides with an accent.
