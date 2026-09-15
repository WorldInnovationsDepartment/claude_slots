// Claude Slots — symbols, strips, paytable, colors (lib/symbols.js)
//
// Pure ESM, zero dependencies. Transcribed literally from docs/ART-SPEC.md
// §1 (symbol set), §2 (paytable/probabilities), §3 (reel strips + neighbor
// table), §9 (color spec), §14 (optional emoji theme). Every table here is
// treated as golden — if a number changes, it changes here first, and every
// consumer (rng.js, economy.js, art.js) reads it from this module rather
// than re-declaring it.

// ---------------------------------------------------------------------------
// §1 — Symbol set & Claude Code semantics
// ---------------------------------------------------------------------------

/** Canonical symbol ids, in the order §1's table lists them. */
export const SYMBOL_IDS = Object.freeze(['CLAUDE', 'MEDALLION', 'TOOL', 'TEST', 'DIFF', 'FILE', 'TOKEN', 'PROSE']);

/** Every symbol id except the two "shaped" combos (never a plain DOUBLE/TRIPLE filler in the LOSE/DOUBLE-filler pools where excluded explicitly by the caller). */
export const ALL_SYMBOL_IDS = SYMBOL_IDS;

const SYMBOLS_RAW = {
  CLAUDE: {
    glyph: '✻',
    name: 'CLAUDE',
    concept:
      'The assistant itself — the top symbol, U+273B, sanctioned single-width exception (matches Claude Code’s own spinner)',
    tier: 'Top',
    dressingWeight: 1.2,
    color: { hex: '#F5A623', ansi256: 214, bold: true },
  },
  MEDALLION: {
    glyph: '◆C◆',
    name: 'MEDALLION',
    concept: "Claude's signature — a completed, clean turn. Special rarity tier, sits between JACKPOT and TRIPLE",
    tier: 'Special',
    dressingWeight: 0.3,
    color: { hex: '#FF8A3D', ansi256: 208, bold: true },
  },
  TOOL: {
    glyph: 'BAR',
    name: 'TOOL',
    concept: 'An active/loaded tool call',
    tier: 'High',
    dressingWeight: 7.0,
    color: { hex: '#C77DFF', ansi256: 141 },
  },
  TEST: {
    glyph: '★',
    name: 'TEST',
    concept: 'A passing test / green check',
    tier: 'High',
    dressingWeight: 3.5,
    color: { hex: '#FFD166', ansi256: 221 },
  },
  DIFF: {
    glyph: '♦',
    name: 'DIFF',
    concept: 'A code diff / edit',
    tier: 'Mid-high',
    dressingWeight: 24.0,
    color: { hex: '#4ADE80', ansi256: 114 },
  },
  FILE: {
    glyph: '♣',
    name: 'FILE',
    concept: 'A file read/write',
    tier: 'Mid',
    dressingWeight: 20.0,
    color: { hex: '#9CA3AF', ansi256: 249 },
  },
  TOKEN: {
    glyph: '☼',
    name: 'TOKEN',
    concept: 'A token — also literally the credit/coin glyph used in coin-rain',
    tier: 'Mid-low',
    dressingWeight: 14.0,
    color: { hex: '#F5A623', ansi256: 214 },
  },
  PROSE: {
    glyph: '♥',
    name: 'PROSE',
    concept: 'Creative/explanatory prose generation',
    tier: 'Low',
    dressingWeight: 30.0,
    color: { hex: '#F472B6', ansi256: 211 },
  },
};

/** id -> {glyph, name, concept, tier, dressingWeight, color}. */
export const SYMBOLS = Object.freeze(
  Object.fromEntries(Object.entries(SYMBOLS_RAW).map(([id, v]) => [id, Object.freeze({ id, ...v, color: Object.freeze({ ...v.color }) })]))
);

/** @param {string} id @returns {typeof SYMBOLS[keyof typeof SYMBOLS]} */
export function getSymbol(id) {
  const s = SYMBOLS[id];
  if (!s) throw new Error(`getSymbol: unknown symbol id ${JSON.stringify(id)}`);
  return s;
}

/** @param {string} id @returns {string} the display glyph, e.g. 'BAR', '✻', '◆C◆' */
export function getGlyph(id) {
  return getSymbol(id).glyph;
}

// ---------------------------------------------------------------------------
// §3 — Canonical reel strips & neighbor table
// ---------------------------------------------------------------------------

// Three different-length circular strips, hard-coded verbatim from §3.
const REEL_1 = [
  'CLAUDE', 'TOOL', 'TEST', 'TOKEN', 'FILE', 'DIFF', 'PROSE', 'MEDALLION',
  'TOOL', 'TOKEN', 'FILE', 'DIFF', 'PROSE', 'TOKEN', 'FILE', 'DIFF', 'PROSE',
  'FILE', 'DIFF', 'PROSE', 'PROSE', 'PROSE',
];
const REEL_2 = [
  'CLAUDE', 'TOOL', 'TEST', 'TOKEN', 'FILE', 'DIFF', 'PROSE', 'MEDALLION',
  'TOOL', 'TOKEN', 'FILE', 'DIFF', 'PROSE', 'TOKEN', 'FILE', 'DIFF', 'PROSE',
  'FILE', 'DIFF', 'PROSE', 'FILE', 'DIFF', 'PROSE', 'PROSE',
];
const REEL_3 = [
  'CLAUDE', 'TOOL', 'TEST', 'TOKEN', 'FILE', 'DIFF', 'PROSE', 'MEDALLION',
  'TOOL', 'TOKEN', 'FILE', 'DIFF', 'PROSE', 'TOKEN', 'FILE', 'DIFF', 'PROSE',
  'DIFF', 'PROSE', 'PROSE',
];

/** REEL_STRIPS[0..2] — 22, 24, and 20 stops respectively (ART-SPEC §3). */
export const REEL_STRIPS = Object.freeze([Object.freeze(REEL_1), Object.freeze(REEL_2), Object.freeze(REEL_3)]);

/** @param {0|1|2} reelIndex @returns {readonly string[]} */
export function getStrip(reelIndex) {
  const strip = REEL_STRIPS[reelIndex];
  if (!strip) throw new Error(`getStrip: reelIndex must be 0, 1, or 2, got ${JSON.stringify(reelIndex)}`);
  return strip;
}

function computeNeighbors(strip) {
  const next = {};
  const prev = {};
  for (const id of SYMBOL_IDS) {
    const first = strip.indexOf(id);
    if (first === -1) throw new Error(`computeNeighbors: symbol ${id} missing from strip`);
    next[id] = strip[(first + 1) % strip.length];
    prev[id] = strip[(first - 1 + strip.length) % strip.length];
  }
  return { NEXT: Object.freeze(next), PREV: Object.freeze(prev) };
}

// Derived from reel 1 per §3's stated rule (first-occurrence +1/-1 mod
// length). §3 guarantees this table comes out identical for all three
// reels since the four rare symbols share the same head-of-strip layout —
// asserted below rather than assumed.
const NEIGHBORS_FROM_REEL1 = computeNeighbors(REEL_1);
for (const strip of [REEL_2, REEL_3]) {
  const n = computeNeighbors(strip);
  for (const id of SYMBOL_IDS) {
    if (n.NEXT[id] !== NEIGHBORS_FROM_REEL1.NEXT[id] || n.PREV[id] !== NEIGHBORS_FROM_REEL1.PREV[id]) {
      throw new Error(`symbols.js: neighbor table diverges between reels for ${id} — REEL_STRIPS transcription bug`);
    }
  }
}

/** { NEXT: {id -> id}, PREV: {id -> id} } — one static table shared by all three reels (§3). */
export const NEIGHBORS = NEIGHBORS_FROM_REEL1;

/** @param {'NEXT'|'PREV'} dir @param {string} id */
export function getNeighbor(dir, id) {
  const table = NEIGHBORS[dir];
  if (!table) throw new Error(`getNeighbor: dir must be 'NEXT' or 'PREV', got ${JSON.stringify(dir)}`);
  const v = table[id];
  if (!v) throw new Error(`getNeighbor: unknown symbol id ${JSON.stringify(id)}`);
  return v;
}

// ---------------------------------------------------------------------------
// §2 — Paytable & probability table
// ---------------------------------------------------------------------------

/** Outcome classes, in the exact cumulative-probability order §4's rollOutcomeClass iterates. */
export const OUTCOME_ORDER = Object.freeze(['JACKPOT', 'MEDALLION', 'TRIPLE', 'DOUBLE', 'NEAR_MISS', 'LOSE']);

/** class -> P(class); sums to 1.0 (verified in tests/probabilities.test.js). */
export const OUTCOME_PROBABILITIES = Object.freeze({
  JACKPOT: 0.015,
  MEDALLION: 0.025,
  TRIPLE: 0.08,
  DOUBLE: 0.26,
  NEAR_MISS: 0.12,
  LOSE: 0.5,
});

/** Sub-tier weights for a rolled TRIPLE, of the class's own 0.08 (§4's resolvePayline). */
export const TRIPLE_TIERS = Object.freeze({
  TOOL: 0.01,
  TEST: 0.01,
  TOKEN: 0.012,
  FILE: 0.015,
  DIFF: 0.016,
  PROSE: 0.017,
});

/** Sub-tier weights for a rolled DOUBLE, of the class's own 0.26. */
export const DOUBLE_TIERS = Object.freeze({
  CLAUDE: 0.01,
  TOOL: 0.01,
  TEST: 0.02,
  TOKEN: 0.03,
  FILE: 0.045,
  DIFF: 0.065,
  PROSE: 0.08,
});

/** Weights for which symbol a NEAR_MISS teases with — deliberately biased toward rarer/flashier symbols, NOT the §1 dressing weights. Sums to 1.0. */
export const NEARMISS_WEIGHTS = Object.freeze({
  CLAUDE: 0.3,
  MEDALLION: 0.2,
  TOOL: 0.15,
  TEST: 0.12,
  TOKEN: 0.1,
  FILE: 0.06,
  DIFF: 0.04,
  PROSE: 0.03,
});

/** Paytable (§2) — spin cost 1 credit. JACKPOT/MEDALLION have no tier; TRIPLE/DOUBLE are keyed by the matched symbol id; NEAR_MISS/LOSE always pay 0. */
export const PAYTABLE = Object.freeze({
  JACKPOT: 250,
  MEDALLION: 77,
  TRIPLE: Object.freeze({ TOOL: 40, TEST: 35, TOKEN: 25, FILE: 18, DIFF: 12, PROSE: 8 }),
  DOUBLE: Object.freeze({ CLAUDE: 10, TOOL: 6, TEST: 5, TOKEN: 4, FILE: 3, DIFF: 2, PROSE: 1 }),
  NEAR_MISS: 0,
  LOSE: 0,
});

/**
 * @param {'JACKPOT'|'MEDALLION'|'TRIPLE'|'DOUBLE'|'NEAR_MISS'|'LOSE'} outcomeClass
 * @param {string|null} [tier] required (and used) only for TRIPLE/DOUBLE
 * @returns {number}
 */
export function getPayout(outcomeClass, tier = null) {
  const entry = PAYTABLE[outcomeClass];
  if (entry === undefined) throw new Error(`getPayout: unknown outcome class ${JSON.stringify(outcomeClass)}`);
  if (typeof entry === 'number') return entry;
  if (tier == null || !(tier in entry)) throw new Error(`getPayout: ${outcomeClass} requires a valid tier, got ${JSON.stringify(tier)}`);
  return entry[tier];
}

// ---------------------------------------------------------------------------
// §9 — Color spec (truecolor + 256-color fallback)
// ---------------------------------------------------------------------------

/** Background: dark ground every foreground color in this palette sits on. */
export const BACKGROUND = Object.freeze({ hex: '#1B1912', ansi256: 234 });

/** Non-symbol chrome/role colors, transcribed verbatim from §9's table. */
export const COLORS = Object.freeze({
  background: BACKGROUND,
  chassisBorderIdle: Object.freeze({ hex: '#8C7A54', ansi256: 101 }),
  chassisBorderHot: Object.freeze({ hex: '#FFCB77', ansi256: 222, bold: true }),
  bulbLit: Object.freeze({ hex: '#F6C67D', ansi256: 222, bold: true }),
  bulbUnlit: Object.freeze({ hex: '#6B4F26', ansi256: 58, dim: true }),
  wordmark: Object.freeze({ hex: '#E9BD7F', ansi256: 180, bold: true }),
  reelFrameIdle: Object.freeze({ hex: '#A08F66', ansi256: 137 }),
  reelFrameHot: Object.freeze({ hex: '#FFB454', ansi256: 215, bold: true }),
  paylineBarIdle: Object.freeze({ hex: '#E9BD7F', ansi256: 180, bold: true }),
  paylineBarHot: Object.freeze({ hex: '#FF7A45', ansi256: 209, bold: true }),
  motionBlur: Object.freeze({ from: '#4A4436', to: '#8C7A54', ansi256From: 238, ansi256To: 101 }),
  glintSweep: Object.freeze({ from: '#5C5138', to: '#E9D3A8', ansi256From: 239, ansi256To: 187 }),
  coins: Object.freeze({ hex: '#F6C67D', ansi256: 222, bold: true }),
  sunburst: Object.freeze({ hex: '#FFFFFF', ansi256: 231, bold: true }),
  infoText: Object.freeze({ hex: '#BDBEA9', ansi256: 249 }),
  hintText: Object.freeze({ hex: '#8A7C5E', ansi256: 101, dim: true }),
  loseNeutral: Object.freeze({ hex: '#7A7360', ansi256: 242, dim: true }),
  nearMissWhisper: Object.freeze({ hex: '#E9BD7F', ansi256: 180, dim: true }),
  // §9's table marks these two roles `dim`, but ARCHITECTURE.md's verified
  // platform fact is that both renderers turn ANY `dim` span into one flat
  // #999999 gray (render-ansi.js's DIM_GRAY; Tier 1's dimColor measured the
  // same way) — so a literal transcription would make ABORTED and ERROR
  // render as the *same* indistinguishable gray as each other (and as every
  // other dim role), which directly defeats §9's own "red = error, always
  // unambiguous" rule. Deliberate, documented deviation: keep the exact
  // hues, drop `dim` only for these two roles so they stay visually
  // distinct instead of collapsing together.
  abortedText: Object.freeze({ hex: '#9C9686', ansi256: 246 }),
  errorText: Object.freeze({ hex: '#E4342F', ansi256: 160 }),
  onTheHouseText: Object.freeze({ hex: '#E9BD7F', ansi256: 180, dim: true }),
});

/**
 * @param {keyof typeof COLORS} role
 */
export function getColor(role) {
  const c = COLORS[role];
  if (!c) throw new Error(`getColor: unknown color role ${JSON.stringify(role)}`);
  return c;
}

// ---------------------------------------------------------------------------
// §14 — Optional emoji theme (opt-in, never default)
// ---------------------------------------------------------------------------

/** id -> emoji glyph. Opt-in only (theme:'emoji'); default theme never uses these (§14 width caveats apply). */
export const EMOJI_THEME = Object.freeze({
  CLAUDE: '✨',
  MEDALLION: '🏅',
  TOOL: '🔧',
  TEST: '✅',
  DIFF: '📝',
  FILE: '📄',
  TOKEN: '🪙',
  PROSE: '💬',
});

/** @param {string} id @param {'classic'|'emoji'} [theme] */
export function getThemedGlyph(id, theme = 'classic') {
  if (theme === 'emoji') return EMOJI_THEME[id] ?? getGlyph(id);
  return getGlyph(id);
}

export function listSymbolIds() {
  return SYMBOL_IDS.slice();
}
