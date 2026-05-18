import { Redis } from 'ioredis';
import { logger } from './logger.service.js';

export class RedisService {
    private client: Redis;

    constructor() {
        const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
        this.client = new Redis(redisUrl);

        this.client.on('error', (err) => {
            logger.error({ err }, 'Redis connection error');
        });

        this.client.on('connect', () => {
            logger.info('Connected to Redis');
        });
    }

    async setJobStatus(jobId: string, status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED', metadata: Record<string, any> = {}): Promise<void> {
        let existingData: any = {};
        const existingRaw = await this.client.get(`job:${jobId}`);
        if (existingRaw) {
            try {
                existingData = JSON.parse(existingRaw);
            } catch (e) {}
        }

        const data = {
            ...existingData,
            status,
            updatedAt: Date.now(),
            ...metadata
        };

        // If it's a new job and has no createdAt, set it
        if (!data.createdAt) {
            data.createdAt = Date.now();
        }

        // Set the status with an expiration time of 7 days to avoid filling up Redis
        await this.client.set(`job:${jobId}`, JSON.stringify(data), 'EX', 60 * 60 * 24 * 7);
    }

    async getJobStatus(jobId: string): Promise<any | null> {
        const data = await this.client.get(`job:${jobId}`);
        if (!data) return null;
        return JSON.parse(data);
    }

    async getAllJobs(): Promise<any[]> {
        const keys = await this.client.keys('job:*');
        if (keys.length === 0) return [];

        const values = await this.client.mget(keys);
        const jobs = values
            .map((val, index) => {
                if (!val) return null;
                const parsed = JSON.parse(val);
                // Extract id from key 'job:uuid'
                parsed.id = keys[index].replace('job:', '');
                return parsed;
            })
            .filter(val => val !== null);

        // Ordenar por data de criação (mais novos primeiro)
        return jobs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }

    async close() {
        await this.client.quit();
    }
}
