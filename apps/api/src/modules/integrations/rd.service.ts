import crypto from 'node:crypto';
import { prisma, runAsSystem, runWithTenant, Prisma } from '@whats-boot/database';
import { env } from '../../config/env';
import { getTenantContext } from '@whats-boot/database';
import { HttpError } from '../../middlewares/error';
import { dispatchLead } from './dispatch';

function tenantId(): string {
  const id = getTenantContext()?.tenantId;
  if (!id) throw new HttpError(500, 'Contexto de tenant ausente');
  return id;
}

function newToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

export function rdWebhookUrl(token: string): string {
  return `${env.API_PUBLIC_URL.replace(/\/$/, '')}/api/integrations/rdstation/webhook/${token}`;
}

/**
 * Retorna a integração de uma empresa (cliente), criando uma (desligada) na
 * primeira vez. Cada empresa tem o seu próprio token/URL de webhook, para que
 * o RD Station de cada cliente dispare no canal certo. `companyId` null =
 * integração padrão do tenant.
 */
export async function getIntegration(companyId?: string | null) {
  const cid = companyId ?? null;
  if (cid) {
    const company = await prisma.company.findFirst({
      where: { id: cid, deletedAt: null },
      select: { id: true },
    });
    if (!company) throw new HttpError(404, 'Empresa não encontrada');
  }
  const existing = await prisma.rdIntegration.findFirst({
    where: { deletedAt: null, companyId: cid },
  });
  if (existing) return existing;
  return prisma.rdIntegration.create({
    data: { tenantId: tenantId(), companyId: cid, webhookToken: newToken() },
  });
}

export interface RdConfigInput {
  enabled?: boolean;
  channelId?: string | null;
  openingMessage?: string;
  handoffToSdr?: boolean;
  paidMediaOnly?: boolean;
  allowedSources?: string | null;
  campaignMap?: string | null;
  openingsJson?: string | null;
}

export async function upsertIntegration(companyId: string | null, input: RdConfigInput) {
  const integ = await getIntegration(companyId);
  const clean = (v: string | null | undefined) => (v === undefined ? undefined : v ? v : null);
  return prisma.rdIntegration.update({
    where: { id: integ.id },
    data: {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.channelId !== undefined ? { channelId: input.channelId } : {}),
      ...(input.openingMessage !== undefined ? { openingMessage: input.openingMessage } : {}),
      ...(input.handoffToSdr !== undefined ? { handoffToSdr: input.handoffToSdr } : {}),
      ...(input.paidMediaOnly !== undefined ? { paidMediaOnly: input.paidMediaOnly } : {}),
      ...(input.allowedSources !== undefined
        ? { allowedSources: clean(input.allowedSources) }
        : {}),
      ...(input.campaignMap !== undefined ? { campaignMap: clean(input.campaignMap) } : {}),
      ...(input.openingsJson !== undefined ? { openingsJson: clean(input.openingsJson) } : {}),
    },
  });
}

export async function regenerateToken(companyId: string | null) {
  const integ = await getIntegration(companyId);
  return prisma.rdIntegration.update({
    where: { id: integ.id },
    data: { webhookToken: newToken() },
  });
}

export async function listEvents(companyId: string | null) {
  const integ = await getIntegration(companyId);
  return prisma.rdLeadEvent.findMany({
    where: { integrationId: integ.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      status: true,
      detail: true,
      createdAt: true,
    },
  });
}

// ---------------------------------------------------------------------------
// Webhook do RD Station (novo lead) → dispara WhatsApp
// ---------------------------------------------------------------------------

/** Normaliza telefone BR: só dígitos, com DDI 55. */
function normalizeBrPhone(raw: unknown): string | null {
  if (!raw) return null;
  const d = String(raw).replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('55') && d.length >= 12) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

interface ExtractedLead {
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  campaign: string | null;
  form: string | null;
  source: string | null;
  /** Dados já respondidos no formulário do RD (faturamento, regime, cnpj…). */
  collected: Record<string, string>;
}

/** Deixa o valor do formulário legível: "de_r$_50_mil" -> "de r$ 50 mil". */
function readable(v: unknown): string {
  return String(v ?? '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Mapeia os campos do formulário do RD para as chaves canônicas de qualificação
 * (faturamento, regime, cnpj, ramo, decisor, dor). Assim o robô NÃO repergunta.
 */
function extractFormFields(content: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(content)) {
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    const val = readable(v);
    if (!val) continue;
    const key = String(k)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (key.includes('faturamento') && !out.faturamento) out.faturamento = val;
    else if (key.includes('regime') && !out.regime) out.regime = val;
    else if (key.includes('cnpj') && !out.cnpj) out.cnpj = val;
    else if ((key.includes('ramo') || key.includes('segmento')) && !out.ramo) out.ramo = val;
    else if (key.includes('decisor') && !out.decisor) out.decisor = val;
    else if ((key.includes('dor') || key.includes('necessidade')) && !out.dor) out.dor = val;
    else if ((key.includes('funcion') || key.includes('colaborad')) && !out.funcionarios)
      out.funcionarios = val;
  }
  return out;
}

function pickFrom(obj: Record<string, unknown> | undefined, ...keys: string[]): string | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return null;
}

/**
 * Extrai os dados do lead do RD Marketing, INCLUINDO campanha/origem/formulário
 * (last_conversion/first_conversion.conversion_origin) — o que dá o contexto
 * para o atendimento consultivo por campanha.
 */
function extractLead(payload: Record<string, unknown>): ExtractedLead {
  const p = payload;
  const leadsArr = p.leads as Record<string, unknown>[] | undefined;
  const lead = (leadsArr?.[0] ??
    (p.lead as Record<string, unknown>) ??
    (p.contact as Record<string, unknown>) ??
    p) as Record<string, unknown>;

  const lc = (lead.last_conversion as Record<string, unknown> | undefined) ?? {};
  const fc = (lead.first_conversion as Record<string, unknown> | undefined) ?? {};
  const content = {
    ...((fc.content as Record<string, unknown> | undefined) ?? {}),
    ...((lc.content as Record<string, unknown> | undefined) ?? {}),
  };
  const lcOrigin = (lc.conversion_origin as Record<string, unknown> | undefined) ?? {};
  const fcOrigin = (fc.conversion_origin as Record<string, unknown> | undefined) ?? {};

  return {
    name: pickFrom(lead, 'name', 'nome', 'first_name') ?? pickFrom(content, 'nome', 'name'),
    email: pickFrom(lead, 'email', 'e-mail') ?? pickFrom(content, 'email', 'email_lead'),
    phone:
      pickFrom(
        lead,
        'mobile_phone',
        'personal_phone',
        'phone',
        'telefone',
        'celular',
        'whatsapp',
      ) ?? pickFrom(content, 'telefone', 'phone', 'celular', 'whatsapp', 'phone_lead'),
    company: pickFrom(lead, 'company') ?? pickFrom(content, 'empresa'),
    campaign: pickFrom(lcOrigin, 'campaign') ?? pickFrom(fcOrigin, 'campaign'),
    form:
      pickFrom(lc, 'source') ??
      pickFrom(content, 'identificador') ??
      pickFrom(fc, 'source') ??
      pickFrom(fcOrigin, 'source'),
    source: pickFrom(lcOrigin, 'source') ?? pickFrom(fcOrigin, 'source'),
    collected: extractFormFields(content),
  };
}

function semAcento(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

const DEFAULT_PAID_SOURCES = [
  // Meta / Facebook / Instagram
  'facebook ads',
  'facebook lead ads',
  'facebook leads',
  'fb ads',
  'fb',
  'instagram ads',
  'instagram lead ads',
  'ig ads',
  'ig',
  'meta ads',
  'meta lead ads',
  'meta',
  // Google
  'google ads',
  'google adwords',
  'adwords',
  // Genéricos de tráfego pago
  'lead ads',
  'cpc',
  'paid',
  'trafego pago',
];

/** Verifica se a origem é mídia paga (aceita lista custom via csv). */
function isPaidMedia(source: string | null, allowedCsv: string | null): boolean {
  const allowed = (allowedCsv ? allowedCsv.split(',') : DEFAULT_PAID_SOURCES)
    .map((s) => semAcento(s))
    .filter(Boolean);
  const src = semAcento(source ?? '');
  if (!src) return false;
  return allowed.some((a) => src === a || src.includes(a));
}

/** Classifica o tipo da campanha pelo mapa "trecho=tipo" (por linha). '' = genérico. */
function classifyCampaign(campaign: string, form: string, mapText: string | null): string {
  if (!mapText) return '';
  const fonte = semAcento(`${campaign} ${form}`);
  for (const line of mapText.split(/\r?\n/)) {
    const [chave, tipo] = line.split('=').map((x) => x.trim());
    if (chave && tipo && fonte.includes(semAcento(chave))) return semAcento(tipo);
  }
  return '';
}

/** Escolhe uma abertura por tipo (JSON { tipo: [msgs] }), com {{nome}} etc. */
function pickOpening(
  openingsJson: string | null,
  tipo: string,
  nome: string | null,
): string | null {
  if (!openingsJson) return null;
  let pools: Record<string, string[]>;
  try {
    pools = JSON.parse(openingsJson) as Record<string, string[]>;
  } catch {
    return null;
  }
  const pool = pools[tipo] ?? pools['generico'] ?? pools['generic'];
  if (!Array.isArray(pool) || pool.length === 0) return null;
  // Escolha estável sem Math.random dependente: usa o tamanho + nome pra variar.
  const idx = Math.abs((nome ?? '').length + Date.now()) % pool.length;
  const raw = pool[idx] ?? pool[0]!;
  const primeiro = (nome ?? '').split(' ')[0] ?? '';
  return raw.replace(/\{\{\s*nome\s*\}\}/gi, primeiro || 'tudo bem');
}

/** Processa um webhook do RD Station. `token` identifica o tenant/integração. */
export async function handleRdWebhook(
  token: string,
  payload: Record<string, unknown>,
): Promise<{ status: string; detail?: string }> {
  const integ = await runAsSystem(() =>
    prisma.rdIntegration.findFirst({ where: { webhookToken: token, deletedAt: null } }),
  );
  if (!integ) return { status: 'not_found' };

  return runWithTenant(integ.tenantId, async () => {
    const lead = extractLead(payload);
    const phone = normalizeBrPhone(lead.phone);

    const logEvent = (status: string, detail?: string) =>
      prisma.rdLeadEvent.create({
        data: {
          tenantId: integ.tenantId,
          integrationId: integ.id,
          name: lead.name,
          phone: phone ?? lead.phone,
          email: lead.email,
          status,
          detail: detail ?? null,
          payload: payload as unknown as Prisma.InputJsonValue,
        },
      });

    if (!integ.enabled) {
      await logEvent('SKIPPED', 'integração desativada');
      return { status: 'skipped', detail: 'disabled' };
    }
    if (!phone) {
      await logEvent('SKIPPED', 'lead sem telefone');
      return { status: 'skipped', detail: 'no-phone' };
    }

    // FILTRO DE MÍDIA PAGA: descarta o que não vem de anúncio.
    if (integ.paidMediaOnly && !isPaidMedia(lead.source, integ.allowedSources)) {
      await logEvent('SKIPPED', `fora da mídia paga (origem: ${lead.source || 'vazia'})`);
      return { status: 'skipped', detail: 'not-paid-media' };
    }

    // Classifica a campanha (mapa) e escolhe a abertura consultiva por tipo.
    const tipo = classifyCampaign(lead.campaign ?? '', lead.form ?? '', integ.campaignMap);
    const opening = pickOpening(integ.openingsJson, tipo, lead.name) ?? integ.openingMessage;

    // Núcleo compartilhado (escolhe canal, dispara, marca origin=CRM, entra no
    // CRM ao vivo) + trava anti-duplicidade da 1ª mensagem.
    const result = await dispatchLead({
      tenantId: integ.tenantId,
      companyId: integ.companyId,
      channelId: integ.channelId,
      name: lead.name,
      phone,
      openingMessage: opening,
      handoffToSdr: integ.handoffToSdr,
      company: lead.company,
      campaign: lead.campaign,
      form: lead.form,
      source: lead.source,
      campaignType: tipo || null,
      collected: Object.keys(lead.collected).length ? lead.collected : null,
    });
    if (result.status === 'sent') {
      await logEvent('SENT', result.detail);
      return { status: 'sent' };
    }
    if (result.status === 'skipped') {
      await logEvent('SKIPPED', result.detail ?? 'duplicado');
      return { status: 'skipped', detail: result.detail };
    }
    await logEvent('FAILED', result.detail);
    return { status: 'failed', detail: result.detail };
  });
}
