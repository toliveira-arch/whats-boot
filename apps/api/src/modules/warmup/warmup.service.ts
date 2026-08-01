import { prisma, getTenantContext, type Prisma } from '@whats-boot/database';
import { HttpError } from '../../middlewares/error';
import {
  currentDateInTz,
  defaultWarmupConfig,
  parseConfig,
  resolvePool,
  runBeat,
  type WarmupConfig,
} from './warmup.engine';

function tenantId(): string {
  const id = getTenantContext()?.tenantId;
  if (!id) throw new HttpError(500, 'Contexto de tenant ausente');
  return id;
}

// ---------------------------------------------------------------------------
// Sessões
// ---------------------------------------------------------------------------

export interface SessionInput {
  companyId: string;
  name?: string;
  channelIds: string[];
  config?: Partial<WarmupConfig>;
  status?: 'RUNNING' | 'PAUSED';
}

async function present(s: {
  id: string;
  companyId: string;
  name: string;
  channelIds: string[];
  channelAId: string | null;
  channelBId: string | null;
  status: string;
  config: unknown;
  lastBeatAt: Date | null;
  beatsToday: number;
  beatsDate: string | null;
  createdAt: Date;
}) {
  const pool = resolvePool(s);
  const channels = await prisma.evolutionInstance.findMany({
    where: { id: { in: pool } },
    select: { id: true, name: true, status: true, phoneNumber: true },
  });
  const byId = new Map(channels.map((c) => [c.id, c]));
  const config = parseConfig(s.config);
  return {
    id: s.id,
    companyId: s.companyId,
    name: s.name,
    channelIds: pool,
    channels: pool.map((id) => ({
      id,
      name: byId.get(id)?.name ?? '—',
      connected: byId.get(id)?.status === 'CONNECTED',
      phoneNumber: byId.get(id)?.phoneNumber ?? null,
      veteran: (config.veteranIds ?? []).includes(id),
    })),
    status: s.status,
    config,
    lastBeatAt: s.lastBeatAt,
    beatsToday: s.beatsDate === currentDateInTz(config.timezone) ? s.beatsToday : 0,
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

async function assertCompanyAndChannels(companyId: string, channelIds: string[]) {
  const company = await prisma.company.findFirst({
    where: { id: companyId, deletedAt: null },
    select: { id: true },
  });
  if (!company) throw new HttpError(404, 'Empresa não encontrada');
  const unique = Array.from(new Set(channelIds));
  if (unique.length < 2) throw new HttpError(400, 'Selecione pelo menos 2 canais diferentes');
  const channels = await prisma.evolutionInstance.findMany({
    where: { id: { in: unique }, deletedAt: null },
    select: { id: true },
  });
  if (channels.length !== unique.length) throw new HttpError(404, 'Canal não encontrado');
  return unique;
}

export async function createSession(input: SessionInput) {
  const channelIds = await assertCompanyAndChannels(input.companyId, input.channelIds);
  const config = { ...defaultWarmupConfig(), ...(input.config ?? {}) };
  const created = await prisma.warmupSession.create({
    data: {
      tenantId: tenantId(),
      companyId: input.companyId,
      name: input.name?.trim() || 'Aquecimento',
      channelIds,
      status: 'PAUSED',
      config: config as unknown as Prisma.InputJsonValue,
    },
  });
  return present(created);
}

export async function updateSession(id: string, patch: Partial<SessionInput>) {
  const existing = await prisma.warmupSession.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new HttpError(404, 'Sessão não encontrada');

  let channelIds: string[] | undefined;
  if (patch.channelIds || patch.companyId) {
    channelIds = await assertCompanyAndChannels(
      patch.companyId ?? existing.companyId,
      patch.channelIds ?? resolvePool(existing),
    );
  }
  const nextConfig = patch.config
    ? ({ ...parseConfig(existing.config), ...patch.config } as unknown as Prisma.InputJsonValue)
    : undefined;
  const updated = await prisma.warmupSession.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name.trim() || 'Aquecimento' } : {}),
      ...(patch.companyId ? { companyId: patch.companyId } : {}),
      ...(channelIds ? { channelIds } : {}),
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
  const today = currentDateInTz(config.timezone);
  const beatsToday = s.beatsDate === today ? s.beatsToday : 0;
  const sent = await runBeat(
    { id: s.id, tenantId: s.tenantId, channelIds: resolvePool(s), beatsToday, beatsDate: today },
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
