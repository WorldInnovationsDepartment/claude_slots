// Pixels.tsx — draws a Grid as crisp SVG rectangles, `scale` px per unit.
// Horizontal runs of one colour collapse into one rect to keep the DOM small
// (a full 40 × 20 frame is ~150 rects instead of 800).
import React from "react";
import { PALETTE } from "../palette.ts";
import { TRANSPARENT, type Grid } from "./grid.ts";

export type PixelsProps = {
  grid: Grid;
  scale: number;
  /** Optional CSS for the <svg> (position, filters). */
  style?: React.CSSProperties;
};

export const Pixels: React.FC<PixelsProps> = ({ grid, scale, style }) => {
  const h = grid.length;
  const w = h ? grid[0].length : 0;
  const rects: React.ReactNode[] = [];
  for (let y = 0; y < h; y++) {
    const row = grid[y];
    let x = 0;
    while (x < w) {
      const c = row[x];
      if (c === TRANSPARENT) {
        x++;
        continue;
      }
      let x1 = x + 1;
      while (x1 < w && row[x1] === c) x1++;
      rects.push(
        <rect key={`${y}-${x}`} x={x * scale} y={y * scale} width={(x1 - x) * scale} height={scale} fill={PALETTE[c].hex} />,
      );
      x = x1;
    }
  }
  return (
    <svg
      width={w * scale}
      height={h * scale}
      viewBox={`0 0 ${w * scale} ${h * scale}`}
      shapeRendering="crispEdges"
      style={{ display: "block", ...style }}
    >
      {rects}
    </svg>
  );
};
