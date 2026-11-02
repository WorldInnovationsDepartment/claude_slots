import React from "react";
import { Pixels } from "./Pixels.tsx";
import { composeMachine, type MachineState } from "./compose.ts";

/** The whole machine as the terminal composites it, at `scale` px per unit. */
export const Machine: React.FC<{ state: MachineState; scale: number; style?: React.CSSProperties }> = ({ state, scale, style }) => (
  <Pixels grid={composeMachine(state)} scale={scale} style={style} />
);
