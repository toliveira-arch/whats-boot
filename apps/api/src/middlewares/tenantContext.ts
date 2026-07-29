import type { NextFunction, Request, Response } from 'express';
import { runWithTenant } from '@whats-boot/database';

/**
 * Estabelece o contexto de tenant do request a partir de `req.auth.tenantId`.
 * DEVE ser usado após `authenticate`. A partir daqui, TODA consulta Prisma em
 * tabelas de domínio é automaticamente filtrada por esse tenant.
 */
export function tenantContext(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: 'unauthorized', message: 'Não autenticado' });
    return;
  }
  runWithTenant(req.auth.tenantId, () => next());
}

/** Atalho: autenticar + estabelecer contexto de tenant. */
export { authenticate } from './authenticate';
