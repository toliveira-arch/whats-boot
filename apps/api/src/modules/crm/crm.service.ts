import { prisma, getTenantContext } from '@whats-boot/database';
import { HttpError } from '../../middlewares/error';
import { broadcastToTenant } from '../../realtime/emitter';
import { recordEvent } from '../events/events.service';
import * as messaging from '../evolution/messaging.service';

function tenantId(): string {
  const id = getTenantContext()?.tenantId;
  if (!id) throw new HttpError(500, 'Contexto de tenant ausente');
  return id;
}

// Pipeline fixo do CRM (MVP). A etapa é derivada do veredito quando não há
// etapa manual definida; assim que o usuário move o card, vira manual.
export const CRM_STAGES = [
  { key: 'NEW', label: 'Lead Novo', desc: 'Novos leads recebidos' },
  { key: 'CONTACTED', label: 'Contato Feito', desc: 'Contato inicial realizado' },
  { key: 'IN_PROGRESS', label: 'Em Andamento', desc: 'Em conversa / Qualificando' },
  { key: 'FOLLOWUP', label: 'Follow up', desc: 'Aguardando retorno' },
  { key: 'QUALIFIED', label: 'Qualificado', desc: 'Lead qualificado (MQL)' },
  { key: 'DISQUALIFIED', label: 'Desqualificado', desc: 'Lead desqualificado' },
] as const;

export const CRM_STAGE_KEYS: string[] = CRM_STAGES.map((s) => s.key);
const STAGE_LABEL = new Map<string, string>(CRM_STAGES.map((s) => [s.key, s.label]));

function deriveStage(verdict: string | null): string {
  if (verdict === 'QUALIFIED') return 'QUALIFIED';
  if (verdict === 'DISQUALIFIED') return 'DISQUALIFIED';
  if (verdict === 'IN_PROGRESS') return 'IN_PROGRESS';
  return 'NEW';
}

// Etapas antigas (versão anterior) → novas, para não perder cards no board.
const LEGACY_STAGE: Record<string, string> = {
  LOST: 'DISQUALIFIED',
  WON: 'QUALIFIED',
  NEGOTIATION: 'IN_PROGRESS',
};

function normalizeStage(stage: string): string {
  const mapped = LEGACY_STAGE[stage] ?? stage;
  return CRM_STAGE_KEYS.includes(mapped) ? mapped : 'NEW';
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
  const stage = normalizeStage(c.crmStage ?? deriveStage(c.leadVerdict));
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
      // CRM só mostra leads que entraram pelo CRM/RD — nunca contatos orgânicos.
      origin: 'CRM',
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

// ---------------------------------------------------------------------------
// Lead de teste — simula um novo lead (como se viesse do RD Station) e faz o
// robô disparar o contato imediato. Serve para validar a ponta a ponta:
// entra o lead → aparece no CRM → robô manda a 1ª mensagem no WhatsApp.
// ---------------------------------------------------------------------------

/** Normaliza telefone BR: só dígitos, com DDI 55. */
function normalizeBrPhone(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('55') && d.length >= 12) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

export interface TestLeadInput {
  phone: string;
  name?: string;
  companyId?: string | null;
}

export async function createTestLead(input: TestLeadInput): Promise<{
  status: string;
  conversationId: string;
  channel: string;
  phone: string;
}> {
  const phone = normalizeBrPhone(input.phone ?? '');
  if (!phone) throw new HttpError(400, 'Informe um telefone válido para o lead de teste.');

  // Precisa de um canal CONECTADO para o robô conseguir enviar de fato.
  const channel = await prisma.evolutionInstance.findFirst({
    where: {
      deletedAt: null,
      status: 'CONNECTED',
      ...(input.companyId ? { companyId: input.companyId } : {}),
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, companyId: true, tenantId: true },
  });
  if (!channel) {
    throw new HttpError(
      400,
      input.companyId
        ? 'Nenhum canal do WhatsApp conectado para esta empresa. Conecte um canal em Canais.'
        : 'Nenhum canal do WhatsApp conectado. Conecte um canal em Canais antes de testar.',
    );
  }

  // Mensagem de abertura: usa a da integração RD da empresa, se houver.
  const integ = await prisma.rdIntegration.findFirst({
    where: { deletedAt: null, companyId: channel.companyId },
    select: { openingMessage: true },
  });
  const displayName = input.name?.trim() || 'Lead de teste';
  const firstName = input.name?.trim() || 'tudo bem';
  const template =
    integ?.openingMessage?.trim() ||
    'Olá {{nome}}! Recebemos seu contato e queremos te ajudar. Podemos falar rapidinho por aqui? 😊';
  const text = template.replace(/\{\{\s*nome\s*\}\}/gi, firstName);

  const sent = await messaging.sendText({
    tenantId: channel.tenantId,
    channelId: channel.id,
    number: phone,
    text,
    authorType: 'AI',
  });

  // Garante o robô ligado na conversa e marca a origem como CRM (a trava do
  // robô só atende leads com origin='CRM').
  await prisma.conversation.update({
    where: { id: sent.conversationId },
    data: { aiEnabled: true, origin: 'CRM' },
  });

  // Identifica o card no CRM como lead de teste.
  const conv = await prisma.conversation.findFirst({
    where: { id: sent.conversationId },
    select: { contactId: true },
  });
  if (conv) {
    await prisma.contact.update({
      where: { id: conv.contactId },
      data: { name: displayName },
    });
  }

  await recordEvent({
    conversationId: sent.conversationId,
    type: 'CREATED',
    data: { source: 'crm-test-lead', channel: channel.name },
  });

  broadcastToTenant(channel.tenantId, 'crm.updated', {
    conversationId: sent.conversationId,
    stage: 'NEW',
  });

  return { status: 'sent', conversationId: sent.conversationId, channel: channel.name, phone };
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
