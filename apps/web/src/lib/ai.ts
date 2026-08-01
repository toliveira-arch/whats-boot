import { authFetch } from './api';

export interface QualField {
  key: string;
  label: string;
  question: string;
  required: boolean;
}

export interface QualCampaign {
  id: string;
  name: string;
  triggers: string[];
  description?: string;
  revenueFloor?: number | null;
  requireDecisionMaker?: boolean;
  requireCnpj?: boolean;
  acceptedIndustries?: string[];
  excludedIndustries?: string[];
  script?: QualField[];
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
  notifyCloser?: boolean;
  closerTemplate?: string;
}

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

export interface AiAgent {
  id: string;
  name: string;
  provider: 'OPENAI' | 'GOOGLE';
  model: string;
  temperature: number;
  maxTokens: number;
  mode: 'OFF' | 'COPILOT' | 'AUTOPILOT';
  systemPrompt: string | null;
  forbiddenWords: string[];
  requiredWords: string[];
  activeFrom: string | null;
  activeTo: string | null;
  maxMessagesPerConversation: number | null;
  minResponseSeconds: number;
  maxResponseSeconds: number;
  isActive: boolean;
  qualification?: QualConfig | null;
}

export type AiAgentInput = Partial<Omit<AiAgent, 'id'>>;

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
    question: 'Hoje a empresa está numa fase inicial ou já tem um faturamento mais consolidado?',
    required: true,
  },
  {
    key: 'ramo',
    label: 'Ramo / segmento',
    question: 'Qual é o segmento da empresa?',
    required: true,
  },
  { key: 'cnpj', label: 'Tem CNPJ?', question: 'A empresa já tem CNPJ aberto?', required: true },
  {
    key: 'dor',
    label: 'Principal dor',
    question: 'O que mais tem te preocupado no financeiro/contábil hoje?',
    required: true,
  },
];

export function emptyQualConfig(): QualConfig {
  return {
    enabled: false,
    detection: 'ai+keywords',
    onQualified: 'pause+assign',
    defaultScript: SUGGESTED_SCRIPT,
    defaultRevenueFloor: null,
    defaultDisqualifyMessage:
      'Obrigado pelo contato! No momento não conseguimos seguir com o seu caso, mas fico à disposição se algo mudar. 🙏',
    defaultHandoffMessage:
      'Perfeito! Pelo que conversamos, faz total sentido você falar com um dos nossos especialistas. Já vou te encaminhar para o time, tudo bem?',
    campaigns: [],
    notifyCloser: true,
    closerTemplate: DEFAULT_CLOSER_TEMPLATE,
  };
}

export interface CredentialsInfo {
  providers: string[];
  credentials: { id: string; provider: string; isActive: boolean; baseUrl: string | null }[];
}

function companyQuery(companyId?: string | null): string {
  return companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
}

export function getAgent(companyId?: string | null): Promise<AiAgent | null> {
  return authFetch(`/ai/agent${companyQuery(companyId)}`);
}

export function saveAgent(input: AiAgentInput, companyId?: string | null): Promise<AiAgent> {
  return authFetch(`/ai/agent${companyQuery(companyId)}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function listCredentials(): Promise<CredentialsInfo> {
  return authFetch('/ai/credentials');
}

export function setCredential(
  provider: string,
  apiKey: string,
  baseUrl?: string,
): Promise<unknown> {
  return authFetch('/ai/credentials', {
    method: 'PUT',
    body: JSON.stringify({ provider, apiKey, baseUrl: baseUrl || undefined }),
  });
}

export function testAgent(
  userMessage: string,
  companyId?: string | null,
): Promise<{ content: string }> {
  return authFetch(`/ai/test${companyQuery(companyId)}`, {
    method: 'POST',
    body: JSON.stringify({ userMessage }),
  });
}

export function testCloser(
  companyId?: string | null,
): Promise<{ sent: boolean; closerPhone: string; channelConnected: boolean }> {
  return authFetch(`/ai/test-closer${companyQuery(companyId)}`, { method: 'POST' });
}
