import chalk from "chalk";
import type { Command } from "commander";
import "dotenv/config";
import { v4 as uuidv4 } from "uuid";
import { RabbitMQService } from "../../services/rabbitmq.service.js";
import { RedisService } from "../../services/redis.service.js";

export function registerEnqueueCommand(program: Command): void {
    program
        .command("enqueue <type> <inputPath>")
        .description(
            "Envia uma tarefa para a fila do RabbitMQ. Tipos suportados: 'download' ou 'cut'.",
        )
        .option("--no-karaoke", "desabilitar legendas animadas (para tipo 'cut')")
        .action(async (type: string, inputPath: string, opts) => {
            const rabbitUrl = process.env.RABBITMQ_URL || "amqp://localhost:5672";
            const queueName = process.env.QUEUE_NAME || "tikclipper_tasks";

            if (!["download", "cut", "render"].includes(type)) {
                console.error(chalk.red(`❌ Tipo de tarefa inválido: ${type}. Use 'download', 'cut' ou 'render'.`));
                process.exit(1);
            }

            const rabbitmq = new RabbitMQService(rabbitUrl);
            const redis = new RedisService();

            try {
                await rabbitmq.connect();

                const jobId = uuidv4();
                
                const message = {
                    id: jobId,
                    type,
                    url: inputPath, // fallback for download
                    inputPath,
                    karaoke: opts.karaoke ?? true,
                };

                // Save initial status to Redis
                await redis.setJobStatus(jobId, 'PENDING', { type, inputPath });

                await rabbitmq.publishToQueue(queueName, message);

                console.log(chalk.green(`✅ Tarefa '${type}' enfileirada com sucesso!`));
                console.log(chalk.cyan(`   Job ID: ${chalk.bold(jobId)}`));
                console.log(chalk.gray(`   Fila: ${queueName}`));
                console.log(chalk.gray(`   Input: ${inputPath}`));

            } catch (error) {
                console.error(chalk.red(`❌ Erro ao enfileirar a tarefa:`), error);
                process.exit(1);
            } finally {
                await rabbitmq.close();
                await redis.close();
                process.exit(0);
            }
        });
}
