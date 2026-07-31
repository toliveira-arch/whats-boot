import { prisma, getTenantContext, runWithTenant, Prisma } from '@whats-boot/database';
import { HttpError } from '../../middlewares/error';
import { logger } from '../../lib/logger';
import { encryptSecret, decryptSecret } from '../../lib/crypto';
import { broadcastToTenant } from '../../realtime/emitter';
import * as messaging from '../evolution/messaging.service';
import { getProvider, supportedProviders, type LlmMessage, type LlmProvider } from './providers';
import {
  detectByKeywords,
  effectiveScript,
  evaluateGate,
  isComplete,
  resolveCampaign,
  DEFAULT_CLOSER_TEMPLATE,
  type QualConfig,
  type QualLlmOutput,
  type LeadVerdict,
} from './qualification';

/** Renderiza um template com {{variaveis}}. */
function renderTemplate(tpl: string, ctx: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => ctx[k] ?? '—');
}

/** Normaliza telefone BR (só dígitos, com DDI 55). */
function normalizeBrPhone(raw: unknown): string | null {
  if (!raw) return null;
  const d = String(raw).replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('55') && d.length >= 12) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

function tenantId(): string {
  const id = getTenantContext()?.tenantId;
  if (!id) throw new HttpError(500, 'Contexto de tenant ausente');
  return id;
}

const HISTORY_LIMIT = 20;

// ---------------------------------------------------------------------------
// Configuração do agente (por tenant)
// ---------------------------------------------------------------------------

export interface AgentConfigInput {
  name?: string;
  provider?: 'OPENAI' | 'GOOGLE';
  model?: string;
  temperature?: number;
  maxTokens?: number;
  mode?: 'OFF' | 'COPILOT' | 'AUTOPILOT';
  systemPrompt?: string;
  forbiddenWords?: string[];
  requiredWords?: string[];
  activeFrom?: string | null;
  activeTo?: string | null;
  maxMessagesPerConversation?: number | null;
  minResponseSeconds?: number;
  maxResponseSeconds?: number;
  isActive?: boolean;
  qualification?: unknown;
}

/**
 * Retorna o agente de uma empresa (cliente). Cada empresa tem a sua própria
 * configuração de IA. `companyId` null/undefined = agente padrão do tenant
 * (usado como fallback quando a empresa ainda não configurou o seu).
 */
export async function getAgent(companyId?: string | null) {
  return prisma.aiAgent.findFirst({
    where: { deletedAt: null, companyId: companyId ?? null },
    orderBy: { createdAt: 'asc' },
  });
}

/** Resolve o agente de uma conversa: o da empresa, senão o padrão do tenant. */
async function resolveAgentForCompany(companyId: string | null) {
  return (await getAgent(companyId)) ?? (await getAgent(null));
}

export async function upsertAgent(companyId: string | null, input: AgentConfigInput) {
  // Garante que a empresa pertence ao tenant (o FK também protege na criação).
  if (companyId) {
    const company = await prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: { id: true },
    });
    if (!company) throw new HttpError(404, 'Empresa não encontrada');
  }
  const existing = await getAgent(companyId);
  const data = {
    name: input.name ?? 'Agente IA',
    provider: input.provider,
    model: input.model,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    mode: input.mode,
    systemPrompt: input.systemPrompt,
    forbiddenWords: input.forbiddenWords,
    requiredWords: input.requiredWords,
    activeFrom: input.activeFrom,
    activeTo: input.activeTo,
    maxMessagesPerConversation: input.maxMessagesPerConversation,
    minResponseSeconds: input.minResponseSeconds,
    maxResponseSeconds: input.maxResponseSeconds,
    isActive: input.isActive,
    ...(input.qualification !== undefined
      ? { qualification: input.qualification as Prisma.InputJsonValue }
      : {}),
  };

  if (existing) {
    return prisma.aiAgent.update({ where: { id: existing.id }, data });
  }
  return prisma.aiAgent.create({
    data: {
      tenantId: tenantId(),
      companyId: companyId ?? null,
      name: data.name,
      provider: input.provider ?? 'OPENAI',
      model: input.model ?? 'gpt-4o-mini',
      temperature: input.temperature ?? 0.7,
      maxTokens: input.maxTokens ?? 1024,
      mode: input.mode ?? 'COPILOT',
      systemPrompt: input.systemPrompt,
      forbiddenWords: input.forbiddenWords ?? [],
      requiredWords: input.requiredWords ?? [],
      activeFrom: input.activeFrom,
      activeTo: input.activeTo,
      maxMessagesPerConversation: input.maxMessagesPerConversation,
      minResponseSeconds: input.minResponseSeconds ?? 0,
      maxResponseSeconds: input.maxResponseSeconds ?? 0,
      isActive: input.isActive ?? true,
      ...(input.qualification !== undefined
        ? { qualification: input.qualification as Prisma.InputJsonValue }
        : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Credenciais dos provedores (por tenant, criptografadas)
// ---------------------------------------------------------------------------

export async function listCredentials() {
  const creds = await prisma.aiCredential.findMany({
    where: { deletedAt: null },
    select: { id: true, provider: true, isActive: true, baseUrl: true, createdAt: true },
  });
  return { providers: supportedProviders(), credentials: creds };
}

export async function setCredential(provider: string, apiKey: string, baseUrl?: string) {
  const existing = await prisma.aiCredential.findFirst({
    where: { provider: provider as never, deletedAt: null },
  });
  const encrypted = encryptSecret(apiKey);
  if (existing) {
    return prisma.aiCredential.update({
      where: { id: existing.id },
      data: { apiKeyEncrypted: encrypted, baseUrl, isActive: true },
      select: { id: true, provider: true, isActive: true },
    });
  }
  return prisma.aiCredential.create({
    data: {
      tenantId: tenantId(),
      provider: provider as never,
      apiKeyEncrypted: encrypted,
      baseUrl,
      isActive: true,
    },
    select: { id: true, provider: true, isActive: true },
  });
}

// ---------------------------------------------------------------------------
// Geração de resposta (guardrails + provedor)
// ---------------------------------------------------------------------------

function withinActiveHours(from: string | null, to: string | null): boolean {
  if (!from || !to) return true;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return hhmm >= from && hhmm <= to;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface GenerateResult {
  skipped?: string;
  mode?: string;
  content?: string;
  verdict?: string;
}

type AgentRecord = NonNullable<Awaited<ReturnType<typeof getAgent>>>;

/** Faz o parse tolerante do JSON devolvido pelo modelo na qualificação. */
function parseQualOutput(raw: string): QualLlmOutput {
  try {
    const cleaned = raw
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/```$/, '')
      .trim();
    const obj = JSON.parse(cleaned) as Partial<QualLlmOutput>;
    return {
      reply: typeof obj.reply === 'string' ? obj.reply : '',
      campaignId: (obj.campaignId as string | null) ?? null,
      collected: (obj.collected as Record<string, unknown>) ?? {},
      interest: obj.interest,
      urgency: obj.urgency,
      summary: obj.summary,
    };
  } catch {
    return { reply: raw.trim(), campaignId: null, collected: {} };
  }
}

export async function generateReply(conversationId: string): Promise<GenerateResult> {
  const tid = tenantId();
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, deletedAt: null },
    include: {
      contact: { select: { name: true, pushName: true, waJid: true, phoneNumber: true } },
      evolutionInstance: { select: { aiEnabled: true } },
    },
  });
  if (!conversation) return { skipped: 'conversation-not-found' };

  // Isolamento de toggles: instância desligada > conversa desligada > agente.
  if (!conversation.evolutionInstance.aiEnabled) return { skipped: 'instance-ai-off' };
  if (conversation.aiEnabled === false) return { skipped: 'conversation-ai-off' };

  // Cada empresa tem o seu agente; usa o padrão do tenant como fallback.
  const agent = await resolveAgentForCompany(conversation.companyId);
  if (!agent || !agent.isActive) return { skipped: 'agent-disabled' };

  // Modo efetivo: a conversa pode sobrescrever o modo global do agente.
  const effectiveMode =
    conversation.aiMode && conversation.aiMode !== 'OFF' ? conversation.aiMode : agent.mode;
  if (effectiveMode === 'OFF') return { skipped: 'mode-off' };
  if (!withinActiveHours(agent.activeFrom, agent.activeTo)) return { skipped: 'outside-hours' };

  if (agent.maxMessagesPerConversation != null) {
    const aiCount = await prisma.message.count({
      where: { conversationId, authorType: 'AI', deletedAt: null },
    });
    if (aiCount >= agent.maxMessagesPerConversation) return { skipped: 'message-limit' };
  }

  const credential = await prisma.aiCredential.findFirst({
    where: { provider: agent.provider, isActive: true, deletedAt: null },
  });
  const provider = getProvider(agent.provider);
  if (!credential || !provider) return { skipped: 'no-credential' };

  const apiKey = decryptSecret(credential.apiKeyEncrypted);
  const baseUrl = credential.baseUrl ?? undefined;

  // Modo SDR: pré-qualificação de leads com roteiro/gate/campanhas.
  const qual = (agent.qualification as unknown as QualConfig | null) ?? null;
  if (qual?.enabled) {
    return runQualification({
      tid,
      conversation,
      agent,
      provider,
      apiKey,
      baseUrl,
      effectiveMode,
      config: qual,
    });
  }

  // Histórico (mais antigas -> mais novas)
  const history = await prisma.message.findMany({
    where: { conversationId, deletedAt: null, content: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_LIMIT,
    select: { direction: true, content: true },
  });

  const messages: LlmMessage[] = [];
  const systemParts = [agent.systemPrompt ?? 'Você é um atendente prestativo e objetivo.'];
  if (agent.requiredWords.length) {
    systemParts.push(`Sempre que fizer sentido, mencione: ${agent.requiredWords.join(', ')}.`);
  }
  if (agent.forbiddenWords.length) {
    systemParts.push(`Nunca use estas palavras: ${agent.forbiddenWords.join(', ')}.`);
  }
  messages.push({ role: 'system', content: systemParts.join(' ') });
  for (const m of history.reverse()) {
    messages.push({
      role: m.direction === 'INBOUND' ? 'user' : 'assistant',
      content: m.content ?? '',
    });
  }

  let content: string;
  try {
    const result = await provider.chat(
      {
        model: agent.model,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
        messages,
      },
      apiKey,
      baseUrl,
    );
    // As palavras proibidas entram como INSTRUÇÃO no prompt (acima), não como
    // censura no texto final — assim a resposta sai natural, sem "***".
    content = result.content.trim();

    await prisma.aiUsageLog.create({
      data: {
        tenantId: tid,
        aiAgentId: agent.id,
        conversationId,
        provider: agent.provider,
        model: agent.model,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        success: true,
      },
    });
  } catch (err) {
    logger.error({ err, conversationId }, 'falha ao gerar resposta de IA');
    await prisma.aiUsageLog.create({
      data: {
        tenantId: tid,
        aiAgentId: agent.id,
        conversationId,
        provider: agent.provider,
        model: agent.model,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return { skipped: 'provider-error' };
  }

  if (!content) return { skipped: 'empty' };

  // Atraso configurável (simula digitação / evita respostas instantâneas)
  const min = Math.max(0, agent.minResponseSeconds);
  const max = Math.max(min, agent.maxResponseSeconds);
  if (max > 0) {
    await sleep((min + Math.floor((max - min) * 0.5)) * 1000);
  }

  if (effectiveMode === 'AUTOPILOT') {
    const number = conversation.contact.waJid ?? conversation.contact.phoneNumber ?? '';
    await messaging.sendText({
      tenantId: tid,
      channelId: conversation.evolutionInstanceId,
      number,
      text: content,
      authorType: 'AI',
    });
    return { mode: 'AUTOPILOT', content };
  }

  // COPILOT: sugere ao atendente (não envia)
  broadcastToTenant(tid, 'ai.suggestion', { conversationId, content });
  return { mode: 'COPILOT', content };
}

// ---------------------------------------------------------------------------
// Pré-qualificação de leads (SDR): roteiro + gate + campanhas + handoff
// ---------------------------------------------------------------------------

async function runQualification(input: {
  tid: string;
  conversation: {
    id: string;
    companyId: string;
    evolutionInstanceId: string;
    contact: {
      name: string | null;
      pushName: string | null;
      waJid: string | null;
      phoneNumber: string | null;
    };
    qualification: unknown;
  };
  agent: AgentRecord;
  provider: LlmProvider;
  apiKey: string;
  baseUrl?: string;
  effectiveMode: string;
  config: QualConfig;
}): Promise<GenerateResult> {
  const { tid, conversation, agent, provider, apiKey, baseUrl, effectiveMode, config } = input;
  const conversationId = conversation.id;

  const prev =
    (conversation.qualification as {
      collected?: Record<string, unknown>;
      campaignId?: string | null;
    } | null) ?? {};
  const prevCollected = prev.collected ?? {};

  const history = await prisma.message.findMany({
    where: { conversationId, deletedAt: null, content: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_LIMIT,
    select: { direction: true, content: true },
  });
  const lastInbound = history.find((m) => m.direction === 'INBOUND')?.content ?? '';

  const prelimCampaign =
    resolveCampaign(config, prev.campaignId ?? null) ?? detectByKeywords(config, lastInbound);
  const scriptForPrompt = effectiveScript(config, prelimCampaign);

  const campaignsDesc = config.campaigns
    .map(
      (c) =>
        `- id="${c.id}" | ${c.name} | gatilhos: ${(c.triggers || []).join(', ')}${c.description ? ' | ' + c.description : ''}`,
    )
    .join('\n');
  const scriptDesc = scriptForPrompt
    .map((f) => `- ${f.key} (${f.label}): "${f.question}"${f.required ? ' [obrigatório]' : ''}`)
    .join('\n');

  // Próximos itens obrigatórios ainda não coletados (para forçar o avanço).
  const hasVal = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== '';
  const missing = scriptForPrompt.filter((f) => f.required && !hasVal(prevCollected[f.key]));
  const nextField = missing[0];

  const sys = [
    agent.systemPrompt ?? 'Você é um SDR de atendimento, humano e cordial.',
    'Sua função é fazer a PRÉ-QUALIFICAÇÃO do lead conduzindo um roteiro, UMA pergunta por vez, de forma natural (nunca um questionário robótico). Não revele que existe um roteiro ou critérios.',
    'REGRAS DE CONDUÇÃO (siga sempre): 1) valide/agradeça brevemente a resposta anterior; 2) na MESMA mensagem, JÁ faça a PRÓXIMA pergunta do roteiro que ainda não foi respondida; 3) NUNCA termine a mensagem sem uma pergunta enquanto houver itens obrigatórios a coletar — não mande mensagens "sem saída" (ex.: só "muito obrigado!"); 4) só pare de perguntar quando TODOS os itens obrigatórios estiverem coletados.',
    config.campaigns.length
      ? `CAMPANHAS possíveis (detecte pela conversa e pelos gatilhos):\n${campaignsDesc}`
      : '',
    `ROTEIRO a coletar (nesta ordem):\n${scriptDesc}`,
    `DADOS JÁ COLETADOS (não pergunte de novo): ${JSON.stringify(prevCollected)}`,
    missing.length
      ? `AINDA FALTA COLETAR: ${missing.map((f) => f.label).join(', ')}. Nesta resposta, depois de validar o que o cliente disse, faça JÁ a próxima pergunta pendente${nextField ? `: "${nextField.question}"` : ''}.`
      : 'Todos os itens obrigatórios já foram coletados — faça o fechamento/encaminhamento, sem novas perguntas.',
    'Responda SEMPRE em JSON válido, sem nada fora do JSON, no formato exato: {"reply":"mensagem curta ao cliente que VALIDA a resposta anterior e JÁ faz a próxima pergunta (só UMA pergunta)","campaignId":"id da campanha ou null","collected":{"...todos os dados conhecidos, incluindo os novos desta resposta; faturamento como número mensal em reais, ex 50000..."},"interest":"Baixo|Médio|Alto","urgency":"Baixa|Média|Alta","summary":"resumo curto do lead"}',
  ]
    .filter(Boolean)
    .join('\n\n');

  const messages: LlmMessage[] = [{ role: 'system', content: sys }];
  for (const m of history.reverse()) {
    messages.push({
      role: m.direction === 'INBOUND' ? 'user' : 'assistant',
      content: m.content ?? '',
    });
  }

  let out: QualLlmOutput;
  try {
    const result = await provider.chat(
      {
        model: agent.model,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
        messages,
        json: true,
      },
      apiKey,
      baseUrl,
    );
    await prisma.aiUsageLog.create({
      data: {
        tenantId: tid,
        aiAgentId: agent.id,
        conversationId,
        provider: agent.provider,
        model: agent.model,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        success: true,
      },
    });
    out = parseQualOutput(result.content);
  } catch (err) {
    logger.error({ err, conversationId }, 'falha na qualificação (provedor)');
    await prisma.aiUsageLog.create({
      data: {
        tenantId: tid,
        aiAgentId: agent.id,
        conversationId,
        provider: agent.provider,
        model: agent.model,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return { skipped: 'provider-error' };
  }

  const mergedCollected = { ...prevCollected, ...(out.collected ?? {}) };
  const campaign = resolveCampaign(config, out.campaignId) ?? prelimCampaign;
  const script = effectiveScript(config, campaign);
  const complete = isComplete(script, mergedCollected);

  let verdict: LeadVerdict = 'IN_PROGRESS';
  let outboundText = out.reply?.trim() || '';
  let reasons: string[] = [];

  if (complete) {
    const gate = evaluateGate(config, campaign, mergedCollected);
    verdict = gate.verdict;
    reasons = gate.reasons;
    outboundText =
      verdict === 'QUALIFIED'
        ? campaign?.handoffMessage || config.defaultHandoffMessage
        : campaign?.disqualifyMessage || config.defaultDisqualifyMessage;
  }

  const qualState = {
    campaignId: campaign?.id ?? null,
    campaignName: campaign?.name ?? null,
    collected: mergedCollected,
    interest: out.interest ?? null,
    urgency: out.urgency ?? null,
    summary: out.summary ?? null,
    reasons,
    updatedAt: new Date().toISOString(),
  };

  const pause =
    verdict !== 'IN_PROGRESS' &&
    config.onQualified === 'pause+assign' &&
    effectiveMode === 'AUTOPILOT';

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      leadVerdict: verdict,
      qualification: qualState as unknown as Prisma.InputJsonValue,
      ...(pause ? { aiEnabled: false, status: 'PENDING' as never } : {}),
    },
  });
  broadcastToTenant(tid, 'lead.updated', { conversationId, verdict, qualification: qualState });

  // Notifica o closer da empresa quando o lead é qualificado (MQL).
  if (verdict === 'QUALIFIED' && config.notifyCloser) {
    await notifyCloser({ tid, conversation, config, collected: mergedCollected, out, qualState });
  }

  if (!outboundText) return { skipped: 'empty', verdict };

  const min = Math.max(0, agent.minResponseSeconds);
  const max = Math.max(min, agent.maxResponseSeconds);
  if (max > 0) await sleep((min + Math.floor((max - min) * 0.5)) * 1000);

  if (effectiveMode === 'AUTOPILOT') {
    const number = conversation.contact.waJid ?? conversation.contact.phoneNumber ?? '';
    await messaging.sendText({
      tenantId: tid,
      channelId: conversation.evolutionInstanceId,
      number,
      text: outboundText,
      authorType: 'AI',
    });
    return { mode: 'AUTOPILOT', content: outboundText, verdict };
  }

  broadcastToTenant(tid, 'ai.suggestion', { conversationId, content: outboundText });
  return { mode: 'COPILOT', content: outboundText, verdict };
}

/** Dispara a notificação do lead qualificado para o closer da empresa. */
async function notifyCloser(input: {
  tid: string;
  conversation: {
    companyId: string;
    evolutionInstanceId: string;
    contact: {
      name: string | null;
      pushName: string | null;
      waJid: string | null;
      phoneNumber: string | null;
    };
  };
  config: QualConfig;
  collected: Record<string, unknown>;
  out: QualLlmOutput;
  qualState: { campaignName: string | null; summary: string | null };
}): Promise<void> {
  const { tid, conversation, config, collected, out, qualState } = input;
  try {
    const company = await prisma.company.findFirst({
      where: { id: conversation.companyId, deletedAt: null },
      select: { name: true, closerName: true, closerPhone: true },
    });
    const closerPhone = normalizeBrPhone(company?.closerPhone);
    if (!closerPhone) return; // empresa sem closer configurado

    const leadPhone = (
      conversation.contact.waJid ??
      conversation.contact.phoneNumber ??
      ''
    ).replace(/\D/g, '');
    const val = (v: unknown) => (v === undefined || v === null || v === '' ? '—' : String(v));
    const template = config.closerTemplate?.trim() || DEFAULT_CLOSER_TEMPLATE;
    const text = renderTemplate(template, {
      nome: val(collected.nome ?? conversation.contact.name ?? conversation.contact.pushName),
      telefone: leadPhone || '—',
      empresa: val(company?.name),
      faturamento: val(collected.faturamento),
      ramo: val(collected.ramo ?? collected.segmento),
      cnpj: val(collected.cnpj),
      decisor: val(collected.decisor),
      dor: val(collected.dor),
      resumo: val(out.summary ?? qualState.summary),
      campanha: val(qualState.campaignName),
      interesse: val(out.interest),
      urgencia: val(out.urgency),
      closer: val(company?.closerName),
    });

    await messaging.sendText({
      tenantId: tid,
      channelId: conversation.evolutionInstanceId,
      number: closerPhone,
      text,
      authorType: 'AI',
    });
    logger.info({ companyId: conversation.companyId }, 'closer notificado sobre lead MQL');
  } catch (err) {
    logger.error({ err }, 'falha ao notificar o closer');
  }
}

/** Processa um job da fila ai.process dentro do contexto de tenant. */
export async function generateReplyJob(job: {
  conversationId: string;
  tenantId: string;
}): Promise<void> {
  await runWithTenant(job.tenantId, async () => {
    const r = await generateReply(job.conversationId);
    // Info (não debug) para aparecer no log da nuvem e facilitar diagnóstico:
    // mostra se respondeu (mode) ou por que pulou (skipped).
    logger.info({ conversationId: job.conversationId, ...r }, 'ai.process concluído');
  });
}

/** Teste rápido de configuração/credencial (botão "testar" na tela de IA). */
export async function testGenerate(input: {
  userMessage: string;
  companyId?: string | null;
}): Promise<{ content: string }> {
  const agent = await resolveAgentForCompany(input.companyId ?? null);
  if (!agent) throw new HttpError(400, 'Configure o agente de IA primeiro');
  const credential = await prisma.aiCredential.findFirst({
    where: { provider: agent.provider, isActive: true, deletedAt: null },
  });
  const provider = getProvider(agent.provider);
  if (!credential || !provider)
    throw new HttpError(400, `Credencial ${agent.provider} não configurada`);

  const result = await provider.chat(
    {
      model: agent.model,
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      messages: [
        { role: 'system', content: agent.systemPrompt ?? 'Você é um atendente prestativo.' },
        { role: 'user', content: input.userMessage },
      ],
    },
    decryptSecret(credential.apiKeyEncrypted),
    credential.baseUrl ?? undefined,
  );
  return { content: result.content.trim() };
}
