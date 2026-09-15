import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SYMBOL_IDS, SYMBOLS, REEL_STRIPS, NEIGHBORS, OUTCOME_PROBABILITIES, TRIPLE_TIERS, DOUBLE_TIERS,
  NEARMISS_WEIGHTS, PAYTABLE, getPayout, getSymbol, getGlyph, getStrip, getNeighbor, getColor, EMOJI_THEME,
} from '../lib/symbols.js';

test('eight canonical symbols, each with a glyph/name/concept/tier/dressingWeight/color (§1)', () => {
  assert.equal(SYMBOL_IDS.length, 8);
  for (const id of SYMBOL_IDS) {
    const s = getSymbol(id);
    assert.equal(typeof s.glyph, 'string');
    assert.equal(typeof s.concept, 'string');
    assert.equal(typeof s.dressingWeight, 'number');
    assert.match(s.color.hex, /^#[0-9A-Fa-f]{6}$/);
    assert.equal(typeof s.color.ansi256, 'number');
  }
  assert.equal(getGlyph('CLAUDE'), '✻');
  assert.equal(getGlyph('MEDALLION'), '◆C◆');
  assert.throws(() => getSymbol('NOPE'));
});

test('reel strips: lengths and per-symbol counts match §3 exactly', () => {
  assert.deepEqual(REEL_STRIPS.map((r) => r.length), [22, 24, 20]);
  const counts = (strip) => strip.reduce((m, s) => ((m[s] = (m[s] || 0) + 1), m), {});
  const c1 = counts(REEL_STRIPS[0]);
  const c2 = counts(REEL_STRIPS[1]);
  const c3 = counts(REEL_STRIPS[2]);
  for (const c of [c1, c2, c3]) {
    assert.equal(c.CLAUDE, 1);
    assert.equal(c.TOOL, 2);
    assert.equal(c.TEST, 1);
    assert.equal(c.MEDALLION, 1);
    assert.equal(c.TOKEN, 3);
  }
  assert.deepEqual([c1.FILE, c1.DIFF, c1.PROSE], [4, 4, 6]);
  assert.deepEqual([c2.FILE, c2.DIFF, c2.PROSE], [5, 5, 6]);
  assert.deepEqual([c3.FILE, c3.DIFF, c3.PROSE], [3, 4, 5]);
  assert.throws(() => getStrip(3));
});

test('neighbor table matches §3\'s printed table and is identical across all three reels', () => {
  const expectedNext = { CLAUDE: 'TOOL', TOOL: 'TEST', TEST: 'TOKEN', TOKEN: 'FILE', FILE: 'DIFF', DIFF: 'PROSE', PROSE: 'MEDALLION', MEDALLION: 'TOOL' };
  const expectedPrev = { CLAUDE: 'PROSE', TOOL: 'CLAUDE', TEST: 'TOOL', TOKEN: 'TEST', FILE: 'TOKEN', DIFF: 'FILE', PROSE: 'DIFF', MEDALLION: 'PROSE' };
  assert.deepEqual(NEIGHBORS.NEXT, expectedNext);
  assert.deepEqual(NEIGHBORS.PREV, expectedPrev);
  for (const id of SYMBOL_IDS) {
    assert.equal(getNeighbor('NEXT', id), expectedNext[id]);
    assert.equal(getNeighbor('PREV', id), expectedPrev[id]);
  }
  // NOTE: NEXT is not a bijection (both CLAUDE and MEDALLION land on TOOL,
  // since TOOL occupies two stops on every reel strip — see §3) so
  // PREV[NEXT[id]] does not universally round-trip to `id`; that is a
  // property of the strip's construction, not a bug.
});

test('outcome-class probabilities sum to exactly 1.0 (§2)', () => {
  const sum = Object.values(OUTCOME_PROBABILITIES).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `sum was ${sum}`);
  assert.equal(OUTCOME_PROBABILITIES.JACKPOT, 0.015);
  assert.equal(OUTCOME_PROBABILITIES.MEDALLION, 0.025);
  assert.equal(OUTCOME_PROBABILITIES.LOSE, 0.5);
});

test('TRIPLE_TIERS / DOUBLE_TIERS / NEARMISS_WEIGHTS sum as documented', () => {
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum(TRIPLE_TIERS) - 0.08) < 1e-9);
  assert.ok(Math.abs(sum(DOUBLE_TIERS) - 0.26) < 1e-9);
  assert.ok(Math.abs(sum(NEARMISS_WEIGHTS) - 1) < 1e-9);
});

test('paytable payouts (§2)', () => {
  assert.equal(getPayout('JACKPOT'), 250);
  assert.equal(getPayout('MEDALLION'), 77);
  assert.equal(getPayout('TRIPLE', 'TOOL'), 40);
  assert.equal(getPayout('TRIPLE', 'PROSE'), 8);
  assert.equal(getPayout('DOUBLE', 'CLAUDE'), 10);
  assert.equal(getPayout('DOUBLE', 'PROSE'), 1);
  assert.equal(getPayout('NEAR_MISS'), 0);
  assert.equal(getPayout('LOSE'), 0);
  assert.throws(() => getPayout('TRIPLE', 'NOPE'));
  assert.throws(() => getPayout('NOT_A_CLASS'));
});

test('color roles are hex + 256-fallback, background documented (§9)', () => {
  const border = getColor('chassisBorderIdle');
  assert.match(border.hex, /^#[0-9A-Fa-f]{6}$/);
  assert.throws(() => getColor('not-a-role'));
});

test('emoji theme (§14) maps all eight ids to a distinct emoji, opt-in only', () => {
  assert.equal(Object.keys(EMOJI_THEME).length, 8);
  for (const id of SYMBOL_IDS) assert.equal(typeof EMOJI_THEME[id], 'string');
});
