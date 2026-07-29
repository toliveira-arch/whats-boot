import { Worker } from 'bullmq';
import { createRedisConnection } from './lib/redis';
import { logger } from './lib/logger';
import { QUEUE_NAMES } from './queues';

/**
 * Processo de WORKER (deploy separado da API).
 * Infraestrutura apenas: registra workers vazios para cada fila. A lógica de
 * cada job será implementada nas etapas dos respectivos módulos.
 */
const connection = createRedisConnection();

const workers = Object.values(QUEUE_NAMES).map(
  (name) =>
    new Worker(
      name,
      async (job) => {
        logger.info({ queue: name, jobId: job.id }, 'job recebido (sem processador ainda)');
      },
      { connection, concurrency: 5 },
    ),
);

logger.info({ workers: workers.length }, '👷 workers BullMQ iniciados');

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'encerrando workers...');
  await Promise.all(workers.map((w) => w.close()));
  await connection.quit();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
