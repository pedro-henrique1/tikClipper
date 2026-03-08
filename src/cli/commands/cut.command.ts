import chalk from "chalk";
import cliProgress from "cli-progress";
import type { Command } from "commander";
import "dotenv/config";
import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import {
    DEFAULT_CLIP_CONFIG,
    DEFAULT_EXPORT_CONFIG,
    OUTPUT_DIR,
} from "../../config/index.js";
import { CaptionService } from "../../services/caption.service.js";
import { DetectionService } from "../../services/detection.service.js";
import { ExportService } from "../../services/export.service.js";
import { logger } from "../../services/logger.service.js";
import { OpenRouterScoringStrategy } from "../../services/openRouterScoringStrategy.service.js";
import { TranscriptionService } from "../../services/transcription.service.js";
import { UploadService } from "../../services/upload.service.js";
import { VideoService } from "../../services/video.service.js";
import { printClipsTable, printStatsTable, startSpinner } from "../utils/ui.js";

export function registerCutCommand(program: Command): void {
    program
        .command("cut <video>")
        .description(
            "Pipeline completo: transcrever → analisar → exportar clips.",
        )
        .option("--karaoke", "habilitar karaoke (timestamps por palavra)")
        .option(
            "--upload",
            "fazer upload automático para o TikTok após exportar",
        )
        .option("--cookies <path>", "caminho para o arquivo cookies.json")
        .option("--caption <text>", "legenda para o upload")
        .option("--debug", "exibir logs internos detalhados")
        .option("--quiet", "suprimir output; exibir apenas resultado final")
        .action(async (video: string, opts) => {
            const debug: boolean = opts.debug ?? false;
            const quiet: boolean = opts.quiet ?? false;

            const print = (...args: string[]) => {
                if (!quiet) logger.info(args.join(" "));
            };

            const inputPath = path.resolve(process.cwd(), video);
            const fileName = path.basename(inputPath);

            if (!existsSync(inputPath)) {
                logger.error(`❌ File not found: ${fileName}`);
                if (debug) logger.debug(`   Path: ${inputPath}`);
                process.exit(1);
            }

            if (opts.upload && !opts.cookies) {
                logger.error("--upload requires --cookies <path>");
                process.exit(1);
            }

            print(chalk.cyan(`\n🎬 Processing: ${chalk.bold(fileName)}\n`));
            if (debug) logger.debug(`[CLI] Full input path: ${inputPath}`);

            const startedAt = Date.now();

            const videoService = new VideoService();
            const { duration } = await videoService.getMetadata(inputPath);

            print(chalk.cyan("🎧 Extracting audio..."));

            const transcriptionBar = new cliProgress.SingleBar(
                {
                    clearOnComplete: true,
                    hideCursor: true,
                    format:
                        "  " +
                        chalk.cyan("Transcribing") +
                        " " +
                        chalk.cyan("{bar}") +
                        " {percentage}%" +
                        chalk.gray(" | ETA: {eta_formatted}"),
                    barCompleteChar: "▓",
                    barIncompleteChar: "░",
                    barsize: 30,
                    etaBuffer: 10,
                },
                cliProgress.Presets.shades_classic,
            );

            let barStarted = false;

            const transcriptionService = new TranscriptionService();
            let transcript;
            try {
                transcript = await transcriptionService.transcribe(
                    inputPath,
                    opts.karaoke ?? false,
                    (current) => {
                        if (quiet) return;
                        if (!barStarted) {
                            process.stdout.write("\n");
                            transcriptionBar.start(Math.ceil(duration), 0);
                            barStarted = true;
                        }
                        transcriptionBar.update(
                            Math.min(Math.ceil(current), Math.ceil(duration)),
                        );
                    },
                );
                if (barStarted) {
                    transcriptionBar.update(Math.ceil(duration));
                    transcriptionBar.stop();
                }
                print(
                    chalk.green(
                        `🎙 Transcription done — ${chalk.bold(transcript.length)} segment(s)\n`,
                    ),
                );
            } catch (err) {
                if (barStarted) transcriptionBar.stop();
                logger.error("\n❌ Transcription failed");
                logger.error({ err }, "cut: transcription error");
                process.exit(1);
            }

            const openRouterKey = process.env.OPEN_ROUTE;
            const scoring = openRouterKey
                ? new OpenRouterScoringStrategy(openRouterKey)
                : undefined;
            const detection = new DetectionService(scoring);

            const spin2 = quiet
                ? null
                : startSpinner(
                      chalk.magenta("🧠 Analyzing best moments with AI…"),
                  );
            let clips;
            let detectionMeta;
            try {
                const result = await detection.detectClips(
                    transcript,
                    duration,
                    {
                        minDuration: DEFAULT_CLIP_CONFIG.minDuration,
                        maxDuration: DEFAULT_CLIP_CONFIG.maxDuration,
                        targetClips: DEFAULT_CLIP_CONFIG.targetClips,
                    },
                );
                logger.debug(result);
                clips = result.clips;
                detectionMeta = result.meta;

                if (clips.length === 0) {
                    spin2?.fail(
                        chalk.red("No clips detected — check the video"),
                    );
                    if (!spin2) logger.error("❌ No clips detected");
                    process.exit(1);
                }

                spin2?.succeed(
                    chalk.green(
                        `✅ ${chalk.bold(clips.length)} clip(s) detected`,
                    ),
                );
            } catch (err) {
                const is401 =
                    typeof err === "object" &&
                    err !== null &&
                    "status" in err &&
                    (err as { status: number }).status === 401;

                if (is401) {
                    spin2?.fail(chalk.red("OpenRouter API key invalid (401)"));
                    logger.warn("\n  Check OPEN_ROUTE in your .env");
                    logger.warn(
                        "  Get your key at → https://openrouter.ai/settings/keys",
                    );
                } else {
                    spin2?.fail(chalk.red("AI scoring failed"));
                    logger.error({ err }, "cut: detection error");
                }
                process.exit(1);
            }

            const spin3 = quiet
                ? null
                : startSpinner(
                      chalk.magenta("✨ Generating viral captions with AI…"),
                  );
            const captionService = new CaptionService();
            for (const clip of clips) {
                if (clip.transcript) {
                    clip.caption = await captionService
                        .generateCaption(clip.transcript)
                        .catch(() => undefined);
                }
            }
            spin3?.succeed(chalk.green("✅ Captions generated"));

            const outputDir = path.join(
                OUTPUT_DIR,
                path.basename(inputPath, path.extname(inputPath)),
            );
            await mkdir(outputDir, { recursive: true });
            const clipsJsonPath = path.join(outputDir, "clips.json");
            await writeFile(
                clipsJsonPath,
                JSON.stringify(clips, null, 2),
                "utf-8",
            );

            print(chalk.cyan(`\n✂  Exporting ${clips.length} clip(s)...\n`));

            const totalTicks = clips.length * 100;
            const singleBar = new cliProgress.SingleBar(
                {
                    clearOnComplete: false,
                    hideCursor: true,
                    format:
                        "  " +
                        chalk.cyan("Exporting") +
                        "  " +
                        chalk.cyan("{bar}") +
                        " {percentage}%" +
                        chalk.gray(" | clip {current}/{total_clips}"),
                    barCompleteChar: "▓",
                    barIncompleteChar: "░",
                    barsize: 30,
                },
                cliProgress.Presets.shades_classic,
            );

            const clipProgress = new Array(clips.length).fill(0);
            if (!quiet) {
                singleBar.start(totalTicks, 0, {
                    total_clips: clips.length,
                    current: 1,
                });
            }

            const exportService = new ExportService();
            let outputPaths: string[] = [];

            try {
                outputPaths = await exportService.exportClips(
                    inputPath,
                    clips,
                    transcript,
                    {
                        inputPath,
                        outputDir,
                        minClipDuration: DEFAULT_CLIP_CONFIG.minDuration,
                        maxClipDuration: DEFAULT_CLIP_CONFIG.maxDuration,
                        targetClips: DEFAULT_CLIP_CONFIG.targetClips,
                        exportConfig: DEFAULT_EXPORT_CONFIG,
                    },
                    (clipIndex, percent) => {
                        if (quiet) return;
                        clipProgress[clipIndex] = percent;
                        const accumulated = clipProgress.reduce(
                            (s, p) => s + p,
                            0,
                        );
                        singleBar.update(Math.round(accumulated), {
                            current: clipIndex + 1,
                        });
                    },
                );

                if (!quiet) {
                    singleBar.update(totalTicks, { current: clips.length });
                }
            } catch (err) {
                if (!quiet) singleBar.stop();
                logger.error(
                    `\n❌ Export error: ${err instanceof Error ? err.message : err}`,
                );
                process.exit(1);
            }

            if (!quiet) singleBar.stop();
            logger.info("");

            if (opts.upload && opts.cookies) {
                const uploadService = new UploadService();
                const cookiesPath = path.resolve(
                    process.cwd(),
                    opts.cookies as string,
                );

                for (const clipPath of outputPaths) {
                    const spin = quiet
                        ? null
                        : startSpinner(
                              chalk.cyan(
                                  `📤 Uploading ${path.basename(clipPath)}…`,
                              ),
                          );
                    try {
                        const clipIdx = outputPaths.indexOf(clipPath);
                        await uploadService.uploadToTikTok(
                            clipPath,
                            cookiesPath,
                            (opts.caption as string | undefined) ??
                                clips[clipIdx]?.caption,
                        );
                        spin?.succeed(
                            chalk.green(
                                `✅ Uploaded: ${path.basename(clipPath)}`,
                            ),
                        );
                    } catch (err) {
                        spin?.fail(
                            chalk.red(
                                `❌ Upload failed: ${path.basename(clipPath)}`,
                            ),
                        );
                        logger.warn({ err }, "cut: upload error");
                    }
                }
            }

            const elapsedMs = Date.now() - startedAt;
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
                elapsedMs,
                windowsAnalyzed: detectionMeta?.windowsAnalyzed,
                tokensUsed: detectionMeta?.tokensUsed,
                tokensSaved: detectionMeta?.tokensSaved,
                earlyStop: detectionMeta?.earlyStop,
            });

            printClipsTable(clips);

            logger.info(
                chalk.green(`\n✅ ${outputPaths.length} clip(s) exported:`),
            );
            outputPaths.forEach((p) =>
                logger.info(chalk.gray(`  • ${path.basename(p)}`)),
            );

            const totalSec = (elapsedMs / 1000).toFixed(1);
            logger.info(chalk.green(`\n⏱  Total time: ${totalSec}s\n`));
        });
}
