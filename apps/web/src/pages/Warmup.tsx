import { useEffect, useState, type ChangeEvent } from 'react';
import * as wu from '../lib/warmup';
import type { WarmupConfig, WarmupSession, WarmupWindow } from '../lib/warmup';
import { listCompanies, type Company } from '../lib/companies';
import { listChannels, type Channel } from '../lib/channels';
import { ApiError } from '../lib/api';

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function WindowsEditor({
  windows,
  onChange,
}: {
  windows: WarmupWindow[];
  onChange: (w: WarmupWindow[]) => void;
}) {
  const upd = (i: number, patch: Partial<WarmupWindow>) =>
    onChange(windows.map((w, idx) => (idx === i ? { ...w, ...patch } : w)));
  const toggleDay = (i: number, day: number) => {
    const w = windows[i];
    if (!w) return;
    const days = w.days.includes(day) ? w.days.filter((d) => d !== day) : [...w.days, day].sort();
    upd(i, { days });
  };
  return (
    <div className="wu-windows">
      {windows.map((w, i) => (
        <div key={i} className="wu-window">
          <div className="wu-days">
            {DAYS.map((label, d) => (
              <button
                key={d}
                type="button"
                className={`wu-day ${w.days.includes(d) ? 'on' : ''}`}
                onClick={() => toggleDay(i, d)}
              >
                {label}
              </button>
            ))}
          </div>
          <input type="time" value={w.start} onChange={(e) => upd(i, { start: e.target.value })} />
          <span>até</span>
          <input type="time" value={w.end} onChange={(e) => upd(i, { end: e.target.value })} />
          <button
            type="button"
            className="btn danger sm"
            onClick={() => onChange(windows.filter((_, idx) => idx !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn ghost sm"
        onClick={() =>
          onChange([...windows, { days: [1, 2, 3, 4, 5], start: '11:00', end: '11:15' }])
        }
      >
        + Janela de horário
      </button>
    </div>
  );
}

function ConfigEditor({
  config,
  onChange,
}: {
  config: WarmupConfig;
  onChange: (c: WarmupConfig) => void;
}) {
  const set = <K extends keyof WarmupConfig>(k: K, v: WarmupConfig[K]) =>
    onChange({ ...config, [k]: v });
  const num = (e: ChangeEvent<HTMLInputElement>) => Number(e.target.value);
  return (
    <div className="wu-config">
      <h4>Janelas (dia e horário)</h4>
      <WindowsEditor windows={config.windows} onChange={(w) => set('windows', w)} />

      <div className="grid2">
        <label className="field">
          <span>Intervalo entre msgs — mín (s)</span>
          <input
            type="number"
            value={config.minIntervalSec}
            onChange={(e) => set('minIntervalSec', num(e))}
          />
        </label>
        <label className="field">
          <span>Intervalo entre msgs — máx (s)</span>
          <input
            type="number"
            value={config.maxIntervalSec}
            onChange={(e) => set('maxIntervalSec', num(e))}
          />
        </label>
        <label className="field">
          <span>Msgs/dia no início (ramp-up)</span>
          <input
            type="number"
            value={config.baseDailyMessages}
            onChange={(e) => set('baseDailyMessages', num(e))}
          />
        </label>
        <label className="field">
          <span>Msgs/dia no máximo</span>
          <input
            type="number"
            value={config.maxDailyMessages}
            onChange={(e) => set('maxDailyMessages', num(e))}
          />
        </label>
        <label className="field">
          <span>Dias até o máximo (ramp-up)</span>
          <input
            type="number"
            value={config.rampUpDays}
            onChange={(e) => set('rampUpDays', num(e))}
          />
        </label>
        <label className="field">
          <span>% enviar imagem</span>
          <input type="number" value={config.imagePct} onChange={(e) => set('imagePct', num(e))} />
        </label>
        <label className="field">
          <span>% apagar p/ todos</span>
          <input
            type="number"
            value={config.deletePct}
            onChange={(e) => set('deletePct', num(e))}
          />
        </label>
        <label className="field">
          <span>% reagir com emoji</span>
          <input type="number" value={config.reactPct} onChange={(e) => set('reactPct', num(e))} />
        </label>
      </div>

      <label className="ai-toggle">
        <input
          type="checkbox"
          checked={config.useAi}
          onChange={(e) => set('useAi', e.target.checked)}
        />
        <span>Gerar o papo com IA (reserva: frases prontas)</span>
      </label>
      <div className="grid2">
        <label className="field">
          <span>Estilo do veterano</span>
          <input value={config.personaA ?? ''} onChange={(e) => set('personaA', e.target.value)} />
        </label>
        <label className="field">
          <span>Estilo do novato</span>
          <input value={config.personaB ?? ''} onChange={(e) => set('personaB', e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>Frases reserva (uma por linha)</span>
        <textarea
          rows={3}
          value={(config.phrases ?? []).join('\n')}
          onChange={(e) =>
            set(
              'phrases',
              e.target.value
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
        />
      </label>
    </div>
  );
}

function fileToBase64(file: File): Promise<{ mimeType: string; dataBase64: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const m = /^data:([^;]+);base64,(.*)$/s.exec(result);
      resolve({ mimeType: m?.[1] ?? file.type, dataBase64: m?.[2] ?? '' });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function Warmup() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [sessions, setSessions] = useState<WarmupSession[]>([]);
  const [assets, setAssets] = useState<wu.WarmupAsset[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    listCompanies()
      .then((list) => {
        setCompanies(list);
        const first = list[0];
        if (first) setCompanyId((c) => c || first.id);
      })
      .catch(() => undefined);
    listChannels()
      .then(setChannels)
      .catch(() => undefined);
  }, []);

  const reload = () => {
    if (!companyId) return;
    wu.listSessions(companyId)
      .then(setSessions)
      .catch(() => undefined);
    wu.listAssets(companyId)
      .then(setAssets)
      .catch(() => undefined);
  };
  useEffect(reload, [companyId]);

  const companyChannels = companyId
    ? channels.filter((c) => !c.companyId || c.companyId === companyId)
    : channels;

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function create() {
    if (!companyId || selected.size < 2) {
      setMsg('Selecione a empresa e ao menos 2 chips para o pool');
      return;
    }
    setMsg(null);
    try {
      await wu.createSession({ companyId, name: name || undefined, channelIds: [...selected] });
      setName('');
      setSelected(new Set());
      reload();
      setMsg('Sessão criada ✅');
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Erro ao criar');
    }
  }

  async function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    for (const f of files) {
      try {
        const { mimeType, dataBase64 } = await fileToBase64(f);
        if (dataBase64) await wu.addAsset({ companyId, name: f.name, mimeType, dataBase64 });
      } catch {
        /* ignora arquivo inválido */
      }
    }
    e.target.value = '';
    wu.listAssets(companyId)
      .then(setAssets)
      .catch(() => undefined);
  }

  return (
    <div className="settings">
      <h1>Aquecimento de chip</h1>
      <p className="sub">
        Um <strong>pool de chips</strong> seus conversa entre si (pares sorteados) em horários
        programados, com comportamento humano (digitando, imagens, ramp-up), para aquecer números
        novos e reduzir bloqueios. As conversas aparecem no <strong>Chat</strong> para
        acompanhamento.
      </p>
      {msg && (
        <div className="error" style={{ borderColor: 'var(--accent)' }}>
          {msg}
        </div>
      )}

      <div className="card-form">
        <h2>Empresa (cliente)</h2>
        {companies.length === 0 ? (
          <p className="sub">
            Cadastre uma empresa no menu <strong>Empresas</strong> primeiro.
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

      <div className="card-form">
        <h2>Galeria de imagens</h2>
        <p className="sub">Imagens que os chips podem enviar durante o aquecimento.</p>
        <input type="file" accept="image/*" multiple onChange={onUpload} />
        <div className="wu-gallery">
          {assets.length === 0 && <span className="sub">Nenhuma imagem ainda.</span>}
          {assets.map((a) => (
            <div key={a.id} className="wu-thumb">
              <img src={a.dataUrl} alt={a.name ?? ''} />
              <button
                type="button"
                className="btn danger sm"
                onClick={() => {
                  void wu.deleteAsset(a.id).then(() =>
                    wu
                      .listAssets(companyId)
                      .then(setAssets)
                      .catch(() => undefined),
                  );
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="card-form">
        <h2>Nova sessão de aquecimento</h2>
        <label className="field">
          <span>Nome</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Aquecimento chips novos"
          />
        </label>
        <label className="field">
          <span>Pool de chips (selecione 2 ou mais)</span>
        </label>
        <div className="wu-pool-pick">
          {companyChannels.length === 0 && (
            <span className="sub">Nenhum canal nesta empresa. Cadastre no menu Canais.</span>
          )}
          {companyChannels.map((c) => (
            <label key={c.id} className={`wu-pick ${selected.has(c.id) ? 'on' : ''}`}>
              <input
                type="checkbox"
                checked={selected.has(c.id)}
                onChange={() => toggleSelected(c.id)}
              />
              <span>{c.name}</span>
            </label>
          ))}
        </div>
        <button className="btn" onClick={() => void create()} style={{ marginTop: 10 }}>
          Criar sessão
        </button>
      </div>

      {sessions.map((s) => (
        <SessionCard key={s.id} session={s} onChanged={reload} setMsg={setMsg} />
      ))}
    </div>
  );
}

function SessionCard({
  session,
  onChanged,
  setMsg,
}: {
  session: WarmupSession;
  onChanged: () => void;
  setMsg: (m: string | null) => void;
}) {
  const [config, setConfig] = useState<WarmupConfig>(session.config);
  const running = session.status === 'RUNNING';
  const allConnected = session.channels.every((c) => c.connected);
  const veteranIds = config.veteranIds ?? [];

  const toggleVeteran = (id: string) =>
    setConfig((c) => {
      const set = new Set(c.veteranIds ?? []);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...c, veteranIds: [...set] };
    });

  async function toggle() {
    try {
      await wu.setSessionStatus(session.id, running ? 'PAUSED' : 'RUNNING');
      onChanged();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Erro');
    }
  }
  async function saveConfig() {
    try {
      await wu.updateSession(session.id, { config });
      setMsg('Configuração salva ✅');
      onChanged();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Erro ao salvar');
    }
  }
  async function test() {
    setMsg('Enviando mensagem de teste…');
    try {
      const r = await wu.runSessionNow(session.id);
      setMsg(
        r.sent
          ? 'Mensagem de teste enviada ✅'
          : 'Não enviou — verifique se ao menos 2 chips do pool estão conectados',
      );
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Erro no teste');
    }
  }
  async function remove() {
    if (!window.confirm('Excluir esta sessão de aquecimento?')) return;
    try {
      await wu.deleteSession(session.id);
      onChanged();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Erro ao excluir');
    }
  }

  return (
    <div className="card-form">
      <div className="wu-head">
        <div>
          <h2>{session.name}</h2>
          <div className="wu-pool">
            {session.channels.map((c) => (
              <span key={c.id} className="wu-chip">
                <span className={`dot ${c.connected ? 'ok' : 'err'}`} />
                {c.name}
                {c.veteran && <span className="wu-vet">🎓</span>}
              </span>
            ))}
          </div>
          <p className="sub small" style={{ marginTop: 6 }}>
            Pares sorteados no pool · hoje: {session.beatsToday} msgs
          </p>
        </div>
        <span className={`badge lead-${running ? 'QUALIFIED' : 'IN_PROGRESS'}`}>
          {running ? '🔥 Aquecendo' : 'Pausado'}
        </span>
      </div>

      {!allConnected && (
        <p className="sub small" style={{ color: 'var(--warn)' }}>
          ⚠️ Ao menos 2 chips do pool precisam estar <strong>conectados</strong> (menu Canais) para
          o aquecimento rodar.
        </p>
      )}

      <div className="row-actions">
        <button
          type="button"
          className={`btn ${running ? 'ghost' : ''}`}
          onClick={() => void toggle()}
        >
          {running ? 'Pausar' : 'Aquecer'}
        </button>
        <button type="button" className="btn ghost sm" onClick={() => void test()}>
          Testar agora
        </button>
        <span className="nav-spacer" />
        <button type="button" className="btn danger sm" onClick={() => void remove()}>
          Excluir
        </button>
      </div>

      <details className="wu-details">
        <summary>Configuração do fluxo</summary>
        <div className="wu-config">
          <h4>Veteranos (já aquecidos — puxam a conversa dos novos)</h4>
          <div className="wu-pool-pick">
            {session.channels.map((c) => (
              <label key={c.id} className={`wu-pick ${veteranIds.includes(c.id) ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={veteranIds.includes(c.id)}
                  onChange={() => toggleVeteran(c.id)}
                />
                <span>{c.name}</span>
              </label>
            ))}
          </div>
        </div>
        <ConfigEditor config={config} onChange={setConfig} />
        <button type="button" className="btn" onClick={() => void saveConfig()}>
          Salvar configuração
        </button>
      </details>
    </div>
  );
}
