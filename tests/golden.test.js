// Golden-frame checks: these must match docs/ART-SPEC.md character-for-
// character. Fixtures under tests/golden/*.txt were captured from
// scripts/dev/art-gen/gen.py's own output (the same generator ART-SPEC.md's
// frames were transcribed from), so a diff here is either a spec update
// that forgot to regenerate the fixture or a real renderer bug.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { frameToPlainText } from '../lib/frame.js';
import { resolveParams, buildStandardFrame, buildGrandFrame, renderFrame, resultLine } from '../lib/art.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const golden = (name) => readFileSync(path.join(__dirname, 'golden', name), 'utf8');

test('golden: STANDARD idle (§8.1 IDLE-A)', () => {
  const p = resolveParams({ phase: 'IDLE', t: 0, now: 0, size: 'standard', outcome: null, economy: { credits: 97, lastWin: 8, stats: { recent: [] } } });
  const fr = buildStandardFrame(p);
  assert.equal(frameToPlainText(fr), golden('standard-idle.txt'));
});

test('golden: GRAND idle, with the RECENT field (§7.3)', () => {
  const economy = {
    credits: 346, lastWin: 250,
    stats: { recent: [{ outcomeClass: 'JACKPOT', symbols: ['CLAUDE', 'CLAUDE', 'CLAUDE'] }, { outcomeClass: 'DOUBLE', symbols: ['TOOL', 'TOOL', 'DIFF'] }, null] },
  };
  const p = resolveParams({ phase: 'IDLE', t: 0, now: 0, size: 'grand', outcome: null, economy });
  const fr = buildGrandFrame(p);
  assert.equal(frameToPlainText(fr), golden('grand-idle.txt'));
});

test('golden: COMPACT idle (§7.2)', () => {
  const fr = renderFrame({ size: 'compact', columns: 40, phase: 'IDLE', t: 0, outcome: null, economy: { credits: 97, lastWin: 8, stats: { recent: [] } } });
  assert.equal(frameToPlainText(fr), golden('compact-idle.txt'));
});

test('golden: JACKPOT outcome frame 1 (§8.7 "flash")', () => {
  // The worked JACKPOT illustration in ART-SPEC uses a hand-picked dressing
  // grid for visual variety (see docs/ART-SPEC.md §8.7 vs its own §3 closing
  // claim) rather than one derived from rng.js's NEIGHBORS-based dressing —
  // this test reproduces that exact illustrative grid, matching the spec's
  // own generator (gen.py's JACKPOT-1-flash call) byte-for-byte. A *real*
  // rolled JACKPOT (see tests/rng.test.js) always has uniform PROSE/BAR
  // dressing instead, which is its own, separately-verified, correctness
  // property.
  const outcome = {
    outcomeClass: 'JACKPOT', tier: null,
    paylineSymbols: ['CLAUDE', 'CLAUDE', 'CLAUDE'],
    grid: [['PROSE', 'CLAUDE', 'TOOL'], ['DIFF', 'CLAUDE', 'TOOL'], ['FILE', 'CLAUDE', 'TOOL']],
    payout: 250,
  };
  const p = resolveParams({ phase: 'OUTCOME', t: 0, size: 'standard', outcome, creditsBeforeOutcome: 96, economy: { credits: 96, lastWin: 0, stats: { recent: [] } } });
  const fr = buildStandardFrame(p);
  assert.equal(frameToPlainText(fr), golden('jackpot-frame1.txt'));
});

// --- §12 transcript result line: all eight literal lines -------------------

const RESULT_CASES = [
  { outcome: { outcomeClass: 'JACKPOT', paylineSymbols: ['CLAUDE', 'CLAUDE', 'CLAUDE'], payout: 250 }, credits: 346, elapsedSec: 12, expected: '▐ ✻ │ ✻ │ ✻ ▌ JACKPOT +250 ✦ credits 346 · 12s' },
  { outcome: { outcomeClass: 'MEDALLION', paylineSymbols: ['MEDALLION', 'MEDALLION', 'MEDALLION'], payout: 77 }, credits: 173, elapsedSec: 8, expected: '▐ ◆C◆ │ ◆C◆ │ ◆C◆ ▌ SIGNATURE +77 ✦ credits 173 · 8s' },
  { outcome: { outcomeClass: 'TRIPLE', paylineSymbols: ['TOOL', 'TOOL', 'TOOL'], payout: 40 }, credits: 136, elapsedSec: 5, expected: '▐ BAR │ BAR │ BAR ▌ TRIPLE +40 ✦ credits 136 · 5s' },
  { outcome: { outcomeClass: 'DOUBLE', paylineSymbols: ['PROSE', 'PROSE', 'TOOL'], payout: 1 }, credits: 97, elapsedSec: 3, expected: '▐ ♥ │ ♥ │ BAR ▌ DOUBLE +1 ✦ credits 97 · 3s' },
  { outcome: { outcomeClass: 'NEAR_MISS', paylineSymbols: ['TEST', 'TEST', 'TOKEN'], payout: 0 }, credits: 96, elapsedSec: 4, expected: '▐ ★ │ ★ │ ☼ ▌ so close +0 ✦ credits 96 · 4s' },
  { outcome: { outcomeClass: 'LOSE', paylineSymbols: ['FILE', 'TEST', 'DIFF'], payout: 0 }, credits: 96, elapsedSec: 2, expected: '▐ ♣ │ ★ │ ♦ ▌ no win ✦ credits 96 · 2s' },
  { outcome: { outcomeClass: 'ABORTED', paylineSymbols: null }, credits: 97, elapsedSec: 6, expected: '▐ — │ — │ — ▌ INTERRUPTED ✦ credits 97 · 6s' },
  { outcome: { outcomeClass: 'ERROR', paylineSymbols: null }, credits: 96, elapsedSec: 9, expected: '▐ — │ — │ — ▌ ERROR ✦ credits 96 · 9s' },
];

for (const c of RESULT_CASES) {
  test(`golden: §12 transcript result line — ${c.outcome.outcomeClass}`, () => {
    const fr = resultLine(c.outcome, { credits: c.credits, elapsedSec: c.elapsedSec });
    assert.equal(frameToPlainText(fr), c.expected);
  });
}
