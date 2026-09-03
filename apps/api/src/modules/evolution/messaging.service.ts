import { prisma, runWithTenant, Prisma } from '@whats-boot/database';
import { HttpError } from '../../middlewares/error';
import { decryptSecret } from '../../lib/crypto';
import { broadcastToTenant } from '../../realtime/emitter';
import { enqueueOrRun, QUEUE_NAMES } from '../../queues';
import { logger } from '../../lib/logger';
import { createEvolutionClient, type SendMediaBody } from './evolution.client';
import { createCloudApiClient } from './cloudapi.client';
import { recordEvent } from '../events/events.service';

type MediaType = SendMediaBody['mediatype'];

/** Valor de `integration` que marca um canal WhatsApp Cloud API (Meta). */
export const CLOUD_INTEGRATION = 'WHATSAPP-CLOUD';

export interface OutboundJob {
  tenantId: string;
  channelId: string;
  messageId: string;
  kind: 'text' | 'media';
  number: string;
  text?: string;
  mediatype?: MediaType;
  media?: string;
  mimetype?: string;
  fileName?: string;
  caption?: string;
}

function normalizeNumber(input: string): { sendNumber: string; waJid: string } {
  if (input.includes('@')) {
    return { sendNumber: input.split('@')[0] ?? input, waJid: input };
  }
  const digits = input.replace(/\D/g, '');
  return { sendNumber: digits, waJid: `${digits}@s.whatsapp.net` };
}

function mediaToMessageType(t: MediaType): 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT' {
  switch (t) {
    case 'image':
      return 'IMAGE';
    case 'video':
      return 'VIDEO';
    case 'audio':
      return 'AUDIO';
    case 'document':
      return 'DOCUMENT';
  }
}

async function loadChannel(channelId: string) {
  const channel = await prisma.evolutionInstance.findFirst({
    where: { id: channelId, deletedAt: null },
    select: { id: true, companyId: true, tenantId: true },
  });
  if (!channel) throw new HttpError(404, 'Canal não encontrado');
  return channel;
}

async function resolveContactAndConversation(
  channel: { id: string; companyId: string; tenantId: string },
  waJid: string,
) {
  const contact = await prisma.contact.upsert({
    where: { companyId_waJid: { companyId: channel.companyId, waJid } },
    create: {
      tenantId: channel.tenantId,
      companyId: channel.companyId,
      waJid,
      phoneNumber: waJid.split('@')[0] ?? waJid,
      isGroup: waJid.endsWith('@g.us'),
    },
    update: {},
  });

  const open = await prisma.conversation.findFirst({
    where: {
      contactId: contact.id,
      evolutionInstanceId: channel.id,
      status: { not: 'CLOSED' },
      deletedAt: null,
    },
    orderBy: { createdAt: 'desc' },
  });
  let conversation = open;
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        tenantId: channel.tenantId,
        companyId: channel.companyId,
        contactId: contact.id,
        evolutionInstanceId: channel.id,
        waRemoteJid: waJid,
        status: 'OPEN',
      },
    });
    await recordEvent({
      tenantId: channel.tenantId,
      conversationId: conversation.id,
      type: 'CREATED',
    });
  }

  return { contact, conversation };
}

/**
 * Pausa a IA em UMA conversa quando um humano intervém (atendente pela plataforma
 * ou alguém digitando no celular do número conectado) — evita duas pessoas
 * falando com o lead ao mesmo tempo. Idempotente: só a 1ª intervenção registra o
 * handoff. A IA pode ser religada por conversa no painel do Chat.
 */
export async function pauseAiForHumanHandoff(
  conversationId: string,
  tenantId: string,
): Promise<void> {
  const res = await prisma.conversation.updateMany({
    where: { id: conversationId, aiEnabled: { not: false } },
    data: { aiEnabled: false },
  });
  if (res.count === 0) return; // já estava pausada
  await recordEvent({
    tenantId,
    conversationId,
    type: 'HANDOFF',
    data: { reason: 'human-intervention' },
  }).catch(() => undefined);
  broadcastToTenant(tenantId, 'conversation.updated', { conversationId });
}

export interface SendTextInput {
  tenantId: string;
  membershipId?: string;
  channelId: string;
  number: string;
  text: string;
  authorType?: 'AGENT' | 'AI';
}

export async function sendText(input: SendTextInput) {
  const channel = await loadChannel(input.channelId);
  const { sendNumber, waJid } = normalizeNumber(input.number);
  const { contact, conversation } = await resolveContactAndConversation(channel, waJid);

  const message = await prisma.message.create({
    data: {
      tenantId: channel.tenantId,
      companyId: channel.companyId,
      conversationId: conversation.id,
      contactId: contact.id,
      evolutionInstanceId: channel.id,
      direction: 'OUTBOUND',
      authorType: input.authorType ?? 'AGENT',
      authorMembershipId: input.membershipId ?? null,
      type: 'TEXT',
      content: input.text,
      status: 'QUEUED',
    },
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date(), lastOutboundAt: new Date() },
  });

  // Intervenção humana pela plataforma (atendente): pausa a IA nesta conversa.
  if ((input.authorType ?? 'AGENT') === 'AGENT') {
    await pauseAiForHumanHandoff(conversation.id, channel.tenantId);
  }

  await enqueueOrRun(
    QUEUE_NAMES.outboundMessages,
    {
      tenantId: input.tenantId,
      channelId: channel.id,
      messageId: message.id,
      kind: 'text',
      number: sendNumber,
      text: input.text,
    } satisfies OutboundJob,
    {},
    processOutbound,
  );

  broadcastToTenant(input.tenantId, 'message.created', {
    conversationId: conversation.id,
    direction: 'OUTBOUND',
    content: input.text,
    messageId: message.id,
  });

  return { messageId: message.id, conversationId: conversation.id };
}

export interface SendMediaInput {
  tenantId: string;
  membershipId?: string;
  channelId: string;
  number: string;
  mediatype: MediaType;
  media: string;
  mimetype?: string;
  fileName?: string;
  caption?: string;
  authorType?: 'AGENT' | 'AI';
}

export async function sendMedia(input: SendMediaInput) {
  const channel = await loadChannel(input.channelId);
  const { sendNumber, waJid } = normalizeNumber(input.number);
  const { contact, conversation } = await resolveContactAndConversation(channel, waJid);

  const message = await prisma.message.create({
    data: {
      tenantId: channel.tenantId,
      companyId: channel.companyId,
      conversationId: conversation.id,
      contactId: contact.id,
      evolutionInstanceId: channel.id,
      direction: 'OUTBOUND',
      authorType: input.authorType ?? 'AGENT',
      authorMembershipId: input.membershipId ?? null,
      type: mediaToMessageType(input.mediatype),
      content: input.caption ?? null,
      caption: input.caption ?? null,
      status: 'QUEUED',
    },
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date(), lastOutboundAt: new Date() },
  });

  // Intervenção humana pela plataforma (atendente): pausa a IA nesta conversa.
  if ((input.authorType ?? 'AGENT') === 'AGENT') {
    await pauseAiForHumanHandoff(conversation.id, channel.tenantId);
  }

  await enqueueOrRun(
    QUEUE_NAMES.outboundMessages,
    {
      tenantId: input.tenantId,
      channelId: channel.id,
      messageId: message.id,
      kind: 'media',
      number: sendNumber,
      mediatype: input.mediatype,
      media: input.media,
      mimetype: input.mimetype,
      fileName: input.fileName,
      caption: input.caption,
    } satisfies OutboundJob,
    {},
    processOutbound,
  );

  broadcastToTenant(input.tenantId, 'message.created', {
    conversationId: conversation.id,
    direction: 'OUTBOUND',
    type: mediaToMessageType(input.mediatype),
    messageId: message.id,
  });

  return { messageId: message.id, conversationId: conversation.id };
}

// ---------------------------------------------------------------------------
// Ações auxiliares (presença, apagar, reagir) — usadas pelo aquecimento.
// Sempre best-effort: nunca lançam.
// ---------------------------------------------------------------------------

async function clientFor(channelId: string) {
  const ch = await prisma.evolutionInstance.findFirst({
    where: { id: channelId, deletedAt: null },
    select: { instanceName: true, baseUrl: true, apiKeyEncrypted: true },
  });
  if (!ch) return null;
  return {
    client: createEvolutionClient(ch.baseUrl, decryptSecret(ch.apiKeyEncrypted)),
    instanceName: ch.instanceName,
  };
}

/** Mostra "digitando…" (ou "gravando…") para o número, por `delay` ms. */
export async function sendPresence(
  channelId: string,
  number: string,
  presence: 'composing' | 'recording' | 'available' = 'composing',
  delay = 1500,
): Promise<void> {
  try {
    const c = await clientFor(channelId);
    if (!c) return;
    const { sendNumber } = normalizeNumber(number);
    await c.client.sendPresence(c.instanceName, { number: sendNumber, presence, delay });
  } catch (err) {
    logger.warn({ err, channelId }, 'falha ao enviar presença');
  }
}

/** Apaga uma mensagem para todos (best-effort). */
export async function deleteForEveryone(
  channelId: string,
  key: { id: string; remoteJid: string; fromMe: boolean },
): Promise<void> {
  try {
    const c = await clientFor(channelId);
    if (!c) return;
    await c.client.deleteForEveryone(c.instanceName, key);
  } catch (err) {
    logger.warn({ err, channelId }, 'falha ao apagar mensagem para todos');
  }
}

/** Reage a uma mensagem com um emoji (best-effort). */
export async function sendReaction(
  channelId: string,
  key: { id: string; remoteJid: string; fromMe: boolean },
  reaction: string,
): Promise<void> {
  try {
    const c = await clientFor(channelId);
    if (!c) return;
    await c.client.sendReaction(c.instanceName, { key, reaction });
  } catch (err) {
    logger.warn({ err, channelId }, 'falha ao reagir à mensagem');
  }
}

/** Processa o envio (executado pelo worker): chama a Evolution e atualiza o status. */
export async function processOutbound(job: OutboundJob): Promise<void> {
  await runWithTenant(job.tenantId, async () => {
    const channel = await prisma.evolutionInstance.findFirst({
      where: { id: job.channelId },
      select: {
        instanceName: true,
        baseUrl: true,
        apiKeyEncrypted: true,
        integration: true,
        phoneNumberId: true,
      },
    });
    if (!channel) {
      await prisma.message.update({
        where: { id: job.messageId },
        data: { status: 'FAILED', failedAt: new Date(), errorMessage: 'Canal inexistente' },
      });
      return;
    }

    try {
      // Dentro do try: se a apikey não descriptografar (ex.: chave trocada),
      // a mensagem é marcada como FAILED com o erro, em vez de falhar em silêncio.
      const secret = decryptSecret(channel.apiKeyEncrypted);
      const isCloud = channel.integration === CLOUD_INTEGRATION;

      if (isCloud && !channel.phoneNumberId) {
        throw new Error('Canal Cloud API sem phoneNumberId configurado');
      }

      // Envio: Cloud API oficial (Meta) ou Evolution/Baileys. As duas respostas
      // carregam o id da mensagem em lugares diferentes.
      let res: unknown;
      if (isCloud) {
        const cloud = createCloudApiClient(channel.phoneNumberId!, secret);
        res =
          job.kind === 'text'
            ? await cloud.sendText({ number: job.number, text: job.text ?? '' })
            : await cloud.sendMedia({
                number: job.number,
                mediatype: job.mediatype ?? 'document',
                media: job.media ?? '',
                mimetype: job.mimetype,
                fileName: job.fileName,
                caption: job.caption,
              });
      } else {
        const client = createEvolutionClient(channel.baseUrl, secret);
        res =
          job.kind === 'text'
            ? await client.sendText(channel.instanceName, {
                number: job.number,
                text: job.text ?? '',
              })
            : await client.sendMedia(channel.instanceName, {
                number: job.number,
                mediatype: job.mediatype ?? 'document',
                media: job.media ?? '',
                mimetype: job.mimetype,
                fileName: job.fileName,
                caption: job.caption,
              });
      }

      const waMessageId = isCloud
        ? ((res as { messages?: { id?: string }[] }).messages?.[0]?.id ?? null)
        : ((res as { key?: { id?: string } }).key?.id ?? null);
      const now = new Date();
      try {
        await prisma.message.update({
          where: { id: job.messageId },
          data: { status: 'SENT', sentAt: now, ...(waMessageId ? { waMessageId } : {}) },
        });
      } catch (err) {
        // waMessageId já registrado por um webhook fromMe — atualiza só o status.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          await prisma.message.update({
            where: { id: job.messageId },
            data: { status: 'SENT', sentAt: now },
          });
        } else {
          throw err;
        }
      }

      broadcastToTenant(job.tenantId, 'message.status', {
        messageId: job.messageId,
        status: 'SENT',
      });
    } catch (err) {
      logger.error(
        { err, messageId: job.messageId, channelId: job.channelId },
        'falha ao enviar mensagem (token/baseUrl/conexão?)',
      );
      await prisma.message.update({
        where: { id: job.messageId },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      });
      broadcastToTenant(job.tenantId, 'message.status', {
        messageId: job.messageId,
        status: 'FAILED',
      });
      throw err; // permite retry pelo BullMQ
    }
  });
}
