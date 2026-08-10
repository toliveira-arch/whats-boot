import { useCallback, useEffect, useState } from 'react';
import * as rd from '../lib/rdstation';
import type { RdEvent, RdIntegration } from '../lib/rdstation';
import { listChannels, type Channel } from '../lib/channels';
import { listCompanies, type Company } from '../lib/companies';
import { ApiError } from '../lib/api';
import { KommoPanel } from '../components/KommoPanel';
import { WebhookPanel } from '../components/WebhookPanel';

export function Integrations() {
  const [provider, setProvider] = useState<'rd' | 'kommo' | 'foresee'>('rd');
  const [integ, setInteg] = useState<RdIntegration | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [events, setEvents] = useState<RdEvent[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState<string>('');

  const load = useCallback(() => {
    if (!companyId) return;
    rd.getRd(companyId)
      .then(setInteg)
      .catch(() => undefined);
    rd.rdEvents(companyId)
      .then(setEvents)
      .catch(() => undefined);
  }, [companyId]);

  // Empresas e canais uma vez.
  useEffect(() => {
    listCompanies()
      .then((list) => {
        setCompanies(list);
        const first = list[0];
        if (first) setCompanyId((cur) => cur || first.id);
      })
      .catch(() => undefined);
    listChannels()
      .then(setChannels)
      .catch(() => undefined);
  }, []);

  // Recarrega a integração quando a empresa muda.
  useEffect(() => {
    setInteg(null);
    load();
  }, [companyId, load]);

  function set<K extends keyof RdIntegration>(key: K, value: RdIntegration[K]) {
    setInteg((v) => (v ? { ...v, [key]: value } : v));
  }

  async function save() {
    if (!integ || !companyId) return;
    setMsg(null);
    try {
      const saved = await rd.saveRd(
        {
          enabled: integ.enabled,
          channelId: integ.channelId,
          openingMessage: integ.openingMessage,
          handoffToSdr: integ.handoffToSdr,
          paidMediaOnly: integ.paidMediaOnly,
          allowedSources: integ.allowedSources,
          campaignMap: integ.campaignMap,
          openingsJson: integ.openingsJson,
        },
        companyId,
      );
      setInteg(saved);
      setMsg('Configuração salva ✅');
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Erro ao salvar');
    }
  }

  async function regenerate() {
    if (!companyId) return;
    if (!window.confirm('Gerar um novo token invalida a URL antiga no RD Station. Continuar?'))
      return;
    try {
      setInteg(await rd.regenerateRd(companyId));
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

  const selectedChannels = companyId
    ? channels.filter((c) => !c.companyId || c.companyId === companyId)
    : channels;

  return (
    <div className="settings">
      <h1>Integrações</h1>
      <div className="row-actions" style={{ marginTop: 4, marginBottom: 12 }}>
        <button
          className={`btn ${provider === 'rd' ? '' : 'ghost'} sm`}
          onClick={() => setProvider('rd')}
        >
          RD Station
        </button>
        <button
          className={`btn ${provider === 'kommo' ? '' : 'ghost'} sm`}
          onClick={() => setProvider('kommo')}
        >
          Kommo
        </button>
        <button
          className={`btn ${provider === 'foresee' ? '' : 'ghost'} sm`}
          onClick={() => setProvider('foresee')}
        >
          Foresee
        </button>
      </div>
      {provider === 'rd' && msg && (
        <div className="error" style={{ borderColor: 'var(--accent)' }}>
          {msg}
        </div>
      )}

      <div className="card-form">
        <h2>Empresa (cliente)</h2>
        <p className="sub">
          A integração é individual por empresa — cada uma tem a sua própria URL de webhook.
          Selecione a empresa para configurar.
        </p>
        {companies.length === 0 ? (
          <p className="sub">
            Nenhuma empresa cadastrada. Cadastre uma empresa no menu <strong>Empresas</strong>{' '}
            primeiro.
          </p>
        ) : (
          <label className="field">
            <span>Empresa</span>
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {provider === 'kommo' && companyId && (
        <KommoPanel companyId={companyId} channels={channels} />
      )}

      {provider === 'foresee' && companyId && (
        <WebhookPanel companyId={companyId} channels={channels} />
      )}

      {provider === 'rd' &&
        (!integ ? (
          <div className="card-form">
            <p className="sub">
              {companies.length === 0 ? 'Cadastre uma empresa para começar.' : 'Carregando…'}
            </p>
          </div>
        ) : (
          <>
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
                  <input
                    readOnly
                    value={integ.webhookUrl}
                    onFocus={(e) => e.currentTarget.select()}
                  />
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
                <span>
                  Mensagem de abertura padrão — variáveis: {'{{nome}} {{campanha}} {{formulario}}'}{' '}
                  {'{{empresa}}'} (usada quando a campanha não cai no mapa abaixo)
                </span>
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
              <h2>Mídia paga & campanhas (consultivo)</h2>
              <label className="ai-toggle">
                <input
                  type="checkbox"
                  checked={integ.paidMediaOnly}
                  onChange={(e) => set('paidMediaOnly', e.target.checked)}
                />
                <span>Só atender leads de anúncio (descarta o que não é mídia paga)</span>
              </label>
              <label className="field">
                <span>Origens aceitas (vírgula) — vazio = Facebook/Instagram/Google/Meta Ads</span>
                <input
                  value={integ.allowedSources}
                  onChange={(e) => set('allowedSources', e.target.value)}
                  placeholder="Facebook Ads, Instagram Ads, Google Ads, Meta Ads"
                />
              </label>
              <label className="field">
                <span>Mapa de campanha (uma por linha, no formato trecho=tipo)</span>
                <textarea
                  rows={5}
                  value={integ.campaignMap}
                  onChange={(e) => set('campaignMap', e.target.value)}
                  placeholder={'troca de contabilidade=troca\nrestaurante=restaurante\nbpo=bpo'}
                />
              </label>
              <label className="field">
                <span>
                  Aberturas por tipo (JSON) — {'{"troca":["..."],"restaurante":["..."],'}
                  {'"bpo":["..."],"generico":["..."]}'}; use {'{{nome}}'}
                </span>
                <textarea
                  rows={6}
                  value={integ.openingsJson}
                  onChange={(e) => set('openingsJson', e.target.value)}
                  placeholder={
                    '{\n  "troca": ["Oi {{nome}}! ..."],\n  "generico": ["Oi {{nome}}! ..."]\n}'
                  }
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
                Envie WhatsApp apenas para leads que optaram por contato (opt-in), para evitar
                bloqueios.
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
          </>
        ))}
    </div>
  );
}
