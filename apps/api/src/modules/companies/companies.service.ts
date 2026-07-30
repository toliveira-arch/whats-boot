import { prisma } from '../../lib/prisma';

/** Lista as empresas do tenant atual (escopo aplicado pela extensão multi-tenant). */
export async function listCompanies() {
  return prisma.company.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      legalName: true,
      document: true,
      email: true,
      phone: true,
      status: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
}
