import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../lib/machine.js';
import { assertRect, frameToPlainText } from '../lib/frame.js';
import { symbolOffset, STRIP_H } from '../lib/sprite-frame.js';
import { OUTCOME_ORDER, PAYTABLE } from '../lib/symbols.js';

function seedForClass(cls, max = 50000) {
  for (let i = 0; i < max; i++) {
    const st = M.pullLever(M.createState({}), 0, i);
    if (st.outcome.outcomeClass === cls) return i;
  }
  throw new Error(`no seed found for ${cls} within ${max} tries`);
}
const CLASS_SEED = Object.fromEntries(OUTCOME_ORDER.map((c) => [c, seedForClass(c)]));
const mod = (a, n) => ((a % n) + n) % n;
const T = M.TIMINGS;
const allStopped = 2 * T.stoppingStaggerMs + T.stopMs;

test('createState: starting credits and a resting reel position', () => {
  assert.equal(M.createState().economy.credits, 100);
  assert.equal(M.createState({ startCredits: 50 }).economy.credits, 50);
  assert.equal(M.phaseAt(M.createState(), 123456).phase, 'IDLE');
  assert.equal(M.reelOffsets(M.createState(), 0).length, 3);
});

test('pullLever charges one credit immediately and rolls a deterministic outcome', () => {
  const a = M.pullLever(M.createState({ startCredits: 100 }), 0, 42);
  const b = M.pullLever(M.createState({ startCredits: 100 }), 500, 42);
  assert.equal(a.economy.credits, 99);
  assert.equal(a.spinCost, 1);
  assert.deepEqual(a.outcome, b.outcome);
  const zero = M.pullLever(M.createState({ startCredits: 0 }), 0, 42);
  assert.equal(zero.economy.credits, 0);
  assert.equal(zero.spinCost, 0, 'on the house at zero');
});

test('phases: SPINUP -> SPINNING, and SPINNING never ends on its own', () => {
  const st = M.pullLever(M.createState(), 1000, 1);
  assert.equal(M.phaseAt(st, 1000).phase, 'SPINUP');
  assert.equal(M.phaseAt(st, 1000 + T.spinupMs - 1).phase, 'SPINUP');
  assert.equal(M.phaseAt(st, 1000 + T.spinupMs).phase, 'SPINNING');
  assert.equal(M.phaseAt(st, 1000 + 10 * 60 * 1000).phase, 'SPINNING');
  assert.ok(M.isAnimating(st, 1000 + 10 * 60 * 1000));
});

test('reels keep moving while spinning: offsets strictly decrease every tick, with no two reels locked together', () => {
  const st = M.pullLever(M.createState(), 0, 3);
  let prev = M.reelOffsets(st, 50);
  for (let t = 150; t < 20000; t += 100) {
    const cur = M.reelOffsets(st, t);
    for (let i = 0; i < 3; i++) assert.ok(cur[i] < prev[i], `reel ${i} moved at t=${t}`);
    prev = cur;
  }
  const d = M.reelOffsets(st, 5000);
  assert.ok(d[0] !== d[1] && d[1] !== d[2]);
});

test('stop(answer): reels lock left-to-right 300 ms apart and land exactly on the rolled symbols', () => {
  for (const cls of OUTCOME_ORDER) {
    const st = M.pullLever(M.createState(), 0, CLASS_SEED[cls]);
    const stopAt = 2500;
    M.stop(st, stopAt, 'answer');
    assert.equal(M.phaseAt(st, stopAt).phase, 'STOPPING');
    // continuity: at the moment each reel starts stopping it is where the spin left it
    for (let i = 0; i < 3; i++) {
      const s = stopAt + i * T.stoppingStaggerMs;
      assert.equal(M.reelOffsets(st, s)[i], Math.round(st.stopStartOffsets[i]), `reel ${i} continuity`);
    }
    // monotonic deceleration, never past the target
    for (let i = 0; i < 3; i++) {
      const s = stopAt + i * T.stoppingStaggerMs;
      let prev = M.reelOffsets(st, s)[i];
      for (let t = s + 50; t <= s + T.stopMs; t += 50) {
        const o = M.reelOffsets(st, t)[i];
        assert.ok(o <= prev, `reel ${i} does not reverse`);
        assert.ok(o >= st.targets[i], `reel ${i} does not overshoot`);
        prev = o;
      }
    }
    const landed = M.reelOffsets(st, stopAt + allStopped);
    for (let i = 0; i < 3; i++) {
      assert.equal(mod(landed[i], STRIP_H), symbolOffset(st.outcome.symbols[i]), `${cls} reel ${i} shows ${st.outcome.symbols[i]}`);
      assert.ok(st.stopStartOffsets[i] - st.targets[i] >= T.minStopTravelPx, 'at least one full strip of travel');
    }
    // the landing holds forever after
    assert.deepEqual(M.reelOffsets(st, stopAt + 60000), landed);
  }
});

test('stop(answer): OUTCOME overlay follows the last reel, then RESULT and no more animation', () => {
  const st = M.pullLever(M.createState(), 0, CLASS_SEED.LIFE);
  M.stop(st, 1000, 'answer');
  assert.equal(M.overlayAt(st, 1000 + allStopped - 1), null);
  assert.equal(M.phaseAt(st, 1000 + allStopped).phase, 'OUTCOME');
  assert.deepEqual(M.overlayAt(st, 1000 + allStopped), { id: 'win-life', frame: 0 });
  assert.deepEqual(M.overlayAt(st, 1000 + allStopped + 550), { id: 'win-life', frame: 5 });
  const end = 1000 + allStopped + 20 * T.overlayFrameMs;
  assert.equal(M.phaseAt(st, end - 1).phase, 'OUTCOME');
  assert.equal(M.phaseAt(st, end).phase, 'RESULT');
  assert.equal(M.isAnimating(st, end), false);
  assert.equal(M.overlayAt(st, end), null);
});

test('payouts land in the economy at stop() and the result line reports the net change', () => {
  for (const cls of OUTCOME_ORDER) {
    const st = M.pullLever(M.createState({ startCredits: 100 }), 0, CLASS_SEED[cls]);
    M.stop(st, 1000, 'answer');
    assert.equal(st.economy.credits, 99 + PAYTABLE[cls]);
    const net = PAYTABLE[cls] - 1;
    const text = M.resultText(st);
    assert.ok(text.startsWith('◈ '), text);
    assert.ok(text.includes(net >= 0 ? `+${net} cr` : `−${-net} cr`), text);
    assert.ok(text.endsWith(`balance ${String(99 + PAYTABLE[cls]).padStart(3, '0')}`), text);
    assertRect(M.resultLine(st));
    assert.equal(frameToPlainText(M.resultLine(st)), text);
  }
  const lose = M.pullLever(M.createState({ startCredits: 97 }), 0, CLASS_SEED.LOSE);
  M.stop(lose, 1000, 'answer');
  assert.equal(M.resultText(lose), '◈ no match  −1 cr  balance 096');
  const house = M.pullLever(M.createState({ startCredits: 0 }), 0, CLASS_SEED.LOSE);
  M.stop(house, 1000, 'answer');
  assert.equal(M.resultText(house), '◈ no match  on the house  balance 000');
});

test('stop(aborted/error): reels freeze, a glitch overlay plays, the spin is refunded', () => {
  for (const [reason, phase, overlay] of [['aborted', 'JAM', 'abort'], ['error', 'MALFUNCTION', 'error']]) {
    const st = M.pullLever(M.createState({ startCredits: 97 }), 0, 5);
    assert.equal(st.economy.credits, 96);
    const before = M.reelOffsets(st, 2000);
    M.stop(st, 2000, reason);
    assert.equal(st.economy.credits, 97, 'refunded');
    assert.equal(st.economy.stats.winsByClass.LOSE, 0);
    assert.deepEqual(M.reelOffsets(st, 2000), before);
    assert.deepEqual(M.reelOffsets(st, 9000), before, 'frozen');
    assert.equal(M.phaseAt(st, 2000).phase, phase);
    assert.deepEqual(M.overlayAt(st, 2350), { id: overlay, frame: 3 });
    assert.equal(M.phaseAt(st, 2000 + 12 * T.overlayFrameMs).phase, 'RESULT');
    assert.ok(M.resultText(st).includes('refunded'));
  }
  const house = M.pullLever(M.createState({ startCredits: 0 }), 0, 5);
  M.stop(house, 100, 'aborted');
  assert.equal(house.economy.credits, 0, 'nothing to refund on the house');
});

test('stop() before pullLever throws; a second stop() is ignored', () => {
  assert.throws(() => M.stop(M.createState(), 0, 'answer'));
  const st = M.pullLever(M.createState(), 0, 1);
  M.stop(st, 1000, 'answer');
  const targets = st.targets.slice();
  M.stop(st, 5000, 'aborted');
  assert.deepEqual(st.targets, targets);
  assert.equal(st.stopReason, 'answer');
});

test('next spin starts from where the previous one landed', () => {
  const st = M.pullLever(M.createState(), 0, CLASS_SEED.FEATURE);
  M.stop(st, 1000, 'answer');
  const landed = M.reelOffsets(st, 1000 + allStopped + 5000);
  M.pullLever(st, 10000, 9);
  assert.deepEqual(M.reelOffsets(st, 10000), landed);
});

test('frame(): a 10 × 40 painted frame at every phase; variant cycles per tick', () => {
  const st = M.pullLever(M.createState(), 0, CLASS_SEED.CLIENT);
  for (const t of [0, 200, 1500]) assertRect(M.frame(st, t));
  M.stop(st, 3000, 'answer');
  for (const t of [3000, 3400, 4300, 5000, 9000]) {
    const f = M.frame(st, t);
    assertRect(f);
    assert.equal(f.lines.length, 10);
    assert.equal(f.width, 40);
  }
  assert.equal(M.variantAt(0), 0);
  assert.equal(M.variantAt(150), 1);
  assert.equal(M.variantAt(450), 0);
});

test('fallbackText: a one-line readout for narrow viewports', () => {
  const st = M.pullLever(M.createState({ startCredits: 98 }), 0, CLASS_SEED.LOSE);
  assert.equal(M.fallbackText(st, 1000), '[ ◈ SPINNING · 097 cr ]');
  M.stop(st, 2000, 'answer');
  assert.equal(M.fallbackText(st, 2100), '[ ◈ STOPPING · 097 cr ]');
  assert.equal(M.fallbackText(st, 2000 + allStopped + 50), '[ ◈ NO MATCH · 097 cr ]');
  assertRect(M.fallbackLine(st, 2100));
});
