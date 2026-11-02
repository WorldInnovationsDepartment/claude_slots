// Claude Slots — the pure, time-driven state machine (lib/machine.js)
//
// Pure ESM, zero dependencies. Given a `state` (plain, JSON-serializable
// data) and a wall-clock `now` in milliseconds, every function here returns
// the identical answer — no hidden clocks, no randomness beyond the outcome
// rolled once at `pullLever`. The demo, the tests and the live mod therefore
// agree frame for frame.
//
//   IDLE --pullLever(now, seed)--> SPINUP -> SPINNING (until stop())
//   SPINNING --stop(now,'answer'|'refusal')--> STOPPING -> OUTCOME -> RESULT
//   SPINNING --stop(now,'aborted')--> JAM -> RESULT
//   SPINNING --stop(now,'error')--> MALFUNCTION -> RESULT
//
// Reel motion is a pixel offset into the sprite strip per reel: constant
// velocity (after a short ramp) while spinning, then an eased deceleration
// onto the rolled symbol's declared offset, reel 1 at +0 ms, reel 2 at
// +300 ms, reel 3 at +600 ms after stop(). Offsets decrease over time, so
// symbols travel downward through the window like a real reel.

import { rollOutcome } from './rng.js';
import { createEconomy, applySpinStart, applyOutcome, DEFAULT_START_CREDITS, SPIN_COST } from './economy.js';
import { OUTCOME_LABELS, OUTCOME_OVERLAYS } from './symbols.js';
import { spriteFrame, symbolOffset, balanceText, STRIP_H, OVERLAY_FRAME_COUNTS, CABINET_VARIANTS, SHEET } from './sprite-frame.js';
import { makeFrame, span } from './frame.js';

export const TIMINGS = Object.freeze({
  tickMs: 100,
  spinupMs: 400,
  /** px per second per reel; slightly different so the reels never look locked together */
  reelSpeed: Object.freeze([44, 50, 56]),
  stoppingStaggerMs: 300,
  stopMs: 600,
  /** a stopping reel always travels at least one full strip before landing */
  minStopTravelPx: STRIP_H,
  overlayFrameMs: 100,
});

const ALL_STOPPED_MS = 2 * TIMINGS.stoppingStaggerMs + TIMINGS.stopMs;

const REST_SYMBOLS = ['PILLS', 'GUN', 'AGENT'];

function easeOutCubic(u) {
  const v = 1 - u;
  return 1 - v * v * v;
}

/**
 * @typedef {{
 *   leverAt: number|null,
 *   seed: number|string|null,
 *   outcome: {outcomeClass: string, symbols: string[], payout: number}|null,
 *   stopAt: number|null,
 *   stopReason: string|null,
 *   spinCost: number,
 *   restOffsets: number[],
 *   stopStartOffsets: number[]|null,
 *   targets: number[]|null,
 *   economy: import('./economy.js').Economy,
 * }} State
 */

/**
 * @param {{startCredits?: number}} [opts]
 * @returns {State}
 */
export function createState(opts = {}) {
  return {
    leverAt: null,
    seed: null,
    outcome: null,
    stopAt: null,
    stopReason: null,
    spinCost: 0,
    restOffsets: REST_SYMBOLS.map((s) => symbolOffset(s)),
    stopStartOffsets: null,
    targets: null,
    economy: createEconomy({ startCredits: Number.isFinite(opts.startCredits) ? opts.startCredits : DEFAULT_START_CREDITS }),
  };
}

/** Pull the trigger: charge the spin, roll the outcome, start the reels from where they last rested. Mutates and returns `state`. */
export function pullLever(state, now, seed) {
  if (state.targets) state.restOffsets = state.targets.slice();
  else if (state.stopStartOffsets) state.restOffsets = state.stopStartOffsets.slice();
  state.spinCost = state.economy.credits >= SPIN_COST ? SPIN_COST : 0;
  applySpinStart(state.economy);
  state.leverAt = now;
  state.seed = seed;
  state.outcome = rollOutcome(seed);
  state.stopAt = null;
  state.stopReason = null;
  state.stopStartOffsets = null;
  state.targets = null;
  return state;
}

/** Distance (px) reel `i` has travelled `t` ms after the lever, with the velocity ramp. */
function spinDistance(i, t) {
  const v = TIMINGS.reelSpeed[i] / 1000; // px per ms
  const ramp = TIMINGS.spinupMs;
  if (t <= 0) return 0;
  if (t < ramp) return (v * t * t) / (2 * ramp);
  return v * (t - ramp / 2);
}

function spinOffset(state, i, now) {
  return state.restOffsets[i] - spinDistance(i, now - state.leverAt);
}

/** The lowest offset ≤ `from - minTravel` that shows `symbolId` (offsets decrease over time). */
function landingTarget(from, symbolId) {
  const sym = symbolOffset(symbolId);
  const limit = from - TIMINGS.minStopTravelPx;
  const rem = (((limit - sym) % STRIP_H) + STRIP_H) % STRIP_H;
  return limit - rem;
}

/**
 * End the spin at `now`. 'answer'/'refusal' resolve the reels onto the rolled
 * outcome and pay out; 'aborted'/'error' freeze the reels where they are and
 * refund. Mutates and returns `state`.
 */
export function stop(state, now, reason = 'answer') {
  if (state.leverAt == null) throw new Error('stop: pullLever has not been called');
  if (state.stopAt != null) return state;
  state.stopAt = now;
  state.stopReason = reason;
  const refund = reason === 'aborted' || reason === 'error';
  if (refund) {
    state.stopStartOffsets = [0, 1, 2].map((i) => Math.round(spinOffset(state, i, now)));
    state.targets = null;
    // economy.js refunds SPIN_COST unconditionally; undo that when the spin was on the house
    applyOutcome(state.economy, { outcomeClass: reason === 'aborted' ? 'ABORTED' : 'ERROR' });
    if (state.spinCost === 0) state.economy.credits = Math.max(0, state.economy.credits - SPIN_COST);
    return state;
  }
  state.stopStartOffsets = [0, 1, 2].map((i) => spinOffset(state, i, now + i * TIMINGS.stoppingStaggerMs));
  state.targets = [0, 1, 2].map((i) => landingTarget(state.stopStartOffsets[i], state.outcome.symbols[i]));
  applyOutcome(state.economy, state.outcome);
  return state;
}

/** Frame count of the overlay the stopped spin plays. */
function overlayFrames(state) {
  return OVERLAY_FRAME_COUNTS[overlayIdFor(state)] || 10;
}

function overlayIdFor(state) {
  if (state.stopReason === 'aborted') return OUTCOME_OVERLAYS.ABORTED;
  if (state.stopReason === 'error') return OUTCOME_OVERLAYS.ERROR;
  return OUTCOME_OVERLAYS[state.outcome ? state.outcome.outcomeClass : 'LOSE'];
}

/**
 * @returns {{phase: 'IDLE'|'SPINUP'|'SPINNING'|'STOPPING'|'OUTCOME'|'JAM'|'MALFUNCTION'|'RESULT', t: number}}
 *   `t` is ms since the phase group started (lever for SPINUP/SPINNING, stop for the rest).
 */
export function phaseAt(state, now) {
  if (state.leverAt == null) return { phase: 'IDLE', t: 0 };
  if (state.stopAt == null) {
    const t = Math.max(0, now - state.leverAt);
    return { phase: t < TIMINGS.spinupMs ? 'SPINUP' : 'SPINNING', t };
  }
  const t = Math.max(0, now - state.stopAt);
  const glitchMs = overlayFrames(state) * TIMINGS.overlayFrameMs;
  if (state.stopReason === 'aborted') return { phase: t < glitchMs ? 'JAM' : 'RESULT', t };
  if (state.stopReason === 'error') return { phase: t < glitchMs ? 'MALFUNCTION' : 'RESULT', t };
  if (t < ALL_STOPPED_MS) return { phase: 'STOPPING', t };
  if (t < ALL_STOPPED_MS + glitchMs) return { phase: 'OUTCOME', t };
  return { phase: 'RESULT', t };
}

/** True while there is still something to redraw (anything but IDLE and RESULT). */
export function isAnimating(state, now) {
  const p = phaseAt(state, now).phase;
  return p !== 'IDLE' && p !== 'RESULT';
}

/** The three reel offsets (integers, px into the strip) at `now`. */
export function reelOffsets(state, now) {
  if (state.leverAt == null) return state.restOffsets.map((o) => Math.round(o));
  if (state.stopAt == null) return [0, 1, 2].map((i) => Math.round(spinOffset(state, i, now)));
  if (!state.targets) return state.stopStartOffsets.slice(); // frozen by abort/error
  return [0, 1, 2].map((i) => {
    const start = state.stopAt + i * TIMINGS.stoppingStaggerMs;
    if (now < start) return Math.round(spinOffset(state, i, now));
    const u = Math.min(1, (now - start) / TIMINGS.stopMs);
    const o0 = state.stopStartOffsets[i];
    return Math.round(o0 + (state.targets[i] - o0) * easeOutCubic(u));
  });
}

/** The overlay frame to stamp at `now`, or null. */
export function overlayAt(state, now) {
  const { phase, t } = phaseAt(state, now);
  if (phase === 'JAM' || phase === 'MALFUNCTION') return { id: overlayIdFor(state), frame: Math.floor(t / TIMINGS.overlayFrameMs) };
  if (phase === 'OUTCOME') return { id: overlayIdFor(state), frame: Math.floor((t - ALL_STOPPED_MS) / TIMINGS.overlayFrameMs) };
  return null;
}

/** Cabinet grain variant for `now` (changes every tick). */
export function variantAt(now) {
  return Math.floor(now / TIMINGS.tickMs) % CABINET_VARIANTS;
}

/** The whole machine as a Frame (10 rows × 40 painted cells). */
export function frame(state, now) {
  return spriteFrame({
    variant: variantAt(now),
    offsets: reelOffsets(state, now),
    balance: state.economy.credits,
    overlay: overlayAt(state, now),
  });
}

/** Outcome class as the result presents it: the rolled class, or ABORTED/ERROR. */
export function presentedClass(state) {
  if (state.stopReason === 'aborted') return 'ABORTED';
  if (state.stopReason === 'error') return 'ERROR';
  return state.outcome ? state.outcome.outcomeClass : 'LOSE';
}

const PAL = Object.fromEntries(['ink', 'void', 'voidScan', 'body', 'bodyScan', 'bodyGrain', 'bodyLight', 'steel', 'steelLight', 'yellow', 'yellowDark', 'yellowPale', 'cyan', 'cyanDark', 'cyanPale', 'magenta', 'magentaDark', 'magentaPale', 'white', 'grey', 'red', 'redDark', 'green', 'orange'].map((n, i) => [n, SHEET.palette[i]]));

const CLASS_COLOUR = { LIFE: PAL.yellow, CLIENT: PAL.magenta, FEATURE: PAL.cyan, LOSE: PAL.grey, ABORTED: PAL.cyan, ERROR: PAL.red };

/** Pieces of the one-line result: label, delta text, balance text. */
export function resultParts(state) {
  const cls = presentedClass(state);
  const label = OUTCOME_LABELS[cls];
  let delta;
  if (cls === 'ABORTED' || cls === 'ERROR') delta = 'refunded';
  else if (state.spinCost === 0) delta = 'on the house';
  else {
    const net = (state.outcome ? state.outcome.payout : 0) - state.spinCost;
    delta = net >= 0 ? `+${net} cr` : `−${Math.abs(net)} cr`;
  }
  return { cls, label, delta, balance: balanceText(state.economy.credits) };
}

/** `◈ <outcome>  ±N cr  balance NNN` as plain text. */
export function resultText(state) {
  const p = resultParts(state);
  return `◈ ${p.label}  ${p.delta}  balance ${p.balance}`;
}

/** The result as a one-line Frame for the transcript. */
export function resultLine(state) {
  const p = resultParts(state);
  const colour = CLASS_COLOUR[p.cls] || PAL.grey;
  const text = resultText(state);
  const fr = makeFrame(text.length);
  fr.lines.push([
    span('◈ ', { color: colour }),
    span(p.label, { color: colour, bold: p.cls !== 'LOSE' }),
    span('  ' + p.delta, { color: PAL.white }),
    span('  balance ', { color: PAL.grey }),
    span(p.balance, { color: PAL.yellow, bold: true }),
  ]);
  return fr;
}

/** The narrow-viewport one-liner, e.g. `[ ◈ SPINNING · 097 cr ]`. */
export function fallbackText(state, now) {
  const { phase } = phaseAt(state, now);
  let word;
  if (phase === 'OUTCOME' || phase === 'RESULT') word = OUTCOME_LABELS[presentedClass(state)].toUpperCase();
  else if (phase === 'JAM') word = 'JAMMED';
  else if (phase === 'MALFUNCTION') word = 'ERROR';
  else if (phase === 'IDLE') word = 'READY';
  else word = phase;
  return `[ ◈ ${word} · ${balanceText(state.economy.credits)} cr ]`;
}

export function fallbackLine(state, now) {
  const text = fallbackText(state, now);
  const fr = makeFrame(text.length);
  fr.lines.push([span(text, { color: PAL.yellow })]);
  return fr;
}
