import chalk from "chalk";
import type { Command } from "commander";
import "dotenv/config";
import boxen from "boxen";
import logUpdate from "log-update";
import { RabbitMQService } from "../../services/rabbitmq.service.js";
import { RedisService } from "../../services/redis.service.js";

function formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
}

function renderProgressBar(current: number, total: number, width: number = 20): string {
    if (total === 0) return chalk.gray('Nenhum job na fila');
    const percentage = Math.min(Math.max(current / total, 0), 1);
    const filledLength = Math.round(width * percentage);
    const emptyLength = width - filledLength;
    const filledStr = '█'.repeat(filledLength);
    const emptyStr = '░'.repeat(emptyLength);
    return `${chalk.cyan(filledStr)}${chalk.gray(emptyStr)} ${current}/${total}`;
}

export function registerQueueStatusCommand(program: Command): void {
    program
        .command("queue-status")
        .description(
            "Monitora o status da fila do RabbitMQ e do Redis em tempo real com métricas avançadas.",
        )
        .action(async () => {
            const rabbitUrl = process.env.RABBITMQ_URL || "amqp://localhost:5672";
            const queueName = process.env.QUEUE_NAME || "tikclipper_tasks";

            console.log(chalk.cyan(`Conectando...`));
            const rabbitmq = new RabbitMQService(rabbitUrl);
            const redis = new RedisService();

            try {
                await rabbitmq.connect();

                const checkStatus = async () => {
                    try {
                        const status = await rabbitmq.getQueueStatus(queueName);
                        const jobs = await redis.getAllJobs();

                        // 1. Auto-cleanup para tarefas travadas/antigas
                        for (const job of jobs) {
                            let isStale = false;
                            let staleReason = '';

                            if (job.status === 'PENDING') {
                                // Se pendente há mais de 5 minutos e RabbitMQ sem mensagens na fila
                                const isOldPending = (Date.now() - (job.updatedAt || job.createdAt || 0)) > 5 * 60 * 1000;
                                if (isOldPending && status.messageCount === 0) {
                                    isStale = true;
                                    staleReason = 'Tarefa expirada: não encontrada na fila do RabbitMQ';
                                }
                            } else if (job.status === 'PROCESSING') {
                                // Se processando há mais de 30 minutos sem nenhuma atualização
                                const isOldProcessing = (Date.now() - (job.updatedAt || 0)) > 30 * 60 * 1000;
                                if (isOldProcessing) {
                                    isStale = true;
                                    staleReason = 'Tarefa expirada: sem resposta do worker por mais de 30 minutos';
                                }
                            }

                            if (isStale) {
                                job.status = 'FAILED';
                                job.error = staleReason;
                                job.completedAt = Date.now();
                                job.updatedAt = Date.now();
                                redis.setJobStatus(job.id, 'FAILED', {
                                    error: staleReason,
                                    completedAt: Date.now()
                                }).catch(() => {});
                            }
                        }

                        // 2. Filtra os jobs para exibir apenas os ativos ou os finalizados recentemente (últimas 12 horas)
                        const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000;
                        const activeJobs = jobs.filter(job => {
                            if (job.status === 'PENDING' || job.status === 'PROCESSING') {
                                return true; // Sempre exibe tarefas ativas
                            }
                            const lastActive = Math.max(job.createdAt || 0, job.updatedAt || 0, job.completedAt || 0);
                            return lastActive > twelveHoursAgo;
                        });

                        let pending = 0, processing = 0, completed = 0, failed = 0;
                        let totalProcessingTime = 0;

                        const processingJobs: any[] = [];
                        const lastJobs: any[] = []; // Last 5 completed or failed jobs

                        activeJobs.forEach((job: any) => {
                            if (job.status === 'PENDING') pending++;
                            else if (job.status === 'PROCESSING') {
                                processing++;
                                processingJobs.push(job);
                            }
                            else if (job.status === 'COMPLETED') {
                                completed++;
                                if (job.startedAt && job.completedAt) {
                                    totalProcessingTime += (job.completedAt - job.startedAt);
                                }
                                if (lastJobs.length < 5) lastJobs.push(job);
                            }
                            else if (job.status === 'FAILED') {
                                failed++;
                                if (lastJobs.length < 5) lastJobs.push(job);
                            }
                        });

                        const totalFinished = completed + failed;
                        const totalJobs = pending + processing + completed + failed;

                        const avgTime = completed > 0 ? totalProcessingTime / completed : 0;
                        const successRate = totalFinished > 0 ? (completed / totalFinished) * 100 : 0;

                        const msgColor = status.messageCount > 0 ? chalk.yellow : chalk.green;
                        const workerColor = status.consumerCount > 0 ? chalk.green : chalk.red;

                        // Seções do Dashboard
                        const globaisSection = [
                            chalk.bold.magenta('📊 Métricas Globais'),
                            `Tempo médio:     ${chalk.cyan(avgTime > 0 ? formatDuration(avgTime) : 'N/A')}`,
                            `Taxa de sucesso: ${successRate === 100 ? chalk.green('100%') : chalk.yellow(successRate.toFixed(1) + '%')}`,
                            `Total de Jobs:   ${chalk.white(totalJobs)}`
                        ].join('\n');

                        const filaSection = [
                            chalk.bold.magenta(`🔄 Fila (${queueName})`),
                            renderProgressBar(totalFinished, totalJobs),
                            `Aguardando (RabbitMQ): ${msgColor(status.messageCount)}`,
                            `Workers ativos:        ${workerColor(status.consumerCount)}`
                        ].join('\n');

                        const emProcessamentoStr = processingJobs.map(job => {
                            const currentDuration = job.startedAt ? (Date.now() - job.startedAt) : 0;
                            const urlStr = job.inputPath || job.url || 'Desconhecido';

                            const isLocal = urlStr.startsWith('./') || urlStr.startsWith('/');
                            const displayPath = isLocal ? urlStr.split('/').pop() || urlStr : urlStr;
                            const shortPath = displayPath.length > 25 ? displayPath.substring(0, 22) + '...' : displayPath.padEnd(25);
                            const shortId = job.id ? job.id.split('-')[0] : 'N/A';

                            return ` ID: ${chalk.gray(shortId)} | ${chalk.cyan(shortPath)} | ⏱️  ${chalk.yellow(formatDuration(currentDuration))}`;
                        }).join('\n');

                        const processamentoSection = [
                            chalk.bold.blue('⚙️  Em Processamento Agora'),
                            processingJobs.length > 0 ? emProcessamentoStr : chalk.gray(' Nenhum job sendo processado no momento.')
                        ].join('\n');

                        // Ordena últimos jobs (mais recentes primeiro)
                        lastJobs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
                        const ultimosJobsLimitados = lastJobs.slice(0, 5);

                        const ultimosJobsStr = ultimosJobsLimitados.map(job => {
                            const isSuccess = job.status === 'COMPLETED';
                            const icon = isSuccess ? chalk.green('[✅]') : chalk.red('[❌]');
                            const duration = (job.startedAt && job.completedAt) ? formatDuration(job.completedAt - job.startedAt) : 'N/A';
                            const timeStr = job.updatedAt ? new Date(job.updatedAt).toLocaleTimeString() : '';
                            const shortId = job.id ? job.id.split('-')[0] : 'N/A';
                            return ` ${icon} ${chalk.gray(shortId)} - ${chalk.cyan(duration)} ${chalk.gray(`(${timeStr})`)}`;
                        }).join('\n');

                        const ultimosSection = [
                            chalk.bold.green('📋 Últimos Jobs'),
                            ultimosJobsLimitados.length > 0 ? ultimosJobsStr : chalk.gray(' Nenhum job finalizado ainda.')
                        ].join('\n');

                        const content = [
                            globaisSection,
                            '',
                            filaSection,
                            '',
                            processamentoSection,
                            '',
                            ultimosSection,
                            '',
                            chalk.gray('Pressione Ctrl+C para sair')
                        ].join('\n');

                        const box = boxen(content, {
                            padding: 1,
                            margin: 1,
                            borderStyle: 'round',
                            borderColor: 'cyan',
                            title: chalk.cyan.bold(' 🚀 Pipeline Status '),
                            titleAlignment: 'center'
                        });

                        logUpdate(box);

                    } catch (error) {
                        logUpdate(chalk.red(`❌ Erro ao obter status da fila. Tentando novamente...`));
                    }
                };

                await checkStatus();

                const intervalId = setInterval(checkStatus, 1000);

                process.on('SIGINT', async () => {
                    clearInterval(intervalId);
                    logUpdate.clear();
                    console.log(chalk.yellow(`\nParando monitoramento...`));
                    await rabbitmq.close();
                    await redis.close();
                    process.exit(0);
                });

            } catch (error) {
                console.error(chalk.red(`❌ Erro ao conectar:`), error);
                process.exit(1);
            }
        });
}
