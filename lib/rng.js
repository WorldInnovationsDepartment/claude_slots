// Claude Slots — outcome-first RNG (lib/rng.js)
//
// Pure ESM, zero dependencies. Implements docs/ART-SPEC.md §4 ("do not spin
// three independent reels and hope the probabilities fall out right") and
// §5 (the near-miss rule): pick the outcome class first, resolve the
// payline to match it, then derive the two dressing rows purely from
// symbols.js's static neighbor table — no further randomness.
//
// NOTE on the §4 worked examples: ART-SPEC's six seed->outcome rows are
// attributed to "a reference mulberry32 implementation... included in
// build_spec.py" — that file only embeds the pseudocode as documentation
// text, it contains no runnable PRNG. mulberry32 below is the well-known
// public-domain algorithm (Tommy Ettinger); it was checked against two
// independent, commonly-cited mulberry32 encodings and against those six
// worked seeds — neither reproduces them bit-for-bit, so they could not be
// used as byte-exact golden vectors here (see this package's test notes).
// What *is* verified (tests/rng.test.js): the six-class probability table
// sums to 1 and matches within tolerance over a large sample, the near-miss
// shape is always exactly [S, S, NEXT(S)], dressing rows always equal
// PREV/NEXT of the payline per symbols.js, and a given seed always
// reproduces an identical result.

import { ALL_SYMBOL_IDS, NEIGHBORS, OUTCOME_ORDER, OUTCOME_PROBABILITIES, TRIPLE_TIERS, DOUBLE_TIERS, NEARMISS_WEIGHTS, REEL_STRIPS, getPayout } from './symbols.js';

/**
 * mulberry32: a fast, small, seedable 32-bit PRNG. Returns a function that
 * yields floats in [0, 1) on each call.
 * @param {number} seed a uint32 (values are coerced with `>>> 0`)
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function mulberry32Next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministically hash an arbitrary string to a uint32, for callers that
 * want to seed mulberry32 from a session id / turn id / free-form string
 * rather than a raw number. (cyrb-style FNV-1a variant — small, dependency
 * free, well distributed for this use, not cryptographic.)
 * @param {string} str
 * @returns {number}
 */
export function hashSeed(str) {
  const s = String(str);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // final avalanche so short/similar strings don't cluster in low bits
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

function toUint32Seed(seed) {
  if (typeof seed === 'number') return seed >>> 0;
  return hashSeed(seed);
}

/**
 * Weighted pick over an ordered {id: weight} map. Weights need not sum to
 * 1 — they are normalized against their own total, matching §4's
 * `weightedPick(rng, TABLE)` calls against tables whose weights are
 * fractions of the *outer* class probability (e.g. TRIPLE_TIERS sums to
 * 0.08, not 1).
 * @param {() => number} rng
 * @param {Record<string, number>} weights
 */
function weightedPick(rng, weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  const r = rng() * total;
  let acc = 0;
  for (const [id, w] of entries) {
    acc += w;
    if (r < acc) return id;
  }
  return entries[entries.length - 1][0];
}

function uniformPick(rng, ids) {
  const idx = Math.min(ids.length - 1, Math.floor(rng() * ids.length));
  return ids[idx];
}

function rollOutcomeClass(rng) {
  const r = rng();
  let acc = 0;
  for (const cls of OUTCOME_ORDER) {
    acc += OUTCOME_PROBABILITIES[cls];
    if (r < acc) return cls;
  }
  return 'LOSE'; // floating-point fallback, never reached if the table sums to 1.0
}

/**
 * True if `[a,b,c]` has the canonical near-miss shape (two matching reels,
 * the third the matched symbol's NEXT) in ANY reel arrangement. A guard used
 * only by the LOSE reroll loop; given the loop's own distinctness check this
 * can never actually trigger (a genuine near-miss requires exactly two equal
 * entries) — kept as the belt-and-suspenders check §4's pseudocode specifies.
 */
function looksLikeNearMiss(a, b, c) {
  const trip = [a, b, c];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (i === j) continue;
      const k = 3 - i - j;
      if (trip[i] === trip[j] && NEIGHBORS.NEXT[trip[i]] === trip[k]) return true;
    }
  }
  return false;
}

function resolvePayline(cls, rng) {
  switch (cls) {
    case 'JACKPOT':
      return ['CLAUDE', 'CLAUDE', 'CLAUDE'];
    case 'MEDALLION':
      return ['MEDALLION', 'MEDALLION', 'MEDALLION'];
    case 'TRIPLE': {
      const tier = weightedPick(rng, TRIPLE_TIERS);
      return [tier, tier, tier];
    }
    case 'DOUBLE': {
      const tier = weightedPick(rng, DOUBLE_TIERS);
      const oddPos = Math.floor(rng() * 3);
      const pool = ALL_SYMBOL_IDS.filter((id) => id !== tier && id !== 'MEDALLION');
      const filler = uniformPick(rng, pool);
      const paylineLine = [tier, tier, tier];
      paylineLine[oddPos] = filler;
      return paylineLine;
    }
    case 'NEAR_MISS': {
      const sym = weightedPick(rng, NEARMISS_WEIGHTS);
      return [sym, sym, NEIGHBORS.NEXT[sym]];
    }
    case 'LOSE':
    default: {
      const GUARD = 10000; // pathological-fallback guard; a correctly-weighted 8-symbol alphabet resolves in a handful of tries
      for (let i = 0; i < GUARD; i++) {
        const a = uniformPick(rng, ALL_SYMBOL_IDS);
        const b = uniformPick(rng, ALL_SYMBOL_IDS);
        const c = uniformPick(rng, ALL_SYMBOL_IDS);
        if (new Set([a, b, c]).size === 3 && !looksLikeNearMiss(a, b, c)) return [a, b, c];
      }
      return ['FILE', 'TEST', 'DIFF']; // never reached with 8 distinct symbols; a safe, definitely-3-distinct fallback
    }
  }
}

function fillNonPaylineRows(paylineSymbols) {
  return {
    above: paylineSymbols.map((s) => NEIGHBORS.PREV[s]),
    below: paylineSymbols.map((s) => NEIGHBORS.NEXT[s]),
  };
}

/**
 * Roll a full spin outcome for `seed` — deterministic: the same seed always
 * returns an identical result (verified in tests). Implements ART-SPEC §4-5
 * exactly: outcome class first, then payline, then pure (no further
 * randomness) dressing rows from the static neighbor table.
 *
 * @param {number|string} seed a uint32, or any string (hashed via hashSeed)
 * @param {{credits?: number}} [opts] accepted for forward-compatibility with
 *   callers that want to pass current-state context through; the paytable
 *   is a flat lookup per §2 and `credits` does not currently affect the roll.
 * @returns {{
 *   outcomeClass: 'JACKPOT'|'MEDALLION'|'TRIPLE'|'DOUBLE'|'NEAR_MISS'|'LOSE',
 *   tier: string|null,
 *   paylineSymbols: [string,string,string],
 *   grid: [string,string,string][],
 *   targetStops: [number,number,number],
 *   payout: number,
 *   overshootReel?: number,
 * }}
 */
export function rollOutcome(seed, opts = {}) {
  void opts; // see jsdoc: reserved, currently unused
  const rng = mulberry32(toUint32Seed(seed));
  const outcomeClass = rollOutcomeClass(rng);
  const paylineSymbols = resolvePayline(outcomeClass, rng);
  const { above, below } = fillNonPaylineRows(paylineSymbols);

  // grid[reel][row], row 0 = above the payline, row 1 = the payline itself, row 2 = below
  const grid = [0, 1, 2].map((reelIdx) => [above[reelIdx], paylineSymbols[reelIdx], below[reelIdx]]);

  // targetStops: the first-occurrence strip index each reel settles on. Using
  // first occurrence (the same convention symbols.js's NEIGHBORS table uses)
  // keeps grid's dressing rows consistent with "one stop above/below" on the
  // actual reel-strip window a renderer might display while settling.
  const targetStops = [0, 1, 2].map((reelIdx) => REEL_STRIPS[reelIdx].indexOf(paylineSymbols[reelIdx]));

  let tier = null;
  if (outcomeClass === 'TRIPLE') {
    tier = paylineSymbols[0];
  } else if (outcomeClass === 'DOUBLE') {
    const counts = {};
    for (const s of paylineSymbols) counts[s] = (counts[s] || 0) + 1;
    tier = Object.keys(counts).find((k) => counts[k] === 2) ?? null;
  }

  const payout = getPayout(outcomeClass, tier);

  const result = { outcomeClass, tier, paylineSymbols, grid, targetStops, payout };
  if (outcomeClass === 'NEAR_MISS') result.overshootReel = 2; // always reel 3 (index 2), per §5
  return result;
}

// Compatibility alias: some early integration sketches referred to this
// function as `roll`.
export { rollOutcome as roll };
