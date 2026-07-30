import { Queue, type JobsOptions } from 'bullmq';
import { createRedisConnection, redis } from '../lib/redis';
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

/**
 * Enfileira um job quando o Redis está disponível; caso contrário processa
 * INLINE (destacado, sem bloquear quem chamou). Assim o espelhamento em tempo
 * real funciona mesmo sem Redis/worker (dev), e usa a fila em produção.
 */
export async function enqueueOrRun<T>(
  name: QueueName,
  job: T,
  opts: JobsOptions,
  inlineRunner: (job: T) => Promise<void>,
): Promise<void> {
  if (redis.status === 'ready') {
    try {
      await queues[name].add('job', job as never, opts);
      return;
    } catch (err) {
      logger.warn({ err, name }, 'falha ao enfileirar; processando inline');
    }
  } else {
    logger.warn({ name, status: redis.status }, 'Redis indisponível; processando inline');
  }
  // Destacado: não bloqueia a resposta HTTP nem o processamento do webhook.
  void Promise.resolve()
    .then(() => inlineRunner(job))
    .catch((err) => logger.error({ err, name }, 'falha no processamento inline'));
}
