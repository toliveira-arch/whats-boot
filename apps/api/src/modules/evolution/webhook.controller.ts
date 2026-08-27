import { prisma, runAsSystem, runWithTenant, Prisma } from '@whats-boot/database';
import { asyncHandler } from '../../lib/http';
import { logger } from '../../lib/logger';
import { enqueueOrRun, QUEUE_NAMES } from '../../queues';
import { processInboundEvent } from './ingest.service';
import type { EvolutionWebhookPayload } from './evolution.types';

/**
 * Recebe os webhooks da Evolution API. Valida o token do canal, persiste o
 * evento bruto (idempotência) e ENFILEIRA para processamento assíncrono.
 * Responde 200 rápido — nunca processa de forma síncrona.
 */
export const evolutionWebhookController = asyncHandler(async (req, res) => {
  const channelId = req.params.channelId!;
  const token =
    (req.params.token as string | undefined) ??
    (req.query.token as string | undefined) ??
    (req.headers['x-webhook-token'] as string | undefined);

  const payload = (req.body ?? {}) as EvolutionWebhookPayload;
  const event = typeof payload.event === 'string' ? payload.event : 'unknown';

  // Log de chegada (antes da auth) — facilita diagnosticar o espelhamento.
  logger.info({ channelId, event, hasToken: Boolean(token) }, 'webhook Evolution recebido');

  const channel = await runAsSystem(() =>
    prisma.evolutionInstance.findFirst({
      where: { id: channelId },
      select: { id: true, tenantId: true, webhookToken: true, deletedAt: true },
    }),
  );

  if (!channel || channel.deletedAt) {
    logger.warn({ channelId }, 'webhook: canal não encontrado');
    res.status(404).json({ error: 'not_found' });
    return;
  }
  if (!token || token !== channel.webhookToken) {
    logger.warn({ channelId, event }, 'webhook: token inválido — verifique a URL do webhook');
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const externalId = payload.data?.key?.id ?? null;

  let duplicate = false;
  await runWithTenant(channel.tenantId, async () => {
    try {
      await prisma.webhookEvent.create({
        data: {
          evolutionInstanceId: channel.id,
          event,
          externalId,
          payload: payload as unknown as Prisma.InputJsonValue,
          status: 'RECEIVED',
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // MESMO evento + MESMO id: reenvio do webhook, já registrado.
        // (Eventos DIFERENTES com o mesmo id não colidem — ver @@unique no schema.)
        duplicate = true;
      } else {
        throw err;
      }
    }
  });

  if (!duplicate) {
    await enqueueOrRun(
      QUEUE_NAMES.inboundMessages,
      { channelId: channel.id, tenantId: channel.tenantId, payload },
      { jobId: externalId ? `${channel.id}:${externalId}` : undefined },
      processInboundEvent,
    );
  }

  res.status(200).json({ received: true, duplicate });
});
