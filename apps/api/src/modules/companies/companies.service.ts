import { prisma, getTenantContext } from '@whats-boot/database';
import { HttpError } from '../../middlewares/error';

function tenantId(): string {
  const id = getTenantContext()?.tenantId;
  if (!id) throw new HttpError(500, 'Contexto de tenant ausente');
  return id;
}

const publicSelect = {
  id: true,
  name: true,
  legalName: true,
  document: true,
  email: true,
  phone: true,
  closerName: true,
  closerPhone: true,
  status: true,
  createdAt: true,
} as const;

export interface CompanyInput {
  name: string;
  legalName?: string | null;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
  closerName?: string | null;
  closerPhone?: string | null;
}

/** Lista as empresas do tenant atual (escopo aplicado pela extensão multi-tenant). */
export async function listCompanies() {
  return prisma.company.findMany({
    where: { deletedAt: null },
    select: publicSelect,
    orderBy: { createdAt: 'asc' },
  });
}

export async function createCompany(input: CompanyInput) {
  return prisma.company.create({
    data: {
      tenantId: tenantId(),
      name: input.name,
      legalName: input.legalName ?? null,
      document: input.document ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      closerName: input.closerName ?? null,
      closerPhone: input.closerPhone ?? null,
    },
    select: publicSelect,
  });
}

export async function updateCompany(id: string, input: Partial<CompanyInput>) {
  const existing = await prisma.company.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new HttpError(404, 'Empresa não encontrada');
  return prisma.company.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
      ...(input.document !== undefined ? { document: input.document } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.closerName !== undefined ? { closerName: input.closerName } : {}),
      ...(input.closerPhone !== undefined ? { closerPhone: input.closerPhone } : {}),
    },
    select: publicSelect,
  });
}

export async function deleteCompany(id: string) {
  const existing = await prisma.company.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new HttpError(404, 'Empresa não encontrada');
  await prisma.company.update({ where: { id }, data: { deletedAt: new Date() } });
  return { ok: true };
}
