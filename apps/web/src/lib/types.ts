export interface TrendKpi {
  value: number;
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

export interface Profile {
  user: { id: string; name: string; email: string; avatarUrl: string | null };
  tenant: { id: string; name: string; slug: string };
  role: { key: string; name: string };
  permissions: string[];
}
