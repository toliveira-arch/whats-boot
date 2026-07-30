import { Worker, type Processor } from 'bullmq';
import { createRedisConnection, redisEnabled } from './lib/redis';
import { logger } from './lib/logger';
import { QUEUE_NAMES, type QueueName } from './queues';
import { processInboundEvent, type InboundJob } from './modules/evolution/ingest.service';
import { processOutbound, type OutboundJob } from './modules/evolution/messaging.service';
import { generateReplyJob } from './modules/ai/ai.service';

// Sem Redis, não há filas: a API processa tudo inline. O worker não é necessário.
if (!redisEnabled) {
  logger.warn(
    'Redis desabilitado (sem REDIS_URL) — worker não é necessário (modo inline). Encerrando.',
  );
  process.exit(0);
}

/**
 * Processo de WORKER (deploy separado da API). Processa as filas BullMQ:
 *  - inbound.messages  → ingestão dos webhooks da Evolution (salva no banco).
 *  - outbound.messages → envio via Evolution (texto/mídia) + status.
 * As demais filas ficam com um handler no-op até seus módulos serem entregues.
 */
const connection = createRedisConnection();

const processors: Partial<Record<QueueName, Processor>> = {
  [QUEUE_NAMES.inboundMessages]: async (job) => {
    await processInboundEvent(job.data as InboundJob);
  },
  [QUEUE_NAMES.outboundMessages]: async (job) => {
    await processOutbound(job.data as OutboundJob);
  },
  [QUEUE_NAMES.aiProcess]: async (job) => {
    await generateReplyJob(job.data as { conversationId: string; tenantId: string });
  },
};

const workers = Object.values(QUEUE_NAMES).map((name) => {
  const processor: Processor =
    processors[name] ??
    (async (job) => {
      logger.debug({ queue: name, jobId: job.id }, 'job sem processador (no-op)');
    });
  return new Worker(name, processor, { connection, concurrency: 5 });
});

logger.info({ workers: workers.length }, '👷 workers BullMQ iniciados');

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'encerrando workers...');
  await Promise.all(workers.map((w) => w.close()));
  await connection.quit();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
