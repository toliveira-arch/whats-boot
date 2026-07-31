import {
  prisma,
  getTenantContext,
  type Prisma,
  type ConversationEventType,
} from '@whats-boot/database';
import { broadcastToTenant } from '../../realtime/emitter';
import { logger } from '../../lib/logger';

export type EventType = ConversationEventType;

interface RecordEventInput {
  /** Se não informado, usa o tenant do contexto atual. */
  tenantId?: string;
  conversationId: string;
  type: EventType;
  data?: Record<string, unknown>;
  actorMembershipId?: string | null;
}

/** Rótulo legível de cada tipo de evento (para a linha do tempo / atividade). */
function titleOf(type: EventType, data: Record<string, unknown>): string {
  switch (type) {
    case 'CREATED':
      return 'Conversa aberta';
    case 'LEAD_ADVANCED':
      return 'Lead avançou no roteiro';
    case 'LEAD_QUALIFIED':
      return 'Novo lead qualificado';
    case 'LEAD_DISQUALIFIED':
      return 'Lead desqualificado';
    case 'HANDOFF':
      return 'Encaminhado para atendente';
    case 'ASSIGNED':
      return 'Atribuída a atendente';
    case 'UNASSIGNED':
      return 'Atribuição removida';
    case 'AI_ENABLED':
      return 'IA ativada';
    case 'AI_DISABLED':
      return 'IA desativada';
    case 'CLOSED':
      return 'Conversa encerrada';
    case 'REOPENED':
      return 'Conversa reaberta';
    case 'STATUS_CHANGED':
      return `Status: ${String(data.to ?? '—')}`;
    case 'MEMORY_RESET':
      return 'Memória reiniciada (teste)';
    default:
      return String(type);
  }
}

/** Tipo "curto" usado pelo front para escolher o ícone. */
function kindOf(type: EventType): string {
  switch (type) {
    case 'LEAD_QUALIFIED':
      return 'qualified';
    case 'LEAD_DISQUALIFIED':
      return 'disqualified';
    case 'LEAD_ADVANCED':
      return 'in_progress';
    case 'HANDOFF':
    case 'ASSIGNED':
      return 'handoff';
    case 'AI_ENABLED':
    case 'AI_DISABLED':
      return 'ai';
    default:
      return 'conversation';
  }
}

/**
 * Grava um evento de conversa (linha do tempo real) e o transmite ao vivo.
 * Nunca lança — um evento é telemetria, não deve quebrar o fluxo principal.
 */
export async function recordEvent(input: RecordEventInput): Promise<void> {
  const tenantId = input.tenantId ?? getTenantContext()?.tenantId;
  if (!tenantId) {
    logger.warn({ conversationId: input.conversationId }, 'recordEvent sem tenant — ignorado');
    return;
  }
  try {
    const ev = await prisma.conversationEvent.create({
      data: {
        tenantId,
        conversationId: input.conversationId,
        type: input.type,
        actorMembershipId: input.actorMembershipId ?? null,
        ...(input.data ? { data: input.data as Prisma.InputJsonValue } : {}),
      },
    });
    broadcastToTenant(tenantId, 'activity.created', {
      id: ev.id,
      conversationId: input.conversationId,
      type: input.type,
      kind: kindOf(input.type),
      title: titleOf(input.type, input.data ?? {}),
      at: ev.createdAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err, type: input.type }, 'falha ao gravar evento de conversa');
  }
}

const nameOf = (c: { name: string | null; pushName: string | null } | null): string =>
  c?.name ?? c?.pushName ?? 'Contato';

/** Linha do tempo de uma conversa (mais recentes primeiro). */
export async function listConversationEvents(conversationId: string) {
  const events = await prisma.conversationEvent.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { actor: { include: { user: { select: { name: true } } } } },
  });
  return events.map((e) => {
    const data = (e.data as Record<string, unknown> | null) ?? {};
    return {
      id: e.id,
      type: e.type,
      kind: kindOf(e.type),
      title: titleOf(e.type, data),
      detail: typeof data.detail === 'string' ? data.detail : null,
      actorName: e.actor?.user.name ?? null,
      at: e.createdAt.toISOString(),
    };
  });
}

/** Atividade recente do tenant (opcionalmente por empresa) para o dashboard. */
export async function listRecentActivity(companyId: string | null, limit = 8) {
  const events = await prisma.conversationEvent.findMany({
    where: companyId ? { conversation: { companyId } } : {},
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      conversation: {
        select: {
          contact: { select: { name: true, pushName: true } },
          company: { select: { name: true } },
        },
      },
    },
  });
  return events.map((e) => {
    const data = (e.data as Record<string, unknown> | null) ?? {};
    const contactName = nameOf(e.conversation?.contact ?? null);
    const extra =
      (typeof data.campaignName === 'string' && data.campaignName) ||
      (typeof data.reason === 'string' && data.reason) ||
      e.conversation?.company?.name ||
      '';
    return {
      id: e.id,
      type: kindOf(e.type),
      title: titleOf(e.type, data),
      subtitle: extra ? `${contactName} · ${extra}` : contactName,
      at: e.createdAt.toISOString(),
    };
  });
}
