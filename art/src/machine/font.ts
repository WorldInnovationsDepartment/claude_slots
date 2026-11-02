// font.ts — a 3×5 pixel font for the balance readout and overlay labels.
import { makeGrid, put, type Grid, TRANSPARENT } from "./grid.ts";

export const GLYPH_W = 3;
export const GLYPH_H = 5;
export const GLYPH_GAP = 1;

const RAW: Readonly<Record<string, readonly string[]>> = {
  "0": ["###", "#.#", "#.#", "#.#", "###"],
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["###", "..#", "###", "#..", "###"],
  "3": ["###", "..#", "###", "..#", "###"],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "###", "..#", "###"],
  "6": ["###", "#..", "###", "#.#", "###"],
  "7": ["###", "..#", "..#", "..#", "..#"],
  "8": ["###", "#.#", "###", "#.#", "###"],
  "9": ["###", "#.#", "###", "..#", "###"],
  A: [".#.", "#.#", "###", "#.#", "#.#"],
  B: ["##.", "#.#", "##.", "#.#", "##."],
  C: ["###", "#..", "#..", "#..", "###"],
  D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"],
  F: ["###", "#..", "##.", "#..", "#.."],
  G: ["###", "#..", "#.#", "#.#", "###"],
  H: ["#.#", "#.#", "###", "#.#", "#.#"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  J: ["..#", "..#", "..#", "#.#", "###"],
  K: ["#.#", "#.#", "##.", "#.#", "#.#"],
  L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#.#", "###", "###", "#.#", "#.#"],
  N: ["##.", "#.#", "#.#", "#.#", "#.#"],
  O: ["###", "#.#", "#.#", "#.#", "###"],
  P: ["###", "#.#", "###", "#..", "#.."],
  Q: ["###", "#.#", "#.#", "###", "..#"],
  R: ["###", "#.#", "##.", "#.#", "#.#"],
  S: ["###", "#..", "###", "..#", "###"],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", "###"],
  V: ["#.#", "#.#", "#.#", "#.#", ".#."],
  W: ["#.#", "#.#", "###", "###", "#.#"],
  X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  Z: ["###", "..#", ".#.", "#..", "###"],
  " ": ["...", "...", "...", "...", "..."],
  "-": ["...", "...", "###", "...", "..."],
  "+": ["...", ".#.", "###", ".#.", "..."],
  "!": [".#.", ".#.", ".#.", "...", ".#."],
  ".": ["...", "...", "...", "...", ".#."],
  "?": ["###", "..#", ".##", "...", ".#."],
};

export const FONT_CHARS = Object.keys(RAW);

/** One glyph as a 3×5 Grid painted in `colour` (transparent elsewhere). */
export function glyph(ch: string, colour: number): Grid {
  const rows = RAW[ch.toUpperCase()] ?? RAW["?"];
  const g = makeGrid(GLYPH_W, GLYPH_H);
  rows.forEach((r, y) => {
    for (let x = 0; x < GLYPH_W; x++) if (r[x] === "#") put(g, x, y, colour);
  });
  return g;
}

/** Width in pixels of `text` set in this font (glyphs plus 1 px gaps). */
export function textWidth(text: string): number {
  if (!text.length) return 0;
  return text.length * GLYPH_W + (text.length - 1) * GLYPH_GAP;
}

/** `text` as one Grid, transparent background. */
export function textGrid(text: string, colour: number): Grid {
  const g = makeGrid(textWidth(text), GLYPH_H);
  let x = 0;
  for (const ch of text) {
    const gl = glyph(ch, colour);
    for (let y = 0; y < GLYPH_H; y++) for (let xx = 0; xx < GLYPH_W; xx++) if (gl[y][xx] !== TRANSPARENT) g[y][x + xx] = gl[y][xx];
    x += GLYPH_W + GLYPH_GAP;
  }
  return g;
}
