/**
 * Motor de pré-qualificação de leads (SDR).
 * A IA conduz o roteiro e extrai os dados (JSON); o GATE (piso/critérios) é
 * avaliado aqui no código — determinístico, não fica "no chute" do modelo.
 */

export interface QualField {
  key: string; // ex.: 'faturamento', 'ramo', 'cnpj', 'decisor', 'dor'
  label: string; // rótulo do dado
  question: string; // pergunta sugerida (natural)
  required: boolean; // conta para o gate/completude
}

export interface QualCampaign {
  id: string;
  name: string;
  triggers: string[]; // palavras-gatilho para detecção
  description?: string; // ajuda a IA a classificar
  revenueFloor?: number | null; // piso de faturamento mensal (R$)
  requireDecisionMaker?: boolean;
  requireCnpj?: boolean;
  acceptedIndustries?: string[];
  excludedIndustries?: string[];
  script?: QualField[]; // roteiro próprio (senão usa o padrão)
  disqualifyMessage?: string;
  handoffMessage?: string;
}

export interface QualConfig {
  enabled: boolean;
  detection: 'ai+keywords' | 'keywords';
  onQualified: 'pause+assign' | 'mark';
  defaultScript: QualField[];
  defaultRevenueFloor?: number | null;
  defaultDisqualifyMessage: string;
  defaultHandoffMessage: string;
  campaigns: QualCampaign[];
  // Notificação do closer (comercial da empresa) quando o lead é MQL.
  notifyCloser?: boolean;
  closerTemplate?: string;
}

/** Modelo padrão da notificação enviada ao closer sobre um lead qualificado. */
export const DEFAULT_CLOSER_TEMPLATE = [
  '🔔 *Novo lead QUALIFICADO!*',
  '',
  '👤 {{nome}}',
  '📱 {{telefone}}',
  '🏢 Ramo: {{ramo}}',
  '💰 Faturamento: {{faturamento}}',
  '🎯 Interesse: {{interesse}} · Urgência: {{urgencia}}',
  '',
  '📝 Cenário: {{resumo}}',
  '',
  'Fale com o lead o quanto antes! 🚀',
].join('\n');

/** Saída estruturada esperada do modelo (JSON). */
export interface QualLlmOutput {
  reply: string;
  campaignId: string | null;
  collected: Record<string, unknown>;
  interest?: string;
  urgency?: string;
  summary?: string;
}

export type LeadVerdict = 'IN_PROGRESS' | 'QUALIFIED' | 'DISQUALIFIED';

// --- helpers ---------------------------------------------------------------

function affirmative(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v !== 'string') return false;
  return /\b(sim|tenho|possuo|sou|yes|claro|positivo|com certeza)\b/i.test(v);
}

/** Extrai um número (faturamento) de number/string ("R$ 50.000", "50 mil"). */
export function parseAmount(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const lower = v.toLowerCase();
  const mil = /mil/.test(lower);
  const milhao = /milh(ã|a)o|kk|kkk/.test(lower);
  const digits = lower
    .replace(/[^\d,.]/g, '')
    .replace(/\.(?=\d{3}\b)/g, '')
    .replace(',', '.');
  const n = parseFloat(digits);
  if (!Number.isFinite(n)) return null;
  if (milhao) return n * 1_000_000;
  if (mil) return n * 1_000;
  return n;
}

export function resolveCampaign(
  config: QualConfig,
  campaignId: string | null,
): QualCampaign | null {
  if (!campaignId) return null;
  return config.campaigns.find((c) => c.id === campaignId) ?? null;
}

export function effectiveScript(config: QualConfig, campaign: QualCampaign | null): QualField[] {
  return campaign?.script?.length ? campaign.script : config.defaultScript;
}

/** Todos os campos obrigatórios do roteiro já foram coletados? */
export function isComplete(script: QualField[], collected: Record<string, unknown>): boolean {
  return script
    .filter((f) => f.required)
    .every((f) => {
      const val = collected[f.key];
      return val !== undefined && val !== null && String(val).trim() !== '';
    });
}

/**
 * Avalia o GATE de MQL sobre os dados coletados. Retorna QUALIFIED ou
 * DISQUALIFIED + motivos (uso interno, nunca exposto ao cliente).
 */
export function evaluateGate(
  config: QualConfig,
  campaign: QualCampaign | null,
  collected: Record<string, unknown>,
): { verdict: Exclude<LeadVerdict, 'IN_PROGRESS'>; reasons: string[] } {
  const reasons: string[] = [];
  const floor = campaign?.revenueFloor ?? config.defaultRevenueFloor ?? null;

  const amount = parseAmount(collected.faturamento ?? collected.revenue);
  if (floor != null && amount != null && amount < floor) {
    reasons.push(`faturamento ${amount} abaixo do piso ${floor}`);
  }
  if (campaign?.requireDecisionMaker && !affirmative(collected.decisor)) {
    reasons.push('não é o decisor');
  }
  if (campaign?.requireCnpj && !affirmative(collected.cnpj)) {
    reasons.push('sem CNPJ');
  }
  const ramo = String(collected.ramo ?? collected.segmento ?? '').toLowerCase();
  if (ramo) {
    if (campaign?.excludedIndustries?.some((r) => ramo.includes(r.toLowerCase()))) {
      reasons.push('ramo excluído');
    }
    if (
      campaign?.acceptedIndustries?.length &&
      !campaign.acceptedIndustries.some((r) => ramo.includes(r.toLowerCase()))
    ) {
      reasons.push('ramo fora dos aceitos');
    }
  }

  return { verdict: reasons.length ? 'DISQUALIFIED' : 'QUALIFIED', reasons };
}

/** Detecção por palavras-gatilho (reforça a classificação da IA). */
export function detectByKeywords(config: QualConfig, text: string): QualCampaign | null {
  const t = text.toLowerCase();
  for (const c of config.campaigns) {
    if (c.triggers?.some((k) => k.trim() && t.includes(k.toLowerCase()))) return c;
  }
  return null;
}

/** Roteiro SDR sugerido (usado como padrão inicial na UI). */
export const SUGGESTED_SCRIPT: QualField[] = [
  { key: 'nome', label: 'Nome', question: 'Como posso te chamar?', required: false },
  {
    key: 'decisor',
    label: 'É o decisor?',
    question: 'Você é quem decide sobre isso na empresa ou tem mais alguém envolvido?',
    required: true,
  },
  {
    key: 'faturamento',
    label: 'Faturamento mensal',
    question:
      'Pra eu entender melhor sua realidade, hoje a empresa está numa fase inicial ou já tem um faturamento mais consolidado?',
    required: true,
  },
  {
    key: 'ramo',
    label: 'Ramo / segmento',
    question: 'Qual é o segmento da sua empresa?',
    required: true,
  },
  {
    key: 'cnpj',
    label: 'Tem CNPJ?',
    question: 'A empresa já tem CNPJ aberto?',
    required: true,
  },
  {
    key: 'dor',
    label: 'Principal dor',
    question: 'O que mais tem te preocupado hoje quando o assunto é financeiro/contábil?',
    required: true,
  },
];
