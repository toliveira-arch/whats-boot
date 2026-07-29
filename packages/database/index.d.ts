import type { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

/** Instância singleton do Prisma Client (com guard multi-tenant aplicado). */
export declare const prisma: PrismaClient;

export interface TenantStore {
  tenantId?: string;
  system?: boolean;
}

/** Executa `fn` no escopo de um tenant (isolamento aplicado automaticamente). */
export declare function runWithTenant<T>(tenantId: string, fn: () => T): T;

/** Executa `fn` sem isolamento (auth global, registro, workers, webhooks). */
export declare function runAsSystem<T>(fn: () => T): T;

/** Retorna o contexto de tenant atual (ou undefined). */
export declare function getTenantContext(): TenantStore | undefined;
