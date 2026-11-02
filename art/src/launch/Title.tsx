import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { theme } from "../theme.ts";
import { BgMesh, Post, Entrance, GlitchText, SceneExit } from "./Layers.tsx";

/** Cold open: the title card. */
export const Title: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = ["CLAUDE", "SLOTS"];
  const bar = spring({ frame: frame - 2, fps, config: theme.spring.snappy });
  const breathe = 1 + Math.sin(frame / 22) * 0.012;
  const flicker = frame % 29 === 0 || frame % 31 === 0 ? 0.7 : 1;
  return (
    <AbsoluteFill>
      <BgMesh hue="yellow" />
      <SceneExit durationInFrames={durationInFrames}>
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
          <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: interpolate(bar, [0, 1], [0, 28]), background: theme.colors.primary }} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8, transform: `scale(${breathe})`, opacity: flicker }}>
            {words.map((w, i) => (
              <Entrance key={w} delay={6 + i * 8} from={60}>
                <GlitchText text={w} size={i === 0 ? 220 : 220} color={i === 1 ? theme.colors.primary : theme.colors.text} />
              </Entrance>
            ))}
            <Entrance delay={34}>
              <div style={{ fontFamily: theme.fonts.mono, fontSize: 40, color: theme.colors.accent, marginTop: 24, letterSpacing: "0.12em" }}>
                a Claude Code plugin
              </div>
            </Entrance>
            <Entrance delay={48}>
              <div style={{ fontFamily: theme.fonts.body, fontSize: 34, color: theme.colors.textDim, marginTop: 10 }}>
                Pull the trigger. Wait. You might win.
              </div>
            </Entrance>
          </div>
        </AbsoluteFill>
      </SceneExit>
      <Post />
    </AbsoluteFill>
  );
};
