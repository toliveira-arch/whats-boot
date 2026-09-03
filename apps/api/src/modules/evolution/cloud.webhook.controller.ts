import crypto from 'node:crypto';
import type { Request } from 'express';
import { prisma, runAsSystem, runWithTenant, Prisma } from '@whats-boot/database';
import { asyncHandler } from '../../lib/http';
import { logger } from '../../lib/logger';
import { env, isProduction } from '../../config/env';
import { enqueueOrRun, QUEUE_NAMES } from '../../queues';
import { processInboundEvent } from './ingest.service';
import { cloudToEvolutionPayloads, type CloudApiPayload } from './cloudapi.types';

/**
 * GET do webhook: a Meta chama uma única vez, ao cadastrar a URL, com um
 * desafio. Precisamos devolver `hub.challenge` CRU (texto puro, não JSON) e
 * somente se o `hub.verify_token` bater com o nosso.
 */
export const cloudWebhookVerifyController = asyncHandler(async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const expected = env.WHATSAPP_CLOUD_VERIFY_TOKEN;
  if (!expected) {
    logger.error('webhook Cloud: WHATSAPP_CLOUD_VERIFY_TOKEN não configurado');
    res.status(500).send('verify_token_not_configured');
    return;
  }

  if (mode === 'subscribe' && token === expected) {
    logger.info('webhook Cloud: verificação da Meta concluída com sucesso');
    res.status(200).send(String(challenge ?? ''));
    return;
  }

  logger.warn({ mode }, 'webhook Cloud: verificação recusada (token divergente)');
  res.sendStatus(403);
});

/**
 * Confere a assinatura `X-Hub-Signature-256` (HMAC-SHA256 do corpo cru com a
 * chave secreta do app). Sem isso, qualquer um que descubra a URL consegue
 * injetar mensagens falsas no sistema.
 */
function signatureValid(req: Request): boolean {
  const secret = env.WHATSAPP_CLOUD_APP_SECRET;
  if (!secret) return false;

  const header = req.headers['x-hub-signature-256'];
  if (typeof header !== 'string' || !header.startsWith('sha256=')) return false;

  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!raw) return false;

  const expected = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;

  // Comparação em tempo constante (evita descobrir a assinatura por timing).
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * POST do webhook: recebe mensagens e status da Cloud API.
 *
 * Diferente da Evolution (uma URL por canal, com token no path), a Meta manda
 * TODOS os números do app para a MESMA URL — por isso o canal é descoberto pelo
 * `phone_number_id` de cada evento.
 *
 * Responde 200 sempre que a assinatura confere, mesmo quando não há o que
 * fazer: a Meta reenvia em qualquer resposta que não seja 2xx e, depois de
 * várias falhas seguidas, desativa o webhook do app.
 */
export const cloudWebhookController = asyncHandler(async (req, res) => {
  if (!signatureValid(req)) {
    // Em desenvolvimento, seguir sem APP_SECRET ajuda a testar com túnel.
    // Em produção a URL é pública: recusar é obrigatório.
    if (isProduction || env.WHATSAPP_CLOUD_APP_SECRET) {
      logger.warn('webhook Cloud: assinatura inválida — requisição descartada');
      res.sendStatus(401);
      return;
    }
    logger.warn('webhook Cloud: sem APP_SECRET (modo dev) — assinatura NÃO conferida');
  }

  const body = (req.body ?? {}) as CloudApiPayload;
  const events = cloudToEvolutionPayloads(body);

  if (!events.length) {
    // Payloads que não traduzimos (ex.: mudanças de qualidade do número,
    // atualização de template) chegam aqui. Não é erro — só não nos interessa.
    res.status(200).json({ received: true, handled: 0 });
    return;
  }

  let handled = 0;

  for (const { phoneNumberId, payload } of events) {
    const channel = await runAsSystem(() =>
      prisma.evolutionInstance.findFirst({
        where: { phoneNumberId, deletedAt: null },
        select: { id: true, tenantId: true },
      }),
    );

    if (!channel) {
      logger.warn({ phoneNumberId }, 'webhook Cloud: nenhum canal cadastrado para este número');
      continue;
    }

    const externalId = payload.data?.key?.id ?? payload.data?.keyId ?? null;

    let duplicate = false;
    await runWithTenant(channel.tenantId, async () => {
      try {
        await prisma.webhookEvent.create({
          data: {
            evolutionInstanceId: channel.id,
            event: payload.event,
            externalId,
            payload: payload as unknown as Prisma.InputJsonValue,
            status: 'RECEIVED',
          },
        });
      } catch (err) {
        // A Meta reenvia o mesmo evento quando demoramos a responder; o unique
        // do externalId é o que garante que não processamos duas vezes.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          duplicate = true;
        } else {
          throw err;
        }
      }
    });

    if (duplicate) continue;

    await enqueueOrRun(
      QUEUE_NAMES.inboundMessages,
      { channelId: channel.id, tenantId: channel.tenantId, payload },
      { jobId: externalId ? `${channel.id}:${externalId}` : undefined },
      processInboundEvent,
    );
    handled += 1;
  }

  res.status(200).json({ received: true, handled });
});
