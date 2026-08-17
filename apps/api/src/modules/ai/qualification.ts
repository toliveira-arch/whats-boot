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
  // Critérios de gate no nível padrão (aplicam quando não há campanha própria).
  defaultRequireDecisionMaker?: boolean;
  defaultRequireCnpj?: boolean;
  defaultAcceptedIndustries?: string[];
  defaultExcludedIndustries?: string[];
  defaultDisqualifyMessage: string;
  defaultHandoffMessage: string;
  campaigns: QualCampaign[];
  // Notificação do closer (comercial da empresa) quando o lead é MQL.
  notifyCloser?: boolean;
  closerTemplate?: string;
  // Trava: robô só atende leads que entraram pelo CRM/RD (origin=CRM).
  onlyCrmLeads?: boolean;
  // Qualificação guiada pelo prompt: a IA decide o veredito pelo texto do
  // prompt (sem gate/campanhas estruturadas).
  promptDriven?: boolean;
}

/** Modelo padrão da notificação enviada ao closer sobre um lead qualificado. */
export const DEFAULT_CLOSER_TEMPLATE = [
  '🔔 *Novo lead QUALIFICADO!*',
  '',
  '👤 {{nome}}',
  '📱 {{telefone}}',
  '',
  '📋 *Dados coletados:*',
  '{{dados}}',
  '',
  '📝 Resumo: {{resumo}}',
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
  /** Veredito sugerido pela IA (modo guiado por prompt). */
  verdict?: string;
}

export type LeadVerdict = 'IN_PROGRESS' | 'QUALIFIED' | 'DISQUALIFIED';

// --- helpers ---------------------------------------------------------------

function affirmative(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v !== 'string') return false;
  return /\b(sim|tenho|possuo|sou|yes|claro|positivo|com certeza)\b/i.test(v);
}

/** Extrai um número (faturamento) de number/string ("R$ 50.000", "50 mil", "30k", "1,5 milhão"). */
export function parseAmount(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const lower = v.toLowerCase().trim();
  const milhao = /milh(ã|a)o|milh(õ|o)es|kk/.test(lower);
  // "mil" ou sufixo "k" (30k, 30 k) — mas não "kk" (milhão).
  const mil = !milhao && (/\bmil\b/.test(lower) || /\d\s*k\b/.test(lower));
  const digits = lower
    .replace(/[^\d,.]/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '') // remove ponto de milhar
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

/** Normaliza um identificador: minúsculo, sem acento, só alfanumérico. */
function normKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// Apelidos comuns que a IA costuma usar → chave canônica do roteiro padrão.
const KEY_ALIASES: Record<string, string> = {
  segmento: 'ramo',
  ramosegmento: 'ramo',
  nicho: 'ramo',
  revenue: 'faturamento',
  faturamentomensal: 'faturamento',
  faturamentomedio: 'faturamento',
  principaldor: 'dor',
  dorprincipal: 'dor',
  ehodecisor: 'decisor',
  edecisor: 'decisor',
  decisao: 'decisor',
  temcnpj: 'cnpj',
  possuicnpj: 'cnpj',
};

/**
 * Remapeia as chaves de `collected` para as chaves canônicas do roteiro,
 * casando por chave OU rótulo (ignorando acentos/maiúsculas) e por apelidos.
 * Isso corrige quando a IA devolve "Segmento"/"Faturamento" em vez de
 * "ramo"/"faturamento", que impedia o roteiro de ser considerado completo.
 */
export function canonicalizeCollected(
  raw: Record<string, unknown> | null | undefined,
  script: QualField[],
): Record<string, unknown> {
  const map = new Map<string, string>();
  for (const f of script) {
    map.set(normKey(f.key), f.key);
    if (f.label) map.set(normKey(f.label), f.key);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    const nk = normKey(k);
    let canonical = map.get(nk);
    if (!canonical && KEY_ALIASES[nk]) {
      canonical = map.get(normKey(KEY_ALIASES[nk])) ?? KEY_ALIASES[nk];
    }
    if (!canonical) canonical = k;
    // Não sobrescreve um valor já preenchido com um vazio.
    const cur = out[canonical];
    const hasCur = cur !== undefined && cur !== null && String(cur).trim() !== '';
    const hasNew = v !== undefined && v !== null && String(v).trim() !== '';
    if (!hasCur || hasNew) out[canonical] = v;
  }
  return out;
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
  // Campanha sobrescreve; senão usa o critério padrão.
  const requireDecisionMaker = campaign?.requireDecisionMaker ?? config.defaultRequireDecisionMaker;
  const requireCnpj = campaign?.requireCnpj ?? config.defaultRequireCnpj;
  const excluded = campaign?.excludedIndustries?.length
    ? campaign.excludedIndustries
    : (config.defaultExcludedIndustries ?? []);
  const accepted = campaign?.acceptedIndustries?.length
    ? campaign.acceptedIndustries
    : (config.defaultAcceptedIndustries ?? []);

  // Piso de faturamento = gate estrito: só qualifica se confirmar que está >= piso.
  const amount = parseAmount(collected.faturamento ?? collected.revenue);
  if (floor != null) {
    if (amount == null) {
      reasons.push(`faturamento não confirmado (piso ${floor})`);
    } else if (amount < floor) {
      reasons.push(`faturamento ${amount} abaixo do piso ${floor}`);
    }
  }
  if (requireDecisionMaker && !affirmative(collected.decisor)) {
    reasons.push('não é o decisor');
  }
  if (requireCnpj && !affirmative(collected.cnpj)) {
    reasons.push('sem CNPJ');
  }
  const ramo = String(collected.ramo ?? collected.segmento ?? '').toLowerCase();
  if (ramo) {
    if (excluded.some((r) => r.trim() && ramo.includes(r.toLowerCase()))) {
      reasons.push('ramo excluído');
    }
    if (accepted.length && !accepted.some((r) => r.trim() && ramo.includes(r.toLowerCase()))) {
      reasons.push('ramo fora dos aceitos');
    }
  }

  return { verdict: reasons.length ? 'DISQUALIFIED' : 'QUALIFIED', reasons };
}

/**
 * Desqualificação ANTECIPADA: verifica, a cada resposta, se algum dado JÁ
 * coletado viola um critério de forma definitiva (não espera o roteiro acabar).
 * Diferente do gate final, aqui só reprova quando o dado está presente e é
 * claramente incompatível — nunca por "ainda não informado".
 */
export function evaluateEarlyDisqualify(
  config: QualConfig,
  campaign: QualCampaign | null,
  collected: Record<string, unknown>,
): { reasons: string[] } {
  const reasons: string[] = [];
  const has = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== '';
  const floor = campaign?.revenueFloor ?? config.defaultRevenueFloor ?? null;
  const requireDecisionMaker = campaign?.requireDecisionMaker ?? config.defaultRequireDecisionMaker;
  const requireCnpj = campaign?.requireCnpj ?? config.defaultRequireCnpj;
  const excluded = campaign?.excludedIndustries?.length
    ? campaign.excludedIndustries
    : (config.defaultExcludedIndustries ?? []);
  const accepted = campaign?.acceptedIndustries?.length
    ? campaign.acceptedIndustries
    : (config.defaultAcceptedIndustries ?? []);

  const amount = parseAmount(collected.faturamento ?? collected.revenue);
  if (floor != null && amount != null && amount < floor) {
    reasons.push(`faturamento ${amount} abaixo do piso ${floor}`);
  }
  if (requireDecisionMaker && has(collected.decisor) && !affirmative(collected.decisor)) {
    reasons.push('não é o decisor');
  }
  if (requireCnpj && has(collected.cnpj) && !affirmative(collected.cnpj)) {
    reasons.push('sem CNPJ');
  }
  const ramo = String(collected.ramo ?? collected.segmento ?? '').toLowerCase();
  if (ramo) {
    if (excluded.some((r) => r.trim() && ramo.includes(r.toLowerCase()))) {
      reasons.push('ramo excluído');
    }
    if (accepted.length && !accepted.some((r) => r.trim() && ramo.includes(r.toLowerCase()))) {
      reasons.push('ramo fora dos aceitos');
    }
  }
  return { reasons };
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
