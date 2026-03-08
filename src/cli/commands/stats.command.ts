import type { Command } from "commander";
import "dotenv/config";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import path from "path";
import { OUTPUT_DIR } from "../../config/index.js";
import { logger } from "../../services/logger.service.js";
import { VideoService } from "../../services/video.service.js";
import type { Clip } from "../../types/index.js";
import { printClipsTable, printStatsTable } from "../utils/ui.js";

export function registerStatsCommand(program: Command): void {
    program
        .command("stats <video>")
        .description(
            "Mostra estatísticas dos clips detectados a partir do clips.json existente.",
        )
        .action(async (video: string) => {
            const absolutePath = path.resolve(process.cwd(), video);
            if (!existsSync(absolutePath)) {
                logger.error(`Arquivo não encontrado: ${absolutePath}`);
                process.exit(1);
            }

            const rawVideoName = path.basename(
                absolutePath,
                path.extname(absolutePath),
            );
            const safeVideoName =
                rawVideoName.length > 40
                    ? rawVideoName.slice(0, 40)
                    : rawVideoName;
            const outputDir = path.resolve(OUTPUT_DIR, safeVideoName);
            const clipsJsonPath = path.join(outputDir, "clips.json");

            if (!existsSync(clipsJsonPath)) {
                logger.error(`clips.json não encontrado em ${clipsJsonPath}`);
                logger.info(
                    "  Execute primeiro: npm run cli -- analyze <video>",
                );
                process.exit(1);
            }

            const clips: Clip[] = JSON.parse(
                await readFile(clipsJsonPath, "utf-8"),
            );

            const videoService = new VideoService();
            let duration = 0;
            try {
                const meta = await videoService.getMetadata(absolutePath);
                duration = meta.duration;
            } catch {}

            const totalClipTime = clips.reduce(
                (sum, c) => sum + (c.endTime - c.startTime),
                0,
            );

            printStatsTable({
                videoDuration: duration,
                transcriptSegments: 0,
                clipsDetected: clips.length,
                totalClipTime,
                outputDir,
                elapsedMs: 0,
            });

            printClipsTable(clips);
        });
}
