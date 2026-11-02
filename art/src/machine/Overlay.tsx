import React from "react";
import { useCurrentFrame } from "remotion";
import { Pixels } from "./Pixels.tsx";
import { overlayGrid, type OverlayId } from "./overlay-grid.ts";

/** One overlay sequence; the Composition's frame is the overlay frame. */
export const Overlay: React.FC<{ id: OverlayId; scale: number }> = ({ id, scale }) => {
  const frame = useCurrentFrame();
  return <Pixels grid={overlayGrid(id, frame)} scale={scale} />;
};
