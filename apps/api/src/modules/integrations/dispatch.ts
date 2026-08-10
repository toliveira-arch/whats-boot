import { prisma } from '@whats-boot/database';
import { logger } from '../../lib/logger';
import { broadcastToTenant } from '../../realtime/emitter';
import * as messaging from '../evolution/messaging.service';

export interface ExtractedLead {
  name: string | null;
  email: string | null;
  phone: string | null;
}

/**
 * Extrai nome/email/telefone de um payload flexível (RD Station, Foresee e
 * outros CRMs via webhook): procura em leads[0]/lead/contact/raiz e aceita
 * várias chaves de telefone.
 */
export function extractLeadFromPayload(payload: Record<string, unknown>): ExtractedLead {
  const p = payload;
  const leadsArr = p.leads as Record<string, unknown>[] | undefined;
  const lead = (leadsArr?.[0] ??
    (p.lead as Record<string, unknown>) ??
    (p.contact as Record<string, unknown>) ??
    (p.data as Record<string, unknown>) ??
    p) as Record<string, unknown>;

  const pick = (obj: Record<string, unknown>, ...keys: string[]): string | null => {
    for (const k of keys) {
      const v = obj?.[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number') return String(v);
    }
    return null;
  };

  const phoneKeys = [
    'mobile_phone',
    'personal_phone',
    'phone',
    'telefone',
    'celular',
    'whatsapp',
    'whatsApp',
    'telefone_celular',
    'fone',
    'phone_number',
  ];
  return {
    name:
      pick(lead, 'name', 'nome', 'first_name', 'nome_completo', 'contact_name') ??
      pick(p, 'name', 'nome'),
    email: pick(lead, 'email', 'e-mail', 'mail') ?? pick(p, 'email'),
    phone: pick(lead, ...phoneKeys) ?? pick(p, ...phoneKeys),
  };
}

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
  /** ID externo do card (ex.: UUID do card no Foresee) para a saída depois. */
  externalCardId?: string | null;
}

/** Procura o UUID do card no payload (campo configurado ou chaves comuns). */
export function extractCardId(
  payload: Record<string, unknown>,
  field?: string | null,
): string | null {
  const p = payload;
  const lead = ((p.lead as Record<string, unknown>) ??
    (p.card as Record<string, unknown>) ??
    (p.data as Record<string, unknown>) ??
    p) as Record<string, unknown>;
  const keys = field
    ? [field]
    : ['card_uuid', 'cardUuid', 'card_id', 'cardId', 'card', 'uuid', 'id'];
  for (const k of keys) {
    const v = lead?.[k] ?? p?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return null;
}

export interface DispatchResult {
  status: 'sent' | 'failed' | 'skipped';
  detail?: string;
}

/** Janela anti-duplicidade da 1ª mensagem (webhook do CRM chega 2x / retries). */
const DEDUPE_WINDOW_MS = 6 * 60 * 60 * 1000; // 6h

async function alreadyContacted(companyId: string, phoneDigits: string): Promise<boolean> {
  const recent = await prisma.message.findFirst({
    where: {
      companyId,
      direction: 'OUTBOUND',
      deletedAt: null,
      createdAt: { gte: new Date(Date.now() - DEDUPE_WINDOW_MS) },
      contact: { phoneNumber: phoneDigits },
    },
    select: { id: true },
  });
  return Boolean(recent);
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

  // Anti-duplicidade: se já mandamos a abertura para este número há pouco
  // (webhook do CRM repetido / add+status / retry), não manda de novo.
  const phoneDigits = input.phone.replace(/\D/g, '');
  if (await alreadyContacted(channel.companyId, phoneDigits)) {
    logger.info(
      { phone: phoneDigits, companyId: channel.companyId },
      'dispatchLead: lead já contatado recentemente — 1ª mensagem duplicada evitada',
    );
    return { status: 'skipped', detail: 'already-contacted' };
  }

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
    // desliga a IA nessa conversa. Guarda o ID do card externo (Foresee) para a saída.
    await prisma.conversation.update({
      where: { id: sent.conversationId },
      data: {
        origin: 'CRM',
        ...(input.handoffToSdr ? {} : { aiEnabled: false }),
        ...(input.externalCardId ? { metadata: { foreseeCardId: input.externalCardId } } : {}),
      },
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
