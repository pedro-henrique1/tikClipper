import { Command } from "commander";
import path from "path";
import chalk from "chalk";
import ora from "ora";
import { DownloadService } from "../../services/download.service.js";

export function registerDownloadCommand(program: Command) {
    program
        .command("download <url>")
        .description("Baixa um vídeo de qualquer plataforma (YouTube, TikTok, etc) para a pasta videos")
        .action(async (url: string) => {
            const spinner = ora("Preparando download...").start();
            try {
                const videosDir = process.env.VIDEOS_DIR;
                const downloadService = new DownloadService();

                spinner.text = `Baixando vídeo (isso pode demorar dependendo do tamanho)...`;

                await downloadService.downloadVideo(url, videosDir!);

                spinner.succeed(chalk.green(`Sucesso! O vídeo foi salvo na pasta: ${videosDir}`));
            } catch (error: any) {
                spinner.fail(chalk.red(`Erro ao baixar o vídeo!`));
                console.error(chalk.red(error.message || error));
                process.exit(1);
            }
        });
}
