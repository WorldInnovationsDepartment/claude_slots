// Claude Slots — display-width primitives (lib/width.js)
//
// Pure ESM, zero dependencies, no Node/DOM/browser APIs — this file must run
// unchanged in Node, in a browser, and inside Claude Code's hooks worker.
//
// The whole cabinet (docs/ART-SPEC.md §1, §13) is built from glyphs that are
// verified single-width (box drawing, geometric shapes, a handful of dingbat
// symbols, ASCII). This module gives every other lib/ file one place to ask
// "how many terminal columns does this string occupy", so frame.js/art.js
// never hand-count characters.
//
// The algorithm below is a compact, dependency-free wcwidth-style table: it
// is not an exhaustive Unicode database, but it correctly classifies every
// glyph this project's default theme uses (ASCII, box drawing U+2500-257F,
// block elements U+2580-259F, geometric shapes U+25A0-25FF, the dingbats
// used here including ✻ U+273B), plus the general shape of "wide" (CJK,
// fullwidth, most emoji) and "zero-width" (combining marks, joiners,
// variation selectors) codepoints for the optional emoji theme (§14) and for
// any prose/tool-output text a future integration might need to measure.

// --- zero-width ranges ------------------------------------------------------
// Combining marks, joiners, variation selectors, and other codepoints that
// attach to the previous character without occupying a column of their own.
const ZERO_WIDTH_RANGES = [
  [0x0300, 0x036f], // Combining Diacritical Marks
  [0x0483, 0x0489],
  [0x0591, 0x05bd],
  [0x05bf, 0x05bf],
  [0x05c1, 0x05c2],
  [0x05c4, 0x05c5],
  [0x05c7, 0x05c7],
  [0x0610, 0x061a],
  [0x064b, 0x065f],
  [0x0670, 0x0670],
  [0x06d6, 0x06dc],
  [0x06df, 0x06e4],
  [0x06e7, 0x06e8],
  [0x06ea, 0x06ed],
  [0x0711, 0x0711],
  [0x0730, 0x074a],
  [0x07a6, 0x07b0],
  [0x0816, 0x0819],
  [0x081b, 0x0823],
  [0x0825, 0x0827],
  [0x0829, 0x082d],
  [0x0e31, 0x0e31],
  [0x0e34, 0x0e3a],
  [0x0e47, 0x0e4e],
  [0x200b, 0x200f], // ZWSP, ZWNJ, ZWJ, LRM, RLM
  [0x202a, 0x202e], // directional formatting
  [0x2060, 0x2064], // word joiner etc.
  [0x20d0, 0x20ff], // Combining Diacritical Marks for Symbols
  [0xfe00, 0xfe0f], // variation selectors (VS1-16; VS-16 handled specially below)
  [0xfe20, 0xfe2f], // combining half marks
  [0xfeff, 0xfeff], // BOM / zero width no-break space
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0xe0100, 0xe01ef], // variation selectors supplement
];

// --- wide (2-column) ranges --------------------------------------------------
// East Asian Wide/Fullwidth blocks, plus the emoji-presentation ranges. Box
// drawing (U+2500-257F), block elements (U+2580-259F), geometric shapes
// (U+25A0-25FF) and the general dingbats range (U+2700-27BF) are all
// deliberately excluded — every glyph this cabinet uses in its default theme
// lives in one of those "narrow" ranges (verified against ART-SPEC §1/§13).
const WIDE_RANGES = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x231a, 0x231b], // watch, hourglass (emoji presentation by default)
  [0x2329, 0x232a],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x2e80, 0x303e], // CJK radicals, punctuation, Hiragana/Katakana start
  [0x3041, 0x33ff], // Hiragana..CJK compat
  [0x3400, 0x4dbf], // CJK extension A
  [0x4e00, 0x9fff], // CJK unified ideographs
  [0xa000, 0xa4cf], // Yi
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe30, 0xfe4f], // CJK compatibility forms
  [0xff00, 0xff60], // fullwidth forms
  [0xffe0, 0xffe6],
  [0x16fe0, 0x16fe4],
  [0x17000, 0x18d08], // Tangut
  [0x1b000, 0x1b2fb], // Kana supplement
  [0x1f004, 0x1f004],
  [0x1f0cf, 0x1f0cf],
  [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a],
  [0x1f200, 0x1f320],
  [0x1f32d, 0x1f335],
  [0x1f337, 0x1f37c],
  [0x1f37e, 0x1f393],
  [0x1f3a0, 0x1f3ca],
  [0x1f3cf, 0x1f3d3],
  [0x1f3e0, 0x1f3f0],
  [0x1f3f4, 0x1f3f4],
  [0x1f3f8, 0x1f43e],
  [0x1f440, 0x1f440],
  [0x1f442, 0x1f4fc],
  [0x1f4ff, 0x1f53d],
  [0x1f54b, 0x1f54e],
  [0x1f550, 0x1f567],
  [0x1f57a, 0x1f57a],
  [0x1f595, 0x1f596],
  [0x1f5a4, 0x1f5a4],
  [0x1f5fb, 0x1f64f], // ... incl. emoticons block
  [0x1f680, 0x1f6c5],
  [0x1f6cc, 0x1f6cc],
  [0x1f6d0, 0x1f6d2],
  [0x1f6d5, 0x1f6d7],
  [0x1f6dc, 0x1f6df],
  [0x1f6eb, 0x1f6ec],
  [0x1f6f4, 0x1f6fc],
  [0x1f7e0, 0x1f7eb],
  [0x1f7f0, 0x1f7f0],
  [0x1f900, 0x1f9ff], // supplemental symbols and pictographs
  [0x1fa70, 0x1faff],
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
];

function inRanges(cp, ranges) {
  // Binary search over sorted, non-overlapping ranges.
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [start, end] = ranges[mid];
    if (cp < start) hi = mid - 1;
    else if (cp > end) lo = mid + 1;
    else return true;
  }
  return false;
}

const VS16 = 0xfe0f; // forces emoji (wide) presentation on the preceding codepoint
const VS15 = 0xfe0e; // forces text (narrow) presentation

/**
 * Split a string into an array of "grapheme-ish" units for width purposes:
 * a base codepoint plus any immediately-following combining marks / a single
 * trailing variation selector are kept together as one unit. Good enough for
 * this project's glyph set without pulling in Intl.Segmenter (unavailable in
 * some hook-worker runtimes) or a full grapheme-break table.
 * @param {string} str
 * @returns {string[]}
 */
export function graphemeUnits(str) {
  const units = [];
  const chars = Array.from(str); // splits on UTF-16 surrogate pairs correctly
  let i = 0;
  while (i < chars.length) {
    let unit = chars[i];
    let cp = unit.codePointAt(0);
    i += 1;
    // absorb a following variation selector into this unit
    if (i < chars.length) {
      const nextCp = chars[i].codePointAt(0);
      if (nextCp === VS16 || nextCp === VS15) {
        unit += chars[i];
        i += 1;
      }
    }
    // absorb any run of zero-width combining marks that follow
    while (i < chars.length && inRanges(chars[i].codePointAt(0), ZERO_WIDTH_RANGES) && chars[i].codePointAt(0) !== VS16 && chars[i].codePointAt(0) !== VS15) {
      unit += chars[i];
      i += 1;
    }
    units.push(unit);
  }
  return units;
}

/**
 * Display width, in terminal columns, of a single grapheme unit (as produced
 * by graphemeUnits) — i.e. at most one base codepoint plus trailing
 * combining marks / one variation selector.
 * @param {string} unit
 * @returns {0|1|2}
 */
export function unitWidth(unit) {
  const first = unit.codePointAt(0);
  // an explicit trailing variation selector overrides default presentation
  if (unit.length > String.fromCodePoint(first).length) {
    const rest = unit.slice(String.fromCodePoint(first).length);
    const vs = rest.codePointAt(0);
    if (vs === VS16) return 2;
    if (vs === VS15) return 1;
  }
  if (inRanges(first, ZERO_WIDTH_RANGES)) return 0;
  if (first === 0) return 0;
  // C0/C1 controls (excluding tab/newline, which callers should not be
  // measuring anyway) contribute no visible column.
  if ((first >= 0 && first < 0x20) || (first >= 0x7f && first < 0xa0)) return 0;
  if (inRanges(first, WIDE_RANGES)) return 2;
  return 1;
}

/**
 * Total display width, in terminal columns, of a string.
 * @param {string} str
 * @returns {number}
 */
export function displayWidth(str) {
  if (str === '' || str == null) return 0;
  let width = 0;
  for (const unit of graphemeUnits(String(str))) width += unitWidth(unit);
  return width;
}

/**
 * Pad `str` on the right with `ch` (a single-width fill character, default
 * space) until it reaches `width` display columns. No-op (returns `str`
 * unchanged) if `str` is already at or over budget — callers that need a
 * hard cap should truncate first.
 * @param {string} str
 * @param {number} width
 * @param {string} [ch]
 */
export function padEnd(str, width, ch = ' ') {
  if (unitWidth(ch) !== 1) throw new Error(`padEnd: fill char must be single-width, got ${JSON.stringify(ch)}`);
  const w = displayWidth(str);
  if (w >= width) return str;
  return str + ch.repeat(width - w);
}

/**
 * Pad `str` on the left with `ch` until it reaches `width` display columns.
 * @param {string} str
 * @param {number} width
 * @param {string} [ch]
 */
export function padStart(str, width, ch = ' ') {
  if (unitWidth(ch) !== 1) throw new Error(`padStart: fill char must be single-width, got ${JSON.stringify(ch)}`);
  const w = displayWidth(str);
  if (w >= width) return str;
  return ch.repeat(width - w) + str;
}

/**
 * Truncate `str` to at most `width` display columns, appending `ellipsis`
 * (counted against the same budget) when truncation actually happens.
 * Never splits a wide glyph in half — a unit that would only partially fit
 * is dropped rather than corrupting the column count.
 * @param {string} str
 * @param {number} width
 * @param {string} [ellipsis]
 */
export function truncate(str, width, ellipsis = '') {
  if (displayWidth(str) <= width) return str;
  const ellW = displayWidth(ellipsis);
  const budget = Math.max(0, width - ellW);
  let out = '';
  let w = 0;
  for (const unit of graphemeUnits(String(str))) {
    const uw = unitWidth(unit);
    if (w + uw > budget) break;
    out += unit;
    w += uw;
  }
  return out + ellipsis;
}
