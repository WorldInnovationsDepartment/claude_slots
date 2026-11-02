import React from "react";
import { Pixels } from "./Pixels.tsx";
import { digitsGrid } from "./digits-grid.ts";

export const Digits: React.FC<{ scale: number }> = ({ scale }) => <Pixels grid={digitsGrid()} scale={scale} />;
