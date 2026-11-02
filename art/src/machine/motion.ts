// motion.ts — the reel timing of lib/machine.js, ported so the video shows
// exactly what the terminal shows. Keep the constants equal to TIMINGS there
// (they are also written in timeline.json's `machine` block).
import { STRIP_H } from "./strip-grid.ts";
import { symbolOffset, type SymbolId } from "./symbol-grid.ts";
import { OVERLAY_FRAMES, type OverlayId } from "./overlay-grid.ts";

export const MOTION = {
  spinupMs: 400,
  reelSpeed: [44, 50, 56] as const,
  stoppingStaggerMs: 300,
  stopMs: 600,
  minStopTravelPx: STRIP_H,
  overlayFrameMs: 100,
};
const ALL_STOPPED_MS = 2 * MOTION.stoppingStaggerMs + MOTION.stopMs;

const easeOutCubic = (u: number) => 1 - Math.pow(1 - u, 3);

function spinDistance(i: number, t: number): number {
  const v = MOTION.reelSpeed[i] / 1000;
  const ramp = MOTION.spinupMs;
  if (t <= 0) return 0;
  if (t < ramp) return (v * t * t) / (2 * ramp);
  return v * (t - ramp / 2);
}

function landingTarget(from: number, symbol: SymbolId): number {
  const sym = symbolOffset(symbol);
  const limit = from - MOTION.minStopTravelPx;
  const rem = (((limit - sym) % STRIP_H) + STRIP_H) % STRIP_H;
  return limit - rem;
}

export type Pull = {
  /** ms at which the trigger was pulled */
  leverAt: number;
  /** ms at which the turn ended, or null while still spinning */
  stopAt: number | null;
  symbols: readonly [SymbolId, SymbolId, SymbolId];
  rest?: readonly [number, number, number];
};

const DEFAULT_REST: readonly [number, number, number] = [symbolOffset("SKULL"), symbolOffset("EDDIES"), symbolOffset("CHIP")];

/** Reel offsets at absolute time `now` (ms), identical to lib/machine.js reelOffsets. */
export function reelOffsetsAt(pull: Pull, now: number): [number, number, number] {
  const rest = pull.rest ?? DEFAULT_REST;
  const spin = (i: number, t: number) => rest[i] - spinDistance(i, t - pull.leverAt);
  if (now < pull.leverAt) return [rest[0], rest[1], rest[2]];
  if (pull.stopAt == null || now < pull.stopAt) return [0, 1, 2].map((i) => Math.round(spin(i, now))) as [number, number, number];
  return [0, 1, 2].map((i) => {
    const start = pull.stopAt! + i * MOTION.stoppingStaggerMs;
    const o0 = spin(i, start);
    const target = landingTarget(o0, pull.symbols[i]);
    if (now < start) return Math.round(spin(i, now));
    const u = Math.min(1, (now - start) / MOTION.stopMs);
    return Math.round(o0 + (target - o0) * easeOutCubic(u));
  }) as [number, number, number];
}

/** The overlay frame at `now` for a pull whose outcome overlay is `id`, or null (plays once, like the engine). */
export function overlayAt(pull: Pull, id: OverlayId, now: number): { id: OverlayId; frame: number } | null {
  if (pull.stopAt == null) return null;
  const t = now - pull.stopAt - ALL_STOPPED_MS;
  if (t < 0) return null;
  const frame = Math.floor(t / MOTION.overlayFrameMs);
  if (frame >= OVERLAY_FRAMES[id]) return null;
  return { id, frame };
}

/** Frame at which reel `i` lands, given the stop frame (what timeline.json's reelStops must equal). */
export function reelStopFrame(stopFrame: number, i: number, fps: number): number {
  return stopFrame + Math.round(((i * MOTION.stoppingStaggerMs + MOTION.stopMs) / 1000) * fps);
}
