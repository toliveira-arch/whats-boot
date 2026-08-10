import crypto from 'node:crypto';
import { prisma, runAsSystem, runWithTenant, getTenantContext, Prisma } from '@whats-boot/database';
import { env } from '../../config/env';
import { HttpError } from '../../middlewares/error';
import { dispatchLead, extractLeadFromPayload, normalizeBrPhone } from './dispatch';

function tenantId(): string {
  const id = getTenantContext()?.tenantId;
  if (!id) throw new HttpError(500, 'Contexto de tenant ausente');
  return id;
}

function newToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

export function genericWebhookUrl(token: string): string {
  return `${env.API_PUBLIC_URL.replace(/\/$/, '')}/api/integrations/webhook/${token}`;
}

/** Integração genérica por webhook (Foresee e outros CRMs), por empresa. */
export async function getIntegration(companyId?: string | null) {
  const cid = companyId ?? null;
  if (cid) {
    const company = await prisma.company.findFirst({
      where: { id: cid, deletedAt: null },
      select: { id: true },
    });
    if (!company) throw new HttpError(404, 'Empresa não encontrada');
  }
  const existing = await prisma.webhookIntegration.findFirst({
    where: { deletedAt: null, companyId: cid },
  });
  if (existing) return existing;
  return prisma.webhookIntegration.create({
    data: { tenantId: tenantId(), companyId: cid, webhookToken: newToken(), label: 'Foresee' },
  });
}

export interface WebhookConfigInput {
  enabled?: boolean;
  channelId?: string | null;
  openingMessage?: string;
  handoffToSdr?: boolean;
  sourceFilter?: string | null;
  label?: string;
}

export async function upsertIntegration(companyId: string | null, input: WebhookConfigInput) {
  const integ = await getIntegration(companyId);
  return prisma.webhookIntegration.update({
    where: { id: integ.id },
    data: {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.channelId !== undefined ? { channelId: input.channelId } : {}),
      ...(input.openingMessage !== undefined ? { openingMessage: input.openingMessage } : {}),
      ...(input.handoffToSdr !== undefined ? { handoffToSdr: input.handoffToSdr } : {}),
      ...(input.label !== undefined ? { label: input.label.trim() || 'Webhook' } : {}),
      ...(input.sourceFilter !== undefined
        ? { sourceFilter: input.sourceFilter ? input.sourceFilter.trim() : null }
        : {}),
    },
  });
}

export async function regenerateToken(companyId: string | null) {
  const integ = await getIntegration(companyId);
  return prisma.webhookIntegration.update({
    where: { id: integ.id },
    data: { webhookToken: newToken() },
  });
}

export async function listEvents(companyId: string | null) {
  const integ = await getIntegration(companyId);
  return prisma.webhookLeadEvent.findMany({
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

/** Processa um webhook genérico (Foresee/outros). `token` identifica a integração. */
export async function handleGenericWebhook(
  token: string,
  payload: Record<string, unknown>,
): Promise<{ status: string; detail?: string }> {
  const integ = await runAsSystem(() =>
    prisma.webhookIntegration.findFirst({ where: { webhookToken: token, deletedAt: null } }),
  );
  if (!integ) return { status: 'not_found' };

  return runWithTenant(integ.tenantId, async () => {
    const lead = extractLeadFromPayload(payload);
    const phone = normalizeBrPhone(lead.phone);

    const logEvent = (status: string, detail?: string) =>
      prisma.webhookLeadEvent.create({
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
    // Filtro de fonte: só segue se o payload contiver o texto configurado.
    if (integ.sourceFilter && integ.sourceFilter.trim()) {
      const needle = integ.sourceFilter.trim().toLowerCase();
      const haystack = JSON.stringify(payload).toLowerCase();
      if (!haystack.includes(needle)) {
        await logEvent('SKIPPED', `fonte diferente do filtro "${integ.sourceFilter}"`);
        return { status: 'skipped', detail: 'source-filtered' };
      }
    }
    if (!phone) {
      await logEvent('SKIPPED', 'lead sem telefone no payload');
      return { status: 'skipped', detail: 'no-phone' };
    }

    const result = await dispatchLead({
      tenantId: integ.tenantId,
      companyId: integ.companyId,
      channelId: integ.channelId,
      name: lead.name,
      phone,
      openingMessage: integ.openingMessage,
      handoffToSdr: integ.handoffToSdr,
    });

    if (result.status === 'sent') {
      await logEvent('SENT', result.detail);
      return { status: 'sent' };
    }
    await logEvent('FAILED', result.detail);
    return { status: 'failed', detail: result.detail };
  });
}
