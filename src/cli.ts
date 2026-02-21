#!/usr/bin/env node
import chalk from "chalk";
import "dotenv/config";
import { existsSync } from "fs";
import path from "path";
import { Pipeline } from "./pipeline/index.js";
import { logger } from "./services/logger.service.js";

const args = process.argv.slice(2);
const isKaraoke = args.includes("--karaoke");
const inputPath = args.find((arg) => arg !== "--karaoke");

if (!inputPath) {
    console.log(
        chalk.red("Uso: npm run cli -- <caminho-do-video> [--karaoke]"),
    );
    console.log(
        chalk.gray("Exemplo: npm run cli -- ./meu-podcast.mp4 --karaoke"),
    );
    process.exit(1);
}

const absolutePath = path.resolve(process.cwd(), inputPath);

if (!existsSync(absolutePath)) {
    console.error(chalk.red(`Arquivo não encontrado: ${absolutePath}`));
    process.exit(1);
}

async function main() {
    console.log(chalk.cyan("TikClipper"));
    if (isKaraoke) console.log(chalk.yellow("🎤 Modo Karaoke habilitado"));
    console.log(chalk.gray(`Processando: ${absolutePath}\n`));

    const pipeline = new Pipeline();

    try {
        const outputPaths = await pipeline.run(absolutePath, {
            karaoke: isKaraoke,
        });
        console.log(
            chalk.green(
                `\nConcluído! ${outputPaths.length} clip(s) exportado(s):`,
            ),
        );
        outputPaths.forEach((p) => console.log(chalk.gray(`  • ${p}`)));
    } catch (err) {
        logger.error({ err }, "Erro fatal no pipeline:");
        console.error(
            chalk.red("\nErro:"),
            err instanceof Error ? err.message : err,
        );
        process.exit(1);
    }
}

main();
