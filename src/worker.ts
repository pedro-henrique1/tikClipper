import 'dotenv/config';
import { RabbitMQService } from './services/rabbitmq.service.js';
import { RedisService } from './services/redis.service.js';
import { logger } from './services/logger.service.js';

import { DownloadService } from './services/download.service.js';
import { Pipeline } from './pipeline/index.js';

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
                await redis.setJobStatus(msg.id, 'PROCESSING', { startedAt: Date.now() });
            }

            try {
                switch (msg.type) {
                    case 'download':
                        logger.info(`Iniciando download da URL: ${msg.url}`);
                        await downloadService.downloadVideo(msg.url, process.env.VIDEOS_DIR || './videos');
                        logger.info('Download finalizado com sucesso!');
                        break;
                    case 'cut':
                        const inputPath = msg.inputPath || msg.url;
                        logger.info(`Iniciando corte do video: ${inputPath}`);
                        await pipeline.run(inputPath, {
                            karaoke: msg.karaoke ?? true,
                        });
                        logger.info('Corte finalizado com sucesso!');
                        break;
                    default:
                        logger.warn(`Unknown message type: ${msg.type}`);
                }

                if (msg.id) {
                    await redis.setJobStatus(msg.id, 'COMPLETED', { completedAt: Date.now() });
                }
            } catch (error: any) {
                logger.error(`Erro ao processar a tarefa: ${error instanceof Error ? error.message : String(error)}`);
                if (error instanceof Error && error.stack) {
                    console.error(error.stack);
                }
                if (msg.id) {
                    await redis.setJobStatus(msg.id, 'FAILED', { 
                        completedAt: Date.now(),
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
                // Repassa o erro se precisar de retry no RabbitMQ no futuro
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
