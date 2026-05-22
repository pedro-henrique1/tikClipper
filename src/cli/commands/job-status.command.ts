import chalk from "chalk";
import type { Command } from "commander";
import "dotenv/config";
import { RedisService } from "../../services/redis.service.js";

export function registerJobStatusCommand(program: Command): void {
    program
        .command("job-status <jobId>")
        .description(
            "Consulta o status de uma tarefa específica no Redis usando o Job ID.",
        )
        .action(async (jobId: string) => {
            const redis = new RedisService();

            try {
                const status = await redis.getJobStatus(jobId);

                if (!status) {
                    console.log(chalk.yellow(`⚠️ Nenhuma tarefa encontrada com o Job ID: ${jobId}`));
                    return;
                }

                console.log(chalk.cyan(`\n📊 Status do Job: ${chalk.bold(jobId)}`));
                
                let statusColor = chalk.white;
                switch (status.status) {
                    case 'PENDING': statusColor = chalk.yellow; break;
                    case 'PROCESSING': statusColor = chalk.blue; break;
                    case 'COMPLETED': statusColor = chalk.green; break;
                    case 'FAILED': statusColor = chalk.red; break;
                }

                console.log(`   Status: ${statusColor(chalk.bold(status.status))}`);
                console.log(`   Atualizado em: ${chalk.gray(new Date(status.updatedAt).toLocaleString())}`);
                
                if (status.type) console.log(`   Tipo: ${chalk.gray(status.type)}`);
                if (status.inputPath) console.log(`   Input: ${chalk.gray(status.inputPath)}`);
                
                if (status.error) {
                    console.log(`   Erro: ${chalk.red(status.error)}`);
                }
                
                console.log('');

            } catch (error) {
                console.error(chalk.red(`❌ Erro ao consultar o status:`), error);
            } finally {
                await redis.close();
                process.exit(0);
            }
        });
}
