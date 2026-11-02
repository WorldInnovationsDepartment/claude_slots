// symbol-grid.ts — the eight reel symbols, 10 × 8 pixel maps each.
//
// FEATURE, CLIENT and LIFE are the three win classes (LIFE is the jackpot),
// drawn as street-market goods: an optic implant, a banknote, a casino token.
// PILLS, GUN, AGENT, DECK and BLADE are fillers. Order here is the strip order.
import { PALETTE_INDEX as P } from "../palette.ts";
import { parseMap, type Grid } from "./grid.ts";
import { WINDOW_W, SYMBOL_H } from "./layout.ts";

export const SYMBOL_IDS = ["FEATURE", "CLIENT", "LIFE", "PILLS", "GUN", "AGENT", "DECK", "BLADE"] as const;
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
  // an optic implant, cyan iris in a steel socket: the new chrome you shipped
  FEATURE: [
    "..........",
    "...SSSS...",
    ".SSCCCCSS.",
    "SCCCkICCCS",
    "SCCCIICCCS",
    ".SSCCCCSS.",
    "...SSSS...",
    "..........",
  ],
  // a green banknote with an E watermark: somebody who pays
  CLIENT: [
    "..........",
    "EEEEEEEEEE",
    "EIEYYYYEIE",
    "EEEYEEEEEE",
    "EEEYYYEEEE",
    "EEEYEEEEEE",
    "EIEYYYYEIE",
    "EEEEEEEEEE",
  ],
  // a casino token, cyan notches: the chip you finally cash out
  LIFE: [
    "...WWWW...",
    "..WCWWCW..",
    ".WWWWWWWW.",
    ".CWWkkWWC.",
    ".CWWkkWWC.",
    ".WWWWWWWW.",
    "..WCWWCW..",
    "...WWWW...",
  ],
  // a two-tone capsule and a loose tablet
  PILLS: [
    "..........",
    ".MMMMCCCC.",
    "MnMMMMkCCc",
    "MMMMMMCCCc",
    ".mmmmcccc.",
    ".......YYY",
    "......YpYy",
    ".......yyy",
  ],
  // a compact pistol, magenta grip panel
  GUN: [
    "..........",
    ".sSSSSSSSS",
    ".SsssssssS",
    ".SSSSSSSs.",
    "..SSSS....",
    "..SMMS....",
    "..SMMS....",
    "..SSS.....",
  ],
  // a fixer: dark hair, cyan visor, magenta tie
  AGENT: [
    "...IIII...",
    "..IIIIII..",
    ".IGGGGGGI.",
    ".IGCCCCGI.",
    ".IGGGGGGI.",
    "..IGGGGI..",
    "..SSSSSS..",
    ".SSSMMSSS.",
  ],
  // a cyberdeck: magenta screen over a key row
  DECK: [
    ".SSSSSSSS.",
    ".SMMMMMMS.",
    ".SMnMMMMS.",
    ".SMMMMMMS.",
    "SSSSSSSSSS",
    "SsIsIsIsIS",
    "SIsIsIsIsS",
    "SSSSSSSSSS",
  ],
  // a drawn blade, red at the tip
  BLADE: [
    "........RR",
    ".......RWs",
    "......WWs.",
    ".....WWs..",
    "....WWs...",
    "...WWs....",
    "..SSS.....",
    ".SSS......",
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
