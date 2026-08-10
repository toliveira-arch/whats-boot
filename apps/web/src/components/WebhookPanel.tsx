import { useCallback, useEffect, useState } from 'react';
import * as wh from '../lib/webhookint';
import type { WebhookEvent, WebhookIntegration } from '../lib/webhookint';
import type { Channel } from '../lib/channels';
import { ApiError } from '../lib/api';

export function WebhookPanel({ companyId, channels }: { companyId: string; channels: Channel[] }) {
  const [integ, setInteg] = useState<WebhookIntegration | null>(null);
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [tokenInput, setTokenInput] = useState('');

  const load = useCallback(() => {
    if (!companyId) return;
    wh.getWebhook(companyId)
      .then(setInteg)
      .catch(() => undefined);
    wh.webhookEvents(companyId)
      .then(setEvents)
      .catch(() => undefined);
  }, [companyId]);

  useEffect(() => {
    setInteg(null);
    setTokenInput('');
    load();
  }, [companyId, load]);

  function set<K extends keyof WebhookIntegration>(key: K, value: WebhookIntegration[K]) {
    setInteg((v) => (v ? { ...v, [key]: value } : v));
  }

  async function save() {
    if (!integ || !companyId) return;
    setMsg(null);
    try {
      const saved = await wh.saveWebhook(
        {
          enabled: integ.enabled,
          channelId: integ.channelId,
          openingMessage: integ.openingMessage,
          handoffToSdr: integ.handoffToSdr,
          sourceFilter: integ.sourceFilter,
          label: integ.label,
          apiBaseUrl: integ.apiBaseUrl,
          apiUserUuid: integ.apiUserUuid,
          cardIdField: integ.cardIdField,
          qualifiedRespUuid: integ.qualifiedRespUuid,
          qualifiedTemp: integ.qualifiedTemp,
          ...(tokenInput.trim() ? { apiToken: tokenInput.trim() } : {}),
        },
        companyId,
      );
      setInteg(saved);
      setTokenInput('');
      setMsg('Configuração salva ✅');
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Erro ao salvar');
    }
  }

  async function regenerate() {
    if (!companyId) return;
    if (!window.confirm('Gerar um novo token invalida a URL antiga no Foresee. Continuar?')) return;
    try {
      setInteg(await wh.regenerateWebhook(companyId));
      setMsg('Novo token gerado — atualize a URL no Foresee.');
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

  const selectedChannels = companyId
    ? channels.filter((c) => !c.companyId || c.companyId === companyId)
    : channels;

  if (!integ) {
    return (
      <div className="card-form">
        <p className="sub">Carregando…</p>
      </div>
    );
  }

  return (
    <>
      {msg && (
        <div className="error" style={{ borderColor: 'var(--accent)' }}>
          {msg}
        </div>
      )}

      <div className="card-form">
        <h2>Conexão (Foresee / Webhook)</h2>
        <p className="sub small">
          Integração por <strong>webhook</strong>: quando entra um lead no Foresee (ou qualquer
          ferramenta que dispare um webhook — direto ou via Zapier/Make/Pluga), o robô aborda no
          WhatsApp. O payload precisa conter o <strong>telefone</strong> do lead.
        </p>
        <label className="ai-toggle">
          <input
            type="checkbox"
            checked={integ.enabled}
            onChange={(e) => set('enabled', e.target.checked)}
          />
          <span>Ativar integração (disparar WhatsApp para novos leads)</span>
        </label>

        <label className="field">
          <span>URL do webhook — cole no Foresee (ou no Zapier/Make)</span>
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
              {selectedChannels.map((c) => (
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
          <span>Filtrar por fonte (opcional) — só puxa leads cujo webhook contenha este texto</span>
          <input
            value={integ.sourceFilter}
            onChange={(e) => set('sourceFilter', e.target.value)}
            placeholder="ex.: Foresee"
          />
        </label>
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
        <h2>Saída — atualizar o card no Foresee (opcional)</h2>
        <p className="sub small">
          Quando o robô <strong>qualificar</strong> o lead, atualizamos o card no Foresee via API (
          <code>/api/v1/cards/update</code>) — temperatura e/ou responsável. Mover de etapa não é
          possível pela API do Foresee (bloqueado por CSRF); faça isso por automação interna no
          Foresee (ex.: temperatura = quente → mover etapa).
        </p>
        <div className="grid2">
          <label className="field">
            <span>URL base da API do Foresee</span>
            <input
              value={integ.apiBaseUrl}
              onChange={(e) => set('apiBaseUrl', e.target.value)}
              placeholder="https://app.foresee..."
            />
          </label>
          <label className="field">
            <span>X-User-Uuid</span>
            <input
              value={integ.apiUserUuid}
              onChange={(e) => set('apiUserUuid', e.target.value)}
              placeholder="uuid do usuário"
            />
          </label>
          <label className="field">
            <span>Token da API {integ.hasToken ? '(salvo — preencha p/ trocar)' : ''}</span>
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder={integ.hasToken ? '•••••••• (mantém o atual)' : 'cole o token da API'}
            />
          </label>
          <label className="field">
            <span>Campo do UUID do card no webhook (opcional)</span>
            <input
              value={integ.cardIdField}
              onChange={(e) => set('cardIdField', e.target.value)}
              placeholder="auto (card_uuid, id…)"
            />
          </label>
          <label className="field">
            <span>Temperatura ao qualificar (opcional)</span>
            <input
              value={integ.qualifiedTemp}
              onChange={(e) => set('qualifiedTemp', e.target.value)}
              placeholder="ex.: quente"
            />
          </label>
          <label className="field">
            <span>Responsável ao qualificar — UUID (opcional)</span>
            <input
              value={integ.qualifiedRespUuid}
              onChange={(e) => set('qualifiedRespUuid', e.target.value)}
              placeholder="uuid do responsável"
            />
          </label>
        </div>
        <button className="btn" onClick={() => void save()}>
          Salvar
        </button>
      </div>

      <div className="card-form">
        <h2>Como configurar no Foresee</h2>
        <ol className="rd-steps">
          <li>
            No Foresee, procure <strong>Integrações / Automação / Webhook</strong> (ou use uma ponte
            como <strong>Zapier, Make ou Pluga</strong>) no evento de <strong>novo lead</strong>.
          </li>
          <li>
            Cole a <strong>URL do webhook</strong> acima como destino do POST.
          </li>
          <li>
            Garanta que o envio inclua o <strong>telefone</strong> do lead (e, de preferência, o{' '}
            <strong>nome</strong>).
          </li>
          <li>Ative aqui e faça um lead de teste no Foresee.</li>
        </ol>
        <p className="sub small">
          Aceitamos vários formatos de telefone (com/sem DDI). Se o Foresee não tiver webhook
          nativo, o Zapier/Make/Pluga resolve a ponte.
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
                      className={`badge lead-${
                        e.status === 'SENT'
                          ? 'QUALIFIED'
                          : e.status === 'FAILED'
                            ? 'DISQUALIFIED'
                            : 'IN_PROGRESS'
                      }`}
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
    </>
  );
}
