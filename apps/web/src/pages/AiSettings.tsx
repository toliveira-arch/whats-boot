import { useEffect, useState, type FormEvent } from 'react';
import * as ai from '../lib/ai';
import type { AiAgent, QualConfig } from '../lib/ai';
import { emptyQualConfig } from '../lib/ai';
import { QualificationEditor } from '../components/QualificationEditor';
import { listCompanies, type Company } from '../lib/companies';
import { ApiError } from '../lib/api';

const EMPTY: ai.AiAgentInput = {
  name: 'Agente IA',
  provider: 'OPENAI',
  model: 'gpt-4o-mini',
  temperature: 0.7,
  maxTokens: 1024,
  mode: 'COPILOT',
  systemPrompt: '',
  forbiddenWords: [],
  requiredWords: [],
  activeFrom: null,
  activeTo: null,
  maxMessagesPerConversation: null,
  minResponseSeconds: 0,
  maxResponseSeconds: 0,
  isActive: true,
};

function csv(v: string): string[] {
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function AiSettings() {
  const [form, setForm] = useState<ai.AiAgentInput>(EMPTY);
  const [forbidden, setForbidden] = useState('');
  const [required, setRequired] = useState('');
  const [qual, setQual] = useState<QualConfig>(emptyQualConfig());
  const [creds, setCreds] = useState<ai.CredentialsInfo | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState<string>('');

  const [credProvider, setCredProvider] = useState('OPENAI');
  const [credKey, setCredKey] = useState('');
  const [testMsg, setTestMsg] = useState('Olá, quero saber o preço.');
  const [testOut, setTestOut] = useState<string | null>(null);

  // Carrega empresas e credenciais uma vez.
  useEffect(() => {
    listCompanies()
      .then((list) => {
        setCompanies(list);
        const first = list[0];
        if (first) setCompanyId((cur) => cur || first.id);
      })
      .catch(() => undefined);
    ai.listCredentials()
      .then(setCreds)
      .catch(() => undefined);
  }, []);

  // Recarrega a configuração sempre que a empresa selecionada muda.
  useEffect(() => {
    if (!companyId) return;
    ai.getAgent(companyId)
      .then((a: AiAgent | null) => {
        if (a) {
          setForm(a);
          setForbidden(a.forbiddenWords.join(', '));
          setRequired(a.requiredWords.join(', '));
          setQual(
            a.qualification ? { ...emptyQualConfig(), ...a.qualification } : emptyQualConfig(),
          );
        } else {
          // Empresa ainda sem agente: começa do padrão.
          setForm(EMPTY);
          setForbidden('');
          setRequired('');
          setQual(emptyQualConfig());
        }
      })
      .catch(() => undefined);
  }, [companyId]);

  function set<K extends keyof ai.AiAgentInput>(key: K, value: ai.AiAgentInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function saveAgent(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!companyId) {
      setMsg('Selecione uma empresa primeiro');
      return;
    }
    try {
      await ai.saveAgent(
        {
          ...form,
          forbiddenWords: csv(forbidden),
          requiredWords: csv(required),
          qualification: qual,
        },
        companyId,
      );
      setMsg('Configuração salva ✅');
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Erro ao salvar');
    }
  }

  async function saveCred(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await ai.setCredential(credProvider, credKey);
      setCredKey('');
      setCreds(await ai.listCredentials());
      setMsg('Credencial salva ✅');
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Erro ao salvar credencial');
    }
  }

  async function runTest() {
    setTestOut('…');
    try {
      const r = await ai.testAgent(testMsg, companyId);
      setTestOut(r.content);
    } catch (err) {
      setTestOut(err instanceof ApiError ? err.message : 'Erro no teste');
    }
  }

  const configured = new Set(creds?.credentials.map((c) => c.provider) ?? []);

  return (
    <div className="settings">
      <h1>Configuração de IA</h1>
      {msg && (
        <div className="error" style={{ borderColor: 'var(--accent)' }}>
          {msg}
        </div>
      )}

      <div className="card-form">
        <h2>Empresa (cliente)</h2>
        <p className="sub">
          A configuração de IA é individual por empresa. Selecione a empresa para editar o agente
          dela.
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

      <form className="card-form" onSubmit={saveAgent}>
        <h2>Agente</h2>
        <div className="grid2">
          <label className="field">
            <span>Ativo</span>
            <select
              value={form.isActive ? '1' : '0'}
              onChange={(e) => set('isActive', e.target.value === '1')}
            >
              <option value="1">Sim</option>
              <option value="0">Não</option>
            </select>
          </label>
          <label className="field">
            <span>Modo</span>
            <select
              value={form.mode}
              onChange={(e) => set('mode', e.target.value as AiAgent['mode'])}
            >
              <option value="OFF">Desligado</option>
              <option value="COPILOT">Copiloto (sugere)</option>
              <option value="AUTOPILOT">Autopilot (responde)</option>
            </select>
          </label>
          <label className="field">
            <span>Provedor</span>
            <select
              value={form.provider}
              onChange={(e) => set('provider', e.target.value as AiAgent['provider'])}
            >
              <option value="OPENAI">OpenAI</option>
              <option value="GOOGLE">Gemini (Google)</option>
            </select>
          </label>
          <label className="field">
            <span>Modelo</span>
            <input value={form.model ?? ''} onChange={(e) => set('model', e.target.value)} />
          </label>
          <label className="field">
            <span>Temperatura ({form.temperature})</span>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={form.temperature ?? 0.7}
              onChange={(e) => set('temperature', Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>Máx. tokens</span>
            <input
              type="number"
              value={form.maxTokens ?? 1024}
              onChange={(e) => set('maxTokens', Number(e.target.value))}
            />
          </label>
        </div>

        <label className="field">
          <span>Prompt (instruções do sistema)</span>
          <textarea
            rows={4}
            value={form.systemPrompt ?? ''}
            onChange={(e) => set('systemPrompt', e.target.value)}
          />
        </label>

        <div className="grid2">
          <label className="field">
            <span>Palavras obrigatórias (vírgula)</span>
            <input value={required} onChange={(e) => setRequired(e.target.value)} />
          </label>
          <label className="field">
            <span>Palavras proibidas (vírgula)</span>
            <input value={forbidden} onChange={(e) => setForbidden(e.target.value)} />
          </label>
          <label className="field">
            <span>Horário ativo — de</span>
            <input
              type="time"
              value={form.activeFrom ?? ''}
              onChange={(e) => set('activeFrom', e.target.value || null)}
            />
          </label>
          <label className="field">
            <span>Horário ativo — até</span>
            <input
              type="time"
              value={form.activeTo ?? ''}
              onChange={(e) => set('activeTo', e.target.value || null)}
            />
          </label>
          <label className="field">
            <span>Máx. respostas por conversa</span>
            <input
              type="number"
              value={form.maxMessagesPerConversation ?? ''}
              onChange={(e) =>
                set('maxMessagesPerConversation', e.target.value ? Number(e.target.value) : null)
              }
            />
          </label>
          <label className="field">
            <span>Tempo mín. (s) / máx. (s)</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="number"
                value={form.minResponseSeconds ?? 0}
                onChange={(e) => set('minResponseSeconds', Number(e.target.value))}
              />
              <input
                type="number"
                value={form.maxResponseSeconds ?? 0}
                onChange={(e) => set('maxResponseSeconds', Number(e.target.value))}
              />
            </div>
          </label>
        </div>

        <QualificationEditor value={qual} onChange={setQual} />

        <button type="submit" className="btn">
          Salvar agente e qualificação
        </button>
      </form>

      <form className="card-form" onSubmit={saveCred}>
        <h2>Credenciais dos provedores</h2>
        <p className="sub">
          As chaves de API são compartilhadas por toda a conta (valem para todas as empresas). A
          personalização por empresa é feita no agente e na qualificação acima.
        </p>
        <p className="sub">
          Configurados: {configured.size ? Array.from(configured).join(', ') : 'nenhum'}
        </p>
        <div className="grid2">
          <label className="field">
            <span>Provedor</span>
            <select value={credProvider} onChange={(e) => setCredProvider(e.target.value)}>
              <option value="OPENAI">OpenAI</option>
              <option value="GOOGLE">Gemini (Google)</option>
            </select>
          </label>
          <label className="field">
            <span>API Key</span>
            <input
              type="password"
              value={credKey}
              onChange={(e) => setCredKey(e.target.value)}
              placeholder="sk-… / AIza…"
            />
          </label>
        </div>
        <button type="submit" className="btn">
          Salvar credencial
        </button>
      </form>

      <div className="card-form">
        <h2>Testar</h2>
        <label className="field">
          <span>Mensagem do cliente</span>
          <input value={testMsg} onChange={(e) => setTestMsg(e.target.value)} />
        </label>
        <button className="btn ghost" onClick={runTest}>
          Gerar resposta de teste
        </button>
        {testOut && <div className="test-out">{testOut}</div>}
      </div>
    </div>
  );
}
