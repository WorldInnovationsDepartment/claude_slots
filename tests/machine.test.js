import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../lib/machine.js';
import { assertRect } from '../lib/frame.js';

function seedForClass(cls, max = 20000) {
  for (let i = 0; i < max; i++) {
    const st = M.pullLever(M.createState({}), 0, i);
    if (st.outcome.outcomeClass === cls) return i;
  }
  throw new Error(`no seed found for ${cls} within ${max} tries`);
}

const CLASS_SEED = Object.fromEntries(['JACKPOT', 'MEDALLION', 'TRIPLE', 'DOUBLE', 'NEAR_MISS', 'LOSE'].map((c) => [c, seedForClass(c)]));

test('createState: both createState(opts) and createState(now, opts) work', () => {
  const a = M.createState({ startCredits: 50 });
  assert.equal(a.economy.credits, 50);
  const b = M.createState(12345, { startCredits: 60 });
  assert.equal(b.economy.credits, 60);
  const c = M.createState();
  assert.equal(c.economy.credits, 100);
});

test('phaseAt: never-spun state is IDLE regardless of `now`', () => {
  const st = M.createState({});
  assert.equal(M.phaseAt(st, 0).phase, 'IDLE');
  assert.equal(M.phaseAt(st, 999999).phase, 'IDLE');
  assert.equal(M.isAnimating(st, 0), false);
});

test('phaseAt: LEVER -> SPINUP -> SPINNING boundaries match the exported TIMINGS', () => {
  let st = M.createState({});
  st = M.pullLever(st, 1000, 1);
  assert.equal(M.phaseAt(st, 1000).phase, 'LEVER');
  assert.equal(M.phaseAt(st, 1000 + M.TIMINGS.leverMs - 1).phase, 'LEVER');
  assert.equal(M.phaseAt(st, 1000 + M.TIMINGS.leverMs).phase, 'SPINUP');
  assert.equal(M.phaseAt(st, 1000 + M.TIMINGS.leverMs + M.TIMINGS.spinupMs - 1).phase, 'SPINUP');
  assert.equal(M.phaseAt(st, 1000 + M.TIMINGS.leverMs + M.TIMINGS.spinupMs).phase, 'SPINNING');
  assert.equal(M.phaseAt(st, 1000 + M.TIMINGS.leverMs + M.TIMINGS.spinupMs + 5 * 60 * 1000).phase, 'SPINNING'); // 5 minutes, never gets "stuck"
  assert.ok(M.isAnimating(st, 1000));
});

test('phaseAt: pullLever charges the spin cost immediately, at LEVER start (§8.2/§10)', () => {
  let st = M.createState({ startCredits: 100 });
  st = M.pullLever(st, 0, 1);
  assert.equal(st.economy.credits, 99);
});

test('stop() before pullLever throws rather than silently misbehaving', () => {
  const st = M.createState({});
  assert.throws(() => M.stop(st, 0, 'answer'));
});

test('STOPPING: reels lock left-to-right on a 300ms stagger; non-near-miss never overshoots', () => {
  let st = M.createState({});
  st = M.pullLever(st, 0, CLASS_SEED.TRIPLE);
  const spinEnd = M.TIMINGS.leverMs + M.TIMINGS.spinupMs;
  st = M.stop(st, spinEnd, 'answer');
  assert.equal(M.phaseAt(st, spinEnd).reelLocks.join(','), 'true,false,false');
  assert.equal(M.phaseAt(st, spinEnd + M.TIMINGS.stoppingStaggerMs).reelLocks.join(','), 'true,true,false');
  assert.equal(M.phaseAt(st, spinEnd + 2 * M.TIMINGS.stoppingStaggerMs).reelLocks.join(','), 'true,true,true');
  for (const t of [0, 100, 300, 500, 600]) assert.equal(M.phaseAt(st, spinEnd + t).overshoot, false);
});

test('STOPPING: a near-miss inserts exactly one overshoot window on reel 3 before settling', () => {
  let st = M.createState({});
  st = M.pullLever(st, 0, CLASS_SEED.NEAR_MISS);
  const spinEnd = M.TIMINGS.leverMs + M.TIMINGS.spinupMs;
  st = M.stop(st, spinEnd, 'answer');
  const stagger = M.TIMINGS.stoppingStaggerMs;
  assert.equal(M.phaseAt(st, spinEnd + 2 * stagger).overshoot, true);
  assert.equal(M.phaseAt(st, spinEnd + 2 * stagger + M.TIMINGS.overshootMs - 1).overshoot, true);
  assert.equal(M.phaseAt(st, spinEnd + 2 * stagger + M.TIMINGS.overshootMs).phase, 'REVEAL');
});

test('reason "aborted" -> JAM -> RESULT, and the spin cost is refunded', () => {
  let st = M.createState({ startCredits: 100 });
  st = M.pullLever(st, 0, CLASS_SEED.LOSE);
  assert.equal(st.economy.credits, 99);
  st = M.stop(st, 500, 'aborted');
  assert.equal(st.economy.credits, 100); // refunded
  assert.equal(M.phaseAt(st, 500).phase, 'JAM');
  assert.equal(M.phaseAt(st, 500 + M.TIMINGS.jamMs).phase, 'RESULT');
  assert.equal(M.isAnimating(st, 500 + M.TIMINGS.jamMs), false);
});

test('reason "error" -> MALFUNCTION -> RESULT, and the spin cost is refunded', () => {
  let st = M.createState({ startCredits: 100 });
  st = M.pullLever(st, 0, CLASS_SEED.LOSE);
  st = M.stop(st, 500, 'error');
  assert.equal(st.economy.credits, 100);
  assert.equal(M.phaseAt(st, 500).phase, 'MALFUNCTION');
  assert.equal(M.phaseAt(st, 500 + M.TIMINGS.malfunctionMs).phase, 'RESULT');
});

test('reason "refusal" follows the same STOPPING->REVEAL->OUTCOME->RESULT path as "answer"', () => {
  let st = M.createState({});
  st = M.pullLever(st, 0, CLASS_SEED.DOUBLE);
  const spinEnd = M.TIMINGS.leverMs + M.TIMINGS.spinupMs;
  st = M.stop(st, spinEnd, 'refusal');
  assert.equal(M.phaseAt(st, spinEnd).phase, 'STOPPING');
  const total = 2 * M.TIMINGS.stoppingStaggerMs + M.TIMINGS.revealMs;
  assert.equal(M.phaseAt(st, spinEnd + total + 1).phase, 'OUTCOME');
});

test('eventually every completed spin reaches RESULT and stays there (isAnimating false forever after)', () => {
  for (const cls of Object.keys(CLASS_SEED)) {
    let st = M.createState({});
    st = M.pullLever(st, 0, CLASS_SEED[cls]);
    const spinEnd = M.TIMINGS.leverMs + M.TIMINGS.spinupMs;
    st = M.stop(st, spinEnd, 'answer');
    const farFuture = spinEnd + 60000;
    assert.equal(M.phaseAt(st, farFuture).phase, 'RESULT', `class ${cls}`);
    assert.equal(M.isAnimating(st, farFuture), false, `class ${cls}`);
  }
});

test('frame(): rectangular for every size x phase x outcome class x many time samples, including a 5-minute spin', () => {
  const sizes = ['compact', 'standard', 'grand'];
  const columnsFor = { compact: 32, standard: 66, grand: 96 };
  const timeSamples = [0, 50, 150, 300, 500, 650, 750, 900, 1000, 1300, 1600, 1900, 2200, 2500, 2900, 3500, 4200, 5000, 30000, 300000];
  for (const cls of Object.keys(CLASS_SEED)) {
    for (const reason of ['answer', 'aborted', 'error']) {
      let st = M.createState({});
      st = M.pullLever(st, 0, CLASS_SEED[cls]);
      st = M.stop(st, 2000, reason);
      for (const size of sizes) {
        for (const t of timeSamples) {
          const fr = M.frame(st, t, { size, columns: columnsFor[size], info: { elapsedMs: t, tokens: t } });
          assertRect(fr); // throws on mismatch
        }
      }
    }
  }
});

test('frame(): a never-stopped SPINNING state stays rectangular at t=2s, t=30s, and t=5min', () => {
  let st = M.createState({});
  st = M.pullLever(st, 0, 1);
  for (const size of ['compact', 'standard', 'grand']) {
    for (const t of [2000, 30000, 5 * 60 * 1000]) {
      assertRect(M.frame(st, t, { size, columns: 100, info: { elapsedMs: t, tokens: t } }));
    }
  }
});

test('frame(): deterministic — the same (state, now) always renders the identical Frame', () => {
  let st = M.createState({});
  st = M.pullLever(st, 0, CLASS_SEED.JACKPOT);
  st = M.stop(st, 2000, 'answer');
  const a = M.frame(st, 2900, { size: 'standard', columns: 60, info: { elapsedMs: 2900, tokens: 10 } });
  const b = M.frame(st, 2900, { size: 'standard', columns: 60, info: { elapsedMs: 2900, tokens: 10 } });
  assert.deepEqual(a, b);
});

test("frame(): auto size picks compact/standard/grand from columns", () => {
  const st = M.createState({});
  // COMPACT clamps to the narrower of COMPACT_WIDTH(40) and the actual
  // terminal — columns:30 must never render a 40-col frame into a 30-col
  // terminal (regression coverage for the "COMPACT hardcoded to 40 cols"
  // fix; see tests/frame.test.js for the fuller matrix).
  assert.equal(M.frame(st, 0, { size: 'auto', columns: 30 }).width, 30);
  assert.equal(M.frame(st, 0, { size: 'auto', columns: 62 }).width, 50);
  assert.equal(M.frame(st, 0, { size: 'auto', columns: 90 }).width, 58);
});

test('resultLine(): produces a 1-line Frame with the payout and elapsed seconds', () => {
  let st = M.createState({ startCredits: 100 });
  st = M.pullLever(st, 0, CLASS_SEED.TRIPLE);
  st = M.stop(st, 5000, 'answer');
  const fr = M.resultLine(st, { columns: 60 });
  assert.equal(fr.lines.length, 1);
  const text = fr.lines[0].map((s) => s.text).join('');
  assert.match(text, /TRIPLE \+\d+/);
  assert.match(text, /credits \d+/);
  assert.match(text, /· 5s/);
});
