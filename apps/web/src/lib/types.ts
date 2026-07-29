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

export interface Profile {
  user: { id: string; name: string; email: string; avatarUrl: string | null };
  tenant: { id: string; name: string; slug: string };
  role: { key: string; name: string };
  permissions: string[];
}
