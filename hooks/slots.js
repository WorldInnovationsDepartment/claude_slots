// Claude Slots — Tier 1 function-hooks module (hooks/slots.js)
//
// Replaces the built-in Spinner / TurnDuration / AbovePrompt components with
// the animated slot machine from lib/ (docs/ARCHITECTURE.md §4). This is the
// ONLY file in the plugin allowed to touch `$` / `on` / `next` — the static
// scanner enforces (per `claude plugin validate` and the fh2 spike evidence
// in docs/ART-SPEC.md's sibling research) that:
//
//   - `register` is a same-file exported function.
//   - Every `$` use is either `$.noun.method(...)` written directly inside a
//     hook body / a top-level helper, or `$` passed *whole* as an argument
//     to a top-level function declared in this same file (never stored in a
//     variable, spread, exported, destructured, or shadowed).
//   - `next` is only ever called directly as `next(e)`, inline inside the
//     `on(...)` callback that received it (never forwarded to a helper).
//   - `on` is only ever called directly inside `register(...)`.
//   - Everything else (rng, machine state, art, rendering) lives in lib/ and
//     is imported as plain, `$`-free functions/data.
//
// Every hook body is wrapped in try/catch and falls back to `next(e)` (or a
// silent no-op for observe-only events) — a hook that throws is skipped by
// the engine, so we never want that to be the *first* time something here
// fails; better to degrade to the native spinner/footer than to vanish.

import * as machine from '../lib/machine.js';
import { renderTree } from '../lib/render-tree.js';
import { hashSeed } from '../lib/rng.js';
import { DEFAULT_START_CREDITS } from '../lib/economy.js';

// ---------------------------------------------------------------------------
// Module-level state. Kept at true module scope (not inside `register`) per
// docs/ARCHITECTURE.md §4's robustness note ("keep per-plugin state
// module-level"); `session.start` is treated as the reload/reset signal and
// clears the transient (non-persisted) parts on every fire, including a
// later reload — only the economy (credits/stats) survives via `$.store`.
// ---------------------------------------------------------------------------

const SIZE_VALUES = new Set(['auto', 'compact', 'standard', 'grand']);
const IDLE_VALUES = new Set(['off', 'compact', 'full']);
const THEME_VALUES = new Set(['classic', 'emoji']);
const SOUND_VALUES = new Set(['off', 'on']);

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const PENDING_CAP = 50;
const SOUND_BUDGET_PER_SESSION = 500;
const ABORTED_STATUS_MS = 3500;

/** Resolved plugin options for this activation (set once, at the top of `register`). */
let cfg = { size: 'auto', idle: 'compact', theme: 'classic', sound: 'off', startCredits: DEFAULT_START_CREDITS };

/** The session's one running machine (lib/machine.js State — plain JSON data). */
let liveState = null;

/** The in-flight turn's id, remembered for observability only. */
let currentTurnId = null;

/** Last turn.step-with-tool-calls timestamp — a harmless, optional flourish flag (§ turn.step). */
let toolPulseAt = 0;

/** The shared ~10fps redraw ticker (docs/ARCHITECTURE.md §1: floor 100ms). */
let tickerHandle = null;
let tickerRunning = false;

/** Bumped on every pullLever; lets a stale scheduled ticker-stop recognize a newer spin started. */
let spinGeneration = 0;

/** Spins whose turn.complete has fired but which no TurnDuration instance has claimed yet (FIFO). */
let pendingSpins = [];

/** Once a TurnDuration instance's requestId is matched to a spin, it stays bound here (capped). */
let boundSpins = new Map();

/** `$.audio.play` calls made this session (defensive cap; §sound option). */
let soundPlaysThisSession = 0;

// ---------------------------------------------------------------------------
// Small pure helpers — ordinary data in, ordinary data out, no `$`/`on`/`next`.
// ---------------------------------------------------------------------------

function pickOneOf(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

function resolveOptions(options) {
  const o = options || {};
  const startCreditsNum = Number(o.startCredits);
  return {
    size: pickOneOf(o.size, SIZE_VALUES, 'auto'),
    idle: pickOneOf(o.idle, IDLE_VALUES, 'compact'),
    theme: pickOneOf(o.theme, THEME_VALUES, 'classic'),
    sound: pickOneOf(o.sound, SOUND_VALUES, 'off'),
    startCredits: Number.isFinite(startCreditsNum) && startCreditsNum >= 0 ? startCreditsNum : DEFAULT_START_CREDITS,
  };
}

/** Deep-clone via JSON round-trip — machine State is plain JSON-serializable data (lib/machine.js's own guarantee). */
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeStoredEconomy(state, stored) {
  if (!stored || typeof stored !== 'object') return;
  if (Number.isFinite(stored.credits)) state.economy.credits = Math.max(0, stored.credits);
  if (Number.isFinite(stored.lastWin)) state.economy.lastWin = Math.max(0, stored.lastWin);
  const storedStats = stored.stats;
  if (storedStats && typeof storedStats === 'object') {
    const s = state.economy.stats;
    if (Number.isFinite(storedStats.spins)) s.spins = storedStats.spins;
    if (storedStats.winsByClass && typeof storedStats.winsByClass === 'object') {
      Object.assign(s.winsByClass, storedStats.winsByClass);
    }
    if (Number.isFinite(storedStats.jackpots)) s.jackpots = storedStats.jackpots;
    if (Number.isFinite(storedStats.streak)) s.streak = storedStats.streak;
    if (Number.isFinite(storedStats.bestStreak)) s.bestStreak = storedStats.bestStreak;
    if (Array.isArray(storedStats.recent)) s.recent = storedStats.recent.slice(0, 3);
  }
}

/** AbovePrompt's chassis size: compact 2-line form when cramped or requested, else standard (never grand — §7.3/§7.2 budget for this band). */
function resolveAboveSize(idleOption, columns, maxRows) {
  if (idleOption === 'compact') return 'compact';
  if (Number.isFinite(maxRows) && maxRows < 12) return 'compact';
  if (Number.isFinite(columns) && columns < 62) return 'compact';
  return 'standard';
}

function outcomeSoundKind(outcomeClass) {
  if (outcomeClass === 'JACKPOT' || outcomeClass === 'MEDALLION') return 'jackpot';
  if (outcomeClass === 'TRIPLE' || outcomeClass === 'DOUBLE') return 'coin';
  return null;
}

function soundAssetFor(kind) {
  if (kind === 'lever') return 'fx/lever-click.wav';
  if (kind === 'jackpot') return 'fx/jackpot-chord.wav';
  return 'fx/coin-ding.wav';
}

/** Binds a fresh requestId to `spin`, evicting the oldest bound entry once over the cap (§ TurnDuration binding). */
function bindSpin(requestId, spin) {
  boundSpins.set(requestId, spin);
  if (boundSpins.size > PENDING_CAP) {
    const oldestKey = boundSpins.keys().next().value;
    boundSpins.delete(oldestKey);
  }
}

/** Resolves a TurnDuration instance's requestId to the spin it belongs to: exact durationMs match, else oldest pending (FIFO). */
function resolveSpinForRequest(requestId, durationMs) {
  if (boundSpins.has(requestId)) return boundSpins.get(requestId);
  if (pendingSpins.length === 0) return null;
  let idx = pendingSpins.findIndex((s) => s.durationMs === durationMs);
  if (idx === -1) idx = 0;
  const spin = pendingSpins.splice(idx, 1)[0];
  bindSpin(requestId, spin);
  return spin;
}

function pushPendingSpin(spin) {
  pendingSpins.push(spin);
  if (pendingSpins.length > PENDING_CAP) pendingSpins.splice(0, pendingSpins.length - PENDING_CAP);
}

function resetTransientState() {
  stopTickerNow();
  if (statusClearHandle) {
    statusClearHandle.cancel();
    statusClearHandle = null;
  }
  pendingSpins = [];
  boundSpins = new Map();
  currentTurnId = null;
  toolPulseAt = 0;
  soundPlaysThisSession = 0;
  spinGeneration += 1;
}

// ---------------------------------------------------------------------------
// Ticker — the shared ~10fps redraw heartbeat (docs/ARCHITECTURE.md §1/§4).
// Named top-level functions forwarding `$` explicitly, mirroring the
// validated fh2 spike pattern exactly (`$.clock.every`/`$.clock.after`
// attributed by the scanner through these same helpers).
// ---------------------------------------------------------------------------

function tick($) {
  $.ui.invalidate('ui.render');
}

function startTicker($) {
  if (tickerRunning) return;
  tickerRunning = true;
  tickerHandle = $.clock.every(100, () => tick($));
}

function stopTickerNow() {
  if (tickerHandle) {
    tickerHandle.cancel();
    tickerHandle = null;
  }
  tickerRunning = false;
}

/**
 * Keeps the ticker running until this spin's animation has genuinely
 * finished (machine.isAnimating false), then stops it, instead of a
 * fixed-ms guess. A fixed guess previously only counted OUTCOME's own
 * duration and forgot the STOPPING+REVEAL time that precedes it (~0.9-1s),
 * so the ticker died ~400-500ms before the reveal actually finished,
 * freezing the last stretch of every win/loss animation on a stale frame.
 * `gen` (the spin generation captured when this poll started) lets a newer
 * spin's own poll silently take over — see spinGeneration's other use in
 * maybePullLever.
 */
function pollTickerStop($, gen) {
  if (gen !== spinGeneration) return; // a newer spin now owns the ticker
  if (liveState && machine.isAnimating(liveState, $.clock.now())) {
    $.clock.after(200, () => pollTickerStop($, gen));
    return;
  }
  stopTickerNow();
}

/** The pending timer that will clear the status line set by the most recent setTimedStatus() call. */
let statusClearHandle = null;

function clearStatus($) {
  $.ui.status(undefined);
}

/**
 * Pins a status line for `ms`, then clears it — `$.ui.status` itself never
 * auto-expires. Tracks (and cancels) any previously-scheduled clear so two
 * calls within `ms` of each other can't race: without this, an earlier
 * call's deferred clear could fire *after* a later call set new text,
 * wiping it out early (same "untracked timer" class of bug `tickerHandle`
 * is already careful about — see pollTickerStop above).
 */
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

function playSoundAsset($, kind) {
  $.audio.play({ asset: soundAssetFor(kind) }).catch(() => {});
}

/** Fire-and-forget: never awaited (so a slow/failed clip never delays the hook that triggered it). */
function maybePlaySound($, kind) {
  if (cfg.sound !== 'on' || !kind) return;
  if (soundPlaysThisSession >= SOUND_BUDGET_PER_SESSION) return;
  soundPlaysThisSession += 1;
  playSoundAsset($, kind);
}

function notifyJackpot($, amount) {
  $.ui.toast(`JACKPOT! +${amount} credits`);
}

/** aborted turns never get a TurnDuration render (measured fact, docs/ARCHITECTURE.md §4) — AbovePrompt is the only place JAM can show; when the idle band itself is off, fall back to a timed status line. */
function notifyAborted($) {
  if (cfg.idle === 'off') setTimedStatus($, '… INTERRUPTED …', ABORTED_STATUS_MS);
}

// ---------------------------------------------------------------------------
// $-touching async helpers (store/session reads) — each receives `$` as its
// first argument, used only as `$.noun.method(...)`.
// ---------------------------------------------------------------------------

async function loadStoredEconomy($) {
  try {
    return await $.store.get('economy');
  } catch (err) {
    return undefined;
  }
}

async function saveEconomy($, economy) {
  try {
    await $.store.set('economy', cloneJson(economy));
  } catch (err) {
    // persistence is best-effort; losing one write never blocks the turn
  }
}

async function recordTier1Marker($) {
  const sessionId = await $.session.id();
  const now = $.clock.now();
  let prevSessions = {};
  try {
    const prev = await $.store.get('tier1');
    if (prev && typeof prev === 'object' && prev.sessions && typeof prev.sessions === 'object') {
      prevSessions = prev.sessions;
    }
  } catch (err) {
    prevSessions = {};
  }
  const cutoff = now - TWO_DAYS_MS;
  const sessions = {};
  for (const key of Object.keys(prevSessions)) {
    const ts = prevSessions[key];
    if (Number.isFinite(ts) && ts >= cutoff) sessions[key] = ts;
  }
  sessions[sessionId] = now;
  await $.store.set('tier1', { sessions });
}

async function initSession($) {
  const stored = await loadStoredEconomy($);
  const state = machine.createState({
    startCredits: cfg.startCredits,
    theme: cfg.theme,
    grandEnabled: cfg.size === 'grand',
  });
  mergeStoredEconomy(state, stored);
  await recordTier1Marker($);
  return state;
}

async function maybePullLever($, e) {
  if (!liveState) liveState = machine.createState({ startCredits: cfg.startCredits, theme: cfg.theme, grandEnabled: cfg.size === 'grand' });
  const now = $.clock.now();
  // Only refuse when a turn is genuinely still in flight (stop() hasn't
  // landed yet) — Claude Code never fires prompt.submit for a new turn
  // while one is still running, so this only guards a defensive double-fire
  // of the same in-flight turn. It deliberately does NOT check
  // machine.isAnimating(): that also covers the OUTCOME reveal that plays
  // for a couple of seconds *after* stop() — blocking a new spin during
  // that window silently dropped the next turn's entire visual result (see
  // handleTurnComplete's own stopAt-not-null guard below), which is what
  // made fast back-to-back turns look "frozen" with no win/loss animation.
  // Once a spin is stopped its economics are already final, so a new lever
  // pull is always safe to cut its cosmetic reveal short.
  if (liveState.leverAt != null && liveState.stopAt == null) return;
  const sessionId = await $.session.id();
  const turnCount = await $.session.turnCount();
  const seed = hashSeed(sessionId + ':' + turnCount + ':' + now);
  machine.pullLever(liveState, now, seed);
  spinGeneration += 1;
  startTicker($);
  maybePlaySound($, 'lever');
}

async function handleTurnComplete($, e) {
  if (!liveState) return;
  if (liveState.leverAt == null || liveState.stopAt != null) return; // no lever pulled for this turn, or already resolved
  const now = $.clock.now();
  machine.stop(liveState, now, e.reason);
  currentTurnId = null;

  const resultSnapshot = cloneJson(liveState);
  pushPendingSpin({ turnId: e.turnId, durationMs: e.durationMs, resultSnapshot });

  await saveEconomy($, liveState.economy);

  const outcomeClass = e.reason === 'aborted' ? 'ABORTED' : e.reason === 'error' ? 'ERROR' : liveState.outcome.outcomeClass;

  if (e.reason === 'aborted') {
    notifyAborted($);
  } else if (outcomeClass === 'JACKPOT') {
    notifyJackpot($, liveState.economy.lastWin);
  }
  maybePlaySound($, outcomeSoundKind(outcomeClass));

  pollTickerStop($, spinGeneration);
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
      return next(e);
    } catch (err) {
      return next(e);
    }
  });

  on('prompt.submit', async ($, e, next) => {
    // Run the rest of the chain FIRST and inspect what it resolved to before
    // committing to a spin: a downstream plugin/policy hook can legitimately
    // stop the turn with `{ drop: reason }` (claude-code.d.ts), in which case
    // turn.start/turn.complete never fire for this prompt. Pulling the lever
    // unconditionally beforehand — the old order — left the machine wedged
    // in SPINNING forever (no time cap on that phase) and blocked every
    // future lever pull, since the ticker is only ever stopped from
    // turn.complete. next(e) is intentionally NOT wrapped in the try below:
    // it must be called exactly once, so a failure in it propagates and lets
    // the engine skip this whole hook rather than risk a double-invoke.
    const result = await next(e);
    try {
      if (!(result && result.drop)) {
        await maybePullLever($, e);
      }
    } catch (err) {
      // pulling the lever is our own visual bookkeeping — never let a
      // failure here affect the prompt.submit result the chain already produced
    }
    return result;
  });

  on('turn.start', async ($, e, next) => {
    try {
      currentTurnId = e.turnId;
      return next(e);
    } catch (err) {
      return next(e);
    }
  });

  on('turn.step', async ($, e, next) => {
    try {
      if (e.toolUses && e.toolUses.length > 0) toolPulseAt = $.clock.now();
      return next(e);
    } catch (err) {
      return next(e);
    }
  });

  on('turn.complete', async ($, e, next) => {
    try {
      await handleTurnComplete($, e);
    } catch (err) {
      // never let our own bookkeeping alter or block the turn's answer
    }
    return next(e);
  });

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    try {
      if (e.surface !== 'terminal') return next(e);
      if (!liveState) return next(e);
      // Ticker lifecycle is owned solely by prompt.submit/turn.complete (see
      // those hooks below) — a render hook must never restart it itself: an
      // unrelated external ui.render invalidate arriving after our own
      // scheduled ticker-stop would otherwise resurrect a ticker with no
      // future stop ever scheduled for it again. (Caught live in testing: an
      // unrelated invalidate ~30s after a turn.complete reignited a ticker
      // that then ran forever, because startTicker($) used to live here too.)
      const now = $.clock.now();
      const columns = e.viewport ? e.viewport.columns : undefined;
      const elapsedMs = liveState.leverAt != null ? Math.max(0, now - liveState.leverAt) : 0;
      const info = { elapsedMs, mode: e.props.mode, tokens: null, toolPulseAt };
      const built = machine.frame(liveState, now, { size: cfg.size, columns, info });
      return renderTree(built);
    } catch (err) {
      return next(e);
    }
  });

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    try {
      if (e.surface !== 'terminal') return next(e);
      // See the Spinner hook above: the ticker's lifecycle is never
      // restarted from a render hook.
      const spin = resolveSpinForRequest(e.requestId, e.props.durationMs);
      if (!spin) return next(e);
      const now = $.clock.now();
      const columns = e.viewport ? e.viewport.columns : undefined;
      if (machine.isAnimating(spin.resultSnapshot, now)) {
        const built = machine.frame(spin.resultSnapshot, now, { size: cfg.size, columns, info: {} });
        return renderTree(built);
      }
      const built = machine.resultLine(spin.resultSnapshot, { columns });
      return renderTree(built);
    } catch (err) {
      return next(e);
    }
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      if (e.surface !== 'terminal') return next(e);
      if (cfg.idle === 'off' || e.props.hasSurvey) return next(e);
      if (!liveState) return next(e);
      const now = $.clock.now();
      const columns = e.viewport ? e.viewport.columns : undefined;
      const maxRows = e.props.maxRows;
      const size = resolveAboveSize(cfg.idle, columns, maxRows);
      const elapsedMs = liveState.leverAt != null ? Math.max(0, now - liveState.leverAt) : 0;
      const info = { elapsedMs, tokens: null };
      const built = machine.frame(liveState, now, { size, columns, maxRows, info });
      return renderTree(built);
    } catch (err) {
      return next(e);
    }
  });
}
