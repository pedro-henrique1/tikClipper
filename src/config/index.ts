export const DEFAULT_EXPORT_CONFIG = {
    width: 1080,
    height: 1920,
    fps: 30,
    format: "mp4" as const,
    aspectRatio: "9:16" as const,
};

export const DEFAULT_CLIP_CONFIG = {
    minDuration: 45,
    maxDuration: 90,
    targetClips: 3,
};

export const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "./output";
