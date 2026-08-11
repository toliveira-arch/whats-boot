import { createServer } from 'node:http';
import { env } from './config/env';
import { logger } from './lib/logger';
import { createApp } from './server';
import { createSocketServer } from './realtime/socket';
import { redis } from './lib/redis';
import { prisma } from './lib/prisma';
import { closeQueues } from './queues';
import { ensureIndexes } from './db/ensure-indexes';
import { resyncAllWebhooks } from './modules/evolution/channels.service';
import { startWarmupScheduler, stopWarmupScheduler } from './modules/warmup/warmup.engine';
import { startFollowUpScheduler, stopFollowUpScheduler } from './modules/followup/followup.engine';

async function bootstrap(): Promise<void> {
  const app = createApp();
  const httpServer = createServer(app);

  // Socket.IO acoplado ao mesmo servidor HTTP
  const io = createSocketServer(httpServer);

  // Invariantes de banco que o Prisma não expressa (índice único parcial de
  // idempotência da 1ª mensagem). Roda antes de servir tráfego; nunca derruba o boot.
  await ensureIndexes();

  // Provedores de nuvem (Render/Railway) injetam a porta em PORT.
  const port = process.env.PORT ? Number(process.env.PORT) : env.API_PORT;
  httpServer.listen(port, env.API_HOST, () => {
    logger.info(`🚀 API ouvindo em http://${env.API_HOST}:${port}`);
    // Ajuda a diagnosticar webhooks: mostra a URL pública que a Evolution vai chamar.
    logger.info(`🔗 API_PUBLIC_URL = ${env.API_PUBLIC_URL}`);
    if (env.API_PUBLIC_URL.includes('localhost')) {
      logger.warn(
        'API_PUBLIC_URL está em localhost — a Evolution (remota) NÃO alcançará os webhooks. Aponte para o túnel e reinicie.',
      );
    }
    // Re-sincroniza os webhooks das instâncias com a API_PUBLIC_URL atual —
    // assim trocar de túnel passa a valer sozinho, sem clicar "Reconectar".
    void resyncAllWebhooks().catch((err) =>
      logger.warn({ err }, 'falha ao re-sincronizar webhooks no boot'),
    );
    // Agendador de aquecimento de chip (ticker em processo, sem Redis).
    startWarmupScheduler();
    // Agendador de follow-up (cadência de reengajamento por empresa).
    startFollowUpScheduler();
  });

  // Encerramento gracioso
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'encerrando...');
    stopWarmupScheduler();
    stopFollowUpScheduler();
    io.close();
    httpServer.close();
    await closeQueues().catch(() => undefined);
    await redis?.quit().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error({ err }, 'falha ao iniciar a API');
  process.exit(1);
});
