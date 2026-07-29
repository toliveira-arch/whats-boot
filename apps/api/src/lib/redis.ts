import { Redis } from 'ioredis';
import { env } from '../config/env';
import { logger } from './logger';

/**
 * Conexões Redis.
 * - `redis`: uso geral (cache, locks, presença).
 * - Para BullMQ e para o adapter do Socket.IO usamos conexões dedicadas
 *   (BullMQ exige `maxRetriesPerRequest: null`).
 */
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: false,
});

redis.on('connect', () => logger.info('redis conectado'));
redis.on('error', (err) => logger.error({ err }, 'erro no redis'));

/** Cria uma nova conexão Redis (para BullMQ / pub-sub do Socket.IO). */
export function createRedisConnection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}
