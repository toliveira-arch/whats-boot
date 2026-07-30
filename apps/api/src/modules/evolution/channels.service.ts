import crypto from 'node:crypto';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { HttpError } from '../../middlewares/error';
import { logger } from '../../lib/logger';
import { encryptSecret, decryptSecret } from '../../lib/crypto';
import { broadcastToTenant } from '../../realtime/emitter';
import { createEvolutionClient, WEBHOOK_EVENTS } from './evolution.client';
import { mapConnectionState } from './evolution.types';

interface CreateChannelInput {
  companyId: string;
  name: string;
  instanceName: string;
  baseUrl: string;
  apiKey: string;
  phoneNumber?: string;
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

function webhookUrl(channelId: string, token: string): string {
  return `${env.API_PUBLIC_URL.replace(/\/$/, '')}/webhooks/evolution/${channelId}?token=${token}`;
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
