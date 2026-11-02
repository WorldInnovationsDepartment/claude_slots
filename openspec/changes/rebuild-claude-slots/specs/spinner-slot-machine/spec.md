# Spec Delta

## Purpose

Defines what the terminal shows in place of the built-in spinner while a Claude Code turn runs: a small pixel-art slot machine whose reels keep moving until the agent is done, a credit-balance readout, and how the result is presented when the turn ends.

## ADDED Requirements

### Requirement: Machine replaces the spinner for the whole turn
While a turn is running in the terminal, the plugin SHALL draw the slot machine in place of the built-in spinner line, for every spinner mode (`requesting`, `responding`, `thinking`, `tool-input`, `tool-use`), and SHALL yield to the built-in spinner on any non-terminal surface or if its own state is unavailable.

#### Scenario: Turn starts in the terminal
- **WHEN** the user submits a prompt in the terminal and the turn begins
- **THEN** the spinner site shows the machine sprite instead of the built-in verb line, within one redraw of the turn starting

#### Scenario: Non-terminal surface
- **WHEN** the spinner is requested for a surface other than the terminal
- **THEN** the plugin passes the request through and the built-in spinner is drawn

#### Scenario: Plugin state not initialised
- **WHEN** the spinner is requested before the session-start hook has run
- **THEN** the plugin passes the request through and never throws

### Requirement: Reels keep moving until the turn completes
The machine's reels SHALL be in continuous motion for the entire duration of the turn, with a new sprite frame at least every 100 ms, and SHALL never settle, freeze, or loop into a static frame while the turn is still running, regardless of turn length.

#### Scenario: Long turn
- **WHEN** a turn runs for ten minutes
- **THEN** the reels are still visibly turning at the ten-minute mark and no frame has been shown for longer than 200 ms

#### Scenario: Tool use during the turn
- **WHEN** the turn switches between thinking, tool input, and tool use modes
- **THEN** the reels keep turning without a visible reset, pause, or jump

### Requirement: Machine footprint is small and fixed
The machine SHALL occupy a fixed footprint of at most 10 terminal rows and at most 44 columns, SHALL be drawn with truecolor half-block pixels so every interior cell is painted (no unpainted gaps), and SHALL fall back to a one-line text readout when the viewport is narrower than the sprite.

#### Scenario: Normal terminal width
- **WHEN** the terminal is 80 columns wide
- **THEN** the machine is drawn at its fixed size and no row exceeds 44 columns

#### Scenario: Narrow terminal
- **WHEN** the terminal is narrower than the sprite width
- **THEN** a single-line textual readout `[ ◈ SPINNING · 097 cr ]` style line is drawn instead of the sprite

#### Scenario: Stale transcript text under the sprite
- **WHEN** the sprite is drawn over rows that previously held streamed model text
- **THEN** every cell of the sprite's rectangle is painted and no previous text remains visible inside it

### Requirement: Only the credit balance is shown on the machine
The machine SHALL display the current credit balance as its only readout. It SHALL NOT display elapsed time, token counts, spinner verbs, last-win amounts, paytables, or mode labels inside the sprite.

#### Scenario: During a spin
- **WHEN** the machine is drawn mid-turn with a balance of 97
- **THEN** the digits `097` are visible on the cabinet and no other numeric or textual readout is present

#### Scenario: Balance changes
- **WHEN** a turn completes with a payout that raises the balance to 105
- **THEN** the readout shows `105` on the next drawn frame

### Requirement: Turn end resolves the reels and shows a one-line result
When the turn completes with an answer, the machine SHALL stop the reels one by one onto the outcome rolled for that turn, play the outcome's animation, and then the turn's closing line SHALL show a single-row result (outcome name, credit delta, new balance) that remains in the transcript.

#### Scenario: Losing spin
- **WHEN** a turn completes and the rolled outcome is a loss
- **THEN** the reels stop on a non-matching combination, a short lose animation plays, and the closing line reads like `◈ no match  −1 cr  balance 096`

#### Scenario: Winning spin
- **WHEN** a turn completes and the rolled outcome is a win class
- **THEN** the reels stop on the matching combination, the win animation plays, and the closing line shows the outcome name, a positive delta, and the new balance

#### Scenario: Result animation ends
- **WHEN** the outcome animation has finished
- **THEN** the plugin stops scheduling redraws and the closing line stays static

### Requirement: Aborted and errored turns are presented distinctly
When a turn is aborted by the user or ends in an error, the machine SHALL show a distinct glitch/jam frame sequence, SHALL NOT present a win or loss, and the result presentation SHALL state that the spin was refunded.

#### Scenario: User presses Esc
- **WHEN** the user interrupts a running turn
- **THEN** a glitch sequence plays and a one-line notice shows `INTERRUPTED · refunded`

#### Scenario: Turn errors
- **WHEN** the turn ends with reason `error`
- **THEN** a malfunction sequence plays and the notice shows `MALFUNCTION · refunded`

### Requirement: Plugin loads on current Claude Code without configuration
The plugin SHALL load as a mod on Claude Code 2.1.287 or later with no environment variable, SHALL pass `claude plugin validate` with zero errors, and SHALL use a plugin name that is not in Anthropic's reserved namespace.

#### Scenario: Validation
- **WHEN** `claude plugin validate` is run on the plugin directory with Claude Code 2.1.316
- **THEN** it reports no errors for the manifest, marketplace, or hooks module

#### Scenario: Dropped prompt
- **WHEN** a downstream hook drops the submitted prompt
- **THEN** no spin is started and the machine is not shown
