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
import {
    printClipsTable,
    printStatsTable,
    printStep,
    startSpinner,
} from "../utils/ui.js";

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

            // Force log level — never let .env LOG_LEVEL pollute normal CLI output
            logger.level = debug ? "debug" : "info";

            const print = (...args: string[]) => {
                if (!quiet) console.log(args.join(" "));
            };

            const inputPath = path.resolve(process.cwd(), video);
            const fileName = path.basename(inputPath);

            if (!existsSync(inputPath)) {
                console.error(chalk.red(`❌ File not found: ${fileName}`));
                if (debug) console.error(chalk.gray(`   Path: ${inputPath}`));
                process.exit(1);
            }

            if (opts.upload && !opts.cookies) {
                console.error(chalk.red("--upload requires --cookies <path>"));
                process.exit(1);
            }

            const shortName =
                fileName.length > 50 ? fileName.slice(0, 47) + "..." : fileName;
            if (!quiet)
                console.log(
                    `\n  ${chalk.dim("\u25b6")}  ${chalk.bold.white(shortName)}\n`,
                );
            if (debug) logger.debug(`[CLI] Full input path: ${inputPath}`);

            const startedAt = Date.now();

            const videoService = new VideoService();
            const { duration } = await videoService.getMetadata(inputPath);

            if (!quiet) printStep(1, 4, "Transcribing audio");

            const transcriptionBar = new cliProgress.SingleBar(
                {
                    clearOnComplete: true,
                    hideCursor: true,
                    format: (options, params, payload) => {
                        const m = Math.floor(params.value / 60);
                        const s = Math.floor(params.value % 60);
                        const tm = Math.floor(params.total / 60);
                        const ts = Math.floor(params.total % 60);

                        const val = `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
                        const tot = `${tm.toString().padStart(2, "0")}:${ts.toString().padStart(2, "0")}`;

                        const bar =
                            options.barCompleteChar!.repeat(
                                Math.round(params.progress * options.barsize!),
                            ) +
                            options.barIncompleteChar!.repeat(
                                options.barsize! -
                                    Math.round(
                                        params.progress * options.barsize!,
                                    ),
                            );

                        return `  ${chalk.cyan(bar)}  ${chalk.bold.white(Math.round(params.progress * 100) + "%")}  ${chalk.gray(val + " / " + tot)}`;
                    },
                    barCompleteChar: "\u2588",
                    barIncompleteChar: "\u2591",
                    barsize: 28,
                    forceRedraw: true,
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
                console.error(
                    chalk.red("\n❌ Transcription failed:"),
                    err instanceof Error ? err.message : err,
                );
                logger.debug({ err }, "cut: transcription error");
                process.exit(1);
            }

            const openRouterKey = process.env.OPEN_ROUTE;
            const scoring = openRouterKey
                ? new OpenRouterScoringStrategy(openRouterKey)
                : undefined;
            const detection = new DetectionService(scoring);

            if (!quiet) printStep(2, 4, "Analyzing best moments with AI");

            const spin2 = quiet
                ? null
                : startSpinner(chalk.cyan("  Sending to AI model..."));
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
                clips = result.clips;
                detectionMeta = result.meta;

                if (clips.length === 0) {
                    spin2?.fail(
                        chalk.red("  No viral moments found in this video"),
                    );
                    if (!spin2)
                        console.error(chalk.red("\u274c No clips detected"));
                    process.exit(1);
                }

                spin2?.succeed(
                    chalk.green(
                        `  Found ${chalk.bold(clips.length)} viral clip(s)`,
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
                    console.log(
                        chalk.yellow("\n  Check OPEN_ROUTE in your .env"),
                    );
                    console.log(
                        chalk.gray(
                            "  Get your key at → https://openrouter.ai/settings/keys",
                        ),
                    );
                } else {
                    spin2?.fail(chalk.red("AI scoring failed"));
                    if (debug) console.error(err);
                }
                process.exit(1);
            }

            if (!quiet) printStep(3, 4, "Generating captions");

            const spin3 = quiet
                ? null
                : startSpinner(
                      chalk.cyan("  Crafting viral titles with AI..."),
                  );
            const captionService = new CaptionService();
            for (const clip of clips) {
                if (clip.transcript) {
                    clip.caption = await captionService
                        .generateCaption(clip.transcript)
                        .catch(() => undefined);
                }
            }
            spin3?.succeed(chalk.green("  Captions ready"));

            const rawVideoName = path.basename(
                inputPath,
                path.extname(inputPath),
            );
            const safeVideoName =
                rawVideoName.length > 40
                    ? rawVideoName.slice(0, 40)
                    : rawVideoName;
            const outputDir = path.resolve(OUTPUT_DIR, safeVideoName);
            await mkdir(outputDir, { recursive: true });
            const clipsJsonPath = path.join(outputDir, "clips.json");
            await writeFile(
                clipsJsonPath,
                JSON.stringify(clips, null, 2),
                "utf-8",
            );

            if (!quiet) printStep(4, 4, `Exporting ${clips.length} clip(s)`);

            const totalTicks = clips.length * 100;
            const singleBar = new cliProgress.SingleBar(
                {
                    clearOnComplete: false,
                    hideCursor: true,
                    format:
                        "  " +
                        chalk.cyan("{bar}") +
                        "  " +
                        chalk.bold.white("{percentage}%") +
                        chalk.gray("  clip ") +
                        chalk.white("{current}") +
                        chalk.gray("/{total_clips}"),
                    barCompleteChar: "\u2588",
                    barIncompleteChar: "\u2591",
                    barsize: 28,
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
                console.error(
                    chalk.red(
                        `\n❌ Export error: ${err instanceof Error ? err.message : err}`,
                    ),
                );
                process.exit(1);
            }

            if (!quiet) singleBar.stop();
            console.log("");

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
                        if (debug) console.error(err);
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

            if (!quiet) {
                console.log(
                    chalk.green(`\n✅ ${outputPaths.length} clip(s) exported:`),
                );
                outputPaths.forEach((p) =>
                    console.log(chalk.gray(`  • ${path.basename(p)}`)),
                );
                const totalSec = (elapsedMs / 1000).toFixed(1);
                console.log(chalk.green(`\n⏱  Total time: ${totalSec}s\n`));
            }
        });
}
