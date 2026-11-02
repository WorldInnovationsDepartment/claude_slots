// reelStrip.ts — one vertical strip holding every symbol once, 10 × 48.
// Reels scroll this strip through their windows; rows wrap, so offset 48
// shows exactly what offset 0 shows (seam-free by construction).
import { blit, makeGrid, type Grid } from "./grid.ts";
import { WINDOW_W, SYMBOL_H } from "./layout.ts";
import { SYMBOL_IDS, symbolGrid, symbolOffset } from "./symbol-grid.ts";

export const STRIP_W = WINDOW_W;
export const STRIP_H = SYMBOL_IDS.length * SYMBOL_H;

export function stripGrid(): Grid {
  const g = makeGrid(STRIP_W, STRIP_H);
  for (const id of SYMBOL_IDS) blit(g, symbolGrid(id), 0, symbolOffset(id));
  return g;
}
