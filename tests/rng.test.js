import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, hashSeed, rollOutcome } from '../lib/rng.js';
import { OUTCOME_PROBABILITIES, SYMBOL_IDS, PAYTABLE } from '../lib/symbols.js';

test('mulberry32 is deterministic and returns floats in [0, 1)', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 20; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
});

test('hashSeed is deterministic and spreads different strings apart', () => {
  assert.equal(hashSeed('abc'), hashSeed('abc'));
  assert.notEqual(hashSeed('abc'), hashSeed('abd'));
  assert.ok(Number.isInteger(hashSeed('x')) && hashSeed('x') >= 0);
});

test('rollOutcome: identical seed always reproduces an identical result', () => {
  assert.deepEqual(rollOutcome(12345), rollOutcome(12345));
  assert.deepEqual(rollOutcome('turn-abc'), rollOutcome('turn-abc'));
});

test('rollOutcome: well formed — win classes are three of a kind, losses never are', () => {
  for (let seed = 0; seed < 5000; seed++) {
    const o = rollOutcome(seed);
    assert.ok(Object.keys(OUTCOME_PROBABILITIES).includes(o.outcomeClass));
    assert.equal(o.symbols.length, 3);
    for (const s of o.symbols) assert.ok(SYMBOL_IDS.includes(s));
    assert.equal(o.payout, PAYTABLE[o.outcomeClass]);
    if (o.outcomeClass === 'LOSE') assert.ok(!(o.symbols[0] === o.symbols[1] && o.symbols[1] === o.symbols[2]));
    else assert.deepEqual(o.symbols, [o.outcomeClass, o.outcomeClass, o.outcomeClass]);
  }
});

test('empirical class frequencies over 100000 sequential seeds are within 10 % relative error of the table', () => {
  const N = 100000;
  const counts = {};
  for (let i = 0; i < N; i++) {
    const o = rollOutcome(i);
    counts[o.outcomeClass] = (counts[o.outcomeClass] || 0) + 1;
  }
  for (const [cls, p] of Object.entries(OUTCOME_PROBABILITIES)) {
    const observed = (counts[cls] || 0) / N;
    assert.ok(Math.abs(observed - p) / p < 0.1, `${cls}: observed ${observed}, expected ${p}`);
  }
});
