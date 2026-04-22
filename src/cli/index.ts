#!/usr/bin/env node
if (process.argv.includes("--debug")) {
    process.env.LOG_LEVEL = "debug";
}

import chalk from "chalk";
import { Command } from "commander";
import "dotenv/config";
import { registerAnalyzeCommand } from "./commands/analyze.command.js";
import { registerCutCommand } from "./commands/cut.command.js";
import { registerRenderCommand } from "./commands/render.command.js";
import { registerStatsCommand } from "./commands/stats.command.js";
import { registerDownloadCommand } from "./commands/download.command.js";
import { printBanner } from "./utils/ui.js";

function handleExit(signal: "SIGINT" | "SIGTERM"): void {
    process.stdout.write("\x1B[?25h");
    process.stdout.write("\n");
    console.log(chalk.yellow("  ⚠  Interrompido"));
    process.exit(signal === "SIGINT" ? 130 : 143);
}

process.on("SIGINT", () => handleExit("SIGINT"));
process.on("SIGTERM", () => handleExit("SIGTERM"));

printBanner();

const program = new Command();

program
    .name("tikclipper")
    .description(
        "Cortes automáticos de vídeos longos para TikTok, Shorts e Reels",
    )
    .version("1.0.0");

registerAnalyzeCommand(program);
registerCutCommand(program);
registerRenderCommand(program);
registerStatsCommand(program);
registerDownloadCommand(program);

program.parse(process.argv);
