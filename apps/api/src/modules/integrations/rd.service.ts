import crypto from 'node:crypto';
import { prisma, runAsSystem, runWithTenant, Prisma } from '@whats-boot/database';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { getTenantContext } from '@whats-boot/database';
import { HttpError } from '../../middlewares/error';
import * as messaging from '../evolution/messaging.service';

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

/** Retorna a integração do tenant, criando uma (desligada) na primeira vez. */
export async function getIntegration() {
  const existing = await prisma.rdIntegration.findFirst({ where: { deletedAt: null } });
  if (existing) return existing;
  return prisma.rdIntegration.create({
    data: { tenantId: tenantId(), webhookToken: newToken() },
  });
}

export interface RdConfigInput {
  enabled?: boolean;
  channelId?: string | null;
  openingMessage?: string;
  handoffToSdr?: boolean;
}

export async function upsertIntegration(input: RdConfigInput) {
  const integ = await getIntegration();
  return prisma.rdIntegration.update({
    where: { id: integ.id },
    data: {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.channelId !== undefined ? { channelId: input.channelId } : {}),
      ...(input.openingMessage !== undefined ? { openingMessage: input.openingMessage } : {}),
      ...(input.handoffToSdr !== undefined ? { handoffToSdr: input.handoffToSdr } : {}),
    },
  });
}

export async function regenerateToken() {
  const integ = await getIntegration();
  return prisma.rdIntegration.update({
    where: { id: integ.id },
    data: { webhookToken: newToken() },
  });
}

export async function listEvents() {
  return prisma.rdLeadEvent.findMany({
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
}

function extractLead(payload: Record<string, unknown>): ExtractedLead {
  const p = payload as Record<string, unknown>;
  const leadsArr = p.leads as Record<string, unknown>[] | undefined;
  const lead = (leadsArr?.[0] ??
    (p.lead as Record<string, unknown>) ??
    (p.contact as Record<string, unknown>) ??
    p) as Record<string, unknown>;

  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = lead[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return null;
  };

  return {
    name: pick('name', 'nome', 'first_name'),
    email: pick('email', 'e-mail'),
    phone: pick('mobile_phone', 'personal_phone', 'phone', 'telefone', 'celular', 'whatsapp'),
  };
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

    // Canal: o configurado, senão a primeira instância disponível.
    const channel =
      (integ.channelId
        ? await prisma.evolutionInstance.findFirst({
            where: { id: integ.channelId, deletedAt: null },
          })
        : null) ??
      (await prisma.evolutionInstance.findFirst({
        where: { deletedAt: null },
        orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      }));

    if (!channel) {
      await logEvent('FAILED', 'nenhum canal WhatsApp disponível');
      return { status: 'failed', detail: 'no-channel' };
    }

    const text = integ.openingMessage.replace(/\{\{\s*nome\s*\}\}/gi, lead.name ?? 'tudo bem');

    try {
      const sent = await messaging.sendText({
        tenantId: integ.tenantId,
        channelId: channel.id,
        number: phone,
        text,
        authorType: 'AI',
      });
      // Se NÃO for pra o SDR assumir, desliga a IA nessa conversa.
      if (!integ.handoffToSdr) {
        await prisma.conversation.update({
          where: { id: sent.conversationId },
          data: { aiEnabled: false },
        });
      }
      await logEvent('SENT', channel.name);
      return { status: 'sent' };
    } catch (err) {
      logger.error({ err, integrationId: integ.id }, 'falha ao disparar mensagem RD Station');
      await logEvent('FAILED', err instanceof Error ? err.message : String(err));
      return { status: 'failed', detail: 'send-error' };
    }
  });
}
