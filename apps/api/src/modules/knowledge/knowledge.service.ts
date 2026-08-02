import { prisma, getTenantContext, type Prisma } from '@whats-boot/database';
import { HttpError } from '../../middlewares/error';

function tenantId(): string {
  const id = getTenantContext()?.tenantId;
  if (!id) throw new HttpError(500, 'Contexto de tenant ausente');
  return id;
}

export interface FaqEntry {
  q: string;
  a: string;
}

export function parseEntries(raw: unknown): FaqEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === 'object')
    .map((e) => ({ q: typeof e.q === 'string' ? e.q : '', a: typeof e.a === 'string' ? e.a : '' }))
    .filter((e) => e.q.trim() || e.a.trim());
}

function present(k: {
  id: string;
  companyId: string;
  enabled: boolean;
  notes: string;
  entries: unknown;
}) {
  return {
    id: k.id,
    companyId: k.companyId,
    enabled: k.enabled,
    notes: k.notes,
    entries: parseEntries(k.entries),
  };
}

export async function getKnowledge(companyId: string | null) {
  if (!companyId) throw new HttpError(400, 'Selecione uma empresa');
  const company = await prisma.company.findFirst({
    where: { id: companyId, deletedAt: null },
    select: { id: true },
  });
  if (!company) throw new HttpError(404, 'Empresa não encontrada');
  const existing = await prisma.companyKnowledge.findFirst({
    where: { companyId, deletedAt: null },
  });
  if (existing) return present(existing);
  const created = await prisma.companyKnowledge.create({
    data: { tenantId: tenantId(), companyId, enabled: true, notes: '', entries: [] },
  });
  return present(created);
}

export interface KnowledgeInput {
  enabled?: boolean;
  notes?: string;
  entries?: FaqEntry[];
}

export async function upsertKnowledge(companyId: string | null, input: KnowledgeInput) {
  const current = await getKnowledge(companyId);
  const updated = await prisma.companyKnowledge.update({
    where: { id: current.id },
    data: {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.entries !== undefined
        ? { entries: input.entries as unknown as Prisma.InputJsonValue }
        : {}),
    },
  });
  return present(updated);
}

/**
 * Monta o bloco de "base de conhecimento" para injetar no prompt da IA.
 * Retorna '' quando não há base ativa para a empresa. Deve rodar dentro do
 * contexto de tenant.
 */
export async function buildKnowledgePrompt(companyId: string | null): Promise<string> {
  if (!companyId) return '';
  const k = await prisma.companyKnowledge.findFirst({
    where: { companyId, enabled: true, deletedAt: null },
    select: { notes: true, entries: true },
  });
  if (!k) return '';
  const entries = parseEntries(k.entries).slice(0, 40);
  const parts: string[] = [];
  if (k.notes.trim()) parts.push(k.notes.trim());
  if (entries.length) {
    parts.push(
      'Perguntas frequentes:\n' + entries.map((e) => `- P: ${e.q}\n  R: ${e.a}`).join('\n'),
    );
  }
  if (!parts.length) return '';
  return [
    'BASE DE CONHECIMENTO (use para responder dúvidas do cliente com precisão; se a resposta não estiver aqui, seja honesto e diga que vai verificar — nunca invente):',
    parts.join('\n\n'),
  ].join('\n');
}
