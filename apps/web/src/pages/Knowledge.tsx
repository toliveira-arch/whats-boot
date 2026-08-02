import { useEffect, useState } from 'react';
import * as kb from '../lib/knowledge';
import type { FaqEntry } from '../lib/knowledge';
import { listCompanies, type Company } from '../lib/companies';
import { ApiError } from '../lib/api';

export function Knowledge() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [notes, setNotes] = useState('');
  const [entries, setEntries] = useState<FaqEntry[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    listCompanies()
      .then((list) => {
        setCompanies(list);
        const first = list[0];
        if (first) setCompanyId((c) => c || first.id);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!companyId) return;
    kb.getKnowledge(companyId)
      .then((k) => {
        setEnabled(k.enabled);
        setNotes(k.notes);
        setEntries(k.entries);
      })
      .catch(() => undefined);
  }, [companyId]);

  const update = (i: number, patch: Partial<FaqEntry>) =>
    setEntries((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  const remove = (i: number) => setEntries((prev) => prev.filter((_, idx) => idx !== i));
  const add = () => setEntries((prev) => [...prev, { q: '', a: '' }]);

  async function save() {
    if (!companyId) return;
    setMsg(null);
    try {
      const saved = await kb.saveKnowledge(companyId, { enabled, notes, entries });
      setEnabled(saved.enabled);
      setNotes(saved.notes);
      setEntries(saved.entries);
      setMsg('Base de conhecimento salva ✅');
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Erro ao salvar');
    }
  }

  return (
    <div className="settings">
      <h1>Base de conhecimento</h1>
      <p className="sub">
        A IA usa estas informações para responder dúvidas do cliente durante a conversa (além de
        qualificar). Se a resposta não estiver aqui, ela é orientada a não inventar.
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
        <label className="ai-toggle">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>Usar a base de conhecimento nesta empresa</span>
        </label>

        <label className="field">
          <span>Sobre a empresa / produto / regras (texto livre)</span>
          <textarea
            rows={6}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex.: Somos uma contabilidade especializada em... Horário de atendimento... Formas de pagamento... Diferenciais..."
          />
        </label>

        <h3>Perguntas frequentes</h3>
        <p className="sub small">Perguntas e respostas que a IA pode usar diretamente.</p>
        {entries.length === 0 && <p className="sub">Nenhuma pergunta cadastrada ainda.</p>}
        {entries.map((e, i) => (
          <div key={i} className="fu-step">
            <div className="fu-step-head">
              <span className="fu-badge">#{i + 1}</span>
              <input
                className="grow"
                placeholder="Pergunta (ex.: Quanto custa?)"
                value={e.q}
                onChange={(ev) => update(i, { q: ev.target.value })}
                style={{ flex: 1 }}
              />
              <button type="button" className="btn danger sm" onClick={() => remove(i)}>
                ×
              </button>
            </div>
            <textarea
              rows={2}
              placeholder="Resposta"
              value={e.a}
              onChange={(ev) => update(i, { a: ev.target.value })}
            />
          </div>
        ))}
        <button type="button" className="btn ghost sm" onClick={add}>
          + Adicionar pergunta
        </button>

        <div style={{ marginTop: 14 }}>
          <button className="btn" onClick={() => void save()}>
            Salvar base de conhecimento
          </button>
        </div>
      </div>
    </div>
  );
}
