// Regression coverage for the adversarial-review fixes to
// lib/art-storyboards.js / lib/art.js: the LEVER info-strip stub, the
// STOPPING off-by-one + near-miss overshoot dressing bug, COMPACT/
// ULTRA-COMPACT width clamping, and the ABORTED/ERROR marquee coloring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveParams, buildStandardFrame, renderFrame } from '../lib/art.js';
import { displayWidth } from '../lib/width.js';
import { COLORS, getSymbol } from '../lib/symbols.js';

// --- LEVER info strip reflects real state, not a hardcoded stub -----------

test('LEVER phase info strip reflects the real economy, not the hardcoded 096/008 stub', () => {
  const economy = { credits: 42, lastWin: 17, stats: { recent: [] } };
  const p = resolveParams({ phase: 'LEVER', t: 0, size: 'standard', economy });
  assert.match(p.infoLeft, /CREDITS: 042 {3}LAST WIN: 017/);
  assert.doesNotMatch(p.infoLeft, /096/);
  assert.doesNotMatch(p.infoLeft, /\b008\b/);
});

test('LEVER phase updates as the knob descends, still tracking the real economy each time', () => {
  const economy = { credits: 5, lastWin: 0, stats: { recent: [] } };
  for (const t of [0, 200, 400, 600, 800]) {
    const p = resolveParams({ phase: 'LEVER', t, size: 'standard', economy });
    assert.match(p.infoLeft, /CREDITS: 005/);
  }
});

test('LEVER phase shows ON THE HOUSE once credits are exhausted (§10)', () => {
  const economy = { credits: 0, lastWin: 0, stats: { recent: [] } };
  const p = resolveParams({ phase: 'LEVER', t: 0, size: 'standard', economy });
  assert.match(p.infoLeft, /ON THE HOUSE/);
});

test('GRAND-size LEVER info strip uses the 4-digit budget, not a hardcoded 3-digit stub', () => {
  const economy = { credits: 1234, lastWin: 77, stats: { recent: [] } };
  const p = resolveParams({ phase: 'LEVER', t: 0, size: 'grand', economy });
  assert.match(p.infoLeft, /CREDITS: 1234 {3}LAST WIN: 0077/);
});

// --- STOPPING: off-by-one text, and near-miss overshoot dressing rows -----

const NEAR_MISS_OUTCOME = {
  outcomeClass: 'NEAR_MISS',
  paylineSymbols: ['TEST', 'TEST', 'TOKEN'],
  grid: [
    ['DIFF', 'TEST', 'PROSE'], // reel 1: top DIFF(♦), pay TEST(★), bot PROSE(♥)
    ['DIFF', 'TEST', 'PROSE'], // reel 2: same
    ['TEST', 'TOKEN', 'FILE'], // reel 3 true settled: top TEST(★), pay TOKEN(☼), bot FILE(♣)
  ],
  payout: 0,
};

test('STOPPING info text names the reel that just locked, with no off-by-one', () => {
  const p1 = resolveParams({ phase: 'STOPPING', t: 0, outcome: NEAR_MISS_OUTCOME, reelLocks: [true, false, false], overshoot: false });
  assert.match(p1.infoLeft, /locking reel 1$/);
  const p2 = resolveParams({ phase: 'STOPPING', t: 300, outcome: NEAR_MISS_OUTCOME, reelLocks: [true, true, false], overshoot: false });
  assert.match(p2.infoLeft, /locking reel 2$/);
  const p3 = resolveParams({ phase: 'STOPPING', t: 600, outcome: NEAR_MISS_OUTCOME, reelLocks: [true, true, true], overshoot: false });
  assert.match(p3.infoLeft, /locking reel 3$/);
});

test('STOPPING near-miss overshoot shows the illusory triple only on the payline row; reel 3 dressing stays a transitional blur', () => {
  const p = resolveParams({ phase: 'STOPPING', t: 620, outcome: NEAR_MISS_OUTCOME, reelLocks: [true, true, true], overshoot: true });
  assert.equal(p.topSyms[2], '▒', 'reel 3 top must NOT show the true settled grid value during overshoot');
  assert.equal(p.botSyms[2], '▒', 'reel 3 bottom must NOT show the true settled grid value during overshoot');
  assert.equal(p.paySyms[2], 'TEST', 'reel 3 payline shows the illusory symbol, completing TEST/TEST/TEST');
  // reels 1 & 2 are unaffected — already locked, real dressing shows through
  assert.equal(p.topSyms[0], 'DIFF');
  assert.equal(p.paySyms[0], 'TEST');
  assert.equal(p.topSyms[1], 'DIFF');
});

test('STOPPING: once overshoot ends, reel 3 is REVEAL\'s job — not asserted here, but STOPPING itself never leaks the true grid early', () => {
  const p = resolveParams({ phase: 'STOPPING', t: 601, outcome: NEAR_MISS_OUTCOME, reelLocks: [true, true, true], overshoot: true });
  assert.notEqual(p.topSyms[2], NEAR_MISS_OUTCOME.grid[2][0]);
});

// --- ABORTED/ERROR marquee color + the ◆ bulb / MEDALLION collision -------

function findSpan(lineSpans, substring) {
  return lineSpans.find((s) => s.text.includes(substring));
}

test('JAM settled sub-frame renders "INTERRUPTED" in the ABORTED role color, not plain wordmark ivory', () => {
  const p = resolveParams({ phase: 'JAM', t: 400, size: 'standard', economy: { credits: 99, lastWin: 0 } });
  const fr = buildStandardFrame(p);
  const marqueeSpan = findSpan(fr.lines[1], 'I N T E R R U P T E D');
  assert.ok(marqueeSpan, 'expected an INTERRUPTED span on the marquee line');
  assert.equal(marqueeSpan.color, COLORS.abortedText.hex);
  assert.notEqual(marqueeSpan.color, COLORS.wordmark.hex);
});

test('MALFUNCTION settled sub-frame renders "ERROR" in the ERROR role color, not plain wordmark ivory', () => {
  const p = resolveParams({ phase: 'MALFUNCTION', t: 400, size: 'standard', economy: { credits: 99, lastWin: 0 } });
  const fr = buildStandardFrame(p);
  const marqueeSpan = findSpan(fr.lines[1], 'E R R O R');
  assert.ok(marqueeSpan, 'expected an ERROR span on the marquee line');
  assert.equal(marqueeSpan.color, COLORS.errorText.hex);
  assert.notEqual(marqueeSpan.color, COLORS.wordmark.hex);
});

test('JAM settled sub-frame\'s flanking ◆ bulbs no longer collide with MEDALLION\'s signature hue', () => {
  const p = resolveParams({ phase: 'JAM', t: 400, size: 'standard', economy: { credits: 99, lastWin: 0 } });
  const fr = buildStandardFrame(p);
  const diamondSpan = findSpan(fr.lines[1], '◆');
  assert.ok(diamondSpan);
  assert.notEqual(diamondSpan.color, getSymbol('MEDALLION').color.hex);
});

test('the normal (non-JAM/MALFUNCTION) marquee is unaffected — still plain wordmark ivory', () => {
  const p = resolveParams({ phase: 'IDLE', t: 0, size: 'standard', outcome: null, economy: { credits: 97, lastWin: 8, stats: { recent: [] } } });
  const fr = buildStandardFrame(p);
  const marqueeSpan = findSpan(fr.lines[1], 'C L A U D E');
  assert.ok(marqueeSpan);
  assert.equal(marqueeSpan.color, COLORS.wordmark.hex);
});

// --- COMPACT/ULTRA-COMPACT width clamps to the real terminal --------------

test('COMPACT/ULTRA-COMPACT clamp to min(COMPACT_WIDTH, columns) — never wider than the actual terminal', () => {
  for (const columns of [10, 20, 30, 36, 38, 40, 60]) {
    const fr = renderFrame({ size: 'compact', columns, maxRows: 5, phase: 'IDLE', t: 0, outcome: null, economy: { credits: 97, lastWin: 8, stats: { recent: [] } } });
    const expectedMax = Math.max(1, Math.min(40, columns));
    assert.ok(fr.width <= expectedMax, `width ${fr.width} exceeds budget ${expectedMax} for columns=${columns}`);
    for (const l of fr.lines) assert.equal(displayWidth(l.map((s) => s.text).join('')), fr.width);
  }
});

test('COMPACT/ULTRA-COMPACT never throw, even when credits/lastWin grow past the assumed digit budget', () => {
  const economy = { credits: 9999999, lastWin: 9999999, stats: { recent: [] } };
  for (const columns of [20, 30, 40]) {
    assert.doesNotThrow(() => renderFrame({ size: 'compact', columns, phase: 'IDLE', t: 0, outcome: null, economy }));
  }
});

test('COMPACT at exactly 40 cols still matches the historical fixed-width behavior (no regression for the common case)', () => {
  const fr = renderFrame({ size: 'compact', columns: 40, phase: 'IDLE', t: 0, outcome: null, economy: { credits: 97, lastWin: 8, stats: { recent: [] } } });
  assert.equal(fr.width, 40);
});
