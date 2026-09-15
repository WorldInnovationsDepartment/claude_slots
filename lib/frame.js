// Claude Slots — the Frame model (lib/frame.js)
//
// Pure ESM, zero dependencies, no Node/DOM/browser APIs (see lib/width.js).
//
// Frame is the contract between the engine (machine.js/art.js) and the two
// renderers (render-ansi.js, render-tree.js) — docs/ARCHITECTURE.md §2:
//
//   Frame = { width: number, lines: Span[][] }
//   Span  = { text: string, color?: '#rrggbb', bold?: boolean, dim?: boolean,
//             inverse?: boolean, bg?: '#rrggbb' }
//
// Every line in a Frame must sum to exactly `frame.width` display columns
// (assertRect below enforces this). Builders in art.js compose each line
// from fixed-width primitives via `compose`/`canvas`/`place`, mirroring the
// approach docs/ART-SPEC.md's own generator (frames_lib.py/gen.py) uses to
// guarantee every golden frame is a true rectangle before it ships.

import { displayWidth, unitWidth, graphemeUnits } from './width.js';

/**
 * @typedef {{text: string, color?: string, bg?: string, bold?: boolean, dim?: boolean, inverse?: boolean}} Span
 * @typedef {{width: number, lines: Span[][]}} Frame
 */

/**
 * Create an empty Frame shell of a fixed display width.
 * @param {number} width
 * @returns {Frame}
 */
export function makeFrame(width) {
  if (!Number.isInteger(width) || width <= 0) {
    throw new Error(`makeFrame: width must be a positive integer, got ${JSON.stringify(width)}`);
  }
  return { width, lines: [] };
}

/**
 * Build a Span. Only style keys that are actually set are copied onto the
 * result, so spans serialize compactly and render-tree.js's "omit undefined
 * props" rule is trivial to satisfy downstream.
 * @param {string} text
 * @param {{color?:string, bg?:string, bold?:boolean, dim?:boolean, inverse?:boolean}} [style]
 * @returns {Span}
 */
export function span(text, style = {}) {
  if (typeof text !== 'string') throw new Error(`span: text must be a string, got ${JSON.stringify(text)}`);
  if (text.includes('\n')) throw new Error('span: text must not contain newlines');
  const s = { text };
  if (style.color) s.color = style.color;
  if (style.bg) s.bg = style.bg;
  if (style.bold) s.bold = true;
  if (style.dim) s.dim = true;
  if (style.inverse) s.inverse = true;
  return s;
}

/** Display width of a single span's text. */
export function spanWidth(s) {
  return displayWidth(s.text);
}

/** Display width of a whole line (array of spans). */
export function lineWidth(lineSpans) {
  return lineSpans.reduce((w, s) => w + spanWidth(s), 0);
}

/**
 * Build one Frame line out of spans. Flattens nested arrays (so callers can
 * splice in a sub-row built elsewhere) and drops falsy entries, so optional
 * spans can be expressed as `cond && span(...)`.
 * @param {...(Span|Span[]|false|null|undefined)} spans
 * @returns {Span[]}
 */
export function line(...spans) {
  return spans.flat(Infinity).filter(Boolean);
}

/**
 * A line made of a single repeated single-width fill character — the common
 * case for chassis borders/separators (`═`.repeat(interiorWidth) etc).
 * @param {number} width
 * @param {string} [ch]
 * @param {object} [style]
 */
export function hline(width, ch = '─', style = {}) {
  if (unitWidth(ch) !== 1) throw new Error(`hline: fill char must be single-width, got ${JSON.stringify(ch)}`);
  return line(span(ch.repeat(width), style));
}

// ---------------------------------------------------------------------------
// compose: a small column-addressable canvas for building a line out of
// independently-styled pieces placed at fixed columns (reel cells, the lever
// track, left/right-justified info-strip text, …) — the "place text at
// column" primitive ARCHITECTURE.md §2 calls for.
// ---------------------------------------------------------------------------

/**
 * @typedef {{ch: string, style: object, _cont?: boolean}} Cell
 */

/**
 * A blank canvas of `width` single-width cells, each initialized to `fillCh`.
 * @param {number} width
 * @param {string} [fillCh]
 * @param {object} [fillStyle]
 * @returns {Cell[]}
 */
export function canvas(width, fillCh = ' ', fillStyle = {}) {
  if (!Number.isInteger(width) || width < 0) throw new Error(`canvas: width must be a non-negative integer, got ${JSON.stringify(width)}`);
  if (unitWidth(fillCh) !== 1) throw new Error(`canvas: fill char must be single-width, got ${JSON.stringify(fillCh)}`);
  const cells = new Array(width);
  for (let i = 0; i < width; i++) cells[i] = { ch: fillCh, style: fillStyle };
  return cells;
}

/**
 * Return a NEW canvas (does not mutate `cv`) with `text` written starting at
 * display column `col`, styled with `style`. A zero-width unit (a combining
 * mark) merges into the previous cell's text rather than occupying its own
 * column. Throws if `text` would run past either edge of the canvas.
 * @param {Cell[]} cv
 * @param {number} col
 * @param {string} text
 * @param {object} [style]
 * @returns {Cell[]}
 */
export function place(cv, col, text, style = {}) {
  const out = cv.slice();
  let i = col;
  for (const unit of graphemeUnits(text)) {
    const w = unitWidth(unit);
    if (w === 0) {
      const prev = i - 1;
      if (prev >= 0 && prev < out.length) {
        out[prev] = { ch: out[prev].ch + unit, style: out[prev].style };
      }
      continue;
    }
    if (i < 0 || i + w > out.length) {
      throw new Error(`place: ${JSON.stringify(text)} at col ${col} overflows canvas width ${out.length}`);
    }
    out[i] = { ch: unit, style };
    for (let k = 1; k < w; k++) out[i + k] = { ch: '', style, _cont: true };
    i += w;
  }
  return out;
}

function stylesEqual(a, b) {
  return (
    (a.color || null) === (b.color || null) &&
    (a.bg || null) === (b.bg || null) &&
    !!a.bold === !!b.bold &&
    !!a.dim === !!b.dim &&
    !!a.inverse === !!b.inverse
  );
}

/** Collapse a canvas into a Frame line, merging adjacent same-style cells into one span. */
export function canvasToLine(cv) {
  const spans = [];
  let cur = null;
  for (const cell of cv) {
    if (cell._cont) continue; // second+ column of a wide glyph carries no span of its own
    if (cur && stylesEqual(cur.style, cell.style)) {
      cur.text += cell.ch;
    } else {
      if (cur) spans.push(span(cur.text, cur.style));
      cur = { text: cell.ch, style: cell.style };
    }
  }
  if (cur) spans.push(span(cur.text, cur.style));
  return spans;
}

/**
 * Build one Frame line of `width` columns by laying `placements` onto a
 * blank canvas in order (later placements may overwrite earlier ones).
 * @param {number} width
 * @param {{col:number, text:string, style?:object}[]} placements
 * @param {{fillCh?:string, fillStyle?:object}} [opts]
 * @returns {Span[]}
 */
export function compose(width, placements, opts = {}) {
  const { fillCh = ' ', fillStyle = {} } = opts;
  let cv = canvas(width, fillCh, fillStyle);
  for (const p of placements) cv = place(cv, p.col, p.text, p.style || {});
  return canvasToLine(cv);
}

/**
 * Assert every line in `frame` sums to exactly `frame.width` display
 * columns. Throws an Error listing every offending line (index, actual vs
 * expected width, and its plain text) so a mismatch is easy to diff against
 * an ART-SPEC golden frame.
 * @param {Frame} frame
 * @returns {Frame} the same frame, for chaining
 */
export function assertRect(frame) {
  const diffs = [];
  frame.lines.forEach((l, i) => {
    const w = lineWidth(l);
    if (w !== frame.width) {
      diffs.push({ index: i, width: w, expected: frame.width, text: l.map((s) => s.text).join('') });
    }
  });
  if (diffs.length) {
    const msg = diffs
      .map((d) => `  line ${d.index}: width ${d.width} !== ${d.expected} -- ${JSON.stringify(d.text)}`)
      .join('\n');
    throw new Error(`assertRect: frame is not rectangular (expected width ${frame.width}):\n${msg}`);
  }
  return frame;
}

/** Render a Frame to plain text (styling stripped), lines joined with '\n'. */
export function frameToPlainText(frame) {
  return frame.lines.map((l) => l.map((s) => s.text).join('')).join('\n');
}
