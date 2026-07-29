import { Queue } from 'bullmq';
import { createRedisConnection } from '../lib/redis';
import { logger } from '../lib/logger';

/**
 * Definição das filas BullMQ (infraestrutura — sem processadores de negócio).
 * Os nomes seguem a arquitetura (docs/ARCHITECTURE.md §8). Os processadores
 * serão implementados nas etapas de cada módulo.
 */
export const QUEUE_NAMES = {
  inboundMessages: 'inbound.messages',
  aiProcess: 'ai.process',
  outboundMessages: 'outbound.messages',
  mediaDownload: 'media.download',
  knowledgeEmbed: 'knowledge.embed',
  webhookStatus: 'webhook.status',
  followUp: 'followup.dispatch',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const connection = createRedisConnection();

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

/** Registro de todas as filas, criadas uma única vez. */
export const queues: Record<QueueName, Queue> = Object.values(QUEUE_NAMES).reduce(
  (acc, name) => {
    acc[name] = new Queue(name, { connection, defaultJobOptions });
    return acc;
  },
  {} as Record<QueueName, Queue>,
);

logger.info({ queues: Object.keys(queues) }, 'filas BullMQ registradas');

export async function closeQueues(): Promise<void> {
  await Promise.all(Object.values(queues).map((q) => q.close()));
  await connection.quit();
}
