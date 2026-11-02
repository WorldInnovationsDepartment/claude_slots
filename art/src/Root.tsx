import React from "react";
import { Composition, Still } from "remotion";
import { theme } from "./theme.ts";
import { W, H } from "./machine/layout.ts";
import { Cabinet } from "./machine/Cabinet.tsx";
import { CABINET_VARIANTS } from "./machine/cabinet-grid.ts";
import { ReelStrip } from "./machine/ReelStrip.tsx";
import { STRIP_W, STRIP_H } from "./machine/strip-grid.ts";
import { Digits } from "./machine/Digits.tsx";
import { DIGITS_W, DIGITS_H } from "./machine/digits-grid.ts";
import { Overlay } from "./machine/Overlay.tsx";
import { OVERLAY_IDS, OVERLAY_FRAMES, type OverlayId } from "./machine/overlay-grid.ts";
import { Machine } from "./machine/Machine.tsx";
import { Launch } from "./Launch.tsx";
import timeline from "./timeline.json";

/** Sprite layers render at 1 px per unit; previews and the video at 27 px per unit (40 × 27 = 1080). */
export const SPRITE_SCALE = 1;
export const VIDEO_SCALE = 27;
export const OVERLAY_FPS = 10;

const overlayCompId = (id: OverlayId) =>
  "Overlay" + id.split("-").map((s) => s[0].toUpperCase() + s.slice(1)).join("");

/** The plugin icon: the machine on its own, square, for .claude-plugin/icon.png. */
const Icon: React.FC = () => (
  <div style={{ width: "100%", height: "100%", background: theme.colors.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
    <div style={{ boxShadow: `0 0 120px 30px ${theme.colors.glow}` }}>
      <Machine scale={22} state={{ variant: 0, offsets: [16, 16, 16], balance: 100, overlay: null }} />
    </div>
  </div>
);

const PreviewMachine: React.FC = () => (
  <div style={{ width: "100%", height: "100%", background: theme.colors.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
    <Machine
      scale={VIDEO_SCALE}
      state={{ variant: 0, offsets: [0, 8, 16], balance: 97, overlay: null }}
    />
  </div>
);

export const Root: React.FC = () => (
  <>
    {/* --- sprite layers, native resolution, transparent background --- */}
    {Array.from({ length: CABINET_VARIANTS }, (_, v) => (
      <Still key={v} id={`SpriteCabinet${v}`} component={Cabinet} width={W} height={H} defaultProps={{ variant: v, scale: SPRITE_SCALE }} />
    ))}
    <Still id="SpriteStrip" component={ReelStrip} width={STRIP_W} height={STRIP_H} defaultProps={{ scale: SPRITE_SCALE }} />
    <Still id="SpriteDigits" component={Digits} width={DIGITS_W} height={DIGITS_H} defaultProps={{ scale: SPRITE_SCALE }} />
    {OVERLAY_IDS.map((id) => (
      <Composition
        key={id}
        id={overlayCompId(id)}
        component={Overlay}
        width={W}
        height={H}
        fps={OVERLAY_FPS}
        durationInFrames={OVERLAY_FRAMES[id]}
        defaultProps={{ id, scale: SPRITE_SCALE }}
      />
    ))}

    {/* --- previews at video scale, for Studio and eyeballing --- */}
    <Still id="PreviewCabinet" component={Cabinet} width={W * VIDEO_SCALE} height={H * VIDEO_SCALE} defaultProps={{ variant: 0, scale: VIDEO_SCALE }} />
    <Still id="PreviewStrip" component={ReelStrip} width={STRIP_W * VIDEO_SCALE} height={STRIP_H * VIDEO_SCALE} defaultProps={{ scale: VIDEO_SCALE }} />
    <Still id="PreviewDigits" component={Digits} width={DIGITS_W * VIDEO_SCALE} height={DIGITS_H * VIDEO_SCALE} defaultProps={{ scale: VIDEO_SCALE }} />
    {OVERLAY_IDS.map((id) => (
      <Composition
        key={`p-${id}`}
        id={`Preview${overlayCompId(id)}`}
        component={Overlay}
        width={W * VIDEO_SCALE}
        height={H * VIDEO_SCALE}
        fps={OVERLAY_FPS}
        durationInFrames={OVERLAY_FRAMES[id]}
        defaultProps={{ id, scale: VIDEO_SCALE }}
      />
    ))}
    <Still id="PreviewMachine" component={PreviewMachine} width={1920} height={1080} />
    <Still id="Icon" component={Icon} width={1024} height={1024} />

    {/* --- the launch video (built in task 4.2) --- */}
    <Composition id="Launch" component={Launch} width={1920} height={1080} fps={timeline.fps} durationInFrames={timeline.durationInFrames} />
  </>
);
