import { prisma, getTenantContext, runWithTenant, Prisma } from '@whats-boot/database';
import { HttpError } from '../../middlewares/error';
import { logger } from '../../lib/logger';
import { encryptSecret, decryptSecret } from '../../lib/crypto';
import { broadcastToTenant } from '../../realtime/emitter';
import * as messaging from '../evolution/messaging.service';
import { recordEvent } from '../events/events.service';
import { buildKnowledgePrompt } from '../knowledge/knowledge.service';
import { getProvider, supportedProviders, type LlmMessage, type LlmProvider } from './providers';
import {
  canonicalizeCollected,
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

  // Base de conhecimento / FAQ da empresa (para responder dúvidas).
  const knowledge = await buildKnowledgePrompt(conversation.companyId);

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
      knowledge,
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
  if (knowledge) systemParts.push(knowledge);
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
    leadVerdict: string | null;
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
  knowledge?: string;
}): Promise<GenerateResult> {
  const { tid, conversation, agent, provider, apiKey, baseUrl, effectiveMode, config, knowledge } =
    input;
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
  const prevCanonForPrompt = canonicalizeCollected(prevCollected, scriptForPrompt);
  const missing = scriptForPrompt.filter((f) => f.required && !hasVal(prevCanonForPrompt[f.key]));
  const nextField = missing[0];

  const sys = [
    agent.systemPrompt ?? 'Você é um SDR de atendimento, humano e cordial.',
    'Sua função é fazer a PRÉ-QUALIFICAÇÃO do lead conduzindo um roteiro, UMA pergunta por vez, de forma natural (nunca um questionário robótico). Não revele que existe um roteiro ou critérios.',
    'REGRAS DE CONDUÇÃO (siga sempre): 1) valide/agradeça brevemente a resposta anterior; 2) na MESMA mensagem, JÁ faça a PRÓXIMA pergunta do roteiro que ainda não foi respondida; 3) NUNCA termine a mensagem sem uma pergunta enquanto houver itens obrigatórios a coletar — não mande mensagens "sem saída" (ex.: só "muito obrigado!"); 4) só pare de perguntar quando TODOS os itens obrigatórios estiverem coletados.',
    knowledge || '',
    config.campaigns.length
      ? `CAMPANHAS possíveis (detecte pela conversa e pelos gatilhos):\n${campaignsDesc}`
      : '',
    `ROTEIRO a coletar (nesta ordem):\n${scriptDesc}`,
    `No campo "collected", use EXATAMENTE estas chaves (minúsculas, sem acento): ${scriptForPrompt.map((f) => f.key).join(', ')}. O campo "faturamento" (se houver) DEVE ser um número inteiro em reais por mês (ex.: 30000) — nunca texto, nunca "mil"/"k".`,
    `DADOS JÁ COLETADOS (não pergunte de novo): ${JSON.stringify(prevCanonForPrompt)}`,
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

  const campaign = resolveCampaign(config, out.campaignId) ?? prelimCampaign;
  const script = effectiveScript(config, campaign);
  // Casa as chaves da IA com as do roteiro (tolerante a maiúsculas/acentos/apelidos).
  const prevCanon = canonicalizeCollected(prevCollected, script);
  const mergedCollected = canonicalizeCollected(
    { ...prevCollected, ...(out.collected ?? {}) },
    script,
  );
  const complete = isComplete(script, mergedCollected);

  // Detecta avanço no roteiro: número de campos preenchidos aumentou.
  const filledBefore = script.filter((f) => hasVal(prevCanon[f.key])).length;
  const filledAfter = script.filter((f) => hasVal(mergedCollected[f.key])).length;

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

  // Diagnóstico do gate (aparece no log da nuvem): por que qualificou/não.
  logger.info(
    {
      conversationId,
      complete,
      verdict,
      reasons,
      floor: campaign?.revenueFloor ?? config.defaultRevenueFloor ?? null,
      faturamento: mergedCollected.faturamento ?? null,
      campaign: campaign?.name ?? null,
    },
    'qualificação: decisão do gate',
  );

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

  // Log de eventos (linha do tempo real): transições do lead.
  const prevVerdict = conversation.leadVerdict ?? 'IN_PROGRESS';
  if (verdict === 'QUALIFIED' && prevVerdict !== 'QUALIFIED') {
    await recordEvent({
      tenantId: tid,
      conversationId,
      type: 'LEAD_QUALIFIED',
      data: { campaignName: campaign?.name ?? null, summary: out.summary ?? null },
    });
  } else if (verdict === 'DISQUALIFIED' && prevVerdict !== 'DISQUALIFIED') {
    await recordEvent({
      tenantId: tid,
      conversationId,
      type: 'LEAD_DISQUALIFIED',
      data: { reason: reasons[0] ?? null, reasons },
    });
  } else if (verdict === 'IN_PROGRESS' && filledAfter > filledBefore) {
    await recordEvent({
      tenantId: tid,
      conversationId,
      type: 'LEAD_ADVANCED',
      data: { filled: filledAfter, total: script.length },
    });
  }
  if (pause) {
    await recordEvent({ tenantId: tid, conversationId, type: 'HANDOFF' });
  }

  // Notifica o closer da empresa quando o lead é qualificado (MQL).
  // Padrão LIGADO: só não notifica se o toggle foi explicitamente desligado.
  if (verdict === 'QUALIFIED' && config.notifyCloser !== false) {
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
    id: string;
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
    if (!closerPhone) {
      // Causa mais comum: a empresa DESTA conversa (do canal) não tem o
      // telefone do closer preenchido no menu Empresas.
      logger.warn(
        {
          companyId: conversation.companyId,
          company: company?.name,
          rawCloser: company?.closerPhone,
        },
        'closer não notificado: empresa sem telefone de closer válido',
      );
      return;
    }

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
    logger.info(
      { companyId: conversation.companyId, closerPhone },
      'closer notificado sobre lead MQL',
    );
    await recordEvent({
      tenantId: tid,
      conversationId: conversation.id,
      type: 'CLOSER_NOTIFIED',
      data: { closer: company?.closerName ?? null },
    });
  } catch (err) {
    logger.error({ err, companyId: conversation.companyId }, 'falha ao notificar o closer');
  }
}

/**
 * Dispara um teste da notificação do closer (dados de exemplo), para validar o
 * telefone/template sem precisar concluir uma qualificação inteira.
 */
export async function testCloser(companyId: string | null): Promise<{
  sent: boolean;
  closerPhone: string;
  channelConnected: boolean;
}> {
  const tid = tenantId();
  if (!companyId) throw new HttpError(400, 'Selecione uma empresa');
  const company = await prisma.company.findFirst({
    where: { id: companyId, deletedAt: null },
    select: { name: true, closerName: true, closerPhone: true },
  });
  if (!company) throw new HttpError(404, 'Empresa não encontrada');
  const closerPhone = normalizeBrPhone(company.closerPhone);
  if (!closerPhone)
    throw new HttpError(400, 'Esta empresa não tem WhatsApp de closer preenchido (menu Empresas).');

  const channel = await prisma.evolutionInstance.findFirst({
    where: { companyId, deletedAt: null },
    orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, status: true },
  });
  if (!channel)
    throw new HttpError(400, 'Esta empresa não tem canal (instância) para enviar a mensagem.');

  const agent = await resolveAgentForCompany(companyId);
  const qual = (agent?.qualification as unknown as QualConfig | null) ?? null;
  const template = qual?.closerTemplate?.trim() || DEFAULT_CLOSER_TEMPLATE;
  const text = renderTemplate(template, {
    nome: 'Lead de Teste',
    telefone: '5511999999999',
    empresa: company.name,
    faturamento: '50000',
    ramo: 'Teste',
    cnpj: '—',
    decisor: 'Sim',
    dor: 'Teste de disparo do closer',
    resumo: 'Esta é uma mensagem de TESTE do disparo para o closer.',
    campanha: '—',
    interesse: 'Alto',
    urgencia: 'Alta',
    closer: company.closerName ?? '—',
  });

  await messaging.sendText({
    tenantId: tid,
    channelId: channel.id,
    number: closerPhone,
    text,
    authorType: 'AI',
  });
  return { sent: true, closerPhone, channelConnected: channel.status === 'CONNECTED' };
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

  const knowledge = await buildKnowledgePrompt(input.companyId ?? null);
  const system = [agent.systemPrompt ?? 'Você é um atendente prestativo.', knowledge]
    .filter(Boolean)
    .join('\n\n');

  const result = await provider.chat(
    {
      model: agent.model,
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: input.userMessage },
      ],
    },
    decryptSecret(credential.apiKeyEncrypted),
    credential.baseUrl ?? undefined,
  );
  return { content: result.content.trim() };
}
