import { mkdir, writeFile } from "fs/promises";
import path from "path";
import {
    DEFAULT_CLIP_CONFIG,
    DEFAULT_EXPORT_CONFIG,
    OUTPUT_DIR,
} from "../config/index.js";
import { DetectionService } from "../services/detection.service.js";
import { ExportService } from "../services/export.service.js";
import { GeminiScoringStrategy } from "../services/geminiScoringStrategy.service.js";
import { OpenRouterScoringStrategy } from "../services/openRouterScoringStrategy.service.js";
import { TranscriptionService } from "../services/transcription.service.js";
import { VideoService } from "../services/video.service.js";
import type { PipelineConfig } from "../types/index.js";

export class Pipeline {
    private transcription = new TranscriptionService();
    private detection: DetectionService;
    private export = new ExportService();
    private video = new VideoService();

    constructor() {
        const geminiKey = process.env.GEMINI_API_KEY;
        const openRouterKey = process.env.OPEN_ROUTE;

        let scoring;
        if (openRouterKey) {
            scoring = new OpenRouterScoringStrategy(openRouterKey);
        } else if (geminiKey) {
            scoring = new GeminiScoringStrategy(geminiKey);
        }

        this.detection = new DetectionService(scoring);
    }

    async run(
        inputPath: string,
        options?: Partial<PipelineConfig>,
    ): Promise<string[]> {
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

        const transcript = await this.transcription.transcribe(
            inputPath,
            config.karaoke,
        );

        const { duration } = await this.video.getMetadata(inputPath);

        const clips = await this.detection.detectClips(transcript, duration, {
            minDuration: config.minClipDuration,
            maxDuration: config.maxClipDuration,
            targetClips: config.targetClips,
        });

        if (clips.length === 0) {
            throw new Error(
                "Nenhum clip detectado. Verifique o vídeo de entrada.",
            );
        }

        await mkdir(config.outputDir, { recursive: true });
        const clipsJsonPath = path.join(config.outputDir, "clips.json");
        await writeFile(clipsJsonPath, JSON.stringify(clips, null, 2), "utf-8");

        return this.export.exportClips(inputPath, clips, transcript, config);
    }
}
