import { prisma, runWithTenant, Prisma } from '@whats-boot/database';
import { logger } from '../../lib/logger';
import { broadcastToTenant } from '../../realtime/emitter';
import { enqueueOrRun, QUEUE_NAMES } from '../../queues';
import { generateReplyJob } from '../ai/ai.service';
import { recordEvent } from '../events/events.service';
import { transcribeInboundAudio } from '../ai/transcription.service';
import { sendDisconnectAlert } from './channels.service';
import { normalizeBrPhone, phoneVariants } from '../integrations/dispatch';
import {
  extractText,
  mapAckStatus,
  mapConnectionState,
  mapMessageType,
  normalizeEvent,
  type EvolutionWebhookPayload,
} from './evolution.types';

export interface InboundJob {
  channelId: string;
  tenantId: string;
  payload: EvolutionWebhookPayload;
}

function jidToPhone(jid: string): string {
  return jid.split('@')[0] ?? jid;
}

type Channel = {
  id: string;
  companyId: string;
  tenantId: string;
  aiEnabled: boolean;
  instanceName: string;
  baseUrl: string;
  apiKeyEncrypted: string;
  name: string;
  status: string;
};

async function loadChannel(channelId: string): Promise<Channel | null> {
  return prisma.evolutionInstance.findFirst({
    where: { id: channelId },
    select: {
      id: true,
      companyId: true,
      tenantId: true,
      aiEnabled: true,
      instanceName: true,
      baseUrl: true,
      apiKeyEncrypted: true,
      name: true,
      status: true,
    },
  });
}

async function upsertContact(channel: Channel, remoteJid: string, pushName?: string) {
  const isGroup = remoteJid.endsWith('@g.us');

  // Grupos / não-telefone: comportamento exato de antes (match por JID cru).
  if (isGroup) {
    return prisma.contact.upsert({
      where: { companyId_waJid: { companyId: channel.companyId, waJid: remoteJid } },
      create: {
        tenantId: channel.tenantId,
        companyId: channel.companyId,
        waJid: remoteJid,
        phoneNumber: jidToPhone(remoteJid),
        pushName: pushName ?? null,
        name: pushName ?? null,
        isGroup: true,
        lastInteractionAt: new Date(),
      },
      update: { pushName: pushName ?? undefined, lastInteractionAt: new Date() },
    });
  }

  // Telefone: casa por VARIANTES (com/sem o 9) — o Baileys às vezes entrega o
  // JID sem o 9º dígito, e o reply do lead precisa cair no contato/conversa que
  // o CRM já criou (senão a trava do robô ignora e ele fica mudo). Nunca compara
  // telefone cru: normaliza + variantes.
  const canonical = normalizeBrPhone(jidToPhone(remoteJid));
  const variants = phoneVariants(jidToPhone(remoteJid));
  const variantJids = variants.map((v) => `${v}@s.whatsapp.net`);

  const existing = variants.length
    ? await prisma.contact.findFirst({
        where: {
          companyId: channel.companyId,
          deletedAt: null,
          isGroup: false,
          OR: [
            { waJid: remoteJid },
            { waJid: { in: variantJids } },
            { phoneNumber: { in: variants } },
          ],
        },
        orderBy: { lastInteractionAt: 'desc' },
      })
    : null;

  if (existing) {
    return prisma.contact.update({
      where: { id: existing.id },
      data: {
        pushName: pushName ?? undefined,
        lastInteractionAt: new Date(),
        // Normaliza o telefone do contato legado (matches futuros estáveis).
        ...(canonical && existing.phoneNumber !== canonical ? { phoneNumber: canonical } : {}),
      },
    });
  }

  // Novo contato: grava o telefone JÁ canônico (normaliza na escrita).
  return prisma.contact.upsert({
    where: { companyId_waJid: { companyId: channel.companyId, waJid: remoteJid } },
    create: {
      tenantId: channel.tenantId,
      companyId: channel.companyId,
      waJid: remoteJid,
      phoneNumber: canonical ?? jidToPhone(remoteJid),
      pushName: pushName ?? null,
      name: pushName ?? null,
      isGroup: false,
      lastInteractionAt: new Date(),
    },
    update: { pushName: pushName ?? undefined, lastInteractionAt: new Date() },
  });
}

async function getOrCreateConversation(channel: Channel, contactId: string, remoteJid: string) {
  const open = await prisma.conversation.findFirst({
    where: {
      contactId,
      evolutionInstanceId: channel.id,
      status: { not: 'CLOSED' },
      deletedAt: null,
    },
    orderBy: { createdAt: 'desc' },
  });
  if (open) return open;

  const created = await prisma.conversation.create({
    data: {
      tenantId: channel.tenantId,
      companyId: channel.companyId,
      contactId,
      evolutionInstanceId: channel.id,
      waRemoteJid: remoteJid,
      status: 'OPEN',
    },
  });
  await recordEvent({
    tenantId: channel.tenantId,
    conversationId: created.id,
    type: 'CREATED',
  });
  return created;
}

async function handleMessageUpsert(channel: Channel, payload: EvolutionWebhookPayload) {
  const data = payload.data;
  const key = data?.key;
  if (!key?.remoteJid || !key.id) return;

  const remoteJid = key.remoteJid;
  const fromMe = Boolean(key.fromMe);
  const waMessageId = key.id;

  const contact = await upsertContact(channel, remoteJid, data?.pushName);
  const conversation = await getOrCreateConversation(channel, contact.id, remoteJid);

  const existing = await prisma.message.findUnique({ where: { waMessageId } });
  if (existing) return; // dedupe

  const msgType = mapMessageType(data?.messageType);
  let content = extractText(data?.message);
  let transcribed = false;

  // Áudio recebido: transcreve para a IA entender e continuar o roteiro.
  if (!fromMe && msgType === 'AUDIO') {
    const transcript = await transcribeInboundAudio({
      channel: {
        instanceName: channel.instanceName,
        baseUrl: channel.baseUrl,
        apiKeyEncrypted: channel.apiKeyEncrypted,
      },
      key: { id: waMessageId, remoteJid, fromMe: false },
      message: data?.message,
    });
    if (transcript) {
      content = transcript;
      transcribed = true;
    }
  }

  const now = new Date();
  await prisma.message.create({
    data: {
      tenantId: channel.tenantId,
      companyId: channel.companyId,
      conversationId: conversation.id,
      contactId: contact.id,
      evolutionInstanceId: channel.id,
      direction: fromMe ? 'OUTBOUND' : 'INBOUND',
      authorType: fromMe ? 'AGENT' : 'CONTACT',
      type: msgType,
      content,
      waMessageId,
      status: fromMe ? 'SENT' : 'DELIVERED',
      metadata: (data?.message ?? undefined) as Prisma.InputJsonValue | undefined,
      sentAt: fromMe ? now : null,
    },
  });

  const setFirstResponse =
    fromMe && conversation.firstResponseAt === null && conversation.lastInboundAt !== null;

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: now,
      ...(fromMe
        ? { lastOutboundAt: now, ...(setFirstResponse ? { firstResponseAt: now } : {}) }
        : { lastInboundAt: now, unreadCount: { increment: 1 } }),
    },
  });

  broadcastToTenant(channel.tenantId, 'message.created', {
    conversationId: conversation.id,
    contactId: contact.id,
    channelId: channel.id,
    direction: fromMe ? 'OUTBOUND' : 'INBOUND',
    content,
    transcribed,
    waMessageId,
  });
  broadcastToTenant(channel.tenantId, 'conversation.updated', { conversationId: conversation.id });

  // Dispara a IA para mensagens recebidas (o agente decide se/como responde).
  // Curto-circuito: se a instância tem a IA desligada, nem enfileira.
  if (!fromMe && channel.aiEnabled) {
    await enqueueOrRun(
      QUEUE_NAMES.aiProcess,
      { conversationId: conversation.id, tenantId: channel.tenantId },
      { jobId: `ai:${waMessageId}` },
      generateReplyJob,
    );
  }
}

async function handleMessagesUpdate(channel: Channel, payload: EvolutionWebhookPayload) {
  const data = payload.data;
  const waMessageId = data?.keyId ?? data?.key?.id;
  const status = mapAckStatus(data?.status);
  if (!waMessageId || !status) return;

  const message = await prisma.message.findUnique({
    where: { waMessageId },
    select: { id: true, conversationId: true },
  });
  if (!message) return;

  const now = new Date();
  await prisma.message.update({
    where: { id: message.id },
    data: {
      status,
      ...(status === 'DELIVERED' ? { deliveredAt: now } : {}),
      ...(status === 'READ' ? { readAt: now } : {}),
    },
  });
  await prisma.messageStatusEvent.create({
    data: { tenantId: channel.tenantId, messageId: message.id, status },
  });

  broadcastToTenant(channel.tenantId, 'message.status', {
    messageId: message.id,
    conversationId: message.conversationId,
    status,
  });
}

async function handleConnectionUpdate(channel: Channel, payload: EvolutionWebhookPayload) {
  const prev = channel.status;
  const status = mapConnectionState(payload.data?.state);
  await prisma.evolutionInstance.update({
    where: { id: channel.id },
    data: {
      status,
      ...(status === 'CONNECTED' ? { connectedAt: new Date() } : {}),
      ...(status === 'DISCONNECTED' ? { disconnectedAt: new Date() } : {}),
    },
  });
  broadcastToTenant(channel.tenantId, 'channel.status', { channelId: channel.id, status });

  // Alerta: caiu a conexão (transição para DESCONECTADO).
  if (status === 'DISCONNECTED' && prev !== 'DISCONNECTED') {
    await alertChannelDisconnected(channel);
  }
}

/** Avisa (painel + WhatsApp) que um canal desconectou. */
async function alertChannelDisconnected(channel: Channel): Promise<void> {
  broadcastToTenant(channel.tenantId, 'channel.alert', {
    channelId: channel.id,
    name: channel.name,
    at: new Date().toISOString(),
  });
  const res = await sendDisconnectAlert({
    tenantId: channel.tenantId,
    channelName: channel.name,
    excludeChannelId: channel.id,
  });
  if (!res.ok) {
    logger.warn(
      { channelId: channel.id, reason: res.reason },
      'alerta de desconexão por WhatsApp não enviado',
    );
  }
}

async function handleQrcodeUpdated(channel: Channel, payload: EvolutionWebhookPayload) {
  const base64 = payload.data?.qrcode?.base64 ?? payload.data?.base64 ?? null;
  await prisma.evolutionInstance.update({
    where: { id: channel.id },
    data: { status: 'QRCODE', qrCode: base64 },
  });
  broadcastToTenant(channel.tenantId, 'channel.qrcode', { channelId: channel.id, base64 });
}

function handlePresenceUpdate(channel: Channel, payload: EvolutionWebhookPayload) {
  broadcastToTenant(channel.tenantId, 'presence', {
    channelId: channel.id,
    presences: payload.data?.presences ?? null,
  });
}

/** Processa um evento de webhook (executado pelo worker). */
export async function processInboundEvent(job: InboundJob): Promise<void> {
  await runWithTenant(job.tenantId, async () => {
    const channel = await loadChannel(job.channelId);
    if (!channel) {
      logger.warn({ channelId: job.channelId }, 'canal não encontrado ao processar webhook');
      return;
    }

    const event = normalizeEvent(job.payload.event ?? '');
    switch (event) {
      case 'MESSAGES_UPSERT':
        await handleMessageUpsert(channel, job.payload);
        break;
      case 'MESSAGES_UPDATE':
        await handleMessagesUpdate(channel, job.payload);
        break;
      case 'CONNECTION_UPDATE':
        await handleConnectionUpdate(channel, job.payload);
        break;
      case 'QRCODE_UPDATED':
        await handleQrcodeUpdated(channel, job.payload);
        break;
      case 'PRESENCE_UPDATE':
        handlePresenceUpdate(channel, job.payload);
        break;
      default:
        logger.debug({ event }, 'evento de webhook ignorado');
    }

    // Marca o evento como processado.
    await prisma.webhookEvent.updateMany({
      where: {
        evolutionInstanceId: channel.id,
        externalId: job.payload.data?.key?.id ?? null,
        status: 'RECEIVED',
      },
      data: { status: 'PROCESSED', processedAt: new Date() },
    });
  });
}
