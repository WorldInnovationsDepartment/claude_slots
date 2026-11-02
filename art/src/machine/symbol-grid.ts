// symbols.ts — the six reel symbols, 10 × 8 pixel maps each.
//
// FEATURE, CLIENT and LIFE are the three win classes (LIFE is the jackpot);
// SKULL, EDDIES and CHIP are fillers. Order here is the strip order.
import { PALETTE_INDEX as P } from "../palette.ts";
import { parseMap, type Grid } from "./grid.ts";
import { WINDOW_W, SYMBOL_H } from "./layout.ts";

export const SYMBOL_IDS = ["FEATURE", "CLIENT", "LIFE", "SKULL", "EDDIES", "CHIP"] as const;
export type SymbolId = (typeof SYMBOL_IDS)[number];

const L: Readonly<Record<string, number>> = {
  ".": P.void,
  Y: P.yellow,
  y: P.yellowDark,
  p: P.yellowPale,
  C: P.cyan,
  c: P.cyanDark,
  k: P.cyanPale,
  M: P.magenta,
  m: P.magentaDark,
  n: P.magentaPale,
  W: P.white,
  G: P.grey,
  R: P.red,
  r: P.redDark,
  E: P.green,
  O: P.orange,
  S: P.steel,
  s: P.steelLight,
  I: P.ink,
};

const MAPS: Readonly<Record<SymbolId, readonly string[]>> = {
  // a cyan gem: the shiny new thing you shipped
  FEATURE: [
    "....CC....",
    "...CkkC...",
    "..CkkkkC..",
    ".CkkWWkkC.",
    ".CkkWWkkC.",
    "..cckkcc..",
    "...cccc...",
    "....cc....",
  ],
  // a magenta briefcase: somebody who pays
  CLIENT: [
    "...MMMM...",
    "...M..M...",
    "MMMMMMMMMM",
    "MnnnnnnnnM",
    "MmmmmmmmmM",
    "MmmmWWmmmM",
    "MmmmmmmmmM",
    "MMMMMMMMMM",
  ],
  // an acid-yellow heart: the jackpot
  LIFE: [
    "..YY..YY..",
    ".YppYYppY.",
    "YppYYYYYpY",
    "YYYYYYYYYY",
    ".YYYYYYYY.",
    "..yYYYYy..",
    "...yYYy...",
    "....yy....",
  ],
  // the thing Night City hands out for free
  SKULL: [
    "...WWWW...",
    "..WWWWWW..",
    ".WWWWWWWW.",
    ".WRRWWRRW.",
    ".WRRWWRRW.",
    "..WWWGWW..",
    "...GWGWG..",
    "...WWWWW..",
  ],
  // eurodollars: a coin with an E cut into it
  EDDIES: [
    "...OOOO...",
    "..OYYYYO..",
    ".OYyyyyYO.",
    ".OYyYYYYO.",
    ".OYyyyYYO.",
    ".OYyYYYYO.",
    "..OyyyyO..",
    "...OOOO...",
  ],
  // a chip: green silicon on a steel package
  CHIP: [
    ".s..ss..s.",
    "SSSSSSSSSS",
    "SEEEEEEEES",
    "SEIEEEEIES",
    "SEIEEEEIES",
    "SEEEEEEEES",
    "SSSSSSSSSS",
    ".s..ss..s.",
  ],
};

export function symbolGrid(id: SymbolId): Grid {
  const g = parseMap(MAPS[id], L);
  if (g.length !== SYMBOL_H || g[0].length !== WINDOW_W) throw new Error(`symbol ${id} is not ${WINDOW_W}×${SYMBOL_H}`);
  return g;
}

/** Pixel offset of each symbol's top edge in the strip (strip order × symbol height). */
export function symbolOffset(id: SymbolId): number {
  return SYMBOL_IDS.indexOf(id) * SYMBOL_H;
}
