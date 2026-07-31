import { prisma, getTenantContext, type Prisma } from '@whats-boot/database';
import { HttpError } from '../../middlewares/error';
import { defaultWarmupConfig, parseConfig, runBeat, type WarmupConfig } from './warmup.engine';

function tenantId(): string {
  const id = getTenantContext()?.tenantId;
  if (!id) throw new HttpError(500, 'Contexto de tenant ausente');
  return id;
}

const todayStr = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Sessões
// ---------------------------------------------------------------------------

export interface SessionInput {
  companyId: string;
  name?: string;
  channelAId: string;
  channelBId: string;
  config?: Partial<WarmupConfig>;
  status?: 'RUNNING' | 'PAUSED';
}

async function present(s: {
  id: string;
  companyId: string;
  name: string;
  channelAId: string;
  channelBId: string;
  status: string;
  config: unknown;
  lastBeatAt: Date | null;
  beatsToday: number;
  beatsDate: string | null;
  createdAt: Date;
}) {
  const ids = [s.channelAId, s.channelBId];
  const channels = await prisma.evolutionInstance.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, status: true, phoneNumber: true },
  });
  const byId = new Map(channels.map((c) => [c.id, c]));
  return {
    id: s.id,
    companyId: s.companyId,
    name: s.name,
    channelAId: s.channelAId,
    channelBId: s.channelBId,
    channelAName: byId.get(s.channelAId)?.name ?? '—',
    channelBName: byId.get(s.channelBId)?.name ?? '—',
    channelAConnected: byId.get(s.channelAId)?.status === 'CONNECTED',
    channelBConnected: byId.get(s.channelBId)?.status === 'CONNECTED',
    status: s.status,
    config: parseConfig(s.config),
    lastBeatAt: s.lastBeatAt,
    beatsToday: s.beatsDate === todayStr() ? s.beatsToday : 0,
    createdAt: s.createdAt,
  };
}

export async function listSessions(companyId?: string | null) {
  const sessions = await prisma.warmupSession.findMany({
    where: { deletedAt: null, ...(companyId ? { companyId } : {}) },
    orderBy: { createdAt: 'desc' },
  });
  return Promise.all(sessions.map(present));
}

async function assertCompanyAndChannels(input: SessionInput) {
  const company = await prisma.company.findFirst({
    where: { id: input.companyId, deletedAt: null },
    select: { id: true },
  });
  if (!company) throw new HttpError(404, 'Empresa não encontrada');
  if (input.channelAId === input.channelBId)
    throw new HttpError(400, 'Escolha dois canais diferentes');
  const channels = await prisma.evolutionInstance.findMany({
    where: { id: { in: [input.channelAId, input.channelBId] }, deletedAt: null },
    select: { id: true },
  });
  if (channels.length !== 2) throw new HttpError(404, 'Canal não encontrado');
}

export async function createSession(input: SessionInput) {
  await assertCompanyAndChannels(input);
  const config = { ...defaultWarmupConfig(), ...(input.config ?? {}) };
  const created = await prisma.warmupSession.create({
    data: {
      tenantId: tenantId(),
      companyId: input.companyId,
      name: input.name?.trim() || 'Aquecimento',
      channelAId: input.channelAId,
      channelBId: input.channelBId,
      status: 'PAUSED',
      config: config as unknown as Prisma.InputJsonValue,
    },
  });
  return present(created);
}

export async function updateSession(id: string, patch: Partial<SessionInput>) {
  const existing = await prisma.warmupSession.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new HttpError(404, 'Sessão não encontrada');
  if (patch.channelAId || patch.channelBId || patch.companyId) {
    await assertCompanyAndChannels({
      companyId: patch.companyId ?? existing.companyId,
      channelAId: patch.channelAId ?? existing.channelAId,
      channelBId: patch.channelBId ?? existing.channelBId,
    });
  }
  const nextConfig = patch.config
    ? ({ ...parseConfig(existing.config), ...patch.config } as unknown as Prisma.InputJsonValue)
    : undefined;
  const updated = await prisma.warmupSession.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name.trim() || 'Aquecimento' } : {}),
      ...(patch.companyId ? { companyId: patch.companyId } : {}),
      ...(patch.channelAId ? { channelAId: patch.channelAId } : {}),
      ...(patch.channelBId ? { channelBId: patch.channelBId } : {}),
      ...(patch.status ? { status: patch.status } : {}),
      ...(nextConfig ? { config: nextConfig } : {}),
    },
  });
  return present(updated);
}

export async function setStatus(id: string, status: 'RUNNING' | 'PAUSED') {
  const existing = await prisma.warmupSession.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new HttpError(404, 'Sessão não encontrada');
  const updated = await prisma.warmupSession.update({ where: { id }, data: { status } });
  return present(updated);
}

export async function deleteSession(id: string) {
  const existing = await prisma.warmupSession.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new HttpError(404, 'Sessão não encontrada');
  await prisma.warmupSession.update({
    where: { id },
    data: { deletedAt: new Date(), status: 'PAUSED' },
  });
  return { ok: true };
}

/** Roda um beat imediatamente (botão "Testar agora"). */
export async function runNow(id: string) {
  const s = await prisma.warmupSession.findFirst({ where: { id, deletedAt: null } });
  if (!s) throw new HttpError(404, 'Sessão não encontrada');
  const config = parseConfig(s.config);
  const today = todayStr();
  const beatsToday = s.beatsDate === today ? s.beatsToday : 0;
  const sent = await runBeat(
    {
      id: s.id,
      tenantId: s.tenantId,
      channelAId: s.channelAId,
      channelBId: s.channelBId,
      beatsToday,
      beatsDate: today,
    },
    config,
  );
  if (sent) {
    await prisma.warmupSession.update({
      where: { id },
      data: { lastBeatAt: new Date(), beatsToday: beatsToday + 1, beatsDate: today },
    });
  }
  return { sent };
}

// ---------------------------------------------------------------------------
// Galeria de imagens
// ---------------------------------------------------------------------------

export async function listAssets(companyId?: string | null) {
  const assets = await prisma.warmupAsset.findMany({
    where: { deletedAt: null, ...(companyId ? { OR: [{ companyId }, { companyId: null }] } : {}) },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      mimeType: true,
      dataBase64: true,
      companyId: true,
      createdAt: true,
    },
  });
  // Devolve como data URL pronta para <img>.
  return assets.map((a) => ({
    id: a.id,
    name: a.name,
    companyId: a.companyId,
    createdAt: a.createdAt,
    dataUrl: `data:${a.mimeType};base64,${a.dataBase64}`,
  }));
}

export interface AssetInput {
  companyId?: string | null;
  name?: string;
  mimeType: string;
  dataBase64: string;
}

export async function addAsset(input: AssetInput) {
  // Aceita tanto data URL ("data:image/png;base64,....") quanto base64 puro.
  let mime = input.mimeType;
  let data = input.dataBase64;
  const m = /^data:([^;]+);base64,(.*)$/s.exec(data);
  if (m) {
    mime = m[1] ?? mime;
    data = m[2] ?? '';
  }
  if (!data) throw new HttpError(400, 'Imagem inválida');
  const created = await prisma.warmupAsset.create({
    data: {
      tenantId: tenantId(),
      companyId: input.companyId ?? null,
      name: input.name ?? null,
      mimeType: mime || 'image/jpeg',
      dataBase64: data,
    },
    select: { id: true },
  });
  return { id: created.id };
}

export async function deleteAsset(id: string) {
  const existing = await prisma.warmupAsset.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new HttpError(404, 'Imagem não encontrada');
  await prisma.warmupAsset.update({ where: { id }, data: { deletedAt: new Date() } });
  return { ok: true };
}
