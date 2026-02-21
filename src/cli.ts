#!/usr/bin/env node
import "dotenv/config";
import { existsSync } from "fs";
import path from 'path';
import chalk from 'chalk';
import { Pipeline } from './pipeline/index.js';

const inputPath = process.argv[2];

if (!inputPath) {
  console.log(chalk.red('Uso: npm run cli -- <caminho-do-video>'));
  console.log(chalk.gray('Exemplo: npm run cli -- ./meu-podcast.mp4'));
  process.exit(1);
}

const absolutePath = path.resolve(process.cwd(), inputPath);

if (!existsSync(absolutePath)) {
  console.error(chalk.red(`Arquivo não encontrado: ${absolutePath}`));
  process.exit(1);
}

async function main() {
  console.log(chalk.cyan('TikClipper'));
  console.log(chalk.gray(`Processando: ${absolutePath}\n`));

  const pipeline = new Pipeline();

  try {
    const outputPaths = await pipeline.run(absolutePath);
    console.log(chalk.green(`\nConcluído! ${outputPaths.length} clip(s) exportado(s):`));
    outputPaths.forEach((p) => console.log(chalk.gray(`  • ${p}`)));
  } catch (err) {
    console.error(chalk.red('Erro:'), err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
