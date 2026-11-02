import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOptions, mergeStoredEconomy, SpinQueue, isNarrow, refundNotice, STORE_KEY, cloneJson, bandFitsSprite, bandTree, MIN_SPRITE_ROWS } from '../lib/mod-helpers.js';
import * as M from '../lib/machine.js';

test('resolveOptions: only startCredits, with safe defaults', () => {
  assert.deepEqual(resolveOptions(undefined), { startCredits: 100 });
  assert.deepEqual(resolveOptions({ sound: 'on', startCredits: 500, size: 'grand', idle: 'full' }), { startCredits: 500 });
  assert.equal(resolveOptions({ startCredits: -4 }).startCredits, 100);
  assert.equal(resolveOptions({ startCredits: 'abc' }).startCredits, 100);
  assert.equal(resolveOptions({ startCredits: 200000 }).startCredits, 100);
});

test('store key lives in the slots namespace', () => {
  assert.ok(STORE_KEY.startsWith('slots.'));
});

test('mergeStoredEconomy: restores credits and stats, ignores junk', () => {
  const st = M.createState({ startCredits: 100 });
  mergeStoredEconomy(st, { credits: 112, stats: { spins: 9, winsByClass: { LIFE: 1, bogus: 'x' }, jackpots: 1, recent: [1, 2, 3, 4] } });
  assert.equal(st.economy.credits, 112);
  assert.equal(st.economy.stats.spins, 9);
  assert.equal(st.economy.stats.winsByClass.LIFE, 1);
  assert.equal(st.economy.stats.winsByClass.bogus, undefined);
  assert.equal(st.economy.stats.recent.length, 3);
  mergeStoredEconomy(st, null);
  mergeStoredEconomy(st, { credits: -50 });
  assert.equal(st.economy.credits, 0);
  mergeStoredEconomy(st, 'nonsense');
  assert.equal(st.economy.credits, 0);
});

test('SpinQueue: binds a TurnDuration instance by durationMs, then by requestId, FIFO fallback', () => {
  const q = new SpinQueue(3);
  assert.equal(q.resolve('r1', 100), null);
  q.push({ durationMs: 100, resultSnapshot: 'a' });
  q.push({ durationMs: 250, resultSnapshot: 'b' });
  assert.equal(q.resolve('r2', 250).resultSnapshot, 'b');
  assert.equal(q.resolve('r2', 999).resultSnapshot, 'b', 'bound instances stay bound');
  assert.equal(q.resolve('r3', 777).resultSnapshot, 'a', 'no durationMs match falls back to the oldest pending');
  assert.equal(q.resolve('r4', 1), null);
  for (let i = 0; i < 10; i++) q.push({ durationMs: i, resultSnapshot: i });
  assert.equal(q.pending.length, 3, 'pending is capped');
  q.clear();
  assert.equal(q.pending.length, 0);
  assert.equal(q.bound.size, 0);
});

test('isNarrow: below 40 columns falls back to the one-line readout', () => {
  assert.equal(isNarrow({ columns: 39, rows: 20 }), true);
  assert.equal(isNarrow({ columns: 40, rows: 20 }), false);
  assert.equal(isNarrow(undefined), false);
});

test('refund paths: notice text and the machine result line', () => {
  assert.equal(refundNotice('aborted'), 'INTERRUPTED · refunded');
  assert.equal(refundNotice('error'), 'MALFUNCTION · refunded');
  const st = M.pullLever(M.createState({ startCredits: 97 }), 0, 1);
  M.stop(st, 500, 'aborted');
  assert.equal(M.resultText(st), '◈ interrupted  refunded  balance 097');
  const er = M.pullLever(M.createState({ startCredits: 97 }), 0, 1);
  M.stop(er, 500, 'error');
  assert.equal(M.resultText(er), '◈ malfunction  refunded  balance 097');
  assert.equal(M.presentedClass(er), 'ERROR');
});

test('cloneJson produces a detached copy of machine state', () => {
  const st = M.pullLever(M.createState(), 0, 1);
  const copy = cloneJson(st);
  M.stop(st, 1000, 'answer');
  assert.equal(copy.stopAt, null);
  assert.deepEqual(copy.outcome, st.outcome);
});

test('bandFitsSprite needs 40 columns and 10 rows of band', () => {
  assert.equal(MIN_SPRITE_ROWS, 10);
  assert.ok(bandFitsSprite({ bodyColumns: 115, maxRows: 40 }));
  assert.ok(bandFitsSprite({ bodyColumns: 40, maxRows: 10 }));
  assert.ok(!bandFitsSprite({ bodyColumns: 39, maxRows: 40 }));
  assert.ok(!bandFitsSprite({ bodyColumns: 115, maxRows: 9 }));
  assert.ok(!bandFitsSprite(null));
  assert.ok(!bandFitsSprite({}));
});

test('bandTree right-aligns the given tree in a row Box as wide as the band', () => {
  const inner = { type: 'Box', props: { flexDirection: 'column' }, children: [] };
  const t = bandTree(inner, 115);
  assert.equal(t.type, 'Box');
  assert.deepEqual(t.props, { flexDirection: 'row', justifyContent: 'flex-end', width: 115 });
  assert.equal(t.children[0], inner);
  assert.deepEqual(bandTree(inner, undefined).props, { flexDirection: 'row', justifyContent: 'flex-end' });
});
