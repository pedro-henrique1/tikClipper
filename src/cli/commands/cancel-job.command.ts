import chalk from "chalk";
import type { Command } from "commander";
import "dotenv/config";
import { RedisService } from "../../services/redis.service.js";

export function registerCancelJobCommand(program: Command): void {
    program
        .command("cancel-job <jobId>")
        .description(
            "Cancela uma tarefa ativa ou pendente usando o Job ID (ou ID curto).",
        )
        .action(async (jobId: string) => {
            const redis = new RedisService();

            try {
                const job = await redis.getJobStatus(jobId);

                if (!job) {
                    console.log(chalk.yellow(`⚠️ Nenhuma tarefa encontrada com o Job ID: ${jobId}`));
                    return;
                }

                if (job.status === 'COMPLETED' || (job.status === 'FAILED' && job.error === 'Cancelado pelo usuário')) {
                    console.log(chalk.yellow(`⚠️ A tarefa já está finalizada ou cancelada (Status: ${job.status}).`));
                    return;
                }

                // Salva o status de FAILED com erro de cancelamento no Redis
                await redis.setJobStatus(job.id, 'FAILED', {
                    error: 'Cancelado pelo usuário',
                    completedAt: Date.now()
                });

                console.log(chalk.green(`✅ Solicitado cancelamento da tarefa ${chalk.bold(job.id)}.`));
                console.log(chalk.gray(`   Status atualizado para FAILED (Cancelado pelo usuário).`));
                console.log(chalk.gray(`   O worker ativo será interrompido na próxima atualização de progresso.`));

            } catch (error) {
                console.error(chalk.red(`❌ Erro ao cancelar a tarefa:`), error);
            } finally {
                await redis.close();
                process.exit(0);
            }
        });
}
