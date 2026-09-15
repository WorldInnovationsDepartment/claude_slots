// Claude Slots — credits economy (lib/economy.js)
//
// Pure ESM, zero dependencies. Implements docs/ART-SPEC.md §10: starting
// balance, spin cost charged at the lever (never on reveal), payouts,
// refunds for interrupted/errored spins, and the "ON THE HOUSE" floor —
// balance never goes negative and a spin is never blocked by lack of
// credits.

/** Starting balance for a brand-new session (§10; also plugin.json's userConfig default). */
export const DEFAULT_START_CREDITS = 100;

/** Cost of a single spin, in credits (§10). */
export const SPIN_COST = 1;

/**
 * @typedef {{
 *   credits: number,
 *   lastWin: number,
 *   stats: {
 *     spins: number,
 *     winsByClass: Record<string, number>,
 *     jackpots: number,
 *     streak: number,
 *     bestStreak: number,
 *     recent: string[],
 *   },
 * }} Economy
 */

/**
 * @param {{startCredits?: number}} [opts]
 * @returns {Economy}
 */
export function createEconomy(opts = {}) {
  const startCredits = Number.isFinite(opts.startCredits) ? Math.max(0, opts.startCredits) : DEFAULT_START_CREDITS;
  return {
    credits: startCredits,
    lastWin: 0,
    stats: {
      spins: 0,
      winsByClass: { JACKPOT: 0, MEDALLION: 0, TRIPLE: 0, DOUBLE: 0, NEAR_MISS: 0, LOSE: 0, ABORTED: 0, ERROR: 0 },
      jackpots: 0,
      streak: 0,
      bestStreak: 0,
      recent: [],
    },
  };
}

/**
 * Charge the spin cost the instant the lever is pulled (§8.2/§10 — never on
 * reveal). Floors at 0 rather than going negative or blocking the spin
 * ("ON THE HOUSE", §8.1/§10). Mutates and returns `economy`.
 * @param {Economy} economy
 * @returns {Economy}
 */
export function applySpinStart(economy) {
  economy.credits = Math.max(0, economy.credits - SPIN_COST);
  economy.stats.spins += 1;
  return economy;
}

function pushRecent(economy, cls, symbols) {
  economy.stats.recent.unshift({ outcomeClass: cls, symbols: symbols || null });
  if (economy.stats.recent.length > 3) economy.stats.recent.length = 3;
}

/**
 * Apply a resolved spin's consequence to `economy`. `outcome` is either an
 * rng.js rollOutcome() result ({outcomeClass, payout, paylineSymbols, ...})
 * for a completed turn ('answer'/'refusal'), or a synthetic
 * {outcomeClass: 'ABORTED'|'ERROR'} for an interrupted/errored turn — those
 * two refund the spin cost, since no payline was ever actually resolved
 * (§8.13-8.14, §10). Mutates and returns `economy`.
 *
 * `economy.stats.recent` holds, most-recent-first, up to 3
 * `{outcomeClass, symbols}` entries (`symbols` is the 3-wide payline, or
 * `null` for ABORTED/ERROR) — enough for art.js's GRAND-size RECENT field
 * (§7.3) to render each past spin's payline.
 *
 * @param {Economy} economy
 * @param {{outcomeClass: string, payout?: number, paylineSymbols?: string[]}} outcome
 * @returns {Economy}
 */
export function applyOutcome(economy, outcome) {
  const cls = outcome.outcomeClass;

  if (cls === 'ABORTED' || cls === 'ERROR') {
    economy.credits += SPIN_COST; // refund: this spin resolved no payline
    economy.lastWin = 0;
    economy.stats.winsByClass[cls] = (economy.stats.winsByClass[cls] || 0) + 1;
    economy.stats.streak = 0;
    pushRecent(economy, cls, null);
    return economy;
  }

  const payout = outcome.payout || 0;
  economy.credits += payout;
  economy.lastWin = payout;
  economy.stats.winsByClass[cls] = (economy.stats.winsByClass[cls] || 0) + 1;
  if (cls === 'JACKPOT') economy.stats.jackpots += 1;

  const isWin = payout > 0;
  economy.stats.streak = isWin ? economy.stats.streak + 1 : 0;
  economy.stats.bestStreak = Math.max(economy.stats.bestStreak, economy.stats.streak);

  pushRecent(economy, cls, outcome.paylineSymbols || null);
  return economy;
}

/** True at 0 credits — the "ON THE HOUSE" info-strip substitution applies (§8.1/§10). */
export function isOnTheHouse(economy) {
  return economy.credits <= 0;
}
