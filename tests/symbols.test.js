import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SYMBOL_IDS, WIN_CLASSES, OUTCOME_ORDER, OUTCOME_PROBABILITIES, PAYTABLE, OUTCOME_LABELS, OUTCOME_OVERLAYS, getPayout, isWinClass } from '../lib/symbols.js';

const sheet = JSON.parse(fs.readFileSync(new URL('../lib/sprites.json', import.meta.url), 'utf8'));

test('six symbols in strip order, matching the sprite sheet', () => {
  assert.deepEqual([...SYMBOL_IDS], ['FEATURE', 'CLIENT', 'LIFE', 'SKULL', 'EDDIES', 'CHIP']);
  assert.deepEqual([...SYMBOL_IDS], sheet.strip.symbols);
  assert.deepEqual([...WIN_CLASSES], ['FEATURE', 'CLIENT', 'LIFE']);
  for (const c of WIN_CLASSES) assert.ok(isWinClass(c));
  assert.ok(!isWinClass('LOSE'));
});

test('probability table sums to 1 and every class has a payout, label and overlay', () => {
  const sum = OUTCOME_ORDER.reduce((a, c) => a + OUTCOME_PROBABILITIES[c], 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `sum was ${sum}`);
  for (const c of OUTCOME_ORDER) {
    assert.equal(typeof PAYTABLE[c], 'number');
    assert.equal(typeof OUTCOME_LABELS[c], 'string');
    assert.ok(sheet.overlays[OUTCOME_OVERLAYS[c]], `overlay for ${c} exists in the sheet`);
  }
  assert.ok(sheet.overlays[OUTCOME_OVERLAYS.ABORTED] && sheet.overlays[OUTCOME_OVERLAYS.ERROR]);
});

test('paytable mirrors docs/ART-SPEC.md: LIFE 100, CLIENT 20, FEATURE 5, LOSE 0; LIFE is rarest', () => {
  assert.equal(getPayout('LIFE'), 100);
  assert.equal(getPayout('CLIENT'), 20);
  assert.equal(getPayout('FEATURE'), 5);
  assert.equal(getPayout('LOSE'), 0);
  assert.ok(OUTCOME_PROBABILITIES.LIFE < OUTCOME_PROBABILITIES.CLIENT);
  assert.ok(OUTCOME_PROBABILITIES.CLIENT < OUTCOME_PROBABILITIES.FEATURE);
  assert.ok(OUTCOME_PROBABILITIES.FEATURE < OUTCOME_PROBABILITIES.LOSE);
  assert.throws(() => getPayout('NOPE'));
});
