import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { theme } from "../theme.ts";
import { BgMesh, Post, Entrance, GlitchText, SceneExit } from "./Layers.tsx";
import { Machine } from "../machine/Machine.tsx";
import { reelOffsetsAt, overlayAt, type Pull as PullTiming } from "../machine/motion.ts";
import type { OverlayId } from "../machine/overlay-grid.ts";
import type { SymbolId } from "../machine/symbol-grid.ts";

export type PullSpec = {
  id: string;
  outcome: "LOSE" | "FEATURE" | "CLIENT" | "LIFE";
  symbols: readonly [SymbolId, SymbolId, SymbolId];
  leverFrame: number;
  stopFrame: number;
  balanceBefore: number;
  payout: number;
};

const OVERLAY: Record<PullSpec["outcome"], OverlayId> = { LOSE: "lose", FEATURE: "win-feature", CLIENT: "win-client", LIFE: "win-life" };
const HUE: Record<PullSpec["outcome"], "grey" | "cyan" | "magenta" | "yellow"> = { LOSE: "grey", FEATURE: "cyan", CLIENT: "magenta", LIFE: "yellow" };
const COLOUR: Record<PullSpec["outcome"], string> = { LOSE: theme.colors.textDim, FEATURE: theme.colors.accent, CLIENT: theme.colors.accent2, LIFE: theme.colors.primary };
const LABEL: Record<PullSpec["outcome"], string> = { LOSE: "no match", FEATURE: "FEATURE", CLIENT: "CLIENT", LIFE: "A LIFE" };
const CAPTION: Record<PullSpec["outcome"], string> = {
  LOSE: "most prompts.",
  FEATURE: "you shipped something. nice.",
  CLIENT: "somebody is paying for it.",
  LIFE: "",
};

/** One pull, full size: the real sprite composition at 27 px per unit. */
export const Pull: React.FC<{ spec: PullSpec; sceneStart: number; durationInFrames: number; prompt: string }> = ({ spec, sceneStart, durationInFrames, prompt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const absFrame = sceneStart + frame;
  const nowMs = (absFrame / fps) * 1000;
  const timing: PullTiming = { leverAt: (spec.leverFrame / fps) * 1000, stopAt: (spec.stopFrame / fps) * 1000, symbols: spec.symbols };
  const stopped = absFrame >= spec.stopFrame + 36; // last reel landed
  const balance = absFrame >= spec.leverFrame ? spec.balanceBefore - 1 + (absFrame >= spec.stopFrame ? spec.payout : 0) : spec.balanceBefore;
  const offsets = reelOffsetsAt(timing, nowMs);
  const overlay = overlayAt(timing, OVERLAY[spec.outcome], nowMs);
  const variant = Math.floor(nowMs / 100) % 4;
  const shake = spec.outcome === "LIFE" && stopped && absFrame < spec.stopFrame + 60 ? Math.sin(frame * 3) * 6 : 0;
  const breathe = 1 + Math.sin(frame / 22) * 0.008;
  const net = spec.payout - 1;
  const result = `◈ ${LABEL[spec.outcome]}  ${net >= 0 ? "+" : "−"}${Math.abs(net)} cr  balance ${String(balance).padStart(3, "0")}`;
  const resultIn = spring({ frame: absFrame - (spec.stopFrame + 40), fps, config: theme.spring.snappy });
  return (
    <AbsoluteFill>
      <BgMesh hue={HUE[spec.outcome]} />
      <SceneExit durationInFrames={durationInFrames}>
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
          <Entrance from={80}>
            <div style={{ fontFamily: theme.fonts.mono, fontSize: 34, color: theme.colors.textDim, marginBottom: 36, textAlign: "center" }}>
              <span style={{ color: theme.colors.primary }}>&gt; </span>
              {prompt}
            </div>
          </Entrance>
          <Entrance delay={4} from={60}>
            <div style={{ transform: `translateX(${shake}px) scale(${breathe})`, boxShadow: `0 0 140px 30px ${spec.outcome === "LIFE" ? theme.colors.glow : spec.outcome === "CLIENT" ? theme.colors.glowMagenta : theme.colors.glowCyan}` }}>
              <Machine scale={27} state={{ variant, offsets, balance, overlay }} />
            </div>
          </Entrance>
          <div style={{ height: 140, marginTop: 40, opacity: resultIn, transform: `translateY(${interpolate(resultIn, [0, 1], [30, 0])}px)` }}>
            <div style={{ fontFamily: theme.fonts.mono, fontSize: 44, color: COLOUR[spec.outcome], textAlign: "center" }}>{result}</div>
            {CAPTION[spec.outcome] && (
              <div style={{ fontFamily: theme.fonts.body, fontSize: 32, color: theme.colors.textDim, textAlign: "center", marginTop: 14 }}>{CAPTION[spec.outcome]}</div>
            )}
          </div>
        </AbsoluteFill>
        {spec.outcome !== "LOSE" && stopped && (
          <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 36 }}>
            <Entrance delay={spec.stopFrame + 38 - sceneStart} from={-30}>
              <GlitchText text={spec.outcome === "LIFE" ? "A LIFE" : `A ${spec.outcome}`} size={120} color={COLOUR[spec.outcome]} />
            </Entrance>
          </AbsoluteFill>
        )}
      </SceneExit>
      <Post />
    </AbsoluteFill>
  );
};
