// Claude Slots — sprite compositor (lib/sprite-frame.js)
//
// Pure ESM, zero dependencies. Turns the sprite sheet (lib/sprites.js, the
// module twin of lib/sprites.json, both built from the Remotion composition
// by scripts/dev/build-sprites.js) plus a
// machine state into a Frame (lib/frame.js) of half-block cells:
//
//   pixel rows 2k and 2k+1  ->  one cell row k of `▀` spans, where
//   color = the top pixel's palette colour, bg = the bottom pixel's.
//
// Every cell always carries BOTH colours, so the terminal paints every cell
// of the 40 × 10 rectangle and no stale transcript text can show through.
// Runs of identical (top, bottom) pairs coalesce into one span.
//
// The compose order mirrors art/src/machine/compose.ts exactly: cabinet
// variant → scrolled reel windows → balance digits → overlay frame.

import sheet from './sprites.js';
import { makeFrame, span } from './frame.js';

export const SHEET = sheet;
export const SPRITE_W = sheet.w;
export const SPRITE_H = sheet.h;
export const SPRITE_ROWS = sheet.h / 2;
export const CABINET_VARIANTS = sheet.cabinet.frames.length;
export const STRIP_H = sheet.strip.h;
export const SYMBOL_H = sheet.strip.symbolH;
export const HALF_BLOCK = '▀';

/** Overlay id -> frame count, for timing the outcome phase. */
export const OVERLAY_FRAME_COUNTS = Object.freeze(Object.fromEntries(Object.entries(sheet.overlays).map(([id, frames]) => [id, frames.length])));

const TRANSPARENT = -1;

function charToIndex(ch) {
  return ch === '-' ? TRANSPARENT : parseInt(ch, 36);
}

/** Decode a row-major pixel string into rows of palette indices. */
function decode(pixels, w) {
  const rows = [];
  for (let i = 0; i < pixels.length; i += w) {
    const row = new Array(w);
    for (let x = 0; x < w; x++) row[x] = charToIndex(pixels[i + x]);
    rows.push(row);
  }
  return rows;
}

// Decoded once per process; the sheet is immutable.
const CABINETS = sheet.cabinet.frames.map((f) => decode(f, sheet.w));
const STRIP = decode(sheet.strip.pixels, sheet.strip.w);
const DIGITS = sheet.digits.glyphs.map((g) => decode(g, sheet.digits.w));
const OVERLAYS = Object.fromEntries(Object.entries(sheet.overlays).map(([id, frames]) => [id, frames.map((f) => decode(f, sheet.w))]));

/** The strip's declared pixel offset for a symbol id (the window top that centres it). */
export function symbolOffset(symbolId) {
  const off = sheet.strip.offsets[symbolId];
  if (off === undefined) throw new Error(`symbolOffset: unknown symbol ${JSON.stringify(symbolId)}`);
  return off;
}

/** Three digits, clamped to 999, zero-padded (what the readout shows). */
export function balanceText(balance) {
  const n = Math.max(0, Math.min(999, Math.floor(Number(balance) || 0)));
  return String(n).padStart(3, '0');
}

/**
 * @typedef {{
 *   variant: number,
 *   offsets: [number, number, number],
 *   balance: number,
 *   overlay: {id: string, frame: number} | null,
 * }} SpriteState
 */

/**
 * Compose the 20 × 40 pixel grid for `state`.
 * @param {SpriteState} state
 * @returns {number[][]} rows of palette indices
 */
export function composeGrid(state) {
  const nV = CABINETS.length;
  const variant = (((state.variant | 0) % nV) + nV) % nV;
  const grid = CABINETS[variant].map((row) => row.slice());

  sheet.cabinet.windows.forEach((win, i) => {
    const raw = state.offsets ? state.offsets[i] : 0;
    const off = (((Math.round(raw) % STRIP_H) + STRIP_H) % STRIP_H);
    for (let y = 0; y < win.h; y++) {
      const src = STRIP[(off + y) % STRIP_H];
      const dst = grid[win.y + y];
      for (let x = 0; x < win.w; x++) dst[win.x + x] = src[x];
    }
  });

  const text = balanceText(state.balance);
  const { x: rx, y: ry } = sheet.cabinet.readout;
  for (let i = 0; i < 3; i++) {
    const glyph = DIGITS[Number(text[i])];
    const x0 = rx + i * sheet.digits.stride;
    for (let y = 0; y < sheet.digits.h; y++) {
      for (let x = 0; x < sheet.digits.w; x++) {
        const c = glyph[y][x];
        if (c !== TRANSPARENT) grid[ry + y][x0 + x] = c;
      }
    }
  }

  if (state.overlay) {
    const frames = OVERLAYS[state.overlay.id];
    if (frames) {
      const n = frames.length;
      const ov = frames[(((state.overlay.frame | 0) % n) + n) % n];
      for (let y = 0; y < sheet.h; y++) {
        for (let x = 0; x < sheet.w; x++) {
          const c = ov[y][x];
          if (c !== TRANSPARENT) grid[y][x] = c;
        }
      }
    }
  }
  return grid;
}

/**
 * Pack a pixel grid into a Frame of half-block cells. A transparent pixel
 * (never produced by composeGrid, but allowed by the sheet's overlays) falls
 * back to palette entry 0 so every cell still carries two colours.
 * @param {number[][]} grid
 * @returns {import('./frame.js').Frame}
 */
export function gridToFrame(grid) {
  const h = grid.length;
  const w = h ? grid[0].length : 0;
  const frame = makeFrame(w);
  const colourOf = (idx) => sheet.palette[idx === TRANSPARENT ? 0 : idx];
  for (let y = 0; y + 1 < h; y += 2) {
    const top = grid[y];
    const bottom = grid[y + 1];
    const spans = [];
    let run = 0;
    let curTop = null;
    let curBottom = null;
    for (let x = 0; x < w; x++) {
      const t = colourOf(top[x]);
      const b = colourOf(bottom[x]);
      if (run > 0 && t === curTop && b === curBottom) {
        run++;
        continue;
      }
      if (run > 0) spans.push(span(HALF_BLOCK.repeat(run), { color: curTop, bg: curBottom }));
      curTop = t;
      curBottom = b;
      run = 1;
    }
    if (run > 0) spans.push(span(HALF_BLOCK.repeat(run), { color: curTop, bg: curBottom }));
    frame.lines.push(spans);
  }
  return frame;
}

/**
 * The whole machine as a Frame: 10 rows of 40 painted cells.
 * @param {SpriteState} state
 */
export function spriteFrame(state) {
  return gridToFrame(composeGrid(state));
}
