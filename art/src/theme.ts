// theme.ts — single source of truth for the Claude Slots art project.
// Adapted from the motion-graphics skill template: NEVER inline colours,
// easings, or spring configs in components. The machine's pixel palette is
// palette.ts (≤ 24 entries) and is folded in here as theme.palette.
import { Easing } from "remotion";
import { PALETTE, hexOf } from "./palette.ts";

export const theme = {
  palette: PALETTE,
  colors: {
    bg: hexOf("ink"),
    bgAlt: hexOf("body"),
    primary: hexOf("yellow"), // THE hero colour — max one element per frame
    accent: hexOf("cyan"),
    accent2: hexOf("magenta"),
    text: hexOf("white"),
    textDim: hexOf("grey"),
    danger: hexOf("red"),
    glow: "rgba(243, 230, 0, 0.35)",
    glowCyan: "rgba(0, 229, 255, 0.35)",
    glowMagenta: "rgba(255, 43, 214, 0.35)",
  },
  fonts: {
    display: "'Archivo Black', 'Arial Black', Impact, sans-serif",
    body: "'Archivo', Inter, Helvetica, Arial, sans-serif",
    mono: "'JetBrains Mono', 'SF Mono', Menlo, monospace",
  },
  // THE easing curves. Linear is forbidden.
  ease: {
    out: Easing.bezier(0.16, 1, 0.3, 1), // easeOutExpo — entrances
    inOut: Easing.bezier(0.83, 0, 0.17, 1), // easeInOutQuint — moves
    in: Easing.bezier(0.7, 0, 0.84, 0), // exits only
    reel: Easing.bezier(0.2, 0.9, 0.3, 1), // reel deceleration (overshoot-free)
  },
  spring: {
    snappy: { damping: 14, stiffness: 160, mass: 0.6 },
    smooth: { damping: 20, stiffness: 90, mass: 1 },
    bouncy: { damping: 11, stiffness: 170, mass: 0.7 },
  },
} as const;
