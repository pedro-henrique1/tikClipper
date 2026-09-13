import { mkdir, writeFile } from "fs/promises";
import path from "path";
import {
    DEFAULT_CLIP_CONFIG,
    DEFAULT_EXPORT_CONFIG,
    OUTPUT_DIR,
} from "../config/index.js";
import { CaptionService } from "../services/caption.service.js";
import { DetectionService } from "../services/detection.service.js";
import {
    ExportService,
    type ClipProgressCallback,
} from "../services/export.service.js";
import { logger } from "../services/logger.service.js";
import { OpenRouterScoringStrategy } from "../services/openRouterScoringStrategy.service.js";
import { TranscriptionService } from "../services/transcription.service.js";
import { UploadService } from "../services/upload.service.js";
import { VideoService } from "../services/video.service.js";
import type {
    Clip,
    PipelineConfig,
    TranscriptSegment,
} from "../types/index.js";

export interface PipelineStats {
    videoDuration: number;
    transcriptSegments: number;
    clipsDetected: number;
    totalClipTime: number;
    outputDir: string;
    elapsedMs: number;
}

export interface PipelineResult {
    outputPaths: string[];
    clips: Clip[];
    transcript: TranscriptSegment[];
    stats: PipelineStats;
}

export class Pipeline {
    private transcription = new TranscriptionService();
    private detection: DetectionService;
    private export = new ExportService();
    private video = new VideoService();
    private uploadService = new UploadService();
    private captionService = new CaptionService();

    constructor() {
        const openRouterKey = process.env.OPEN_ROUTE;

        let scoring;
        if (openRouterKey) {
            scoring = new OpenRouterScoringStrategy(openRouterKey);
        }

        this.detection = new DetectionService(scoring);
    }

    async run(
        inputPath: string,
        options?: Partial<PipelineConfig>,
        onProgress?: (stage: "transcribe" | "detect" | "render", percent: number) => void,
    ): Promise<PipelineResult> {
        const startedAt = Date.now();

        const config: PipelineConfig = {
            inputPath,
            outputDir: path.join(
                OUTPUT_DIR,
                path.basename(inputPath, path.extname(inputPath)),
            ),
            minClipDuration: DEFAULT_CLIP_CONFIG.minDuration,
            maxClipDuration: DEFAULT_CLIP_CONFIG.maxDuration,
            targetClips: DEFAULT_CLIP_CONFIG.targetClips,
            exportConfig: DEFAULT_EXPORT_CONFIG,
            ...options,
        };

        const { duration } = await this.video.getMetadata(inputPath);

        onProgress?.("transcribe", 0);
        const transcript = await this.transcription.transcribe(
            inputPath,
            config.karaoke,
            (currentSeconds) => {
                const percent = Math.min(99, Math.round((currentSeconds / duration) * 100));
                onProgress?.("transcribe", percent);
            },
        );
        onProgress?.("transcribe", 100);

        onProgress?.("detect", 0);
        const { clips } = await this.detection.detectClips(
            transcript,
            duration,
            {
                minDuration: config.minClipDuration,
                maxDuration: config.maxClipDuration,
                targetClips: config.targetClips,
            },
            (percent) => {
                onProgress?.("detect", percent);
            },
        );
        onProgress?.("detect", 100);

        if (clips.length === 0) {
            throw new Error("No clips detected. Check the input video.");
        }

        for (const clip of clips) {
            if (clip.transcript) {
                clip.caption = await this.captionService.generateCaption(
                    clip.transcript,
                );
                logger.debug(
                    { clipId: clip.id, caption: clip.caption },
                    "AI caption generated.",
                );
            }
        }

        await mkdir(config.outputDir, { recursive: true });
        const clipsJsonPath = path.join(config.outputDir, "clips.json");
        await writeFile(clipsJsonPath, JSON.stringify(clips, null, 2), "utf-8");

        onProgress?.("render", 0);
        const outputPaths = await this.export.exportClips(
            inputPath,
            clips,
            transcript,
            config,
            (clipIndex, percent) => {
                const overallPercent = Math.min(100, Math.round(((clipIndex * 100) + percent) / clips.length));
                onProgress?.("render", overallPercent);
            },
        );
        onProgress?.("render", 100);

        if (config.upload && config.uploadConfig) {
            for (const clipPath of outputPaths) {
                try {
                    await this.uploadService.uploadToTikTok(
                        clipPath,
                        config.uploadConfig.cookiesPath,
                        config.uploadConfig.caption ||
                            clips[outputPaths.indexOf(clipPath)]?.caption,
                    );
                } catch (err) {
                    logger.warn({ err }, `Upload failed for ${clipPath}`);
                }
            }
        }

        const totalClipTime = clips.reduce(
            (sum, c) => sum + (c.endTime - c.startTime),
            0,
        );

        return {
            outputPaths,
            clips,
            transcript,
            stats: {
                videoDuration: duration,
                transcriptSegments: transcript.length,
                clipsDetected: clips.length,
                totalClipTime,
                outputDir: config.outputDir,
                elapsedMs: Date.now() - startedAt,
            },
        };
    }

    async render(
        inputPath: string,
        clips: Clip[],
        karaoke: boolean,
        onProgress?: (stage: "transcribe" | "render", percent: number) => void,
    ): Promise<string[]> {
        const absolutePath = path.resolve(process.cwd(), inputPath);

        let transcript: TranscriptSegment[] = [];
        if (karaoke) {
            const { duration } = await this.video.getMetadata(absolutePath);
            onProgress?.("transcribe", 0);
            transcript = await this.transcription.transcribe(
                absolutePath,
                true,
                (currentSeconds) => {
                    const percent = Math.min(99, Math.round((currentSeconds / duration) * 100));
                    onProgress?.("transcribe", percent);
                },
            );
            onProgress?.("transcribe", 100);
        }

        const rawVideoName = path.basename(absolutePath, path.extname(absolutePath));
        const safeVideoName = rawVideoName.length > 40 ? rawVideoName.slice(0, 40) : rawVideoName;
        const outputDir = path.resolve(OUTPUT_DIR, safeVideoName);

        const config: PipelineConfig = {
            inputPath: absolutePath,
            outputDir,
            minClipDuration: DEFAULT_CLIP_CONFIG.minDuration,
            maxClipDuration: DEFAULT_CLIP_CONFIG.maxDuration,
            targetClips: clips.length,
            exportConfig: DEFAULT_EXPORT_CONFIG,
        };

        onProgress?.("render", 0);
        const outputPaths = await this.export.exportClips(
            absolutePath,
            clips,
            transcript,
            config,
            (clipIndex, percent) => {
                const overallPercent = Math.min(100, Math.round(((clipIndex * 100) + percent) / clips.length));
                onProgress?.("render", overallPercent);
            },
        );
        onProgress?.("render", 100);

        return outputPaths;
    }
}
