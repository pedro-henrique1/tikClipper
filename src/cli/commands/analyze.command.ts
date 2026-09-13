import chalk from "chalk";
import type { Command } from "commander";
import "dotenv/config";
import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { OUTPUT_DIR } from "../../config/index.js";
import { CaptionService } from "../../services/caption.service.js";
import { DetectionService } from "../../services/detection.service.js";
import { logger } from "../../services/logger.service.js";
import { OpenRouterScoringStrategy } from "../../services/openRouterScoringStrategy.service.js";
import { TranscriptionService } from "../../services/transcription.service.js";
import { VideoService } from "../../services/video.service.js";
import { printClipsTable, printStatsTable, startSpinner } from "../utils/ui.js";

export function registerAnalyzeCommand(program: Command): void {
    program
        .command("analyze <video>")
        .description(
            "Transcreve e pontua os melhores momentos do vídeo. Salva clips.json no diretório de saída.",
        )
        .option("--karaoke", "habilitar timestamps por palavra para karaoke")
        .option("--target <n>", "número de clips alvo", "3")
        .action(async (video: string, opts) => {
            const absolutePath = path.resolve(process.cwd(), video);
            const fileName = path.basename(absolutePath);
            if (!existsSync(absolutePath)) {
                logger.error(`❌ File not found: ${fileName}`);
                process.exit(1);
            }
            logger.info(`\n🎬 Processing: ${fileName}\n`);

            const startedAt = Date.now();

            const spin1 = startSpinner(chalk.cyan("🎧 Extracting audio..."));
            const transcriptionService = new TranscriptionService();
            let transcript;
            try {
                transcript = await transcriptionService.transcribe(
                    absolutePath,
                    opts.karaoke ?? false,
                );
                spin1.succeed(
                    chalk.green(
                        `🎙 Transcription done — ${transcript.length} segment(s)`,
                    ),
                );
            } catch (err) {
                spin1.fail(chalk.red("❌ Transcription failed"));
                logger.error({ err }, "analyze: transcription error");
                process.exit(1);
            }

            const videoService = new VideoService();
            const { duration } = await videoService.getMetadata(absolutePath);

            const openRouterKey = process.env.OPEN_ROUTE;
            let scoring;
            if (openRouterKey) {
                scoring = new OpenRouterScoringStrategy(openRouterKey);
            }

            const targetClips = parseInt(opts.target, 10);
            const detection = new DetectionService(scoring);

            const spin2 = startSpinner(
                chalk.magenta("🧠 Analyzing best moments with AI…"),
            );
            let clips;
            try {
                const result = await detection.detectClips(
                    transcript,
                    duration,
                    {
                        minDuration: 45,
                        maxDuration: 90,
                        targetClips,
                    },
                );
                clips = result.clips;
                spin2.succeed(
                    chalk.green(
                        `✅ ${chalk.bold(clips.length)} clip(s) detected`,
                    ),
                );
            } catch (err) {
                spin2.fail(chalk.red("❌ AI scoring failed"));
                logger.error({ err }, "analyze: detection error");
                process.exit(1);
            }

            const captionService = new CaptionService();
            const spin3 = startSpinner(
                chalk.magenta("✨ Generating viral captions with AI…"),
            );
            for (const clip of clips) {
                if (clip.transcript) {
                    clip.caption = await captionService
                        .generateCaption(clip.transcript)
                        .catch(() => undefined);
                }
            }
            spin3.succeed(chalk.green("✅ Captions generated"));

            const outputDir = path.join(
                OUTPUT_DIR,
                path.basename(absolutePath, path.extname(absolutePath)),
            );
            await mkdir(outputDir, { recursive: true });
            const clipsJsonPath = path.join(outputDir, "clips.json");
            await writeFile(
                clipsJsonPath,
                JSON.stringify(clips, null, 2),
                "utf-8",
            );

            const totalClipTime = clips.reduce(
                (s, c) => s + (c.endTime - c.startTime),
                0,
            );
            printStatsTable({
                videoDuration: duration,
                transcriptSegments: transcript.length,
                clipsDetected: clips.length,
                totalClipTime,
                outputDir,
                elapsedMs: Date.now() - startedAt,
            });
            printClipsTable(clips);

            logger.info(
                `  clips.json saved to: output/${path.basename(outputDir)}/clips.json`,
            );
        });
}
