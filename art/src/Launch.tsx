// Launch.tsx — the satirical launch video, 1920 × 1080 @ 30 fps, 60 s.
// Scene starts and reel stops come from timeline.json, shared with
// scripts/dev/make-music.js so the soundtrack's accents land on the stops.
import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import timeline from "./timeline.json";
import { Title } from "./launch/Title.tsx";
import { Terminal } from "./launch/Terminal.tsx";
import { Pull, type PullSpec } from "./launch/Pull.tsx";
import { Payoff } from "./launch/Payoff.tsx";

const PROMPTS: Record<string, string> = {
  lose: "fix the flaky test in ci",
  feature: "add dark mode to the settings page",
  client: "draft the proposal for the Arasaka account",
  life: "what should I do with my weekend",
};

export const Launch: React.FC = () => {
  const scenes = timeline.scenes;
  const startOf = (id: string) => scenes.find((s) => s.id === id)!.start;
  const lengthOf = (id: string) => {
    const i = scenes.findIndex((s) => s.id === id);
    const next = scenes[i + 1] ? scenes[i + 1].start : timeline.durationInFrames;
    return next - scenes[i].start;
  };
  const pulls = timeline.pulls as unknown as PullSpec[];
  return (
    <AbsoluteFill>
      <Audio src={staticFile("launch-track.wav")} />
      <Sequence from={startOf("title")} durationInFrames={lengthOf("title")} name="title">
        <Title durationInFrames={lengthOf("title")} />
      </Sequence>
      <Sequence from={startOf("terminal")} durationInFrames={lengthOf("terminal")} name="terminal">
        <Terminal durationInFrames={lengthOf("terminal")} leverFrame={timeline.terminal.leverFrame} stopFrame={timeline.terminal.stopFrame} sceneStart={startOf("terminal")} />
      </Sequence>
      {pulls.map((p) => (
        <Sequence key={p.id} from={startOf(`pull-${p.id}`)} durationInFrames={lengthOf(`pull-${p.id}`)} name={`pull-${p.id}`}>
          <Pull spec={p} sceneStart={startOf(`pull-${p.id}`)} durationInFrames={lengthOf(`pull-${p.id}`)} prompt={PROMPTS[p.id]} />
        </Sequence>
      ))}
      <Sequence from={startOf("payoff")} durationInFrames={lengthOf("payoff")} name="payoff">
        <Payoff durationInFrames={lengthOf("payoff")} />
      </Sequence>
    </AbsoluteFill>
  );
};
