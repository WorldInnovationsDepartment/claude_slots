import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEconomy, applySpinStart, applyOutcome, isOnTheHouse, DEFAULT_START_CREDITS, SPIN_COST } from '../lib/economy.js';

test('createEconomy defaults to 100 starting credits and zeroed stats', () => {
  const e = createEconomy();
  assert.equal(e.credits, DEFAULT_START_CREDITS);
  assert.equal(e.credits, 100);
  assert.equal(e.lastWin, 0);
  assert.equal(e.stats.spins, 0);
  assert.equal(e.stats.jackpots, 0);
  assert.deepEqual(e.stats.recent, []);
  const custom = createEconomy({ startCredits: 25 });
  assert.equal(custom.credits, 25);
});

test('applySpinStart charges exactly SPIN_COST and counts the spin', () => {
  const e = createEconomy({ startCredits: 10 });
  applySpinStart(e);
  assert.equal(e.credits, 10 - SPIN_COST);
  assert.equal(e.stats.spins, 1);
});

test('credits never go negative — spins are ON THE HOUSE at 0 and never blocked', () => {
  const e = createEconomy({ startCredits: 0 });
  for (let i = 0; i < 25; i++) applySpinStart(e);
  assert.equal(e.credits, 0);
  assert.equal(e.stats.spins, 25);
  assert.ok(isOnTheHouse(e));
});

test('applyOutcome credits a payout, sets lastWin, tracks jackpots and streaks', () => {
  const e = createEconomy({ startCredits: 100 });
  applySpinStart(e);
  applyOutcome(e, { outcomeClass: 'FEATURE', payout: 5, symbols: ['FEATURE', 'FEATURE', 'FEATURE'] });
  assert.equal(e.credits, 99 + 5);
  assert.equal(e.lastWin, 5);
  assert.equal(e.stats.winsByClass.FEATURE, 1);
  assert.equal(e.stats.streak, 1);
  assert.equal(e.stats.bestStreak, 1);

  applySpinStart(e);
  applyOutcome(e, { outcomeClass: 'LIFE', payout: 100, symbols: ['LIFE', 'LIFE', 'LIFE'] });
  assert.equal(e.stats.jackpots, 1);
  assert.equal(e.stats.streak, 2);

  applySpinStart(e);
  applyOutcome(e, { outcomeClass: 'LOSE', payout: 0, symbols: ['PILLS', 'GUN', 'AGENT'] });
  assert.equal(e.lastWin, 0);
  assert.equal(e.stats.streak, 0); // broken by the loss
  assert.equal(e.stats.bestStreak, 2); // best streak persists
});

test('ABORTED / ERROR refund the spin cost and never count as a win streak', () => {
  const e = createEconomy({ startCredits: 100 });
  applySpinStart(e);
  assert.equal(e.credits, 99);
  applyOutcome(e, { outcomeClass: 'ABORTED' });
  assert.equal(e.credits, 100); // refunded in full
  assert.equal(e.lastWin, 0);
  assert.equal(e.stats.winsByClass.ABORTED, 1);
  assert.equal(e.stats.streak, 0);

  applySpinStart(e);
  applyOutcome(e, { outcomeClass: 'ERROR' });
  assert.equal(e.credits, 100);
  assert.equal(e.stats.winsByClass.ERROR, 1);
});

test('stats.recent holds up to 3 entries, most-recent-first, with paylines for real outcomes and null for aborted/error', () => {
  const e = createEconomy({ startCredits: 100 });
  const spin = (outcome) => {
    applySpinStart(e);
    applyOutcome(e, outcome);
  };
  spin({ outcomeClass: 'CLIENT', payout: 20, symbols: ['CLIENT', 'CLIENT', 'CLIENT'] });
  spin({ outcomeClass: 'ABORTED' });
  spin({ outcomeClass: 'LIFE', payout: 100, symbols: ['LIFE', 'LIFE', 'LIFE'] });
  spin({ outcomeClass: 'LOSE', payout: 0, symbols: ['PILLS', 'GUN', 'AGENT'] });
  assert.equal(e.stats.recent.length, 3);
  assert.equal(e.stats.recent[0].outcomeClass, 'LOSE');
  assert.deepEqual(e.stats.recent[0].symbols, ['PILLS', 'GUN', 'AGENT']);
  assert.equal(e.stats.recent[1].outcomeClass, 'LIFE');
  assert.equal(e.stats.recent[2].outcomeClass, 'ABORTED');
  assert.equal(e.stats.recent[2].symbols, null);
});
