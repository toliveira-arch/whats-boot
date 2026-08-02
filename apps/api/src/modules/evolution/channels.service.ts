import crypto from 'node:crypto';
import { prisma, runAsSystem, runWithTenant, getTenantContext, Prisma } from '@whats-boot/database';
import { env } from '../../config/env';
import { HttpError } from '../../middlewares/error';
import { logger } from '../../lib/logger';
import { encryptSecret, decryptSecret } from '../../lib/crypto';
import { broadcastToTenant } from '../../realtime/emitter';
import { createEvolutionClient, WEBHOOK_EVENTS } from './evolution.client';
import { mapConnectionState } from './evolution.types';
import * as messaging from './messaging.service';

interface CreateChannelInput {
  companyId: string;
  name: string;
  instanceName: string;
  baseUrl: string;
  apiKey: string;
  phoneNumber?: string;
}

// ---------------------------------------------------------------------------
// Configuração de alertas (WhatsApp para avisar quando um canal desconectar)
// ---------------------------------------------------------------------------

const ALERTS_NS = 'alerts';
const ALERTS_KEY = 'whatsapp';

export async function getAlertPhone(): Promise<{ phone: string }> {
  const s = await prisma.setting.findFirst({ where: { namespace: ALERTS_NS, key: ALERTS_KEY } });
  return { phone: String((s?.value as { phone?: string } | null)?.phone ?? '') };
}

export async function setAlertPhone(phone: string): Promise<{ phone: string }> {
  const tenantId = getTenantContext()?.tenantId;
  if (!tenantId) throw new HttpError(500, 'Contexto de tenant ausente');
  const clean = phone.trim();
  const existing = await prisma.setting.findFirst({
    where: { namespace: ALERTS_NS, key: ALERTS_KEY },
  });
  const value = { phone: clean } as unknown as Prisma.InputJsonValue;
  if (existing) {
    await prisma.setting.update({ where: { id: existing.id }, data: { value } });
  } else {
    await prisma.setting.create({
      data: { tenantId, namespace: ALERTS_NS, key: ALERTS_KEY, value },
    });
  }
  return { phone: clean };
}

export type AlertFailReason = 'no_phone' | 'no_connected_instance' | 'send_failed';

export interface AlertResult {
  ok: boolean;
  reason?: AlertFailReason;
  via?: string | null;
  phone?: string;
}

/**
 * Envia o alerta de desconexão por WhatsApp usando uma instância AINDA conectada.
 * Como o próprio canal caiu, precisamos de outra instância para conseguir enviar.
 * `excludeChannelId` evita tentar enviar pela instância que acabou de cair.
 * Retorna o motivo estruturado para que a UI possa explicar por que não enviou.
 */
export async function sendDisconnectAlert(opts: {
  tenantId: string;
  channelName: string;
  excludeChannelId?: string;
  test?: boolean;
}): Promise<AlertResult> {
  const { phone } = await getAlertPhone();
  const clean = phone.replace(/\D/g, '');
  if (!clean) return { ok: false, reason: 'no_phone' };

  const sender = await prisma.evolutionInstance.findFirst({
    where: {
      deletedAt: null,
      status: 'CONNECTED',
      ...(opts.excludeChannelId ? { id: { not: opts.excludeChannelId } } : {}),
    },
    select: { id: true, name: true },
  });
  if (!sender) return { ok: false, reason: 'no_connected_instance', phone: clean };

  const text = opts.test
    ? `✅ *Teste de alerta ZAPmoon*\n\nSe você recebeu esta mensagem, os alertas de desconexão estão funcionando. Avisaremos por aqui caso algum canal caia do WhatsApp.`
    : `⚠️ *Alerta ZAPmoon*\n\nO canal *${opts.channelName}* desconectou do WhatsApp.\nReconecte em Canais para não interromper os atendimentos.`;

  try {
    await messaging.sendText({
      tenantId: opts.tenantId,
      channelId: sender.id,
      number: clean,
      text,
      authorType: 'AI',
    });
    return { ok: true, via: sender.name, phone: clean };
  } catch (err) {
    logger.warn({ err }, 'falha ao enviar alerta de desconexão');
    return { ok: false, reason: 'send_failed', phone: clean };
  }
}

/** Dispara um alerta de teste para o número configurado e explica o resultado. */
export async function testDisconnectAlert(): Promise<{ ok: boolean; message: string }> {
  const tenantId = getTenantContext()?.tenantId;
  if (!tenantId) throw new HttpError(500, 'Contexto de tenant ausente');
  const res = await sendDisconnectAlert({ tenantId, channelName: 'Canal de teste', test: true });
  if (res.ok) {
    return { ok: true, message: `Alerta de teste enviado para ${res.phone} via "${res.via}" ✅` };
  }
  const reasons: Record<AlertFailReason, string> = {
    no_phone: 'Informe e salve um número de WhatsApp antes de testar.',
    no_connected_instance:
      'Nenhuma instância conectada para enviar o aviso. O alerta por WhatsApp só sai se houver ao menos um canal conectado além do que caiu — mantenha 2 canais ativos para garantir o aviso.',
    send_failed: 'Falha ao enviar a mensagem de teste. Verifique a instância conectada.',
  };
  return { ok: false, message: reasons[res.reason ?? 'send_failed'] };
}

function publicSelect() {
  return {
    id: true,
    companyId: true,
    name: true,
    instanceName: true,
    baseUrl: true,
    phoneNumber: true,
    profileName: true,
    status: true,
    aiEnabled: true,
    createdAt: true,
    connectedAt: true,
  } as const;
}

function clientFor(channel: { baseUrl: string; apiKeyEncrypted: string }) {
  return createEvolutionClient(channel.baseUrl, decryptSecret(channel.apiKeyEncrypted));
}

function webhookUrl(channelId: string, token: string, publicUrl?: string): string {
  // Token no PATH (a Evolution nem sempre preserva query string nos webhooks).
  const base = (publicUrl || env.API_PUBLIC_URL).replace(/\/$/, '');
  return `${base}/api/webhooks/evolution/${channelId}/${token}`;
}

/**
 * Aplica uma URL pública (ex.: túnel atual) ao webhook da instância, na hora,
 * sem precisar editar o .env nem reiniciar. Resolve o caso do túnel que muda de
 * URL: o usuário cola a URL atual no painel e clica em aplicar.
 */
export async function setWebhookPublicUrl(channelId: string, publicUrl: string) {
  const channel = await loadChannel(channelId);
  const url = webhookUrl(channel.id, channel.webhookToken, publicUrl);
  await clientFor(channel).setWebhook(channel.instanceName, {
    enabled: true,
    url,
    webhookByEvents: false,
    webhookBase64: true,
    events: WEBHOOK_EVENTS,
  });
  await prisma.evolutionInstance.update({
    where: { id: channel.id },
    data: { webhookUrl: url },
  });
  return { webhookUrl: url };
}

/**
 * (Re)configura o webhook da instância na Evolution com a API_PUBLIC_URL atual.
 * Chamado ao gerar QR e ao reconectar, para que mudar a URL pública (ex.: novo
 * túnel) passe a valer sem precisar recadastrar a instância.
 */
async function syncWebhook(channel: {
  id: string;
  instanceName: string;
  baseUrl: string;
  apiKeyEncrypted: string;
  webhookToken: string;
}) {
  try {
    await clientFor(channel).setWebhook(channel.instanceName, {
      enabled: true,
      url: webhookUrl(channel.id, channel.webhookToken),
      webhookByEvents: false,
      webhookBase64: true,
      events: WEBHOOK_EVENTS,
    });
    await prisma.evolutionInstance.update({
      where: { id: channel.id },
      data: { webhookUrl: webhookUrl(channel.id, channel.webhookToken) },
    });
  } catch (err) {
    logger.warn({ err, channelId: channel.id }, 'falha ao re-sincronizar webhook (ignorado)');
  }
}

export async function listChannels() {
  return prisma.evolutionInstance.findMany({
    where: { deletedAt: null },
    select: publicSelect(),
    orderBy: { createdAt: 'desc' },
  });
}

/** Testa a conexão com um servidor Evolution (URL + apikey). */
export async function testConnection(baseUrl: string, apiKey: string): Promise<{ ok: boolean }> {
  try {
    await createEvolutionClient(baseUrl, apiKey).fetchInstances();
    return { ok: true };
  } catch (err) {
    throw new HttpError(400, 'Não foi possível conectar à Evolution API', {
      cause: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Cadastra o canal: valida a empresa, testa a conexão, cria a instância na
 * Evolution, configura o webhook e retorna o QR Code inicial.
 */
export async function createChannel(input: CreateChannelInput) {
  const company = await prisma.company.findFirst({
    where: { id: input.companyId, deletedAt: null },
    select: { id: true, tenantId: true },
  });
  if (!company) {
    throw new HttpError(404, 'Empresa não encontrada');
  }

  // Nome único por tenant: bloqueia duplicado ativo e libera nome de instância
  // já excluída (soft delete) para permitir reaproveitar o mesmo instanceName.
  const clash = await prisma.evolutionInstance.findFirst({
    where: { instanceName: input.instanceName },
  });
  if (clash) {
    if (!clash.deletedAt) {
      throw new HttpError(
        409,
        'Já existe uma instância com esse nome. Escolha outro nome ou exclua a instância existente.',
      );
    }
    await prisma.evolutionInstance.update({
      where: { id: clash.id },
      data: { instanceName: `${clash.instanceName}__del_${Date.now()}` },
    });
  }

  await testConnection(input.baseUrl, input.apiKey);

  const webhookToken = crypto.randomBytes(24).toString('hex');

  const channel = await prisma.evolutionInstance.create({
    data: {
      tenantId: company.tenantId,
      companyId: input.companyId,
      name: input.name,
      instanceName: input.instanceName,
      baseUrl: input.baseUrl,
      apiKeyEncrypted: encryptSecret(input.apiKey),
      phoneNumber: input.phoneNumber,
      webhookToken,
      status: 'CREATED',
    },
    select: { ...publicSelect(), webhookToken: true },
  });

  const client = createEvolutionClient(input.baseUrl, input.apiKey);

  try {
    const created = (await client.createInstance({
      instanceName: input.instanceName,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      ...(input.phoneNumber ? { number: input.phoneNumber } : {}),
    })) as { qrcode?: { base64?: string; pairingCode?: string } };

    await client.setWebhook(input.instanceName, {
      enabled: true,
      url: webhookUrl(channel.id, webhookToken),
      webhookByEvents: false,
      webhookBase64: true,
      events: WEBHOOK_EVENTS,
    });

    const qrBase64 = created.qrcode?.base64 ?? null;
    const updated = await prisma.evolutionInstance.update({
      where: { id: channel.id },
      data: { status: 'QRCODE', qrCode: qrBase64 },
      select: publicSelect(),
    });

    return { channel: updated, qrcode: qrBase64, pairingCode: created.qrcode?.pairingCode ?? null };
  } catch (err) {
    await prisma.evolutionInstance.update({
      where: { id: channel.id },
      data: { status: 'FAILED' },
    });
    logger.error({ err, channelId: channel.id }, 'falha ao provisionar instância Evolution');
    throw new HttpError(502, 'Falha ao criar a instância na Evolution API', {
      cause: err instanceof Error ? err.message : String(err),
    });
  }
}

async function loadChannel(channelId: string) {
  const channel = await prisma.evolutionInstance.findFirst({
    where: { id: channelId, deletedAt: null },
  });
  if (!channel) {
    throw new HttpError(404, 'Canal não encontrado');
  }
  return channel;
}

/** (Re)gera o QR Code conectando a instância. */
export async function getQrCode(channelId: string) {
  const channel = await loadChannel(channelId);
  await syncWebhook(channel); // garante o webhook com a URL pública atual
  const res = await clientFor(channel).connect(channel.instanceName);
  const base64 = res.base64 ?? null;
  await prisma.evolutionInstance.update({
    where: { id: channel.id },
    data: { status: 'QRCODE', qrCode: base64 },
  });
  return { qrcode: base64, pairingCode: res.pairingCode ?? null };
}

/** Consulta o estado da conexão e sincroniza no banco. */
export async function getState(channelId: string) {
  const channel = await loadChannel(channelId);
  const res = await clientFor(channel).connectionState(channel.instanceName);
  const status = mapConnectionState(res.instance?.state);
  await prisma.evolutionInstance.update({
    where: { id: channel.id },
    data: {
      status,
      ...(status === 'CONNECTED' ? { connectedAt: new Date() } : {}),
      ...(status === 'DISCONNECTED' ? { disconnectedAt: new Date() } : {}),
    },
  });
  broadcastToTenant(channel.tenantId, 'channel.status', { channelId: channel.id, status });
  return { status, raw: res.instance?.state ?? null };
}

/**
 * Diagnóstico do espelhamento: mostra a URL que a Evolution tem configurada, a
 * URL esperada (API_PUBLIC_URL atual) e os últimos eventos de webhook recebidos.
 */
export async function diagnostics(channelId: string) {
  const channel = await loadChannel(channelId);
  const expectedWebhookUrl = webhookUrl(channel.id, channel.webhookToken);

  let evolutionWebhook: unknown = null;
  let evolutionError: string | null = null;
  try {
    evolutionWebhook = await clientFor(channel).findWebhook(channel.instanceName);
  } catch (err) {
    evolutionError = err instanceof Error ? err.message : String(err);
  }

  const recentEvents = await prisma.webhookEvent.findMany({
    where: { evolutionInstanceId: channel.id },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { event: true, status: true, externalId: true, createdAt: true },
  });

  return {
    instanceName: channel.instanceName,
    status: channel.status,
    apiPublicUrl: env.API_PUBLIC_URL,
    expectedWebhookUrl,
    storedWebhookUrl: channel.webhookUrl,
    evolutionWebhook,
    evolutionError,
    webhookEventsReceived: recentEvents.length,
    recentEvents,
  };
}

/** Liga/desliga o robô de IA para uma instância inteira. */
export async function setChannelAiEnabled(channelId: string, enabled: boolean) {
  const channel = await loadChannel(channelId);
  await prisma.evolutionInstance.update({
    where: { id: channel.id },
    data: { aiEnabled: enabled },
  });
  broadcastToTenant(channel.tenantId, 'channel.ai', { channelId: channel.id, aiEnabled: enabled });
  return { id: channel.id, aiEnabled: enabled };
}

/** Reconecta (restart) a instância. */
export async function reconnect(channelId: string) {
  const channel = await loadChannel(channelId);
  await syncWebhook(channel); // re-sincroniza o webhook com a URL pública atual
  await clientFor(channel).restart(channel.instanceName);
  await prisma.evolutionInstance.update({
    where: { id: channel.id },
    data: { status: 'CONNECTING' },
  });
  return { ok: true };
}

/** Desconecta (logout) a instância. */
export async function logoutChannel(channelId: string) {
  const channel = await loadChannel(channelId);
  await clientFor(channel).logout(channel.instanceName);
  await prisma.evolutionInstance.update({
    where: { id: channel.id },
    data: { status: 'DISCONNECTED', disconnectedAt: new Date() },
  });
  broadcastToTenant(channel.tenantId, 'channel.status', {
    channelId: channel.id,
    status: 'DISCONNECTED',
  });
  return { ok: true };
}

/** Remove o canal (soft delete) e a instância na Evolution (best-effort). */
export async function deleteChannel(channelId: string) {
  const channel = await loadChannel(channelId);
  try {
    await clientFor(channel).deleteInstance(channel.instanceName);
  } catch (err) {
    logger.warn({ err, channelId }, 'falha ao remover instância na Evolution (ignorado)');
  }
  // Libera o instanceName (renomeia) para que o nome possa ser reutilizado.
  await prisma.evolutionInstance.update({
    where: { id: channel.id },
    data: {
      deletedAt: new Date(),
      status: 'DISCONNECTED',
      instanceName: `${channel.instanceName}__del_${Date.now()}`,
    },
  });
  return { ok: true };
}

/**
 * Re-sincroniza o webhook de TODAS as instâncias ativas com a API_PUBLIC_URL
 * atual. Roda na inicialização da API: assim, ao trocar a URL pública (novo
 * túnel), o webhook é reconfigurado sozinho — sem precisar clicar "Reconectar".
 */
export async function resyncAllWebhooks(): Promise<void> {
  const instances = await runAsSystem(() =>
    prisma.evolutionInstance.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        tenantId: true,
        instanceName: true,
        baseUrl: true,
        apiKeyEncrypted: true,
        webhookToken: true,
      },
    }),
  );
  if (instances.length === 0) return;
  logger.info({ count: instances.length }, 're-sincronizando webhooks com API_PUBLIC_URL atual');
  for (const inst of instances) {
    await runWithTenant(inst.tenantId, () => syncWebhook(inst));
  }
}
