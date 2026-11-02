import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { theme } from "../theme.ts";
import { BgMesh, Post, Entrance, SceneExit } from "./Layers.tsx";
import { Machine } from "../machine/Machine.tsx";
import { reelOffsetsAt, overlayAt } from "../machine/motion.ts";
import { OVERLAY_FRAMES } from "../machine/overlay-grid.ts";

const LINES = [
  ["> ", "refactor the auth module and add tests", theme.colors.text],
  ["", "", ""],
  ["⏺ ", "Read(src/auth/session.ts)", theme.colors.textDim],
  ["  ⎿ ", "Read 212 lines", theme.colors.textDim],
  ["⏺ ", "Grep(pattern: \"refreshToken\")", theme.colors.textDim],
  ["  ⎿ ", "Found 9 files", theme.colors.textDim],
  ["⏺ ", "Update(src/auth/session.ts)", theme.colors.textDim],
  ["  ⎿ ", "Updated with 3 additions and 1 removal", theme.colors.textDim],
  ["⏺ ", "Bash(node --test tests/auth.test.js)", theme.colors.textDim],
  ["  ⎿ ", "# pass 14  # fail 0", theme.colors.accent],
] as const;

/** A mock terminal with the real sprite composition in the spinner's place. */
export const Terminal: React.FC<{ durationInFrames: number; leverFrame: number; stopFrame: number; sceneStart: number }> = ({ durationInFrames, leverFrame, stopFrame, sceneStart }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const absFrame = sceneStart + frame;
  const nowMs = (absFrame / fps) * 1000;
  const pull = { leverAt: (leverFrame / fps) * 1000, stopAt: (stopFrame / fps) * 1000, symbols: ["PILLS", "GUN", "AGENT"] as const };
  const offsets = reelOffsetsAt(pull, nowMs);
  const overlay = overlayAt(pull, "lose", nowMs);
  const variant = Math.floor(nowMs / 100) % 4;
  // the engine keeps the Spinner up until the outcome overlay has played, then TurnDuration shows the result line
  const overlayEndFrame = stopFrame + 36 + OVERLAY_FRAMES.lose * 3;
  const spinning = absFrame >= leverFrame && absFrame < overlayEndFrame;
  const done = absFrame >= overlayEndFrame;
  const balance = absFrame >= leverFrame ? 99 : 100;
  const resultIn = spring({ frame: absFrame - overlayEndFrame, fps, config: theme.spring.snappy });
  const win = spring({ frame, fps, config: theme.spring.smooth });
  const linesShown = Math.max(0, Math.floor((frame - 24) / 9));
  const elapsed = Math.max(0, Math.floor((Math.min(absFrame, stopFrame) - leverFrame) / fps));
  return (
    <AbsoluteFill>
      <BgMesh hue="cyan" />
      <SceneExit durationInFrames={durationInFrames}>
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
          <div style={{ width: 1560, height: 880, borderRadius: 18, background: "#0B0B12", border: `2px solid ${theme.colors.textDim}55`, boxShadow: `0 40px 120px rgba(0,0,0,0.6), 0 0 80px ${theme.colors.glowCyan}`, overflow: "hidden", opacity: win, transform: `translateY(${interpolate(win, [0, 1], [60, 0])}px) scale(${interpolate(win, [0, 1], [0.96, 1])})` }}>
            <div style={{ height: 52, background: "#15151F", display: "flex", alignItems: "center", gap: 10, padding: "0 20px", fontFamily: theme.fonts.mono, fontSize: 20, color: theme.colors.textDim }}>
              <span style={{ width: 16, height: 16, borderRadius: 8, background: theme.colors.danger }} />
              <span style={{ width: 16, height: 16, borderRadius: 8, background: theme.colors.primary }} />
              <span style={{ width: 16, height: 16, borderRadius: 8, background: theme.colors.accent }} />
              <span style={{ marginLeft: 20 }}>claude — ~/projects/night-city-app</span>
            </div>
            <div style={{ padding: "26px 40px", fontFamily: theme.fonts.mono, fontSize: 28, lineHeight: 1.5 }}>
              {LINES.slice(0, Math.min(LINES.length, linesShown)).map(([pre, text, color], i) => (
                <Entrance key={i} delay={24 + i * 9} from={12}>
                  <div style={{ color, whiteSpace: "pre" }}>
                    <span style={{ color: theme.colors.primary }}>{pre}</span>
                    {text}
                  </div>
                </Entrance>
              ))}
              {spinning && (
                <div style={{ marginTop: 18, display: "flex", alignItems: "flex-end", gap: 28 }}>
                  <Machine scale={12} state={{ variant, offsets, balance, overlay }} />
                  <div style={{ color: theme.colors.textDim, fontSize: 24, paddingBottom: 6 }}>
                    ({elapsed}s · esc to interrupt)
                  </div>
                </div>
              )}
              {done && (
                <div style={{ marginTop: 18, color: theme.colors.textDim, whiteSpace: "pre", opacity: resultIn, transform: `translateY(${interpolate(resultIn, [0, 1], [10, 0])}px)` }}>
                  ◈ no match  −1 cr  balance 099
                </div>
              )}
            </div>
          </div>
        </AbsoluteFill>
        <Entrance delay={60}>
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 44, textAlign: "center", fontFamily: theme.fonts.display, fontSize: 56, color: theme.colors.primary, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            while the agent works, the reels keep turning
          </div>
        </Entrance>
      </SceneExit>
      <Post />
    </AbsoluteFill>
  );
};
