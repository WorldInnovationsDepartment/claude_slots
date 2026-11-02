// Claude Slots — pure helpers for the mod module (lib/mod-helpers.js)
//
// Everything hooks/slots.js needs that is ordinary data-in/data-out: option
// parsing, merging the persisted economy into a fresh state, and the queue
// that binds a finished spin to the TurnDuration instance that will draw it.
// No `$`, no `on`, no `next` — importable and testable from plain Node.

import { DEFAULT_START_CREDITS } from './economy.js';

export const STORE_KEY = 'slots.economy';
export const STORE_META_KEY = 'slots.meta';
export const MIN_SPRITE_COLUMNS = 40;
export const PENDING_CAP = 50;

export function resolveOptions(options) {
  const o = options || {};
  const startCreditsNum = Number(o.startCredits);
  return {
    startCredits: Number.isFinite(startCreditsNum) && startCreditsNum >= 0 && startCreditsNum <= 100000 ? startCreditsNum : DEFAULT_START_CREDITS,
  };
}

/** Deep-clone via JSON round-trip — machine State is plain JSON-serializable data. */
export function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Fold a persisted economy record into `state.economy` (ignores anything malformed). */
export function mergeStoredEconomy(state, stored) {
  if (!stored || typeof stored !== 'object') return state;
  if (Number.isFinite(stored.credits)) state.economy.credits = Math.max(0, stored.credits);
  if (Number.isFinite(stored.lastWin)) state.economy.lastWin = Math.max(0, stored.lastWin);
  const storedStats = stored.stats;
  if (storedStats && typeof storedStats === 'object') {
    const s = state.economy.stats;
    if (Number.isFinite(storedStats.spins)) s.spins = storedStats.spins;
    if (storedStats.winsByClass && typeof storedStats.winsByClass === 'object') {
      for (const [k, v] of Object.entries(storedStats.winsByClass)) if (Number.isFinite(v)) s.winsByClass[k] = v;
    }
    if (Number.isFinite(storedStats.jackpots)) s.jackpots = storedStats.jackpots;
    if (Number.isFinite(storedStats.streak)) s.streak = storedStats.streak;
    if (Number.isFinite(storedStats.bestStreak)) s.bestStreak = storedStats.bestStreak;
    if (Array.isArray(storedStats.recent)) s.recent = storedStats.recent.slice(0, 3);
  }
  return state;
}

/** The status-line notice for a refunded turn. */
export function refundNotice(reason) {
  return reason === 'error' ? 'MALFUNCTION · refunded' : 'INTERRUPTED · refunded';
}

/**
 * Finished spins waiting for (or bound to) a TurnDuration instance. Each
 * TurnDuration mounts with a fresh requestId, so a spin is matched by its
 * `durationMs`, falling back to the oldest pending spin.
 */
export class SpinQueue {
  constructor(cap = PENDING_CAP) {
    this.cap = cap;
    this.pending = [];
    this.bound = new Map();
  }

  push(spin) {
    this.pending.push(spin);
    if (this.pending.length > this.cap) this.pending.splice(0, this.pending.length - this.cap);
  }

  /** @returns the spin for this instance, binding it on first sight, or null when nothing is waiting. */
  resolve(requestId, durationMs) {
    if (this.bound.has(requestId)) return this.bound.get(requestId);
    if (this.pending.length === 0) return null;
    let idx = this.pending.findIndex((s) => s.durationMs === durationMs);
    if (idx === -1) idx = 0;
    const spin = this.pending.splice(idx, 1)[0];
    this.bound.set(requestId, spin);
    if (this.bound.size > this.cap) this.bound.delete(this.bound.keys().next().value);
    return spin;
  }

  clear() {
    this.pending = [];
    this.bound = new Map();
  }
}

/** True when the viewport is too narrow for the 40-column sprite (unknown width counts as wide enough). */
export function isNarrow(viewport) {
  return !!viewport && Number.isFinite(viewport.columns) && viewport.columns < MIN_SPRITE_COLUMNS;
}

export const MIN_SPRITE_ROWS = 10;

/**
 * Whether the AbovePrompt band has room for the 40 x 10 sprite. `props` is
 * the band's render input (`bodyColumns`, `maxRows`); anything missing or
 * too small means the one-line fallback.
 */
export function bandFitsSprite(props) {
  if (!props) return false;
  const cols = Number(props.bodyColumns);
  const rows = Number(props.maxRows);
  return Number.isFinite(cols) && Number.isFinite(rows) && cols >= MIN_SPRITE_COLUMNS && rows >= MIN_SPRITE_ROWS;
}

/**
 * Wraps a rendered tree in a full-width row Box that pushes it to the right
 * edge of the band, so the machine sits at the bottom-right of the screen
 * whatever the terminal width. `columns` is the band's `bodyColumns`.
 */
export function bandTree(tree, columns) {
  const props = { flexDirection: 'row', justifyContent: 'flex-end' };
  const width = Number(columns);
  if (Number.isFinite(width) && width > 0) props.width = width;
  return { type: 'Box', props, children: [tree] };
}
