import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, hashSeed, rollOutcome } from '../lib/rng.js';
import { NEIGHBORS, OUTCOME_PROBABILITIES, REEL_STRIPS } from '../lib/symbols.js';

test('mulberry32 is deterministic and returns floats in [0, 1)', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 20; i++) {
    const x = a();
    const y = b();
    assert.equal(x, y);
    assert.ok(x >= 0 && x < 1);
  }
});

test('hashSeed is deterministic and spreads different strings apart', () => {
  assert.equal(hashSeed('abc'), hashSeed('abc'));
  assert.notEqual(hashSeed('abc'), hashSeed('abd'));
  assert.ok(Number.isInteger(hashSeed('x')) && hashSeed('x') >= 0);
});

test('rollOutcome: identical seed always reproduces an identical result (number and string seeds)', () => {
  assert.deepEqual(rollOutcome(12345), rollOutcome(12345));
  assert.deepEqual(rollOutcome('turn-abc'), rollOutcome('turn-abc'));
  assert.notDeepEqual(rollOutcome(1), rollOutcome(2));
});

test('rollOutcome: every roll returns a well-formed spin result', () => {
  for (let seed = 0; seed < 500; seed++) {
    const o = rollOutcome(seed);
    assert.ok(Object.keys(OUTCOME_PROBABILITIES).includes(o.outcomeClass));
    assert.equal(o.paylineSymbols.length, 3);
    assert.equal(o.grid.length, 3);
    for (const col of o.grid) assert.equal(col.length, 3);
    assert.equal(o.targetStops.length, 3);
    assert.ok(o.payout >= 0);
    // the payline itself must equal the grid's own middle row, reel by reel
    for (let r = 0; r < 3; r++) assert.equal(o.grid[r][1], o.paylineSymbols[r]);
    // dressing rows are pure NEIGHBORS.PREV/NEXT of the payline (§4 step 3)
    for (let r = 0; r < 3; r++) {
      assert.equal(o.grid[r][0], NEIGHBORS.PREV[o.paylineSymbols[r]]);
      assert.equal(o.grid[r][2], NEIGHBORS.NEXT[o.paylineSymbols[r]]);
    }
  }
});

test('near-miss rule: payline is always [S, S, NEXT(S)] with the overshoot always on reel index 2', () => {
  let found = 0;
  for (let seed = 0; seed < 20000 && found < 200; seed++) {
    const o = rollOutcome(seed);
    if (o.outcomeClass !== 'NEAR_MISS') continue;
    found++;
    const [a, b, c] = o.paylineSymbols;
    assert.equal(a, b, `seed ${seed}: reels 1/2 must match`);
    assert.equal(c, NEIGHBORS.NEXT[a], `seed ${seed}: reel 3 must be NEXT(reel1)`);
    assert.notEqual(c, a, 'a genuine near miss never has all three the same');
    assert.equal(o.overshootReel, 2);
    assert.equal(o.payout, 0);
  }
  assert.ok(found > 50, 'expected to find plenty of near-miss rolls in 20000 seeds');
});

test('MEDALLION never appears as a DOUBLE filler (§2)', () => {
  let doubles = 0;
  for (let seed = 0; seed < 20000 && doubles < 500; seed++) {
    const o = rollOutcome(seed);
    if (o.outcomeClass !== 'DOUBLE') continue;
    doubles++;
    assert.ok(!o.paylineSymbols.includes('MEDALLION'));
  }
  assert.ok(doubles > 100);
});

test('LOSE rolls: always three genuinely distinct, non-adjacent-pair symbols', () => {
  let loses = 0;
  for (let seed = 0; seed < 20000 && loses < 500; seed++) {
    const o = rollOutcome(seed);
    if (o.outcomeClass !== 'LOSE') continue;
    loses++;
    assert.equal(new Set(o.paylineSymbols).size, 3);
  }
  assert.ok(loses > 100);
});

test('TRIPLE/JACKPOT/MEDALLION paylines are uniform (all three reels equal)', () => {
  for (let seed = 0; seed < 5000; seed++) {
    const o = rollOutcome(seed);
    if (['TRIPLE', 'JACKPOT', 'MEDALLION'].includes(o.outcomeClass)) {
      assert.equal(o.paylineSymbols[0], o.paylineSymbols[1]);
      assert.equal(o.paylineSymbols[1], o.paylineSymbols[2]);
    }
  }
});

test('empirical class frequencies over 200k rolls land within tolerance of §2\'s table', () => {
  const N = 200000;
  const counts = {};
  for (let i = 0; i < N; i++) {
    // spread seeds well past mulberry32's short-cycle low bits
    const o = rollOutcome((i * 2654435761) >>> 0);
    counts[o.outcomeClass] = (counts[o.outcomeClass] || 0) + 1;
  }
  for (const [cls, p] of Object.entries(OUTCOME_PROBABILITIES)) {
    const observed = (counts[cls] || 0) / N;
    const tolerance = Math.max(0.004, p * 0.1); // generous: 10% relative or 0.4pp absolute
    assert.ok(Math.abs(observed - p) < tolerance, `${cls}: observed ${observed}, expected ${p} (tolerance ${tolerance})`);
  }
});

test('targetStops points at a strip index that actually holds the payline symbol', () => {
  for (let seed = 0; seed < 200; seed++) {
    const o = rollOutcome(seed);
    for (let r = 0; r < 3; r++) {
      assert.equal(REEL_STRIPS[r][o.targetStops[r]], o.paylineSymbols[r]);
    }
  }
});
