import type { QualCampaign, QualConfig, QualField } from '../lib/ai';
import { SUGGESTED_SCRIPT } from '../lib/ai';

interface Props {
  value: QualConfig;
  onChange: (next: QualConfig) => void;
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `c${Math.floor(performance.now())}`;
  }
}

function csv(v: string): string[] {
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Editor de um roteiro (lista de perguntas). Usado no padrão e por campanha. */
function ScriptEditor({
  script,
  onChange,
}: {
  script: QualField[];
  onChange: (s: QualField[]) => void;
}) {
  const update = (i: number, patch: Partial<QualField>) =>
    onChange(script.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  const remove = (i: number) => onChange(script.filter((_, idx) => idx !== i));
  const add = () => onChange([...script, { key: '', label: '', question: '', required: true }]);

  return (
    <div className="qual-script">
      {script.map((f, i) => (
        <div key={i} className="qual-field">
          <input
            placeholder="chave (ex: faturamento)"
            value={f.key}
            onChange={(e) => update(i, { key: e.target.value })}
          />
          <input
            placeholder="rótulo"
            value={f.label}
            onChange={(e) => update(i, { label: e.target.value })}
          />
          <input
            className="grow"
            placeholder="pergunta natural"
            value={f.question}
            onChange={(e) => update(i, { question: e.target.value })}
          />
          <label className="qual-req">
            <input
              type="checkbox"
              checked={f.required}
              onChange={(e) => update(i, { required: e.target.checked })}
            />
            obrig.
          </label>
          <button type="button" className="btn danger sm" onClick={() => remove(i)}>
            ×
          </button>
        </div>
      ))}
      <div className="row-actions">
        <button type="button" className="btn ghost sm" onClick={add}>
          + Pergunta
        </button>
        <button type="button" className="btn ghost sm" onClick={() => onChange(SUGGESTED_SCRIPT)}>
          Usar roteiro SDR sugerido
        </button>
      </div>
    </div>
  );
}

export function QualificationEditor({ value, onChange }: Props) {
  const set = <K extends keyof QualConfig>(key: K, v: QualConfig[K]) =>
    onChange({ ...value, [key]: v });

  const updateCampaign = (i: number, patch: Partial<QualCampaign>) =>
    set(
      'campaigns',
      value.campaigns.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    );
  const removeCampaign = (i: number) =>
    set(
      'campaigns',
      value.campaigns.filter((_, idx) => idx !== i),
    );
  const addCampaign = () =>
    set('campaigns', [
      ...value.campaigns,
      {
        id: newId(),
        name: 'Nova campanha',
        triggers: [],
        revenueFloor: null,
        requireDecisionMaker: false,
        requireCnpj: false,
      },
    ]);

  return (
    <div className="card-form">
      <h2>Pré-qualificação de leads (SDR)</h2>

      <label className="ai-toggle">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => set('enabled', e.target.checked)}
        />
        <span>Ativar qualificação automática</span>
      </label>

      {value.enabled && (
        <>
          <div className="grid2">
            <label className="field">
              <span>Detecção de campanha</span>
              <select
                value={value.detection}
                onChange={(e) => set('detection', e.target.value as QualConfig['detection'])}
              >
                <option value="ai+keywords">IA classifica + palavras-gatilho</option>
                <option value="keywords">Só palavras-gatilho</option>
              </select>
            </label>
            <label className="field">
              <span>Quando qualificar (MQL)</span>
              <select
                value={value.onQualified}
                onChange={(e) => set('onQualified', e.target.value as QualConfig['onQualified'])}
              >
                <option value="pause+assign">Pausar IA e atribuir a atendente</option>
                <option value="mark">Só marcar como MQL</option>
              </select>
            </label>
            <label className="field">
              <span>Piso de faturamento mensal padrão (R$)</span>
              <input
                type="number"
                value={value.defaultRevenueFloor ?? ''}
                onChange={(e) =>
                  set('defaultRevenueFloor', e.target.value ? Number(e.target.value) : null)
                }
                placeholder="ex: 30000"
              />
            </label>
          </div>

          <label className="field">
            <span>Mensagem quando NÃO qualificado (dispensa cordial, sem expor o critério)</span>
            <textarea
              rows={2}
              value={value.defaultDisqualifyMessage}
              onChange={(e) => set('defaultDisqualifyMessage', e.target.value)}
            />
          </label>
          <label className="field">
            <span>Mensagem quando QUALIFICADO (encaminhamento)</span>
            <textarea
              rows={2}
              value={value.defaultHandoffMessage}
              onChange={(e) => set('defaultHandoffMessage', e.target.value)}
            />
          </label>

          <h3>Notificar o closer (lead qualificado)</h3>
          <label className="ai-toggle">
            <input
              type="checkbox"
              checked={value.notifyCloser ?? false}
              onChange={(e) => set('notifyCloser', e.target.checked)}
            />
            <span>Avisar o closer da empresa no WhatsApp quando o lead for MQL</span>
          </label>
          <label className="field">
            <span>
              Mensagem para o closer — variáveis: {'{{nome}} {{telefone}} {{ramo}}'}{' '}
              {'{{faturamento}} {{interesse}} {{urgencia}} {{resumo}} {{empresa}} {{closer}}'}
            </span>
            <textarea
              rows={8}
              value={value.closerTemplate ?? ''}
              onChange={(e) => set('closerTemplate', e.target.value)}
            />
          </label>
          <p className="sub small">
            O WhatsApp do closer é configurado por empresa no menu <strong>Empresas</strong>.
          </p>

          <h3>Roteiro padrão</h3>
          <ScriptEditor script={value.defaultScript} onChange={(s) => set('defaultScript', s)} />

          <h3>Campanhas</h3>
          <p className="sub small">
            Cada campanha pode ter gatilhos, piso e mensagens próprios. Se não definir roteiro
            próprio, usa o roteiro padrão acima.
          </p>
          {value.campaigns.map((c, i) => (
            <div key={c.id} className="qual-campaign">
              <div className="grid2">
                <label className="field">
                  <span>Nome da campanha</span>
                  <input
                    value={c.name}
                    onChange={(e) => updateCampaign(i, { name: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Palavras-gatilho (vírgula)</span>
                  <input
                    value={(c.triggers || []).join(', ')}
                    onChange={(e) => updateCampaign(i, { triggers: csv(e.target.value) })}
                    placeholder="restaurante, delivery, cardápio"
                  />
                </label>
                <label className="field">
                  <span>Descrição (ajuda a IA a classificar)</span>
                  <input
                    value={c.description ?? ''}
                    onChange={(e) => updateCampaign(i, { description: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Piso de faturamento (R$) — vazio usa o padrão</span>
                  <input
                    type="number"
                    value={c.revenueFloor ?? ''}
                    onChange={(e) =>
                      updateCampaign(i, {
                        revenueFloor: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Ramos aceitos (vírgula, opcional)</span>
                  <input
                    value={(c.acceptedIndustries || []).join(', ')}
                    onChange={(e) => updateCampaign(i, { acceptedIndustries: csv(e.target.value) })}
                  />
                </label>
                <label className="field">
                  <span>Ramos excluídos (vírgula, opcional)</span>
                  <input
                    value={(c.excludedIndustries || []).join(', ')}
                    onChange={(e) => updateCampaign(i, { excludedIndustries: csv(e.target.value) })}
                  />
                </label>
              </div>
              <div className="row-actions">
                <label className="qual-req">
                  <input
                    type="checkbox"
                    checked={Boolean(c.requireDecisionMaker)}
                    onChange={(e) => updateCampaign(i, { requireDecisionMaker: e.target.checked })}
                  />
                  Exige decisor
                </label>
                <label className="qual-req">
                  <input
                    type="checkbox"
                    checked={Boolean(c.requireCnpj)}
                    onChange={(e) => updateCampaign(i, { requireCnpj: e.target.checked })}
                  />
                  Exige CNPJ
                </label>
                <span className="nav-spacer" />
                <button type="button" className="btn danger sm" onClick={() => removeCampaign(i)}>
                  Excluir campanha
                </button>
              </div>
              <label className="field">
                <span>Mensagem de dispensa (vazio usa a padrão)</span>
                <textarea
                  rows={2}
                  value={c.disqualifyMessage ?? ''}
                  onChange={(e) => updateCampaign(i, { disqualifyMessage: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Mensagem de encaminhamento (vazio usa a padrão)</span>
                <textarea
                  rows={2}
                  value={c.handoffMessage ?? ''}
                  onChange={(e) => updateCampaign(i, { handoffMessage: e.target.value })}
                />
              </label>
              <details className="qual-details">
                <summary>Roteiro próprio desta campanha (opcional)</summary>
                <ScriptEditor
                  script={c.script ?? []}
                  onChange={(s) => updateCampaign(i, { script: s })}
                />
              </details>
            </div>
          ))}
          <button type="button" className="btn ghost" onClick={addCampaign}>
            + Nova campanha
          </button>
        </>
      )}
    </div>
  );
}
