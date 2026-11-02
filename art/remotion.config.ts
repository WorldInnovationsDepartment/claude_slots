import { Config } from "@remotion/cli/config";

// Sprite layers are rendered as PNGs with transparency; the video is h264.
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
