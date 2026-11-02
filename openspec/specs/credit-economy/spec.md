# credit-economy Specification

## Purpose

Defines the credit balance behind the machine: how it starts, what a spin costs, what outcomes pay, how aborted or failed turns are refunded, how the balance persists across sessions, and how an outcome is rolled.

## Requirements

### Requirement: Starting balance
A machine with no persisted balance SHALL start at the configured starting balance (default 100 credits). The starting balance SHALL be configurable through the plugin's user configuration between 0 and 100000.

#### Scenario: First ever session
- **WHEN** the plugin runs for the first time on a machine with no stored balance
- **THEN** the readout shows `100`

#### Scenario: Custom start
- **WHEN** the user configures a starting balance of 500 before the first session
- **THEN** the readout shows `500`

### Requirement: One credit per spin
Each submitted prompt that starts a turn SHALL deduct exactly one credit at the moment the spin starts. At zero credits the spin SHALL still run and SHALL deduct nothing.

#### Scenario: Normal spin
- **WHEN** the balance is 97 and a prompt is submitted
- **THEN** the balance shown during the spin is 96

#### Scenario: Zero balance
- **WHEN** the balance is 0 and a prompt is submitted
- **THEN** the spin runs, the balance stays 0, and the result line notes the spin was on the house

### Requirement: Outcome payouts
Each outcome class SHALL have a fixed payout applied to the balance when the turn completes with an answer: a loss pays 0, and each win class pays a positive fixed amount defined in the plugin's art spec. The net change for the spin (payout minus the one-credit cost) SHALL be what the result line reports.

#### Scenario: Win class payout
- **WHEN** the rolled outcome is a win class whose payout is 10 and the spin cost was 1
- **THEN** the balance increases by 10 at completion and the result line reports `+9 cr`

#### Scenario: Loss
- **WHEN** the rolled outcome is a loss
- **THEN** the balance is unchanged at completion and the result line reports `−1 cr`

### Requirement: Refund on abort or error
A turn that is aborted or ends in error SHALL refund the spin's cost, SHALL apply no payout, and SHALL NOT count as a win or a loss in statistics.

#### Scenario: Interrupted turn
- **WHEN** the balance was 96 after the spin started and the user interrupts the turn
- **THEN** the balance returns to 97 and spin statistics are unchanged

### Requirement: Balance and statistics persist across sessions
The balance, the number of spins, and wins per outcome class SHALL be persisted in the plugin's key-value store so a new Claude Code session continues from the previous balance.

#### Scenario: Restart Claude Code
- **WHEN** a session ends with a balance of 112 and a new session starts
- **THEN** the new session's first frame shows `112`

#### Scenario: Stats command
- **WHEN** the user runs the plugin's stats command
- **THEN** it reports the current balance, total spins, and wins by class from the same persisted data

### Requirement: Outcome is rolled deterministically at spin start
The outcome of a spin SHALL be decided when the spin starts, from a seed derived from the session and turn, using a fixed probability table, so that the same seed always yields the same outcome and the reels can land on it later without re-rolling.

#### Scenario: Same seed
- **WHEN** two spins start with the same seed
- **THEN** they resolve to the same outcome class and the same reel positions

#### Scenario: Probability table
- **WHEN** 100000 spins are rolled with sequential seeds
- **THEN** each outcome class's frequency is within 10% relative error of its table probability
