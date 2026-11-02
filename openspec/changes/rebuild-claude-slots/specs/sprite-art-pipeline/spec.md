# Spec Delta

## Purpose

Defines the contract of the art build: a single Remotion composition of the machine is the source of truth, and a build command turns it into a half-block sprite sheet the terminal plugin plays back, with fixed dimensions, phases, palette, and determinism.

## ADDED Requirements

### Requirement: One composition is the source of all machine art
The machine's appearance SHALL be defined once, as a Remotion composition parameterised by phase and time, and both the terminal sprite sheet and the launch video SHALL be rendered from that same composition. Hand-edited sprite frames SHALL NOT be accepted as a source.

#### Scenario: Art change propagates
- **WHEN** the cabinet colour is changed in the composition and the sprite build is re-run
- **THEN** the terminal sprite sheet and a re-rendered video both show the new colour with no other edits

### Requirement: Sprite sheet has fixed geometry
The sprite build SHALL produce a sheet whose every frame is exactly 40 pixels wide and 20 pixels tall, encoded as 10 rows of 40 half-block cells, with a top and bottom pixel colour for each cell, and the sheet SHALL be at most 400 KB on disk.

#### Scenario: Frame geometry
- **WHEN** the sprite sheet is loaded by the tests
- **THEN** every frame of every phase has 10 rows of 40 cells and each cell carries two colours

#### Scenario: Size budget
- **WHEN** the sprite build completes
- **THEN** the sheet file is 400 KB or smaller

### Requirement: Sheet is composed of named layers
The sheet SHALL contain named layers the plugin composites per frame: `cabinet` (at least 4 grain variants of the static body with three transparent reel windows), `strip` (one vertical pixel strip holding every reel symbol once, with each symbol's pixel offset declared), `digits` (glyphs 0 to 9), and overlay sequences `win` per win class, `lose`, `abort`, and `error`.

#### Scenario: Layer inventory
- **WHEN** the sprite sheet is loaded
- **THEN** it exposes `cabinet` with at least 4 variants and 3 declared windows, `strip` with a declared offset for every symbol, `digits` with 10 glyphs, and one overlay sequence for each of win-feature, win-client, win-life, lose, abort, and error

### Requirement: Reels move by scrolling the strip
Reel motion SHALL be produced by scrolling `strip` through each reel window, so any symbol can be landed on at any moment without a baked stop sequence.

#### Scenario: Loop continuity
- **WHEN** a reel window is scrolled by one full strip height
- **THEN** the window shows exactly the frame it started from, so continuous scrolling has no visible seam

#### Scenario: Landing on an outcome
- **WHEN** an outcome requires reel symbols A, B, C on the payline
- **THEN** the declared offsets of A, B, and C in `strip` place each symbol centred in its reel window

#### Scenario: Readout digits
- **WHEN** the balance is composited onto a frame
- **THEN** each digit is drawn from the `digits` glyph set at the declared readout position without overwriting the reel windows

#### Scenario: Overlay sequences
- **WHEN** a win overlay is composited on the cabinet
- **THEN** only the overlay's non-transparent pixels replace cabinet pixels and the reels stay visible underneath

### Requirement: Palette follows the neon brief
Every pixel in the sheet SHALL come from a declared palette of at most 24 colours whose base is near-black, acid yellow, cyan, and magenta, and the sheet SHALL include season 2 texture: a grain layer that varies between frames and a scanline darkening on alternate pixel rows.

#### Scenario: Palette membership
- **WHEN** every colour in the sheet is collected
- **THEN** the set has at most 24 members and each is listed in the composition's theme

#### Scenario: Grain varies
- **WHEN** two consecutive `spin` frames are compared pixel by pixel
- **THEN** grain pixels differ between them while the cabinet outline is identical

### Requirement: Build is deterministic and verifiable
The sprite build SHALL be reproducible: two runs on the same composition SHALL produce byte-identical sheets. The build SHALL also emit a contact-sheet PNG of every phase for human review, and a preview command SHALL play the sheet in a terminal at 10 fps without Claude Code.

#### Scenario: Reproducible build
- **WHEN** the build is run twice without changing the composition
- **THEN** the two sheets are byte-identical

#### Scenario: Contact sheet
- **WHEN** the build completes
- **THEN** a PNG contact sheet showing every phase's frames exists beside the sheet

#### Scenario: Terminal preview
- **WHEN** the preview command is run with a phase name
- **THEN** that phase plays in the terminal using the same renderer the plugin uses for ANSI output
