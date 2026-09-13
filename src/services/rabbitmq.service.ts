import amqplib, { ChannelModel, Channel, ConsumeMessage } from 'amqplib';
import { logger } from './logger.service.js';

export class RabbitMQService {
    private connection: ChannelModel | null = null;
    private channel: Channel | null = null;

    constructor(private readonly url: string) { }

    async connect(): Promise<void> {
        try {
            if (!this.connection) {
                this.connection = await amqplib.connect(this.url);

                this.connection.on('error', (err) => {
                    logger.error({ err }, 'RabbitMQ connection error');
                    this.connection = null;
                    this.channel = null;
                });

                this.connection.on('close', () => {
                    logger.warn('RabbitMQ connection closed');
                    this.connection = null;
                    this.channel = null;
                });
            }

            if (!this.channel) {
                this.channel = await this.connection.createChannel();
            }
        } catch (error) {
            logger.error({ error }, 'Failed to connect to RabbitMQ');
            throw error;
        }
    }

    async close(): Promise<void> {
        try {
            if (this.channel) {
                await this.channel.close();
                this.channel = null;
            }
            if (this.connection) {
                await this.connection.close();
                this.connection = null;
            }
            logger.info('RabbitMQ connection closed gracefully');
        } catch (error) {
            logger.error({ error }, 'Error closing RabbitMQ connection');
        }
    }

    async publishToQueue(queue: string, message: any): Promise<void> {
        if (!this.channel) {
            await this.connect();
        }
        try {
            await this.channel!.assertQueue(queue, { durable: true });
            this.channel!.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
                persistent: true,
            });
            logger.debug({ queue, message }, 'Message published to queue');
        } catch (error) {
            logger.error({ error, queue }, 'Failed to publish message');
            throw error;
        }
    }

    async consume(queue: string, onMessage: (msg: any) => Promise<void>): Promise<void> {
        if (!this.channel) {
            await this.connect();
        }
        try {
            await this.channel!.assertQueue(queue, { durable: true });

            this.channel!.prefetch(1);

            logger.info({ queue }, 'Started consuming messages');

            await this.channel!.consume(queue, async (msg: ConsumeMessage | null) => {
                if (msg) {
                    try {
                        const content = JSON.parse(msg.content.toString());
                        await onMessage(content);
                        this.channel!.ack(msg);
                    } catch (error) {
                        logger.error({ error, msg: msg.content.toString() }, 'Error processing message');
                        // Nack the message if processing fails (true to requeue, false to discard)
                        this.channel!.nack(msg, false, false);
                    }
                }
            }, { noAck: false });
        } catch (error) {
            logger.error({ error, queue }, 'Failed to setup consumer');
            throw error;
        }
    }

    async getQueueStatus(queue: string): Promise<{ messageCount: number; consumerCount: number }> {
        if (!this.channel) {
            await this.connect();
        }
        try {
            const status = await this.channel!.checkQueue(queue);
            return {
                messageCount: status.messageCount,
                consumerCount: status.consumerCount,
            };
        } catch (error) {
            logger.error({ error, queue }, 'Failed to get queue status');
            throw error;
        }
    }
}
