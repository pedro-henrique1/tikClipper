import { mkdir } from "fs/promises";
import path from "path";
import type { Clip, PipelineConfig } from "../types/index.js";
import { VideoService } from "./video.service.js";

/**
 * Orquestra a exportação dos clips para o formato final
 */
export class ExportService {
    private videoService = new VideoService();

    async exportClips(
        inputPath: string,
        clips: Clip[],
        config: PipelineConfig
    ): Promise<string[]> {
        const { outputDir, exportConfig } = config;
        await mkdir(outputDir, { recursive: true });

        const outputPaths: string[] = [];
        const baseName = path.basename(inputPath, path.extname(inputPath));

        for (let i = 0; i < clips.length; i++) {
            const clip = clips[i];
            const outputPath = path.join(
                outputDir,
                `${baseName}_clip_${i + 1}.${exportConfig.format}`
            );

            await this.videoService.extractClip(
                inputPath,
                outputPath,
                clip,
                exportConfig
            );
            outputPaths.push(outputPath);
        }

        return outputPaths;
    }
}
