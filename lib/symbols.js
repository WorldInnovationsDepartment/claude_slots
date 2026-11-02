// Claude Slots — symbols, outcome classes, paytable (lib/symbols.js)
//
// Pure ESM, zero dependencies. Transcribed from docs/ART-SPEC.md: the six
// reel symbols (three win classes + three fillers), the outcome probability
// table, and the payouts. Every consumer (rng.js, economy.js, machine.js)
// reads these tables from here; tests/symbols.test.js guards the mirror.

/** Strip order, identical to the sprite sheet's `strip.symbols`. */
export const SYMBOL_IDS = Object.freeze(['FEATURE', 'CLIENT', 'LIFE', 'SKULL', 'EDDIES', 'CHIP']);

/** The three win classes, each landed by three of its own symbol on the payline. LIFE is the jackpot. */
export const WIN_CLASSES = Object.freeze(['FEATURE', 'CLIENT', 'LIFE']);

/** Outcome classes in the exact cumulative-probability order rng.js iterates. */
export const OUTCOME_ORDER = Object.freeze(['LIFE', 'CLIENT', 'FEATURE', 'LOSE']);

/** class -> P(class); sums to 1.0. */
export const OUTCOME_PROBABILITIES = Object.freeze({
  LIFE: 0.01,
  CLIENT: 0.04,
  FEATURE: 0.1,
  LOSE: 0.85,
});

/** class -> credits paid on completion (spin cost is 1, charged at the lever). */
export const PAYTABLE = Object.freeze({
  LIFE: 100,
  CLIENT: 20,
  FEATURE: 5,
  LOSE: 0,
});

/** What the transcript result line calls each outcome. */
export const OUTCOME_LABELS = Object.freeze({
  LIFE: 'A LIFE',
  CLIENT: 'CLIENT',
  FEATURE: 'FEATURE',
  LOSE: 'no match',
  ABORTED: 'interrupted',
  ERROR: 'malfunction',
});

/** Overlay sequence (sprite sheet key) played for each outcome. */
export const OUTCOME_OVERLAYS = Object.freeze({
  LIFE: 'win-life',
  CLIENT: 'win-client',
  FEATURE: 'win-feature',
  LOSE: 'lose',
  ABORTED: 'abort',
  ERROR: 'error',
});

export function getPayout(outcomeClass) {
  const p = PAYTABLE[outcomeClass];
  if (p === undefined) throw new Error(`getPayout: unknown outcome class ${JSON.stringify(outcomeClass)}`);
  return p;
}

export function isWinClass(outcomeClass) {
  return WIN_CLASSES.includes(outcomeClass);
}
