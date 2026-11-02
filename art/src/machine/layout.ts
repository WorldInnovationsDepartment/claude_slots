// layout.ts — the machine's fixed geometry on the 40 × 20 unit grid.
// docs/ART-SPEC.md mirrors these numbers; lib/sprites.json carries them so
// the terminal engine never has to import from art/.

export const W = 40;
export const H = 20;

export type Rect = { x: number; y: number; w: number; h: number };

/** Three reel windows, each the width of the strip and one symbol tall. */
export const WINDOW_W = 10;
export const WINDOW_H = 8;
export const WINDOWS: readonly Rect[] = [
  { x: 3, y: 3, w: WINDOW_W, h: WINDOW_H },
  { x: 15, y: 3, w: WINDOW_W, h: WINDOW_H },
  { x: 27, y: 3, w: WINDOW_W, h: WINDOW_H },
];

/** Each strip symbol is exactly one window tall, so a window shows one centred symbol at its declared offset. */
export const SYMBOL_H = WINDOW_H;

/** Where the three balance digits start (3 px glyphs with 1 px gaps → 11 px wide). */
export const READOUT = { x: 15, y: 13 };
export const READOUT_BOX: Rect = { x: 13, y: 12, w: 14, h: 7 };
