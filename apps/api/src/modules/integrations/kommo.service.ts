import crypto from 'node:crypto';
import { prisma, runAsSystem, runWithTenant, getTenantContext, Prisma } from '@whats-boot/database';
import { env } from '../../config/env';
import { HttpError } from '../../middlewares/error';
import { encryptSecret, decryptSecret } from '../../lib/crypto';
import { dispatchLead, normalizeBrPhone } from './dispatch';
import {
  fetchContact,
  fetchLeadContact,
  fetchPipelineName,
  type KommoLeadInfo,
} from './kommo.client';

function tenantId(): string {
  const id = getTenantContext()?.tenantId;
  if (!id) throw new HttpError(500, 'Contexto de tenant ausente');
  return id;
}

function newToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

export function kommoWebhookUrl(token: string): string {
  return `${env.API_PUBLIC_URL.replace(/\/$/, '')}/api/integrations/kommo/webhook/${token}`;
}

/** Integração do Kommo por empresa (cliente). companyId null = padrão do tenant. */
export async function getIntegration(companyId?: string | null) {
  const cid = companyId ?? null;
  if (cid) {
    const company = await prisma.company.findFirst({
      where: { id: cid, deletedAt: null },
      select: { id: true },
    });
    if (!company) throw new HttpError(404, 'Empresa não encontrada');
  }
  const existing = await prisma.kommoIntegration.findFirst({
    where: { deletedAt: null, companyId: cid },
  });
  if (existing) return existing;
  return prisma.kommoIntegration.create({
    data: { tenantId: tenantId(), companyId: cid, webhookToken: newToken() },
  });
}

export interface KommoConfigInput {
  enabled?: boolean;
  channelId?: string | null;
  openingMessage?: string;
  handoffToSdr?: boolean;
  subdomain?: string | null;
  accessToken?: string | null;
  sourceFilter?: string | null;
}

export async function upsertIntegration(companyId: string | null, input: KommoConfigInput) {
  const integ = await getIntegration(companyId);
  const data: Prisma.KommoIntegrationUpdateInput = {
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.channelId !== undefined ? { channelId: input.channelId } : {}),
    ...(input.openingMessage !== undefined ? { openingMessage: input.openingMessage } : {}),
    ...(input.handoffToSdr !== undefined ? { handoffToSdr: input.handoffToSdr } : {}),
    ...(input.subdomain !== undefined
      ? { subdomain: input.subdomain ? input.subdomain.trim() : null }
      : {}),
    ...(input.sourceFilter !== undefined
      ? { sourceFilter: input.sourceFilter ? input.sourceFilter.trim() : null }
      : {}),
  };
  // Token: string não-vazia → criptografa; string vazia → limpa; undefined → mantém.
  if (input.accessToken !== undefined) {
    data.accessTokenEnc = input.accessToken ? encryptSecret(input.accessToken.trim()) : null;
  }
  return prisma.kommoIntegration.update({ where: { id: integ.id }, data });
}

export async function regenerateToken(companyId: string | null) {
  const integ = await getIntegration(companyId);
  return prisma.kommoIntegration.update({
    where: { id: integ.id },
    data: { webhookToken: newToken() },
  });
}

export async function listEvents(companyId: string | null) {
  const integ = await getIntegration(companyId);
  return prisma.kommoLeadEvent.findMany({
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
// Webhook do Kommo (novo lead) → busca telefone via API → dispara WhatsApp
// ---------------------------------------------------------------------------

type Nested = Record<string, unknown>;

/** Extrai o 1º id de leads[add|status|update] do corpo do webhook. */
function firstId(body: Nested, group: 'leads' | 'contacts'): number | null {
  const g = body[group] as Nested | undefined;
  if (!g) return null;
  const keys = group === 'leads' ? ['add', 'status', 'update'] : ['add', 'update'];
  for (const k of keys) {
    const arr = g[k];
    const first = Array.isArray(arr) ? (arr[0] as Nested | undefined) : undefined;
    const id = first?.id;
    if (id != null) return Number(id);
  }
  return null;
}

function firstName(body: Nested, group: 'leads' | 'contacts'): string | null {
  const g = body[group] as Nested | undefined;
  if (!g) return null;
  for (const k of ['add', 'status', 'update']) {
    const arr = g[k];
    const first = Array.isArray(arr) ? (arr[0] as Nested | undefined) : undefined;
    const name = first?.name;
    if (typeof name === 'string' && name.trim()) return name.trim();
  }
  return null;
}

/** Processa um webhook do Kommo. `token` identifica o tenant/integração. */
export async function handleKommoWebhook(
  token: string,
  payload: Record<string, unknown>,
): Promise<{ status: string; detail?: string }> {
  const integ = await runAsSystem(() =>
    prisma.kommoIntegration.findFirst({ where: { webhookToken: token, deletedAt: null } }),
  );
  if (!integ) return { status: 'not_found' };

  return runWithTenant(integ.tenantId, async () => {
    const leadId = firstId(payload, 'leads');
    const contactId = firstId(payload, 'contacts');
    const fallbackName = firstName(payload, 'leads') ?? firstName(payload, 'contacts');

    const logEvent = (status: string, info: Partial<KommoLeadInfo>, detail?: string) =>
      prisma.kommoLeadEvent.create({
        data: {
          tenantId: integ.tenantId,
          integrationId: integ.id,
          name: info.name ?? fallbackName ?? null,
          phone: info.phone ?? null,
          email: info.email ?? null,
          status,
          detail: detail ?? null,
          payload: payload as unknown as Prisma.InputJsonValue,
        },
      });

    if (!integ.enabled) {
      await logEvent('SKIPPED', {}, 'integração desativada');
      return { status: 'skipped', detail: 'disabled' };
    }
    if (leadId == null && contactId == null) {
      await logEvent('SKIPPED', {}, 'webhook sem lead/contato');
      return { status: 'skipped', detail: 'no-id' };
    }
    if (!integ.subdomain || !integ.accessTokenEnc) {
      await logEvent(
        'FAILED',
        {},
        'preencha o subdomínio e o token do Kommo para buscar o telefone do lead',
      );
      return { status: 'failed', detail: 'no-credentials' };
    }

    // Busca o telefone via API do Kommo (o webhook manda só IDs).
    const accessToken = decryptSecret(integ.accessTokenEnc);
    const info =
      leadId != null
        ? await fetchLeadContact(integ.subdomain, accessToken, leadId)
        : await fetchContact(integ.subdomain, accessToken, contactId as number);

    // Filtro de fonte: só puxa leads cuja fonte/funil case com o texto (ex.: "RD Station").
    if (integ.sourceFilter && integ.sourceFilter.trim()) {
      const needle = integ.sourceFilter.trim().toLowerCase();
      let matched = info.sourceSignals.some((s) => s.toLowerCase().includes(needle));
      if (!matched && info.pipelineId != null) {
        const pname = await fetchPipelineName(integ.subdomain, accessToken, info.pipelineId);
        if (pname && pname.toLowerCase().includes(needle)) matched = true;
      }
      if (!matched) {
        await logEvent('SKIPPED', info, `fonte diferente do filtro "${integ.sourceFilter}"`);
        return { status: 'skipped', detail: 'source-filtered' };
      }
    }

    const phone = normalizeBrPhone(info.phone);
    if (!phone) {
      await logEvent('SKIPPED', info, 'lead sem telefone no Kommo');
      return { status: 'skipped', detail: 'no-phone' };
    }

    const result = await dispatchLead({
      tenantId: integ.tenantId,
      companyId: integ.companyId,
      channelId: integ.channelId,
      name: info.name ?? fallbackName,
      phone,
      openingMessage: integ.openingMessage,
      handoffToSdr: integ.handoffToSdr,
    });

    if (result.status === 'sent') {
      await logEvent('SENT', info, result.detail);
      return { status: 'sent' };
    }
    if (result.status === 'skipped') {
      await logEvent('SKIPPED', info, result.detail ?? 'duplicado');
      return { status: 'skipped', detail: result.detail };
    }
    await logEvent('FAILED', info, result.detail);
    return { status: 'failed', detail: result.detail };
  });
}
