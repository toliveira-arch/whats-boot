import type { NextFunction, Request, Response } from 'express';

/** Exige que o usuário tenha um dos papéis informados. */
export function requireRoles(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: 'unauthorized', message: 'Não autenticado' });
      return;
    }
    if (!roles.includes(req.auth.role)) {
      res.status(403).json({ error: 'forbidden', message: 'Papel sem permissão para esta ação' });
      return;
    }
    next();
  };
}

/** Exige que o usuário possua TODAS as permissões informadas. */
export function requirePermissions(...permissions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: 'unauthorized', message: 'Não autenticado' });
      return;
    }
    const granted = new Set(req.auth.permissions);
    const missing = permissions.filter((p) => !granted.has(p));
    if (missing.length > 0) {
      res.status(403).json({ error: 'forbidden', message: 'Permissão insuficiente', missing });
      return;
    }
    next();
  };
}
