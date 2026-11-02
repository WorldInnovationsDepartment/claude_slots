// Claude Slots — outcome-first RNG (lib/rng.js)
//
// Pure ESM, zero dependencies. Pick the outcome class first from the
// probability table, then resolve the three payline symbols to match it,
// so the table is exact by construction instead of emerging from three
// independent reels. A given seed always reproduces the same result.

import { SYMBOL_IDS, OUTCOME_ORDER, OUTCOME_PROBABILITIES, getPayout } from './symbols.js';

/** mulberry32: a fast, small, seedable 32-bit PRNG yielding floats in [0, 1). */
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

/** Deterministically hash any string to a uint32 (FNV-1a variant with a final avalanche). */
export function hashSeed(str) {
  const s = String(str);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

function toUint32Seed(seed) {
  if (typeof seed === 'number') return seed >>> 0;
  return hashSeed(seed);
}

function rollOutcomeClass(rng) {
  const r = rng();
  let acc = 0;
  for (const cls of OUTCOME_ORDER) {
    acc += OUTCOME_PROBABILITIES[cls];
    if (r < acc) return cls;
  }
  return 'LOSE';
}

function uniformPick(rng, ids) {
  return ids[Math.min(ids.length - 1, Math.floor(rng() * ids.length))];
}

/**
 * @param {number|string} seed
 * @returns {{outcomeClass: 'LIFE'|'CLIENT'|'FEATURE'|'LOSE', symbols: [string,string,string], payout: number}}
 */
export function rollOutcome(seed) {
  const rng = mulberry32(toUint32Seed(seed));
  const outcomeClass = rollOutcomeClass(rng);
  let symbols;
  if (outcomeClass === 'LOSE') {
    // any triple that is not three of a kind; a pair is a natural near miss
    for (let i = 0; i < 100; i++) {
      const a = uniformPick(rng, SYMBOL_IDS);
      const b = uniformPick(rng, SYMBOL_IDS);
      const c = uniformPick(rng, SYMBOL_IDS);
      if (!(a === b && b === c)) {
        symbols = [a, b, c];
        break;
      }
    }
    if (!symbols) symbols = ['PILLS', 'GUN', 'AGENT'];
  } else {
    symbols = [outcomeClass, outcomeClass, outcomeClass];
  }
  return { outcomeClass, symbols, payout: getPayout(outcomeClass) };
}

export { rollOutcome as roll };
