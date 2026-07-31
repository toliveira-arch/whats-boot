import { useEffect, useState } from 'react';
import * as rd from '../lib/rdstation';
import type { RdEvent, RdIntegration } from '../lib/rdstation';
import { listChannels, type Channel } from '../lib/channels';
import { ApiError } from '../lib/api';

export function Integrations() {
  const [integ, setInteg] = useState<RdIntegration | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [events, setEvents] = useState<RdEvent[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = () => {
    rd.getRd()
      .then(setInteg)
      .catch(() => undefined);
    rd.rdEvents()
      .then(setEvents)
      .catch(() => undefined);
  };

  useEffect(() => {
    load();
    listChannels()
      .then(setChannels)
      .catch(() => undefined);
  }, []);

  function set<K extends keyof RdIntegration>(key: K, value: RdIntegration[K]) {
    setInteg((v) => (v ? { ...v, [key]: value } : v));
  }

  async function save() {
    if (!integ) return;
    setMsg(null);
    try {
      const saved = await rd.saveRd({
        enabled: integ.enabled,
        channelId: integ.channelId,
        openingMessage: integ.openingMessage,
        handoffToSdr: integ.handoffToSdr,
      });
      setInteg(saved);
      setMsg('Configuração salva ✅');
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Erro ao salvar');
    }
  }

  async function regenerate() {
    if (!window.confirm('Gerar um novo token invalida a URL antiga no RD Station. Continuar?'))
      return;
    try {
      setInteg(await rd.regenerateRd());
      setMsg('Novo token gerado — atualize a URL no RD Station.');
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Erro ao gerar token');
    }
  }

  function copyUrl() {
    if (!integ) return;
    void navigator.clipboard.writeText(integ.webhookUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  if (!integ)
    return (
      <div className="settings">
        <p className="sub">Carregando…</p>
      </div>
    );

  return (
    <div className="settings">
      <h1>Integrações — RD Station</h1>
      {msg && (
        <div className="error" style={{ borderColor: 'var(--accent)' }}>
          {msg}
        </div>
      )}

      <div className="card-form">
        <h2>Conexão</h2>
        <label className="ai-toggle">
          <input
            type="checkbox"
            checked={integ.enabled}
            onChange={(e) => set('enabled', e.target.checked)}
          />
          <span>Ativar integração (disparar WhatsApp para novos leads)</span>
        </label>

        <label className="field">
          <span>URL do webhook — cole no RD Station (Integrações → Webhooks)</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input readOnly value={integ.webhookUrl} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn ghost sm" onClick={copyUrl}>
              {copied ? 'Copiado!' : 'Copiar'}
            </button>
          </div>
        </label>
        <button type="button" className="btn ghost sm" onClick={regenerate}>
          Gerar novo token
        </button>
      </div>

      <div className="card-form">
        <h2>Disparo</h2>
        <div className="grid2">
          <label className="field">
            <span>Canal (instância WhatsApp)</span>
            <select
              value={integ.channelId ?? ''}
              onChange={(e) => set('channelId', e.target.value || null)}
            >
              <option value="">Primeiro canal disponível</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Após a 1ª mensagem</span>
            <select
              value={integ.handoffToSdr ? '1' : '0'}
              onChange={(e) => set('handoffToSdr', e.target.value === '1')}
            >
              <option value="1">Robô SDR assume e qualifica</option>
              <option value="0">Só dispara (atendente humano)</option>
            </select>
          </label>
        </div>
        <label className="field">
          <span>Mensagem de abertura (use {'{{nome}}'} para o nome do lead)</span>
          <textarea
            rows={3}
            value={integ.openingMessage}
            onChange={(e) => set('openingMessage', e.target.value)}
          />
        </label>
        <button className="btn" onClick={() => void save()}>
          Salvar
        </button>
      </div>

      <div className="card-form">
        <h2>Como configurar no RD Station</h2>
        <ol className="rd-steps">
          <li>
            No RD Station: <strong>Integrações → Webhooks → Novo webhook</strong>.
          </li>
          <li>
            Evento: <strong>"Lead convertido"</strong> (ou marcado como oportunidade).
          </li>
          <li>
            Cole a <strong>URL do webhook</strong> acima e salve.
          </li>
          <li>Ative a integração aqui e faça um lead de teste.</li>
        </ol>
        <p className="sub small">
          Envie WhatsApp apenas para leads que optaram por contato (opt-in), para evitar bloqueios.
        </p>
      </div>

      <div className="card-form">
        <h2>Últimos leads recebidos</h2>
        {events.length === 0 ? (
          <p className="sub">Nenhum lead recebido ainda.</p>
        ) : (
          <table className="monitor-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Telefone</th>
                <th>Status</th>
                <th>Quando</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>{e.name ?? '—'}</td>
                  <td className="sub">{e.phone ?? '—'}</td>
                  <td>
                    <span
                      className={`badge lead-${e.status === 'SENT' ? 'QUALIFIED' : e.status === 'FAILED' ? 'DISQUALIFIED' : 'IN_PROGRESS'}`}
                    >
                      {e.status}
                      {e.detail ? ` · ${e.detail}` : ''}
                    </span>
                  </td>
                  <td className="sub">{new Date(e.createdAt).toLocaleString('pt-BR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <button type="button" className="btn ghost sm" onClick={load}>
          Atualizar
        </button>
      </div>
    </div>
  );
}
