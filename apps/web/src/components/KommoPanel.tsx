import { useCallback, useEffect, useState } from 'react';
import * as kommo from '../lib/kommo';
import type { KommoEvent, KommoIntegration } from '../lib/kommo';
import type { Channel } from '../lib/channels';
import { ApiError } from '../lib/api';

export function KommoPanel({ companyId, channels }: { companyId: string; channels: Channel[] }) {
  const [integ, setInteg] = useState<KommoIntegration | null>(null);
  const [events, setEvents] = useState<KommoEvent[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [tokenInput, setTokenInput] = useState('');

  const load = useCallback(() => {
    if (!companyId) return;
    kommo
      .getKommo(companyId)
      .then(setInteg)
      .catch(() => undefined);
    kommo
      .kommoEvents(companyId)
      .then(setEvents)
      .catch(() => undefined);
  }, [companyId]);

  useEffect(() => {
    setInteg(null);
    setTokenInput('');
    load();
  }, [companyId, load]);

  function set<K extends keyof KommoIntegration>(key: K, value: KommoIntegration[K]) {
    setInteg((v) => (v ? { ...v, [key]: value } : v));
  }

  async function save() {
    if (!integ || !companyId) return;
    setMsg(null);
    try {
      const saved = await kommo.saveKommo(
        {
          enabled: integ.enabled,
          channelId: integ.channelId,
          openingMessage: integ.openingMessage,
          handoffToSdr: integ.handoffToSdr,
          subdomain: integ.subdomain,
          ...(tokenInput.trim() ? { accessToken: tokenInput.trim() } : {}),
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
    if (!window.confirm('Gerar um novo token invalida a URL antiga no Kommo. Continuar?')) return;
    try {
      setInteg(await kommo.regenerateKommo(companyId));
      setMsg('Novo token gerado — atualize a URL no Kommo.');
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
        <h2>Conexão</h2>
        <label className="ai-toggle">
          <input
            type="checkbox"
            checked={integ.enabled}
            onChange={(e) => set('enabled', e.target.checked)}
          />
          <span>Ativar integração (disparar WhatsApp para novos leads do Kommo)</span>
        </label>

        <label className="field">
          <span>URL do webhook — cole no Kommo</span>
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
        <h2>Acesso à API do Kommo</h2>
        <p className="sub small">
          O webhook do Kommo envia só os IDs do lead. Para buscar o telefone, informe o subdomínio
          da conta e um <strong>token de longa duração</strong> (Kommo → Configurações → Integrações
          → crie uma integração → token de longa duração).
        </p>
        <div className="grid2">
          <label className="field">
            <span>Subdomínio (ex.: suaempresa)</span>
            <input
              value={integ.subdomain}
              onChange={(e) => set('subdomain', e.target.value)}
              placeholder="suaempresa"
            />
          </label>
          <label className="field">
            <span>
              Token de longa duração {integ.hasToken ? '(salvo — preencha p/ trocar)' : ''}
            </span>
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder={integ.hasToken ? '•••••••• (mantém o atual)' : 'cole o token aqui'}
            />
          </label>
        </div>
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
        <h2>Como configurar no Kommo</h2>
        <ol className="rd-steps">
          <li>
            No Kommo: <strong>Configurações → Integrações → crie uma integração</strong> e gere um{' '}
            <strong>token de longa duração</strong>. Cole aqui o token e o subdomínio.
          </li>
          <li>
            Configure um webhook em <strong>Configurações → Webhooks</strong> (ou no{' '}
            <strong>Funil digital</strong>) no evento de <strong>lead criado</strong> / mudança de
            etapa.
          </li>
          <li>
            Cole a <strong>URL do webhook</strong> acima e salve.
          </li>
          <li>Ative a integração aqui e crie um lead de teste no Kommo.</li>
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
