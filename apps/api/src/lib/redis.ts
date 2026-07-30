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
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  // Sempre registrar um handler de 'error' — sem isso, um Redis indisponível
  // dispara "Unhandled error event" e derruba o processo. Assim a API continua
  // de pé (login/dashboard funcionam só com o Postgres) mesmo sem Redis.
  connection.on('error', (err) => logger.error({ err }, 'erro na conexão redis'));
  return connection;
}
