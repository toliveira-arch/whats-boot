import { prisma } from '../../lib/prisma';
import { listRecentActivity } from '../events/events.service';

export interface TrendKpi {
  value: number;
  /** Variação % vs período anterior de mesmo tamanho. null = sem base de comparação. */
  deltaPct: number | null;
}

export interface DashboardMetrics {
  period: { days: number };
  kpis: {
    attendedClients: TrendKpi;
    leadsInProgress: TrendKpi;
    qualified: TrendKpi;
    disqualified: TrendKpi;
    advances: TrendKpi;
    openConversations: TrendKpi;
  };
  channels: { total: number; connected: number };
  agents: { total: number; online: number };
  messages: { last24h: number };
  contacts: { total: number };
  funnel: {
    newLeads: number;
    responded: number;
    inProgress: number;
    qualified: number;
    disqualified: number;
  };
  conversionRatePct: number;
  lossReasons: { label: string; count: number; pct: number }[];
  recentActivity: { id: string; type: string; title: string; subtitle: string; at: string }[];
  series: { messagesPerDay: { date: string; inbound: number; outbound: number }[] };
  generatedAt: string;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Variação percentual entre dois períodos (null quando não há base). */
function delta(cur: number, prev: number): number | null {
  if (prev === 0) return cur > 0 ? 100 : null;
  return Math.round(((cur - prev) / prev) * 100);
}

/** Agrupa os motivos reais do gate SDR em rótulos legíveis. */
function categorizeReason(raw: string): string {
  const s = raw.toLowerCase();
  if (s.startsWith('faturamento')) return 'Faturamento abaixo do piso';
  if (s.includes('decisor')) return 'Não é o decisor';
  if (s.includes('cnpj')) return 'Sem CNPJ';
  if (s.includes('ramo')) return 'Ramo fora do perfil';
  return 'Outros';
}

/** Filtro por empresa (cliente): aplicado quando um companyId é informado. */
function companyFilter(companyId?: string | null): { companyId?: string } {
  return companyId ? { companyId } : {};
}

/** Conta leads (conversas) por veredito num intervalo, via um único groupBy. */
async function verdictCounts(
  gte: Date,
  lt: Date,
  companyId?: string | null,
): Promise<{ inProgress: number; qualified: number; disqualified: number }> {
  const rows = await prisma.conversation.groupBy({
    by: ['leadVerdict'],
    where: { deletedAt: null, createdAt: { gte, lt }, ...companyFilter(companyId) },
    _count: { _all: true },
  });
  const out = { inProgress: 0, qualified: 0, disqualified: 0 };
  for (const r of rows) {
    const c = r._count._all;
    if (r.leadVerdict === 'QUALIFIED') out.qualified = c;
    else if (r.leadVerdict === 'DISQUALIFIED') out.disqualified = c;
    else if (r.leadVerdict === 'IN_PROGRESS') out.inProgress = c;
  }
  return out;
}

/** Métricas de um intervalo (por data de criação da conversa/lead). */
async function windowStats(gte: Date, lt: Date, companyId?: string | null) {
  const cf = companyFilter(companyId);
  const [verdicts, attended, responded, open, newLeads] = await Promise.all([
    verdictCounts(gte, lt, companyId),
    prisma.conversation.findMany({
      where: { deletedAt: null, createdAt: { gte, lt }, ...cf },
      select: { contactId: true },
      distinct: ['contactId'],
    }),
    prisma.conversation.count({
      where: { deletedAt: null, createdAt: { gte, lt }, firstResponseAt: { not: null }, ...cf },
    }),
    prisma.conversation.count({
      where: { deletedAt: null, createdAt: { gte, lt }, status: 'OPEN', ...cf },
    }),
    prisma.conversation.count({ where: { deletedAt: null, createdAt: { gte, lt }, ...cf } }),
  ]);
  return {
    attendedClients: attended.length,
    leadsInProgress: verdicts.inProgress,
    qualified: verdicts.qualified,
    disqualified: verdicts.disqualified,
    advances: responded,
    openConversations: open,
    newLeads,
  };
}

/**
 * Calcula as métricas do dashboard a partir do banco (isoladas por tenant pelo
 * guard do Prisma). Nenhum dado fictício — tudo vem de consultas reais.
 * Escopado ao período informado (`days`, padrão 7); os KPIs comparam com o
 * período imediatamente anterior de mesmo tamanho. Deve ser chamado dentro de
 * um contexto de tenant (runWithTenant).
 */
export async function getMetrics(days = 7, companyId?: string | null): Promise<DashboardMetrics> {
  const span = Math.min(Math.max(1, Math.round(days)), 90);
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const last24h = new Date(now.getTime() - dayMs);
  const windowStart = new Date(now.getTime() - span * dayMs);
  const prevStart = new Date(now.getTime() - 2 * span * dayMs);
  const cf = companyFilter(companyId);

  const [
    cur,
    prev,
    channelsTotal,
    channelsConnected,
    agentsTotal,
    agentsOnline,
    contactsTotal,
    msgLast24h,
    lossRows,
    recentRows,
  ] = await Promise.all([
    windowStats(windowStart, now, companyId),
    windowStats(prevStart, windowStart, companyId),
    prisma.evolutionInstance.count({ where: { deletedAt: null, ...cf } }),
    prisma.evolutionInstance.count({ where: { deletedAt: null, status: 'CONNECTED', ...cf } }),
    // Atendentes são do tenant (não são por empresa), então não filtram por empresa.
    prisma.membership.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
    prisma.membership.count({
      where: { deletedAt: null, status: 'ACTIVE', agentProfile: { status: 'AVAILABLE' } },
    }),
    prisma.contact.count({ where: { deletedAt: null, ...cf } }),
    prisma.message.count({ where: { deletedAt: null, createdAt: { gte: last24h }, ...cf } }),
    prisma.conversation.findMany({
      where: {
        deletedAt: null,
        createdAt: { gte: windowStart, lt: now },
        leadVerdict: 'DISQUALIFIED',
        ...cf,
      },
      select: { qualification: true },
    }),
    prisma.conversation.findMany({
      where: { deletedAt: null, ...cf },
      orderBy: { updatedAt: 'desc' },
      take: 6,
      select: {
        id: true,
        status: true,
        leadVerdict: true,
        qualification: true,
        updatedAt: true,
        contact: { select: { name: true, pushName: true } },
        company: { select: { name: true } },
      },
    }),
  ]);

  // Motivo da perda: cada lead desqualificado conta uma vez pelo 1º motivo real.
  const lossTally = new Map<string, number>();
  for (const row of lossRows) {
    const q = row.qualification as { reasons?: unknown } | null;
    const reasons = Array.isArray(q?.reasons) ? (q!.reasons as unknown[]) : [];
    const first = reasons.find((r) => typeof r === 'string') as string | undefined;
    const label = first ? categorizeReason(first) : 'Outros';
    lossTally.set(label, (lossTally.get(label) ?? 0) + 1);
  }
  const lossTotal = Array.from(lossTally.values()).reduce((a, b) => a + b, 0);
  const lossReasons = Array.from(lossTally.entries())
    .map(([label, count]) => ({
      label,
      count,
      pct: lossTotal ? Math.round((count / lossTotal) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // Atividade recente: preferimos o log de eventos real (linha do tempo). Se
  // ainda não houver eventos (base antiga), caímos no estado atual das conversas.
  const eventActivity = await listRecentActivity(companyId ?? null, 8);
  const derivedActivity = recentRows.map((r) => {
    const q = r.qualification as { campaignName?: string; reasons?: unknown } | null;
    const contactName = r.contact?.name ?? r.contact?.pushName ?? 'Contato';
    const company = r.company?.name ?? '';
    let type = 'conversation';
    let title = 'Conversa aberta';
    let subtitle = contactName;
    if (r.leadVerdict === 'QUALIFIED') {
      type = 'qualified';
      title = 'Novo lead qualificado';
      subtitle = `${contactName}${q?.campaignName ? ` · ${q.campaignName}` : company ? ` · ${company}` : ''}`;
    } else if (r.leadVerdict === 'DISQUALIFIED') {
      type = 'disqualified';
      title = 'Lead desqualificado';
      const reasons = Array.isArray(q?.reasons) ? (q!.reasons as unknown[]) : [];
      const first = reasons.find((x) => typeof x === 'string') as string | undefined;
      subtitle = `${contactName}${first ? ` · ${categorizeReason(first)}` : ''}`;
    } else if (r.leadVerdict === 'IN_PROGRESS') {
      type = 'in_progress';
      title = 'Lead em atendimento';
      subtitle = `${contactName}${q?.campaignName ? ` · ${q.campaignName}` : ''}`;
    }
    return { id: r.id, type, title, subtitle, at: r.updatedAt.toISOString() };
  });
  const recentActivity = eventActivity.length ? eventActivity : derivedActivity;

  // Série de mensagens (entrada/saída) por dia — últimos 7 dias.
  const dayDefs: { date: string; start: Date; end: Date }[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const start = startOfDay(new Date(now.getTime() - i * dayMs));
    const end = new Date(start.getTime() + dayMs);
    dayDefs.push({ date: start.toISOString().slice(0, 10), start, end });
  }
  const perDay = await Promise.all(
    dayDefs.map(async (d) => {
      const [inbound, outbound] = await Promise.all([
        prisma.message.count({
          where: {
            deletedAt: null,
            direction: 'INBOUND',
            createdAt: { gte: d.start, lt: d.end },
            ...cf,
          },
        }),
        prisma.message.count({
          where: {
            deletedAt: null,
            direction: 'OUTBOUND',
            createdAt: { gte: d.start, lt: d.end },
            ...cf,
          },
        }),
      ]);
      return { date: d.date, inbound, outbound };
    }),
  );

  const conversionRatePct = cur.newLeads ? Math.round((cur.qualified / cur.newLeads) * 100) : 0;

  const kpi = (c: number, p: number): TrendKpi => ({ value: c, deltaPct: delta(c, p) });

  return {
    period: { days: span },
    kpis: {
      attendedClients: kpi(cur.attendedClients, prev.attendedClients),
      leadsInProgress: kpi(cur.leadsInProgress, prev.leadsInProgress),
      qualified: kpi(cur.qualified, prev.qualified),
      disqualified: kpi(cur.disqualified, prev.disqualified),
      advances: kpi(cur.advances, prev.advances),
      openConversations: kpi(cur.openConversations, prev.openConversations),
    },
    channels: { total: channelsTotal, connected: channelsConnected },
    agents: { total: agentsTotal, online: agentsOnline },
    messages: { last24h: msgLast24h },
    contacts: { total: contactsTotal },
    funnel: {
      newLeads: cur.newLeads,
      responded: cur.advances,
      inProgress: cur.leadsInProgress,
      qualified: cur.qualified,
      disqualified: cur.disqualified,
    },
    conversionRatePct,
    lossReasons,
    recentActivity,
    series: { messagesPerDay: perDay },
    generatedAt: now.toISOString(),
  };
}
