import { prisma } from '../../lib/prisma';

export interface DashboardMetrics {
  conversations: {
    total: number;
    open: number;
    pending: number;
    resolved: number;
    unassigned: number;
  };
  messages: { total: number; last24h: number; inboundLast24h: number; outboundLast24h: number };
  contacts: { total: number };
  channels: { total: number; connected: number };
  agents: { total: number; online: number };
  responseTime: { avgFirstResponseSeconds: number | null };
  series: { messagesPerDay: { date: string; count: number }[] };
  generatedAt: string;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Calcula as métricas do dashboard a partir do banco (isoladas por tenant pelo
 * guard do Prisma). Nenhum dado fictício — tudo vem de consultas reais.
 * Deve ser chamado dentro de um contexto de tenant (runWithTenant).
 */
export async function getMetrics(): Promise<DashboardMetrics> {
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    convTotal,
    convOpen,
    convPending,
    convResolved,
    convUnassigned,
    msgTotal,
    msgLast24h,
    msgInbound24h,
    msgOutbound24h,
    contactsTotal,
    channelsTotal,
    channelsConnected,
    agentsTotal,
    agentsOnline,
    firstResponses,
  ] = await Promise.all([
    prisma.conversation.count({ where: { deletedAt: null } }),
    prisma.conversation.count({ where: { deletedAt: null, status: 'OPEN' } }),
    prisma.conversation.count({ where: { deletedAt: null, status: 'PENDING' } }),
    prisma.conversation.count({ where: { deletedAt: null, status: 'RESOLVED' } }),
    prisma.conversation.count({
      where: { deletedAt: null, assignedToId: null, status: { in: ['OPEN', 'PENDING'] } },
    }),
    prisma.message.count({ where: { deletedAt: null } }),
    prisma.message.count({ where: { deletedAt: null, createdAt: { gte: last24h } } }),
    prisma.message.count({
      where: { deletedAt: null, direction: 'INBOUND', createdAt: { gte: last24h } },
    }),
    prisma.message.count({
      where: { deletedAt: null, direction: 'OUTBOUND', createdAt: { gte: last24h } },
    }),
    prisma.contact.count({ where: { deletedAt: null } }),
    prisma.evolutionInstance.count({ where: { deletedAt: null } }),
    prisma.evolutionInstance.count({ where: { deletedAt: null, status: 'CONNECTED' } }),
    prisma.membership.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
    prisma.membership.count({
      where: { deletedAt: null, status: 'ACTIVE', agentProfile: { status: 'AVAILABLE' } },
    }),
    prisma.conversation.findMany({
      where: { firstResponseAt: { not: null }, createdAt: { gte: last30d } },
      select: { createdAt: true, firstResponseAt: true },
      take: 1000,
    }),
  ]);

  // Tempo médio até a primeira resposta (segundos).
  let avgFirstResponseSeconds: number | null = null;
  if (firstResponses.length > 0) {
    const totalSec = firstResponses.reduce((acc, c) => {
      const diff = (c.firstResponseAt!.getTime() - c.createdAt.getTime()) / 1000;
      return acc + Math.max(0, diff);
    }, 0);
    avgFirstResponseSeconds = Math.round(totalSec / firstResponses.length);
  }

  // Série de mensagens por dia (últimos 7 dias).
  const days: { date: string; start: Date; end: Date }[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const start = startOfDay(new Date(now.getTime() - i * 24 * 60 * 60 * 1000));
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    days.push({ date: start.toISOString().slice(0, 10), start, end });
  }
  const perDayCounts = await Promise.all(
    days.map((d) =>
      prisma.message.count({
        where: { deletedAt: null, createdAt: { gte: d.start, lt: d.end } },
      }),
    ),
  );
  const messagesPerDay = days.map((d, i) => ({ date: d.date, count: perDayCounts[i] ?? 0 }));

  return {
    conversations: {
      total: convTotal,
      open: convOpen,
      pending: convPending,
      resolved: convResolved,
      unassigned: convUnassigned,
    },
    messages: {
      total: msgTotal,
      last24h: msgLast24h,
      inboundLast24h: msgInbound24h,
      outboundLast24h: msgOutbound24h,
    },
    contacts: { total: contactsTotal },
    channels: { total: channelsTotal, connected: channelsConnected },
    agents: { total: agentsTotal, online: agentsOnline },
    responseTime: { avgFirstResponseSeconds },
    series: { messagesPerDay },
    generatedAt: now.toISOString(),
  };
}
