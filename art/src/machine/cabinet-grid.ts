// cabinet.ts — the static body: frame, marquee stripe, three window bezels,
// the readout bezel and two neon tubes. Four grain variants (seeded, never
// random) give the season-2 film-grain flicker; odd rows are scanlines.
import { PALETTE_INDEX as P } from "../palette.ts";
import { makeGrid, rect, frame, put, hash01, TRANSPARENT, type Grid } from "./grid.ts";
import { W, H, WINDOWS, READOUT_BOX } from "./layout.ts";

export const CABINET_VARIANTS = 4;

/** Probability a body pixel becomes a grain speck in a given variant. */
const GRAIN_P = 0.09;
const GRAIN_LIGHT_P = 0.025;

/** The marquee stripe on row 1: yellow with a travelling dark gap per variant. */
function marquee(g: Grid, variant: number): void {
  for (let x = 1; x < W - 1; x++) {
    const lit = (x + variant) % 4 !== 0;
    put(g, x, 1, lit ? P.yellow : P.yellowDark);
  }
}

export function cabinetGrid(variant: number): Grid {
  const g = makeGrid(W, H, P.body);

  // scanlines: every odd row of body is a shade darker (season 2 texture)
  for (let y = 0; y < H; y++) if (y % 2 === 1) rect(g, 0, y, W, 1, P.bodyScan);

  // grain: deterministic per (variant, x, y) so two runs are byte-identical
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const r = hash01(variant, x, y);
      if (r < GRAIN_LIGHT_P) put(g, x, y, P.bodyLight);
      else if (r < GRAIN_LIGHT_P + GRAIN_P) put(g, x, y, P.bodyGrain);
    }
  }

  // outer frame + highlight edge
  frame(g, 0, 0, W, H, P.steel);
  rect(g, 1, 0, W - 2, 1, P.steelLight);
  put(g, 0, 0, P.steelLight);
  put(g, W - 1, 0, P.steelLight);

  marquee(g, variant);

  // reel bezels: one steel rectangle hugging each window, windows transparent
  for (const win of WINDOWS) {
    frame(g, win.x - 1, win.y - 1, win.w + 2, win.h + 2, P.steel);
    rect(g, win.x, win.y - 1, win.w, 1, P.steelLight);
    rect(g, win.x, win.y, win.w, win.h, TRANSPARENT);
  }

  // readout bezel with a void interior for the digits
  frame(g, READOUT_BOX.x, READOUT_BOX.y, READOUT_BOX.w, READOUT_BOX.h, P.steel);
  rect(g, READOUT_BOX.x + 1, READOUT_BOX.y + 1, READOUT_BOX.w - 2, READOUT_BOX.h - 2, P.void);

  // neon tubes flanking the readout: cyan left, magenta right
  rect(g, 5, 13, 1, 5, P.cyanDark);
  rect(g, 6, 13, 1, 5, P.cyan);
  rect(g, 7, 13, 1, 5, P.cyanDark);
  rect(g, 32, 13, 1, 5, P.magentaDark);
  rect(g, 33, 13, 1, 5, P.magenta);
  rect(g, 34, 13, 1, 5, P.magentaDark);

  // trigger: a tiny yellow stud on the right edge (the "pull")
  put(g, W - 2, 15, P.yellow);
  put(g, W - 2, 16, P.yellowDark);

  return g;
}
