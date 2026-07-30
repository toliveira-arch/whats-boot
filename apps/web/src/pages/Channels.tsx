import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { getSocket } from '../lib/socket';
import * as ch from '../lib/channels';
import type { Channel, ChannelStatus, Company } from '../lib/channels';
import { ApiError } from '../lib/api';

const EMPTY_FORM = {
  companyId: '',
  name: '',
  instanceName: '',
  baseUrl: '',
  apiKey: '',
  phoneNumber: '',
};

function StatusBadge({ status }: { status: ChannelStatus }) {
  return <span className={`badge status-${status}`}>{ch.STATUS_LABEL[status]}</span>;
}

export function Channels() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [qr, setQr] = useState<{
    channelId: string;
    base64: string | null;
    pairing: string | null;
  } | null>(null);

  const loadChannels = useCallback(async () => {
    try {
      setChannels(await ch.listChannels());
    } catch {
      /* ignora */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadChannels();
    ch.listCompanies()
      .then((cs) => {
        setCompanies(cs);
        if (cs.length === 1) setForm((f) => ({ ...f, companyId: cs[0]!.id }));
      })
      .catch(() => undefined);
  }, [loadChannels]);

  // Tempo real: status, QR e toggle de IA das instâncias.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onStatus = (p: { channelId?: string; status?: ChannelStatus }) => {
      if (!p.channelId || !p.status) return;
      setChannels((prev) =>
        prev.map((c) => (c.id === p.channelId ? { ...c, status: p.status! } : c)),
      );
    };
    const onQr = (p: { channelId?: string; base64?: string | null }) => {
      if (!p.channelId) return;
      setQr((cur) =>
        cur && cur.channelId === p.channelId ? { ...cur, base64: p.base64 ?? null } : cur,
      );
      setChannels((prev) =>
        prev.map((c) => (c.id === p.channelId ? { ...c, status: 'QRCODE' } : c)),
      );
    };
    const onAi = (p: { channelId?: string; aiEnabled?: boolean }) => {
      if (!p.channelId || p.aiEnabled === undefined) return;
      setChannels((prev) =>
        prev.map((c) => (c.id === p.channelId ? { ...c, aiEnabled: p.aiEnabled! } : c)),
      );
    };
    socket.on('channel.status', onStatus);
    socket.on('channel.qrcode', onQr);
    socket.on('channel.ai', onAi);
    return () => {
      socket.off('channel.status', onStatus);
      socket.off('channel.qrcode', onQr);
      socket.off('channel.ai', onAi);
    };
  }, []);

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    if (key === 'baseUrl' || key === 'apiKey') setTestState('idle');
  }

  async function onTest() {
    setMsg(null);
    setTestState('testing');
    try {
      await ch.testConnection(form.baseUrl, form.apiKey);
      setTestState('ok');
    } catch (err) {
      setTestState('fail');
      setMsg(err instanceof ApiError ? err.message : 'Falha ao conectar à Evolution API');
    }
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setSaving(true);
    try {
      const res = await ch.createChannel({
        companyId: form.companyId,
        name: form.name,
        instanceName: form.instanceName,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey,
        phoneNumber: form.phoneNumber || undefined,
      });
      setShowForm(false);
      setForm({ ...EMPTY_FORM, companyId: companies.length === 1 ? companies[0]!.id : '' });
      setTestState('idle');
      await loadChannels();
      setQr({ channelId: res.channel.id, base64: res.qrcode, pairing: res.pairingCode });
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Falha ao cadastrar a instância');
    } finally {
      setSaving(false);
    }
  }

  async function openQr(channelId: string) {
    setQr({ channelId, base64: null, pairing: null });
    try {
      const r = await ch.getQrCode(channelId);
      setQr({ channelId, base64: r.qrcode, pairing: r.pairingCode });
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Falha ao gerar QR Code');
      setQr(null);
    }
  }

  async function refreshState(channelId: string) {
    try {
      const r = await ch.getState(channelId);
      setChannels((prev) => prev.map((c) => (c.id === channelId ? { ...c, status: r.status } : c)));
    } catch {
      /* ignora */
    }
  }

  async function onReconnect(channelId: string) {
    await ch.reconnect(channelId);
    await refreshState(channelId);
  }

  async function onLogout(channelId: string) {
    await ch.logout(channelId);
    await loadChannels();
  }

  async function onToggleAi(channel: Channel) {
    const next = !channel.aiEnabled;
    setChannels((prev) => prev.map((c) => (c.id === channel.id ? { ...c, aiEnabled: next } : c)));
    try {
      await ch.setAiEnabled(channel.id, next);
    } catch {
      setChannels((prev) =>
        prev.map((c) => (c.id === channel.id ? { ...c, aiEnabled: channel.aiEnabled } : c)),
      );
    }
  }

  async function onDelete(channel: Channel) {
    if (!window.confirm(`Excluir a instância "${channel.name}"? Esta ação é irreversível.`)) return;
    await ch.removeChannel(channel.id);
    await loadChannels();
  }

  return (
    <div className="settings wide">
      <div className="page-head">
        <h1>Canais WhatsApp (Evolution API)</h1>
        <button className="btn" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancelar' : '+ Nova instância'}
        </button>
      </div>

      {msg && <div className="error">{msg}</div>}

      {showForm && (
        <form className="card-form" onSubmit={onCreate}>
          <h2>Cadastrar instância</h2>
          <div className="grid2">
            <label className="field">
              <span>Empresa</span>
              <select
                value={form.companyId}
                onChange={(e) => setField('companyId', e.target.value)}
                required
              >
                <option value="">Selecione…</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Nome do canal</span>
              <input
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                placeholder="Ex.: Comercial"
                required
              />
            </label>
            <label className="field">
              <span>Nome da instância (Evolution)</span>
              <input
                value={form.instanceName}
                onChange={(e) => setField('instanceName', e.target.value)}
                placeholder="comercial-01 (letras, números, _ ou -)"
                required
              />
            </label>
            <label className="field">
              <span>Número (opcional)</span>
              <input
                value={form.phoneNumber}
                onChange={(e) => setField('phoneNumber', e.target.value)}
                placeholder="5511999998888"
              />
            </label>
            <label className="field">
              <span>URL da Evolution API</span>
              <input
                value={form.baseUrl}
                onChange={(e) => setField('baseUrl', e.target.value)}
                placeholder="https://evo.suaempresa.com"
                required
              />
            </label>
            <label className="field">
              <span>API Key</span>
              <input
                type="password"
                value={form.apiKey}
                onChange={(e) => setField('apiKey', e.target.value)}
                required
              />
            </label>
          </div>

          <div className="row-actions">
            <button
              type="button"
              className="btn ghost"
              onClick={onTest}
              disabled={!form.baseUrl || !form.apiKey || testState === 'testing'}
            >
              {testState === 'testing' ? 'Testando…' : 'Testar conexão'}
            </button>
            {testState === 'ok' && <span className="ok-text">✅ Conexão OK</span>}
            {testState === 'fail' && <span className="fail-text">❌ Falhou</span>}
            <span className="nav-spacer" />
            <button type="submit" className="btn" disabled={saving}>
              {saving ? 'Cadastrando…' : 'Cadastrar e gerar QR'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="sub">Carregando…</p>
      ) : channels.length === 0 ? (
        <p className="sub">Nenhuma instância cadastrada ainda.</p>
      ) : (
        <div className="channel-grid">
          {channels.map((c) => (
            <div key={c.id} className="channel-card">
              <div className="channel-head">
                <div>
                  <strong>{c.name}</strong>
                  <div className="sub">{c.instanceName}</div>
                </div>
                <StatusBadge status={c.status} />
              </div>
              <div className="channel-meta">
                <span>{c.profileName ?? c.phoneNumber ?? '—'}</span>
              </div>

              <label className="ai-toggle">
                <input type="checkbox" checked={c.aiEnabled} onChange={() => void onToggleAi(c)} />
                <span>Robô de IA {c.aiEnabled ? 'ligado' : 'desligado'}</span>
              </label>

              <div className="channel-actions">
                <button className="btn ghost sm" onClick={() => void openQr(c.id)}>
                  QR Code
                </button>
                <button className="btn ghost sm" onClick={() => void refreshState(c.id)}>
                  Atualizar
                </button>
                <button className="btn ghost sm" onClick={() => void onReconnect(c.id)}>
                  Reconectar
                </button>
                <button className="btn ghost sm" onClick={() => void onLogout(c.id)}>
                  Desconectar
                </button>
                <button className="btn danger sm" onClick={() => void onDelete(c)}>
                  Excluir
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {qr && (
        <div className="modal-backdrop" onClick={() => setQr(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Conectar WhatsApp</h2>
            <p className="sub">Abra o WhatsApp → Aparelhos conectados → Conectar aparelho.</p>
            {qr.base64 ? (
              <img className="qr-img" src={qr.base64} alt="QR Code" />
            ) : (
              <p className="sub">Gerando QR Code…</p>
            )}
            {qr.pairing && (
              <p className="pairing">
                Código de pareamento: <strong>{qr.pairing}</strong>
              </p>
            )}
            <div className="row-actions">
              <button className="btn ghost" onClick={() => void openQr(qr.channelId)}>
                Gerar novo QR
              </button>
              <button className="btn" onClick={() => setQr(null)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
