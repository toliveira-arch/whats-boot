import type { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

/** Instância singleton do Prisma Client (compartilhada por api e workers). */
export declare const prisma: PrismaClient;
