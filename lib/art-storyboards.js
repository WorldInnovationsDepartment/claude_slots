// Claude Slots — per-phase/per-outcome storyboard content (lib/art-storyboards.js)
//
// Pure ESM, zero dependencies. Split out of lib/art.js purely to keep each
// file under a readable line budget — see that file's header for the
// chassis geometry/primitives this one builds on. This file owns "what does
// phase X (or outcome class Y) actually look like": marquee text/bulbs, the
// reel-cell content and hot flags, the info-strip text, the progressive
// payout counter, and the COMPACT/ULTRA-COMPACT layouts (§7.2/§8.17, which
// are hand-set fixed-format templates rather than a shrunk STANDARD, per
// gen.py's own literal source strings).
import { makeFrame, assertRect, span, compose } from './frame.js';
import { displayWidth, padStart as wPadStart, truncate as wTruncate } from './width.js';
import { COLORS, getSymbol, getThemedGlyph } from './symbols.js';
import { buildStandardFrame, buildGrandFrame, outcomeDurationMs, roleStyle, isSymbolId, LEVER_DURATION_MS, COMPACT_WIDTH, TITLE, CHASSIS_FILL_STYLE } from './art.js';

function compactLine(placements) {
  // See art.js's CHASSIS_FILL_STYLE comment: this line is built from
  // several independently-styled segments ("✻", "[...]",
  // "cr:NNN", the trailing "[-]") separated by gaps that must stay
  // explicitly painted rather than left as skippable plain whitespace.
  return compose(COMPACT_WIDTH, placements, { fillStyle: CHASSIS_FILL_STYLE });
}

function creditsDigits(size) {
  return size === 'grand' ? 4 : 3;
}

function fmtCredits(n, size) {
  return wPadStart(String(Math.max(0, Math.trunc(n))), creditsDigits(size), '0');
}

// ---------------------------------------------------------------------------
// Default (never-spun) dressing grid (§8.1's canonical idle combo)
// ---------------------------------------------------------------------------

const DEFAULT_TOP = ['DIFF', 'FILE', 'TOKEN'];
const DEFAULT_PAY = ['TEST', 'TOOL', 'PROSE'];
const DEFAULT_BOT = ['PROSE', 'DIFF', 'FILE'];
const NO_HOT = [false, false, false];

function bulbPair(t, periodMs = 600) {
  return Math.floor(t / periodMs) % 2 === 0 ? ['●○●○●', '●○●○●'] : ['○●○●○', '○●○●○'];
}

function grandBulbPair(t, periodMs = 600) {
  return Math.floor(t / periodMs) % 2 === 0 ? ['★●○●○●○★', '★●○●○●○★'] : ['★○●○●○●★', '★○●○●○●★'];
}

function tickCredits(creditsBefore, payout, tick) {
  const credits = Math.round(creditsBefore + payout * tick);
  const lastWin = Math.round(payout * tick);
  return { credits, lastWin };
}

function fmtElapsed(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

function fmtTokens(n) {
  const v = Math.max(0, Math.round(n || 0));
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);
}

function normalInfo(size, credits, lastWin, onTheHouse) {
  if (onTheHouse) return `CREDITS: ${fmtCredits(0, size)} · ON THE HOUSE`;
  return `CREDITS: ${fmtCredits(credits, size)}   LAST WIN: ${fmtCredits(lastWin, size)}`;
}

// ---------------------------------------------------------------------------
// Phase -> BoxParams resolvers. Each returns a params object consumable by
// buildStandardFrame/buildGrandFrame directly (size-independent content).
// ---------------------------------------------------------------------------

function idleParams(ctx) {
  const outcome = ctx.outcome;
  const [top, pay, bot] = outcome
    ? [[0, 1, 2].map((i) => outcome.grid[i][0]), [0, 1, 2].map((i) => outcome.grid[i][1]), [0, 1, 2].map((i) => outcome.grid[i][2])]
    : [DEFAULT_TOP, DEFAULT_PAY, DEFAULT_BOT];
  const [bl, br] = ctx.size === 'grand' ? grandBulbPair(ctx.now ?? ctx.t) : bulbPair(ctx.now ?? ctx.t);
  const onTheHouse = ctx.economy.credits <= 0;
  const infoLeft = normalInfo(ctx.size, ctx.economy.credits, ctx.economy.lastWin, onTheHouse);
  return {
    marqueeText: TITLE, bulbsLeft: bl, bulbsRight: br, bulbMode: 'bulbs',
    topSyms: top, paySyms: pay, botSyms: bot, hotCols: NO_HOT, tone: 'normal', theme: ctx.theme,
    knobRow: 0, infoLeft, infoRight: '',
  };
}

function leverParams(t, economy, size) {
  const knobRow = Math.min(4, Math.floor(t / (LEVER_DURATION_MS / 5)));
  const onTheHouse = economy.credits <= 0;
  return {
    marqueeText: TITLE, bulbsLeft: '♦♣☼♠♥', bulbsRight: '♦♣☼♠♥', bulbMode: 'decor',
    topSyms: DEFAULT_TOP, paySyms: DEFAULT_PAY, botSyms: DEFAULT_BOT, hotCols: NO_HOT,
    knobRow, infoLeft: normalInfo(size, economy.credits, economy.lastWin, onTheHouse), infoRight: '...',
  };
}

const SPINUP_FRAMES = [
  { bulbs: '▓▒░▒▓', top: ['▒', '▒', '▒'], pay: ['▓', '▓', '▓'], bot: ['▒', '▒', '▒'], knobRow: 4 },
  { bulbs: '▒░▓░▒', top: ['▓', '▒', '▒'], pay: ['▓', '▓', '▓'], bot: ['▓', '▒', '▒'], knobRow: 4 },
  { bulbs: '░▓▒▓░', top: ['▓', '▓', '▓'], pay: ['▓', '▓', '▓'], bot: ['▓', '▓', '▓'], knobRow: 0 },
];

function spinupParams(t) {
  const idx = Math.min(2, Math.floor(t / 400));
  const f = SPINUP_FRAMES[idx];
  return {
    marqueeText: TITLE, bulbsLeft: f.bulbs, bulbsRight: f.bulbs, bulbMode: 'blur',
    topSyms: f.top, paySyms: f.pay, botSyms: f.bot, hotCols: NO_HOT,
    knobRow: f.knobRow, infoLeft: 'SPINNING...  0:00   0 tok', infoRight: '',
  };
}

const GLINT_SWEEPS = [
  { top: ['░', '▓', '▓'], pay: ['▒', '▓', '▓'], bot: ['░', '▓', '▓'] },
  { top: ['▓', '▒', '▓'], pay: ['▓', '░', '▓'], bot: ['▓', '▒', '▓'] },
  { top: ['▓', '▓', '░'], pay: ['▓', '▓', '▒'], bot: ['▓', '▓', '░'] },
];
const GLINT_PERIOD_MS = 7000;
const GLINT_SUB_MS = 170;
const EASE_PERIOD_MS = 6000;
const EASE_TOTAL_MS = 400;

function spinningParams(t, info) {
  const elapsedMs = info.elapsedMs ?? t;
  const tokens = info.tokens ?? 0;
  const infoLeft = `SPINNING...  ${fmtElapsed(elapsedMs)}   ${fmtTokens(tokens)} tok`;
  const infoRight = '';
  const glintPos = t % GLINT_PERIOD_MS;
  if (glintPos < GLINT_SUB_MS * 3) {
    const f = GLINT_SWEEPS[Math.floor(glintPos / GLINT_SUB_MS)];
    return { marqueeText: TITLE, bulbsLeft: '●○●○●', bulbsRight: '●○●○●', bulbMode: 'bulbs', topSyms: f.top, paySyms: f.pay, botSyms: f.bot, hotCols: NO_HOT, knobRow: 0, infoLeft, infoRight };
  }
  if (t % EASE_PERIOD_MS < EASE_TOTAL_MS) {
    return { marqueeText: TITLE, bulbsLeft: '▒▓▒▓▒', bulbsRight: '▒▓▒▓▒', bulbMode: 'blur', topSyms: ['▒', '▓', '▒'], paySyms: ['▒', '▓', '▒'], botSyms: ['▒', '▓', '▒'], hotCols: NO_HOT, knobRow: 0, infoLeft, infoRight };
  }
  return { marqueeText: TITLE, bulbsLeft: '▓▓▓▓▓', bulbsRight: '▓▓▓▓▓', bulbMode: 'blur', topSyms: ['▓', '▓', '▓'], paySyms: ['▓', '▓', '▓'], botSyms: ['▓', '▓', '▓'], hotCols: NO_HOT, knobRow: 0, infoLeft, infoRight };
}

function stoppingParams(t, outcome, reelLocks, overshoot) {
  const lockedN = reelLocks.filter(Boolean).length;
  // The near-miss overshoot (§5/§8.5) only teases the illusory triple on the
  // PAYLINE row — reel 3's dressing (top/bottom) cells are still mid-settle
  // and show the transitional '▒' placeholder (build_spec.py's literal
  // [DIFF,DIFF,"▒"]/[PROSE,PROSE,"▒"] source), never the true settled grid
  // value (that only appears once REVEAL starts) and never plain spin-blur.
  const isOvershootReel = (i) => overshoot && i === 2;
  const top = [0, 1, 2].map((i) => (isOvershootReel(i) ? '▒' : reelLocks[i] ? outcome.grid[i][0] : '▓'));
  const pay = [0, 1, 2].map((i) => (isOvershootReel(i) ? outcome.paylineSymbols[0] : reelLocks[i] ? outcome.grid[i][1] : '▓'));
  const bot = [0, 1, 2].map((i) => (isOvershootReel(i) ? '▒' : reelLocks[i] ? outcome.grid[i][2] : '▓'));
  return {
    marqueeText: TITLE, bulbsLeft: '●●●●●', bulbsRight: '●●●●●', bulbMode: 'bulbs',
    topSyms: top, paySyms: pay, botSyms: bot, hotCols: NO_HOT, knobRow: 0,
    infoLeft: `WORKING...  DONE.  locking reel ${lockedN}`, infoRight: '',
  };
}

function hotColsFor(outcome) {
  if (['JACKPOT', 'MEDALLION', 'TRIPLE'].includes(outcome.outcomeClass)) return [true, true, true];
  if (outcome.outcomeClass === 'DOUBLE') {
    // exactly the two positions holding the matched (doubled) symbol are hot
    const counts = {};
    outcome.paylineSymbols.forEach((s) => (counts[s] = (counts[s] || 0) + 1));
    return outcome.paylineSymbols.map((s) => counts[s] === 2);
  }
  return [false, false, false];
}

function revealParams(outcome, creditsBefore, size) {
  const hot = hotColsFor(outcome);
  const [top, pay, bot] = [0, 1, 2].map((r) => [0, 1, 2].map((i) => outcome.grid[i][r]));
  return {
    marqueeText: TITLE, bulbsLeft: hot.some(Boolean) ? '★●★●★' : '●●●●●', bulbsRight: hot.some(Boolean) ? '★●★●★' : '●●●●●', bulbMode: 'bulbs',
    topSyms: top, paySyms: pay, botSyms: bot, hotCols: hot, knobRow: 0, outerHot: false,
    infoLeft: normalInfo(size, creditsBefore, 0, false), infoRight: '',
  };
}

// --- per-class OUTCOME sub-frame resolvers ----------------------------------

function gridRows(outcome) {
  return [0, 1, 2].map((r) => [0, 1, 2].map((i) => outcome.grid[i][r]));
}

function outcomeJackpot(t, o, creditsBefore, size) {
  const [top, pay, bot] = gridRows(o);
  const hot = [true, true, true];
  if (t < 100) {
    const { credits, lastWin } = tickCredits(creditsBefore, o.payout, 0);
    return { marqueeText: '* * *  J A C K P O T  * * *', bulbsLeft: '★★★★★', bulbsRight: '★★★★★', bulbMode: 'decor', topSyms: top, paySyms: pay, botSyms: bot, hotCols: hot, knobRow: 0, outerHot: true, infoLeft: normalInfo(size, credits, lastWin), infoRight: '' };
  }
  if (t < 900) {
    const { credits, lastWin } = tickCredits(creditsBefore, o.payout, 0);
    return { marqueeText: 'J A C K P O T ! ! !', bulbsLeft: '  ●   ●', bulbsRight: '●   ●  ', bulbMode: 'decor', topSyms: top, paySyms: pay, botSyms: bot, hotCols: hot, knobRow: 0, outerHot: true, infoLeft: normalInfo(size, credits, lastWin), infoRight: '' };
  }
  if (t < 1900) {
    const tick = (t - 900) / 1000;
    const { credits, lastWin } = tickCredits(creditsBefore, o.payout, tick);
    return { marqueeText: 'J A C K P O T ! ! !', bulbsLeft: ' ●  ● ', bulbsRight: ' ●  ●', bulbMode: 'decor', topSyms: top, paySyms: pay, botSyms: bot, hotCols: hot, knobRow: 0, outerHot: true, infoLeft: normalInfo(size, credits, lastWin), infoRight: '*** PAYOUT ***' };
  }
  const { credits, lastWin } = tickCredits(creditsBefore, o.payout, 1);
  return { marqueeText: 'J A C K P O T ! ! !', bulbsLeft: '  ●  ', bulbsRight: '  ●  ', bulbMode: 'decor', topSyms: top, paySyms: pay, botSyms: bot, hotCols: hot, knobRow: 0, outerHot: true, infoLeft: normalInfo(size, credits, lastWin), infoRight: '' };
}

function outcomeMedallion(t, o, creditsBefore, size) {
  const [top, pay, bot] = gridRows(o);
  const hot = [true, true, true];
  const tick = t < 200 ? 0 : 1;
  const { credits, lastWin } = tickCredits(creditsBefore, o.payout, tick);
  if (t < 200) {
    return { marqueeText: 'S I G N A T U R E   C O M B O', bulbsLeft: '☆●☆●☆', bulbsRight: '☆●☆●☆', bulbMode: 'decor', topSyms: top, paySyms: pay, botSyms: bot, hotCols: hot, knobRow: 0, outerHot: true, infoLeft: normalInfo(size, credits, lastWin), infoRight: '' };
  }
  if (t < 1200) {
    const sweepA = Math.floor(t / 200) % 2 === 0;
    return { marqueeText: 'C L A U D E !', bulbsLeft: sweepA ? '  ☆    ' : '    ☆  ', bulbsRight: sweepA ? '    ☆  ' : '  ☆    ', bulbMode: 'decor', topSyms: top, paySyms: pay, botSyms: bot, hotCols: hot, knobRow: 0, outerHot: true, infoLeft: normalInfo(size, credits, lastWin), infoRight: '' };
  }
  return { marqueeText: 'S I G N A T U R E   C O M B O', bulbsLeft: '☆★☆★☆', bulbsRight: '☆★☆★☆', bulbMode: 'decor', topSyms: top, paySyms: pay, botSyms: bot, hotCols: hot, knobRow: 0, outerHot: true, infoLeft: normalInfo(size, credits, lastWin), infoRight: '' };
}

function outcomeTriple(t, o, creditsBefore, total, size) {
  const [top, pay, bot] = gridRows(o);
  const pulseEnd = total * 0.5;
  const tickEnd = total * 0.8;
  if (t < pulseEnd) {
    const bright = Math.floor(t / 180) % 2 === 0;
    const { credits, lastWin } = tickCredits(creditsBefore, o.payout, 0);
    return { marqueeText: TITLE, bulbsLeft: '●○●○●', bulbsRight: '●○●○●', bulbMode: 'bulbs', topSyms: top, paySyms: pay, botSyms: bot, hotCols: bright ? [true, true, true] : [false, false, false], knobRow: 0, outerHot: bright, infoLeft: normalInfo(size, credits, lastWin), infoRight: '' };
  }
  const tick = t < tickEnd ? (t - pulseEnd) / (tickEnd - pulseEnd) : 1;
  const { credits, lastWin } = tickCredits(creditsBefore, o.payout, tick);
  return { marqueeText: TITLE, bulbsLeft: '●●●●●', bulbsRight: '●●●●●', bulbMode: 'bulbs', topSyms: top, paySyms: pay, botSyms: bot, hotCols: [true, true, true], knobRow: 0, outerHot: true, infoLeft: normalInfo(size, credits, lastWin), infoRight: '' };
}

function outcomeDouble(t, o, creditsBefore, size) {
  const [top, pay, bot] = gridRows(o);
  const hot = hotColsFor(o);
  if (t < 300) {
    const { credits, lastWin } = tickCredits(creditsBefore, o.payout, 0);
    return { marqueeText: TITLE, bulbsLeft: '●○●○●', bulbsRight: '●○●○●', bulbMode: 'bulbs', topSyms: top, paySyms: pay, botSyms: bot, hotCols: hot, knobRow: 0, infoLeft: normalInfo(size, credits, lastWin), infoRight: '' };
  }
  const { credits, lastWin } = tickCredits(creditsBefore, o.payout, 1);
  return { marqueeText: TITLE, bulbsLeft: '●○●○●', bulbsRight: '●○●○●', bulbMode: 'bulbs', topSyms: top, paySyms: pay, botSyms: bot, hotCols: NO_HOT, knobRow: 0, infoLeft: normalInfo(size, credits, lastWin), infoRight: '' };
}

function outcomeNearMiss(t, o, creditsBefore, size) {
  const [top, pay, bot] = gridRows(o);
  const base = { topSyms: top, paySyms: pay, botSyms: bot, hotCols: NO_HOT, knobRow: 0, tone: 'normal' };
  const info = normalInfo(size, creditsBefore, 0);
  if (t < 450) return { ...base, marqueeText: TITLE, bulbsLeft: '●●●●●', bulbsRight: '●●●●●', bulbMode: 'bulbs', infoLeft: info, infoRight: '' };
  if (t < 1350) return { ...base, marqueeText: TITLE, bulbsLeft: '○○○○○', bulbsRight: '○○○○○', bulbMode: 'bulbs', infoLeft: 'SO CLOSE...', infoRight: '' };
  return { ...base, marqueeText: TITLE, bulbsLeft: '●○●○●', bulbsRight: '●○●○●', bulbMode: 'bulbs', infoLeft: info, infoRight: '' };
}

function outcomeLose(t, o, creditsBefore, size) {
  const [top, pay, bot] = gridRows(o);
  const base = { topSyms: top, paySyms: pay, botSyms: bot, hotCols: NO_HOT, knobRow: 0, tone: 'dim' };
  const info = normalInfo(size, creditsBefore, 0);
  if (t < 500) return { ...base, marqueeText: TITLE, bulbsLeft: '○○○○○', bulbsRight: '○○○○○', bulbMode: 'bulbs', infoLeft: info, infoRight: '' };
  if (t < 1100) return { ...base, marqueeText: TITLE, bulbsLeft: '○○○○○', bulbsRight: '○○○○○', bulbMode: 'bulbs', infoLeft: 'no dice, spin again?  o_o', infoRight: '' };
  return { ...base, tone: 'normal', marqueeText: TITLE, bulbsLeft: '●○●○●', bulbsRight: '●○●○●', bulbMode: 'bulbs', infoLeft: info, infoRight: '' };
}

function jamParams(t, creditsAfter, size) {
  if (t < 300) {
    return { marqueeText: TITLE, bulbsLeft: '▓▒░', bulbsRight: '░▒▓', bulbMode: 'brake', topSyms: ['▓', '░', '▒'], paySyms: ['▒', '▓', '░'], botSyms: ['░', '▒', '▓'], hotCols: NO_HOT, knobRow: 3, infoLeft: 'esc pressed — brake engaged...', infoRight: '' };
  }
  return { marqueeText: 'I N T E R R U P T E D', marqueeStyle: roleStyle(COLORS.abortedText), bulbsLeft: '◆ ◆', bulbsRight: '◆ ◆', bulbMode: 'decor', topSyms: ['—', '—', '—'], paySyms: ['—', '—', '—'], botSyms: ['—', '—', '—'], hotCols: NO_HOT, knobRow: 4, infoLeft: `CREDITS: ${fmtCredits(creditsAfter, size)}   spin refunded`, infoRight: '' };
}

function malfunctionParams(t, creditsAfter, size) {
  if (t < 300) {
    return { marqueeText: TITLE, bulbsLeft: '▓▒░', bulbsRight: '░▒▓', bulbMode: 'void', topSyms: ['░', '░', '░'], paySyms: ['░', '░', '░'], botSyms: ['░', '░', '░'], hotCols: NO_HOT, knobRow: 3, infoLeft: 'hmm, something jammed...', infoRight: '' };
  }
  return { marqueeText: '* * *  E R R O R  * * *', marqueeStyle: roleStyle(COLORS.errorText), bulbsLeft: '░ ░', bulbsRight: '░ ░', bulbMode: 'void', topSyms: ['—', '—', '—'], paySyms: ['—', '—', '—'], botSyms: ['—', '—', '—'], hotCols: NO_HOT, knobRow: 4, infoLeft: `CREDITS: ${fmtCredits(creditsAfter, size)}   spin refunded`, infoRight: '' };
}

/** Resolve the full BoxParams for a given (phase, t, outcome, ...) — size-independent. */
export function resolveParams(ctx) {
  const { phase, t } = ctx;
  const outcome = ctx.outcome;
  switch (phase) {
    case 'IDLE':
    case 'RESULT':
      return idleParams(ctx);
    case 'LEVER':
      return leverParams(t, ctx.economy, ctx.size);
    case 'SPINUP':
      return spinupParams(t);
    case 'SPINNING':
      return spinningParams(t, ctx.info || {});
    case 'STOPPING':
      return stoppingParams(t, outcome, ctx.reelLocks, ctx.overshoot);
    case 'REVEAL':
      return revealParams(outcome, ctx.creditsBeforeOutcome, ctx.size);
    case 'OUTCOME': {
      const cb = ctx.creditsBeforeOutcome;
      switch (outcome.outcomeClass) {
        case 'JACKPOT': return outcomeJackpot(t, outcome, cb, ctx.size);
        case 'MEDALLION': return outcomeMedallion(t, outcome, cb, ctx.size);
        case 'TRIPLE': return outcomeTriple(t, outcome, cb, outcomeDurationMs('TRIPLE', outcome.tier), ctx.size);
        case 'DOUBLE': return outcomeDouble(t, outcome, cb, ctx.size);
        case 'NEAR_MISS': return outcomeNearMiss(t, outcome, cb, ctx.size);
        case 'LOSE': return outcomeLose(t, outcome, cb, ctx.size);
        default: return outcomeLose(t, outcome, cb, ctx.size);
      }
    }
    case 'JAM':
      return jamParams(t, ctx.economy.credits, ctx.size);
    case 'MALFUNCTION':
      return malfunctionParams(t, ctx.economy.credits, ctx.size);
    default:
      return idleParams(ctx);
  }
}

// ---------------------------------------------------------------------------
// COMPACT-size phase rendering (§7.2/§8.17) — structurally distinct from
// STANDARD/GRAND rather than a shrunk version of the same params shape.
// ---------------------------------------------------------------------------

// COMPACT/ULTRA-COMPACT lines are hand-set fixed-format templates in
// ART-SPEC §7.2/§8.17 (verified against gen.py's literal source strings),
// not an algorithmically-justified layout — so this file reproduces them as
// literal templates (numbers substituted in) rather than re-deriving
// column positions. `colorizeCompactText` then recovers per-glyph styling
// by recognizing known tokens, so the plain text stays byte-identical to
// the spec while still rendering in color.
const GLYPH_COLOR = {
  '◆C◆': () => ({ color: getSymbol('MEDALLION').color.hex, bold: true }),
  BAR: () => ({ color: getSymbol('TOOL').color.hex }),
  '✻': () => ({ color: getSymbol('CLAUDE').color.hex, bold: true }),
  '★': () => ({ color: getSymbol('TEST').color.hex }),
  '♦': () => ({ color: getSymbol('DIFF').color.hex }),
  '♣': () => ({ color: getSymbol('FILE').color.hex }),
  '☼': () => ({ color: getSymbol('TOKEN').color.hex }),
  '♥': () => ({ color: getSymbol('PROSE').color.hex }),
  '—': () => ({ color: COLORS.abortedText.hex, dim: true }),
};
const GLYPH_TOKENS_SORTED = Object.keys(GLYPH_COLOR).sort((a, b) => b.length - a.length);

function colorizeCompactText(text) {
  const spans = [];
  let i = 0;
  let plainStart = 0;
  const flushPlain = (end) => {
    if (end > plainStart) spans.push(span(text.slice(plainStart, end), roleStyle(COLORS.infoText)));
  };
  outer: while (i < text.length) {
    for (const tok of GLYPH_TOKENS_SORTED) {
      if (text.startsWith(tok, i)) {
        flushPlain(i);
        spans.push(span(tok, GLYPH_COLOR[tok]()));
        i += tok.length;
        plainStart = i;
        continue outer;
      }
    }
    i += 1;
  }
  flushPlain(text.length);
  return spans;
}

/**
 * COMPACT is a fixed ≤40-col budget (§7.2/§13.1), but the *actual* terminal
 * requesting it can be narrower still (a split pane, a phone SSH client, or
 * simply ctx.columns < COMPACT_WIDTH — resolveSize() picks 'compact' for
 * anything under 62 cols, not just exactly 40). Clamp the working width to
 * whatever's smaller, so COMPACT/ULTRA-COMPACT lines never assert/pad out
 * to a width wider than the terminal actually offered.
 */
function resolveCompactWidth(columns) {
  if (!Number.isFinite(columns) || columns <= 0) return COMPACT_WIDTH;
  return Math.max(1, Math.min(COMPACT_WIDTH, Math.trunc(columns)));
}

function compactTextLine(text, width = COMPACT_WIDTH) {
  // Defensive, like pushInfoStrip() in art.js: never throw on a too-long
  // line (a narrow terminal, or credits/lastWin grown past the assumed
  // digit budget) — truncate instead, so COMPACT never takes the whole
  // renderer down with it.
  const clipped = displayWidth(text) > width ? wTruncate(text, width) : text;
  const padded = clipped + ' '.repeat(Math.max(0, width - displayWidth(clipped)));
  return colorizeCompactText(padded);
}

function compactIdleLines(ctx, width = COMPACT_WIDTH) {
  const onTheHouse = ctx.economy.credits <= 0;
  const cr = fmtCredits(ctx.economy.credits, 'compact');
  const win = fmtCredits(ctx.economy.lastWin, 'compact');
  const line1 = `✻   ♦ BAR ✻   cr:${cr}`;
  const line2 = onTheHouse ? `ON THE HOUSE` : `win:${win}`;
  return [compactTextLine(line1, width), compactTextLine(line2, width)];
}

function compactSpinningLines(ctx, width = COMPACT_WIDTH) {
  const elapsedMs = (ctx.info && ctx.info.elapsedMs) ?? ctx.t;
  const tokens = (ctx.info && ctx.info.tokens) ?? 0;
  const cr = fmtCredits(ctx.economy.credits, 'compact');
  const line1 = `✻  [▓▓▓ spinning]  cr:${cr}`;
  const line2 = `${fmtElapsed(elapsedMs)}  ${fmtTokens(tokens)} tok`;
  return [compactTextLine(line1, width), compactTextLine(line2, width)];
}

function compactPayline(symbols, theme) {
  return symbols.map((s) => (isSymbolId(s) ? getThemedGlyph(s, theme) : s)).join('|');
}

function compactOutcomeLines(ctx, width = COMPACT_WIDTH) {
  const o = ctx.outcome;
  const cls = o.outcomeClass;
  const symbols = o.paylineSymbols || ['—', '—', '—'];
  const bracket = `[${compactPayline(symbols, ctx.theme)}]`;
  const cr = fmtCredits(ctx.economy.credits, 'compact');
  if (cls === 'JACKPOT') {
    return [compactTextLine(`✻  [✻ ✻ ✻]  JACKPOT +${o.payout}`, width), compactTextLine(`cr:${cr}  * * * CLAUDING * * *`, width)];
  }
  if (cls === 'MEDALLION') {
    return [compactTextLine(`✻ [◆C◆|◆C◆|◆C◆] SIGNATURE`, width), compactTextLine(`cr:${cr}  +${o.payout}  so claude`, width)];
  }
  if (cls === 'TRIPLE') return [compactTextLine(`✻ ${bracket} TRIPLE +${o.payout}`, width)];
  if (cls === 'DOUBLE') return [compactTextLine(`✻ ${bracket}  DOUBLE +${o.payout}`, width)];
  if (cls === 'NEAR_MISS') return [compactTextLine(`✻ ${bracket}  so close...`, width)];
  if (cls === 'LOSE') return [compactTextLine(`✻ ${bracket}  no win  cr:${cr}`, width)];
  if (cls === 'ABORTED') return [compactTextLine(`✻ [—|—|—]  INTERRUPTED`, width)];
  return [compactTextLine(`✻ [—|—|—]  ERROR  cr:${cr}`, width)]; // ERROR
}

function ultraCompactLines(ctx, width = COMPACT_WIDTH) {
  if (ctx.phase === 'SPINNING' || ctx.phase === 'SPINUP') {
    const elapsedMs = (ctx.info && ctx.info.elapsedMs) ?? ctx.t;
    const tokens = (ctx.info && ctx.info.tokens) ?? 0;
    const cr = fmtCredits(ctx.economy.credits, 'compact');
    return [compactTextLine(`[spinning ${fmtElapsed(elapsedMs)} ${fmtTokens(tokens)} tok] cr:${cr}`, width)];
  }
  const onTheHouse = ctx.economy.credits <= 0;
  const cr = fmtCredits(ctx.economy.credits, 'compact');
  const win = fmtCredits(ctx.economy.lastWin, 'compact');
  const status = onTheHouse ? 'ON THE HOUSE' : `cr:${cr} win:${win}`;
  return [compactTextLine(`♦ BAR ✻ * ${status} *`, width)];
}

function buildCompactFrame(linesArr, width = COMPACT_WIDTH) {
  const fr = makeFrame(width);
  fr.lines.push(...linesArr);
  return assertRect(fr);
}

// ---------------------------------------------------------------------------
// Top-level dispatcher — machine.js's only entry point into this module.
// ---------------------------------------------------------------------------

/**
 * @param {object} ctx see machine.js's frame() for the full shape:
 *   {size, columns, maxRows, phase, t, outcome, reelLocks, overshoot,
 *    economy, creditsBeforeOutcome, info, theme}
 * @returns {import('./frame.js').Frame}
 */
export function renderFrame(ctx) {
  if (ctx.size === 'compact') {
    const width = resolveCompactWidth(ctx.columns);
    const ultra = width <= 36 || ctx.maxRows === 1;
    if (ultra) return buildCompactFrame(ultraCompactLines(ctx, width), width);
    if (ctx.phase === 'SPINNING' || ctx.phase === 'SPINUP') return buildCompactFrame(compactSpinningLines(ctx, width), width);
    if (ctx.phase === 'IDLE' || ctx.phase === 'RESULT') return buildCompactFrame(compactIdleLines(ctx, width), width);
    if (['OUTCOME', 'JAM', 'MALFUNCTION'].includes(ctx.phase)) {
      const synthetic = ctx.phase === 'JAM' ? { outcomeClass: 'ABORTED' } : ctx.phase === 'MALFUNCTION' ? { outcomeClass: 'ERROR' } : ctx.outcome;
      return buildCompactFrame(compactOutcomeLines({ ...ctx, outcome: synthetic }, width), width);
    }
    return buildCompactFrame(compactIdleLines(ctx, width), width);
  }
  const params = resolveParams(ctx);
  return ctx.size === 'grand' ? buildGrandFrame(params) : buildStandardFrame(params);
}
