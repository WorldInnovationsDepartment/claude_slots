// overlays.ts — the outcome sequences stamped over the cabinet at 10 fps.
// Transparent everywhere they do not paint, so the reels stay visible.
import { PALETTE_INDEX as P } from "../palette.ts";
import { makeGrid, rect, frame, put, blit, hash01, type Grid } from "./grid.ts";
import { W, H, WINDOWS, READOUT_BOX } from "./layout.ts";
import { textGrid, textWidth } from "./font.ts";

export const OVERLAY_IDS = ["win-feature", "win-client", "win-life", "lose", "abort", "error"] as const;
export type OverlayId = (typeof OVERLAY_IDS)[number];

export const OVERLAY_FRAMES: Readonly<Record<OverlayId, number>> = {
  "win-feature": 15,
  "win-client": 15,
  "win-life": 20,
  lose: 10,
  abort: 12,
  error: 12,
};

/** A label band over the readout rows (the balance comes back when the overlay ends). */
function band(g: Grid, text: string, colour: number, bg: number): void {
  rect(g, 1, READOUT_BOX.y, W - 2, READOUT_BOX.h, bg);
  const t = textGrid(text, colour);
  blit(g, t, Math.floor((W - textWidth(text)) / 2), READOUT_BOX.y + 1);
}

function borderFlash(g: Grid, colour: number): void {
  frame(g, 0, 0, W, H, colour);
  for (const win of WINDOWS) frame(g, win.x - 1, win.y - 1, win.w + 2, win.h + 2, colour);
}

function sparkles(g: Grid, frameIdx: number, colour: number, density: number): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (hash01(frameIdx, x, y, 7) < density) put(g, x, y, colour);
    }
  }
}

function glitchBars(g: Grid, frameIdx: number): void {
  for (let y = 0; y < H; y++) {
    const r = hash01(frameIdx, y, 11);
    if (r < 0.18) {
      const shift = Math.floor(hash01(frameIdx, y, 13) * 6) - 3;
      const colour = r < 0.09 ? P.cyan : P.magenta;
      const x0 = Math.max(0, shift);
      const x1 = Math.min(W, W + shift);
      rect(g, x0, y, Math.max(0, x1 - x0), 1, colour);
      // a dark tear next to the bar
      rect(g, x0, y, 2, 1, P.ink);
    }
  }
}

export function overlayGrid(id: OverlayId, frameIdx: number): Grid {
  const g = makeGrid(W, H);
  const n = OVERLAY_FRAMES[id];
  const f = ((frameIdx % n) + n) % n;
  const blinkOn = f % 6 < 4;
  switch (id) {
    case "win-feature": {
      if (f % 2 === 0) borderFlash(g, P.cyan);
      if (blinkOn) band(g, "FEATURE", P.cyan, P.ink);
      return g;
    }
    case "win-client": {
      if (f % 2 === 0) borderFlash(g, P.magenta);
      if (blinkOn) band(g, "CLIENT", P.magenta, P.ink);
      return g;
    }
    case "win-life": {
      borderFlash(g, f % 2 === 0 ? P.yellow : P.yellowPale);
      sparkles(g, f, P.yellowPale, 0.05);
      if (blinkOn) band(g, "A LIFE", P.yellow, P.ink);
      return g;
    }
    case "lose": {
      if (f < 8) band(g, "NO MATCH", P.grey, P.ink);
      return g;
    }
    case "abort": {
      glitchBars(g, f);
      if (f % 4 < 2) band(g, "JAMMED", f % 8 < 4 ? P.cyan : P.magenta, P.ink);
      return g;
    }
    case "error": {
      if (f % 2 === 0) borderFlash(g, P.red);
      sparkles(g, f, P.redDark, 0.03);
      if (blinkOn) band(g, "ERROR", P.red, P.ink);
      return g;
    }
  }
}
