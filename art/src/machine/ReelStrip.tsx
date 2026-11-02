import React from "react";
import { Pixels } from "./Pixels.tsx";
import { stripGrid } from "./strip-grid.ts";

export const ReelStrip: React.FC<{ scale: number }> = ({ scale }) => <Pixels grid={stripGrid()} scale={scale} />;
