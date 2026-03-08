import chalk from "chalk";
import cliProgress from "cli-progress";
import type { Command } from "commander";
import "dotenv/config";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import path from "path";
import { DEFAULT_EXPORT_CONFIG, OUTPUT_DIR } from "../../config/index.js";
import { ExportService } from "../../services/export.service.js";
import { logger } from "../../services/logger.service.js";
import { TranscriptionService } from "../../services/transcription.service.js";
import type {
    Clip,
    PipelineConfig,
    TranscriptSegment,
} from "../../types/index.js";
import { printClipsTable, startSpinner } from "../utils/ui.js";

export function registerRenderCommand(program: Command): void {
    program
        .command("render <video>")
        .description(
            "Exporta clips de um clips.json já existente — pula a análise IA.",
        )
        .option("--karaoke", "usar karaoke (timestamps por palavra) na legenda")
        .action(async (video: string, opts) => {
            const absolutePath = path.resolve(process.cwd(), video);
            if (!existsSync(absolutePath)) {
                logger.error(`Arquivo não encontrado: ${absolutePath}`);
                process.exit(1);
            }

            const outputDir = path.join(
                OUTPUT_DIR,
                path.basename(absolutePath, path.extname(absolutePath)),
            );
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
            const spin1 = startSpinner(
                "Retranscrevendo para obter dados de legenda…",
            );
            let transcript: TranscriptSegment[] = [];
            try {
                const transcriptionService = new TranscriptionService();
                transcript = await transcriptionService.transcribe(
                    absolutePath,
                    opts.karaoke ?? false,
                );
                spin1.succeed(
                    chalk.green(
                        `✔ Transcrição concluída — ${transcript.length} segmento(s)`,
                    ),
                );
            } catch {
                spin1.fail("Falha na transcrição — renderizando sem legendas");
            }

            const multiBar = new cliProgress.MultiBar(
                {
                    clearOnComplete: false,
                    hideCursor: true,
                    format:
                        chalk.cyan(" {bar}") +
                        " {percentage}%  " +
                        chalk.gray("{filename}"),
                },
                cliProgress.Presets.shades_classic,
            );

            const bars = clips.map((_, i) =>
                multiBar.create(100, 0, { filename: `clip_${i + 1}.mp4` }),
            );

            logger.info(
                `\nExportando ${clips.length} clip(s) de ${path.basename(absolutePath)}\n`,
            );

            const exportService = new ExportService();
            const config: PipelineConfig = {
                inputPath: absolutePath,
                outputDir,
                minClipDuration: 45,
                maxClipDuration: 90,
                targetClips: clips.length,
                exportConfig: DEFAULT_EXPORT_CONFIG,
            };

            let outputPaths: string[] = [];
            try {
                outputPaths = await exportService.exportClips(
                    absolutePath,
                    clips,
                    transcript,
                    config,
                    (clipIndex, percent) => {
                        bars[clipIndex]?.update(Math.round(percent));
                    },
                );
            } catch (err) {
                multiBar.stop();
                logger.error(
                    `\nErro na exportação: ${err instanceof Error ? err.message : err}`,
                );
                process.exit(1);
            }

            multiBar.stop();
            printClipsTable(clips);

            logger.info(`\n✔ ${outputPaths.length} clip(s) exportado(s):`);
            outputPaths.forEach((p) => logger.info(`  • ${p}`));
        });
}
