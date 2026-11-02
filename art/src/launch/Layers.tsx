// Layers.tsx — the five-layer stack: mesh background, (assets/type from the
// scene), colour grade, grain + vignette. Nothing in a scene is flat.
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { theme } from "../theme.ts";

export const BgMesh: React.FC<{ hue?: "yellow" | "cyan" | "magenta" | "red" | "grey" }> = ({ hue = "yellow" }) => {
  const frame = useCurrentFrame();
  const d1 = Math.sin(frame / 55) * 50;
  const d2 = Math.cos(frame / 70) * 40;
  const c = { yellow: theme.colors.primary, cyan: theme.colors.accent, magenta: theme.colors.accent2, red: theme.colors.danger, grey: theme.colors.textDim }[hue];
  return (
    <AbsoluteFill style={{ background: theme.colors.bg }}>
      <div style={{ position: "absolute", width: 1400, height: 1400, borderRadius: "50%", top: -600, left: -400 + d1, filter: "blur(60px)", background: `radial-gradient(circle, ${c}2e, transparent 62%)` }} />
      <div style={{ position: "absolute", width: 1000, height: 1000, borderRadius: "50%", bottom: -450, right: -300 - d2, filter: "blur(80px)", background: `radial-gradient(circle, ${theme.colors.accent2}1f, transparent 65%)` }} />
      <div style={{ position: "absolute", inset: 0, backgroundImage: `linear-gradient(${theme.colors.accent}10 1px, transparent 1px), linear-gradient(90deg, ${theme.colors.accent}10 1px, transparent 1px)`, backgroundSize: "96px 96px", transform: `translateY(${(frame * 0.4) % 96}px)`, opacity: 0.5 }} />
    </AbsoluteFill>
  );
};

export const Grade: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <AbsoluteFill style={{ backgroundColor: theme.colors.primary, mixBlendMode: "soft-light", opacity: 0.16 }} />
    <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.12), transparent 28%, transparent 72%, rgba(0,0,0,0.25))" }} />
  </AbsoluteFill>
);

export const Grain: React.FC = () => {
  const frame = useCurrentFrame();
  const noise = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='220' height='220' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`;
  return <AbsoluteFill style={{ pointerEvents: "none", backgroundImage: noise, backgroundSize: "220px", backgroundPosition: `${(frame * 7) % 220}px ${(frame * 13) % 220}px`, opacity: 0.09, mixBlendMode: "overlay" }} />;
};

export const Scanlines: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: "none", background: "repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0px, rgba(0,0,0,0.18) 2px, transparent 2px, transparent 5px)", opacity: 0.6 }} />
);

export const Vignette: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: "none", background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.35) 100%)" }} />
);

/** Top of the stack for every scene. */
export const Post: React.FC = () => (
  <>
    <Grade />
    <Scanlines />
    <Grain />
    <Vignette />
  </>
);

/** Premium entrance: opacity + rise + scale on a spring. */
export const Entrance: React.FC<{ delay?: number; children: React.ReactNode; style?: React.CSSProperties; from?: number }> = ({ delay = 0, children, style, from = 40 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: theme.spring.smooth });
  return (
    <div style={{ opacity: p, transform: `translateY(${interpolate(p, [0, 1], [from, 0])}px) scale(${interpolate(p, [0, 1], [0.94, 1])})`, ...style }}>
      {children}
    </div>
  );
};

/** Scene wrapper: faster exit than entrance, applied to everything in the scene. */
export const SceneExit: React.FC<{ durationInFrames: number; children: React.ReactNode }> = ({ durationInFrames, children }) => {
  const frame = useCurrentFrame();
  const y = interpolate(frame, [durationInFrames - 12, durationInFrames - 2], [0, -42], { easing: theme.ease.in, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const o = interpolate(frame, [durationInFrames - 12, durationInFrames - 2], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity: o, transform: `translateY(${y}px)` }}>{children}</AbsoluteFill>;
};

/** Chromatic-aberration text: cyan and magenta ghosts behind the white/yellow face. */
export const GlitchText: React.FC<{ text: string; size: number; color?: string; shift?: number; style?: React.CSSProperties }> = ({ text, size, color = theme.colors.text, shift = 6, style }) => {
  const frame = useCurrentFrame();
  const jitter = frame % 17 === 0 ? shift * 2 : shift;
  const base: React.CSSProperties = { fontFamily: theme.fonts.display, fontSize: size, fontWeight: 900, letterSpacing: "-0.02em", lineHeight: 1, textTransform: "uppercase", position: "absolute", left: 0, top: 0, whiteSpace: "nowrap" };
  return (
    <div style={{ position: "relative", display: "inline-block", ...style }}>
      <div style={{ ...base, color: theme.colors.accent, transform: `translate(${-jitter}px, 0)`, mixBlendMode: "screen" }}>{text}</div>
      <div style={{ ...base, color: theme.colors.accent2, transform: `translate(${jitter}px, 0)`, mixBlendMode: "screen" }}>{text}</div>
      <div style={{ ...base, position: "relative", color }}>{text}</div>
    </div>
  );
};
