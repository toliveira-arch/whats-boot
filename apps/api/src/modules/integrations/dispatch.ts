import { prisma, Prisma } from '@whats-boot/database';
import { logger } from '../../lib/logger';
import { broadcastToTenant } from '../../realtime/emitter';
import { recordEvent } from '../events/events.service';
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

/**
 * Normaliza telefone BR para o canônico de 13 dígitos: DDI 55 + DDD + 9 dígitos.
 * Idempotente (13 dígitos já canônicos passam intactos). Insere o 9º dígito
 * apenas para CELULAR (1º dígito local 6–9); NUNCA para fixo, para não corromper.
 * Regra da rodada: nunca compare telefone cru — sempre passe por aqui primeiro.
 */
export function normalizeBrPhone(raw: unknown): string | null {
  if (raw == null) return null;
  let d = String(raw).replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('0055')) d = d.slice(2); // 00 (saída internacional) + 55 → 55
  if (!d.startsWith('55') && (d.length === 10 || d.length === 11)) d = `55${d}`;
  // 55 + DDD + 8 dígitos: falta o 9 do celular. Insere só se for celular.
  if (d.startsWith('55') && d.length === 12) {
    const ddd = d.slice(2, 4);
    const local = d.slice(4);
    if ('6789'.includes(local.charAt(0))) d = `55${ddd}9${local}`;
  }
  return d;
}

/**
 * Variantes BR de um telefone para LOOKUP por OR (nunca match cru): o WhatsApp/
 * Baileys às vezes entrega o JID do celular SEM o 9º dígito. Gera as DUAS formas
 * equivalentes — com o 9 (13 díg) e sem o 9 (12 díg) — de forma BIDIRECIONAL
 * (independe do heurístico de celular), para casar o reply do lead com o
 * contato/conversa já criados pelo CRM, venha em qual das duas formas vier.
 */
export function phoneVariants(raw: unknown): string[] {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return [];
  if (d.startsWith('0055')) d = d.slice(2);
  if (!d.startsWith('55') && (d.length === 10 || d.length === 11)) d = `55${d}`;
  if (!d.startsWith('55')) return [d];
  const ddd = d.slice(2, 4);
  const local = d.slice(4);
  const set = new Set<string>();
  if (local.length === 9 && local.startsWith('9')) {
    set.add(`55${ddd}${local}`); // 13 díg (com o 9)
    set.add(`55${ddd}${local.slice(1)}`); // 12 díg (sem o 9)
  } else if (local.length === 8) {
    set.add(`55${ddd}${local}`); // 12 díg (sem o 9)
    set.add(`55${ddd}9${local}`); // 13 díg (com o 9)
  } else {
    set.add(d);
  }
  return [...set];
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
  /** Contexto de entrada (RD Marketing etc.) para atendimento consultivo. */
  company?: string | null;
  campaign?: string | null;
  form?: string | null;
  source?: string | null;
  campaignType?: string | null;
  /** Dados já respondidos no formulário (faturamento, regime, cnpj…). */
  collected?: Record<string, unknown> | null;
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

  // Robô do canal desligado ("Robô de IA" em Canais) → não dispara nada.
  // Assim "desligar o robô" fica COMPLETO: sem resposta, sem follow-up e sem
  // abertura de lead novo por este canal.
  if (!channel.aiEnabled) return { status: 'skipped', detail: 'channel-ai-off' };

  // Telefone canônico (13 díg.). Regra da rodada: nunca comparar telefone cru.
  const normalizedPhone = normalizeBrPhone(input.phone);
  if (!normalizedPhone) return { status: 'failed', detail: 'invalid-phone' };
  const waJid = `${normalizedPhone}@s.whatsapp.net`;

  // Idempotência POR ESTADO (sem guard por tempo): garante NO MÁXIMO uma
  // conversa NÃO-TERMINAL por (companyId, normalizedPhone). A trava real é o
  // índice único parcial (ensure-indexes.sql). Reservamos a conversa ANTES de
  // enviar; se a criação colidir (webhook do CRM 2x / add+status / retry), a 1ª
  // mensagem NÃO é enviada de novo — skip por estado, não por tempo.
  const contact = await prisma.contact.upsert({
    where: { companyId_waJid: { companyId: channel.companyId, waJid } },
    create: {
      tenantId: channel.tenantId,
      companyId: channel.companyId,
      waJid,
      phoneNumber: normalizedPhone,
      ...(input.name ? { name: input.name } : {}),
    },
    update: {},
  });

  let reserved: { id: string };
  try {
    reserved = await prisma.conversation.create({
      data: {
        tenantId: channel.tenantId,
        companyId: channel.companyId,
        contactId: contact.id,
        evolutionInstanceId: channel.id,
        waRemoteJid: waJid,
        normalizedPhone,
        origin: 'CRM',
        status: 'OPEN',
      },
      select: { id: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      logger.info(
        { normalizedPhone, companyId: channel.companyId },
        'dispatchLead: já existe conversa ativa para este número — 1ª mensagem duplicada evitada (idempotência por estado)',
      );
      return { status: 'skipped', detail: 'active-conversation-exists' };
    }
    logger.error({ err, tenantId: input.tenantId }, 'dispatchLead: falha ao reservar conversa');
    return { status: 'failed', detail: 'reserve-error' };
  }
  await recordEvent({
    tenantId: channel.tenantId,
    conversationId: reserved.id,
    type: 'CREATED',
  });

  // Variáveis na abertura: {{nome}}, {{campanha}}, {{formulario}}, {{empresa}}.
  const vars: Record<string, string> = {
    nome: input.name ?? 'tudo bem',
    campanha: input.campaign ?? '',
    formulario: input.form ?? '',
    empresa: input.company ?? '',
  };
  const text = input.openingMessage.replace(
    /\{\{\s*(\w+)\s*\}\}/g,
    (_m, k: string) => vars[k.toLowerCase()] ?? '',
  );
  // Contexto de entrada para o robô conduzir de forma consultiva por campanha.
  const entry =
    input.campaign || input.form || input.source || input.company || input.campaignType
      ? {
          campaign: input.campaign ?? null,
          form: input.form ?? null,
          source: input.source ?? null,
          company: input.company ?? null,
          type: input.campaignType ?? null,
        }
      : null;
  try {
    // Reutiliza a conversa já reservada: sendText normaliza o mesmo waJid e o
    // resolveContactAndConversation acha a conversa aberta deste contato/canal.
    const sent = await messaging.sendText({
      tenantId: input.tenantId,
      channelId: channel.id,
      number: normalizedPhone,
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
        ...(entry || (input.collected && Object.keys(input.collected).length)
          ? {
              qualification: {
                entry,
                collected: input.collected ?? {},
              } as Prisma.InputJsonValue,
            }
          : {}),
      },
    });
    broadcastToTenant(input.tenantId, 'crm.updated', {
      conversationId: sent.conversationId,
      stage: 'NEW',
    });
    return { status: 'sent', detail: channel.name };
  } catch (err) {
    // Falha síncrona no envio: LIBERA a reserva (fecha + soft-delete) para o
    // índice parcial não travar um retry legítimo deste lead.
    await prisma.conversation
      .update({
        where: { id: reserved.id },
        data: { status: 'CLOSED', closedAt: new Date(), deletedAt: new Date() },
      })
      .catch(() => undefined);
    logger.error(
      { err, tenantId: input.tenantId },
      'dispatchLead: falha ao enviar mensagem — reserva liberada',
    );
    return { status: 'failed', detail: 'send-error' };
  }
}
