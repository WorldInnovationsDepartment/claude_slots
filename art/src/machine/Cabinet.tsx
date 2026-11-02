import React from "react";
import { Pixels } from "./Pixels.tsx";
import { cabinetGrid } from "./cabinet-grid.ts";

export const Cabinet: React.FC<{ variant: number; scale: number }> = ({ variant, scale }) => (
  <Pixels grid={cabinetGrid(variant)} scale={scale} />
);
