import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { authFetch, ApiError } from '../lib/api';
import { getSocket } from '../lib/socket';
import type { DashboardMetrics, TrendKpi } from '../lib/types';

/* ------------------------------------------------------------------ ícones */
type IconName =
  | 'users'
  | 'clock'
  | 'check'
  | 'x'
  | 'trending'
  | 'chat'
  | 'link'
  | 'headset'
  | 'send'
  | 'contacts';

function Icon({ name }: { name: IconName }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'users':
      return (
        <svg {...common}>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'clock':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common}>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      );
    case 'x':
      return (
        <svg {...common}>
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      );
    case 'trending':
      return (
        <svg {...common}>
          <path d="M23 6l-9.5 9.5-5-5L1 18" />
          <path d="M17 6h6v6" />
        </svg>
      );
    case 'chat':
      return (
        <svg {...common}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      );
    case 'link':
      return (
        <svg {...common}>
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      );
    case 'headset':
      return (
        <svg {...common}>
          <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
          <path d="M21 19a2 2 0 0 1-2 2h-3v-8h3a2 2 0 0 1 2 2zM3 19a2 2 0 0 0 2 2h3v-8H5a2 2 0 0 0-2 2z" />
        </svg>
      );
    case 'send':
      return (
        <svg {...common}>
          <path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" />
        </svg>
      );
    case 'contacts':
      return (
        <svg {...common}>
          <path d="M9 21v-2a4 4 0 0 0-4-4H4a2 2 0 0 0-2 2v4" />
          <circle cx="8" cy="7" r="3" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
  }
}

/* ------------------------------------------------------------- trend chip */
function Trend({ kpi }: { kpi: TrendKpi }) {
  if (kpi.deltaPct === null) return <span className="dv-trend flat">— vs período anterior</span>;
  const up = kpi.deltaPct >= 0;
  return (
    <span className={`dv-trend ${up ? 'up' : 'down'}`}>
      {up ? '▲' : '▼'} {Math.abs(kpi.deltaPct)}% vs período anterior
    </span>
  );
}

/* --------------------------------------------------------------- sparkline */
function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(1, ...data);
  return (
    <div className="dv-spark">
      {data.map((v, i) => (
        <span key={i} style={{ height: `${(v / max) * 100}%` }} />
      ))}
    </div>
  );
}

/* --------------------------------------------------- gráfico entrada/saída */
function MessagesChart({ data }: { data: DashboardMetrics['series']['messagesPerDay'] }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.inbound, d.outbound]));
  return (
    <div className="dv-msgchart">
      {data.map((d) => (
        <div key={d.date} className="dv-msgcol">
          <div className="dv-msgbars">
            <div
              className="dv-msgbar in"
              style={{ height: `${(d.inbound / max) * 100}%` }}
              title={`Entrada ${d.inbound}`}
            >
              <span>{d.inbound}</span>
            </div>
            <div
              className="dv-msgbar out"
              style={{ height: `${(d.outbound / max) * 100}%` }}
              title={`Saída ${d.outbound}`}
            >
              <span>{d.outbound}</span>
            </div>
          </div>
          <span className="dv-msglabel">
            {d.date.slice(8)}/{d.date.slice(5, 7)}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ tempo relativo */
function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const days = Math.floor(h / 24);
  if (days === 1) return 'ontem';
  return `há ${days} dias`;
}

const KPI_META: {
  key: keyof DashboardMetrics['kpis'];
  label: string;
  icon: IconName;
  tone: string;
}[] = [
  { key: 'attendedClients', label: 'Clientes atendidos', icon: 'users', tone: 'info' },
  { key: 'leadsInProgress', label: 'Leads em andamento', icon: 'clock', tone: 'teal' },
  { key: 'qualified', label: 'Qualificados', icon: 'check', tone: 'ok' },
  { key: 'disqualified', label: 'Desqualificados', icon: 'x', tone: 'err' },
  { key: 'advances', label: 'Avanços', icon: 'trending', tone: 'accent' },
  { key: 'openConversations', label: 'Conversas abertas', icon: 'chat', tone: 'info' },
];

const ACT_FALLBACK: { icon: IconName; tone: string } = { icon: 'chat', tone: 'info' };
const ACT_ICON: Record<string, { icon: IconName; tone: string }> = {
  qualified: { icon: 'check', tone: 'ok' },
  disqualified: { icon: 'x', tone: 'err' },
  in_progress: { icon: 'trending', tone: 'accent' },
  conversation: ACT_FALLBACK,
};

export function Dashboard() {
  const { profile } = useAuth();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [days, setDays] = useState(7);
  const daysRef = useRef(days);
  daysRef.current = days;

  useEffect(() => {
    let active = true;
    setMetrics(null);
    authFetch<DashboardMetrics>(`/dashboard/metrics?days=${days}`)
      .then((m) => active && setMetrics(m))
      .catch(
        (err) => active && setError(err instanceof ApiError ? err.message : 'Erro ao carregar'),
      );
    return () => {
      active = false;
    };
  }, [days]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onMetrics = (m: DashboardMetrics) => {
      // Só aplica atualizações ao vivo na visão padrão (7 dias); outros períodos
      // são carregados sob demanda via HTTP para não sobrescrever a seleção.
      if (daysRef.current === 7) setMetrics(m);
    };
    const onConnect = () => setLive(true);
    const onDisconnect = () => setLive(false);
    socket.on('dashboard:metrics', onMetrics);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    setLive(socket.connected);
    socket.emit('dashboard:subscribe');
    return () => {
      socket.off('dashboard:metrics', onMetrics);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  const totalIn = metrics?.series.messagesPerDay.reduce((a, d) => a + d.inbound, 0) ?? 0;
  const totalOut = metrics?.series.messagesPerDay.reduce((a, d) => a + d.outbound, 0) ?? 0;
  const maxLoss = Math.max(1, ...(metrics?.lossReasons.map((l) => l.count) ?? [1]));

  return (
    <div className="dash">
      <header className="dv-top">
        <div>
          <h1>Dashboard</h1>
          <p className="sub">
            {profile?.tenant.name} · {profile?.role.name}
          </p>
        </div>
        <div className="dv-top-actions">
          <span className={`dv-live ${live ? 'on' : 'off'}`}>
            <span className="dot" /> {live ? 'ao vivo' : 'offline'}
          </span>
          <select
            className="dv-period"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={7}>Últimos 7 dias</option>
            <option value={30}>Últimos 30 dias</option>
            <option value={90}>Últimos 90 dias</option>
          </select>
        </div>
      </header>

      {error && <div className="error">{error}</div>}
      {!metrics && !error && <p className="sub">Carregando métricas…</p>}

      {metrics && (
        <>
          <section className="dv-kpis">
            {KPI_META.map((m) => {
              const k = metrics.kpis[m.key];
              return (
                <div key={m.key} className="dv-kpi">
                  <span className={`dv-ico ${m.tone}`}>
                    <Icon name={m.icon} />
                  </span>
                  <div className="dv-kpi-body">
                    <span className="dv-kpi-label">{m.label}</span>
                    <span className="dv-kpi-value">{k.value}</span>
                    <Trend kpi={k} />
                  </div>
                </div>
              );
            })}
          </section>

          <section className="dv-stats">
            <div className="dv-stat">
              <span className="dv-ico accent">
                <Icon name="link" />
              </span>
              <div>
                <span className="dv-stat-value">
                  {metrics.channels.connected}/{metrics.channels.total}
                </span>
                <span className="dv-stat-label">
                  Canais conectados{' '}
                  <span className={`dot ${metrics.channels.connected > 0 ? 'ok' : 'err'}`} />
                </span>
              </div>
            </div>
            <div className="dv-stat">
              <span className="dv-ico teal">
                <Icon name="headset" />
              </span>
              <div>
                <span className="dv-stat-value">
                  {metrics.agents.online}/{metrics.agents.total}
                </span>
                <span className="dv-stat-label">Atendentes online</span>
              </div>
            </div>
            <div className="dv-stat">
              <span className="dv-ico info">
                <Icon name="send" />
              </span>
              <div>
                <span className="dv-stat-value">{metrics.messages.last24h}</span>
                <span className="dv-stat-label">Mensagens (24h)</span>
              </div>
              <Sparkline data={metrics.series.messagesPerDay.map((d) => d.inbound + d.outbound)} />
            </div>
            <div className="dv-stat">
              <span className="dv-ico accent">
                <Icon name="contacts" />
              </span>
              <div>
                <span className="dv-stat-value">{metrics.contacts.total}</span>
                <span className="dv-stat-label">Contatos</span>
              </div>
            </div>
          </section>

          <section className="dv-grid2">
            <div className="dv-panel">
              <h2>Motivo da perda</h2>
              {metrics.lossReasons.length === 0 ? (
                <p className="sub">Nenhum lead desqualificado no período.</p>
              ) : (
                <>
                  <div className="dv-loss-head">
                    <span />
                    <span>Leads</span>
                    <span>%</span>
                  </div>
                  {metrics.lossReasons.map((l, i) => (
                    <div key={l.label} className="dv-loss-row">
                      <span className="dv-loss-rank">{i + 1}</span>
                      <span className="dv-loss-label">{l.label}</span>
                      <span className="dv-loss-bar">
                        <span
                          style={{ width: `${(l.count / maxLoss) * 100}%` }}
                          className={`fill c${i % 5}`}
                        />
                      </span>
                      <span className="dv-loss-count">{l.count}</span>
                      <span className="dv-loss-pct">{l.pct}%</span>
                    </div>
                  ))}
                  <p className="sub small">
                    Baseado em {metrics.lossReasons.reduce((a, l) => a + l.count, 0)} leads
                    desqualificados no período.
                  </p>
                </>
              )}
            </div>

            <div className="dv-panel">
              <h2>Funil de atendimento</h2>
              <div className="dv-funnel">
                {[
                  { label: 'Novos leads', value: metrics.funnel.newLeads, tone: 'info' },
                  { label: 'Respondidos', value: metrics.funnel.responded, tone: 'teal' },
                  { label: 'Em avanço', value: metrics.funnel.inProgress, tone: 'ok' },
                  { label: 'Qualificados', value: metrics.funnel.qualified, tone: 'warn' },
                  { label: 'Desqualificados', value: metrics.funnel.disqualified, tone: 'err' },
                ].map((s) => {
                  const pct = metrics.funnel.newLeads
                    ? Math.round((s.value / metrics.funnel.newLeads) * 100)
                    : 0;
                  return (
                    <div key={s.label} className={`dv-funnel-step ${s.tone}`}>
                      <span className="dv-funnel-label">{s.label}</span>
                      <span className="dv-funnel-value">{s.value}</span>
                      <span className="dv-funnel-pct">{pct}%</span>
                    </div>
                  );
                })}
              </div>
              <div className="dv-conv">
                Taxa de conversão geral: <b>{metrics.conversionRatePct}%</b>
              </div>
            </div>
          </section>

          <section className="dv-grid2">
            <div className="dv-panel">
              <h2>Atividade recente</h2>
              {metrics.recentActivity.length === 0 ? (
                <p className="sub">Sem atividade recente.</p>
              ) : (
                <ul className="dv-activity">
                  {metrics.recentActivity.map((a) => {
                    const meta = ACT_ICON[a.type] ?? ACT_FALLBACK;
                    return (
                      <li key={a.id}>
                        <span className={`dv-ico sm ${meta.tone}`}>
                          <Icon name={meta.icon} />
                        </span>
                        <div className="dv-act-body">
                          <span className="dv-act-title">{a.title}</span>
                          <span className="dv-act-sub">{a.subtitle}</span>
                        </div>
                        <span className="dv-act-time">{relTime(a.at)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="dv-panel">
              <div className="dv-panel-head">
                <h2>Mensagens · últimos 7 dias</h2>
                <div className="dv-legend">
                  <span className="in">■ Entrada</span>
                  <span className="out">■ Saída</span>
                </div>
              </div>
              <MessagesChart data={metrics.series.messagesPerDay} />
              <p className="sub small">
                Total entradas: <b className="in-txt">{totalIn}</b> · Total saídas:{' '}
                <b className="out-txt">{totalOut}</b>
              </p>
            </div>
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
