import { prisma } from '@whats-boot/database';
import { logger } from '../../lib/logger';
import { broadcastToTenant } from '../../realtime/emitter';
import * as messaging from '../evolution/messaging.service';

/** Normaliza telefone BR: só dígitos, com DDI 55. */
export function normalizeBrPhone(raw: unknown): string | null {
  if (!raw) return null;
  const d = String(raw).replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('55') && d.length >= 12) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

export interface DispatchInput {
  tenantId: string;
  companyId: string | null;
  channelId: string | null;
  name: string | null;
  phone: string;
  openingMessage: string;
  handoffToSdr: boolean;
}

export interface DispatchResult {
  status: 'sent' | 'failed';
  detail?: string;
}

/**
 * Núcleo compartilhado das integrações de ENTRADA (RD Station, Kommo, …):
 * escolhe o canal, dispara a 1ª mensagem, marca a conversa como origem CRM
 * (para a trava do robô) e a coloca no CRM ao vivo.
 */
export async function dispatchLead(input: DispatchInput): Promise<DispatchResult> {
  const channel =
    (input.channelId
      ? await prisma.evolutionInstance.findFirst({
          where: { id: input.channelId, deletedAt: null },
        })
      : null) ??
    (await prisma.evolutionInstance.findFirst({
      where: { deletedAt: null, ...(input.companyId ? { companyId: input.companyId } : {}) },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    }));
  if (!channel) return { status: 'failed', detail: 'no-channel' };

  const text = input.openingMessage.replace(/\{\{\s*nome\s*\}\}/gi, input.name ?? 'tudo bem');
  try {
    const sent = await messaging.sendText({
      tenantId: input.tenantId,
      channelId: channel.id,
      number: input.phone,
      text,
      authorType: 'AI',
    });
    // Origem CRM (a trava do robô só atende leads assim) e, se não for handoff,
    // desliga a IA nessa conversa.
    await prisma.conversation.update({
      where: { id: sent.conversationId },
      data: { origin: 'CRM', ...(input.handoffToSdr ? {} : { aiEnabled: false }) },
    });
    broadcastToTenant(input.tenantId, 'crm.updated', {
      conversationId: sent.conversationId,
      stage: 'NEW',
    });
    return { status: 'sent', detail: channel.name };
  } catch (err) {
    logger.error({ err, tenantId: input.tenantId }, 'dispatchLead: falha ao enviar mensagem');
    return { status: 'failed', detail: 'send-error' };
  }
}
