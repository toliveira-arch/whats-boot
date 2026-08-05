import { prisma, getTenantContext } from '@whats-boot/database';
import { HttpError } from '../../middlewares/error';
import { broadcastToTenant } from '../../realtime/emitter';
import type { CreateTaskInput, UpdateTaskInput } from './tasks.validation';

function tenantId(): string {
  const id = getTenantContext()?.tenantId;
  if (!id) throw new HttpError(500, 'Contexto de tenant ausente');
  return id;
}

const TASK_SELECT = {
  id: true,
  title: true,
  notes: true,
  dueAt: true,
  status: true,
  completedAt: true,
  conversationId: true,
  createdAt: true,
  company: { select: { id: true, name: true } },
  contact: { select: { id: true, name: true, pushName: true, phoneNumber: true } },
  assignedTo: { select: { id: true, user: { select: { name: true } } } },
  createdBy: { select: { user: { select: { name: true } } } },
} as const;

type TaskRow = {
  id: string;
  title: string;
  notes: string | null;
  dueAt: Date;
  status: string;
  completedAt: Date | null;
  conversationId: string | null;
  createdAt: Date;
  company: { id: string; name: string } | null;
  contact: {
    id: string;
    name: string | null;
    pushName: string | null;
    phoneNumber: string | null;
  } | null;
  assignedTo: { id: string; user: { name: string } } | null;
  createdBy: { user: { name: string } } | null;
};

function toTask(t: TaskRow) {
  // "Atrasada" é derivado (pendente + prazo vencido) — nada é gravado no banco.
  const overdue = t.status === 'PENDING' && t.dueAt.getTime() < Date.now();
  return {
    id: t.id,
    title: t.title,
    notes: t.notes,
    dueAt: t.dueAt,
    status: t.status,
    overdue,
    completedAt: t.completedAt,
    conversationId: t.conversationId,
    companyId: t.company?.id ?? null,
    companyName: t.company?.name ?? null,
    contactId: t.contact?.id ?? null,
    contactName: t.contact ? (t.contact.name ?? t.contact.pushName ?? 'Contato') : null,
    contactPhone: t.contact?.phoneNumber ?? null,
    assignedToId: t.assignedTo?.id ?? null,
    assignedToName: t.assignedTo?.user.name ?? null,
    createdByName: t.createdBy?.user.name ?? null,
    createdAt: t.createdAt,
  };
}

export type Task = ReturnType<typeof toTask>;

export interface ListParams {
  companyId?: string | null;
  assignedToId?: string | null;
  status?: string | null; // PENDING | DONE | CANCELED | vazio = todas
  q?: string;
}

export async function listTasks(params: ListParams): Promise<Task[]> {
  const status = params.status && params.status !== 'ALL' ? params.status : undefined;
  const rows = await prisma.followUp.findMany({
    where: {
      deletedAt: null,
      ...(params.companyId ? { companyId: params.companyId } : {}),
      ...(params.assignedToId ? { assignedToId: params.assignedToId } : {}),
      ...(status ? { status: status as 'PENDING' | 'DONE' | 'CANCELED' } : {}),
      ...(params.q
        ? {
            OR: [
              { title: { contains: params.q, mode: 'insensitive' } },
              { notes: { contains: params.q, mode: 'insensitive' } },
              { contact: { name: { contains: params.q, mode: 'insensitive' } } },
              { contact: { phoneNumber: { contains: params.q } } },
            ],
          }
        : {}),
    },
    orderBy: [{ dueAt: 'asc' }],
    take: 1000,
    select: TASK_SELECT,
  });
  return rows.map(toTask);
}

/** Membros ativos do tenant — opções de "responsável" no painel. */
export async function listAssignees(): Promise<{ id: string; name: string }[]> {
  const rows = await prisma.membership.findMany({
    where: { deletedAt: null, status: 'ACTIVE' },
    select: { id: true, user: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((m) => ({ id: m.id, name: m.user.name }));
}

/** Resolve contato/empresa a partir da conversa vinculada (lead). */
async function linkFromConversation(conversationId: string) {
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, deletedAt: null },
    select: { id: true, contactId: true, companyId: true },
  });
  if (!conv) throw new HttpError(404, 'Conversa (lead) não encontrada');
  return conv;
}

export async function createTask(input: CreateTaskInput, createdById: string): Promise<Task> {
  let contactId: string | null = null;
  let companyId = input.companyId ?? null;
  if (input.conversationId) {
    const conv = await linkFromConversation(input.conversationId);
    contactId = conv.contactId;
    companyId = companyId ?? conv.companyId;
  }
  const created = await prisma.followUp.create({
    data: {
      tenantId: tenantId(),
      title: input.title,
      notes: input.notes?.trim() || null,
      dueAt: input.dueAt,
      companyId,
      contactId,
      conversationId: input.conversationId ?? null,
      assignedToId: input.assignedToId ?? null,
      createdById,
    },
    select: TASK_SELECT,
  });
  broadcastToTenant(tenantId(), 'tasks.updated', { id: created.id, action: 'created' });
  return toTask(created);
}

export async function updateTask(id: string, input: UpdateTaskInput): Promise<Task> {
  const existing = await prisma.followUp.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!existing) throw new HttpError(404, 'Tarefa não encontrada');

  let link: { contactId?: string | null; companyId?: string | null } = {};
  if (input.conversationId !== undefined) {
    if (input.conversationId) {
      const conv = await linkFromConversation(input.conversationId);
      link = { contactId: conv.contactId, companyId: input.companyId ?? conv.companyId };
    } else {
      link = { contactId: null };
    }
  }

  const updated = await prisma.followUp.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
      ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
      ...(input.companyId !== undefined ? { companyId: input.companyId } : {}),
      ...(input.conversationId !== undefined ? { conversationId: input.conversationId } : {}),
      ...(input.assignedToId !== undefined ? { assignedToId: input.assignedToId } : {}),
      ...(input.status !== undefined
        ? { status: input.status, completedAt: input.status === 'DONE' ? new Date() : null }
        : {}),
      ...link,
    },
    select: TASK_SELECT,
  });
  broadcastToTenant(tenantId(), 'tasks.updated', { id, action: 'updated' });
  return toTask(updated);
}

export async function deleteTask(id: string): Promise<{ ok: boolean }> {
  const existing = await prisma.followUp.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!existing) throw new HttpError(404, 'Tarefa não encontrada');
  await prisma.followUp.update({ where: { id }, data: { deletedAt: new Date() } });
  broadcastToTenant(tenantId(), 'tasks.updated', { id, action: 'deleted' });
  return { ok: true };
}
