// compose.ts — what the terminal engine (lib/sprite-frame.js) does, written
// once more in TypeScript so the video can show the real sprite output. Keep
// the two in step: cabinet → scrolled reel windows → digits → overlay.
import { cloneGrid, window, blit, put, type Grid } from "./grid.ts";
import { WINDOWS, READOUT } from "./layout.ts";
import { cabinetGrid, CABINET_VARIANTS } from "./cabinet-grid.ts";
import { stripGrid, STRIP_H } from "./strip-grid.ts";
import { digitsGrid, DIGIT_STRIDE } from "./digits-grid.ts";
import { overlayGrid, type OverlayId } from "./overlay-grid.ts";
import { GLYPH_W, GLYPH_H } from "./font.ts";

export type MachineState = {
  /** 0..3, picks the grain variant (the engine uses floor(t / 100) mod 4). */
  variant: number;
  /** Per-reel pixel offset into the strip (any integer; wraps every STRIP_H). */
  offsets: readonly [number, number, number];
  /** Credit balance; displayed clamped to 999. */
  balance: number;
  /** Active overlay frame, or null. */
  overlay: { id: OverlayId; frame: number } | null;
};

let cachedStrip: Grid | null = null;
let cachedDigits: Grid | null = null;
const cachedCabinets = new Map<number, Grid>();

function strip(): Grid {
  if (!cachedStrip) cachedStrip = stripGrid();
  return cachedStrip;
}
function digits(): Grid {
  if (!cachedDigits) cachedDigits = digitsGrid();
  return cachedDigits;
}
function cabinet(variant: number): Grid {
  const v = ((variant % CABINET_VARIANTS) + CABINET_VARIANTS) % CABINET_VARIANTS;
  let g = cachedCabinets.get(v);
  if (!g) {
    g = cabinetGrid(v);
    cachedCabinets.set(v, g);
  }
  return g;
}

export function balanceText(balance: number): string {
  const n = Math.max(0, Math.min(999, Math.floor(balance)));
  return String(n).padStart(3, "0");
}

export function composeMachine(state: MachineState): Grid {
  const g = cloneGrid(cabinet(state.variant));
  const s = strip();
  WINDOWS.forEach((win, i) => {
    const off = ((state.offsets[i] % STRIP_H) + STRIP_H) % STRIP_H;
    blit(g, window(s, 0, off, win.w, win.h), win.x, win.y);
  });
  const d = digits();
  const text = balanceText(state.balance);
  for (let i = 0; i < 3; i++) {
    const digit = Number(text[i]);
    const x0 = READOUT.x + i * DIGIT_STRIDE;
    for (let y = 0; y < GLYPH_H; y++) {
      for (let x = 0; x < GLYPH_W; x++) {
        const c = d[y][digit * DIGIT_STRIDE + x];
        if (c >= 0) put(g, x0 + x, READOUT.y + y, c);
      }
    }
  }
  if (state.overlay) blit(g, overlayGrid(state.overlay.id, state.overlay.frame), 0, 0);
  return g;
}
