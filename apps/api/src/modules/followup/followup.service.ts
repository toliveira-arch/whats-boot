import { prisma, getTenantContext, type Prisma } from '@whats-boot/database';
import { HttpError } from '../../middlewares/error';

function tenantId(): string {
  const id = getTenantContext()?.tenantId;
  if (!id) throw new HttpError(500, 'Contexto de tenant ausente');
  return id;
}

export interface FollowUpStep {
  afterHours: number;
  text: string;
  active: boolean;
}

export function parseSteps(raw: unknown): FollowUpStep[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
    .map((s) => ({
      afterHours: Number(s.afterHours) || 0,
      text: typeof s.text === 'string' ? s.text : '',
      active: s.active !== false,
    }));
}

function present(seq: { id: string; companyId: string; enabled: boolean; steps: unknown }) {
  return {
    id: seq.id,
    companyId: seq.companyId,
    enabled: seq.enabled,
    steps: parseSteps(seq.steps),
  };
}

/** Retorna a sequência da empresa, criando uma (desligada) na primeira vez. */
export async function getSequence(companyId: string | null) {
  if (!companyId) throw new HttpError(400, 'Selecione uma empresa');
  const company = await prisma.company.findFirst({
    where: { id: companyId, deletedAt: null },
    select: { id: true },
  });
  if (!company) throw new HttpError(404, 'Empresa não encontrada');
  const existing = await prisma.followUpSequence.findFirst({
    where: { companyId, deletedAt: null },
  });
  if (existing) return present(existing);
  const created = await prisma.followUpSequence.create({
    data: { tenantId: tenantId(), companyId, enabled: false, steps: [] },
  });
  return present(created);
}

export interface SequenceInput {
  enabled?: boolean;
  steps?: FollowUpStep[];
}

export async function upsertSequence(companyId: string | null, input: SequenceInput) {
  const current = await getSequence(companyId);
  const updated = await prisma.followUpSequence.update({
    where: { id: current.id },
    data: {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.steps !== undefined
        ? { steps: input.steps as unknown as Prisma.InputJsonValue }
        : {}),
    },
  });
  return present(updated);
}
