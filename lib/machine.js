// Claude Slots — the pure, time-driven state machine (lib/machine.js)
//
// Pure ESM, zero dependencies. Implements docs/ARCHITECTURE.md §3: given a
// `state` (plain, JSON-serializable data) and a wall-clock `now` in
// milliseconds, `frame(state, now, opts)` always returns the identical
// Frame — no hidden clocks, no randomness beyond the outcome rolled once at
// `pullLever`. Both Tier 1 (polling ~every 100ms) and Tier 2 (polling every
// 1000ms) call the exact same functions; they just sample at different
// rates.
//
//   IDLE --pullLever(now)--> LEVER -> SPINUP -> SPINNING (until stop())
//   SPINNING --stop(now,'answer'|'refusal')--> STOPPING -> REVEAL -> OUTCOME -> RESULT
//   SPINNING --stop(now,'aborted')--> JAM -> RESULT
//   SPINNING --stop(now,'error')--> MALFUNCTION -> RESULT
//
// All storyboard content (what each phase/outcome looks like) lives in
// art.js; this file only knows *when* phases start and end, and the handful
// of numbers (reel-lock booleans, the near-miss overshoot flag, the
// pre-payout credit snapshot) that are genuinely timing/economy concerns.

import { rollOutcome } from './rng.js';
import { createEconomy, applySpinStart, applyOutcome, DEFAULT_START_CREDITS } from './economy.js';
import {
  renderFrame,
  resultLine as artResultLine,
  LEVER_DURATION_MS,
  SPINUP_DURATION_MS,
  STOPPING_STAGGER_MS,
  OVERSHOOT_MS,
  REVEAL_DURATION_MS,
  JAM_DURATION_MS,
  MALFUNCTION_DURATION_MS,
  outcomeDurationMs,
} from './art.js';

/** Timing constants shared by both tiers — see art.js for the numbers themselves (this file just adds them up). */
export const TIMINGS = Object.freeze({
  leverMs: LEVER_DURATION_MS,
  spinupMs: SPINUP_DURATION_MS,
  stoppingStaggerMs: STOPPING_STAGGER_MS,
  overshootMs: OVERSHOOT_MS,
  revealMs: REVEAL_DURATION_MS,
  jamMs: JAM_DURATION_MS,
  malfunctionMs: MALFUNCTION_DURATION_MS,
  outcomeMs: outcomeDurationMs,
});

const STOPPING_TOTAL = (isNearMiss) => 2 * TIMINGS.stoppingStaggerMs + (isNearMiss ? TIMINGS.overshootMs : 0);

/**
 * @typedef {{
 *   version: 1,
 *   options: {startCredits:number, theme:'classic'|'emoji', grandEnabled:boolean},
 *   economy: import('./economy.js').Economy,
 *   seed: number|string|null,
 *   outcome: ReturnType<typeof rollOutcome>|null,
 *   leverAt: number|null,
 *   stopAt: number|null,
 *   stopReason: 'answer'|'aborted'|'error'|'refusal'|null,
 *   creditsBeforeOutcome: number,
 * }} State
 */

/**
 * Create a fresh, idle machine state. Accepts either `createState(opts)` or
 * `createState(now, opts)` (some early integration sketches called it with a
 * leading timestamp) — both forms work.
 * @param {number|object} [nowOrOpts]
 * @param {object} [maybeOpts]
 * @returns {State}
 */
export function createState(nowOrOpts, maybeOpts) {
  const opts = typeof nowOrOpts === 'number' ? maybeOpts || {} : nowOrOpts || {};
  return {
    version: 1,
    options: {
      startCredits: Number.isFinite(opts.startCredits) ? opts.startCredits : DEFAULT_START_CREDITS,
      theme: opts.theme === 'emoji' ? 'emoji' : 'classic',
      grandEnabled: opts.grandEnabled !== false,
    },
    economy: createEconomy({ startCredits: opts.startCredits }),
    seed: null,
    outcome: null,
    leverAt: null,
    stopAt: null,
    stopReason: null,
    creditsBeforeOutcome: 0,
  };
}

/**
 * Pull the lever: charges the spin cost, rolls this spin's outcome
 * (deterministically, from `seed`), and starts the LEVER phase at `now`.
 * Mutates and returns `state`.
 * @param {State} state
 * @param {number} now
 * @param {number|string} seed
 * @returns {State}
 */
export function pullLever(state, now, seed) {
  applySpinStart(state.economy);
  state.seed = seed;
  state.outcome = rollOutcome(seed, { credits: state.economy.credits });
  state.leverAt = now;
  state.stopAt = null;
  state.stopReason = null;
  return state;
}

/**
 * Stop the spin: records when/why, snapshots pre-payout credits (so
 * frame()'s progressive payout counter has a start value to interpolate
 * from), and immediately applies the economic consequence (payout or
 * refund) — the OUTCOME animation's "counter tick" is purely a display
 * interpolation over this already-final credits value, computed in art.js.
 * @param {State} state
 * @param {number} now
 * @param {'answer'|'aborted'|'error'|'refusal'} reason
 * @returns {State}
 */
export function stop(state, now, reason) {
  if (!state.outcome) {
    throw new Error('machine.stop: called before pullLever (no outcome to resolve)');
  }
  state.stopAt = now;
  state.stopReason = reason;
  state.creditsBeforeOutcome = state.economy.credits;
  if (reason === 'aborted' || reason === 'error') {
    applyOutcome(state.economy, { outcomeClass: reason === 'aborted' ? 'ABORTED' : 'ERROR' });
  } else {
    applyOutcome(state.economy, state.outcome);
  }
  return state;
}

/**
 * Compute which phase `state` is in at `now`, and how far into that phase.
 * Pure function of (state, now) — no side effects, no mutation.
 * @param {State} state
 * @param {number} now
 * @returns {{phase:string, t:number, reelLocks:[boolean,boolean,boolean], overshoot:boolean}}
 */
export function phaseAt(state, now) {
  if (state.leverAt == null) {
    return { phase: state.outcome ? 'RESULT' : 'IDLE', t: now, reelLocks: [true, true, true], overshoot: false };
  }

  // stop() can land at any point — even mid LEVER/SPINUP, if the turn ends
  // (or is interrupted) very fast — so it takes priority over the
  // lever/spin-up/spinning timeline the instant it has happened.
  if (state.stopAt == null) {
    const sinceLever = now - state.leverAt;
    if (sinceLever < TIMINGS.leverMs) {
      return { phase: 'LEVER', t: sinceLever, reelLocks: [false, false, false], overshoot: false };
    }
    if (sinceLever < TIMINGS.leverMs + TIMINGS.spinupMs) {
      return { phase: 'SPINUP', t: sinceLever - TIMINGS.leverMs, reelLocks: [false, false, false], overshoot: false };
    }
    return { phase: 'SPINNING', t: sinceLever - TIMINGS.leverMs - TIMINGS.spinupMs, reelLocks: [false, false, false], overshoot: false };
  }

  const sinceStop = now - state.stopAt;
  const reason = state.stopReason;

  if (reason === 'aborted') {
    if (sinceStop < TIMINGS.jamMs) return { phase: 'JAM', t: sinceStop, reelLocks: [false, false, false], overshoot: false };
    return { phase: 'RESULT', t: sinceStop - TIMINGS.jamMs, reelLocks: [true, true, true], overshoot: false };
  }
  if (reason === 'error') {
    if (sinceStop < TIMINGS.malfunctionMs) return { phase: 'MALFUNCTION', t: sinceStop, reelLocks: [false, false, false], overshoot: false };
    return { phase: 'RESULT', t: sinceStop - TIMINGS.malfunctionMs, reelLocks: [true, true, true], overshoot: false };
  }

  // 'answer' / 'refusal' — the normal STOPPING -> REVEAL -> OUTCOME -> RESULT path
  const isNearMiss = state.outcome.outcomeClass === 'NEAR_MISS';
  const stoppingTotal = STOPPING_TOTAL(isNearMiss);
  if (sinceStop < stoppingTotal) {
    const stagger = TIMINGS.stoppingStaggerMs;
    const reelLocks = [true, sinceStop >= stagger, sinceStop >= 2 * stagger];
    const overshoot = isNearMiss && sinceStop >= 2 * stagger && sinceStop < stoppingTotal;
    return { phase: 'STOPPING', t: sinceStop, reelLocks, overshoot };
  }
  const sinceReveal = sinceStop - stoppingTotal;
  if (sinceReveal < TIMINGS.revealMs) {
    return { phase: 'REVEAL', t: sinceReveal, reelLocks: [true, true, true], overshoot: false };
  }
  const sinceOutcome = sinceReveal - TIMINGS.revealMs;
  const outcomeTotal = outcomeDurationMs(state.outcome.outcomeClass, state.outcome.tier);
  if (sinceOutcome < outcomeTotal) {
    return { phase: 'OUTCOME', t: sinceOutcome, reelLocks: [true, true, true], overshoot: false };
  }
  return { phase: 'RESULT', t: sinceOutcome - outcomeTotal, reelLocks: [true, true, true], overshoot: false };
}

/** True while a spin's animation is still playing — false once RESULT is reached (or before any spin). */
export function isAnimating(state, now) {
  const { phase } = phaseAt(state, now);
  return !(phase === 'IDLE' || phase === 'RESULT');
}

function resolveSize(size, columns, grandEnabled) {
  if (size && size !== 'auto') return size;
  if (columns >= 90 && grandEnabled) return 'grand';
  if (columns >= 62) return 'standard';
  return 'compact';
}

/**
 * Render the current visual state as a Frame.
 * @param {State} state
 * @param {number} now
 * @param {{size?:'auto'|'compact'|'standard'|'grand', columns?:number, maxRows?:number,
 *          info?:{elapsedMs?:number, tokens?:number, mode?:string, hint?:string, credits?:number, lastWin?:number}}} [opts]
 * @returns {import('./frame.js').Frame}
 */
export function frame(state, now, opts = {}) {
  const columns = opts.columns ?? 60;
  const size = resolveSize(opts.size, columns, state.options.grandEnabled);
  const { phase, t, reelLocks, overshoot } = phaseAt(state, now);
  const info = opts.info || {};
  const economy = info.credits != null || info.lastWin != null ? { ...state.economy, credits: info.credits ?? state.economy.credits, lastWin: info.lastWin ?? state.economy.lastWin } : state.economy;
  return renderFrame({
    size, columns, maxRows: opts.maxRows,
    phase, t, seed: state.seed,
    outcome: state.outcome, reelLocks, overshoot,
    economy, creditsBeforeOutcome: state.creditsBeforeOutcome,
    info, theme: state.options.theme,
  });
}

/**
 * The permanent 1-line transcript record (§12) for the spin that just
 * resolved. Only meaningful once RESULT has been reached; safe to call any
 * time after `stop()`.
 * @param {State} state
 * @param {{columns?:number}} [opts]
 * @returns {import('./frame.js').Frame}
 */
export function resultLine(state, opts = {}) {
  const outcome = state.stopReason === 'aborted' ? { outcomeClass: 'ABORTED' } : state.stopReason === 'error' ? { outcomeClass: 'ERROR' } : state.outcome;
  const elapsedSec = state.stopAt != null && state.leverAt != null ? Math.round((state.stopAt - state.leverAt) / 1000) : 0;
  return artResultLine(outcome || { outcomeClass: 'LOSE', paylineSymbols: null }, {
    credits: state.economy.credits,
    elapsedSec,
    columns: opts.columns,
    theme: state.options.theme,
  });
}
