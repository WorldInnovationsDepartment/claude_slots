// Claude Slots — chassis art & storyboards (lib/art.js)
//
// Pure ESM, zero dependencies. Owns everything docs/ART-SPEC.md §7-§14
// describe: the STANDARD/COMPACT/GRAND chassis geometry, the marquee/reel
// bay/lever primitives, every phase's and outcome class's storyboard
// content and sub-beat timing, the info strip, the transcript result line
// (§12), and RETURN TO IDLE (§8.15). machine.js supplies only *when*
// (phase, elapsed-ms-in-phase, the pre-rolled outcome, reel-lock booleans);
// this file decides everything about what that looks like. Every builder
// returns a Frame and is assertRect-checked before it is handed back.

// This file holds the chassis geometry/primitives, the STANDARD/GRAND
// builder, and the §12 transcript result line. The per-phase/per-outcome
// storyboard content (what LEVER/SPINNING/OUTCOME/etc. actually look like,
// and the COMPACT/ULTRA-COMPACT layouts) lives in ./art-storyboards.js,
// re-exported below — split out purely to keep each file under a readable
// line budget; machine.js and tests both just `import ... from './art.js'`.
import { makeFrame, span, line, compose, assertRect, frameToPlainText } from './frame.js';
import { displayWidth } from './width.js';
import { SYMBOL_IDS, getSymbol, getThemedGlyph, COLORS } from './symbols.js';

// ---------------------------------------------------------------------------
// Storyboard timing constants — the single source of truth for how long
// each phase/sub-beat lasts. machine.js imports these for its phase-boundary
// arithmetic; this file uses them to pick which sub-frame is on screen.
// ---------------------------------------------------------------------------

export const LEVER_DURATION_MS = 800; // §8.2, 5 knob positions ~160ms apart
export const SPINUP_DURATION_MS = 1200; // §8.3, 3 stagger beats of 400ms
export const STOPPING_STAGGER_MS = 300; // §8.5: reel2 +300, reel3 +600
export const OVERSHOOT_MS = 80; // §5: the illusory near-miss triple beat
export const REVEAL_DURATION_MS = 300; // §8.6
export const JAM_DURATION_MS = 600; // §8.13: 300 brake + 300 settled
export const MALFUNCTION_DURATION_MS = 600; // §8.14: mirrors JAM's timing

/** OUTCOME phase total duration, ms, by class (TRIPLE is further keyed by tier). */
export const OUTCOME_DURATIONS_MS = Object.freeze({
  JACKPOT: 2800,
  MEDALLION: 2100,
  TRIPLE: Object.freeze({ TOOL: 2200, TEST: 1900, TOKEN: 1700, FILE: 1600, DIFF: 1500, PROSE: 1500 }),
  DOUBLE: 1500,
  NEAR_MISS: 1800,
  LOSE: 1600,
});

export function outcomeDurationMs(outcomeClass, tier) {
  const d = OUTCOME_DURATIONS_MS[outcomeClass];
  if (d == null) return 1600;
  return typeof d === 'number' ? d : d[tier] ?? 1600;
}

// ---------------------------------------------------------------------------
// Chassis geometry (§7)
// ---------------------------------------------------------------------------

const STANDARD_GEO = Object.freeze({ width: 60, interior: 58, leftMargin: 10, cellW: 5, gap: 1, leverGap: 4 });
const GRAND_GEO = Object.freeze({ width: 80, interior: 78, leftMargin: 14, cellW: 7, gap: 1, leverGap: 4 });
export const COMPACT_WIDTH = 40;

export const TITLE = '✻';

export function roleStyle(role) {
  const s = { color: role.hex };
  if (role.bold) s.bold = true;
  if (role.dim) s.dim = true;
  return s;
}

function centerText(text, w) {
  const tw = displayWidth(text);
  const pad = w - tw;
  if (pad < 0) throw new Error(`centerText: ${JSON.stringify(text)} (width ${tw}) doesn't fit in ${w}`);
  const left = Math.floor(pad / 2);
  return ' '.repeat(left) + text + ' '.repeat(pad - left);
}

// --- reel-cell content resolution -------------------------------------------

/** True if `text` is one of the eight canonical symbol ids. */
export function isSymbolId(text) {
  return SYMBOL_IDS.includes(text);
}

function blurStyle(ch) {
  if (ch === '▓') return { color: COLORS.motionBlur.from };
  if (ch === '░') return { color: COLORS.motionBlur.to };
  if (ch === '▒') return { color: '#73757D' }; // midpoint of motionBlur.from/to
  if (ch === '—') return { color: COLORS.hintText.hex, dim: true };
  return { color: COLORS.infoText.hex };
}

/**
 * Resolve one reel cell's glyph + style. `entry` is either a symbol id
 * (§1's eight glyphs) or a literal decoration string ('▓','▒','░','—', a
 * single space for a still-blank slot). `tone: 'dim'` desaturates a real
 * symbol to the LOSE-state neutral gray (§9's "LOSE state... dim" rule).
 */
function cellContent(entry, { hot = false, tone = 'normal', theme = 'classic' } = {}) {
  if (isSymbolId(entry)) {
    const sym = getSymbol(entry);
    const glyph = getThemedGlyph(entry, theme);
    if (tone === 'dim') return { glyph, style: { color: COLORS.loseNeutral.hex, dim: true } };
    return { glyph, style: { color: sym.color.hex, bold: !!sym.color.bold || hot } };
  }
  return { glyph: entry, style: blurStyle(entry) };
}

// --- box-drawing primitives --------------------------------------------------

function boxEdge(kind, hot, w) {
  const left = hot ? (kind === 'top' ? '╔' : '╚') : kind === 'top' ? '┌' : '└';
  const right = hot ? (kind === 'top' ? '╗' : '╝') : kind === 'top' ? '┐' : '┘';
  const fill = hot ? '═' : '─';
  return left + fill.repeat(w) + right;
}

function wallStyle(hot) {
  return roleStyle(hot ? COLORS.reelFrameHot : COLORS.reelFrameIdle);
}

/**
 * Push the placements for one reel-bay row (top/mid/bot) across all 3 cells
 * into `placements`, starting at `startCol`. `entries` is a length-3 array
 * (ignored for top/bot). `payline` swaps the row's two OUTERMOST wall
 * characters for the block-bar markers (§6/§7 anatomy note) — internal
 * cell walls are untouched.
 */
function pushReelRow(placements, startCol, geo, kind, entries, hots, payline, opts) {
  const { cellW: w, gap } = geo;
  const cellSpan = w + 2 + gap;
  for (let i = 0; i < 3; i++) {
    const col = startCol + i * cellSpan;
    const hot = hots[i];
    if (kind === 'top' || kind === 'bot') {
      placements.push({ col, text: boxEdge(kind, hot, w), style: wallStyle(hot) });
    } else {
      const wallCh = hot ? '║' : '│';
      const ws = wallStyle(hot);
      const { glyph, style } = cellContent(entries[i], { hot, ...opts });
      placements.push({ col, text: wallCh, style: ws });
      placements.push({ col: col + 1, text: centerText(glyph, w), style });
      placements.push({ col: col + 1 + w, text: wallCh, style: ws });
    }
  }
  if (payline) {
    const rowWidth = 3 * (w + 2) + 2 * gap;
    const barStyle = roleStyle(hots.some(Boolean) ? COLORS.paylineBarHot : COLORS.paylineBarIdle);
    placements.push({ col: startCol, text: '▐', style: barStyle });
    placements.push({ col: startCol + rowWidth - 1, text: '▌', style: barStyle });
  }
}

const BULB_STYLES = {
  bulbs: (ch) => (ch === '●' ? roleStyle(COLORS.bulbLit) : ch === '○' ? roleStyle(COLORS.bulbUnlit) : ch === '★' ? roleStyle(COLORS.chassisBorderHot) : roleStyle(COLORS.bulbLit)),
  blur: (ch) => blurStyle(ch),
  decor: (ch) => {
    if (ch === '●') return roleStyle(COLORS.coins);
    if (ch === '○') return roleStyle(COLORS.bulbUnlit);
    if (ch === '★') return roleStyle(COLORS.chassisBorderHot);
    if (ch === '☆') return roleStyle(COLORS.sunburst);
    // Was hardcoded to '#FF8A3D' — byte-identical to MEDALLION's signature
    // orange (symbols.js), so the JAM 'INTERRUPTED' banner's flanking '◆ ◆'
    // glyphs collided visually with the game's second-rarest win. Use the
    // ABORTED role color instead so it reads as "something stopped", not
    // "you won something special".
    if (ch === '◆') return { color: COLORS.abortedText.hex };
    if (ch === '♦') return { color: getSymbol('DIFF').color.hex };
    if (ch === '♣') return { color: getSymbol('FILE').color.hex };
    if (ch === '☼') return { color: getSymbol('TOKEN').color.hex };
    if (ch === '♥') return { color: getSymbol('PROSE').color.hex };
    if (ch === ' ') return {};
    return { color: COLORS.infoText.hex };
  },
  void: () => roleStyle(COLORS.errorText),
  brake: () => roleStyle(COLORS.abortedText),
};

function pushMarquee(placements, geo, marqueeText, bulbsLeft, bulbsRight, bulbMode, marqueeStyle) {
  const bulbStyler = BULB_STYLES[bulbMode] || BULB_STYLES.decor;
  const parts = [];
  for (const ch of bulbsLeft) parts.push({ text: ch, style: bulbStyler(ch) });
  parts.push({ text: '  ', style: {} });
  parts.push({ text: marqueeText, style: marqueeStyle || roleStyle(COLORS.wordmark) });
  parts.push({ text: '  ', style: {} });
  for (const ch of bulbsRight) parts.push({ text: ch, style: bulbStyler(ch) });
  const total = parts.reduce((w, p) => w + displayWidth(p.text), 0);
  const pad = geo.interior - total;
  if (pad < 0) throw new Error(`pushMarquee: marquee too wide for interior ${geo.interior}`);
  let col = Math.floor(pad / 2);
  for (const p of parts) {
    if (p.text.length) placements.push({ col, text: p.text, style: p.style });
    col += displayWidth(p.text);
  }
}

function pushInfoStrip(placements, geo, left, right) {
  const w = geo.interior;
  const rw = displayWidth(right);
  const lw = displayWidth(left);
  if (lw + rw > w) {
    // defensive: never throw on a too-long info line — truncate the left field
    const budget = Math.max(0, w - rw - 1);
    left = left.slice(0, budget);
  }
  placements.push({ col: 0, text: left, style: roleStyle(COLORS.infoText) });
  if (right) placements.push({ col: w - displayWidth(right), text: right, style: roleStyle(COLORS.hintText) });
}

/**
 * @typedef {{
 *   marqueeText: string, bulbsLeft: string, bulbsRight: string, bulbMode?: 'bulbs'|'blur'|'decor'|'void'|'brake',
 *   topSyms: [string,string,string], paySyms: [string,string,string], botSyms: [string,string,string],
 *   hotCols: [boolean,boolean,boolean], tone?: 'normal'|'dim', theme?: 'classic'|'emoji',
 *   knobRow: number|null, infoLeft: string, infoRight: string, outerHot?: boolean,
 *   marqueeStyle?: {color?:string, bold?:boolean, dim?:boolean},
 * }} BoxParams
 */

// Every interior cell of the chassis (between the two `║` borders) is
// composed onto a canvas whose UNPLACED cells get this fill: an explicit
// `bg` matching symbols.js's COLORS.background (§9's "dark ground every
// foreground color sits on"), never a styleless space. This isn't just
// cosmetic: Claude Code's Ink-based renderer treats a plain, unstyled
// whitespace run as safe to skip over with a cursor-forward/CHA jump
// instead of actually writing space bytes (verified live — see the "stale
// digits inside the chassis" note in docs/ARCHITECTURE.md §4). That's only
// safe when the terminal cells under the jump are already correctly blank.
// They aren't always: the Spinner/AbovePrompt chassis renders *inline* in
// the same scrolling transcript region as the model's streamed text
// (ARCHITECTURE.md's scroll-region evidence), so a row the chassis is about
// to occupy can still hold leftover transcript characters from a moment
// earlier. Giving every interior cell an explicit background forces the
// renderer to actually paint it — it can no longer treat the run as a
// no-op — which overwrites any such stale content instead of skipping past
// it. Every compose() call below that builds a chassis interior line must
// carry this fillStyle. Exported so art-storyboards.js's COMPACT single-line
// layout (the same class of multi-span, gapped line) can reuse it too.
export const CHASSIS_FILL_STYLE = Object.freeze({ bg: COLORS.background.hex });

/** @param {typeof STANDARD_GEO} geo @param {BoxParams} p */
function buildBoxFrame(geo, p) {
  const { width, interior, leftMargin } = geo;
  const fr = makeFrame(width);
  const borderStyle = roleStyle(p.outerHot ? COLORS.chassisBorderHot : COLORS.chassisBorderIdle);
  const wrap = (interiorSpans) => line(span('║', borderStyle), ...interiorSpans, span('║', borderStyle));
  const composeInterior = (placements) => compose(interior, placements, { fillStyle: CHASSIS_FILL_STYLE });

  fr.lines.push(line(span('╔' + '═'.repeat(interior) + '╗', borderStyle)));

  const marqueePlacements = [];
  pushMarquee(marqueePlacements, geo, p.marqueeText, p.bulbsLeft, p.bulbsRight, p.bulbMode || 'bulbs', p.marqueeStyle);
  fr.lines.push(wrap(composeInterior(marqueePlacements)));

  fr.lines.push(line(span('╠' + '═'.repeat(interior) + '╣', borderStyle)));

  const leverCol = leftMargin + 3 * (geo.cellW + 2) + 2 * geo.gap + geo.leverGap;
  const knobStyle = roleStyle(COLORS.bulbLit);
  const rodStyle = roleStyle(COLORS.reelFrameIdle);
  const leverGlyphFor = (row) => {
    if (p.knobRow == null) return null;
    if (row < p.knobRow) return { ch: '│', style: rodStyle };
    if (row === p.knobRow) return { ch: '●', style: knobStyle };
    return null;
  };

  const bodyOpts = { tone: p.tone || 'normal', theme: p.theme || 'classic' };
  const rowKinds = ['top', 'mid', 'mid', 'mid', 'bot'];
  const rowEntries = [null, p.topSyms, p.paySyms, p.botSyms, null];
  for (let row = 0; row < 5; row++) {
    const placements = [];
    pushReelRow(placements, leftMargin, geo, rowKinds[row], rowEntries[row], p.hotCols, row === 2, bodyOpts);
    const lg = leverGlyphFor(row);
    if (lg) placements.push({ col: leverCol, text: lg.ch, style: lg.style });
    fr.lines.push(wrap(composeInterior(placements)));
  }

  fr.lines.push(line(span('╠' + '═'.repeat(interior) + '╣', borderStyle)));

  const infoPlacements = [];
  pushInfoStrip(infoPlacements, geo, p.infoLeft, p.infoRight);
  fr.lines.push(wrap(composeInterior(infoPlacements)));

  fr.lines.push(line(span('╚' + '═'.repeat(interior) + '╝', borderStyle)));

  return assertRect(fr);
}

export function buildStandardFrame(p) {
  return buildBoxFrame(STANDARD_GEO, p);
}
export function buildGrandFrame(p) {
  return buildBoxFrame(GRAND_GEO, p);
}

function placeParts(placements, col, parts) {
  let c = col;
  for (const p of parts) {
    if (p.text.length) placements.push({ col: c, text: p.text, style: p.style });
    c += displayWidth(p.text);
  }
  return c;
}

// ---------------------------------------------------------------------------
// §12 — Transcript result line (the permanent static record)
// ---------------------------------------------------------------------------

const RESULT_LABELS = {
  JACKPOT: (o) => `JACKPOT +${o.payout}`,
  MEDALLION: (o) => `SIGNATURE +${o.payout}`,
  TRIPLE: (o) => `TRIPLE +${o.payout}`,
  DOUBLE: (o) => `DOUBLE +${o.payout}`,
  NEAR_MISS: () => `so close +0`,
  LOSE: () => `no win`,
  ABORTED: () => `INTERRUPTED`,
  ERROR: () => `ERROR`,
};

/**
 * Build the permanent 1-line transcript record (§12): `▐ a │ b │ c ▌ LABEL
 * payout ✦ credits N · Ts`. `outcome` is a rollOutcome() result, or a
 * synthetic `{outcomeClass:'ABORTED'|'ERROR'}`.
 * @param {{outcomeClass:string, paylineSymbols?:string[], payout?:number}} outcome
 * @param {{credits:number, elapsedSec:number, theme?:string}} info
 */
export function resultLine(outcome, info) {
  const cls = outcome.outcomeClass;
  const theme = info.theme || 'classic';
  const symbols = outcome.paylineSymbols || ['—', '—', '—'];
  const placements = [];
  let col = 0;
  const barStyle = roleStyle(cls === 'ABORTED' || cls === 'ERROR' ? COLORS.abortedText : COLORS.paylineBarIdle);
  col = placeParts(placements, col, [{ text: '▐ ', style: barStyle }]);
  symbols.forEach((s, i) => {
    if (i > 0) col = placeParts(placements, col, [{ text: ' │ ', style: roleStyle(COLORS.infoText) }]);
    const { glyph, style } = isSymbolId(s) ? cellContent(s, { theme }) : { glyph: s, style: blurStyle(s) };
    col = placeParts(placements, col, [{ text: glyph, style }]);
  });
  col = placeParts(placements, col, [{ text: ' ▌ ', style: barStyle }]);
  const label = (RESULT_LABELS[cls] || (() => cls))(outcome);
  const labelStyle = cls === 'ERROR' ? roleStyle(COLORS.errorText) : cls === 'ABORTED' ? roleStyle(COLORS.abortedText) : roleStyle(COLORS.wordmark);
  col = placeParts(placements, col, [{ text: label, style: labelStyle }]);
  col = placeParts(placements, col, [{ text: ` ✦ credits ${Math.max(0, Math.trunc(info.credits))} · ${Math.max(0, Math.trunc(info.elapsedSec))}s`, style: roleStyle(COLORS.infoText) }]);

  const width = Math.max(col, info.columns || col);
  const fr = makeFrame(width);
  const pad = width - col;
  const spans = placements.map((p) => span(p.text, p.style));
  // Same rationale as CHASSIS_FILL_STYLE above: an explicit bg on the
  // trailing pad keeps the renderer from CHA-jumping over it and leaving
  // whatever a wider previous line (e.g. the "Baked for Ns" TurnDuration
  // text this result line replaces) left behind at those columns.
  if (pad > 0) spans.push(span(' '.repeat(pad), CHASSIS_FILL_STYLE));
  fr.lines.push(spans);
  return assertRect(fr);
}

export { frameToPlainText };
export { resolveParams, renderFrame } from './art-storyboards.js';
