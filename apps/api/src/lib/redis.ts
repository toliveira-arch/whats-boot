import { Redis } from 'ioredis';
import { env } from '../config/env';
import { logger } from './logger';

/**
 * Redis é OPCIONAL. Se `REDIS_URL` não estiver definido, o app roda em modo
 * "inline": filas processadas em processo e Socket.IO local (sem adapter).
 * Com `REDIS_URL` (Redis >= 5), habilita filas BullMQ e escala horizontal.
 */
// Redis só entra em ação quando explicitamente habilitado E com URL definida.
// Ter um REDIS_URL sobrando (ou um Redis local incompatível) não afeta o app.
export const redisEnabled = env.REDIS_ENABLED && Boolean(env.REDIS_URL);

/** Conexão Redis de uso geral (null quando Redis está desabilitado). */
export const redis: Redis | null = redisEnabled
  ? new Redis(env.REDIS_URL as string, { maxRetriesPerRequest: null, lazyConnect: false })
  : null;

redis?.on('connect', () => logger.info('redis conectado'));
redis?.on('error', (err) => logger.error({ err }, 'erro no redis'));

if (!redisEnabled) {
  logger.warn('Redis desabilitado (sem REDIS_URL) — filas rodam inline e Socket.IO local');
}

/** Cria uma nova conexão Redis (para BullMQ / pub-sub do Socket.IO). */
export function createRedisConnection(): Redis {
  if (!env.REDIS_URL) {
    throw new Error('createRedisConnection chamado com Redis desabilitado (REDIS_URL ausente)');
  }
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  connection.on('error', (err) => logger.error({ err }, 'erro na conexão redis'));
  return connection;
}
