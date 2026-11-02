// digits.ts — the ten readout glyphs as one 40 × 5 sheet (stride 4 px).
import { PALETTE_INDEX as P } from "../palette.ts";
import { blit, makeGrid, type Grid } from "./grid.ts";
import { glyph, GLYPH_W, GLYPH_H, GLYPH_GAP } from "./font.ts";

export const DIGIT_STRIDE = GLYPH_W + GLYPH_GAP;
export const DIGITS_W = DIGIT_STRIDE * 10;
export const DIGITS_H = GLYPH_H;
export const DIGIT_COLOUR = P.yellow;

export function digitsGrid(): Grid {
  const g = makeGrid(DIGITS_W, DIGITS_H);
  for (let d = 0; d < 10; d++) blit(g, glyph(String(d), DIGIT_COLOUR), d * DIGIT_STRIDE, 0);
  return g;
}
