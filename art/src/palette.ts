// palette.ts — the ONLY colours any machine pixel may use (docs/ART-SPEC.md).
//
// Pure data, no imports: scripts/dev/build-sprites.js loads this file through
// Node's type stripping to quantise rendered PNGs to these exact indices, and
// theme.ts folds it into the project theme. Keep it at 24 entries or fewer;
// tests/sprites.test.js enforces the cap and membership.
//
// Neon brief: base (near-black, acid yellow, cyan, magenta)
// with season 2 texture handled by the scanline/grain variants of the body.

export type PaletteEntry = { readonly name: string; readonly hex: string };

export const PALETTE: readonly PaletteEntry[] = [
  { name: "ink", hex: "#07070B" }, // 0  near-black background
  { name: "void", hex: "#0E0E16" }, // 1  reel window background
  { name: "voidScan", hex: "#09090F" }, // 2  reel window scanline row
  { name: "body", hex: "#1C1B2A" }, // 3  cabinet body
  { name: "bodyScan", hex: "#15141F" }, // 4  cabinet body scanline row
  { name: "bodyGrain", hex: "#232236" }, // 5  grain speck (lighter)
  { name: "bodyLight", hex: "#2E2D44" }, // 6  bevel highlight
  { name: "steel", hex: "#4A4A62" }, // 7  frame edge
  { name: "steelLight", hex: "#7A7A9A" }, // 8  frame highlight
  { name: "yellow", hex: "#F3E600" }, // 9  acid yellow (hero)
  { name: "yellowDark", hex: "#A89E00" }, // 10 yellow shade
  { name: "yellowPale", hex: "#FFF68A" }, // 11 yellow tint
  { name: "cyan", hex: "#00E5FF" }, // 12 cyan
  { name: "cyanDark", hex: "#00889A" }, // 13 cyan shade
  { name: "cyanPale", hex: "#9AF4FF" }, // 14 cyan tint
  { name: "magenta", hex: "#FF2BD6" }, // 15 magenta
  { name: "magentaDark", hex: "#9A1682" }, // 16 magenta shade
  { name: "magentaPale", hex: "#FF9BEA" }, // 17 magenta tint
  { name: "white", hex: "#F4F4F8" }, // 18 white
  { name: "grey", hex: "#9A9AAE" }, // 19 grey
  { name: "red", hex: "#FF2A4A" }, // 20 red (error, skull eyes)
  { name: "redDark", hex: "#8A0F22" }, // 21 red shade
  { name: "green", hex: "#39FF88" }, // 22 chip green
  { name: "orange", hex: "#FF8A00" }, // 23 eddies accent
];

export const PALETTE_INDEX: Readonly<Record<string, number>> = Object.fromEntries(
  PALETTE.map((p, i) => [p.name, i]),
);

export function hexOf(name: string): string {
  const i = PALETTE_INDEX[name];
  if (i === undefined) throw new Error(`palette: unknown colour ${name}`);
  return PALETTE[i].hex;
}
