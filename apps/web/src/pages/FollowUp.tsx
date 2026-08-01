import { useEffect, useState } from 'react';
import * as fu from '../lib/followup';
import type { FollowUpStep } from '../lib/followup';
import { listCompanies, type Company } from '../lib/companies';
import { ApiError } from '../lib/api';

function humanHours(h: number): string {
  if (h < 24) return `${h}h`;
  const d = Math.round((h / 24) * 10) / 10;
  return `${d} dia${d === 1 ? '' : 's'}`;
}

export function FollowUp() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [steps, setSteps] = useState<FollowUpStep[]>([]);
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
    fu.getSequence(companyId)
      .then((s) => {
        setEnabled(s.enabled);
        setSteps(s.steps);
      })
      .catch(() => undefined);
  }, [companyId]);

  const update = (i: number, patch: Partial<FollowUpStep>) =>
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const remove = (i: number) => setSteps((prev) => prev.filter((_, idx) => idx !== i));
  const add = () => {
    const last = steps[steps.length - 1];
    const next = last ? last.afterHours + 24 : 24;
    setSteps((prev) => [...prev, { afterHours: next, text: '', active: true }]);
  };

  async function save() {
    if (!companyId) return;
    setMsg(null);
    try {
      const saved = await fu.saveSequence(companyId, { enabled, steps });
      setEnabled(saved.enabled);
      setSteps(saved.steps);
      setMsg('Follow-up salvo ✅');
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Erro ao salvar');
    }
  }

  return (
    <div className="settings">
      <h1>Follow-up (reengajamento)</h1>
      <p className="sub">
        Sequência de mensagens automáticas enviadas quando o cliente fica sem responder. O tempo é
        contado a partir da última mensagem do cliente; se ele responder, a sequência reinicia.
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
          <span>Ativar follow-up automático para esta empresa</span>
        </label>

        <h3>Mensagens (até 8)</h3>
        <p className="sub small">
          Use <strong>{'{{nome}}'}</strong> para o nome do contato. O tempo de cada passo é contado
          desde a última resposta do cliente (ex.: 24h, 48h, 72h…).
        </p>

        {steps.length === 0 && <p className="sub">Nenhuma mensagem configurada ainda.</p>}

        {steps.map((s, i) => (
          <div key={i} className="fu-step">
            <div className="fu-step-head">
              <span className="fu-badge">Msg {i + 1}</span>
              <label className="fu-after">
                <span>Após</span>
                <input
                  type="number"
                  min={0}
                  value={s.afterHours}
                  onChange={(e) => update(i, { afterHours: Number(e.target.value) })}
                />
                <span>horas sem resposta ({humanHours(s.afterHours)})</span>
              </label>
              <label className="qual-req">
                <input
                  type="checkbox"
                  checked={s.active}
                  onChange={(e) => update(i, { active: e.target.checked })}
                />
                ativa
              </label>
              <span className="nav-spacer" />
              <button type="button" className="btn danger sm" onClick={() => remove(i)}>
                ×
              </button>
            </div>
            <textarea
              rows={2}
              placeholder="Mensagem enviada ao cliente…"
              value={s.text}
              onChange={(e) => update(i, { text: e.target.value })}
            />
          </div>
        ))}

        {steps.length < 8 && (
          <button type="button" className="btn ghost sm" onClick={add}>
            + Adicionar mensagem
          </button>
        )}

        <div style={{ marginTop: 14 }}>
          <button className="btn" onClick={() => void save()}>
            Salvar follow-up
          </button>
        </div>
      </div>
    </div>
  );
}
