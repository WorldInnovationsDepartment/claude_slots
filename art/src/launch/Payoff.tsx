import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { theme } from "../theme.ts";
import { BgMesh, Post, Entrance, GlitchText, SceneExit } from "./Layers.tsx";

const LINES = [
  "You pulled the trigger four times.",
  "You won a feature, a client, and a life.",
  "Balance: 221 credits.",
  "The feature still needs tests.",
];

/** The deadpan payoff card. */
export const Payoff: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const float = Math.sin(frame / 30) * 3;
  return (
    <AbsoluteFill>
      <BgMesh hue="yellow" />
      <SceneExit durationInFrames={durationInFrames}>
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", gap: 18, transform: `translateY(${float}px)` }}>
          {LINES.map((l, i) => (
            <Entrance key={l} delay={8 + i * 22} from={30}>
              <div style={{ fontFamily: theme.fonts.body, fontSize: 54, color: i === LINES.length - 1 ? theme.colors.primary : theme.colors.text, textAlign: "center" }}>{l}</div>
            </Entrance>
          ))}
          <Entrance delay={110} from={40}>
            <div style={{ marginTop: 60, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
              <GlitchText text="Claude Slots" size={92} color={theme.colors.primary} shift={4} />
              <div style={{ fontFamily: theme.fonts.mono, fontSize: 30, color: theme.colors.accent }}>/plugin install slots@slots-local</div>
              <div style={{ fontFamily: theme.fonts.mono, fontSize: 24, color: theme.colors.textDim }}>github.com/WorldInnovationsDepartment/claude_slots · no eddies were harmed</div>
            </div>
          </Entrance>
        </AbsoluteFill>
      </SceneExit>
      <Post />
    </AbsoluteFill>
  );
};
