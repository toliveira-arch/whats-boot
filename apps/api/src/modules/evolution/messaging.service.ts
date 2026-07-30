import { prisma, runWithTenant, Prisma } from '@whats-boot/database';
import { HttpError } from '../../middlewares/error';
import { decryptSecret } from '../../lib/crypto';
import { broadcastToTenant } from '../../realtime/emitter';
import { enqueueOrRun, QUEUE_NAMES } from '../../queues';
import { createEvolutionClient, type SendMediaBody } from './evolution.client';

type MediaType = SendMediaBody['mediatype'];

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
  const conversation =
    open ??
    (await prisma.conversation.create({
      data: {
        tenantId: channel.tenantId,
        companyId: channel.companyId,
        contactId: contact.id,
        evolutionInstanceId: channel.id,
        waRemoteJid: waJid,
        status: 'OPEN',
      },
    }));

  return { contact, conversation };
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
  membershipId: string;
  channelId: string;
  number: string;
  mediatype: MediaType;
  media: string;
  mimetype?: string;
  fileName?: string;
  caption?: string;
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
      authorType: 'AGENT',
      authorMembershipId: input.membershipId,
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

/** Processa o envio (executado pelo worker): chama a Evolution e atualiza o status. */
export async function processOutbound(job: OutboundJob): Promise<void> {
  await runWithTenant(job.tenantId, async () => {
    const channel = await prisma.evolutionInstance.findFirst({
      where: { id: job.channelId },
      select: { instanceName: true, baseUrl: true, apiKeyEncrypted: true },
    });
    if (!channel) {
      await prisma.message.update({
        where: { id: job.messageId },
        data: { status: 'FAILED', failedAt: new Date(), errorMessage: 'Canal inexistente' },
      });
      return;
    }

    const client = createEvolutionClient(channel.baseUrl, decryptSecret(channel.apiKeyEncrypted));

    try {
      const res =
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

      const waMessageId = (res as { key?: { id?: string } }).key?.id ?? null;
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
