import { Redis } from 'ioredis';
import type { Investigation } from '@proofline/contracts';
import { investigationSchema } from '@proofline/contracts';
import { appConfig } from '../config.js';

const redis =
  appConfig.redisUrl && !appConfig.demoMode
    ? new Redis(appConfig.redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      })
    : null;

export async function getCachedInvestigation(id: string): Promise<Investigation | null> {
  if (!redis) return null;
  try {
    if (redis.status === 'wait') await redis.connect();
    const value = await redis.get(`investigation:${id}`);
    if (!value) return null;
    return investigationSchema.parse(JSON.parse(value));
  } catch {
    return null;
  }
}

export async function cacheInvestigation(investigation: Investigation): Promise<void> {
  if (!redis) return;
  try {
    if (redis.status === 'wait') await redis.connect();
    await redis.set(`investigation:${investigation.id}`, JSON.stringify(investigation), 'EX', 3600);
  } catch {
    // Redis is an optimization. Persistence remains authoritative.
  }
}

export async function closeCache(): Promise<void> {
  if (redis && redis.status !== 'end') await redis.quit().catch(() => undefined);
}
