// Claude Slots — the mod module (hooks/slots.js)
//
// Draws the pixel-art slot machine in the AbovePrompt band, pinned to the
// bottom-right of the screen for the whole session (idle between turns,
// spinning while one runs, outcome overlay when it ends), and draws the
// one-line result in TurnDuration (docs/ARCHITECTURE.md). The built-in
// Spinner is left alone.
// This is the ONLY file in the plugin allowed to touch `$` / `on` / `next`;
// the static scanner behind `claude plugin validate` enforces that:
//
//   - `register` is a same-file exported function.
//   - Every `$` use is either `$.noun.method(...)` written directly inside a
//     hook body / a top-level helper, or `$` passed *whole* as an argument
//     to a top-level function declared in this same file.
//   - `next` is only ever called directly as `next(e)` (or `yield* next(e)`
//     in the streaming `turn.step` generator), inline inside the `on(...)`
//     callback that received it.
//   - `on` is only ever called directly inside `register(...)`.
//   - Everything else (rng, machine state, sprites, rendering, the pure
//     helpers) lives in lib/ and is imported as plain, `$`-free code.
//
// Every hook body is wrapped in try/catch and falls back to `next(e)` (or a
// silent no-op for observe-only events): a hook that throws is skipped by
// the engine, and degrading to the native spinner beats vanishing.
//
// Contract notes (Claude Code 2.1.316): `$.clock.now()` resolves a promise;
// `$.session.turns()` counts the user's prompts; `turn.step` streams, so its
// hook is an async generator; `turn.*` events also fire for subagent loops
// (with `e.agentId` set) and are ignored here so a subagent's turn never
// pulls or stops the main machine.

import * as machine from '../lib/machine.js';
import { renderTree } from '../lib/render-tree.js';
import { hashSeed } from '../lib/rng.js';
import {
  STORE_KEY,
  resolveOptions,
  cloneJson,
  mergeStoredEconomy,
  refundNotice,
  SpinQueue,
  bandFitsSprite,
  bandTree,
} from '../lib/mod-helpers.js';

// ---------------------------------------------------------------------------
// Module-level state. `session.start` is treated as the reload/reset signal
// and clears the transient parts on every fire; only the economy (credits /
// stats) survives, via `$.store`.
// ---------------------------------------------------------------------------

const NOTICE_STATUS_MS = 3000;
const TICK_MS = machine.TIMINGS.tickMs;
const TICKER_POLL_MS = 200;

/** Resolved plugin options for this activation (set once, at the top of `register`). */
let cfg = resolveOptions(null);

/** The session's one running machine (lib/machine.js State — plain JSON data). */
let liveState = null;

/** Last turn.step-with-tool-calls timestamp — an optional flourish flag. */
let toolPulseAt = 0;

/** The shared ~10fps redraw ticker. */
let tickerHandle = null;
let tickerRunning = false;

/** Bumped on every pullLever; lets a stale scheduled ticker-stop recognize a newer spin started. */
let spinGeneration = 0;

/** Finished spins waiting for / bound to their TurnDuration instance. */
const spins = new SpinQueue();

/** The pending timer that will clear the status line set by the most recent setTimedStatus() call. */
let statusClearHandle = null;

function resetTransientState() {
  stopTickerNow();
  if (statusClearHandle) {
    statusClearHandle.cancel();
    statusClearHandle = null;
  }
  spins.clear();
  toolPulseAt = 0;
  spinGeneration += 1;
}

// ---------------------------------------------------------------------------
// Ticker — the shared ~10fps redraw heartbeat. Named top-level functions
// forwarding `$` explicitly, so the scanner attributes `$.clock.every` /
// `$.clock.after` through these same helpers.
// ---------------------------------------------------------------------------

function tick($) {
  $.ui.invalidate('ui.render');
}

function startTicker($) {
  if (tickerRunning) return;
  tickerRunning = true;
  tickerHandle = $.clock.every(TICK_MS, () => tick($));
}

function stopTickerNow() {
  if (tickerHandle) {
    tickerHandle.cancel();
    tickerHandle = null;
  }
  tickerRunning = false;
}

/**
 * Keeps the ticker running until this spin's animation (reel stops + the
 * overlay) has genuinely finished, then stops it. `gen` lets a newer spin's
 * own poll silently take over.
 */
async function pollTickerStop($, gen) {
  if (gen !== spinGeneration) return;
  const now = await $.clock.now();
  if (liveState && machine.isAnimating(liveState, now)) {
    $.clock.after(TICKER_POLL_MS, () => pollTickerStop($, gen));
    return;
  }
  stopTickerNow();
  tick($); // one last redraw so the band settles on the landed reels
}

function clearStatus($) {
  $.ui.status(undefined);
}

/** Pins a status line for `ms`, then clears it (`$.ui.status` never auto-expires). */
function setTimedStatus($, text, ms) {
  if (statusClearHandle) {
    statusClearHandle.cancel();
    statusClearHandle = null;
  }
  $.ui.status(text);
  statusClearHandle = $.clock.after(ms, () => {
    statusClearHandle = null;
    clearStatus($);
  });
}

function notifyJackpot($, amount) {
  $.ui.toast(`A LIFE! +${amount} credits`);
}

/** TurnDuration never mounts for an aborted turn, so the refund notice goes through the status line for a few seconds. */
function notifyRefund($, reason) {
  setTimedStatus($, refundNotice(reason), NOTICE_STATUS_MS);
}

// ---------------------------------------------------------------------------
// $-touching async helpers (store/session reads) — each receives `$` as its
// first argument, used only as `$.noun.method(...)`.
// ---------------------------------------------------------------------------

async function loadStoredEconomy($) {
  try {
    return await $.store.get(STORE_KEY);
  } catch (err) {
    return undefined;
  }
}

async function saveEconomy($, economy) {
  try {
    await $.store.set(STORE_KEY, cloneJson(economy));
  } catch (err) {
    // persistence is best-effort; losing one write never blocks the turn
  }
}

async function initSession($) {
  const stored = await loadStoredEconomy($);
  const state = machine.createState({ startCredits: cfg.startCredits });
  mergeStoredEconomy(state, stored);
  return state;
}

async function maybePullLever($) {
  if (!liveState) liveState = machine.createState({ startCredits: cfg.startCredits });
  // Only refuse when a turn is genuinely still in flight (stop() hasn't
  // landed yet). A stopped spin's economics are already final, so a new
  // lever pull is always safe to cut its cosmetic reveal short.
  if (liveState.leverAt != null && liveState.stopAt == null) return;
  const now = await $.clock.now();
  const sessionId = await $.session.id();
  const turns = await $.session.turns();
  const seed = hashSeed(sessionId + ':' + turns + ':' + now);
  machine.pullLever(liveState, now, seed);
  spinGeneration += 1;
  startTicker($);
}

async function handleTurnComplete($, e) {
  if (!liveState) return;
  if (liveState.leverAt == null || liveState.stopAt != null) return; // no lever pulled for this turn, or already resolved
  const now = await $.clock.now();
  machine.stop(liveState, now, e.reason);

  const resultSnapshot = cloneJson(liveState);
  spins.push({ turnId: e.turnId, durationMs: e.durationMs, resultSnapshot });

  await saveEconomy($, liveState.economy);

  const cls = machine.presentedClass(liveState);
  if (cls === 'ABORTED' || cls === 'ERROR') {
    notifyRefund($, e.reason);
  } else if (cls === 'LIFE') {
    notifyJackpot($, liveState.economy.lastWin);
  }

  pollTickerStop($, spinGeneration);
}

/** The band: the machine itself, right-aligned, or the one-line readout where the band is too small for it. */
async function renderBand($, e) {
  const now = await $.clock.now();
  const inner = bandFitsSprite(e.props)
    ? renderTree(machine.frame(liveState, now))
    : renderTree(machine.fallbackLine(liveState, now));
  return bandTree(inner, e.props.bodyColumns);
}

/** The transcript keeps only the one-line result; the animation lives in the band. */
function renderTurnDuration(spin) {
  return renderTree(machine.resultLine(spin.resultSnapshot));
}

// ---------------------------------------------------------------------------
// register(on, options) — the module's only export.
// ---------------------------------------------------------------------------

/** @type {import('claude-code').Register} */
export function register(on, options) {
  cfg = resolveOptions(options);

  on('session.start', async ($, e, next) => {
    try {
      resetTransientState();
      liveState = await initSession($);
      tick($); // the band may have drawn before the state existed; show the idle machine now
      return next(e);
    } catch (err) {
      return next(e);
    }
  });

  on('prompt.submit', async ($, e, next) => {
    // Run the rest of the chain FIRST and inspect what it resolved to before
    // committing to a spin: a downstream hook can stop the turn with
    // `{ drop: reason }`, in which case turn.start/turn.complete never fire
    // for this prompt and a pulled lever would wedge the machine in SPINNING.
    // next(e) is intentionally NOT wrapped in the try below: it must be
    // called exactly once.
    const result = await next(e);
    try {
      if (!(result && result.drop)) {
        await maybePullLever($);
      }
    } catch (err) {
      // pulling the lever is our own visual bookkeeping — never let a
      // failure here affect the prompt.submit result the chain already produced
    }
    return result;
  });

  on('turn.step', async function* ($, e, next) {
    // Streams: every chunk from beneath is yielded through unchanged and the
    // result is returned as is. The only side effect is a tool-pulse
    // timestamp when the step asked for tool calls.
    const result = yield* next(e);
    try {
      if (!e.agentId && result && result.toolUses && result.toolUses.length > 0) {
        toolPulseAt = await $.clock.now();
      }
    } catch (err) {
      // a failed timestamp never alters the step's result
    }
    return result;
  });

  on('turn.complete', async ($, e, next) => {
    try {
      if (!e.agentId) await handleTurnComplete($, e);
    } catch (err) {
      // never let our own bookkeeping alter or block the turn's answer
    }
    return next(e);
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      if (e.surface !== 'terminal') return next(e);
      if (e.props.hasSurvey) return next(e); // a survey owns the band; yield to it
      if (!liveState) return next(e);
      // Ticker lifecycle is owned solely by prompt.submit/turn.complete; a
      // render hook must never restart it (an unrelated invalidate after a
      // scheduled stop would otherwise resurrect a ticker nobody stops).
      return await renderBand($, e);
    } catch (err) {
      return next(e);
    }
  });

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    try {
      if (e.surface !== 'terminal') return next(e);
      const spin = spins.resolve(e.requestId, e.props.durationMs);
      if (!spin) return next(e);
      return renderTurnDuration(spin);
    } catch (err) {
      return next(e);
    }
  });
}
