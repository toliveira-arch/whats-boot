import { prisma, getTenantContext } from '@whats-boot/database';
import { HttpError } from '../../middlewares/error';
import { broadcastToTenant } from '../../realtime/emitter';
import { recordEvent } from '../events/events.service';

function tenantId(): string {
  const id = getTenantContext()?.tenantId;
  if (!id) throw new HttpError(500, 'Contexto de tenant ausente');
  return id;
}

// Pipeline fixo do CRM (MVP). A etapa é derivada do veredito quando não há
// etapa manual definida; assim que o usuário move o card, vira manual.
export const CRM_STAGES = [
  { key: 'NEW', label: 'Novo' },
  { key: 'IN_PROGRESS', label: 'Em qualificação' },
  { key: 'QUALIFIED', label: 'Qualificado (MQL)' },
  { key: 'NEGOTIATION', label: 'Em negociação' },
  { key: 'WON', label: 'Ganho' },
  { key: 'LOST', label: 'Perdido' },
] as const;

export const CRM_STAGE_KEYS: string[] = CRM_STAGES.map((s) => s.key);
const STAGE_LABEL = new Map<string, string>(CRM_STAGES.map((s) => [s.key, s.label]));

function deriveStage(verdict: string | null): string {
  if (verdict === 'QUALIFIED') return 'QUALIFIED';
  if (verdict === 'DISQUALIFIED') return 'LOST';
  if (verdict === 'IN_PROGRESS') return 'IN_PROGRESS';
  return 'NEW';
}

interface QualShape {
  campaignName?: string;
  summary?: string;
  interest?: string;
  urgency?: string;
  collected?: Record<string, unknown>;
}

function toLead(c: {
  id: string;
  crmStage: string | null;
  leadVerdict: string | null;
  status: string;
  qualification: unknown;
  lastMessageAt: Date | null;
  lastInboundAt: Date | null;
  createdAt: Date;
  contact: { name: string | null; pushName: string | null; phoneNumber: string | null };
  company: { name: string } | null;
  assignedTo: { user: { name: string } } | null;
}) {
  const q = (c.qualification as QualShape | null) ?? {};
  const stage = c.crmStage ?? deriveStage(c.leadVerdict);
  const last = c.lastMessageAt ?? c.createdAt;
  const stalledDays = Math.floor((Date.now() - last.getTime()) / 86_400_000);
  return {
    id: c.id,
    stage,
    stageLabel: STAGE_LABEL.get(stage) ?? stage,
    verdict: c.leadVerdict,
    status: c.status,
    name: c.contact.name ?? c.contact.pushName ?? 'Contato',
    phone: c.contact.phoneNumber,
    company: c.company?.name ?? null,
    campaign: q.campaignName ?? null,
    summary: q.summary ?? null,
    interest: q.interest ?? null,
    urgency: q.urgency ?? null,
    faturamento: q.collected?.faturamento != null ? String(q.collected.faturamento) : null,
    assignedTo: c.assignedTo?.user.name ?? null,
    lastMessageAt: c.lastMessageAt,
    stalledDays,
    createdAt: c.createdAt,
  };
}

export type Lead = ReturnType<typeof toLead>;

export async function listLeads(params: { companyId?: string | null; q?: string; limit?: number }) {
  const limit = Math.min(params.limit ?? 500, 1000);
  const rows = await prisma.conversation.findMany({
    where: {
      deletedAt: null,
      ...(params.companyId ? { companyId: params.companyId } : {}),
      ...(params.q
        ? {
            contact: {
              OR: [
                { name: { contains: params.q, mode: 'insensitive' } },
                { pushName: { contains: params.q, mode: 'insensitive' } },
                { phoneNumber: { contains: params.q } },
              ],
            },
          }
        : {}),
    },
    orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
    take: limit,
    select: {
      id: true,
      crmStage: true,
      leadVerdict: true,
      status: true,
      qualification: true,
      lastMessageAt: true,
      lastInboundAt: true,
      createdAt: true,
      contact: { select: { name: true, pushName: true, phoneNumber: true } },
      company: { select: { name: true } },
      assignedTo: { select: { user: { select: { name: true } } } },
    },
  });
  return rows.map(toLead);
}

export async function setStage(conversationId: string, stage: string): Promise<Lead> {
  if (!CRM_STAGE_KEYS.includes(stage)) throw new HttpError(400, 'Etapa inválida');
  const existing = await prisma.conversation.findFirst({
    where: { id: conversationId, deletedAt: null },
    select: { id: true, crmStage: true, leadVerdict: true },
  });
  if (!existing) throw new HttpError(404, 'Lead não encontrado');
  const from = existing.crmStage ?? deriveStage(existing.leadVerdict);

  await prisma.conversation.update({ where: { id: conversationId }, data: { crmStage: stage } });
  if (from !== stage) {
    await recordEvent({
      conversationId,
      type: 'CRM_STAGE_CHANGED',
      data: { from: STAGE_LABEL.get(from) ?? from, to: STAGE_LABEL.get(stage) ?? stage },
    });
  }
  broadcastToTenant(tenantId(), 'crm.updated', { conversationId, stage });

  const row = await prisma.conversation.findFirst({
    where: { id: conversationId },
    select: {
      id: true,
      crmStage: true,
      leadVerdict: true,
      status: true,
      qualification: true,
      lastMessageAt: true,
      lastInboundAt: true,
      createdAt: true,
      contact: { select: { name: true, pushName: true, phoneNumber: true } },
      company: { select: { name: true } },
      assignedTo: { select: { user: { select: { name: true } } } },
    },
  });
  return toLead(row!);
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

export async function exportCsv(params: {
  companyId?: string | null;
  q?: string;
}): Promise<string> {
  const leads = await listLeads({ ...params, limit: 1000 });
  const header = [
    'Nome',
    'Telefone',
    'Empresa',
    'Etapa',
    'Veredito',
    'Campanha',
    'Faturamento',
    'Interesse',
    'Urgência',
    'Responsável',
    'Última mensagem',
    'Dias parado',
    'Resumo',
  ];
  const lines = leads.map((l) =>
    [
      l.name,
      l.phone,
      l.company,
      l.stageLabel,
      l.verdict,
      l.campaign,
      l.faturamento,
      l.interest,
      l.urgency,
      l.assignedTo,
      l.lastMessageAt ? new Date(l.lastMessageAt).toLocaleString('pt-BR') : '',
      l.stalledDays,
      l.summary,
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.map(csvCell).join(','), ...lines].join('\n');
}
