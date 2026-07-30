import { prisma, runAsSystem, runWithTenant, Prisma } from '@whats-boot/database';
import { asyncHandler } from '../../lib/http';
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
    (req.query.token as string | undefined) ??
    (req.headers['x-webhook-token'] as string | undefined);

  const channel = await runAsSystem(() =>
    prisma.evolutionInstance.findFirst({
      where: { id: channelId },
      select: { id: true, tenantId: true, webhookToken: true, deletedAt: true },
    }),
  );

  if (!channel || channel.deletedAt) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  if (!token || token !== channel.webhookToken) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const payload = (req.body ?? {}) as EvolutionWebhookPayload;
  const event = typeof payload.event === 'string' ? payload.event : 'unknown';
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
        duplicate = true; // webhook reenviado — já registrado
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
