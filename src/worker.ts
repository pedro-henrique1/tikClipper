import 'dotenv/config';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';
import { RabbitMQService } from './services/rabbitmq.service.js';
import { RedisService } from './services/redis.service.js';
import { logger } from './services/logger.service.js';
import { DownloadService } from './services/download.service.js';
import { Pipeline } from './pipeline/index.js';
import { OUTPUT_DIR } from './config/index.js';
import type { Clip } from './types/index.js';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const QUEUE_NAME = process.env.QUEUE_NAME || 'tikclipper_tasks';

async function bootstrap() {
    logger.info('Starting Worker...');

    const rabbitmq = new RabbitMQService(RABBITMQ_URL);
    const redis = new RedisService();
    const downloadService = new DownloadService();
    const pipeline = new Pipeline();

    try {
        await rabbitmq.connect();

        logger.info(`Worker connected to RabbitMQ. Listening on queue: ${QUEUE_NAME}`);

        await rabbitmq.consume(QUEUE_NAME, async (msg) => {
            logger.info({ msg }, 'Received message from queue');

            if (msg.id) {
                const currentJob = await redis.getJobStatus(msg.id);
                if (currentJob && currentJob.status === 'FAILED' && currentJob.error === 'Cancelado pelo usuário') {
                    logger.info(`Job ${msg.id} foi cancelado pelo usuário. Descartando mensagem.`);
                    return; 
                }
            }

            const updateStatus = async (
                status: 'PROCESSING' | 'COMPLETED' | 'FAILED',
                fields?: Record<string, any>
            ) => {
                if (msg.id) {
                    try {
                        const currentJob = await redis.getJobStatus(msg.id);
                        if (currentJob && currentJob.status === 'FAILED' && currentJob.error === 'Cancelado pelo usuário') {
                            logger.warn(`Job ${msg.id} foi cancelado pelo usuário. Encerrando worker para abortar o processo.`);
                            process.exit(1);
                        }
                        await redis.setJobStatus(msg.id, status, fields);
                    } catch (err) {
                        logger.error({ err }, 'Error updating progress in Redis');
                    }
                }
            };

            let cancellationCheckInterval: NodeJS.Timeout | null = null;
            if (msg.id) {
                cancellationCheckInterval = setInterval(async () => {
                    try {
                        const currentJob = await redis.getJobStatus(msg.id);
                        if (currentJob && currentJob.status === 'FAILED' && currentJob.error === 'Cancelado pelo usuário') {
                            logger.warn(`Job ${msg.id} foi cancelado pelo usuário. Encerrando worker para abortar o processo.`);
                            if (cancellationCheckInterval) clearInterval(cancellationCheckInterval);
                            process.exit(1);
                        }
                    } catch (err) {
                        logger.error({ err }, 'Erro ao verificar cancelamento do job periodicamente');
                    }
                }, 5000);
            }

            await updateStatus('PROCESSING', { startedAt: Date.now() });

            try {
                switch (msg.type) {
                    case 'download':
                        logger.info(`Iniciando download da URL: ${msg.url}`);
                        await downloadService.downloadVideo(msg.url, process.env.VIDEOS_DIR || './videos');
                        logger.info('Download finalizado com sucesso!');
                        break;
                    case 'cut': {
                        const inputPath = msg.inputPath || msg.url;
                        logger.info(`Iniciando corte do video: ${inputPath}`);
                        await pipeline.run(inputPath, {
                            karaoke: msg.karaoke ?? true,
                        }, (stage, percent) => {
                            updateStatus('PROCESSING', {
                                [`${stage}Progress`]: percent
                            });
                        });
                        logger.info('Corte finalizado com sucesso!');
                        break;
                    }
                    case 'render': {
                        const inputPath = msg.inputPath || msg.url;
                        logger.info(`Iniciando renderização do video: ${inputPath}`);

                        const absolutePath = path.resolve(process.cwd(), inputPath);
                        const rawVideoName = path.basename(absolutePath, path.extname(absolutePath));
                        const safeVideoName = rawVideoName.length > 40 ? rawVideoName.slice(0, 40) : rawVideoName;
                        const outputDir = path.resolve(OUTPUT_DIR, safeVideoName);
                        const clipsJsonPath = path.join(outputDir, "clips.json");

                        if (!existsSync(clipsJsonPath)) {
                            throw new Error(`clips.json não encontrado em ${clipsJsonPath}`);
                        }

                        const clips: Clip[] = JSON.parse(await readFile(clipsJsonPath, "utf-8"));

                        await updateStatus('PROCESSING', {
                            detectProgress: 100,
                            transcribeProgress: 0,
                            renderProgress: 0
                        });

                        await pipeline.render(
                            absolutePath,
                            clips,
                            msg.karaoke !== false,
                            (stage, percent) => {
                                updateStatus('PROCESSING', {
                                    [`${stage}Progress`]: percent
                                });
                            }
                        );

                        logger.info('Renderização finalizada com sucesso!');
                        break;
                    }
                    default:
                        logger.warn(`Unknown message type: ${msg.type}`);
                }

                await updateStatus('COMPLETED', { completedAt: Date.now() });
            } catch (error: any) {
                logger.error(`Erro ao processar a tarefa: ${error instanceof Error ? error.message : String(error)}`);
                if (error instanceof Error && error.stack) {
                    console.error(error.stack);
                }
                await updateStatus('FAILED', { 
                    completedAt: Date.now(),
                    error: error instanceof Error ? error.message : String(error)
                });
            } finally {
                if (cancellationCheckInterval) {
                    clearInterval(cancellationCheckInterval);
                }
            }
        });

    } catch (error) {
        logger.error({ error }, 'Failed to start worker');
        process.exit(1);
    }

    // Handle graceful shutdown
    const handleShutdown = async (signal: string) => {
        logger.info(`Received ${signal}, shutting down worker...`);
        await rabbitmq.close();
        await redis.close();
        process.exit(0);
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
}

bootstrap();
