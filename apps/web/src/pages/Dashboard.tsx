import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { authFetch, ApiError } from '../lib/api';
import { getSocket } from '../lib/socket';
import type { DashboardMetrics } from '../lib/types';

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function Kpi({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="kpi">
      <span className="kpi-value">{value}</span>
      <span className="kpi-label">{label}</span>
      {hint && <span className="kpi-hint">{hint}</span>}
    </div>
  );
}

function MessagesChart({ data }: { data: { date: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="chart">
      {data.map((d) => (
        <div key={d.date} className="bar-col" title={`${d.date}: ${d.count}`}>
          <div className="bar" style={{ height: `${(d.count / max) * 100}%` }} />
          <span className="bar-label">{d.date.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

export function Dashboard() {
  const { profile } = useAuth();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let active = true;

    authFetch<DashboardMetrics>('/dashboard/metrics')
      .then((m) => active && setMetrics(m))
      .catch(
        (err) => active && setError(err instanceof ApiError ? err.message : 'Erro ao carregar'),
      );

    const socket = getSocket();
    if (socket) {
      const onMetrics = (m: DashboardMetrics) => setMetrics(m);
      const onConnect = () => setLive(true);
      const onDisconnect = () => setLive(false);
      socket.on('dashboard:metrics', onMetrics);
      socket.on('connect', onConnect);
      socket.on('disconnect', onDisconnect);
      setLive(socket.connected);
      socket.emit('dashboard:subscribe');
      return () => {
        active = false;
        socket.off('dashboard:metrics', onMetrics);
        socket.off('connect', onConnect);
        socket.off('disconnect', onDisconnect);
      };
    }
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="dash">
      <header className="dash-top">
        <div>
          <h1>Dashboard</h1>
          <p className="sub">
            {profile?.tenant.name} · {profile?.role.name}
          </p>
        </div>
        <div className="dash-actions">
          <span className="badge">
            <span className={`dot ${live ? 'ok' : 'err'}`} /> {live ? 'ao vivo' : 'offline'}
          </span>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      {!metrics && !error && <p className="sub">Carregando métricas…</p>}

      {metrics && (
        <>
          <section className="kpi-grid">
            <Kpi label="Conversas abertas" value={metrics.conversations.open} />
            <Kpi label="Pendentes" value={metrics.conversations.pending} />
            <Kpi label="Sem atribuição" value={metrics.conversations.unassigned} />
            <Kpi label="Resolvidas" value={metrics.conversations.resolved} />
            <Kpi label="Mensagens (24h)" value={metrics.messages.last24h} />
            <Kpi label="Contatos" value={metrics.contacts.total} />
            <Kpi
              label="Canais conectados"
              value={`${metrics.channels.connected}/${metrics.channels.total}`}
            />
            <Kpi
              label="Atendentes online"
              value={`${metrics.agents.online}/${metrics.agents.total}`}
            />
            <Kpi
              label="1ª resposta (média)"
              value={formatDuration(metrics.responseTime.avgFirstResponseSeconds)}
            />
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Mensagens · últimos 7 dias</h2>
              <div className="legend">
                entrada 24h <b>{metrics.messages.inboundLast24h}</b> · saída 24h{' '}
                <b>{metrics.messages.outboundLast24h}</b>
              </div>
            </div>
            <MessagesChart data={metrics.series.messagesPerDay} />
          </section>

          <p className="sub small">
            Atualizado em {new Date(metrics.generatedAt).toLocaleString('pt-BR')} · dados reais do
            banco
          </p>
        </>
      )}
    </div>
  );
}
